-- Run as one script in Supabase SQL Editor after the class-seats migration.
-- Synthetic family, athletes, class and seats all roll back. Sends no messages.
begin;
do $test$
declare
  v_actor uuid := 'a12fe76a-c6d6-4666-9ed3-8c49c6b44c49';
  v_location uuid;
  v_slot uuid;
  v_family uuid;
  v_one uuid;
  v_two uuid;
  v_three uuid;
  v_occurrence uuid;
  v_seat uuid;
begin
  if not exists (select 1 from auth.users where id = v_actor) then
    raise exception 'Test Auth user missing; use a verified test user id';
  end if;
  if has_table_privilege('authenticated', 'public.class_seats', 'INSERT')
     or has_table_privilege('authenticated', 'public.regular_class_assignments', 'INSERT')
     or has_function_privilege('anon', 'public.confirm_coach_drop_in(uuid,uuid)', 'EXECUTE') then
    raise exception 'Browser or anonymous role has unexpected booking access';
  end if;
  insert into public.coach_users(user_id) values (v_actor)
    on conflict (user_id) do nothing;
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  insert into public.class_locations(display_name,time_zone)
    values ('Rollback class seat venue','America/Chicago') returning id into v_location;
  insert into public.standing_class_slots
    (group_id, location_id, iso_weekday, local_start_time, duration_minutes,
     capacity, active_from, class_kind)
    values (null, null, 1, time '18:00', 60, 2, date '2028-01-03', 'intro')
    returning id into v_slot;
  insert into public.families(display_name)
    values ('Rollback class seat account') returning id into v_family;
  insert into public.athletes(family_id,display_name)
    values (v_family,'Rollback athlete one') returning id into v_one;
  insert into public.athletes(family_id,display_name)
    values (v_family,'Rollback athlete two') returning id into v_two;
  insert into public.athletes(family_id,display_name)
    values (v_family,'Rollback athlete three') returning id into v_three;

  perform public.add_regular_class_athlete(v_slot,v_one,date '2028-01-03');
  insert into public.class_occurrences
    (standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
    values (v_slot,date '2028-01-03','2028-01-04 00:00+00',
            '2028-01-04 01:00+00',2,v_location)
    returning id into v_occurrence;
  if (select count(*) from public.class_seats
      where occurrence_id = v_occurrence and cancelled_at is null) <> 1 then
    raise exception 'Existing regular assignment did not reserve a dated seat';
  end if;
  perform public.add_regular_class_athlete(v_slot,v_two,date '2028-01-03');
  if (select count(*) from public.class_seats
      where occurrence_id = v_occurrence and cancelled_at is null) <> 2 then
    raise exception 'Later regular assignment did not fill the remaining place';
  end if;
  begin
    perform public.confirm_coach_drop_in(v_occurrence,v_three);
    raise exception 'Overcapacity drop-in was allowed';
  exception when check_violation then null;
  end;
  begin
    perform public.add_regular_class_athlete(v_slot,v_three,date '2028-01-03');
    raise exception 'Overcapacity regular assignment was allowed';
  exception when check_violation then null;
  end;
  select id into v_seat from public.class_seats
    where occurrence_id = v_occurrence and athlete_id = v_two
      and cancelled_at is null;
  perform public.cancel_coach_class_seat(v_seat);
  perform public.confirm_coach_drop_in(v_occurrence,v_three);
  if (select count(*) from public.class_seats
      where occurrence_id = v_occurrence and cancelled_at is null) <> 2
      or (select count(*) from public.class_seats
          where occurrence_id = v_occurrence and cancelled_at is not null) <> 1 then
    raise exception 'Cancellation or rebooking did not preserve the capacity and history';
  end if;
  raise notice 'PASS: regular reservation, late assignment, cap, cancellation and replacement; rolled back';
end
$test$;
rollback;
