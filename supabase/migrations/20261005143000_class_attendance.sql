-- Attendance is a coach observation about an active dated seat. It does not
-- create a makeup credit, a fee, or a cancellation decision.
create table public.class_attendance (
  seat_id uuid primary key references public.class_seats(id),
  status text not null check (status in ('present', 'absent')),
  marked_by uuid not null references auth.users(id),
  marked_at timestamptz not null default now()
);

create table public.class_attendance_audit (
  id uuid primary key default gen_random_uuid(),
  seat_id uuid not null references public.class_seats(id),
  old_status text check (old_status is null or old_status in ('present', 'absent')),
  new_status text not null check (new_status in ('present', 'absent')),
  reason text,
  changed_by uuid not null references auth.users(id),
  changed_at timestamptz not null default now(),
  check (old_status is distinct from new_status),
  check (case when old_status is null then reason is null
              else reason is not null and length(btrim(reason)) between 3 and 500 end)
);
create index class_attendance_audit_seat_changed_idx
  on public.class_attendance_audit(seat_id, changed_at desc);

alter table public.class_attendance enable row level security;
alter table public.class_attendance_audit enable row level security;
revoke all on public.class_attendance, public.class_attendance_audit
  from public, anon, authenticated;
grant select on public.class_attendance, public.class_attendance_audit to authenticated;
create policy class_attendance_coach_read on public.class_attendance
  for select to authenticated using ((select private.is_coach()));
create policy class_attendance_audit_coach_read on public.class_attendance_audit
  for select to authenticated using ((select private.is_coach()));

create function public.record_class_attendance(
  p_seat_id uuid, p_status text, p_reason text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_seat public.class_seats%rowtype;
  v_starts_at timestamptz;
  v_old_status text;
  v_had_mark boolean;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_seat_id is null or p_status is null
      or p_status not in ('present', 'absent') then
    raise exception 'Choose an active seat and an attendance status'
      using errcode = '22023';
  end if;
  select * into v_seat from public.class_seats where id = p_seat_id for update;
  if not found or v_seat.cancelled_at is not null then
    raise exception 'Seat is missing or cancelled' using errcode = '22023';
  end if;
  select starts_at into v_starts_at from public.class_occurrences
    where id = v_seat.occurrence_id;
  if v_starts_at is null or v_starts_at > now() then
    raise exception 'Attendance can be marked only after class starts'
      using errcode = '55000';
  end if;
  select status into v_old_status from public.class_attendance
    where seat_id = p_seat_id for update;
  v_had_mark := found;
  if v_had_mark and v_old_status = p_status then
    return p_seat_id;
  end if;
  if v_had_mark and (v_reason is null or length(v_reason) not between 3 and 500) then
    raise exception 'A correction reason of 3 to 500 characters is required'
      using errcode = '22023';
  end if;
  if not v_had_mark and v_reason is not null then
    raise exception 'A reason is only needed when correcting attendance'
      using errcode = '22023';
  end if;

  insert into public.class_attendance (seat_id, status, marked_by)
    values (p_seat_id, p_status, v_actor)
    on conflict (seat_id) do update set
      status = excluded.status,
      marked_by = excluded.marked_by,
      marked_at = now();
  insert into public.class_attendance_audit
    (seat_id, old_status, new_status, reason, changed_by)
    values (p_seat_id, v_old_status, p_status, v_reason, v_actor);
  return p_seat_id;
end;
$$;
revoke all on function public.record_class_attendance(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.record_class_attendance(uuid, text, text)
  to authenticated;
