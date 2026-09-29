-- Apply after migrations/0001_family_group_foundation.sql, as the migration owner.
-- This schema must NOT be added to Supabase's exposed Data API schemas.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated;

create function private.is_coach()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coach_users c where c.user_id = (select auth.uid())
  );
$$;

create function private.can_read_family(p_family_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.family_guardians g
    where g.family_id = p_family_id and g.user_id = (select auth.uid())
  );
$$;

create function private.can_read_group(p_group_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_enrollments e
    join public.athletes a on a.id = e.athlete_id
    join public.family_guardians g on g.family_id = a.family_id
    where e.group_id = p_group_id and g.user_id = (select auth.uid())
  );
$$;

revoke all on function private.is_coach(), private.can_read_family(uuid),
  private.can_read_group(uuid) from public, anon;
grant execute on function private.is_coach(), private.can_read_family(uuid),
  private.can_read_group(uuid) to authenticated;

create policy coach_users_read on public.coach_users for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_coach()));
-- No client write policy on coach_users. Grant/revoke coach status administratively.

create policy families_read on public.families for select to authenticated
  using ((select private.is_coach()) or private.can_read_family(id));
create policy guardians_read on public.family_guardians for select to authenticated
  using ((select private.is_coach()) or user_id = (select auth.uid()));
create policy athletes_read on public.athletes for select to authenticated
  using ((select private.is_coach()) or private.can_read_family(family_id));
create policy groups_read on public.skill_groups for select to authenticated
  using ((select private.is_coach()) or private.can_read_group(id));
create policy enrollments_read on public.group_enrollments for select to authenticated
  using ((select private.is_coach()) or exists (
    select 1 from public.athletes a
    where a.id = athlete_id and private.can_read_family(a.family_id)
  ));

create policy families_coach_insert on public.families for insert to authenticated
  with check ((select private.is_coach()));
create policy families_coach_update on public.families for update to authenticated
  using ((select private.is_coach())) with check ((select private.is_coach()));

create policy guardians_coach_insert on public.family_guardians for insert to authenticated
  with check ((select private.is_coach()));
create policy guardians_coach_update on public.family_guardians for update to authenticated
  using ((select private.is_coach())) with check ((select private.is_coach()));
create policy guardians_coach_delete on public.family_guardians for delete to authenticated
  using ((select private.is_coach()));

create policy athletes_coach_insert on public.athletes for insert to authenticated
  with check ((select private.is_coach()));
create policy athletes_coach_update on public.athletes for update to authenticated
  using ((select private.is_coach())) with check ((select private.is_coach()));

create policy groups_coach_insert on public.skill_groups for insert to authenticated
  with check ((select private.is_coach()));
create policy groups_coach_update on public.skill_groups for update to authenticated
  using ((select private.is_coach())) with check ((select private.is_coach()));

create policy enrollments_coach_insert on public.group_enrollments for insert to authenticated
  with check ((select private.is_coach()));
create policy enrollments_coach_update on public.group_enrollments for update to authenticated
  using ((select private.is_coach())) with check ((select private.is_coach()));
