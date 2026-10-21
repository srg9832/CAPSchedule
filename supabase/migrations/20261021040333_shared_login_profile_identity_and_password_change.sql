alter table public.profiles
  add column if not exists first_name text,
  add column if not exists last_name text,
  add column if not exists capid text,
  add column if not exists must_change_password boolean not null default false,
  add column if not exists password_changed_at timestamptz;

comment on column public.profiles.capid is
  'Optional CAPID for the shared login profile. This is independent from public.members and does not require profiles.member_id.';
comment on column public.profiles.member_id is
  'Optional link to a shared roster member when an application explicitly needs it. Login accounts do not require a member link.';
comment on column public.profiles.must_change_password is
  'When true, CAP Applications should require the user to choose a new password before normal application use.';

drop index if exists public.profiles_member_id_unique_idx;

create unique index if not exists profiles_capid_unique_idx
  on public.profiles ((btrim(capid)))
  where capid is not null and btrim(capid) <> '';

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(
    id,
    display_name,
    first_name,
    last_name,
    capid,
    must_change_password
  )
  values(
    new.id,
    coalesce(
      nullif(new.raw_user_meta_data->>'display_name',''),
      nullif(trim(concat_ws(' ', new.raw_user_meta_data->>'first_name', new.raw_user_meta_data->>'last_name')),''),
      split_part(new.email,'@',1)
    ),
    nullif(new.raw_user_meta_data->>'first_name',''),
    nullif(new.raw_user_meta_data->>'last_name',''),
    nullif(new.raw_user_meta_data->>'capid',''),
    true
  )
  on conflict(id) do nothing;
  return new;
end
$$;

create or replace function public.shared_complete_password_change()
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  update public.profiles
  set must_change_password = false,
      password_changed_at = now(),
      updated_at = now()
  where id = auth.uid();

  if not found then
    raise exception 'User profile not found';
  end if;
end;
$$;

revoke execute on function public.shared_complete_password_change() from public, anon;
grant execute on function public.shared_complete_password_change() to authenticated;

create or replace function public.uniform_admin_list_users_v3()
returns table(
  id uuid,
  email text,
  display_name text,
  first_name text,
  last_name text,
  capid text,
  default_unit_id uuid,
  is_app_admin boolean,
  has_uniform_access boolean,
  must_change_password boolean,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if not (
    public.is_uniform_app_admin()
    or exists (
      select 1
      from public.uniform_unit_permissions mine
      where mine.user_id = auth.uid()
        and mine.is_unit_admin
    )
  ) then
    raise exception 'Uniform Inspection administration access is required.';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(
      nullif(p.display_name,''),
      nullif(trim(concat_ws(' ', p.first_name, p.last_name)),''),
      u.email
    )::text,
    p.first_name,
    p.last_name,
    p.capid,
    p.default_unit_id,
    exists (
      select 1
      from public.uniform_global_permissions g
      where g.user_id = u.id
        and g.is_app_admin
    ) as is_app_admin,
    (
      exists (
        select 1
        from public.uniform_global_permissions g
        where g.user_id = u.id
          and g.is_app_admin
      )
      or exists (
        select 1
        from public.uniform_unit_permissions target_access
        where target_access.user_id = u.id
          and (target_access.can_inspect or target_access.is_unit_admin)
      )
    ) as has_uniform_access,
    coalesce(p.must_change_password,false),
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  where
    (
      public.is_uniform_app_admin()
      and (
        exists (
          select 1
          from public.uniform_global_permissions g
          where g.user_id = u.id and g.is_app_admin
        )
        or exists (
          select 1
          from public.uniform_unit_permissions target_access
          where target_access.user_id = u.id
            and (target_access.can_inspect or target_access.is_unit_admin)
        )
      )
    )
    or (
      not public.is_uniform_app_admin()
      and exists (
        select 1
        from public.uniform_unit_permissions target_access
        join public.uniform_unit_permissions mine
          on mine.unit_id = target_access.unit_id
         and mine.user_id = auth.uid()
         and mine.is_unit_admin
        where target_access.user_id = u.id
          and (target_access.can_inspect or target_access.is_unit_admin)
      )
    )
  order by coalesce(
    nullif(p.last_name,''),
    nullif(p.display_name,''),
    u.email
  ), coalesce(nullif(p.first_name,''),'');
end;
$$;

revoke execute on function public.uniform_admin_list_users_v3() from public, anon;
grant execute on function public.uniform_admin_list_users_v3() to authenticated;

drop function if exists public.uniform_admin_lookup_member(uuid,text);
