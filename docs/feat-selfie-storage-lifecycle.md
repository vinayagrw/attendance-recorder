# Feature: Selfie storage lifecycle (retention + cleanup + GDPR)

**Status:** Approved
**Milestone:** M8 (retention cron); admin tooling in M6
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §15 #17, #22, §6 cost estimate, §17 anti-pattern (surveillance creep)

## Goal

Three jobs in one feature:
1. **Retention rules** — automatically delete selfie blobs older than the configured policy (default 90 days for routine, 1 year for flagged, indefinite for baselines).
2. **Admin cleanup tools** — bulk delete by date range, by worker, by status; useful when free-tier storage gets squeezed or after offboarding.
3. **Worker right-to-be-forgotten** — admin-mediated workflow that wipes all selfies for a worker and anonymises their attendance metadata while keeping aggregated reports intact.

## Why

- **Free-tier headroom.** 1 GB of Supabase Storage is plenty for routine punches but gets lumpy if every selfie sticks forever.
- **Privacy hygiene.** Most jurisdictions don't require selfie retention beyond a reasonable audit window; keeping more than necessary is a reputational risk.
- **GDPR-style worker rights** are increasingly expected (and required in EU/UK; soon in India under DPDPA 2023).

## User stories

- **As an admin**, I open Settings → Data retention and see: "Selfies kept 90 days (routine) / 365 days (flagged or rejected) / forever (baseline)". I can change these; changes audit-log.
- **As an admin**, I can search "all selfies for worker X" or "all selfies in site Y between date A and B" and bulk-delete with a confirmation.
- **As an admin**, when a worker requests data deletion, I open their profile, click "Process deletion request", confirm — selfies are deleted, attendance rows are anonymised (worker_id replaced with a tombstone uuid), worker row is `status='offboarded' + erased=true`.
- **As a worker**, I can view my own data and request deletion via "About my data → Request deletion". The request goes to my supervisor, then admin.

## Functional spec

### Retention rules

Three tiers (attendance row):

| Tier | Default retention | Trigger |
|---|---|---|
| Baseline (registration selfie) | indefinite | `workers.baseline_selfie_url` |
| Flagged / Rejected punch | 365 days | `attendance.status in ('flagged','rejected')` OR `flag_reasons != '{}'` |
| Routine punch | 90 days | otherwise |

Configurable per project:

```sql
alter table projects add column if not exists retention_days jsonb not null default
    '{"routine":90,"flagged":365,"baseline":null}';
```

`null` = indefinite. Per-project allows a high-security customer to retain longer.

### Cleanup cron (Supabase Scheduled Function)

```ts
// supabase/functions/selfie-retention-cron/index.ts (M8)
serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: projects } = await sb.from('projects').select('id, retention_days')

  for (const p of projects ?? []) {
    const routineCutoff = daysAgo(p.retention_days.routine ?? 90)
    const flaggedCutoff = p.retention_days.flagged
      ? daysAgo(p.retention_days.flagged) : null

    // routine: rows older than cutoff with no flags, no flagged status
    const { data: routine } = await sb
      .from('attendance')
      .select('id, selfie_url')
      .lt('punched_at', routineCutoff)
      .eq('status', 'verified')
      .filter('flag_reasons', 'eq', '{}')
      .not('selfie_url', 'is', null)
      .limit(1000)

    for (const row of routine ?? []) {
      await sb.storage.from('selfies').remove([row.selfie_url!])
      await sb.from('attendance').update({ selfie_url: null }).eq('id', row.id)
    }

    if (flaggedCutoff) { /* same loop with status in ('flagged','rejected') */ }
  }

  return new Response('ok')
})
```

Schedule daily at 03:00 UTC. Process in 1000-row batches to keep Edge Function within memory limits.

### Admin cleanup UI

`apps/web/src/routes/admin/Storage.tsx` (new in M6 lite, expanded in M8):

```
┌─────────────────────────────────────────────────────────┐
│ Selfie storage                                           │
├─────────────────────────────────────────────────────────┤
│ Total: 412 MB  ·  3,891 files  ·  inside free tier ✓     │
│                                                          │
│ Cleanup tools                                            │
│  ◯ All selfies older than [90] days for project [—]      │
│  ◯ All selfies for worker [—]                            │
│  ◯ All selfies between [date] and [date] for site [—]    │
│  ◯ All baseline selfies for offboarded workers           │
│                                                          │
│  Preview matches: 1,204 files (~110 MB)                  │
│  [ Dry run ]   [ Delete (requires admin password) ]      │
└─────────────────────────────────────────────────────────┘
```

Each delete triggers an `audit_log` row capturing: criteria JSON, file count, total bytes, performer.

### Worker data export & deletion (right-to-be-forgotten)

```
Admin → Workers → Ravi Kumar → Data
  ┌────────────────────────────────────────────┐
  │ Export worker data (zip)                   │
  │ Generate request for deletion              │
  │ Process deletion request   ← if pending    │
  └────────────────────────────────────────────┘
```

**Export** produces a zip:
```
ravi-kumar.zip
  ├── profile.json       worker row + assignments
  ├── attendance.csv     all attendance rows
  ├── device_logs.csv
  └── selfies/           all selfie blobs by date
```

**Deletion** runs in a transaction:
1. `delete from storage.objects where bucket_id='selfies' and name like '{worker_id}/%'`
2. `update attendance set selfie_url=null, device_fingerprint=null, ip_address=null, user_agent=null, device_lat=null, device_lng=null where worker_id='{id}'` — keeps the row for aggregate reporting; just anonymises identifying fields.
3. `update workers set full_name='[Erased]', phone=null, baseline_selfie_url=null, pin_hash=null, status='offboarded', erased=true where id='{id}'`
4. Audit-log row with `action='gdpr_erase'`, before/after state.

Add the `erased boolean default false` column on `workers`.

### Why we don't hard-delete attendance rows

Aggregated reports (hours per site, headcount) need historical row counts. Hard-deleting a worker's attendance corrupts time-series. Anonymisation preserves the rows; the worker is no longer identifiable.

### Storage policies

Selfies bucket uses signed URLs only (15 min expiry, configured at bucket level). Public access is never allowed. Migration:

```sql
-- 0001_init contains: bucket 'selfies' is private. No public read.
-- Add a 'site-reports' bucket here too if not already created.
insert into storage.buckets (id, name, public)
    values ('selfies', 'selfies', false)
    on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
    values ('site-reports', 'site-reports', false)
    on conflict (id) do nothing;
```

## Edge cases

- **Cron fails partway** — non-issue if idempotent. Each row processed independently; on retry the cutoff query naturally re-finds them.
- **Admin clicks Delete on 50,000 files**: the deletion runs as a background Edge Function (queue the criteria, not the file list). UI polls a `cleanup_jobs` table for progress.
- **Storage bucket quota hit during a job**: resume on next cron tick; no special handling needed.
- **Worker disputes their deletion**: the `audit_log` chain proves who clicked, when, with what before-state JSON.
- **Project changes retention** mid-life: future runs apply the new policy; already-deleted blobs aren't recoverable. Document this in the admin UI.

## Test plan

| Test | Expectation |
|---|---|
| Insert a 95-day-old verified attendance row with selfie blob | Cron deletes the blob; attendance.selfie_url set to null. |
| Insert a 95-day-old flagged attendance row | Selfie stays (flagged retention is 365 days). |
| Manual delete by date range — dry run | Returns count + bytes; no actual deletes. |
| Manual delete confirmed | Files gone, audit_log row written. |
| GDPR erase a worker | Selfies gone, attendance anonymised, worker row marked erased. |
| Re-run GDPR erase on already-erased worker | No-op; audit_log still gets a row indicating no change. |
| Cron handles 1500 rows | Two batches; both succeed; total < 60 s. |

## Open questions

1. Should we offer a "soft delete" (move to a cold archive) before hard delete? Cloudflare R2 has a much cheaper archive tier. Defer until Supabase free tier becomes the bottleneck.
2. Worker self-service deletion (without admin approval)? Risky — workers might delete in-flight evidence during a wage dispute. Keep admin-mediated for v1.
3. Data export format — JSON + CSV is engineer-friendly. PDF for the worker themselves? Add post-MVP if a real request arrives.
