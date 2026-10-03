import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const signOut = document.querySelector("#sign-out");

async function start() {
  if (!configured) { status.textContent = "Coach portal setup is in progress."; return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) { location.replace("/auth/sign-in.html"); return; }
  const { data: coach, error } = await supabase.from("coach_users")
    .select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (error) throw error;
  if (!coach) { status.textContent = "This account does not have coach access."; return; }

  signOut.hidden = false;
  content.hidden = false;
  const results = await Promise.all([
    supabase.from("athletes").select("id", { count: "exact", head: true }),
    supabase.from("families").select("id", { count: "exact", head: true }),
    supabase.from("skill_groups").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("class_occurrences").select("id", { count: "exact", head: true }),
  ]);
  if (results.some((result) => result.error || typeof result.count !== "number")) {
    status.textContent = "Could not load the counts. Coach tools are still available above.";
    return;
  }
  for (const [index, id] of ["athlete-count", "family-count", "group-count", "class-count"].entries()) {
    document.getElementById(id).textContent = String(results[index].count);
  }
  status.textContent = "";
}

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; status.textContent = "Could not sign out."; return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => { status.textContent = "Could not load the coach workspace. Please try again."; });
