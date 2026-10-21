create unique index if not exists profiles_member_id_unique_idx
  on public.profiles(member_id)
  where member_id is not null;

create or replace function public.uniform_admin_list_users_v2()
returns table(
  id uuid,
  email text,
  display_name text,
  default_unit_id uuid,
  member_id uuid,
  capid text,
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
    coalesce(p.display_name, u.email)::text,
    p.default_unit_id,
    p.member_id,
    m.capid,
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
    u.created_at
  from auth.users u
  left join public.profiles p on p.id = u.id
  left join public.members m on m.id = p.member_id
  where
    public.is_uniform_app_admin()
    or exists (
      select 1
      from public.uniform_unit_permissions target_access
      join public.uniform_unit_permissions mine
        on mine.unit_id = target_access.unit_id
       and mine.user_id = auth.uid()
       and mine.is_unit_admin
      where target_access.user_id = u.id
        and (target_access.can_inspect or target_access.is_unit_admin)
    )
  order by coalesce(p.display_name, u.email), u.email;
end;
$$;

create or replace function public.uniform_admin_lookup_member(
  p_unit_id uuid,
  p_capid text
)
returns table(
  member_id uuid,
  capid text,
  first_name text,
  last_name text,
  current_grade text,
  primary_unit_id uuid,
  linked_user_id uuid,
  linked_display_name text,
  has_shared_account boolean,
  has_uniform_access_any boolean,
  is_app_admin boolean,
  selected_unit_role text,
  default_unit_id uuid
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $$
begin
  if p_unit_id is null then
    raise exception 'Choose a unit first.';
  end if;

  if not (
    public.is_uniform_app_admin()
    or exists (
      select 1
      from public.uniform_unit_permissions mine
      where mine.user_id = auth.uid()
        and mine.unit_id = p_unit_id
        and mine.is_unit_admin
    )
  ) then
    raise exception 'You are not an administrator for this unit.';
  end if;

  return query
  select
    m.id,
    m.capid,
    m.first_name,
    m.last_name,
    m.current_grade,
    (
      select a.unit_id
      from public.member_unit_assignments a
      where a.member_id = m.id
        and a.active
        and a.is_primary
      order by a.start_date desc, a.created_at desc
      limit 1
    ) as primary_unit_id,
    p.id as linked_user_id,
    p.display_name as linked_display_name,
    (p.id is not null) as has_shared_account,
    case
      when p.id is null then false
      else (
        exists (
          select 1
          from public.uniform_global_permissions g
          where g.user_id = p.id and g.is_app_admin
        )
        or exists (
          select 1
          from public.uniform_unit_permissions up_any
          where up_any.user_id = p.id
            and (up_any.can_inspect or up_any.is_unit_admin)
        )
      )
    end as has_uniform_access_any,
    case
      when p.id is null then false
      else exists (
        select 1
        from public.uniform_global_permissions g
        where g.user_id = p.id and g.is_app_admin
      )
    end as is_app_admin,
    case
      when p.id is null then 'none'
      when exists (
        select 1
        from public.uniform_global_permissions g
        where g.user_id = p.id and g.is_app_admin
      ) then 'application_admin'
      when exists (
        select 1
        from public.uniform_unit_permissions up
        where up.user_id = p.id
          and up.unit_id = p_unit_id
          and up.is_unit_admin
      ) then 'unit_admin'
      when exists (
        select 1
        from public.uniform_unit_permissions up
        where up.user_id = p.id
          and up.unit_id = p_unit_id
          and up.can_inspect
      ) then 'inspector'
      else 'none'
    end::text as selected_unit_role,
    p.default_unit_id
  from public.members m
  left join public.profiles p on p.member_id = m.id
  where trim(m.capid) = trim(p_capid)
  limit 1;
end;
$$;

revoke execute on function public.uniform_admin_list_users_v2() from public, anon;
revoke execute on function public.uniform_admin_lookup_member(uuid,text) from public, anon;

grant execute on function public.uniform_admin_list_users_v2() to authenticated;
grant execute on function public.uniform_admin_lookup_member(uuid,text) to authenticated;
