-- Per-athlete, versioned electronic waivers. No signature data is public.
create table public.waiver_versions (
  id uuid primary key default gen_random_uuid(),
  version_label text not null unique,
  company_name text not null,
  title text not null,
  body text not null,
  acknowledgment text not null,
  electronic_consent text not null,
  is_current boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index one_current_waiver_version on public.waiver_versions(is_current) where is_current;
alter table public.waiver_versions enable row level security;
revoke all on public.waiver_versions from public, anon, authenticated;
grant select on public.waiver_versions to authenticated;
create policy waiver_versions_read on public.waiver_versions for select to authenticated
  using ((select private.is_coach()) or exists (
    select 1 from public.family_guardians fg where fg.user_id = (select auth.uid())
  ));

insert into public.waiver_versions(version_label,company_name,title,body,acknowledgment,electronic_consent,is_current)
values ('2026-10-18-v1','Newvision Athletic Training LLC',
'Youth Basketball Training Liability Waiver and Release Form',
$body$WAIVER AND RELEASE OF LIABILITY

In consideration of being allowed to participate in any way in the basketball training programs, events, and activities of Newvision Athletic Training LLC ("the Company"), the undersigned acknowledges, appreciates, and agrees to the following:

1. Assumption of Risk

I understand that participation in basketball training involves physical activity and may result in injury, including but not limited to sprains, fractures, heat-related injuries, and other serious conditions. I knowingly and freely assume all such risks, both known and unknown.

2. Release and Waiver

I hereby release, waive, discharge, and hold harmless Newvision Athletic Training LLC, its owners, trainers, employees, volunteers, and agents from any and all liability, claims, demands, actions, or causes of action related to any loss, damage, or injury that may be sustained by the participant, whether caused by the negligence of the Company or otherwise, while participating in any activity or while on the premises.

3. Medical Treatment

I authorize the Company to obtain emergency medical treatment for the participant if necessary and agree to be responsible for any resulting medical costs.

4. Indemnification

I agree to indemnify and hold harmless the Company from any loss, liability, damage, or cost they may incur due to the participation of the participant.$body$,
$ack$I certify that I have read this waiver, fully understand its terms, and sign it freely and voluntarily. If the participant is under 18, I certify that I am the parent or legal guardian and have the legal authority to sign on behalf of the minor.$ack$,
$consent$I agree to use an electronic record and signature for this waiver. By typing my full name and submitting, I intend to sign this waiver electronically. I can retain a copy using Print / Save PDF.$consent$,true);

create table public.athlete_waiver_signatures (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id),
  waiver_version_id uuid not null references public.waiver_versions(id),
  participant_name text not null,
  date_of_birth date not null,
  guardian_name text not null,
  emergency_contact text not null,
  emergency_phone text not null,
  signature_name text not null,
  signed_by uuid not null,
  signer_email text not null,
  signed_at timestamptz not null default now(),
  acknowledgment_accepted boolean not null check (acknowledgment_accepted),
  electronic_consent_accepted boolean not null check (electronic_consent_accepted),
  document jsonb not null,
  document_sha256 text not null,
  unique(athlete_id,waiver_version_id)
);
create index athlete_waivers_recent on public.athlete_waiver_signatures(athlete_id,signed_at desc);
alter table public.athlete_waiver_signatures enable row level security;
revoke all on public.athlete_waiver_signatures from public, anon, authenticated;
grant select on public.athlete_waiver_signatures to authenticated;
create policy athlete_waivers_read on public.athlete_waiver_signatures for select to authenticated
  using ((select private.is_coach()) or exists (
    select 1 from public.athletes a where a.id = athlete_id and private.can_read_family(a.family_id)
  ));

-- Preserve the exact signed document and evidence; corrections require a new version.
create function private.keep_waiver_signature() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'Signed waivers cannot be edited or deleted' using errcode = '55000';
end;
$$;
create trigger keep_waiver_signature before update or delete on public.athlete_waiver_signatures
  for each row execute function private.keep_waiver_signature();
create function private.keep_waiver_wording() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.version_label is distinct from old.version_label
     or new.company_name is distinct from old.company_name or new.title is distinct from old.title
     or new.body is distinct from old.body or new.acknowledgment is distinct from old.acknowledgment
     or new.electronic_consent is distinct from old.electronic_consent
     or new.created_at is distinct from old.created_at then
    raise exception 'Publish a new waiver version instead of editing wording' using errcode = '55000';
  end if;
  return new;
end;
$$;
create trigger keep_waiver_wording before update on public.waiver_versions
  for each row execute function private.keep_waiver_wording();
revoke all on function private.keep_waiver_signature(),private.keep_waiver_wording() from public, anon, authenticated;

create function public.sign_athlete_waiver(
  p_athlete_id uuid, p_waiver_version_id uuid, p_date_of_birth date,
  p_guardian_name text, p_emergency_contact text, p_emergency_phone text,
  p_signature_name text, p_acknowledgment_accepted boolean, p_electronic_consent_accepted boolean
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_email text;
  v_athlete public.athletes%rowtype;
  v_version public.waiver_versions%rowtype;
  v_existing public.athlete_waiver_signatures%rowtype;
  v_id uuid;
  v_guardian text := btrim(p_guardian_name);
  v_contact text := btrim(p_emergency_contact);
  v_phone text := btrim(p_emergency_phone);
  v_signature text := btrim(p_signature_name);
begin
  if v_actor is null then raise exception 'Verified parent sign-in required' using errcode = '42501'; end if;
  select u.email into v_email from auth.users u
    where u.id=v_actor and u.email_confirmed_at is not null and nullif(btrim(u.email),'') is not null for share;
  if not found then raise exception 'Verified parent sign-in required' using errcode = '42501'; end if;
  select * into v_athlete from public.athletes a where a.id=p_athlete_id for share;
  if not found then raise exception 'Linked athlete access required' using errcode = '42501'; end if;
  perform 1 from public.family_guardians fg where fg.family_id=v_athlete.family_id and fg.user_id=v_actor for share;
  if not found then raise exception 'Linked athlete access required' using errcode = '42501'; end if;
  select * into v_version from public.waiver_versions w where w.id=p_waiver_version_id and w.is_current for share;
  if not found then raise exception 'Waiver changed. Reload and read the current version.' using errcode = '40001'; end if;
  if p_date_of_birth is null or p_date_of_birth < date '1900-01-01'
     or p_date_of_birth > (now() at time zone 'America/Chicago')::date
     or v_guardian is null or length(v_guardian) not between 2 and 160
     or v_contact is null or length(v_contact) not between 2 and 160
     or v_phone is null or length(v_phone) not between 7 and 40
     or length(regexp_replace(v_phone,'[^0-9]','','g')) < 7
     or v_signature is null or length(v_signature) not between 2 and 160
     or lower(v_signature) <> lower(v_guardian)
     or p_acknowledgment_accepted is distinct from true
     or p_electronic_consent_accepted is distinct from true then
    raise exception 'Complete all fields, match the guardian signature, and accept both statements.' using errcode = '22023';
  end if;
  insert into public.athlete_waiver_signatures(
    athlete_id,waiver_version_id,participant_name,date_of_birth,guardian_name,emergency_contact,emergency_phone,
    signature_name,signed_by,signer_email,acknowledgment_accepted,electronic_consent_accepted,document,document_sha256
  ) values (
    v_athlete.id,v_version.id,v_athlete.display_name,p_date_of_birth,v_guardian,v_contact,v_phone,
    v_signature,v_actor,v_email,true,true,
    jsonb_build_object('version_label',v_version.version_label,'company_name',v_version.company_name,
      'title',v_version.title,'body',v_version.body,'acknowledgment',v_version.acknowledgment,
      'electronic_consent',v_version.electronic_consent),
    encode(sha256(convert_to(v_version.company_name||E'\n'||v_version.title||E'\n'||v_version.body||E'\n'||
      v_version.acknowledgment||E'\n'||v_version.electronic_consent,'UTF8')),'hex')
  ) on conflict(athlete_id,waiver_version_id) do nothing returning id into v_id;
  if v_id is not null then return v_id; end if;
  select * into v_existing from public.athlete_waiver_signatures s
    where s.athlete_id=v_athlete.id and s.waiver_version_id=v_version.id;
  if v_existing.signed_by=v_actor and v_existing.date_of_birth=p_date_of_birth
     and v_existing.guardian_name=v_guardian and v_existing.emergency_contact=v_contact
     and v_existing.emergency_phone=v_phone and v_existing.signature_name=v_signature then
    return v_existing.id;
  end if;
  raise exception 'This waiver is already completed. Reload to view the saved record.' using errcode = '55000';
end;
$$;

create function public.list_athlete_waiver_statuses()
returns table(athlete_id uuid,family_id uuid,athlete_name text,waiver_version_id uuid,
  waiver_status text,signature_id uuid,signed_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id,a.family_id,a.display_name,w.id,
    case when w.id is null then 'not_configured' when s.id is null then 'needs_signing' else 'completed' end,
    s.id,s.signed_at
  from public.athletes a
  left join public.waiver_versions w on w.is_current
  left join public.athlete_waiver_signatures s on s.athlete_id=a.id and s.waiver_version_id=w.id
  where (select auth.uid()) is not null and (
    (select private.is_coach()) or private.can_read_family(a.family_id)
  ) order by a.display_name,a.id;
$$;
revoke all on function public.sign_athlete_waiver(uuid,uuid,date,text,text,text,text,boolean,boolean),
  public.list_athlete_waiver_statuses() from public, anon, authenticated;
grant execute on function public.sign_athlete_waiver(uuid,uuid,date,text,text,text,text,boolean,boolean),
  public.list_athlete_waiver_statuses() to authenticated;
