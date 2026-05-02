# Runbook

Day-in-the-life operations for the Attendance Recorder. Use this when on-call.

## Stack at a glance

| Layer                            | Service                                         | URL (local)                                             | URL (cloud dev)                                      |
|----------------------------------|-------------------------------------------------|---------------------------------------------------------|------------------------------------------------------|
| Frontend                         | Cloudflare Pages (prod) / Vite dev (`pnpm dev`) | http://localhost:5175                                   | (same — Vite dev points at cloud via `--mode cloud`) |
| API + Auth + Storage + Functions | Supabase                                        | http://127.0.0.1:54321                                  | https://&lt;ref&gt;.supabase.co                      |
| DB                               | Postgres (in Docker locally)                    | postgresql://postgres:postgres@127.0.0.1:54322/postgres | (managed; `npx supabase db remote-connect-string`)   |
| Studio                           | Supabase Studio                                 | http://127.0.0.1:54323                                  | https://supabase.com/dashboard/project/&lt;ref&gt;   |

## Cloud dev project — first-time setup (~30 min)

These steps stand up a hosted Supabase project on supabase.com used **only as a dev environment** (not prod). The local Docker stack stays the inner-loop dev target; cloud is for off-laptop demos and real-device camera/GPS testing. Mirrors M20 plan; defer to that file for context.

### Defaults assumed (call out if different)
- Region: `ap-south-1` (Mumbai)
- Tier: Free
- Project name: `attendance-recorder-dev`

### 1. Create the project
1. https://supabase.com → sign in with GitHub.
2. **New project** → name `attendance-recorder-dev`, generate DB password (store in your password manager), region Mumbai, plan Free.
3. After provisioning (~2 min), capture from **Project Settings → API**:
   - Project URL: `https://<ref>.supabase.co`
   - `anon` / publishable key (`sb_publishable_…`)
   - `service_role` key (server-only, **never** ship to the browser)

### 2. Enable extensions
Studio → **Database → Extensions**, toggle ON: `postgis`, `pgcrypto`, `pg_cron`, `pg_net`, `uuid-ossp`. Migration `0001_init.sql` line 5 will fail otherwise.

### 3. Configure Auth
Studio → **Authentication → Providers → Email**:
- Enable email signup: **ON** (worker register flow uses synthetic-email signup; do not mirror `config.toml`'s `enable_signup = false`, that's local-only).
- Confirm email: **OFF** (synthetic emails can't receive real mail).
- Min password length: 6.

Studio → **Authentication → URL Configuration**: site URL `http://localhost:5173`; add `5174`/`5175` to redirect URLs. Add Pages domain when prod ships.

### 4. Link the CLI
```bash
npx supabase login                       # browser flow
npx supabase link --project-ref <ref>    # writes supabase/.temp/project-ref
npx supabase projects list               # verify
```

### 5. Apply migrations
```bash
npx supabase db push
```
Walks `supabase/migrations/*.sql` in order. The four-digit naming (`0001_init.sql` … `0020_safe_timezone.sql`) sorts correctly — no rename needed. If `db push` rejects them, follow the rename one-liner in `~/.claude/plans/i-need-to-build-binary-giraffe.md` §Risks.

### 6. Verify Storage bucket exists
Migration `0006_storage_buckets.sql` creates the `selfies` bucket. Verify:
```bash
npx supabase db remote query "select id, public from storage.buckets;"
# expect: selfies | f
```
If missing, Studio → **Storage → New bucket → name `selfies` → private**.

### 7. Set Edge Function secrets
```bash
npx supabase secrets set \
  SUPABASE_URL=https://<ref>.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=<service-role> \
  SUPABASE_ANON_KEY=<anon> \
  ATT_MAX_GPS_ACCURACY_M=100 \
  ATT_DRIVING_THRESHOLD_MS=2.222 \
  ATT_IMPLAUSIBLE_SPEED_MS=33 \
  ATT_GEOFENCE_FAR_THRESHOLD_M=30 \
  ATT_BUDDY_PUNCH_WINDOW_HRS=12 \
  ATT_SELFIES_BUCKET=selfies \
  ATT_MIN_PIN_LENGTH=4 \
  ATT_MAX_PIN_LENGTH=6 \
  ATT_EMIT_PUNCH_ACCESS_EVENT=true

npx supabase secrets list                # verify
```

### 8. Deploy the 6 Edge Functions
```bash
npx supabase functions deploy worker-register
npx supabase functions deploy worker-pin-reset
npx supabase functions deploy punch-submit
npx supabase functions deploy payroll-export
npx supabase functions deploy auto-close-shifts
npx supabase functions deploy selfie-retention-cron
```
Each function bundles the `_shared/config.ts` + `_shared/log.ts` helpers automatically via the relative imports.

### 9. Seed dev data
```bash
psql "$(npx supabase db remote-connect-string)" -f supabase/seed.sql
```
Inserts the 1 project + 1 site + 3 workers (Ravi/Priya/Anil) used by the local seed.

### 10. Schedule crons
Studio → SQL Editor (replace `<ref>` and `<service-role>`):
```sql
select cron.schedule('auto-close-shifts', '*/30 * * * *',
  $$ select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/auto-close-shifts',
       headers := jsonb_build_object('Authorization', 'Bearer <service-role>')
     ) $$);

select cron.schedule('selfie-retention-cron', '0 3 * * *',
  $$ select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/selfie-retention-cron',
       headers := jsonb_build_object('Authorization', 'Bearer <service-role>')
     ) $$);
```
Verify: `select jobname, schedule from cron.job;`.

### 11. Wire Vite to cloud (without touching `apps/web/.env.local`)
Create `apps/web/.env.cloud` (gitignore — see root `.gitignore`):
```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```
Run dev against cloud:
```bash
cd apps/web
pnpm dev --mode cloud
```
`pnpm dev` (no `--mode`) still runs against local Docker. The two flows can be open in different terminals on different ports without conflict.

### 12. Smoke test
1. http://localhost:5173 → register `Ravi Kumar` with PIN `1234`.
2. Studio → **Authentication → Users** — should show `33333333-…@worker.local`.
3. Approve in `/supervisor/approvals`.
4. Punch in → check `attendance` row in Studio → check `selfies` bucket has the photo.
5. `/admin/traffic` should show `page_view` and `login` rows in `access_events`.

### 13. Tail edge function logs (verify M20 logging works)
```bash
npx supabase functions logs punch-submit --tail
```
Each call now emits a structured JSON line per `step` (e.g. `{"level":"info","fn":"punch-submit","step":"done", …}`). On error, you get the offending step + stack frames; PII (PIN, selfie data URL) is redacted by `_shared/log.ts`.

---

## Daily checks (5 minutes)

1. **Open Studio → Authentication → Users.** Spot any unfamiliar accounts? If yes, suspend immediately and audit.
2. **Open the Reports page** (or run `select status, count(*) from attendance where punched_at >= current_date group by 1`). Anything in `auto_closed` or `pending` blocks payroll — clear before month-end.
3. **Pending approvals** queue (`/supervisor/approvals`). Triage within 24h.
4. **Audit log** scroll: any `gdpr_erase`, `reject_worker`, or unexpected `update_site` actions? Verify with the supervisor who performed them.

## Deploys

### Frontend (Cloudflare Pages)
- Push to `main` → auto-build (`pnpm build`) → publish.
- Env: set `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Pages project settings.
- Roll back: Pages dashboard → Deployments → Rollback to a previous green build.

### Supabase migrations
```bash
npx supabase link --project-ref <ref>
npx supabase db push
```
Always read the diff Supabase prints before confirming. **Never run `db reset` against production** — that wipes data.

### Edge Functions
```bash
npx supabase functions deploy worker-register
npx supabase functions deploy worker-pin-reset
npx supabase functions deploy punch-submit
npx supabase functions deploy payroll-export
npx supabase functions deploy auto-close-shifts
npx supabase functions deploy selfie-retention-cron
```

To tail logs after a deploy (M20 added structured JSON lines to all six):
```bash
npx supabase functions logs <name> --tail
```

Set secrets once per project:
```bash
npx supabase secrets set SUPABASE_URL=https://<ref>.supabase.co
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<from dashboard>
npx supabase secrets set SUPABASE_ANON_KEY=<from dashboard>
```

### Cron schedules (one-time setup in Supabase SQL Editor)

```sql
-- Auto-close forgotten punch-outs every 30 min
select cron.schedule(
  'auto-close-shifts',
  '*/30 * * * *',
  $$ select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/auto-close-shifts',
       headers := jsonb_build_object('Authorization', 'Bearer <service-role>')
     ) $$
);

-- Daily selfie retention sweep at 03:00 UTC
select cron.schedule(
  'selfie-retention-cron',
  '0 3 * * *',
  $$ select net.http_post(
       url := 'https://<ref>.supabase.co/functions/v1/selfie-retention-cron',
       headers := jsonb_build_object('Authorization', 'Bearer <service-role>')
     ) $$
);
```

## Common incidents

### "I can't punch in"
1. Worker on the right device? Check `device_logs` for them in the last hour.
2. Locked out? `select id, full_name, locked_until, failed_login_count from workers where full_name ilike '%name%';` → if `locked_until > now()`, admin clicks Reset lockout in `/admin/workers`.
3. Status = `pending_approval`? They register but supervisor never approved. Approve in `/supervisor/approvals`.
4. Selfie permission denied in browser? Worker re-grants in browser settings. If they're on a legacy WebView, ask them to use Chrome / Safari.
5. GPS permission denied? Punch will be flagged `low_gps_accuracy`. Supervisor decides.

### "My punch is flagged but I was on site"
- Open the row in `/supervisor/dashboard`. Read `flag_reasons`. Common false positives:
  - `edge_tolerance` — worker just outside the polygon, harmless. One-tap verify.
  - `low_gps_accuracy` — phone GPS is poor that day. Verify if other signals match (selfie, time of day).
  - `new_device` — legitimate phone change. Verify, and flag the worker so the supervisor expects it next time.

### Storage usage approaching free-tier limit
- Studio → Storage → Usage. If > 800 MB:
  1. Run the `selfie-retention-cron` ad-hoc: `curl -X POST $URL/functions/v1/selfie-retention-cron -H "Authorization: Bearer $SERVICE_KEY"`.
  2. If still tight, lower `projects.retention_days.routine` from 90 → 60 for a project. Cron picks up the new value.
  3. Persistent growth → migrate the `selfies` bucket to Cloudflare R2 (10 GB free); store URL in `attendance.selfie_url` instead of bucket key.

### Edge Function 5xx
1. `npx supabase functions logs <name> --tail` (cloud) or check the local edge runtime container logs.
2. Most common: `SUPABASE_SERVICE_ROLE_KEY` not set, or `SUPABASE_URL` mismatched between secrets and the project.
3. Re-deploy after env fix; wait 30s.

### Worker offboarding (departure)
1. `/admin/workers` → Offboard.
2. Their auth user remains (so historical attendance is queryable). Run a separate "GDPR erase" if they request data deletion (admin action; see `docs/feat-selfie-storage-lifecycle.md`).

## Backups

Supabase Pro tier: daily automatic backups, 7-day retention. Free tier: no managed backups; for prod, take a daily `pg_dump` on a schedule and write to S3/R2.

## Rotating compromised keys

1. Studio → Project Settings → API → "Generate new keys".
2. Update Cloudflare Pages env (publishable key).
3. Update `npx supabase secrets set` (service role + anon).
4. Re-deploy all Edge Functions so they pick up the new env.
5. Force-sign-out all users: `select auth.sign_out(id) from auth.users;` (or invalidate the JWT signing key).

## Observability TODO (post-MVP)

- Wire **Sentry** in `apps/web/src/main.tsx` (5k events/mo free).
- Cron heartbeat: have `auto-close-shifts` POST to a Health checks.io URL on success. Free.
- Database alerts: Studio → Reports → "DB CPU > 70%" — opt-in.
