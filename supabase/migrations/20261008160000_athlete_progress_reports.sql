-- Upload-only athlete reports. PDF objects are private and immutable.
create table public.progress_reports (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id),
  title text not null check (length(btrim(title)) between 1 and 120),
  report_date date not null check (report_date between date '1900-01-01' and date '2100-12-31'),
  coach_note text not null default '' check (length(coach_note) <= 1000),
  status text not null default 'draft' check (status in ('draft', 'published')),
  current_file_id uuid,
  revision integer not null default 1,
  publication integer not null default 0,
  published_at timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status = 'draft' or (current_file_id is not null and published_at is not null))
);
create table public.progress_report_files (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references public.progress_reports(id),
  object_path text not null unique,
  original_name text not null check (length(original_name) between 1 and 200),
  size_bytes bigint not null check (size_bytes between 5 and 10485760),
  created_at timestamptz not null default now(),
  unique (id, report_id)
);
alter table public.progress_reports add constraint progress_reports_current_file_fk
  foreign key (current_file_id, id) references public.progress_report_files(id, report_id);
create index progress_reports_athlete_date_idx on public.progress_reports(athlete_id, report_date desc, id);
alter table public.progress_reports enable row level security;
alter table public.progress_report_files enable row level security;
revoke all on public.progress_reports, public.progress_report_files from public, anon, authenticated;
grant select on public.progress_reports, public.progress_report_files to authenticated;

create function private.can_read_progress_report(p_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_coach() or exists (
    select 1 from public.progress_reports r join public.athletes a on a.id = r.athlete_id
    where r.id = p_id and r.status = 'published' and private.can_read_family(a.family_id)
  );
$$;
create function private.can_read_progress_file(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.progress_report_files f join public.progress_reports r on r.id = f.report_id
    where f.object_path = p_path and (private.is_coach() or
      (r.current_file_id = f.id and private.can_read_progress_report(r.id)))
  );
$$;
create function private.can_upload_progress_file(p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_coach() and exists (
    select 1 from public.progress_report_files f join public.progress_reports r on r.id = f.report_id
    where f.object_path = p_path and r.status = 'draft'
  );
$$;
revoke all on function private.can_read_progress_report(uuid), private.can_read_progress_file(text),
  private.can_upload_progress_file(text) from public, anon;
grant execute on function private.can_read_progress_report(uuid), private.can_read_progress_file(text),
  private.can_upload_progress_file(text) to authenticated;
-- Storage's PUBLIC restrictive policies are planned for anon too. These helpers
-- are not API-exposed, and auth.uid() is null for an unauthenticated request.
grant execute on function private.can_read_progress_file(text), private.can_upload_progress_file(text) to anon;
create policy progress_reports_read on public.progress_reports for select to authenticated
  using (private.can_read_progress_report(id));
create policy progress_report_files_read on public.progress_report_files for select to authenticated
  using (private.can_read_progress_file(object_path));

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values ('athlete-progress-reports', 'athlete-progress-reports', false, 10485760, array['application/pdf'])
  on conflict (id) do nothing;
do $$ begin
  if not exists(select 1 from storage.buckets where id = 'athlete-progress-reports'
    and public = false and file_size_limit = 10485760 and allowed_mime_types = array['application/pdf']) then
    raise exception 'Progress report bucket exists with unexpected settings; review before continuing';
  end if;
end $$;
create policy progress_report_objects_read on storage.objects for select to authenticated
  using (bucket_id = 'athlete-progress-reports' and private.can_read_progress_file(name));
create policy progress_report_objects_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'athlete-progress-reports' and private.can_upload_progress_file(name));
-- Restrictive guards protect this bucket even if another bucket has a broad policy.
-- They leave all other buckets unchanged. No client overwrites or deletions.
create policy progress_report_objects_read_guard on storage.objects as restrictive for select to public
  using (case when bucket_id = 'athlete-progress-reports' then
    case when current_user = 'authenticated' then private.can_read_progress_file(name)
      and current_setting('storage.operation', true) in ('object.get_authenticated', 'storage.object.get_authenticated')
      else false end
    else true end);
create policy progress_report_objects_upload_guard on storage.objects as restrictive for insert to public
  with check (case when bucket_id = 'athlete-progress-reports' then
    case when current_user = 'authenticated' then private.can_upload_progress_file(name) else false end
    else true end);
create policy progress_report_objects_update_guard on storage.objects as restrictive for update to public
  using (bucket_id <> 'athlete-progress-reports') with check (bucket_id <> 'athlete-progress-reports');
create policy progress_report_objects_delete_guard on storage.objects as restrictive for delete to public
  using (bucket_id <> 'athlete-progress-reports');

create function public.create_progress_report(p_athlete_id uuid, p_title text, p_report_date date, p_coach_note text default '', p_report_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  insert into public.progress_reports(id, athlete_id, title, report_date, coach_note, created_by)
    values (p_report_id, p_athlete_id, btrim(p_title), p_report_date, coalesce(p_coach_note, ''), auth.uid())
    on conflict (id) do nothing;
  if not exists(select 1 from public.progress_reports where id = p_report_id and created_by = auth.uid()
    and athlete_id = p_athlete_id and title = btrim(p_title) and report_date = p_report_date
    and coach_note = coalesce(p_coach_note, '') and status = 'draft') then
    raise exception 'Draft request changed; reload before retrying' using errcode = '40001';
  end if;
  return p_report_id;
end;
$$;
create function public.update_progress_report(p_report_id uuid, p_revision integer,
  p_title text, p_report_date date, p_coach_note text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  perform 1 from public.progress_reports where id = p_report_id and revision = p_revision and status = 'draft' for update;
  if not found then raise exception 'Report changed or must be unpublished first' using errcode = '40001'; end if;
  update public.progress_reports set title = btrim(p_title), report_date = p_report_date,
    coach_note = coalesce(p_coach_note, ''), revision = revision + 1, updated_at = now() where id = p_report_id;
end;
$$;
create function public.prepare_progress_report_file(p_report_id uuid, p_revision integer, p_original_name text, p_size_bytes bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_file uuid := gen_random_uuid(); v_path text;
begin
  if not private.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  perform 1 from public.progress_reports where id = p_report_id and revision = p_revision and status = 'draft' for update;
  if not found then raise exception 'Report changed or must be unpublished first' using errcode = '40001'; end if;
  v_path := p_report_id::text || '/' || v_file::text || '.pdf';
  insert into public.progress_report_files(id, report_id, object_path, original_name, size_bytes)
    values(v_file, p_report_id, v_path, p_original_name, p_size_bytes);
  return jsonb_build_object('file_id', v_file, 'object_path', v_path);
end;
$$;
create function private.progress_pdf_exists(p_file_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.progress_report_files f join storage.objects o
    on o.bucket_id = 'athlete-progress-reports' and o.name = f.object_path
    where f.id = p_file_id and o.metadata->>'mimetype' = 'application/pdf'
      and o.metadata->>'size' = f.size_bytes::text);
$$;
revoke all on function private.progress_pdf_exists(uuid) from public, anon, authenticated;
create function public.attach_progress_report_file(p_report_id uuid, p_revision integer, p_file_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  perform 1 from public.progress_reports where id = p_report_id and revision = p_revision and status = 'draft' for update;
  if not found then raise exception 'Report changed or must be unpublished first' using errcode = '40001'; end if;
  if not exists(select 1 from public.progress_report_files where id = p_file_id and report_id = p_report_id)
    or not private.progress_pdf_exists(p_file_id) then
    raise exception 'A complete PDF upload matching the reserved size is required' using errcode = '22023';
  end if;
  update public.progress_reports set current_file_id = p_file_id,
    revision = revision + 1, updated_at = now() where id = p_report_id;
end;
$$;
create function public.publish_progress_report(p_report_id uuid, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
declare v_report public.progress_reports%rowtype;
begin
  if not private.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  select * into v_report from public.progress_reports where id = p_report_id for update;
  if not found then raise exception 'Report unavailable' using errcode = '22023'; end if;
  -- A repeated publish is harmless and cannot queue a duplicate email.
  if v_report.status = 'published' then return; end if;
  if v_report.revision <> p_revision then raise exception 'Report changed; reload' using errcode = '40001'; end if;
  if v_report.current_file_id is null or not private.progress_pdf_exists(v_report.current_file_id) then
    raise exception 'Upload a complete PDF before publishing' using errcode = '22023';
  end if;
  update public.progress_reports set status = 'published', published_at = now(),
    publication = publication + 1, revision = revision + 1, updated_at = now() where id = p_report_id;
end;
$$;
create function public.unpublish_progress_report(p_report_id uuid, p_revision integer)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_coach() then raise exception 'Coach access required' using errcode = '42501'; end if;
  perform 1 from public.progress_reports where id = p_report_id and revision = p_revision for update;
  if not found then raise exception 'Report changed; reload' using errcode = '40001'; end if;
  update public.progress_reports set status = 'draft', revision = revision + 1,
    updated_at = now() where id = p_report_id and status = 'published';
end;
$$;
revoke all on function public.create_progress_report(uuid, text, date, text, uuid),
  public.update_progress_report(uuid, integer, text, date, text),
  public.prepare_progress_report_file(uuid, integer, text, bigint),
  public.attach_progress_report_file(uuid, integer, uuid),
  public.publish_progress_report(uuid, integer), public.unpublish_progress_report(uuid, integer)
  from public, anon;
grant execute on function public.create_progress_report(uuid, text, date, text, uuid),
  public.update_progress_report(uuid, integer, text, date, text),
  public.prepare_progress_report_file(uuid, integer, text, bigint),
  public.attach_progress_report_file(uuid, integer, uuid),
  public.publish_progress_report(uuid, integer), public.unpublish_progress_report(uuid, integer)
  to authenticated;
