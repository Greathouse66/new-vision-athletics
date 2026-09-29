import { configured, supabase } from "./client.js";

const form = document.querySelector("#sign-in-form");
const button = form.querySelector("button");
const status = document.querySelector("#status");

if (!configured) {
  status.textContent = "Parent sign-in is being set up. Please try again later.";
  button.disabled = true;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!configured) return;

  button.disabled = true;
  status.textContent = "Sending your link…";
  const email = form.elements.email.value.trim();
  try {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: new URL("/auth/callback.html", location.origin).href,
      },
    });

    // Keep the browser message the same for unknown and known addresses.
    status.textContent = "If this email has access, a sign-in link will arrive shortly. Check your inbox.";
    if (error) console.info("Sign-in request was not completed:", error.code ?? "unknown_error");
  } catch {
    status.textContent = "We could not send a link right now. Please try again later.";
  } finally {
    button.disabled = false;
  }
});
