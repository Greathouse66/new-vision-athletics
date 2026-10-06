import { configured, supabase } from "./client.js";

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
  location.replace("/parent/");
}

completeSignIn().catch((error) => {
  history.replaceState(null, "", "/auth/callback.html");
  status.textContent = error.message === "setup"
    ? "Parent sign-in is being set up. Please try again later."
    : "This sign-in link could not be used. Please request a new one.";
  document.querySelector("#retry").hidden = false;
});
