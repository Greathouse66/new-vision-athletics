-- Coach-approved, email-bound guardian access. No email is sent by this migration.
-- Apply as the migration owner; security-definer functions rely on that owner.
create table public.guardian_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  email text not null check (
    email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  invited_by uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid,
  revoked_at timestamptz,
  revoked_by uuid,
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null)),
  check ((revoked_at is null) = (revoked_by is null)),
  check (accepted_at is null or revoked_at is null)
);
create unique index guardian_invitations_one_pending
  on public.guardian_invitations(family_id, email)
  where accepted_at is null and revoked_at is null;
create index guardian_invitations_email_pending
  on public.guardian_invitations(email, expires_at)
  where accepted_at is null and revoked_at is null;

create table public.guardian_access_events (
  id bigint generated always as identity primary key,
  family_id uuid not null,
  user_id uuid not null,
  actor_user_id uuid,
  action text not null check (action in ('granted', 'revoked')),
  created_at timestamptz not null default now()
);
create index guardian_access_events_family_id_idx
  on public.guardian_access_events(family_id, created_at desc);

alter table public.guardian_invitations enable row level security;
alter table public.guardian_access_events enable row level security;
revoke all on public.guardian_invitations, public.guardian_access_events
  from public, anon, authenticated;
grant select on public.guardian_invitations, public.guardian_access_events
  to authenticated;
create policy guardian_invitations_coach_read on public.guardian_invitations
  for select to authenticated using ((select private.is_coach()));
create policy guardian_access_events_coach_read on public.guardian_access_events
  for select to authenticated using ((select private.is_coach()));

-- Stop broad browser writes to membership; all future grants/revocations go
-- through the constrained functions below. The SQL migration owner can still
-- perform administrative corrections, which the trigger also records.
revoke insert, update, delete on public.family_guardians from authenticated;
drop policy guardians_coach_insert on public.family_guardians;
drop policy guardians_coach_update on public.family_guardians;
drop policy guardians_coach_delete on public.family_guardians;

create function private.audit_guardian_membership()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if (old.family_id, old.user_id) is distinct from (new.family_id, new.user_id) then
      insert into public.guardian_access_events
        (family_id, user_id, actor_user_id, action)
      values (old.family_id, old.user_id, auth.uid(), 'revoked'),
             (new.family_id, new.user_id, auth.uid(), 'granted');
    end if;
    return new;
  end if;
  insert into public.guardian_access_events
    (family_id, user_id, actor_user_id, action)
  values (
    case when tg_op = 'DELETE' then old.family_id else new.family_id end,
    case when tg_op = 'DELETE' then old.user_id else new.user_id end,
    auth.uid(),
    case when tg_op = 'DELETE' then 'revoked' else 'granted' end
  );
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.audit_guardian_membership() from public, anon, authenticated;
create trigger audit_guardian_membership
  after insert or update or delete on public.family_guardians
  for each row execute function private.audit_guardian_membership();

create function public.create_guardian_invitation(p_family_id uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_email text := lower(btrim(p_email));
  v_id uuid;
begin
  if v_actor is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if v_email is null or length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email';
  end if;
  if not exists (select 1 from public.families where id = p_family_id) then
    raise exception 'Family not found';
  end if;
  if exists (
    select 1 from public.family_guardians g
    join auth.users u on u.id = g.user_id
    where g.family_id = p_family_id and lower(u.email) = v_email
  ) then
    raise exception 'This email already has family access';
  end if;

  -- Clear expired pending rows before enforcing one live invitation per email.
  update public.guardian_invitations
     set revoked_at = now(), revoked_by = v_actor
   where family_id = p_family_id and email = v_email
     and accepted_at is null and revoked_at is null and expires_at <= now();
  if exists (
    select 1 from public.guardian_invitations
    where family_id = p_family_id and email = v_email
      and accepted_at is null and revoked_at is null
  ) then
    raise exception 'An invitation is already pending for this family and email';
  end if;

  insert into public.guardian_invitations
    (family_id, email, invited_by, expires_at)
  values (p_family_id, v_email, v_actor, now() + interval '7 days')
  returning id into v_id;
  return v_id;
end;
$$;

create function public.revoke_guardian_invitation(p_invitation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  update public.guardian_invitations
     set revoked_at = now(), revoked_by = auth.uid()
   where id = p_invitation_id and accepted_at is null and revoked_at is null;
  if not found then
    raise exception 'Pending invitation not found';
  end if;
end;
$$;

-- The browser cannot choose an email. Check the current, confirmed Auth user
-- from auth.users, rather than trusting user-editable metadata or JWT email.
create function public.list_my_guardian_invitations()
returns table(invitation_id uuid, family_display_name text, expires_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_email text;
begin
  select lower(u.email) into v_email from auth.users u
   where u.id = auth.uid() and u.email_confirmed_at is not null;
  if v_email is null then return; end if;
  return query
    select i.id, f.display_name, i.expires_at
      from public.guardian_invitations i
      join public.families f on f.id = i.family_id
     where i.email = v_email and i.accepted_at is null
       and i.revoked_at is null and i.expires_at > now()
     order by i.created_at;
end;
$$;

create function public.accept_guardian_invitation(p_invitation_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_email text;
  v_family_id uuid;
begin
  select lower(u.email) into v_email from auth.users u
   where u.id = v_actor and u.email_confirmed_at is not null;
  if v_email is null then
    raise exception 'Verified sign-in required' using errcode = '42501';
  end if;

  select i.family_id into v_family_id
    from public.guardian_invitations i
   where i.id = p_invitation_id and i.email = v_email
     and i.accepted_at is null and i.revoked_at is null
     and i.expires_at > now()
   for update;
  if v_family_id is null then
    raise exception 'Invitation unavailable';
  end if;

  insert into public.family_guardians(family_id, user_id)
  values (v_family_id, v_actor)
  on conflict (family_id, user_id) do nothing;
  update public.guardian_invitations
     set accepted_at = now(), accepted_by = v_actor
   where id = p_invitation_id;
  return v_family_id;
end;
$$;

create function public.list_family_guardians(p_family_id uuid)
returns table(user_id uuid, email text, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  return query
    select g.user_id, u.email, g.created_at
      from public.family_guardians g
      join auth.users u on u.id = g.user_id
     where g.family_id = p_family_id
     order by g.created_at;
end;
$$;

create function public.revoke_guardian_access(p_family_id uuid, p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  delete from public.family_guardians
   where family_id = p_family_id and user_id = p_user_id;
  if not found then
    raise exception 'Guardian access not found';
  end if;
end;
$$;

revoke all on function
  public.create_guardian_invitation(uuid, text),
  public.revoke_guardian_invitation(uuid),
  public.list_my_guardian_invitations(),
  public.accept_guardian_invitation(uuid),
  public.list_family_guardians(uuid),
  public.revoke_guardian_access(uuid, uuid)
  from public, anon;
grant execute on function
  public.create_guardian_invitation(uuid, text),
  public.revoke_guardian_invitation(uuid),
  public.list_my_guardian_invitations(),
  public.accept_guardian_invitation(uuid),
  public.list_family_guardians(uuid),
  public.revoke_guardian_access(uuid, uuid)
  to authenticated;
