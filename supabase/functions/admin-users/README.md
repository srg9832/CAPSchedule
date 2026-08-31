# admin-users Edge Function

Deploy after the database schema is installed:

```bash
supabase functions deploy admin-users --project-ref YOUR_PROJECT_REF
```

Supabase automatically provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to hosted Edge Functions.

The function verifies the caller's JWT and enforces role boundaries server-side:
- App Administrator: may manage all users/units and grant Unit Admin or App Admin.
- Unit Administrator: may invite users and grant Cadet/Senior editor access only for their own unit; cannot promote another Unit Admin or App Admin.
