-- Applied live to Supabase project vosvdkkuiijywwmqzdiu on 2026-10-05.
-- Shared CAP applications security hardening.
-- Preserves CAP Schedule, Leadership Feedback, and Drill Test Manager behavior.

revoke insert, update, delete, truncate, references, trigger
on all tables in schema public
from anon;

revoke all privileges
on all sequences in schema public
from anon;

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;

alter default privileges for role postgres in schema public
  revoke usage, select, update on sequences from anon;

alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon;

revoke all privileges on table public.profiles from anon;

revoke insert, delete, truncate, references, trigger on table public.profiles from authenticated;
revoke update on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update(display_name, default_unit_id) on table public.profiles to authenticated;

drop policy if exists drill_tests_public_active on public.drill_test_definitions;
create policy drill_tests_public_active
on public.drill_test_definitions
for select
to anon
using (active);

revoke all privileges on table public.drill_test_definitions from anon;
grant select (
  id, code, label, topic, conditions, source_page, sequence,
  display_order, version, updated_at, active
) on table public.drill_test_definitions to anon;

revoke all privileges on table public.drill_test_items from anon;

alter view public.drill_public_sequences set (security_invoker = true);
revoke all privileges on table public.drill_public_sequences from anon, authenticated;
grant select on table public.drill_public_sequences to anon, authenticated;

alter function public.set_updated_at() set search_path = pg_catalog;

revoke execute on function public.get_or_create_schedule_draft(uuid, public.schedule_program, integer, integer) from public, anon;
grant execute on function public.get_or_create_schedule_draft(uuid, public.schedule_program, integer, integer) to authenticated;

revoke execute on function public.generate_normal_meetings(uuid) from public, anon;
grant execute on function public.generate_normal_meetings(uuid) to authenticated;

revoke execute on function public.set_schedule_meeting_weekday(uuid, integer) from public, anon;
grant execute on function public.set_schedule_meeting_weekday(uuid, integer) to authenticated;

revoke execute on function public.sync_normal_meetings(uuid) from public, anon;
grant execute on function public.sync_normal_meetings(uuid) to authenticated;

revoke execute on function public.copy_meeting(uuid, date) from public, anon;
grant execute on function public.copy_meeting(uuid, date) to authenticated;

revoke execute on function public.save_meeting_as_template(uuid, text) from public, anon;
grant execute on function public.save_meeting_as_template(uuid, text) to authenticated;

revoke execute on function public.apply_meeting_template(uuid, uuid) from public, anon;
grant execute on function public.apply_meeting_template(uuid, uuid) to authenticated;

revoke execute on function public.copy_month_into_draft(uuid, integer, integer) from public, anon;
grant execute on function public.copy_month_into_draft(uuid, integer, integer) to authenticated;

revoke execute on function public.publish_schedule_version(uuid) from public, anon;
grant execute on function public.publish_schedule_version(uuid) to authenticated;

revoke execute on function public.replace_schedule_draft_from_json(uuid, public.schedule_program, integer, integer, jsonb) from public, anon;
grant execute on function public.replace_schedule_draft_from_json(uuid, public.schedule_program, integer, integer, jsonb) to authenticated;

revoke execute on function public.replace_special_activity_from_json(uuid, jsonb) from public, anon;
grant execute on function public.replace_special_activity_from_json(uuid, jsonb) to authenticated;

revoke execute on function public.get_contact_hour_compliance(uuid) from public, anon;
grant execute on function public.get_contact_hour_compliance(uuid) to authenticated;

revoke execute on function public.audit_row_change() from public, anon;
grant execute on function public.audit_row_change() to authenticated;

revoke execute on function public.handle_new_user() from public, anon;
grant execute on function public.handle_new_user() to authenticated;

revoke execute on function public.seed_default_schedule_groups() from public, anon;
grant execute on function public.seed_default_schedule_groups() to authenticated;

revoke execute on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon, authenticated;

revoke execute on function public.is_unit_admin(uuid) from public;
grant execute on function public.is_unit_admin(uuid) to anon, authenticated;

revoke execute on function public.has_unit_edit(uuid, public.schedule_program) from public;
grant execute on function public.has_unit_edit(uuid, public.schedule_program) to anon, authenticated;

revoke execute on function public.can_access_schedule_version(uuid) from public;
grant execute on function public.can_access_schedule_version(uuid) to anon, authenticated;

revoke execute on function public.can_edit_special_activity(uuid) from public;
grant execute on function public.can_edit_special_activity(uuid) to anon, authenticated;

revoke execute on function public.can_edit_schedule_version(uuid) from public, anon;
grant execute on function public.can_edit_schedule_version(uuid) to authenticated;

revoke execute on function public.can_edit_meeting(uuid) from public, anon;
grant execute on function public.can_edit_meeting(uuid) to authenticated;
