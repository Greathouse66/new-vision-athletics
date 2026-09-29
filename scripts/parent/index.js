import { configured, supabase } from "../auth/client.js";

const status = document.querySelector("#status");
const content = document.querySelector("#family-content");
const signOut = document.querySelector("#sign-out");

function showError(message) {
  status.textContent = message;
  content.hidden = true;
}

async function loadFamily() {
  if (!configured) {
    showError("Parent portal setup is in progress.");
    return;
  }

  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) {
    location.replace("/auth/sign-in.html");
    return;
  }
  signOut.hidden = false;

  const { data: grants, error: grantError } = await supabase
    .from("family_guardians")
    .select("family_id")
    .eq("user_id", auth.user.id);
  if (grantError) throw grantError;
  if (!grants.length) {
    showError("This account has no family access yet. Please contact New Vision Athletics.");
    return;
  }

  const familyIds = grants.map((grant) => grant.family_id);
  const [{ data: families, error: familyError }, { data: athletes, error: athleteError }] =
    await Promise.all([
      supabase.from("families").select("id, display_name").in("id", familyIds).order("display_name"),
      supabase.from("athletes").select("id, family_id, display_name").in("family_id", familyIds).order("display_name"),
    ]);
  if (familyError || athleteError) throw familyError ?? athleteError;

  const list = document.querySelector("#families");
  list.replaceChildren();
  for (const family of families) {
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = family.display_name;
    section.append(heading);
    const children = athletes.filter((athlete) => athlete.family_id === family.id);
    if (children.length) {
      const ul = document.createElement("ul");
      for (const athlete of children) {
        const li = document.createElement("li");
        li.textContent = athlete.display_name;
        ul.append(li);
      }
      section.append(ul);
    } else {
      const empty = document.createElement("p");
      empty.textContent = "No athletes have been added yet.";
      section.append(empty);
    }
    list.append(section);
  }
  status.textContent = "";
  content.hidden = false;
}

signOut.addEventListener("click", async () => {
  signOut.disabled = true;
  const { error } = await supabase.auth.signOut();
  if (error) {
    signOut.disabled = false;
    showError("Could not sign out. Please try again.");
    return;
  }
  location.replace("/auth/sign-in.html");
});

loadFamily().catch(() => showError("We could not load your family right now. Please try again."));
