export const dropInPath = "/parent/drop-ins.html";

// Only this existing parent page can be requested after sign-in.
// Never use an arbitrary URL supplied by a query string.
export function requestedParentDestination(search = "") {
  return new URLSearchParams(search).get("next") === dropInPath ? dropInPath : "";
}

export function signInCallbackUrl(origin, destination = "") {
  const callback = new URL("/auth/callback.html", origin);
  if (destination === dropInPath) callback.searchParams.set("next", dropInPath);
  return callback.href;
}

export async function signInDestination(client, destination = "") {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("route");
  const role = await client.from("coach_users").select("user_id")
    .eq("user_id", data.user.id).maybeSingle();
  if (role.error) throw new Error("route");
  return role.data ? "/coach/" : destination === dropInPath ? dropInPath : "/parent/";
}
