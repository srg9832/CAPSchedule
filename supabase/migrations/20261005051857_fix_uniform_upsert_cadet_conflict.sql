-- Mirrors live Supabase migration 20261005051857: fix_uniform_upsert_cadet_conflict

create or replace function public.uniform_upsert_cadet(
  p_capid text,
  p_first_name text,
  p_last_name text,
  p_grade text,
  p_unit_id uuid
)
returns table (
  id uuid,
  capid text,
  first_name text,
  last_name text,
  name text,
  grade text,
  current_unit_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  v_member_id uuid;
  v_current_unit uuid;
begin
  if auth.uid() is null then raise exception 'Authentication required.'; end if;
  if p_unit_id is null or not public.has_uniform_unit_access(p_unit_id) then
    raise exception 'You do not have Uniform Inspection access to this unit.';
  end if;
  if nullif(trim(p_capid),'') is null then raise exception 'CAPID is required.'; end if;

  insert into public.members(capid,first_name,last_name,member_type,active,current_grade,created_at,updated_at)
  values(trim(p_capid),trim(coalesce(p_first_name,'')),trim(coalesce(p_last_name,'')),'Cadet',true,nullif(trim(coalesce(p_grade,'')),''),now(),now())
  on conflict on constraint members_capid_key do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name,
    current_grade = coalesce(excluded.current_grade,public.members.current_grade),
    active = true,
    updated_at = now()
  returning public.members.id into v_member_id;

  select a.unit_id into v_current_unit
  from public.member_unit_assignments a
  where a.member_id=v_member_id and a.active and a.is_primary
  limit 1;

  if v_current_unit is null then
    insert into public.member_unit_assignments(member_id,unit_id,is_primary,active,start_date)
    values(v_member_id,p_unit_id,true,true,current_date);
  elsif v_current_unit <> p_unit_id and public.is_uniform_app_admin() then
    update public.member_unit_assignments
      set active=false,is_primary=false,end_date=coalesce(end_date,current_date),updated_at=now()
    where member_id=v_member_id and active and is_primary;
    insert into public.member_unit_assignments(member_id,unit_id,is_primary,active,start_date)
    values(v_member_id,p_unit_id,true,true,current_date);
  end if;

  return query
  select c.id,c.capid,c.first_name,c.last_name,c.name,c.grade,c.current_unit_id
  from public.uniform_cadets c
  where c.id=v_member_id;
end;
$$;

revoke execute on function public.uniform_upsert_cadet(text,text,text,text,uuid) from public,anon;
grant execute on function public.uniform_upsert_cadet(text,text,text,text,uuid) to authenticated;
