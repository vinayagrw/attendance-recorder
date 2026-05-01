# Runbook

Day-in-the-life operations for the Attendance Recorder. Use this when on-call.

## Stack at a glance

| Layer | Service | URL (local) |
|---|---|---|
| Frontend | Cloudflare Pages (prod) / Vite dev (`pnpm dev`) | http://localhost:5175 |
| API + Auth + Storage + Functions | Supabase | http://127.0.0.1:54321 |
| DB | Postgres (in Docker locally) | postgresql://postgres:postgres@127.0.0.1:54322/postgres |
| Studio | Supabase Studio | http://127.0.0.1:54323 |

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
npx supabase functions deploy punch-submit
npx supabase functions deploy payroll-export
npx supabase functions deploy auto-close-shifts
npx supabase functions deploy selfie-retention-cron
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
- Cron heartbeat: have `auto-close-shifts` POST to a Healthchecks.io URL on success. Free.
- Database alerts: Studio → Reports → "DB CPU > 70%" — opt-in.
