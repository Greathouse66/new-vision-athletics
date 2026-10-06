-- Reserve email sends atomically; granting family access still requires acceptance.
create table private.guardian_invitation_deliveries (
  email text primary key,
  invitation_id uuid not null references public.guardian_invitations(id) on delete cascade,
  attempt_id uuid not null unique,
  attempted_at timestamptz not null,
  completed_at timestamptz,
  outcome text not null check (outcome in ('sending', 'sent', 'failed'))
);
alter table private.guardian_invitation_deliveries enable row level security;
revoke all on private.guardian_invitation_deliveries from public, anon, authenticated;

create function public.reserve_guardian_invitation_email(p_family_id uuid, p_email text)
returns table(invitation_id uuid, attempt_id uuid, email text)
language plpgsql security definer set search_path = '' as $$
declare
  v_email text := lower(btrim(p_email));
  v_invitation uuid;
  v_attempt uuid := gen_random_uuid();
begin
  if auth.uid() is null or not private.is_coach() then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if v_email is null or length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Invalid email';
  end if;
  -- One send per email across all families; concurrent clicks cannot both send.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 0));
  if exists (select 1 from public.family_guardians g
    join auth.users u on u.id = g.user_id
    where g.family_id = p_family_id and lower(u.email) = v_email) then
    raise exception 'This email already has family access';
  end if;
  if exists (select 1 from private.guardian_invitation_deliveries d
    where d.email = v_email and d.outcome = 'sending'
      and d.attempted_at > now() - interval '5 minutes') then
    raise exception 'Invitation email is still being sent' using errcode = 'P0001';
  end if;
  if exists (select 1 from private.guardian_invitation_deliveries d
    where d.email = v_email and d.attempted_at > now() - interval '2 minutes') then
    raise exception 'Please wait before resending' using errcode = 'P0001';
  end if;
  select i.id into v_invitation from public.guardian_invitations i
    where i.family_id = p_family_id and i.email = v_email
      and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    for update;
  if v_invitation is null then
    v_invitation := public.create_guardian_invitation(p_family_id, v_email);
  end if;
  insert into private.guardian_invitation_deliveries
    (email, invitation_id, attempt_id, attempted_at, outcome)
    values (v_email, v_invitation, v_attempt, now(), 'sending')
    on conflict on constraint guardian_invitation_deliveries_pkey do update
      set invitation_id = excluded.invitation_id, attempt_id = excluded.attempt_id,
          attempted_at = excluded.attempted_at, completed_at = null, outcome = 'sending';
  return query select v_invitation, v_attempt, v_email;
end;
$$;

-- Only the server may record success. The attempt ID protects against late responses.
create function public.finish_guardian_invitation_email(p_attempt_id uuid, p_sent boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update private.guardian_invitation_deliveries
    set outcome = case when p_sent then 'sent' else 'failed' end, completed_at = now()
    where attempt_id = p_attempt_id and outcome = 'sending';
end;
$$;
revoke all on function public.reserve_guardian_invitation_email(uuid, text)
  from public, anon, service_role;
grant execute on function public.reserve_guardian_invitation_email(uuid, text) to authenticated;
revoke all on function public.finish_guardian_invitation_email(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.finish_guardian_invitation_email(uuid, boolean) to service_role;
