# Feature: Forgotten punch-out auto-correction

**Status:** Approved
**Milestone:** M8 (auto-close cron + workflow); UI affordances in M5
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §15 #5, §17 anti-pattern (Connecteam 20–30 h shifts)

## Goal

Detect open shifts (a `punch_in` row with no matching `punch_out` for the same worker on the same day in the same site timezone) and auto-close them at site-local midnight. Supervisor sees the auto-closed shifts in a dedicated review queue and adjusts the punch-out time before payroll export.

## Why

Connecteam's biggest construction-specific complaint in 2026 reviews is "20 hour shifts because workers forget to clock out". Manual correction is too late — the bad row already poisons reports and payroll runs.

## User stories

- **As a worker**, if I forget to punch out, the app puts an obvious red banner on the home screen the next morning ("You forgot to punch out yesterday — your supervisor will adjust it") and lets me carry on.
- **As a supervisor**, I open the dashboard and see "Auto-closed shifts (3)" prominently. I tap each, see worker, site, last selfie, expected end time, and either accept the default (site shift end) or set a different time.
- **As a payroll admin**, I cannot run the export until all auto-closed shifts in the period are reviewed.

## Functional spec

### Auto-close rule

Run at the end of each site's local day (00:30 in site timezone, with 30-min margin):

For each site, find workers with an `attendance.type='in'` row today (in site tz) without a corresponding `attendance.type='out'` later that day. For each such open shift, insert an `attendance.type='out'` row with:

- `punched_at` = `min(now, sites.shift_window_local.end)` interpreted in site tz; floor to the shift end.
- `device_lat/lng/selfie_url` = null
- `status = 'auto_closed'`
- `flag_reasons = ['auto_closed_no_punchout']`
- `reviewer_comment = null` (supervisor adds it)

### Schema deltas

```sql
-- migration 00NN_auto_close.sql

-- add 'auto_closed' to existing status check (already in 0001_init.sql v2)
-- ensure idempotency: don't auto-close twice

create or replace function open_shifts_for_site(p_site_id uuid, p_local_date date)
returns table (worker_id uuid, last_in_at timestamptz)
language sql stable as $$
    with day_bounds as (
        select
            (p_local_date::timestamp at time zone (select timezone from sites where id = p_site_id))::timestamptz as day_start,
            ((p_local_date + 1)::timestamp at time zone (select timezone from sites where id = p_site_id))::timestamptz as day_end
    ),
    ins as (
        select a.worker_id, max(a.punched_at) as last_in_at
        from attendance a, day_bounds b
        where a.site_id = p_site_id
          and a.type = 'in'
          and a.punched_at >= b.day_start and a.punched_at < b.day_end
        group by a.worker_id
    ),
    outs as (
        select a.worker_id, max(a.punched_at) as last_out_at
        from attendance a, day_bounds b
        where a.site_id = p_site_id
          and a.type = 'out'
          and a.punched_at >= b.day_start and a.punched_at < b.day_end
        group by a.worker_id
    )
    select i.worker_id, i.last_in_at
    from ins i
    left join outs o using (worker_id)
    where o.last_out_at is null or o.last_out_at < i.last_in_at;
$$;
```

### Cron job (Supabase Scheduled Function)

```ts
// supabase/functions/auto-close-shifts/index.ts (new in M8)
serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const { data: sites } = await sb.from('sites').select('id, timezone, shift_window_local')

  for (const site of sites ?? []) {
    const localToday = todayInTimezone(site.timezone) // YYYY-MM-DD

    // run at 00:30 local of the *next* day → close yesterday's open shifts
    const localYesterday = previousDate(localToday)
    const { data: open } = await sb.rpc('open_shifts_for_site', {
      p_site_id: site.id,
      p_local_date: localYesterday,
    })

    for (const row of open ?? []) {
      const closeAt = computeShiftEndIso(localYesterday, site.timezone, site.shift_window_local)
      await sb.from('attendance').insert({
        worker_id: row.worker_id,
        site_id: site.id,
        type: 'out',
        punched_at: closeAt,
        status: 'auto_closed',
        flag_reasons: ['auto_closed_no_punchout'],
      })
    }
  }
  return new Response('ok')
})
```

Schedule via Supabase: `select cron.schedule('auto-close-shifts', '*/30 * * * *', $$select net.http_post(...)$$);` — every 30 min, the function checks each site and runs only when local time has just crossed midnight + 30.

### Worker-side warning

`apps/web/src/routes/worker/Punch.tsx`:
- On load, query `attendance` for the latest punch by this worker.
- If the latest is `type='out'` with `status='auto_closed'`, show a red banner: "You forgot to punch out yesterday — your supervisor will adjust it."
- Don't block today's punch-in.

### Supervisor review

Anomaly pane (`feat-anomaly-detection.md`) gets a special chip: **"Auto-closed (3)"**, sticky at the top.

Click → list of auto-closed punches with:
- Worker, site, last in time, default out time (auto-close time).
- Editable "Set actual out time" datetime input.
- "Confirm" button → updates `attendance.punched_at`, `status='verified'`, audit-logged.

### Payroll-export gate

CSV export endpoint (M7) checks: any auto_closed rows in the date range? If yes, return 422 with `{ unresolvedAutoClosed: 5 }` and the UI tells the admin to clear the queue first.

## Edge cases

- **Worker punches in across midnight** (night shift). The open-shift query is per-site-day. A worker whose shift is 22:00–06:00 will appear "open" at 00:30 next morning. Mitigation: `sites.shift_window_local.crosses_midnight = true` → don't auto-close until 06:30 local.
- **Worker punches in 5 times without punching out**: open-shift logic uses the *latest* `in` punch. Earlier in punches with no matching outs are flagged separately as `multiple_in_no_out` for supervisor cleanup.
- **Site closed unexpectedly mid-day**: supervisor manually punches everyone out. Auto-close finds no open shifts, no-op.
- **Worker leaves early but doesn't punch out**: the auto-close still uses shift end. Supervisor adjusts to the actual departure time.
- **Time zone changes** (DST jurisdictions): always interpret `shift_window_local` against `sites.timezone` and the IANA TZ database; never compute against UTC manually.

## Test plan

| Test | Expectation |
|---|---|
| Worker punches in 09:00, never out, cron runs at 00:30 next day | New `out` row inserted at site shift end (e.g., 18:00) with `auto_closed`. |
| Same worker punches in twice 09:00 + 11:00, never out | Auto-close uses 11:00 as the unmatched in; only one out row created. |
| Worker punches in 22:00 (night-shift site), cron runs at 02:00 | No auto-close (crosses_midnight gate). |
| Two open shifts on same site for two workers | Both get auto-closed independently. |
| Cron job runs twice for the same date (re-trigger) | Idempotent — open_shifts query returns empty after the first run. |
| Admin tries CSV export with 5 unresolved auto-closes | 422 + UI prompt; export disabled until cleared. |

## Open questions

1. Notify worker by Web Push the moment auto-close happens (post-MVP)? Yes, useful, but mocked in v1 (writes to `notification_outbox`).
2. Should auto-closed *out* punches still capture a synthetic selfie (placeholder)? No — leave selfie_url null and have the dashboard show a "Auto" badge instead of an empty thumbnail.
3. Auto-close time = shift end vs `now`? Shift end is the right default for payroll fairness; supervisor can override with the actual time.
