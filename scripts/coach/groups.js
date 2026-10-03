import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#coach-content");
const form = document.querySelector("#group-form");
const addButton = form.querySelector("button");
const activeList = document.querySelector("#active-groups");
const inactiveList = document.querySelector("#inactive-groups");
const signOut = document.querySelector("#sign-out");

function setStatus(message) {
  status.textContent = message;
}

function emptyList(list, message) {
  if (list.children.length) return;
  const item = document.createElement("li");
  item.textContent = message;
  list.append(item);
}

async function loadGroups() {
  const { data, error } = await supabase.from("skill_groups")
    .select("id, name, is_active").order("name");
  if (error) throw error;

  activeList.replaceChildren();
  inactiveList.replaceChildren();
  for (const group of data) {
    const item = document.createElement("li");
    const label = document.createElement("span");
    label.textContent = group.name;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "secondary";
    button.textContent = group.is_active ? "Mark inactive" : "Reactivate";
    button.setAttribute("aria-label", `${button.textContent} ${group.name}`);
    button.addEventListener("click", async () => {
      if (group.is_active && !confirm(`Mark ${group.name} inactive? Existing enrollments remain recorded.`)) return;
      button.disabled = true;
      try {
        const { data: updated, error: updateError } = await supabase.from("skill_groups")
          .update({ is_active: !group.is_active }).eq("id", group.id)
          .eq("is_active", group.is_active).select("id").maybeSingle();
        if (updateError || !updated) {
          setStatus("Could not update the group. Refresh the list and try again.");
          return;
        }
        await loadGroups();
        setStatus(`${group.name} is now ${group.is_active ? "inactive" : "active"}.`);
      } catch {
        setStatus("Could not update the group. Please try again.");
      } finally {
        button.disabled = false;
      }
    });
    item.append(label, button);
    (group.is_active ? activeList : inactiveList).append(item);
  }
  emptyList(activeList, "No active groups yet.");
  emptyList(inactiveList, "No inactive groups.");
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
  await loadGroups();
  content.hidden = false;
  setStatus("");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = form.elements.name.value.trim();
  if (!name || name.length > 120) {
    setStatus("Enter a group name of 1 to 120 characters.");
    return;
  }
  addButton.disabled = true;
  try {
    const { error } = await supabase.from("skill_groups").insert({ name });
    if (error) {
      setStatus(error.code === "23505" ? "A group with that name already exists." : "Could not add the group. Please try again.");
      return;
    }
    form.reset();
    await loadGroups();
    setStatus(`${name} added.`);
  } catch {
    setStatus("Could not add the group. Please try again.");
  } finally {
    addButton.disabled = false;
  }
});

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) { signOut.disabled = false; setStatus("Could not sign out."); return; }
  location.replace("/auth/sign-in.html");
});

start().catch(() => setStatus("Could not load skill groups. Please try again."));
