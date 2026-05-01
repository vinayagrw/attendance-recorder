# Feature: Daily site report (Raken-style)

**Status:** Approved
**Milestone:** M7
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §14 #13, §18 (Should-have)

## Goal

End-of-day report submitted by the supervisor for each active site: weather, headcount, blockers, and 0–6 photos. Headcount auto-pulls from attendance; everything else is light supervisor entry. Admin can browse historical reports per site.

## Why

- **Two-job stickiness.** A worker uses the app twice a day; a supervisor uses it many times. Adding daily reports gives the supervisor a single workflow that already lives in the app.
- **Operational record.** Disputes about "the site was rained out on Tuesday" are settled with a row + photos.
- **Headcount cross-check.** If the supervisor types 18 but attendance shows 12, that's a soft prompt to investigate.

## User stories

- **As a supervisor**, at end of day I tap "Daily report", the app pre-fills today's date + headcount from attendance + weather pulled from a free API. I add 1–2 lines on blockers and 1–3 photos, hit Submit.
- **As an admin**, I can scroll through a site's daily reports, filter by date range, and export to CSV/PDF.
- **As a worker**, I'm not involved — but a "today's photos" thumbnail strip on my home screen is a nice touch (post-MVP).

## Functional spec

### Schema

```sql
-- migration 00NN_daily_site_reports.sql

create table if not exists daily_site_reports (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001',
    site_id uuid not null references sites(id) on delete cascade,
    report_date date not null,                  -- in site timezone
    submitted_by uuid not null references supervisors(id),
    submitted_at timestamptz not null default now(),

    weather_summary text,                       -- 'Sunny, 32°C'
    weather_data jsonb,                         -- raw API response, for forensics

    headcount_reported int,                     -- supervisor input
    headcount_attendance int,                   -- snapshot from attendance count
    headcount_match boolean generated always as (headcount_reported = headcount_attendance) stored,

    work_completed text,                        -- short free-text
    blockers text,                              -- short free-text
    notes text,

    photo_paths text[] not null default '{}',   -- storage paths in 'site-reports/' bucket

    status text not null default 'submitted'
        check (status in ('draft','submitted','revised'))
);
create unique index if not exists daily_site_reports_one_per_day
    on daily_site_reports(site_id, report_date);

create index if not exists daily_site_reports_site_time
    on daily_site_reports(site_id, report_date desc);
```

### RLS

```sql
alter table daily_site_reports enable row level security;

create policy dsr_supervisor_select on daily_site_reports for select
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = daily_site_reports.site_id and project_in_scope(s.project_id)
        )
    );

create policy dsr_supervisor_insert on daily_site_reports for insert
    with check (
        is_supervisor() and exists (
            select 1 from sites s
            where s.id = daily_site_reports.site_id and project_in_scope(s.project_id)
        )
    );

create policy dsr_supervisor_update on daily_site_reports for update
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = daily_site_reports.site_id and project_in_scope(s.project_id)
        )
    );
```

### Storage

New private bucket `site-reports/`, separate from `selfies/` so retention can differ. Path: `{site_id}/{report_date}/{uuid}.jpg`.

### Edge Function `daily-report-submit` (optional)

Direct-from-client `insert` is fine since RLS gates it. The Edge Function only matters if we want to call the weather API server-side (preferred — keeps API key off the client).

```ts
// supabase/functions/daily-report-submit/index.ts
serve(async (req) => {
  const { siteId, reportDate, ... } = await req.json()
  const weather = await fetchWeather(siteLat, siteLng, reportDate)
  const headcountAttendance = await sb
    .from('attendance')
    .select('worker_id', { count: 'exact', head: true })
    .eq('site_id', siteId)
    .eq('type', 'in')
    .gte('punched_at', startOfDayInTz)
    .lte('punched_at', endOfDayInTz)
  await sb.from('daily_site_reports').insert({ /* ... */ })
})
```

### Weather provider

[Open-Meteo](https://open-meteo.com/) — free, no API key needed for the basic forecast endpoint. Cache the response per site per date for 6 h to stay polite.

```
GET https://api.open-meteo.com/v1/forecast
    ?latitude={lat}&longitude={lng}
    &current_weather=true
    &timezone={site.timezone}
```

Map the response to `weather_summary` like `'Light rain, 24°C, wind 12 km/h'`.

### Client UI

`apps/web/src/routes/supervisor/Reports.tsx` (new in M7):

```
┌──────────────────────────────────────────────────────┐
│ Daily report — Tower A — 2026-05-01                  │
├──────────────────────────────────────────────────────┤
│ Weather:    Sunny, 32°C, wind 8 km/h     (auto-pulled)│
│ Headcount:  ◯ 18  (attendance shows 18 ✓)             │
│ Work done:  [textarea]                                │
│ Blockers:   [textarea]                                │
│ Notes:      [textarea]                                │
│                                                       │
│ Photos (0/6):  [+ Add photo]                          │
│                                                       │
│ [ Save draft ]              [ Submit report ]         │
└──────────────────────────────────────────────────────┘
```

Auto-save draft to IndexedDB every 5 s.

### Admin browse

`apps/web/src/routes/admin/SiteReports.tsx`:
- Filters: site, project, date range.
- List view: date, weather, headcount-match badge, blockers preview.
- Detail view: full report + photo gallery.
- Export: CSV (one row per report) or PDF (one page per report — use `jspdf`).

## Edge cases

- **No internet for weather call**: if Open-Meteo fails, leave `weather_summary` blank and let the supervisor type it. Don't block submit.
- **Headcount mismatch**: don't block — show a yellow badge. Allow a "explain mismatch" note field that becomes required if mismatch > 20%.
- **Late submission** (next morning): allow up to 7 days post-`report_date`. Beyond that, set `status = 'revised'` and require admin approval.
- **Photo upload fails**: queue locally, retry on reconnect, allow partial submit.
- **Project archived**: form is read-only; no new reports allowed (DB constraint optional, UI guard sufficient).

## Test plan

| Test | Expectation |
|---|---|
| First report of the day, all fields populated | Insert succeeds; `headcount_match = true` if numbers align. |
| Submit twice for same site same date | Second is blocked by unique index → UI prompts to edit existing draft. |
| Supervisor types headcount = 20, attendance = 12 | Yellow mismatch badge; supervisor must add an explanation. |
| Open-Meteo returns 5xx | `weather_summary` is null; UI shows "weather unavailable". |
| Upload 6 photos at 200 KB each | All uploaded; total 7th-photo button disabled. |
| RLS check: supervisor outside scope queries reports | empty. |

## Open questions

1. Build the worker home-screen "today's photos" peek now or post-MVP? Defer — it's a worker-side feature and won't be useful until reports are habitual.
2. Should reports support task-level cost coding (Workyard parity)? Out of scope — would require a tasks table per site. Revisit when a customer asks.
3. Do we need a "morning briefing draft" auto-rolled from yesterday's report? Could pre-fill today's `work_completed` field with "Continuing from yesterday: …". Cute, but defer.
