drop policy if exists uniform_inspections_read on public.uniform_inspections;

create policy uniform_inspections_read
on public.uniform_inspections
for select
to authenticated
using (
  public.is_uniform_app_admin()
  or (
    unit_id is not null
    and public.has_uniform_unit_access(unit_id)
  )
);
