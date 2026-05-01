# Feature: Site-of-day briefing

**Status:** Approved
**Milestone:** M5 (supervisor edit) + M4 (worker display)
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §14 #12, §15 #9, §18

## Goal

Supervisors post a short daily note + safety reminder per site. Workers see it pinned above the Punch button on the punch screen. Workers must acknowledge before they can punch in.

## Why

Three wins for a tiny bit of code:
1. **Safety reminders land** at the moment a worker arrives — far higher attention than a noticeboard.
2. **Supervisor-to-worker comms** for "we start 30 min late today, generator broke", "rain — wear non-slip boots".
3. **Stickiness**: the punch screen becomes worth opening for more than a clock-in. Workers check it out of habit.

## User stories

- **As a supervisor**, I open my dashboard, see today's briefing field with last night's text still there, edit it in <30 s, and save. The change goes live to all workers immediately.
- **As a worker**, when I open the app to punch in, the briefing is the first thing I see — bold, with a small "Acknowledged" toggle that I tap before the Punch In button is enabled.
- **As an admin**, I can scroll back through past briefings per site for audit.

## Functional spec

### What gets shown to the worker

Above the camera/punch interface:

```
┌──────────────────────────────────────────────────────┐
│ ⚠️  Today's briefing — Tower A — Whitefield          │
│ Updated by Priya, 06:45                              │
├──────────────────────────────────────────────────────┤
│ Site opens 7:30 today (delivery delay).              │
│ Wear high-vis vests at all times near Bay 3.         │
│ Lunch at 12:30, no smoking by the diesel tanks.      │
├──────────────────────────────────────────────────────┤
│ [ ] I have read today's briefing                     │
│ [ Punch In ]   ← disabled until acknowledged         │
└──────────────────────────────────────────────────────┘
```

If no briefing for today, the strip is hidden entirely; Punch In is enabled by default.

### Schema deltas

```sql
-- migration 00NN_site_briefing.sql

-- sites.daily_note already exists (added in 0001_init.sql).
-- add metadata + history.
alter table sites add column if not exists daily_note_updated_at timestamptz;
alter table sites add column if not exists daily_note_updated_by uuid references supervisors(id);
alter table sites add column if not exists daily_note_requires_ack boolean not null default true;

-- history table for audit
create table if not exists site_briefings (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001',
    site_id uuid not null references sites(id) on delete cascade,
    note text not null,
    requires_ack boolean not null default true,
    created_by uuid not null references supervisors(id),
    valid_for_date date not null,
    created_at timestamptz not null default now()
);
create unique index if not exists site_briefings_one_per_day
    on site_briefings(site_id, valid_for_date);

-- worker acknowledgements (per briefing per worker)
alter table attendance add column if not exists briefing_acknowledged_id uuid references site_briefings(id);
```

### Logic for "today's briefing"

The current briefing for a site is the row in `site_briefings` whose `valid_for_date = today_in_site_timezone`. If none exists, fall back to `sites.daily_note` (kept in sync by trigger when a briefing is created/edited).

```sql
create or replace function trg_site_briefing_sync_daily_note() returns trigger
    language plpgsql as $$
begin
    update sites
       set daily_note = new.note,
           daily_note_updated_at = now(),
           daily_note_updated_by = new.created_by
     where id = new.site_id;
    return new;
end $$;

drop trigger if exists site_briefing_sync_daily_note_trg on site_briefings;
create trigger site_briefing_sync_daily_note_trg
    after insert or update on site_briefings
    for each row execute function trg_site_briefing_sync_daily_note();
```

### Edge Function changes

`punch-submit` adds two checks:

1. If the punch is `type='in'`, look up today's briefing for the site. If `requires_ack` is true and `body.acknowledgedBriefingId` doesn't match its id, return `400` with `error: 'briefing_not_acknowledged'`.
2. On accepted punch, write `briefing_acknowledged_id` onto the `attendance` row.

Punch out (`type='out'`) is unaffected.

### Client UI

`apps/web/src/routes/worker/Punch.tsx` (M4 expansion):

```tsx
const { data: briefing } = useQuery({
  queryKey: ['todays-briefing', siteId],
  queryFn: () => supabase.from('site_briefings')
    .select('id, note, requires_ack, created_at, created_by')
    .eq('site_id', siteId)
    .eq('valid_for_date', todayInSiteTz)
    .maybeSingle(),
})

const [ack, setAck] = useState(false)
const punchEnabled = !briefing?.requires_ack || ack
```

Render the strip only if `briefing` exists.

### Supervisor edit

`apps/web/src/routes/supervisor/Dashboard.tsx` gets a "Today's briefing" panel — a textarea + checkbox + Save. Submitting upserts into `site_briefings` with `valid_for_date = today_in_site_tz`.

## Edge cases

- **Late-night supervisor edit** (after midnight site time): treat as next-day briefing if it's after 22:00 site-time (heuristic). Or always store with the current site-date and let supervisor confirm.
- **Worker offline at punch time**: the punch is queued; on flush, the server may now have a *new* briefing. Decision: validate against the briefing version that was acknowledged client-side (`briefingAcknowledgedId`). If that briefing has since been edited, supervisor sees the punch flagged with `briefing_outdated`.
- **Multiple supervisors editing simultaneously**: last write wins; the audit-log entry shows previous text. Acceptable at MVP scale.
- **Briefing carrying over weekends**: if no new briefing by 12:00 local on a working day, surface a yellow "stale briefing" badge to the supervisor.

## Test plan

| Test | Expectation |
|---|---|
| No briefing for today, worker punches in | Punch goes through, no acknowledgement gate. |
| Briefing exists, worker tries to punch without ticking | Punch button stays disabled. |
| Worker ticks ack, punches | Punch row carries `briefing_acknowledged_id`; supervisor sees a green "✓ ack'd" badge. |
| Supervisor edits briefing during the day | Workers who already punched before the edit are unaffected; workers punching after see the new text. |
| RLS: supervisor outside this project's scope queries `site_briefings` | empty result. |
| Audit: each insert/update creates an `audit_log` row with before/after JSON. | row exists, hash chain valid. |

## Open questions

1. Translate briefings? At MVP, keep it as a single text field — supervisors write in whatever language their workers read. Later: store `note jsonb` keyed by locale.
2. Allow attaching a photo (e.g., a sketch of the day's work area)? Defer — workers reading a 5-line text is enough; photos creep scope.
3. Send a Web Push when a briefing changes mid-day? Defer to v1.1; mock the channel in the meantime (see `feat-anomaly-detection.md` for the same `notification_outbox` mechanism).
