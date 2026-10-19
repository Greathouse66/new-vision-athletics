-- Coach cleanup for accidental records only. Installation deletes no records.
create table private.record_deletion_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  deleted_at timestamptz not null default now(),
  record_type text not null check (record_type in ('athlete','account')),
  snapshot jsonb not null
);
revoke all on private.record_deletion_events from public,anon,authenticated;
revoke all on sequence private.record_deletion_events_id_seq from public,anon,authenticated;

create function private.account_deletion_review(p_family_id uuid,p_athlete_id uuid)
returns jsonb language plpgsql set search_path = '' as $$
declare
  v_family public.families%rowtype;
  v_ids uuid[];
  v_athletes jsonb;
  v_enrollments jsonb;
  v_blockers text[]:=array[]::text[];
  v_snapshot jsonb;
begin
  select * into v_family from public.families where id=p_family_id;
  if not found then raise exception 'Account no longer exists. Reload the roster.' using errcode='40001'; end if;
  if p_athlete_id is not null and not exists(select 1 from public.athletes where id=p_athlete_id and family_id=p_family_id) then
    raise exception 'Athlete or account changed. Reload the roster.' using errcode='40001';
  end if;
  select coalesce(array_agg(a.id order by a.id),array[]::uuid[]),coalesce(jsonb_agg(to_jsonb(a) order by a.id),'[]'::jsonb)
    into v_ids,v_athletes from public.athletes a
    where a.family_id=p_family_id and (p_athlete_id is null or a.id=p_athlete_id);
  select coalesce(jsonb_agg(to_jsonb(g) order by g.id),'[]'::jsonb) into v_enrollments
    from public.group_enrollments g where g.athlete_id=any(v_ids);
  if exists(select 1 from public.athlete_monthly_charges where athlete_id=any(v_ids)) then v_blockers:=array_append(v_blockers,'Monthly charges or payment history'); end if;
  if exists(select 1 from public.regular_class_assignments where athlete_id=any(v_ids)) then v_blockers:=array_append(v_blockers,'Regular class assignments'); end if;
  if exists(select 1 from public.class_seats where athlete_id=any(v_ids)) then v_blockers:=array_append(v_blockers,'Class bookings, attendance or cancellation history'); end if;
  if exists(select 1 from public.drop_in_requests where athlete_id=any(v_ids)) then v_blockers:=array_append(v_blockers,'Drop-in request history'); end if;
  if exists(select 1 from public.progress_reports where athlete_id=any(v_ids)) then v_blockers:=array_append(v_blockers,'Progress reports, including drafts'); end if;
  if exists(select 1 from public.athlete_waiver_signatures where athlete_id=any(v_ids)) then v_blockers:=array_append(v_blockers,'Signed waivers'); end if;
  if p_athlete_id is null then
    if exists(select 1 from public.family_guardians where family_id=p_family_id) then v_blockers:=array_append(v_blockers,'Linked parent access'); end if;
    if exists(select 1 from public.guardian_invitations where family_id=p_family_id) then v_blockers:=array_append(v_blockers,'Parent invitations, including expired or revoked invitations'); end if;
    if exists(select 1 from public.guardian_access_events where family_id=p_family_id) then v_blockers:=array_append(v_blockers,'Parent access history'); end if;
    if exists(select 1 from public.family_billing_contacts where family_id=p_family_id) then v_blockers:=array_append(v_blockers,'Billing contact history'); end if;
    if exists(select 1 from public.payment_receipts where family_id=p_family_id) then v_blockers:=array_append(v_blockers,'Payment receipts'); end if;
    if exists(select 1 from public.athlete_monthly_charges where family_id=p_family_id) and not ('Monthly charges or payment history'=any(v_blockers)) then
      v_blockers:=array_append(v_blockers,'Monthly charges or payment history');
    end if;
  end if;
  v_snapshot:=jsonb_build_object('record_type',case when p_athlete_id is null then 'account' else 'athlete' end,
    'family',to_jsonb(v_family),'athlete_id',p_athlete_id,'athletes',v_athletes,'group_enrollments',v_enrollments,'blockers',to_jsonb(v_blockers));
  return v_snapshot||jsonb_build_object('can_delete',cardinality(v_blockers)=0,
    'confirmation_name',case when p_athlete_id is null then v_family.display_name else v_athletes->0->>'display_name' end,
    'review_token',encode(sha256(convert_to(v_snapshot::text,'UTF8')),'hex'));
end;
$$;
revoke all on function private.account_deletion_review(uuid,uuid) from public,anon,authenticated;

create function public.review_unused_account_deletion(p_family_id uuid,p_athlete_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  return private.account_deletion_review(p_family_id,p_athlete_id);
end;
$$;

create function public.delete_unused_account_record(
  p_family_id uuid,p_athlete_id uuid,p_review_token text,p_confirmation_name text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_review jsonb;
  v_ids uuid[];
  v_actor uuid:=(select auth.uid());
begin
  if v_actor is null or not (select private.is_coach()) then
    raise exception 'Coach access required' using errcode='42501';
  end if;
  -- Parent/athlete row locks also block new FK-linked records during the check
  -- and removal. Re-read all dependencies after acquiring the locks.
  perform 1 from public.families where id=p_family_id for update;
  if not found then raise exception 'Account no longer exists. Reload the roster.' using errcode='40001'; end if;
  perform 1 from public.athletes where family_id=p_family_id order by id for update;
  v_review:=private.account_deletion_review(p_family_id,p_athlete_id);
  if p_review_token is null or p_review_token is distinct from v_review->>'review_token' then
    raise exception 'This record changed since review. Reload and review deletion again.' using errcode='40001';
  end if;
  if not (v_review->>'can_delete')::boolean then
    raise exception 'Deletion blocked: %', (select string_agg(value,'; ') from jsonb_array_elements_text(v_review->'blockers')) using errcode='55000';
  end if;
  if p_confirmation_name is null or p_confirmation_name is distinct from v_review->>'confirmation_name' then
    raise exception 'Type the exact selected name to confirm deletion.' using errcode='22023';
  end if;
  select coalesce(array_agg((a->>'id')::uuid),array[]::uuid[]) into v_ids from jsonb_array_elements(v_review->'athletes') a;
  insert into private.record_deletion_events(actor_id,record_type,snapshot)
    values(v_actor,v_review->>'record_type',v_review-'review_token'-'can_delete'-'confirmation_name');
  delete from public.group_enrollments where athlete_id=any(v_ids);
  delete from public.athletes where id=any(v_ids) and family_id=p_family_id;
  if p_athlete_id is null then delete from public.families where id=p_family_id; end if;
  return jsonb_build_object('deleted_athletes',cardinality(v_ids),'deleted_account',p_athlete_id is null);
exception when foreign_key_violation then
  raise exception 'Linked records prevent deletion. Reload and review this account.' using errcode='55000';
end;
$$;
revoke all on function public.review_unused_account_deletion(uuid,uuid),
  public.delete_unused_account_record(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.review_unused_account_deletion(uuid,uuid),
  public.delete_unused_account_record(uuid,uuid,text,text) to authenticated;
