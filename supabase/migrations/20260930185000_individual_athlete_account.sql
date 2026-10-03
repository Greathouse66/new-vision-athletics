-- Create a one-athlete parent account in one transaction. Existing RLS still
-- checks both inserts against the signed-in coach's role.
create function public.create_individual_athlete(p_display_name text)
returns table (family_id uuid, athlete_id uuid)
language plpgsql security invoker set search_path = '' as $$
declare
  v_name text := pg_catalog.btrim(p_display_name);
  v_family_id uuid;
  v_athlete_id uuid;
begin
  if not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if v_name is null or pg_catalog.length(v_name) not between 1 and 160 then
    raise exception 'Athlete name must be 1 to 160 characters' using errcode = '22023';
  end if;

  insert into public.families (display_name) values (v_name)
    returning id into v_family_id;
  insert into public.athletes (family_id, display_name)
    values (v_family_id, v_name) returning id into v_athlete_id;

  return query select v_family_id, v_athlete_id;
end;
$$;

revoke all on function public.create_individual_athlete(text) from public, anon;
grant execute on function public.create_individual_athlete(text) to authenticated;
