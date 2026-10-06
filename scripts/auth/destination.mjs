export async function signInDestination(client) {
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) throw new Error("route");
  const role = await client.from("coach_users").select("user_id")
    .eq("user_id", data.user.id).maybeSingle();
  if (role.error) throw new Error("route");
  return role.data ? "/coach/" : "/parent/";
}
