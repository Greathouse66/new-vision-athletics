-- One coach-approved receipt email per parent account. Receipt delivery does
-- not grant portal access; guardian membership is still reviewed separately.
create table public.family_billing_contacts (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  email text not null check (
    email = lower(btrim(email)) and length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  ),
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  check ((revoked_at is null) = (revoked_by is null))
);
create unique index family_billing_contacts_one_active
  on public.family_billing_contacts(family_id) where revoked_at is null;
create index family_billing_contacts_history
  on public.family_billing_contacts(family_id, approved_at desc);

alter table public.family_billing_contacts enable row level security;
revoke all on public.family_billing_contacts from public, anon, authenticated;
grant select on public.family_billing_contacts to authenticated;
create policy family_billing_contacts_coach_read on public.family_billing_contacts
  for select to authenticated using ((select private.is_coach()));

create function public.set_family_billing_contact(p_family_id uuid, p_email text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email));
  v_current public.family_billing_contacts%rowtype;
  v_id uuid;
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  if p_family_id is null or v_email is null
     or pg_catalog.length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'Valid account and receipt email required' using errcode = '22023';
  end if;
  -- Serialize two coaches changing the same account's contact.
  perform 1 from public.families where id = p_family_id for update;
  if not found then
    raise exception 'Parent account not found' using errcode = '22023';
  end if;
  select * into v_current from public.family_billing_contacts
    where family_id = p_family_id and revoked_at is null for update;
  if found then
    if v_current.email = v_email then return v_current.id; end if;
    update public.family_billing_contacts
      set revoked_at = now(), revoked_by = v_actor where id = v_current.id;
  end if;
  insert into public.family_billing_contacts(family_id, email, approved_by)
    values (p_family_id, v_email, v_actor) returning id into v_id;
  return v_id;
end;
$$;

create function public.remove_family_billing_contact(p_family_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode = '42501';
  end if;
  perform 1 from public.families where id = p_family_id for update;
  if not found then
    raise exception 'Parent account not found' using errcode = '22023';
  end if;
  update public.family_billing_contacts
    set revoked_at = now(), revoked_by = auth.uid()
    where family_id = p_family_id and revoked_at is null;
  if not found then
    raise exception 'No active receipt email for this account' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.set_family_billing_contact(uuid, text),
  public.remove_family_billing_contact(uuid) from public, anon, authenticated;
grant execute on function public.set_family_billing_contact(uuid, text),
  public.remove_family_billing_contact(uuid) to authenticated;

-- Capture the contact approved at payment confirmation. A missing contact
-- stays null for manual review; a later contact must not inherit old receipts.
alter table private.payment_receipt_outbox
  add column billing_contact_id uuid references public.family_billing_contacts(id);

create or replace function private.enqueue_payment_receipt()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_contact_id uuid;
begin
  select id into v_contact_id from public.family_billing_contacts
    where family_id = new.family_id and revoked_at is null;
  insert into private.payment_receipt_outbox(payment_id, billing_contact_id)
    values (new.id, v_contact_id);
  return new;
end;
$$;
