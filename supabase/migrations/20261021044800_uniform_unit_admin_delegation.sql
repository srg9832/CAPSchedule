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

  if not caller_is_app_admin
     and p_user_id = auth.uid()
     and p_role <> 'unit_admin' then
    raise exception 'A Unit Admin cannot remove their own Unit Admin access. Another Unit Admin or an Application Admin must do that.';
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

revoke execute on function public.uniform_admin_set_unit_role(uuid,uuid,text) from public, anon;
grant execute on function public.uniform_admin_set_unit_role(uuid,uuid,text) to authenticated;
