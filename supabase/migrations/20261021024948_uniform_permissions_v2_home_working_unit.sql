-- Uniform Inspection permission model v2:
-- Inspector (per unit), Unit Admin (per unit), Application Admin (global).
-- Reuses profiles.default_unit_id as the persistent home/default unit.

create or replace function public.uniform_my_profile_v2()
returns table(
  id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz,
  default_unit_id uuid,
  is_app_admin boolean,
  is_unit_admin boolean,
  authorized_unit_ids uuid[],
  unit_admin_ids uuid[]
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    u.id,
    u.email::text,
    coalesce(p.display_name, u.email)::text,
    case
      when public.is_uniform_app_admin() then 'application_admin'
      when exists (
        select 1 from public.uniform_unit_permissions up
        where up.user_id = auth.uid() and up.is_unit_admin
      ) then 'unit_admin'
      else 'inspector'
    end::text as role,
    u.created_at,
    p.default_unit_id,
    public.is_uniform_app_admin() as is_app_admin,
    exists (
      select 1 from public.uniform_unit_permissions up
      where up.user_id = auth.uid() and up.is_unit_admin
    ) as is_unit_admin,
    case
      when public.is_uniform_app_admin() then coalesce((
        select array_agg(x.id order by x.charter_number nulls last, x.name)
        from public.units x
        where x.active
      ), array[]::uuid[])
      else coalesce((
        select array_agg(up.unit_id order by un.charter_number nulls last, un.name)
        from public.uniform_unit_permissions up
        join public.units un on un.id = up.unit_id
        where up.user_id = auth.uid()
          and un.active
          and (up.can_inspect or up.is_unit_admin)
      ), array[]::uuid[])
    end as authorized_unit_ids,
    coalesce((
      select array_agg(up.unit_id order by un.charter_number nulls last, un.name)
      from public.uniform_unit_permissions up
      join public.units un on un.id = up.unit_id
      where up.user_id = auth.uid() and up.is_unit_admin
    ), array[]::uuid[]) as unit_admin_ids
  from auth.users u
  left join public.profiles p on p.id = u.id
  where u.id = auth.uid()
    and public.has_uniform_any_access();
$$;

create or replace function public.uniform_admin_list_users()
returns table(
  id uuid,
  email text,
  display_name text,
  default_unit_id uuid,
  is_app_admin boolean,
  has_uniform_access boolean,
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
      select 1 from public.uniform_unit_permissions up
      where up.user_id = auth.uid() and up.is_unit_admin
    )
  ) then
    raise exception 'Uniform Inspection administration access is required.';
  end if;

  return query
  select
    u.id,
    u.email::text,
    coalesce(p.display_name, u.email)::text,
    p.default_unit_id,
    exists (
      select 1 from public.uniform_global_permissions g
      where g.user_id = u.id and g.is_app_admin
    ) as is_app_admin,
    (
      exists (
        select 1 from public.uniform_global_permissions g
        where g.user_id = u.id and g.is_app_admin
      )
      or exists (
        select 1 from public.uniform_unit_permissions up
        where up.user_id = u.id and (up.can_inspect or up.is_unit_admin)
      )
    ) as has_uniform_access,
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  order by coalesce(p.display_name, u.email), u.email;
end;
$$;

create or replace function public.uniform_admin_list_unit_roles()
returns table(
  user_id uuid,
  unit_id uuid,
  can_inspect boolean,
  is_unit_admin boolean
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
      select 1 from public.uniform_unit_permissions up
      where up.user_id = auth.uid() and up.is_unit_admin
    )
  ) then
    raise exception 'Uniform Inspection administration access is required.';
  end if;

  return query
  select up.user_id, up.unit_id, up.can_inspect, up.is_unit_admin
  from public.uniform_unit_permissions up
  where public.is_uniform_app_admin()
     or exists (
       select 1
       from public.uniform_unit_permissions mine
       where mine.user_id = auth.uid()
         and mine.unit_id = up.unit_id
         and mine.is_unit_admin
     );
end;
$$;

create or replace function public.uniform_admin_set_unit_role(
  p_user_id uuid,
  p_unit_id uuid,
  p_role text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  caller_is_app_admin boolean := public.is_uniform_app_admin();
  caller_is_unit_admin boolean;
  target_is_unit_admin boolean := false;
begin
  if p_role not in ('none','inspector','unit_admin') then
    raise exception 'Invalid unit role.';
  end if;

  select exists (
    select 1
    from public.uniform_unit_permissions up
    where up.user_id = auth.uid()
      and up.unit_id = p_unit_id
      and up.is_unit_admin
  ) into caller_is_unit_admin;

  if not caller_is_app_admin and not caller_is_unit_admin then
    raise exception 'You are not an administrator for this unit.';
  end if;

  select coalesce((
    select up.is_unit_admin
    from public.uniform_unit_permissions up
    where up.user_id = p_user_id and up.unit_id = p_unit_id
  ), false) into target_is_unit_admin;

  if not caller_is_app_admin then
    if p_role = 'unit_admin' then
      raise exception 'Only an Application Admin can appoint Unit Admins.';
    end if;
    if target_is_unit_admin then
      raise exception 'Only an Application Admin can change a Unit Admin.';
    end if;
  end if;

  if p_role = 'none' then
    delete from public.uniform_unit_permissions
    where user_id = p_user_id and unit_id = p_unit_id;
  elsif p_role = 'inspector' then
    insert into public.uniform_unit_permissions(user_id, unit_id, can_inspect, is_unit_admin, updated_at)
    values (p_user_id, p_unit_id, true, false, now())
    on conflict (user_id, unit_id) do update
      set can_inspect = true,
          is_unit_admin = false,
          updated_at = now();
  else
    insert into public.uniform_unit_permissions(user_id, unit_id, can_inspect, is_unit_admin, updated_at)
    values (p_user_id, p_unit_id, true, true, now())
    on conflict (user_id, unit_id) do update
      set can_inspect = true,
          is_unit_admin = true,
          updated_at = now();
  end if;
end;
$$;

create or replace function public.uniform_admin_set_app_admin(
  p_user_id uuid,
  p_enabled boolean
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  admin_count integer;
begin
  if not public.is_uniform_app_admin() then
    raise exception 'Only an Application Admin can change Application Admin access.';
  end if;

  if not p_enabled then
    select count(*) into admin_count
    from public.uniform_global_permissions
    where is_app_admin;

    if admin_count <= 1
       and exists (
         select 1 from public.uniform_global_permissions
         where user_id = p_user_id and is_app_admin
       ) then
      raise exception 'The last Application Admin cannot be removed.';
    end if;
  end if;

  insert into public.uniform_global_permissions(user_id, is_app_admin, updated_at)
  values (p_user_id, p_enabled, now())
  on conflict (user_id) do update
    set is_app_admin = excluded.is_app_admin,
        updated_at = now();
end;
$$;

create or replace function public.uniform_admin_set_home_unit(
  p_user_id uuid,
  p_unit_id uuid
)
returns void
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  target_is_app_admin boolean;
begin
  if not public.is_uniform_app_admin() then
    raise exception 'Only an Application Admin can change a user''s Home Unit.';
  end if;

  if p_unit_id is not null and not exists (
    select 1 from public.units u where u.id = p_unit_id and u.active
  ) then
    raise exception 'Choose an active Home Unit.';
  end if;

  select exists (
    select 1 from public.uniform_global_permissions g
    where g.user_id = p_user_id and g.is_app_admin
  ) into target_is_app_admin;

  if p_unit_id is not null
     and not target_is_app_admin
     and not exists (
       select 1 from public.uniform_unit_permissions up
       where up.user_id = p_user_id
         and up.unit_id = p_unit_id
         and (up.can_inspect or up.is_unit_admin)
     ) then
    raise exception 'The Home Unit must be one of the user''s authorized Uniform Inspection units.';
  end if;

  update public.profiles
  set default_unit_id = p_unit_id,
      updated_at = now()
  where id = p_user_id;

  if not found then
    raise exception 'User profile not found.';
  end if;
end;
$$;

revoke execute on function public.uniform_my_profile_v2() from public, anon;
revoke execute on function public.uniform_admin_list_users() from public, anon;
revoke execute on function public.uniform_admin_list_unit_roles() from public, anon;
revoke execute on function public.uniform_admin_set_unit_role(uuid,uuid,text) from public, anon;
revoke execute on function public.uniform_admin_set_app_admin(uuid,boolean) from public, anon;
revoke execute on function public.uniform_admin_set_home_unit(uuid,uuid) from public, anon;

grant execute on function public.uniform_my_profile_v2() to authenticated;
grant execute on function public.uniform_admin_list_users() to authenticated;
grant execute on function public.uniform_admin_list_unit_roles() to authenticated;
grant execute on function public.uniform_admin_set_unit_role(uuid,uuid,text) to authenticated;
grant execute on function public.uniform_admin_set_app_admin(uuid,boolean) to authenticated;
grant execute on function public.uniform_admin_set_home_unit(uuid,uuid) to authenticated;
