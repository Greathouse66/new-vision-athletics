-- Synthetic parent isolation and revocation test; runs entirely in one
-- transaction and rolls back. Requires the existing test Auth user.
begin;
do $test$
declare
  v_actor uuid := 'a12fe76a-c6d6-4666-9ed3-8c49c6b44c49';
  v_location uuid;
  v_slot uuid;
  v_occurrence uuid;
  v_family_one uuid;
  v_family_two uuid;
  v_athlete_one uuid;
  v_athlete_two uuid;
begin
  if not exists (select 1 from auth.users where id = v_actor) then
    raise exception 'Test Auth user missing';
  end if;
  if has_function_privilege('anon', 'public.list_my_upcoming_sessions()', 'EXECUTE') then
    raise exception 'Anonymous user can execute private parent summary';
  end if;
  insert into public.families(display_name) values ('Rollback session account one')
    returning id into v_family_one;
  insert into public.families(display_name) values ('Rollback session account two')
    returning id into v_family_two;
  insert into public.athletes(family_id,display_name)
    values (v_family_one,'Rollback session athlete one') returning id into v_athlete_one;
  insert into public.athletes(family_id,display_name)
    values (v_family_two,'Rollback session athlete two') returning id into v_athlete_two;
  insert into public.class_locations(display_name,time_zone)
    values ('Rollback session venue','America/Chicago') returning id into v_location;
  insert into public.standing_class_slots
    (group_id, location_id, iso_weekday, local_start_time, duration_minutes,
     capacity, active_from, class_kind)
    values (null, null, 1, time '18:00', 60, 2, date '2028-01-03', 'intro')
    returning id into v_slot;
  insert into public.class_occurrences
    (standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
    values (v_slot,date '2028-01-03','2028-01-04 00:00+00',
            '2028-01-04 01:00+00',2,v_location)
    returning id into v_occurrence;
  insert into public.class_seats(occurrence_id,athlete_id,seat_kind)
    values (v_occurrence,v_athlete_one,'drop_in'),
           (v_occurrence,v_athlete_two,'drop_in');
  insert into public.family_guardians(family_id,user_id)
    values (v_family_one,v_actor);
  perform set_config('request.jwt.claim.sub', v_actor::text, true);
  if (select count(*) from public.list_my_upcoming_sessions()
      where occurrence_id = v_occurrence) <> 1
     or not exists (select 1 from public.list_my_upcoming_sessions()
                    where athlete_id = v_athlete_one and occurrence_id = v_occurrence)
     or exists (select 1 from public.list_my_upcoming_sessions()
                where athlete_id = v_athlete_two and occurrence_id = v_occurrence) then
    raise exception 'Parent session list leaked another account or hid its own seat';
  end if;
  delete from public.family_guardians where family_id = v_family_one and user_id = v_actor;
  if exists (select 1 from public.list_my_upcoming_sessions()
             where occurrence_id = v_occurrence) then
    raise exception 'Revoked guardian still sees a session';
  end if;
  raise notice 'PASS: parent session isolation and revocation; test data rolled back';
end
$test$;
rollback;
