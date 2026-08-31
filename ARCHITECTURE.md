# CAP Schedule Technical Architecture

## Deployment topology

```text
Phone / Tablet / Desktop Browser
          |
          | HTTPS
          v
     GitHub Pages
  HTML / CSS / JavaScript
          |
          | Supabase JS using anon key
          v
       Supabase
  +------------------------+
  | Auth                   |
  | PostgreSQL + RLS       |
  | RPC planning functions |
  | Edge Function          |
  +------------------------+
```

The browser never receives the Supabase service-role key. Normal schedule writes are performed using the signed-in user's JWT and are evaluated by RLS. Auth-user administration is routed through the `admin-users` Edge Function, which independently verifies the caller's role before using server-side admin privileges.

## Role matrix

| Capability | Public | Editor | Unit Admin | App Admin |
|---|---:|---:|---:|---:|
| View published schedules for any unit | Yes | Yes | Yes | Yes |
| View historical published months | Yes | Yes | Yes | Yes |
| View statewide published special activities | Yes | Yes | Yes | Yes |
| Edit assigned Cadet schedule | No | If granted | If granted | Yes |
| Edit assigned Senior schedule | No | If granted | If granted | Yes |
| Publish assigned schedule | No | If granted | If granted | Yes |
| Create unit special activities | No | If unit edit granted | Yes | Yes |
| Manage rooms/themes/uniforms/activity library | No | No | Own unit | All units |
| Invite/grant local editors | No | No | Own unit | All units |
| Grant Unit Admin | No | No | No | Yes |
| Grant App Admin | No | No | No | Yes |
| Create/edit units | No | No | No | Yes |
| Change CAP requirement defaults | No | No | No | Yes |
| View global audit log | No | No | No | Yes |

Cadet and Senior edit rights are independent. A member can therefore be a Cadet-schedule editor for one unit, a Senior-schedule editor for another, both for a third, and have no edit permission elsewhere.

## Primary entities

```text
units
  |-- rooms
  |-- user_unit_permissions -- profiles -- auth.users
  |-- meeting_themes
  |-- uniforms
  |-- activity_library (unit-scoped)
  |-- meeting_templates -- meeting_template_events
  |-- schedules (unit + cadet/senior + year + month)
         |-- schedule_versions
                |-- meetings
                       |-- meeting_events

activity_categories
  |-- training_requirements
  |-- activity_library
  |-- meeting_events

special_activities -- units
```

## Why schedule versions exist

A simple CRUD calendar would make it easy to accidentally change the historical record. CAP Schedule instead models publication as version promotion.

```text
September Schedule
   |
   +-- Version 1 [archived]  <- originally published
   +-- Version 2 [published] <- corrected public schedule
   +-- Version 3 [draft]     <- current editor work, invisible publicly
```

There is at most one working draft returned by the application for a month and one current published version pointed to by `schedules.current_published_version_id`. Older published versions become `archived`, not deleted.

## Public reads

`published_meetings_view` and `published_events_view` expose only the current published version for each unit/program/month. Public users can navigate months without authentication.

Base version/history tables are also RLS-protected so published/archived historical data is readable while drafts remain restricted to authorized editors.

## Draft creation

`get_or_create_schedule_draft(unit, program, year, month)` performs the following atomically on the server:

1. Verifies the user has Cadet/Senior edit rights for that unit.
2. Creates the monthly `schedules` row if needed.
3. Returns an existing draft if present.
4. Otherwise creates the next version number.
5. Clones the current published meetings/events into the new draft.

This lets an editor revise an already-published month without modifying what the public is currently seeing.

## Normal meeting generation

Each unit stores:

- `meeting_weekday` (0 Sunday through 6 Saturday)
- `default_start_time`
- `default_end_time`

`generate_normal_meetings()` inserts missing occurrences of that weekday for the selected month. It never deletes manually added meetings. Holiday recognition is presented as a planning warning so the editor can decide whether the unit cancels, moves, or still holds that meeting.

## Monthly CAP requirements

Each event can have an `activity_category`. The client sums event duration by category for the entire monthly draft.

Seeded workbook-derived defaults:

- Leadership: 90 minutes
- Aerospace: 90 minutes
- Fitness: 45 minutes
- Character: 45 minutes
- Safety: occurrence required rather than a time total

These are data in `training_requirements`, not hard-coded planning constants. App Administrators can change them from the GUI when requirements change.

## Conflict checking

The current client validates within each meeting:

- two activities assigned to the same room at overlapping times;
- the same Instructor/OPR text assigned to overlapping activities.

The design intentionally warns rather than blocks. CAP schedules can contain legitimate exceptions, and the editor remains in control.

## Templates vs activity library

They solve different problems.

**Activity Library** is a reusable single activity, e.g. `Opening Formation`, `Aerospace Lesson`, or `Character Development Module`. Statewide defaults can coexist with local unit entries.

**Meeting Template** is a reusable entire meeting layout: meeting theme, UOD, start/end, all activity blocks, rooms, audiences, instructors, and overrides. Templates are unit-specific because rooms are unit-specific.

## Special activities

`special_activities` intentionally sits outside the weekly meeting-version model. These events may span weekends or multiple hours and are useful for statewide coordination. Public status is explicit (`draft` or `published`). An editor who has either Cadet or Senior schedule edit rights for a unit can plan that unit's special activities.

## Device default

The public default unit and Cadet/Senior/Combined filter are stored in browser `localStorage`:

```text
capSchedule.defaultSchedule
```

This avoids creating accounts for ordinary viewers and makes the preference device/browser-specific as requested.

## PWA

- `manifest.json` provides install metadata.
- `service-worker.js` caches the application shell using a network-first strategy.
- GitHub Pages provides HTTPS, allowing supported phones/tablets to install CAP Schedule to the home screen.

The application remains a web application; changes deploy once and are available to all devices without an app-store release.
