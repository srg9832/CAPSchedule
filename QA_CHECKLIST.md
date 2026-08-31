# CAP Schedule QA Checklist

## Public
- [ ] Page opens without login.
- [ ] All active units appear in public unit selector.
- [ ] Cadet / Senior / Combined filters work.
- [ ] Current month opens automatically.
- [ ] Previous/next months load.
- [ ] Device default persists after browser reload.
- [ ] Draft content never appears publicly.
- [ ] Published special activities are visible statewide.
- [ ] Print Schedule produces a clean schedule without application controls.

## Editor permissions
- [ ] Cadet-only editor cannot modify Senior schedule.
- [ ] Senior-only editor cannot modify Cadet schedule.
- [ ] Editor cannot select/edit an unauthorized unit.
- [ ] Editor cannot write directly through Supabase API outside RLS permissions.

## Planner
- [ ] Normal weekly dates generate correctly.
- [ ] Holiday date receives planning warning.
- [ ] Add manual meeting works.
- [ ] Cancel/restore meeting works.
- [ ] Theme/UOD/times save.
- [ ] Add event works.
- [ ] Drag event changes time.
- [ ] Drag event across room changes room.
- [ ] Resize event changes end time.
- [ ] Double-click event edits details.
- [ ] Instructor/audience/UOD override save.
- [ ] Requirement totals update.
- [ ] Room conflict warning appears.
- [ ] Instructor conflict warning appears.
- [ ] Copy Meeting works.
- [ ] Copy Month works.
- [ ] Save Meeting Template works.
- [ ] Apply Meeting Template works.
- [ ] Publish hides draft and updates public schedule.
- [ ] Editing after publication creates a new draft rather than changing public record.

## Unit Admin
- [ ] Can administer only assigned unit(s).
- [ ] Can add rooms.
- [ ] Can add local themes/uniforms/activity-library items.
- [ ] Can invite/grant Cadet/Senior editors.
- [ ] Cannot grant Unit Admin.
- [ ] Cannot grant App Admin.
- [ ] Cannot create/edit another unit.

## App Admin
- [ ] Can create/edit units.
- [ ] Can manage any unit.
- [ ] Can grant Unit Admin.
- [ ] Can grant/remove App Admin.
- [ ] Can edit CAP requirement values.
- [ ] Can view audit log.

## Mobile/PWA
- [ ] Layout usable on phone portrait mode.
- [ ] Schedule table remains readable.
- [ ] Planner horizontally scrolls when many rooms exist.
- [ ] Home-screen installation is offered/supported.
- [ ] App shell reloads after normal deployment/cache refresh.
