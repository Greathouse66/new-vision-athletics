export async function deliverQueuedNotification(admin, config, flow, send = fetch, log = console) {
  const { data: job, error } = await admin.rpc(flow.claim, flow.claimArgs(config));
  if (error) return Response.json({ error: "Notification queue unavailable" }, { status: 503 });
  if (!job) return Response.json({ status: "idle" });
  if (job.skipped) return Response.json({ status: "skipped" });
  const payload = job.payload;
  let failure = "invalid_payload";
  let providerId = null;
  try {
    if (!payload || payload.from !== config.from || payload[flow.linkField] !== config[flow.linkField] ||
        typeof job.leaseToken !== "string") throw new Error("Invalid job");
    const message = flow.render(payload);
    failure = "temporary";
    const current = await admin.rpc(flow.current, flow.leaseArgs(payload, job.leaseToken));
    if (current.error || !current.data) {
      failure = current.error ? "temporary" : "no_longer_current";
      throw new Error("Notification authorization changed");
    }
    const response = await send("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json",
        "Idempotency-Key": flow.idempotencyKey(payload) },
      body: JSON.stringify({ from: payload.from, to: [payload.to], ...message }),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      failure = response.status === 429 ? "rate_limited" : response.status >= 500 ? "temporary" : "provider_rejected";
      if (response.status === 409) {
        const body = await response.json().catch(() => ({}));
        failure = body.name === "concurrent_idempotent_requests" ? "temporary" : "idempotency_conflict";
      }
      throw new Error("Provider did not accept notification");
    }
    const body = await response.json();
    if (typeof body?.id !== "string" || !body.id.length || body.id.length > 200) throw new Error("Missing provider ID");
    providerId = body.id;
  } catch { log.error("Drop-in notification attempt failed", failure); }
  const settled = await admin.rpc(flow.settle, {
    ...flow.leaseArgs(payload, job.leaseToken),
    p_sent: !!providerId, p_provider_id: providerId, p_failure_code: providerId ? null : failure,
  });
  if (settled.error) return Response.json({ error: "Notification delivery result needs review" }, { status: 503 });
  return Response.json({ status: providerId ? "sent" : failure === "no_longer_current" ? "skipped"
    : ["temporary", "rate_limited"].includes(failure) ? "retry" : "review" });
}
