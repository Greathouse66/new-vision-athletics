-- Return only active future seats for currently approved guardians. Raw
-- class_seats, class_occurrences, and location tables remain coach-readable.
create function public.list_my_upcoming_sessions()
returns table (
  family_id uuid,
  athlete_id uuid,
  athlete_name text,
  occurrence_id uuid,
  class_date date,
  starts_at timestamptz,
  ends_at timestamptz,
  class_label text,
  location_name text,
  time_zone text
) language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then
    raise exception 'Sign-in required' using errcode = '42501';
  end if;
  return query
    select a.family_id, a.id, a.display_name, o.id, o.class_date,
           o.starts_at, o.ends_at,
           case when s.class_kind = 'intro' then 'Intro'::text
                else g.name end,
           l.display_name, l.time_zone
      from public.class_seats b
      join public.athletes a on a.id = b.athlete_id
      join public.class_occurrences o on o.id = b.occurrence_id
      join public.standing_class_slots s on s.id = o.standing_slot_id
      left join public.skill_groups g on g.id = s.group_id
      join public.class_locations l on l.id = o.location_id
      where b.cancelled_at is null and o.starts_at >= now()
        and private.can_read_family(a.family_id)
      order by o.starts_at, o.id, a.id
      limit 201;
end;
$$;
revoke all on function public.list_my_upcoming_sessions()
  from public, anon, authenticated;
grant execute on function public.list_my_upcoming_sessions() to authenticated;
