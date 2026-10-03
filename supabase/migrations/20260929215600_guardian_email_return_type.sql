-- auth.users.email is varchar(255); RETURN QUERY requires an exact text result.
-- Keep the same owner, role check, and fixed search path as the first version.
create or replace function public.list_family_guardians(p_family_id uuid)
returns table(user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  return query
    select g.user_id, u.email::text, g.created_at
      from public.family_guardians g
      join auth.users u on u.id = g.user_id
     where g.family_id = p_family_id
     order by g.created_at;
end;
$$;
