-- Known venue labels for coach selection. No weeks, classes or athletes are created.
insert into public.class_locations (display_name, time_zone)
select 'Minot Armory', 'America/Chicago'
where not exists (
  select 1 from public.class_locations
  where lower(btrim(display_name)) = 'minot armory'
);
insert into public.class_locations (display_name, time_zone)
select 'Minot YMCA', 'America/Chicago'
where not exists (
  select 1 from public.class_locations
  where lower(btrim(display_name)) = 'minot ymca'
);
