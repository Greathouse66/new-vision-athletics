-- One group per athlete on any given date. The upper date is exclusive.
-- Existing overlapping rows cause this migration to fail so they can be reviewed.
create extension if not exists btree_gist with schema extensions;
set search_path = public, extensions, pg_catalog;
alter table public.group_enrollments add constraint one_group_per_athlete_date
  exclude using gist (athlete_id with =, daterange(starts_on, ends_on, '[)') with &&);
reset search_path;

-- All enrollment writes and athlete creation go through checked transactions.
revoke insert, update on public.group_enrollments from authenticated;
revoke insert on public.athletes from authenticated;
drop function public.create_individual_athlete(text);

create function public.assign_athlete_group(
  p_athlete_id uuid, p_group_id uuid, p_starts_on date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_last public.group_enrollments%rowtype;
  v_new_id uuid;
begin
  if not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_athlete_id is null or p_group_id is null or p_starts_on is null then
    raise exception 'Athlete, group and effective date are required' using errcode = '22023';
  end if;
  -- Serialize simultaneous transfers for the same athlete.
  perform 1 from public.athletes where id = p_athlete_id for update;
  if not found then
    raise exception 'Athlete not found' using errcode = '22023';
  end if;
  perform 1 from public.skill_groups where id = p_group_id and is_active for share;
  if not found then
    raise exception 'Choose an active group' using errcode = '22023';
  end if;

  select * into v_last from public.group_enrollments
    where athlete_id = p_athlete_id order by starts_on desc limit 1;
  if found then
    if v_last.ends_on is not null then
      raise exception 'Existing group history needs coach review' using errcode = '22023';
    end if;
    if v_last.group_id = p_group_id then
      raise exception 'Athlete is already in this group' using errcode = '22023';
    end if;
    if p_starts_on <= v_last.starts_on then
      raise exception 'Transfer date must be after the current group start date'
        using errcode = '22023';
    end if;
    update public.group_enrollments set ends_on = p_starts_on where id = v_last.id;
  end if;

  insert into public.group_enrollments (athlete_id, group_id, starts_on)
    values (p_athlete_id, p_group_id, p_starts_on) returning id into v_new_id;
  return v_new_id;
end;
$$;

create function public.create_individual_athlete(
  p_display_name text, p_group_id uuid, p_starts_on date
) returns table (family_id uuid, athlete_id uuid)
language plpgsql security definer set search_path = '' as $$
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
  insert into public.families (display_name) values (v_name) returning id into v_family_id;
  insert into public.athletes (family_id, display_name)
    values (v_family_id, v_name) returning id into v_athlete_id;
  perform public.assign_athlete_group(v_athlete_id, p_group_id, p_starts_on);
  return query select v_family_id, v_athlete_id;
end;
$$;

create function public.create_shared_athlete(
  p_family_id uuid, p_display_name text, p_group_id uuid, p_starts_on date
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_name text := pg_catalog.btrim(p_display_name);
  v_athlete_id uuid;
begin
  if not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_family_id is null or v_name is null or pg_catalog.length(v_name) not between 1 and 160 then
    raise exception 'Account and athlete name are required' using errcode = '22023';
  end if;
  insert into public.athletes (family_id, display_name)
    values (p_family_id, v_name) returning id into v_athlete_id;
  perform public.assign_athlete_group(v_athlete_id, p_group_id, p_starts_on);
  return v_athlete_id;
end;
$$;

revoke all on function public.assign_athlete_group(uuid, uuid, date),
  public.create_individual_athlete(text, uuid, date),
  public.create_shared_athlete(uuid, text, uuid, date) from public, anon;
grant execute on function public.assign_athlete_group(uuid, uuid, date),
  public.create_individual_athlete(text, uuid, date),
  public.create_shared_athlete(uuid, text, uuid, date) to authenticated;
