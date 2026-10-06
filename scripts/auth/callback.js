import { configured, supabase } from "./client.js";
import { signInDestination } from "./destination.mjs";

const status = document.querySelector("#status");

async function completeSignIn() {
  if (!configured) throw new Error("setup");
  if (new URLSearchParams(location.hash.slice(1)).has("error") ||
      new URLSearchParams(location.search).has("error")) {
    throw new Error("link");
  }

  // Supabase JS consumes the one-time redirect fragment during initialization.
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("link");
  history.replaceState(null, "", "/auth/callback.html");
  location.replace(await signInDestination(supabase));
}

function showFailure(error) {
  history.replaceState(null, "", "/auth/callback.html");
  status.textContent = error.message === "setup"
    ? "Sign-in is being set up. Please try again later."
    : error.message === "route"
      ? "You’re signed in, but we could not load your portal. Please try again."
      : "This sign-in link could not be used. Please request a new one.";
  document.querySelector("#retry").hidden = error.message === "route";
  document.querySelector("#continue").hidden = error.message !== "route";
}

document.querySelector("#continue").addEventListener("click", async (event) => {
  event.target.disabled = true;
  try { await completeSignIn(); } catch (error) { showFailure(error); }
  finally { event.target.disabled = false; }
});
completeSignIn().catch(showFailure);
