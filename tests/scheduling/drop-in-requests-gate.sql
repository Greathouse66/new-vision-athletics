-- Run as one query in Supabase SQL Editor after the migration. No emails.
-- All synthetic data and the temporary coach role roll back.
begin;
do $test$
declare
  v_actor uuid := 'a12fe76a-c6d6-4666-9ed3-8c49c6b44c49';
  v_one uuid;
  v_two uuid;
  v_first uuid;
  v_second uuid;
  v_other uuid;
  v_location uuid;
  v_slot uuid;
  v_occurrence uuid;
  v_request_one uuid;
  v_request_two uuid;
  v_seat uuid;
begin
  if not exists (select 1 from auth.users where id = v_actor) then
    raise exception 'Test Auth user missing';
  end if;
  if has_table_privilege('authenticated', 'public.drop_in_requests', 'SELECT,INSERT,UPDATE,DELETE')
     or has_function_privilege('anon', 'public.request_drop_in(uuid,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.list_open_drop_in_classes()', 'EXECUTE') then
    raise exception 'Browser role has unexpected request access';
  end if;
  insert into public.families(display_name) values ('Rollback drop-in one') returning id into v_one;
  insert into public.families(display_name) values ('Rollback drop-in two') returning id into v_two;
  insert into public.athletes(family_id,display_name)
    values (v_one,'Rollback athlete one') returning id into v_first;
  insert into public.athletes(family_id,display_name)
    values (v_one,'Rollback athlete two') returning id into v_second;
  insert into public.athletes(family_id,display_name)
    values (v_two,'Rollback other athlete') returning id into v_other;
  insert into public.class_locations(display_name,time_zone)
    values ('Rollback drop-in venue','America/Chicago') returning id into v_location;
  insert into public.standing_class_slots
    (group_id,location_id,iso_weekday,local_start_time,duration_minutes,
     capacity,active_from,class_kind)
    values (null,null,4,time '18:00',60,1,date '2028-01-06','intro')
    returning id into v_slot;
  insert into public.class_occurrences
    (standing_slot_id,class_date,starts_at,ends_at,capacity,location_id)
    values (v_slot,date '2028-01-06','2028-01-07 00:00+00',
            '2028-01-07 01:00+00',1,v_location)
    returning id into v_occurrence;
  insert into public.family_guardians(family_id,user_id) values (v_one,v_actor);
  perform set_config('request.jwt.claim.sub',v_actor::text,true);

  begin
    perform public.request_drop_in(v_other,v_occurrence);
    raise exception 'Cross-family drop-in was accepted';
  exception when insufficient_privilege then null;
  end;
  v_request_one := public.request_drop_in(v_first,v_occurrence);
  if public.request_drop_in(v_first,v_occurrence) <> v_request_one then
    raise exception 'Duplicate pending request was created';
  end if;
  v_request_two := public.request_drop_in(v_second,v_occurrence);
  if (select count(*) from public.list_my_drop_in_requests()
       where request_id in (v_request_one,v_request_two)) <> 2 then
    raise exception 'Guardian could not see their requests';
  end if;
  delete from public.family_guardians where family_id = v_one and user_id = v_actor;
  if exists (select 1 from public.list_my_drop_in_requests()
             where request_id in (v_request_one,v_request_two)) then
    raise exception 'Revoked guardian still sees requests';
  end if;
  begin
    perform public.request_drop_in(v_first,v_occurrence);
    raise exception 'Revoked guardian submitted a request';
  exception when insufficient_privilege then null;
  end;

  insert into public.family_guardians(family_id,user_id) values (v_one,v_actor);
  insert into public.coach_users(user_id) values (v_actor) on conflict (user_id) do nothing;
  v_seat := public.review_drop_in_request(v_request_one,true);
  if not exists (select 1 from public.class_seats b
    where b.id = v_seat and b.athlete_id = v_first and b.cancelled_at is null)
     or not exists (select 1 from public.drop_in_requests r
       where r.id = v_request_one and r.status = 'approved' and r.seat_id = v_seat) then
    raise exception 'Approval did not reserve exactly one seat';
  end if;
  begin
    perform public.review_drop_in_request(v_request_two,true);
    raise exception 'Overcapacity approval was allowed';
  exception when check_violation then null;
  end;
  perform public.review_drop_in_request(v_request_two,false);
  if not exists (select 1 from public.drop_in_requests r
                 where r.id = v_request_two and r.status = 'declined') then
    raise exception 'Decline was not recorded';
  end if;
  begin
    perform public.request_drop_in(v_second,v_occurrence);
    raise exception 'Declined request was resubmitted';
  exception when object_not_in_prerequisite_state then null;
  end;
  raise notice 'PASS: family isolation, revocation, idempotency, coach approval, capacity and decline; rolled back';
end
$test$;
rollback;
