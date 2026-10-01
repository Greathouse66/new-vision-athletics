import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const familySelect = document.querySelector("#family");
const inviteForm = document.querySelector("#invite-form");
const inviteButton = inviteForm.querySelector("button");
const invitationList = document.querySelector("#invitations");
const guardianList = document.querySelector("#guardians");
const contactList = document.querySelector("#billing-contacts");
const contactForm = document.querySelector("#billing-contact-form");
const contactButton = contactForm.querySelector("button");
const signOut = document.querySelector("#sign-out");

function setStatus(message) {
  status.textContent = message;
}

function item(label, action, callback) {
  const li = document.createElement("li");
  const span = document.createElement("span");
  span.textContent = label;
  li.append(span);
  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = action;
    button.addEventListener("click", callback);
    li.append(button);
  }
  return li;
}

async function loadFamilyAccess() {
  const familyId = familySelect.value;
  invitationList.replaceChildren();
  guardianList.replaceChildren();
  contactList.replaceChildren();
  if (!familyId) return;

  const [invites, guardians, contact] = await Promise.all([
    supabase.from("guardian_invitations")
      .select("id, email, expires_at, accepted_at, revoked_at")
      .eq("family_id", familyId).order("created_at", { ascending: false }),
    supabase.rpc("list_family_guardians", { p_family_id: familyId }),
    supabase.from("family_billing_contacts")
      .select("id, email, approved_at").eq("family_id", familyId)
      .is("revoked_at", null).maybeSingle(),
  ]);
  if (invites.error || guardians.error || contact.error) {
    console.info("Family access loading failed:",
      invites.error?.code ?? "", guardians.error?.code ?? "", contact.error?.code ?? "");
    throw invites.error ?? guardians.error ?? contact.error;
  }
  if (familySelect.value !== familyId) return;

  if (contact.data) {
    contactList.append(item(contact.data.email, "Remove receipt email", async () => {
      if (!confirm("Remove " + contact.data.email + " as the receipt email for this account?")) return;
      const { error } = await supabase.rpc("remove_family_billing_contact", {
        p_family_id: familyId,
      });
      if (error) { setStatus("Could not remove the receipt email."); return; }
      setStatus("Receipt email removed. Future payments will need a reviewed contact.");
      await loadFamilyAccess().catch(() => setStatus("Could not refresh the receipt email."));
    }));
  } else {
    contactList.append(item("No receipt email approved for this account."));
  }

  const pending = invites.data.filter((invite) =>
    !invite.accepted_at && !invite.revoked_at && new Date(invite.expires_at) > new Date()
  );
  for (const invite of pending) {
    const expires = new Date(invite.expires_at).toLocaleDateString();
    invitationList.append(item(`${invite.email} · expires ${expires}`, "Cancel", async () => {
      if (!confirm(`Cancel the invitation for ${invite.email}?`)) return;
      const { error } = await supabase.rpc("revoke_guardian_invitation", {
        p_invitation_id: invite.id,
      });
      if (error) { setStatus("Could not cancel this invitation."); return; }
      setStatus("Invitation cancelled.");
      await loadFamilyAccess().catch(() => setStatus("Could not refresh family access."));
    }));
  }
  if (!pending.length) invitationList.append(item("No pending invitations."));

  for (const guardian of guardians.data) {
    guardianList.append(item(guardian.email ?? guardian.user_id, "Revoke access", async () => {
      if (!confirm(`Revoke family access for ${guardian.email ?? guardian.user_id}?`)) return;
      const { error } = await supabase.rpc("revoke_guardian_access", {
        p_family_id: familyId, p_user_id: guardian.user_id,
      });
      if (error) { setStatus("Could not revoke this guardian's access."); return; }
      setStatus("Guardian access revoked.");
      await loadFamilyAccess().catch(() => setStatus("Could not refresh family access."));
    }));
  }
  if (!guardians.data.length) guardianList.append(item("No guardians have access yet."));
}

async function start() {
  if (!configured) { setStatus("Coach portal setup is in progress."); return; }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    location.replace("/auth/sign-in.html");
    return;
  }
  const { data: coach, error } = await supabase.from("coach_users")
    .select("user_id").eq("user_id", auth.user.id).maybeSingle();
  if (error) throw error;
  if (!coach) { setStatus("This account does not have coach access."); return; }

  signOut.hidden = false;
  const families = await supabase.from("families").select("id, display_name").order("display_name");
  if (families.error) throw families.error;
  if (!families.data.length) { setStatus("No parent accounts have been added yet."); return; }
  for (const family of families.data) {
    const option = document.createElement("option");
    option.value = family.id;
    option.textContent = family.display_name;
    familySelect.append(option);
  }
  await loadFamilyAccess();
  content.hidden = false;
  setStatus("");
}

familySelect.addEventListener("change", () => {
  loadFamilyAccess().then(() => setStatus(""))
    .catch(() => setStatus("Could not load family access."));
});

contactForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!familySelect.value) { setStatus("Choose a parent account."); return; }
  const familyId = familySelect.value;
  const email = contactForm.elements.email.value.trim();
  if (!confirm("Approve " + email + " for future receipt emails to this parent account? This does not grant portal access.")) return;
  contactButton.disabled = true;
  familySelect.disabled = true;
  try {
    const { error } = await supabase.rpc("set_family_billing_contact", {
      p_family_id: familyId, p_email: email,
    });
    if (error) {
      setStatus(error.code === "PGRST202"
        ? "The billing contact database migration has not been applied."
        : "Could not save the receipt email. Review the address and try again.");
      return;
    }
    contactForm.reset();
    await loadFamilyAccess();
    setStatus("Receipt email saved. No email was sent and portal access was not changed.");
  } catch {
    setStatus("Could not save the receipt email. Please try again.");
  } finally {
    contactButton.disabled = false;
    familySelect.disabled = false;
  }
});

inviteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  inviteButton.disabled = true;
  const email = inviteForm.elements.email.value.trim();
  try {
    const { error } = await supabase.rpc("create_guardian_invitation", {
      p_family_id: familySelect.value, p_email: email,
    });
    if (error) {
      setStatus(error.message.includes("already pending")
        ? "An invitation for that email is already pending."
        : error.message.includes("already has family access")
          ? "That email already has access to this family."
          : "Could not approve the invitation. Check the email and try again.");
      return;
    }
    inviteForm.reset();
    setStatus("Invitation approved. No email was sent. If this is a new account, an administrator must set it up in Auth.");
    await loadFamilyAccess().catch(() => setStatus("Approved, but could not refresh invitations."));
  } catch {
    setStatus("Could not approve the invitation. Please try again.");
  } finally {
    inviteButton.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; setStatus("Could not sign out."); return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => setStatus("Could not load the coach portal. Please try again."));
