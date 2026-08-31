# CAP Schedule

A GitHub Pages + Supabase progressive web application for Civil Air Patrol weekly meeting scheduling and statewide special-activity coordination.

## What is included

### Public Schedule tab
- No login required.
- View any active unit statewide.
- Cadet, Senior, or combined view.
- Opens to the current month automatically.
- Browse historic/future months.
- `Display this schedule by default on this device` saves only to local browser storage; no account is required.
- Displays meeting theme, UOD, time, room, audience, instructor/OPR, category, and per-activity UOD overrides.
- Only published schedules are shown publicly.

### Schedule Planning tab
Visible only to authenticated Editors, Unit Admins, and App Administrators with permission for the selected schedule.

- Separate Cadet and Senior schedules.
- Unit selector is limited to units the editor can edit.
- Monthly planning workflow.
- Automatically generate the unit's normal weekly meeting dates from its configured weekday and hours.
- Holiday recognition warns editors about common/federal holiday dates.
- Multiple reusable rooms/locations per unit.
- Outlook-style resource/time board.
- Drag activities vertically to change time.
- Drag activities horizontally to change rooms.
- Drag the bottom edge to change duration.
- Double-click an activity for details.
- Activity fields: title, start/end, room, category, audience, instructor/OPR, UOD override, notes.
- Live CAP monthly content requirement tracking.
- Validation warnings for room conflicts and instructor double-booking.
- Copy a meeting.
- Copy a prior month.
- Statewide + unit-specific activity library.
- Save an entire meeting as a reusable unit template and apply it to another meeting.
- Draft -> Publish workflow.
- Publishing archives the previous published version rather than overwriting history.

### Special Activities tab
- Public statewide view for non-standard meetings/events.
- Intended for weekend exercises, orientation-flight days, open houses, training events, encampment preparation, color guard events, etc.
- Filter statewide or by unit.
- Editors can create activities for units they can edit.

### Administration tab
- Unit Admin: administers local editors, rooms, themes, uniforms, and unit activity-library items for assigned unit(s).
- App Administrator: all units plus unit creation, role elevation, CAP requirement configuration, and audit log.
- User management is performed through a protected Supabase Edge Function; the service-role key is never exposed in the website.

## Security model

Public users receive read-only access to published schedules and published special activities through Supabase Row Level Security (RLS).

Editor rights are stored per unit:
- `can_edit_cadet`
- `can_edit_senior`
- `is_unit_admin`

An App Administrator is stored in `profiles.is_app_admin`.

The GUI is not the security boundary. RLS and server-side Edge Function checks enforce permissions even if someone manually calls the Supabase API.

## Schedule history model

A month is represented by `schedules` and has many `schedule_versions`.

Typical lifecycle:

1. Editor opens September 2026.
2. CAP Schedule creates or reuses a `draft` version.
3. Changes affect only that draft.
4. Public users continue seeing the currently published version.
5. Editor clicks **Publish Schedule**.
6. Existing `published` version becomes `archived`.
7. Draft becomes `published` and becomes the current public version.
8. Opening the planner later creates a new draft cloned from that published version.

This avoids destroying the schedule that actually existed at the time and supports inspection/history requirements.

# Installation

## 1. Create a Supabase project

Create a new Supabase project and keep the project URL and anon/public key handy.

## 2. Install the database schema

In Supabase:

1. Open **SQL Editor**.
2. Create a new query.
3. Paste the entire contents of `supabase/schema.sql`.
4. Run it.

The script creates tables, RLS policies, planning RPC functions, public views, audit triggers, reference categories, requirement defaults, meeting themes, uniforms, and the initial statewide activity library based on the Excel planning workbook.

## 3. Create the first App Administrator

The application intentionally has no public sign-up page.

1. Supabase -> **Authentication -> Users**.
2. Create your first user.
3. Run this once in SQL Editor, replacing the email:

```sql
update public.profiles
set is_app_admin = true
where id = (select id from auth.users where email = 'YOUR_EMAIL@example.com');
```

After that, use the application's **Administration** tab to create units and manage users.

## 4. Configure Supabase Auth URLs

After you know the GitHub Pages address, set Supabase **Authentication -> URL Configuration -> Site URL** to the CAP Schedule site and add the same site under allowed redirect URLs. Invitation links should return users to CAP Schedule.

When an invited editor follows the invitation link, CAP Schedule will recognize the authenticated Supabase session. The user can click **Account** in the header to establish a password for future normal logins.

## 5. Deploy the admin-users Edge Function

Install/login to the Supabase CLI, link the project, then deploy:

```bash
supabase functions deploy admin-users --project-ref YOUR_PROJECT_REF
```

Function source:

`supabase/functions/admin-users/index.ts`

The hosted Edge Function receives Supabase's service-role secret server-side. Do **not** put a service-role key in `config.js` or any GitHub file.

## 6. Configure the website

Edit `config.js`:

```js
window.CAP_SCHEDULE_CONFIG = {
  supabaseUrl: "https://YOUR_PROJECT.supabase.co",
  supabaseAnonKey: "YOUR_SUPABASE_ANON_KEY",
  appName: "CAP Schedule",
  demoModeWhenUnconfigured: true
};
```

The Supabase anon key is designed for browser use. RLS is what protects the database.

When those two values are blank, CAP Schedule runs in **Demo Mode** using local browser storage so the interface can be tested before Supabase is connected.

## 7. Put the website on GitHub Pages

Upload these website files/folders to the repository root:

- `index.html`
- `styles.css`
- `config.js`
- `manifest.json`
- `service-worker.js`
- `assets/`
- `js/`
- `.nojekyll`

The `supabase/` folder does not need to be served by GitHub Pages, but keeping it in the repository is useful as source control for the database and Edge Function.

Enable GitHub Pages for the repository/branch the same way as the other Supabase/GitHub Pages applications.

## 8. Initial application setup

Log in as the App Administrator and:

1. **Administration -> Units**: create each squadron/unit and set normal weekly meeting day and hours.
2. **Administration -> Rooms**: create rooms/locations for each unit.
3. **Administration -> Users & Permissions**: invite editors and choose Cadet, Senior, Unit Admin permissions.
4. **Administration -> Schedule Settings**: add local themes, uniforms, and reusable activities as desired.
5. **Administration -> CAP Requirements**: verify the seeded requirement values against the regulation/wing policy you want the application to enforce.
6. **Schedule Planning**: generate a month, build the schedule, and publish it.

# PWA / phone installation

The project includes `manifest.json`, an SVG app icon, and `service-worker.js`.

When served over HTTPS (GitHub Pages is HTTPS), supported mobile browsers can install **CAP Schedule** to the home screen. It remains a website backed by Supabase; there is no separate Android/iOS codebase.

The service worker caches the application shell. Schedule data itself is loaded from Supabase; the public default unit preference is stored locally on the device.

# Database overview

Core tables:

- `profiles`
- `units`
- `user_unit_permissions`
- `rooms`
- `activity_categories`
- `training_requirements`
- `meeting_themes`
- `uniforms`
- `activity_library`
- `meeting_templates`
- `meeting_template_events`
- `schedules`
- `schedule_versions`
- `meetings`
- `meeting_events`
- `special_activities`
- `audit_log`

Public-current views:

- `published_meetings_view`
- `published_events_view`

Planning RPCs:

- `get_or_create_schedule_draft`
- `generate_normal_meetings`
- `copy_meeting`
- `save_meeting_as_template`
- `apply_meeting_template`
- `copy_month_into_draft`
- `publish_schedule_version`

# Notes on the Excel workbook translation

The supplied Planning Calendar workbook had four main concepts:

- Yearly calendar / holiday planning
- Monthly meeting schedule with start/end/activity/duration/category
- CAP monthly content requirement tracking (Leadership, Aerospace, Fitness, Character, Safety)
- Activity -> category lookup list

CAP Schedule carries those concepts into the database and interface rather than reproducing spreadsheet cells. Duration is calculated from actual event start/end times, activity categories drive the monthly requirement dashboard, and the workbook's activity list seeds the statewide activity library.

# Current design choices

- Weekly meetings are the core schedule and are planned month-by-month.
- Cadet and Senior schedules are stored independently but can be viewed together.
- Special activities are separate from weekly meeting schedules and are displayed statewide.
- Audience is free text so a unit can use `All Cadets`, `Airmen`, `NCOs`, `Officers`, `Cadet Staff`, `Senior Members`, mission specialties, flights, etc. without requiring an administrator to predefine every possible group.
- Instructor/OPR is free text in this version; conflict checking compares identical instructor names.
- Meeting templates are unit-specific because their room assignments are unit-specific.
- Statewide activity-library defaults coexist with unit-specific activities.
