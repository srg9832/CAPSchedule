-- CAP Schedule - Supabase/PostgreSQL schema
-- Run in Supabase SQL Editor on a new project.
-- This script is idempotent enough for a fresh install; use migrations for later changes.

create extension if not exists pgcrypto;

do $$ begin create type public.schedule_program as enum ('cadet','senior'); exception when duplicate_object then null; end $$;
do $$ begin create type public.schedule_version_status as enum ('draft','published','archived'); exception when duplicate_object then null; end $$;
do $$ begin create type public.special_activity_status as enum ('draft','published','cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.activity_scope as enum ('statewide','unit'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  is_app_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  charter_number text unique,
  name text not null,
  city text,
  state text not null default 'MT',
  meeting_weekday smallint not null default 1 check (meeting_weekday between 0 and 6),
  default_start_time time not null default '18:30',
  default_end_time time not null default '21:00',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_unit_permissions (
  user_id uuid not null references public.profiles(id) on delete cascade,
  unit_id uuid not null references public.units(id) on delete cascade,
  can_edit_cadet boolean not null default false,
  can_edit_senior boolean not null default false,
  is_unit_admin boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, unit_id)
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  name text not null,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(unit_id,name)
);

create table if not exists public.activity_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  requirement_key text unique,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create table if not exists public.training_requirements (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.units(id) on delete cascade,
  program_type public.schedule_program not null default 'cadet',
  category_id uuid not null references public.activity_categories(id) on delete restrict,
  name text not null,
  minimum_minutes integer check (minimum_minutes is null or minimum_minutes >= 0),
  occurrence_required boolean not null default false,
  effective_start date,
  effective_end date,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (minimum_minutes is not null or occurrence_required)
);

create table if not exists public.meeting_themes (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.units(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.uniforms (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid references public.units(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_library (
  id uuid primary key default gen_random_uuid(),
  scope public.activity_scope not null default 'unit',
  unit_id uuid references public.units(id) on delete cascade,
  title text not null,
  default_duration_minutes integer not null default 30 check(default_duration_minutes > 0),
  category_id uuid references public.activity_categories(id) on delete set null,
  default_audience text,
  description text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((scope='statewide' and unit_id is null) or (scope='unit' and unit_id is not null))
);

create table if not exists public.meeting_templates (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  program_type public.schedule_program not null,
  name text not null,
  theme_id uuid references public.meeting_themes(id) on delete set null,
  uniform_id uuid references public.uniforms(id) on delete set null,
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(unit_id,program_type,name),
  check(end_time > start_time)
);

create table if not exists public.meeting_template_events (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references public.meeting_templates(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  start_time time not null,
  end_time time not null,
  title text not null,
  category_id uuid references public.activity_categories(id) on delete set null,
  audience text,
  instructor_name text,
  uniform_override_id uuid references public.uniforms(id) on delete set null,
  description text,
  sort_order integer not null default 100,
  check(end_time > start_time)
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  program_type public.schedule_program not null,
  year integer not null check(year between 2000 and 2200),
  month integer not null check(month between 1 and 12),
  current_published_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(unit_id,program_type,year,month)
);

create table if not exists public.schedule_versions (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete cascade,
  version_number integer not null,
  status public.schedule_version_status not null default 'draft',
  source_version_id uuid references public.schedule_versions(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  published_at timestamptz,
  notes text,
  unique(schedule_id,version_number)
);

alter table public.schedules drop constraint if exists schedules_current_published_version_id_fkey;
alter table public.schedules add constraint schedules_current_published_version_id_fkey foreign key(current_published_version_id) references public.schedule_versions(id) on delete set null;

create table if not exists public.meetings (
  id uuid primary key default gen_random_uuid(),
  schedule_version_id uuid not null references public.schedule_versions(id) on delete cascade,
  meeting_date date not null,
  theme_id uuid references public.meeting_themes(id) on delete set null,
  uniform_id uuid references public.uniforms(id) on delete set null,
  title text,
  start_time time,
  end_time time,
  is_cancelled boolean not null default false,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(schedule_version_id,meeting_date),
  check(end_time is null or start_time is null or end_time > start_time)
);

create table if not exists public.meeting_events (
  id uuid primary key default gen_random_uuid(),
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  room_id uuid references public.rooms(id) on delete set null,
  start_time time not null,
  end_time time not null,
  title text not null,
  category_id uuid references public.activity_categories(id) on delete set null,
  audience text,
  instructor_name text,
  uniform_override_id uuid references public.uniforms(id) on delete set null,
  description text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(end_time > start_time)
);

create table if not exists public.special_activities (
  id uuid primary key default gen_random_uuid(),
  unit_id uuid not null references public.units(id) on delete cascade,
  title text not null,
  audience text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  location text,
  description text,
  status public.special_activity_status not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(ends_at > starts_at)
);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null,
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- -------------------------------
-- Helper / trigger functions
-- -------------------------------
create or replace function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id,display_name)
  values(new.id,coalesce(new.raw_user_meta_data->>'display_name',split_part(new.email,'@',1)))
  on conflict(id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
insert into public.profiles(id,display_name)
select id,coalesce(raw_user_meta_data->>'display_name',split_part(email,'@',1)) from auth.users
on conflict(id) do nothing;

create or replace function public.is_app_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_app_admin);
$$;
create or replace function public.is_unit_admin(p_unit_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_app_admin() or exists(select 1 from public.user_unit_permissions p where p.user_id=auth.uid() and p.unit_id=p_unit_id and p.is_unit_admin);
$$;
create or replace function public.has_unit_edit(p_unit_id uuid,p_program public.schedule_program) returns boolean language sql stable security definer set search_path=public as $$
  select public.is_app_admin() or exists(
    select 1 from public.user_unit_permissions p where p.user_id=auth.uid() and p.unit_id=p_unit_id
      and case when p_program='cadet' then p.can_edit_cadet else p.can_edit_senior end
  );
$$;
create or replace function public.can_access_schedule_version(p_version_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.schedule_versions v join public.schedules s on s.id=v.schedule_id
    where v.id=p_version_id and (v.status in ('published','archived') or public.has_unit_edit(s.unit_id,s.program_type))
  );
$$;
create or replace function public.can_edit_schedule_version(p_version_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(
    select 1 from public.schedule_versions v join public.schedules s on s.id=v.schedule_id
    where v.id=p_version_id and v.status='draft' and public.has_unit_edit(s.unit_id,s.program_type)
  );
$$;
create or replace function public.can_edit_meeting(p_meeting_id uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.meetings m where m.id=p_meeting_id and public.can_edit_schedule_version(m.schedule_version_id));
$$;

create or replace function public.audit_row_change() returns trigger language plpgsql security definer set search_path=public as $$
declare rid text;
begin
  rid=coalesce((case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id','');
  insert into public.audit_log(actor_user_id,action,table_name,record_id,old_data,new_data)
  values(auth.uid(),tg_op,tg_table_name,rid,case when tg_op in('UPDATE','DELETE') then to_jsonb(old) end,case when tg_op in('INSERT','UPDATE') then to_jsonb(new) end);
  return case when tg_op='DELETE' then old else new end;
end $$;

-- Updated-at triggers
DO $$ declare t text; begin
  foreach t in array array['profiles','units','user_unit_permissions','training_requirements','activity_library','meeting_templates','meeting_template_events','schedules','meetings','meeting_events','special_activities'] loop
    execute format('drop trigger if exists trg_%I_updated_at on public.%I',t,t);
    execute format('create trigger trg_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t);
  end loop;
end $$;

-- Audit important mutable tables (schedule versions are audited via publish and children changes)
DO $$ declare t text; begin
  foreach t in array array['units','user_unit_permissions','rooms','training_requirements','meeting_themes','uniforms','activity_library','meeting_templates','meeting_template_events','schedule_versions','meetings','meeting_events','special_activities'] loop
    execute format('drop trigger if exists trg_%I_audit on public.%I',t,t);
    execute format('create trigger trg_%I_audit after insert or update or delete on public.%I for each row execute function public.audit_row_change()',t,t);
  end loop;
end $$;

-- -------------------------------
-- Planning RPCs
-- -------------------------------
create or replace function public.get_or_create_schedule_draft(p_unit_id uuid,p_program_type public.schedule_program,p_year integer,p_month integer)
returns uuid language plpgsql security definer set search_path=public as $$
declare s_id uuid; draft_id uuid; source_id uuid; next_version integer; m record; new_m uuid;
begin
  if auth.uid() is null or not public.has_unit_edit(p_unit_id,p_program_type) then raise exception 'Not authorized to edit this schedule'; end if;
  insert into public.schedules(unit_id,program_type,year,month) values(p_unit_id,p_program_type,p_year,p_month)
  on conflict(unit_id,program_type,year,month) do nothing;
  select id,current_published_version_id into s_id,source_id from public.schedules where unit_id=p_unit_id and program_type=p_program_type and year=p_year and month=p_month;
  select id into draft_id from public.schedule_versions where schedule_id=s_id and status='draft' order by version_number desc limit 1;
  if draft_id is not null then return draft_id; end if;
  select coalesce(max(version_number),0)+1 into next_version from public.schedule_versions where schedule_id=s_id;
  insert into public.schedule_versions(schedule_id,version_number,status,source_version_id,created_by) values(s_id,next_version,'draft',source_id,auth.uid()) returning id into draft_id;
  if source_id is not null then
    for m in select * from public.meetings where schedule_version_id=source_id order by meeting_date loop
      insert into public.meetings(schedule_version_id,meeting_date,theme_id,uniform_id,title,start_time,end_time,is_cancelled,cancel_reason)
      values(draft_id,m.meeting_date,m.theme_id,m.uniform_id,m.title,m.start_time,m.end_time,m.is_cancelled,m.cancel_reason) returning id into new_m;
      insert into public.meeting_events(meeting_id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order)
      select new_m,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order from public.meeting_events where meeting_id=m.id;
    end loop;
  end if;
  return draft_id;
end $$;

create or replace function public.generate_normal_meetings(p_schedule_version_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.schedules%rowtype; u public.units%rowtype;
begin
  if not public.can_edit_schedule_version(p_schedule_version_id) then raise exception 'Not authorized to edit this draft'; end if;
  select sc.* into s from public.schedules sc join public.schedule_versions v on v.schedule_id=sc.id where v.id=p_schedule_version_id;
  select * into u from public.units where id=s.unit_id;
  insert into public.meetings(schedule_version_id,meeting_date,start_time,end_time)
  select p_schedule_version_id,d::date,u.default_start_time,u.default_end_time
  from generate_series(make_date(s.year,s.month,1), (make_date(s.year,s.month,1)+interval '1 month - 1 day')::date, interval '1 day') d
  where extract(dow from d)::integer=u.meeting_weekday
  on conflict(schedule_version_id,meeting_date) do nothing;
end $$;

create or replace function public.copy_meeting(p_source_meeting_id uuid,p_target_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare src public.meetings%rowtype; new_id uuid;
begin
  select * into src from public.meetings where id=p_source_meeting_id;
  if src.id is null or not public.can_edit_schedule_version(src.schedule_version_id) then raise exception 'Not authorized'; end if;
  insert into public.meetings(schedule_version_id,meeting_date,theme_id,uniform_id,title,start_time,end_time,is_cancelled,cancel_reason)
  values(src.schedule_version_id,p_target_date,src.theme_id,src.uniform_id,src.title,src.start_time,src.end_time,false,null) returning id into new_id;
  insert into public.meeting_events(meeting_id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order)
  select new_id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order from public.meeting_events where meeting_id=src.id;
  return new_id;
end $$;

create or replace function public.save_meeting_as_template(p_meeting_id uuid,p_name text)
returns uuid language plpgsql security definer set search_path=public as $$
declare m public.meetings%rowtype; s public.schedules%rowtype; v_template_id uuid;
begin
  select * into m from public.meetings where id=p_meeting_id;
  if m.id is null or not public.can_edit_schedule_version(m.schedule_version_id) then raise exception 'Not authorized'; end if;
  select sc.* into s from public.schedules sc join public.schedule_versions v on v.schedule_id=sc.id where v.id=m.schedule_version_id;
  insert into public.meeting_templates(unit_id,program_type,name,theme_id,uniform_id,start_time,end_time,created_by)
  values(s.unit_id,s.program_type,p_name,m.theme_id,m.uniform_id,coalesce(m.start_time,'18:30'),coalesce(m.end_time,'21:00'),auth.uid())
  on conflict(unit_id,program_type,name) do update set theme_id=excluded.theme_id,uniform_id=excluded.uniform_id,start_time=excluded.start_time,end_time=excluded.end_time,active=true,updated_at=now()
  returning id into v_template_id;
  delete from public.meeting_template_events where template_id=v_template_id;
  insert into public.meeting_template_events(template_id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order)
  select v_template_id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order from public.meeting_events where meeting_id=m.id;
  return v_template_id;
end $$;

create or replace function public.apply_meeting_template(p_meeting_id uuid,p_template_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare m public.meetings%rowtype; t public.meeting_templates%rowtype; s public.schedules%rowtype;
begin
  select * into m from public.meetings where id=p_meeting_id;
  if m.id is null or not public.can_edit_schedule_version(m.schedule_version_id) then raise exception 'Not authorized'; end if;
  select sc.* into s from public.schedules sc join public.schedule_versions v on v.schedule_id=sc.id where v.id=m.schedule_version_id;
  select * into t from public.meeting_templates where id=p_template_id and active;
  if t.id is null or t.unit_id<>s.unit_id or t.program_type<>s.program_type then raise exception 'Template does not match this unit/schedule'; end if;
  update public.meetings set theme_id=t.theme_id,uniform_id=t.uniform_id,start_time=t.start_time,end_time=t.end_time,is_cancelled=false,cancel_reason=null where id=m.id;
  delete from public.meeting_events where meeting_id=m.id;
  insert into public.meeting_events(meeting_id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order)
  select m.id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order from public.meeting_template_events where template_id=t.id order by sort_order,start_time;
end $$;

create or replace function public.copy_month_into_draft(p_target_version_id uuid,p_source_year integer,p_source_month integer)
returns void language plpgsql security definer set search_path=public as $$
declare target_s public.schedules%rowtype; src_s public.schedules%rowtype; src_v uuid; u public.units%rowtype; src_m record; tgt_dates date[]; idx integer:=0; new_m uuid;
begin
  if not public.can_edit_schedule_version(p_target_version_id) then raise exception 'Not authorized'; end if;
  select s.* into target_s from public.schedules s join public.schedule_versions v on v.schedule_id=s.id where v.id=p_target_version_id;
  select * into src_s from public.schedules where unit_id=target_s.unit_id and program_type=target_s.program_type and year=p_source_year and month=p_source_month;
  if src_s.id is null then raise exception 'Source month does not exist'; end if;
  src_v=src_s.current_published_version_id;
  if src_v is null then select id into src_v from public.schedule_versions where schedule_id=src_s.id and status in('published','archived') order by version_number desc limit 1; end if;
  if src_v is null then raise exception 'Source month has no published history'; end if;
  select * into u from public.units where id=target_s.unit_id;
  select array_agg(d::date order by d) into tgt_dates from generate_series(make_date(target_s.year,target_s.month,1),(make_date(target_s.year,target_s.month,1)+interval '1 month - 1 day')::date,interval '1 day') d where extract(dow from d)::integer=u.meeting_weekday;
  delete from public.meetings where schedule_version_id=p_target_version_id;
  for src_m in select * from public.meetings where schedule_version_id=src_v order by meeting_date loop
    idx=idx+1; exit when idx>coalesce(array_length(tgt_dates,1),0);
    insert into public.meetings(schedule_version_id,meeting_date,theme_id,uniform_id,title,start_time,end_time,is_cancelled,cancel_reason)
    values(p_target_version_id,tgt_dates[idx],src_m.theme_id,src_m.uniform_id,src_m.title,src_m.start_time,src_m.end_time,src_m.is_cancelled,src_m.cancel_reason) returning id into new_m;
    insert into public.meeting_events(meeting_id,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order)
    select new_m,room_id,start_time,end_time,title,category_id,audience,instructor_name,uniform_override_id,description,sort_order from public.meeting_events where meeting_id=src_m.id;
  end loop;
end $$;

create or replace function public.publish_schedule_version(p_version_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v public.schedule_versions%rowtype; s public.schedules%rowtype;
begin
  select * into v from public.schedule_versions where id=p_version_id for update;
  if v.id is null or v.status<>'draft' then raise exception 'Only a draft can be published'; end if;
  select * into s from public.schedules where id=v.schedule_id for update;
  if not public.has_unit_edit(s.unit_id,s.program_type) then raise exception 'Not authorized'; end if;
  update public.schedule_versions set status='archived' where schedule_id=s.id and status='published';
  update public.schedule_versions set status='published',published_at=now() where id=p_version_id;
  update public.schedules set current_published_version_id=p_version_id where id=s.id;
end $$;

-- -------------------------------
-- Public-current views
-- -------------------------------
create or replace view public.published_meetings_view with (security_invoker=true) as
select
  s.unit_id,s.program_type,s.year as schedule_year,s.month as schedule_month,v.version_number,v.published_at,
  m.id as meeting_id,m.meeting_date,m.theme_id,m.uniform_id,m.title,m.start_time,m.end_time,m.is_cancelled,m.cancel_reason
from public.schedules s
join public.schedule_versions v on v.id=s.current_published_version_id and v.status='published'
join public.meetings m on m.schedule_version_id=v.id;

create or replace view public.published_events_view with (security_invoker=true) as
select
  s.unit_id,s.program_type,s.year as schedule_year,s.month as schedule_month,
  m.id as meeting_id,e.id as event_id,e.room_id,e.start_time,e.end_time,e.title,e.category_id,e.audience,e.instructor_name,e.uniform_override_id,e.description,e.sort_order
from public.schedules s
join public.schedule_versions v on v.id=s.current_published_version_id and v.status='published'
join public.meetings m on m.schedule_version_id=v.id
join public.meeting_events e on e.meeting_id=m.id;

-- -------------------------------
-- RLS
-- -------------------------------
alter table public.profiles enable row level security;
alter table public.units enable row level security;
alter table public.user_unit_permissions enable row level security;
alter table public.rooms enable row level security;
alter table public.activity_categories enable row level security;
alter table public.training_requirements enable row level security;
alter table public.meeting_themes enable row level security;
alter table public.uniforms enable row level security;
alter table public.activity_library enable row level security;
alter table public.meeting_templates enable row level security;
alter table public.meeting_template_events enable row level security;
alter table public.schedules enable row level security;
alter table public.schedule_versions enable row level security;
alter table public.meetings enable row level security;
alter table public.meeting_events enable row level security;
alter table public.special_activities enable row level security;
alter table public.audit_log enable row level security;

-- Drop/recreate named policies to make reruns predictable.
do $$ declare r record; begin for r in select schemaname,tablename,policyname from pg_policies where schemaname='public' and tablename in ('profiles','units','user_unit_permissions','rooms','activity_categories','training_requirements','meeting_themes','uniforms','activity_library','meeting_templates','meeting_template_events','schedules','schedule_versions','meetings','meeting_events','special_activities','audit_log') loop execute format('drop policy if exists %I on %I.%I',r.policyname,r.schemaname,r.tablename); end loop; end $$;

create policy profiles_self_select on public.profiles for select to authenticated using(id=auth.uid() or public.is_app_admin());
create policy profiles_self_update on public.profiles for update to authenticated using(id=auth.uid() or public.is_app_admin()) with check(id=auth.uid() or public.is_app_admin());

create policy units_public_read on public.units for select to anon,authenticated using(active or public.is_app_admin());
create policy units_app_admin_write on public.units for all to authenticated using(public.is_app_admin()) with check(public.is_app_admin());

create policy perms_read on public.user_unit_permissions for select to authenticated using(user_id=auth.uid() or public.is_app_admin() or public.is_unit_admin(unit_id));
create policy perms_app_admin_write on public.user_unit_permissions for all to authenticated using(public.is_app_admin()) with check(public.is_app_admin());

create policy rooms_public_read on public.rooms for select to anon,authenticated using(active or public.is_unit_admin(unit_id));
create policy rooms_admin_write on public.rooms for all to authenticated using(public.is_unit_admin(unit_id)) with check(public.is_unit_admin(unit_id));

create policy categories_public_read on public.activity_categories for select to anon,authenticated using(true);
create policy categories_app_write on public.activity_categories for all to authenticated using(public.is_app_admin()) with check(public.is_app_admin());

create policy requirements_public_read on public.training_requirements for select to anon,authenticated using(true);
create policy requirements_app_write on public.training_requirements for all to authenticated using(public.is_app_admin()) with check(public.is_app_admin());

create policy themes_public_read on public.meeting_themes for select to anon,authenticated using(active or (unit_id is not null and public.is_unit_admin(unit_id)));
create policy themes_admin_insert on public.meeting_themes for insert to authenticated with check((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id)));
create policy themes_admin_update on public.meeting_themes for update to authenticated using((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id))) with check((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id)));
create policy themes_admin_delete on public.meeting_themes for delete to authenticated using((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id)));

create policy uniforms_public_read on public.uniforms for select to anon,authenticated using(active or (unit_id is not null and public.is_unit_admin(unit_id)));
create policy uniforms_admin_insert on public.uniforms for insert to authenticated with check((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id)));
create policy uniforms_admin_update on public.uniforms for update to authenticated using((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id))) with check((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id)));
create policy uniforms_admin_delete on public.uniforms for delete to authenticated using((unit_id is null and public.is_app_admin()) or (unit_id is not null and public.is_unit_admin(unit_id)));

create policy library_public_read on public.activity_library for select to anon,authenticated using(active or (unit_id is not null and public.is_unit_admin(unit_id)));
create policy library_admin_insert on public.activity_library for insert to authenticated with check((scope='statewide' and public.is_app_admin()) or (scope='unit' and public.is_unit_admin(unit_id)));
create policy library_admin_update on public.activity_library for update to authenticated using((scope='statewide' and public.is_app_admin()) or (scope='unit' and public.is_unit_admin(unit_id))) with check((scope='statewide' and public.is_app_admin()) or (scope='unit' and public.is_unit_admin(unit_id)));
create policy library_admin_delete on public.activity_library for delete to authenticated using((scope='statewide' and public.is_app_admin()) or (scope='unit' and public.is_unit_admin(unit_id)));

create policy templates_read on public.meeting_templates for select to authenticated using(public.has_unit_edit(unit_id,program_type) or public.is_unit_admin(unit_id));
create policy templates_insert on public.meeting_templates for insert to authenticated with check(public.has_unit_edit(unit_id,program_type));
create policy templates_update on public.meeting_templates for update to authenticated using(public.has_unit_edit(unit_id,program_type)) with check(public.has_unit_edit(unit_id,program_type));
create policy templates_delete on public.meeting_templates for delete to authenticated using(public.has_unit_edit(unit_id,program_type));

create policy template_events_read on public.meeting_template_events for select to authenticated using(exists(select 1 from public.meeting_templates t where t.id=template_id and (public.has_unit_edit(t.unit_id,t.program_type) or public.is_unit_admin(t.unit_id))));
create policy template_events_insert on public.meeting_template_events for insert to authenticated with check(exists(select 1 from public.meeting_templates t where t.id=template_id and public.has_unit_edit(t.unit_id,t.program_type)));
create policy template_events_update on public.meeting_template_events for update to authenticated using(exists(select 1 from public.meeting_templates t where t.id=template_id and public.has_unit_edit(t.unit_id,t.program_type))) with check(exists(select 1 from public.meeting_templates t where t.id=template_id and public.has_unit_edit(t.unit_id,t.program_type)));
create policy template_events_delete on public.meeting_template_events for delete to authenticated using(exists(select 1 from public.meeting_templates t where t.id=template_id and public.has_unit_edit(t.unit_id,t.program_type)));

create policy schedules_public_read on public.schedules for select to anon,authenticated using(true);
create policy versions_read on public.schedule_versions for select to anon,authenticated using(status in('published','archived') or public.can_access_schedule_version(id));
create policy versions_editor_insert on public.schedule_versions for insert to authenticated with check(status='draft' and exists(select 1 from public.schedules s where s.id=schedule_id and public.has_unit_edit(s.unit_id,s.program_type)));
create policy versions_editor_update on public.schedule_versions for update to authenticated using(public.can_edit_schedule_version(id)) with check(status='draft' and exists(select 1 from public.schedules s where s.id=schedule_id and public.has_unit_edit(s.unit_id,s.program_type)));
create policy versions_editor_delete on public.schedule_versions for delete to authenticated using(public.can_edit_schedule_version(id));

create policy meetings_read on public.meetings for select to anon,authenticated using(public.can_access_schedule_version(schedule_version_id));
create policy meetings_editor_insert on public.meetings for insert to authenticated with check(public.can_edit_schedule_version(schedule_version_id));
create policy meetings_editor_update on public.meetings for update to authenticated using(public.can_edit_schedule_version(schedule_version_id)) with check(public.can_edit_schedule_version(schedule_version_id));
create policy meetings_editor_delete on public.meetings for delete to authenticated using(public.can_edit_schedule_version(schedule_version_id));

create policy events_read on public.meeting_events for select to anon,authenticated using(exists(select 1 from public.meetings m where m.id=meeting_id and public.can_access_schedule_version(m.schedule_version_id)));
create policy events_editor_insert on public.meeting_events for insert to authenticated with check(public.can_edit_meeting(meeting_id));
create policy events_editor_update on public.meeting_events for update to authenticated using(public.can_edit_meeting(meeting_id)) with check(public.can_edit_meeting(meeting_id));
create policy events_editor_delete on public.meeting_events for delete to authenticated using(public.can_edit_meeting(meeting_id));

create policy special_public_read on public.special_activities for select to anon,authenticated using(status='published' or public.has_unit_edit(unit_id,'cadet') or public.has_unit_edit(unit_id,'senior'));
create policy special_editor_insert on public.special_activities for insert to authenticated with check(public.has_unit_edit(unit_id,'cadet') or public.has_unit_edit(unit_id,'senior'));
create policy special_editor_update on public.special_activities for update to authenticated using(public.has_unit_edit(unit_id,'cadet') or public.has_unit_edit(unit_id,'senior')) with check(public.has_unit_edit(unit_id,'cadet') or public.has_unit_edit(unit_id,'senior'));
create policy special_editor_delete on public.special_activities for delete to authenticated using(public.has_unit_edit(unit_id,'cadet') or public.has_unit_edit(unit_id,'senior'));

create policy audit_app_admin_read on public.audit_log for select to authenticated using(public.is_app_admin());

-- -------------------------------
-- Reference data based on the planning workbook
-- -------------------------------
insert into public.activity_categories(name,requirement_key,sort_order) values
 ('Leadership','leadership',10),('Aerospace','aerospace',20),('Fitness','fitness',30),('Character','character',40),('Safety','safety',50),('Emergency Services',null,60),('Administration',null,70),('Other',null,100)
on conflict(name) do update set requirement_key=excluded.requirement_key,sort_order=excluded.sort_order;

insert into public.training_requirements(program_type,category_id,name,minimum_minutes,occurrence_required,sort_order)
select 'cadet',id,'Leadership',90,false,10 from public.activity_categories where name='Leadership' and not exists(select 1 from public.training_requirements where unit_id is null and name='Leadership');
insert into public.training_requirements(program_type,category_id,name,minimum_minutes,occurrence_required,sort_order)
select 'cadet',id,'Aerospace',90,false,20 from public.activity_categories where name='Aerospace' and not exists(select 1 from public.training_requirements where unit_id is null and name='Aerospace');
insert into public.training_requirements(program_type,category_id,name,minimum_minutes,occurrence_required,sort_order)
select 'cadet',id,'Fitness',45,false,30 from public.activity_categories where name='Fitness' and not exists(select 1 from public.training_requirements where unit_id is null and name='Fitness');
insert into public.training_requirements(program_type,category_id,name,minimum_minutes,occurrence_required,sort_order)
select 'cadet',id,'Character',45,false,40 from public.activity_categories where name='Character' and not exists(select 1 from public.training_requirements where unit_id is null and name='Character');
insert into public.training_requirements(program_type,category_id,name,minimum_minutes,occurrence_required,sort_order)
select 'cadet',id,'Safety',null,true,50 from public.activity_categories where name='Safety' and not exists(select 1 from public.training_requirements where unit_id is null and name='Safety');

insert into public.meeting_themes(unit_id,name) select null,x from unnest(array['Leadership / Character','Fitness','Aerospace','Emergency Services','Holiday / No Meeting','General Meeting']) x where not exists(select 1 from public.meeting_themes t where t.unit_id is null and t.name=x);
insert into public.uniforms(unit_id,name) select null,x from unnest(array['OCP','Blues','PT Gear','Civilian Attire']) x where not exists(select 1 from public.uniforms u where u.unit_id is null and u.name=x);

insert into public.activity_library(scope,unit_id,title,default_duration_minutes,category_id,default_audience)
select 'statewide',null,v.title,v.minutes,c.id,v.audience
from (values
 ('Opening Formation',15,'Leadership','All Members'),
 ('Opening Formation / Uniform Inspections',15,'Leadership','All Cadets'),
 ('Drill / Drill Testing',15,'Leadership','Cadets'),
 ('Leadership for Airmen',45,'Leadership','Cadet Airmen'),
 (E'Leadership for NCO\'s',45,'Leadership','Cadet NCOs'),
 ('Leadership for Company Grade Officers',45,'Leadership','Cadet Officers'),
 ('Aerospace Lesson',45,'Aerospace','Cadets'),('Aerospace Activity',45,'Aerospace','Cadets'),('Aerospace Current Events',20,'Aerospace','Cadets'),
 ('Safety',15,'Safety','All Members'),('Character Development Module',45,'Character','Cadets'),('CyberPatriot',60,'Aerospace','Cyber Team'),
 ('Emergency Services',45,'Emergency Services','All Members'),('Topo Maps',45,'Emergency Services','Ground Team'),('Color Guard',45,'Leadership','Color Guard'),('P90X Workout',45,'Fitness','Cadets')
) as v(title,minutes,category,audience)
join public.activity_categories c on c.name=v.category
where not exists(select 1 from public.activity_library a where a.scope='statewide' and a.title=v.title);

-- Function execute grants; table/view grants. RLS still controls access.
grant usage on schema public to anon,authenticated;
grant select on public.units,public.rooms,public.activity_categories,public.training_requirements,public.meeting_themes,public.uniforms,public.activity_library,public.schedules,public.schedule_versions,public.meetings,public.meeting_events,public.special_activities,public.published_meetings_view,public.published_events_view to anon,authenticated;
grant select,insert,update,delete on public.units,public.rooms,public.activity_categories,public.training_requirements,public.meeting_themes,public.uniforms,public.activity_library,public.schedules,public.schedule_versions,public.meetings,public.meeting_events,public.special_activities,public.user_unit_permissions to authenticated;
grant select,update on public.profiles to authenticated;
grant select on public.audit_log to authenticated;
grant select,insert,update,delete on public.meeting_templates,public.meeting_template_events to authenticated;
grant execute on function public.get_or_create_schedule_draft(uuid,public.schedule_program,integer,integer), public.generate_normal_meetings(uuid), public.copy_meeting(uuid,date), public.save_meeting_as_template(uuid,text), public.apply_meeting_template(uuid,uuid), public.copy_month_into_draft(uuid,integer,integer), public.publish_schedule_version(uuid) to authenticated;

-- IMPORTANT bootstrap step after running this script:
-- 1) Create your first user in Authentication > Users.
-- 2) Promote that user once with:
--    update public.profiles set is_app_admin=true where id=(select id from auth.users where email='YOUR_EMAIL');
-- After that, user/unit administration is handled by the CAP Schedule Admin tab + Edge Function.
