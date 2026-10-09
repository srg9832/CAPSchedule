# CAP Messenger — proof of concept

This is a standalone web/PWA application in the `/messenger/` folder of the CAP Schedule GitHub Pages repository. It **does not alter** the working CAP Schedule app. A dedicated repository can be created and the folder moved later.

**Site (once GitHub Pages finishes deploying):** https://srg9832.github.io/CAPSchedule/messenger/

**Backend:** Supabase project `Uniform Inspections` (`uekiecpijomfhezwllst`), using distinct `public.msg_*` tables, functions and a private `msg-attachments` storage bucket. Existing Uniform Inspections data was **not deleted or modified**. CAP Applications is untouched.

## Current features

- Sign in / sign up with Supabase email/password and email confirmation; registration must match an imported CAPWATCH member or guardian email, then be approved by a unit admin.
- Existing authorized application administrator account has been initialized using the former Uniform Inspections admin email.
- Multi-file TXT/CSV CAPWATCH roster import, joined by CAPID with validation preview; optional **complete snapshot** mode disables members who vanish from included units (with a shrinkage safety check).
- Unit administrator verification and local deactivation, unaffected by future roster imports.
- Four auto-created squadron groups: All Members, Seniors, Cadets, Parents & Senior Members.
- Direct and custom chats with server-enforced participant rules. Senior–cadet direct chats are blocked; cadet–cadet, senior–senior and parent–senior direct chats permitted; parents can only message their own cadet directly. Mixed senior/cadet custom groups require two senior members. Multiple parents cannot form private groups.
- Wing, squadron, and parent bulletin boards with comments.
- Drill Test / Leadership Feedback simple request queue, independent of existing apps.
- Small private attachment uploads with Supabase Storage controls.
- Offline outbox that retries text-only messages when the already-open app reconnects (24-hour expiration). Uses device localStorage. Service worker caches only app shell and JavaScript CDN assets, never private Supabase responses.
- Mobile responsive UI and basic web-app manifest. CAP Schedule opens in a new tab.
- Application admin can switch unit context and designate other unit admins.

## Native CAPWATCH Member.txt + MbrContact.txt import

The importer now consumes **the original extracted CAPWATCH TXT files**, not a manually created roster CSV. Select **Member.txt** and **MbrContact.txt** (the spelling **MbrContacts.txt** also works) together in Administration → Import CAPWATCH files. You may select additional .txt/.csv files; unrelated filenames are skipped without reading their contents. Raw ZIP files must be extracted first.

The CAPWATCH layouts used are:

```text
Member.txt:
CAPID,SSN,NameLast,NameFirst,NameMiddle,NameSuffix,Gender,DOB,Profession,EducationLevel,Citizen,ORGID,Wing,Unit,Rank,Joined,Expiration,OrgJoined,UsrID,DateMod,LSCode,Type,RankDate,Region,MbrStatus,PicStatus,PicDate,CdtWaiver,Ethnicity

MbrContact.txt:
CAPID,Type,Priority,Contact,UsrID,DateMod,DoNotContact,ContactName
```

Mapping:
- `Member.CAPID` → `MbrContact.CAPID`. Identifiers including leading zeros remain text.
- `NameLast`, `NameFirst` and `Rank` → sender display `Rank Last, First`.
- `Member.Type` determines CADET or SENIOR.
- `Member.ORGID` is the stable squadron identifier. `Wing` + `Unit` form the readable unit label.
- `MbrContact.Type = EMAIL` supplies the member's login address. `Priority = PRIMARY` wins, then SECONDARY; lower-ranked email types are fallback only.
- `MbrContact.Type = CADET PARENT EMAIL` supplies one or more distinct parent/guardian emails, ordered PRIMARY then SECONDARY then EMERGENCY. Other contact types, including phones, are not used.
- Contact records with `DoNotContact` flagged true are not chosen as email addresses.
- If a member has no usable email, the roster entry is still imported, but they **cannot register** until their address is corrected in eServices and a new import is run.
- `Member.MbrStatus` is used to recognize obvious inactive/expired/terminated/suspended/deceased statuses; absent members can be deactivated by the explicit full-snapshot option.

**Sensitive information:** CAPWATCH `SSN`, date of birth, gender, ethnicity, and other unused columns are ignored in the normalized import, which uploads only selected fields needed for membership, communications and guardian relationships. The preview shows no SSN. No raw CAPWATCH text file is uploaded to Supabase. Source text is parsed in the user's browser memory.

The tool performs column and contact-type validation and provides a preview. It has been verified with **synthetic rows using the exact published header layouts**, not with the user's actual CAPWATCH export bytes. Confirm the preview against a real extract before committing a full snapshot.

## First setup/test

1. Open the site and sign in with the **existing application administrator account** from the old Uniform Inspections Supabase project. It has been granted Messenger platform administrator access. Don't post real member data yet.
2. In Supabase Dashboard → **Authentication → URL Configuration**, add `https://srg9832.github.io/CAPSchedule/messenger/` to the redirect allow list and consider setting it as the Site URL now that the old inspection app has been migrated. This connection cannot modify Auth URL settings automatically.
3. In Messenger → Administration → Import CAPWATCH, select Member.txt plus MbrContact.txt (or MbrContacts.txt) together. Review the joined roster, member email and guardian email counts, and warnings before confirming.
4. Do a **partial** import first to establish member records without deactivating anybody. Only check full snapshot after verifying the Member.txt roster is complete for every included unit.
5. Approved/verified member emails can then sign up, confirm their emails, and retry registration. The platform admin or assigned unit administrator reviews them in Administration.
6. Use the squadron selector at the top of the app to operate in a unit.
7. Test group messaging, boards, and requests with clearly fictional accounts.

## CSV assumptions and cautions

The importer explicitly recognizes Member.txt and MbrContact.txt headers described above, with all CAPWATCH identifiers preserved as text. An additional template CSV is available for development, but no export transformation is necessary for the two named CAPWATCH text files. Never import dummy sample data into real membership.

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


## Member names, photos and removal behavior (October 2026)

- Grade and first/last names come from imported CAPWATCH data; the display format is `Grade Last, First`. Members cannot edit their own imported grade or name.
- A member may upload an optional profile photo in Settings. The browser resizes/crops it to 256×256 JPEG and strips embedded image metadata by re-encoding. Photos use a private Supabase Storage bucket; absent photos use initials. Old photos are no longer readable by normal clients after replacement/removal, but still require eventual storage cleanup.
- Members may edit or remove their own messages. Unit administrators may remove messages from their units; the application administrator may remove any accessible conversation message. Original text stays in RLS-protected, non-client-readable revision tables. Bulletin posts and comments can be removed by their authors or eligible administrators.
- Application administrator accounts are protected against deactivation or demotion through both the web UI and a database trigger. Intentional removal requires separate privileged database maintenance.
- Unit admins can change mandatory cadet quiet hours. All users can save additional quiet periods that expire automatically. **Notifications are not yet implemented**, so these preferences don't currently silence any active push service.
- CAPWATCH import accepts Member.txt and MbrContact.txt/MbrContacts.txt selected together, joins member and contact records by CAPID, and uses ORGID for unit membership. It does not currently accept ZIP files. Unrelated text extracts are ignored, and the original Member.txt SSN/DOB and other unused fields are not uploaded. Review unmatched or incomplete records before importing; contact and parent email fields must be present in the source.
