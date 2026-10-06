-- Run as one query in Supabase SQL Editor after the migration. All rows roll back.
-- No parent email, makeup credit, or payment action is sent.
begin;
do $test$
declare
  v_actor uuid := 'a12fe76a-c6d6-4666-9ed3-8c49c6b44c49';
  v_family uuid;
  v_other_family uuid;
  v_athlete uuid;
  v_other uuid;
  v_replacement uuid;
  v_location uuid;
  v_slot uuid;
  v_occurrence uuid;
  v_seat uuid;
  v_other_seat uuid;
  v_assignment uuid;
begin
  if not exists (select 1 from auth.users where id = v_actor) then
    raise exception 'Test Auth user missing';
  end if;
  if has_table_privilege('authenticated', 'public.parent_class_cancellations',
       'SELECT,INSERT,UPDATE,DELETE')
     or has_function_privilege('anon', 'public.cancel_my_class_seat(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_my_cancellable_sessions()', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_my_parent_cancellations()', 'EXECUTE') then
    raise exception 'Unexpected browser or anonymous cancellation access';
  end if;
  insert into public.coach_users(user_id) values (v_actor)
    on conflict (user_id) do nothing;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.families(display_name) values ('Rollback cancellation one')
    returning id into v_family;
  insert into public.families(display_name) values ('Rollback cancellation two')
    returning id into v_other_family;
  insert into public.athletes(family_id,display_name)
    values (v_family,'Rollback regular athlete') returning id into v_athlete;
  insert into public.athletes(family_id,display_name)
    values (v_other_family,'Rollback other athlete') returning id into v_other;
  insert into public.athletes(family_id,display_name)
    values (v_family,'Rollback replacement athlete') returning id into v_replacement;
  insert into public.class_locations(display_name,time_zone)
    values ('Rollback cancellation venue','America/Chicago') returning id into v_location;
  insert into public.standing_class_slots
    (group_id,location_id,iso_weekday,local_start_time,duration_minutes,
     capacity,active_from,class_kind)
    values (null,null,1,time '18:00',60,2,date '2028-01-03','intro')
    returning id into v_slot;
  v_assignment := public.add_regular_class_athlete(v_slot,v_athlete,date '2028-01-03');
  insert into public.class_occurrences
    (standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
    values (v_slot,date '2028-01-03','2028-01-04 00:00+00',
            '2028-01-04 01:00+00',2,v_location)
    returning id into v_occurrence;
  v_other_seat := public.confirm_coach_drop_in(v_occurrence,v_other);
  select id into v_seat from public.class_seats
    where occurrence_id = v_occurrence and athlete_id = v_athlete
      and cancelled_at is null;
  insert into public.family_guardians(family_id,user_id) values (v_family,v_actor);

  begin
    perform public.cancel_my_class_seat(v_other_seat);
    raise exception 'Cross-family cancellation was allowed';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.list_my_cancellable_sessions()
      where occurrence_id = v_occurrence) <> 1 then
    raise exception 'Family-only upcoming seats leaked or disappeared';
  end if;
  if public.cancel_my_class_seat(v_seat) <> v_seat
     or public.cancel_my_class_seat(v_seat) <> v_seat then
    raise exception 'Cancellation or idempotent retry failed';
  end if;
  if (select count(*) from public.parent_class_cancellations
      where seat_id = v_seat and cancelled_by = v_actor) <> 1
     or not exists (select 1 from public.class_seats
      where id = v_seat and cancelled_by = v_actor and cancelled_at is not null)
     or not exists (select 1 from public.regular_class_assignments
      where id = v_assignment and ends_on is null) then
    raise exception 'Audit row, seat history, or weekly assignment was lost';
  end if;
  if (select count(*) from public.list_coach_parent_cancellations()
      where seat_id = v_seat) <> 1 then
    raise exception 'Coach cannot see parent cancellation';
  end if;
  if (select count(*) from public.list_my_parent_cancellations()
      where seat_id = v_seat) <> 1 then
    raise exception 'Guardian cannot see cancellation history';
  end if;
  perform public.confirm_coach_drop_in(v_occurrence,v_replacement);
  if (select count(*) from public.class_seats
      where occurrence_id = v_occurrence and cancelled_at is null) <> 2 then
    raise exception 'Cancelled dated place was not freed';
  end if;
  delete from public.family_guardians where family_id = v_family and user_id = v_actor;
  if exists (select 1 from public.list_my_cancellable_sessions()
       where occurrence_id = v_occurrence) then
    raise exception 'Revoked guardian still sees sessions';
  end if;
  if exists (select 1 from public.list_my_parent_cancellations()
       where seat_id = v_seat) then
    raise exception 'Revoked guardian still sees cancellation history';
  end if;
  begin
    perform public.cancel_my_class_seat(v_seat);
    raise exception 'Revoked guardian can repeat a cancellation';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: isolation, revocation, one-time audit, idempotency, capacity and regular assignment; rolled back';
end
$test$;
rollback;
