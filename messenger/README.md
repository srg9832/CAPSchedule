# CAP Messenger — proof of concept

This is a standalone web/PWA application in the `/messenger/` folder of the CAP Schedule GitHub Pages repository. It **does not alter** the working CAP Schedule app. A dedicated repository can be created and the folder moved later.

**Site (once GitHub Pages finishes deploying):** https://srg9832.github.io/CAPSchedule/messenger/

**Backend:** Supabase project `Uniform Inspections` (`uekiecpijomfhezwllst`), using distinct `public.msg_*` tables, functions and a private `msg-attachments` storage bucket. Existing Uniform Inspections data was **not deleted or modified**. CAP Applications is untouched.

## Current features

- Sign in / sign up with Supabase email/password and email confirmation; registration must match an imported CAPWATCH member or guardian email, then be approved by a unit admin.
- Existing authorized application administrator account has been initialized using the former Uniform Inspections admin email.
- CSV CAPWATCH roster import; optional **complete snapshot** mode disables members who vanish from included units (with a shrinkage safety check).
- Unit administrator verification and local deactivation, unaffected by future roster imports.
- Four auto-created squadron groups: All Members, Seniors, Cadets, Parents & Senior Members.
- Direct and custom chats with server-enforced participant rules. Senior–cadet direct chats are blocked; cadet–cadet, senior–senior and parent–senior direct chats permitted; parents can only message their own cadet directly. Mixed senior/cadet custom groups require two senior members. Multiple parents cannot form private groups.
- Wing, squadron, and parent bulletin boards with comments.
- Drill Test / Leadership Feedback simple request queue, independent of existing apps.
- Small private attachment uploads with Supabase Storage controls.
- Offline outbox that retries text-only messages when the already-open app reconnects (24-hour expiration). Uses device localStorage. Service worker caches only app shell and JavaScript CDN assets, never private Supabase responses.
- Mobile responsive UI and basic web-app manifest. CAP Schedule opens in a new tab.
- Application admin can switch unit context and designate other unit admins.

## First setup/test

1. Open the site and sign in with the **existing application administrator account** from the old Uniform Inspections Supabase project. It has been granted Messenger platform administrator access. Don't post real member data yet.
2. In Supabase Dashboard → **Authentication → URL Configuration**, add `https://srg9832.github.io/CAPSchedule/messenger/` to the redirect allow list and consider setting it as the Site URL now that the old inspection app has been migrated. This connection cannot modify Auth URL settings automatically.
3. In Messenger → Administration → Import CAPWATCH, use a CSV with these exact columns: `CAPID,Name,Email,Kind,Unit,Unit Name,Parent Email,Active`. Use `senior` or `cadet` in Kind, and `true` or `false` in Active.
4. Do a **partial** import first to establish member records without deactivating anybody. Only check full snapshot after confirming the extract is complete for every included unit.
5. Approved/verified member emails can then sign up, confirm their emails, and retry registration. The platform admin or assigned unit administrator reviews them in Administration.
6. Use the squadron selector at the top of the app to operate in a unit.
7. Test group messaging, boards, and requests with clearly fictional accounts.

## CSV assumptions and cautions

The proof-of-concept parser accepts some alternate headers but is **not** a certified raw CAPWATCH parser. Adapt your PowerShell export to the columns in `capwatch-template.csv`. Parent emails come solely from this import. Never import dummy sample data into real membership.

The optional **full snapshot** processes only units represented in the CSV; if a unit is entirely absent from a partial source, it is not deleted. It rejects a greater-than-25% membership reduction (for units with five or more existing active members) until reviewed. Local deactivations always remain in place.

## Before using real CAP data

- This is **not** a finished, approved CAP communications system.
- Existing legacy inspection data and functions are still in the reused Supabase project. Audit or archive the old application before real membership data or public account signup.
- The application currently relies on Supabase encryption at rest and RLS; **application-layer message encryption and customer-separated decryption keys are not implemented**.
- Mobile push notifications, real quiet-hour enforcement, AI weekly summaries/safety flagging, retention/legal holds, Teams calls, native apps, robust attachment scanning, and fully tested group safety over membership changes are **not implemented yet**.
- No end-to-end browser suite, external Pages uptime check, or adversarial penetration test has been performed. The backend was checked using restricted-role read tests, and the JavaScript was syntax-checked.
- A real rollout needs review of CAP membership/guardian data permission, record retention, and cadet protection requirements.

## Data storage

Text lives in `msg_messages` / `msg_posts`, request queues in `msg_requests`, and media in private Supabase Storage. The app stores only the Supabase **publishable key** in its public source; no service-role key is distributed.

## Planned next milestones

1. Validate authentic CAPWATCH export headers and implement reliable authorized PowerShell import, audit, deactivation, and guardian consistency.
2. Improve participant roster management and lifecycle safety, attachment antivirus and photo metadata sanitization.
3. Add stronger encryption/key management and retention controls.
4. Build push delivery and quiet-hour enforcement (9 PM–8 AM mandatory for cadets).
5. Implement restricted, reviewable AI weekly operations overview and safety incident workflow.
6. Package Android/iPhone builds only after mobile web testing.
