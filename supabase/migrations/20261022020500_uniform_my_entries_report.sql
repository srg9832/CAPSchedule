create or replace function public.uniform_my_entries()
returns table(
  id bigint,
  member_id uuid,
  unit_id uuid,
  inspection_date date,
  grade_at_inspection text,
  grade_group text,
  personal_appearance smallint,
  garments smallint,
  accoutrements smallint,
  footwear smallint,
  military_bearing smallint,
  total_score smallint,
  overall_rating text,
  passed boolean,
  notes text,
  evaluator_user_id uuid,
  evaluator_name text,
  created_at timestamptz,
  capid text,
  first_name text,
  last_name text,
  current_grade text,
  unit_charter_number text,
  unit_name text
)
language sql
stable
security definer
set search_path = pg_catalog
as $$
  select
    i.id,
    i.member_id,
    i.unit_id,
    i.inspection_date,
    i.grade_at_inspection,
    i.grade_group,
    i.personal_appearance,
    i.garments,
    i.accoutrements,
    i.footwear,
    i.military_bearing,
    i.total_score,
    i.overall_rating,
    i.passed,
    i.notes,
    i.evaluator_user_id,
    i.evaluator_name,
    i.created_at,
    m.capid,
    m.first_name,
    m.last_name,
    m.current_grade,
    u.charter_number,
    u.name
  from public.uniform_inspections i
  left join public.members m on m.id = i.member_id
  left join public.units u on u.id = i.unit_id
  where i.evaluator_user_id = auth.uid()
    and public.has_uniform_any_access()
  order by i.inspection_date desc, i.created_at desc;
$$;

revoke execute on function public.uniform_my_entries() from public, anon;
grant execute on function public.uniform_my_entries() to authenticated;
