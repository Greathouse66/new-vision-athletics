-- Paste the full script into Supabase SQL Editor after the migration.
-- Synthetic coach, athlete, class, seat and attendance roll back.
begin;
do $test$
declare
  v_actor uuid := 'a12fe76a-c6d6-4666-9ed3-8c49c6b44c49';
  v_location uuid;
  v_slot uuid;
  v_family uuid;
  v_athlete uuid;
  v_occurrence uuid;
  v_seat uuid;
  v_future_occurrence uuid;
  v_future_seat uuid;
begin
  if not exists (select 1 from auth.users where id = v_actor) then
    raise exception 'Test Auth user missing';
  end if;
  if has_table_privilege('authenticated', 'public.class_attendance', 'INSERT,UPDATE,DELETE')
     or has_table_privilege('authenticated', 'public.class_attendance_audit', 'INSERT,UPDATE,DELETE')
     or has_function_privilege('anon', 'public.record_class_attendance(uuid,text,text)', 'EXECUTE') then
    raise exception 'Browser or anonymous role has direct attendance write access';
  end if;
  insert into public.coach_users(user_id) values (v_actor)
    on conflict (user_id) do nothing;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.class_locations(display_name,time_zone)
    values ('Rollback attendance venue','America/Chicago') returning id into v_location;
  insert into public.standing_class_slots
    (group_id, location_id, iso_weekday, local_start_time, duration_minutes,
     capacity, active_from, class_kind)
    values (null, null, 4, time '18:00', 60, 2, date '2026-10-01', 'intro')
    returning id into v_slot;
  insert into public.families(display_name)
    values ('Rollback attendance account') returning id into v_family;
  insert into public.athletes(family_id,display_name)
    values (v_family,'Rollback attendance athlete') returning id into v_athlete;
  insert into public.class_occurrences
    (standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
    values (v_slot,date '2026-10-01','2026-10-01 23:00+00',
            '2026-10-02 00:00+00',2,v_location)
    returning id into v_occurrence;
  insert into public.class_seats(occurrence_id,athlete_id,seat_kind)
    values (v_occurrence,v_athlete,'drop_in') returning id into v_seat;

  perform set_config('request.jwt.claim.sub', gen_random_uuid()::text, true);
  begin
    perform public.record_class_attendance(v_seat,'present');
    raise exception 'Non-coach was allowed to mark attendance';
  exception when insufficient_privilege then null;
  end;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  insert into public.class_occurrences
    (standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
    values (v_slot,date '2028-01-06','2028-01-07 00:00+00',
            '2028-01-07 01:00+00',2,v_location)
    returning id into v_future_occurrence;
  insert into public.class_seats(occurrence_id,athlete_id,seat_kind)
    values (v_future_occurrence,v_athlete,'drop_in') returning id into v_future_seat;
  begin
    perform public.record_class_attendance(v_future_seat,'present');
    raise exception 'Future attendance was allowed';
  exception when object_not_in_prerequisite_state then null;
  end;

  perform public.record_class_attendance(v_seat,'present');
  perform public.record_class_attendance(v_seat,'present');
  if (select count(*) from public.class_attendance_audit where seat_id = v_seat) <> 1 then
    raise exception 'Identical retry created another attendance event';
  end if;
  begin
    perform public.record_class_attendance(v_seat,'absent');
    raise exception 'Correction without reason was allowed';
  exception when invalid_parameter_value then null;
  end;
  perform public.record_class_attendance(v_seat,'absent','Coach corrected the roster');
  if (select status from public.class_attendance where seat_id = v_seat) <> 'absent'
     or (select count(*) from public.class_attendance_audit where seat_id = v_seat) <> 2
     or not exists (select 1 from public.class_attendance_audit
                    where seat_id = v_seat and old_status = 'present'
                      and new_status = 'absent' and reason = 'Coach corrected the roster') then
    raise exception 'Correction or its audit record is missing';
  end if;
  perform public.cancel_coach_class_seat(v_seat);
  begin
    perform public.record_class_attendance(v_seat,'present','Incorrect cancellation');
    raise exception 'Cancelled seat was marked';
  exception when invalid_parameter_value then null;
  end;
  raise notice 'PASS: coach access, class start, idempotent retry, correction audit, cancelled-seat gate; rolled back';
end
$test$;
rollback;
