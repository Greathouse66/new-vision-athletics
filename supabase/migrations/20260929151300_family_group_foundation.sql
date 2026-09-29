-- Run as the Supabase migration owner. No sample or real records are inserted.
-- Auth identities live in auth.users; access is granted only by an authorized coach.
create table public.coach_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key default gen_random_uuid(),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  created_at timestamptz not null default now()
);

create table public.family_guardians (
  family_id uuid not null references public.families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (family_id, user_id)
);
create index family_guardians_user_id_idx on public.family_guardians(user_id);

create table public.athletes (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id),
  display_name text not null check (length(btrim(display_name)) between 1 and 160),
  created_at timestamptz not null default now(),
  unique (id, family_id)
);
create index athletes_family_id_idx on public.athletes(family_id);

create table public.skill_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Group changes create new dated rows so past rosters retain their original group.
-- Ends are exclusive; scheduling must reject overlaps before a live import.
create table public.group_enrollments (
  id uuid primary key default gen_random_uuid(),
  athlete_id uuid not null references public.athletes(id),
  group_id uuid not null references public.skill_groups(id),
  starts_on date not null,
  ends_on date,
  created_at timestamptz not null default now(),
  check (ends_on is null or ends_on > starts_on)
);
create index group_enrollments_athlete_id_idx on public.group_enrollments(athlete_id);
create index group_enrollments_group_id_idx on public.group_enrollments(group_id);

alter table public.coach_users enable row level security;
alter table public.families enable row level security;
alter table public.family_guardians enable row level security;
alter table public.athletes enable row level security;
alter table public.skill_groups enable row level security;
alter table public.group_enrollments enable row level security;

-- Restrict the Data API even if a policy is accidentally broadened later.
revoke all on public.coach_users, public.families, public.family_guardians,
  public.athletes, public.skill_groups, public.group_enrollments from anon;
revoke all on public.coach_users, public.families, public.family_guardians,
  public.athletes, public.skill_groups, public.group_enrollments from authenticated;
grant select on public.coach_users to authenticated;
grant select, insert, update on public.families, public.athletes,
  public.skill_groups, public.group_enrollments to authenticated;
grant select, insert, update, delete on public.family_guardians to authenticated;
