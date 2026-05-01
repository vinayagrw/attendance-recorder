# Feature: Payroll integration

**Status:** Mocked in v1 (CSV-only) · roadmap for v1.1
**Milestone:** Post-MVP
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §13 (competitor parity gap), §14 #16 break/overtime, §17 anti-pattern (hidden fees on exports)

## Goal

For v1, ship a clean CSV export that any payroll provider can ingest manually. For v1.1+, build named integrations to **Tally**, **QuickBooks Online**, **Gusto**, **ADP**, and **Razorpay Payroll** (India).

The v1 mock makes the surface area visible (a button, a settings tab, a docs link) so the upgrade is incremental.

## Why

- Workyard, busybusy, and SmartBarrel all win deals on "one-click payroll export" depth. Matching that long-term is competitive table stakes.
- For MVP, the user (Vinay) and small construction operators export to Excel + manually paste into payroll. CSV is fine.
- Mocking the integrations now lets us write the schema once and grow into it.

## User stories (v1 — what ships now)

- **As an admin**, I open "Payroll → Export" with date range + project + site filters, click Export, and download a CSV the next day's payroll run can ingest.
- **As an admin**, I see "Direct integrations: Coming in v1.1" with a list of planned providers; I can sign up for a "Notify me" form.

## User stories (v1.1+ — roadmap)

- **As an admin**, I connect Tally / QuickBooks Online once (OAuth or API key), pick the matching ledger and pay-rate mapping, and push a pay period straight into payroll without touching CSV.

## v1 functional spec — CSV export

### Endpoint

`apps/web/src/routes/admin/Payroll.tsx` (M7) calls a Supabase Edge Function `payroll-export` that streams CSV.

```ts
// supabase/functions/payroll-export/index.ts
serve(async (req) => {
  const { startDate, endDate, projectId, siteId, format = 'generic' } =
    Object.fromEntries(new URL(req.url).searchParams)

  // pre-flight: refuse if any auto_closed rows are unresolved (see feat-forgotten-punchout)
  // ...

  const { data: rows } = await sb.rpc('payroll_rows', {
    p_start: startDate, p_end: endDate, p_project_id: projectId, p_site_id: siteId,
  })

  const csv = formatCsv(rows, format)
  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="payroll-${startDate}-${endDate}.csv"`,
    },
  })
})
```

### CSV columns (generic format)

| Column | Source | Notes |
|---|---|---|
| `worker_id` | `workers.id` | UUID — keeps it joinable on import. |
| `worker_name` | `workers.full_name` | |
| `phone` | `workers.phone` | for matching against payroll provider records |
| `project` | `projects.name` | |
| `site` | `sites.name` | |
| `date` | derived from punch-in's site-local date | one row per (worker, day, site). |
| `clock_in` | first `attendance.type='in'` of the day | site-local time. |
| `clock_out` | last `attendance.type='out'` of the day | site-local time. |
| `hours_worked` | computed | `(out − in)` in hours, decimal. |
| `status` | `verified` / `flagged` / `auto_closed` / `rejected` | |
| `flag_reasons` | concat | semicolon-separated list. |

### Postgres function

```sql
create or replace function payroll_rows(
    p_start date, p_end date,
    p_project_id uuid default null, p_site_id uuid default null
) returns table (
    worker_id uuid, worker_name text, phone text,
    project text, site text, work_date date,
    clock_in timestamptz, clock_out timestamptz, hours_worked numeric,
    status text, flag_reasons text
)
language sql stable as $$
    with rows as (
        select w.id as worker_id, w.full_name as worker_name, w.phone,
               p.name as project, s.name as site,
               (a.punched_at at time zone s.timezone)::date as work_date,
               min(a.punched_at) filter (where a.type='in')  as clock_in,
               max(a.punched_at) filter (where a.type='out') as clock_out,
               max(a.status) as status,
               array_to_string(
                   array_agg(distinct unnest(a.flag_reasons))
                   filter (where cardinality(a.flag_reasons) > 0),
                   ';'
               ) as flag_reasons
        from attendance a
        join workers w  on w.id = a.worker_id
        join sites s    on s.id = a.site_id
        join projects p on p.id = s.project_id
        where (a.punched_at at time zone s.timezone)::date between p_start and p_end
          and (p_project_id is null or p.id = p_project_id)
          and (p_site_id is null or s.id = p_site_id)
        group by w.id, w.full_name, w.phone, p.name, s.name, work_date, s.timezone
    )
    select worker_id, worker_name, phone, project, site, work_date, clock_in, clock_out,
           extract(epoch from (clock_out - clock_in)) / 3600.0 as hours_worked,
           status, flag_reasons
    from rows
    order by work_date, worker_name;
$$;
```

### Format option `format=generic|tally|quickbooks|gusto|adp|razorpay`

For v1, only `generic` is implemented. The other strings return 501 Not Implemented; the UI shows them as "Coming in v1.1".

### Pre-flight gates

Block CSV download if any of these are true for the date range:
1. Any `attendance` row with `status='auto_closed'` not yet reviewed (see `feat-forgotten-punchout.md`).
2. Any row with `status='pending'` (supervisor hasn't reviewed yet).

UI shows the count of each blocker with one-click "Review now" links.

## v1.1 roadmap (named integrations)

When we build the deeper integrations, each goes in `supabase/functions/payroll-integration-<provider>/`:

| Provider | Auth | Cadence | Approach |
|---|---|---|---|
| Tally | API key + tenant URL | Manual export | XML payload via Tally's REST endpoint. |
| QuickBooks Online | OAuth 2.0 | Manual / scheduled | TimeActivity entity + Employee mapping. |
| Gusto | OAuth 2.0 | Manual / scheduled | Time entries endpoint, hourly employees. |
| ADP | API key (region-specific) | Manual | Time & Attendance API. |
| Razorpay Payroll (India) | OAuth 2.0 | Manual | Attendance API + earnings preview. |

Common schema for credentials:

```sql
-- migration future: payroll_provider_links
create table if not exists payroll_provider_links (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null,
    provider text not null check (provider in ('tally','quickbooks','gusto','adp','razorpay')),
    credentials_encrypted jsonb not null,    -- supabase vault preferred
    status text not null default 'active',
    created_at timestamptz not null default now()
);
```

Per-worker mapping:

```sql
create table if not exists worker_payroll_mappings (
    worker_id uuid primary key references workers(id),
    provider text not null,
    external_employee_id text not null,
    pay_rate_currency text default 'INR',
    pay_rate_per_hour numeric(10, 2),
    overtime_multiplier numeric(4, 2) default 1.5,
    created_at timestamptz not null default now()
);
```

## Edge cases (v1 CSV)

- **DST jurisdictions**: punching at 02:30 on a DST-spring-forward day → that local time doesn't exist. Use UTC for raw rows; convert to local only for display columns. Unit test on `'2026-03-29 America/New_York'`.
- **Worker rotation across sites mid-day**: row per (worker, date, *site*), so a worker who worked Tower A then Tower B gets two rows. Sum on the receiving side if needed.
- **Negative hours_worked** (clock_out before clock_in due to data entry mistake): export blocks; UI flags the row.
- **Date ranges crossing month boundaries**: fine; payroll is usually monthly anyway.

## Test plan

| Test | Expectation |
|---|---|
| Export 1 month, all clean punches | CSV has expected rows; hours sum matches a hand calculation. |
| Try export with 3 unresolved auto_closed rows | 422; UI shows blocker count. |
| Worker with rotation A → B in one day | Two rows, hours per site. |
| DST test (US Eastern, March) | No phantom rows / negative hours. |
| Worker with no phone | Phone column empty; row still exports. |
| RLS: non-admin tries `/payroll-export` | 403. |

## Open questions

1. PDF payslip preview generation? Cute, but Excel-and-paste workflow doesn't need it. Defer.
2. Auto-email the export to a configured address? Defer to v1.1 with provider-specific delivery.
3. Custom CSV column orders / mapping per customer? Defer; if the user has a payroll provider that wants specific names, build them as named formats (`format=acme-payroll`).
