-- Record changes to parent-account and athlete display names. Existing names
-- are not backfilled, and this migration inserts no family or athlete data.
create table public.record_name_corrections (
  id bigint generated always as identity primary key,
  family_id uuid not null,
  record_type text not null check (record_type in ('parent_account', 'athlete')),
  record_id uuid not null,
  old_name text not null,
  new_name text not null,
  changed_by uuid,
  changed_at timestamptz not null default now(),
  check (old_name <> new_name)
);
create index record_name_corrections_family_date_idx
  on public.record_name_corrections(family_id, changed_at desc, id desc);

alter table public.record_name_corrections enable row level security;
revoke all on public.record_name_corrections from public, anon, authenticated;
grant select on public.record_name_corrections to authenticated;
create policy record_name_corrections_coach_read on public.record_name_corrections
  for select to authenticated using ((select private.is_coach()));

-- The database writes the event in the same transaction as the correction.
-- auth.uid() identifies a coach using the Data API; an administrative SQL
-- change with no signed-in Auth identity is recorded with changed_by = null.
create function private.audit_record_name_correction()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_family_id uuid;
  v_record_type text;
begin
  if tg_table_schema <> 'public' then
    raise exception 'Unexpected audit source' using errcode = '22023';
  end if;
  if tg_table_name = 'families' then
    v_family_id := new.id;
    v_record_type := 'parent_account';
  elsif tg_table_name = 'athletes' then
    v_family_id := new.family_id;
    v_record_type := 'athlete';
  else
    raise exception 'Unexpected audit source' using errcode = '22023';
  end if;

  insert into public.record_name_corrections
    (family_id, record_type, record_id, old_name, new_name, changed_by)
  values (v_family_id, v_record_type, new.id,
          old.display_name, new.display_name, auth.uid());
  return new;
end;
$$;
revoke all on function private.audit_record_name_correction() from public, anon, authenticated;

create trigger audit_family_name_correction
  after update of display_name on public.families
  for each row when (old.display_name is distinct from new.display_name)
  execute function private.audit_record_name_correction();
create trigger audit_athlete_name_correction
  after update of display_name on public.athletes
  for each row when (old.display_name is distinct from new.display_name)
  execute function private.audit_record_name_correction();
