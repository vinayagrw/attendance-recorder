# Feature: Anomaly detection (rules + dashboard pane)

**Status:** Approved (rules drafted in `supabase/functions/punch-submit/index.ts`; dashboard pane in M5; alerts mocked v1)
**Milestone:** M5 (dashboard); M2 stub already covers the rule engine
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §14 #10, §15 #10, §18 (Revised MVP scope), §19a #23–#27

## Goal

Server-side rules flag suspect punches at submit time; supervisors triage them on a dedicated dashboard pane. Notification *delivery* (push/email/SMS) is intentionally **mocked for v1** — flags appear on the dashboard, not in the supervisor's inbox. Notifications come post-MVP.

## Why

- Catching fraud and accidents (driving, GPS spoof, shared device) at submit time is cheap and prevents bad data ever reaching payroll.
- A dedicated pane separates anomalies from the high-volume "everything looks fine" feed, so supervisors don't drown.
- Mocking the notification channel lets us prove the *rules* are right before paying for a paid push/SMS provider.

## User stories

- **As a supervisor**, I open my dashboard and see a single "Anomalies (5)" pane at the top — sorted by severity, newest first. I can filter by type, click a row to see the selfie + map + rule reasons, and tap Verify / Flag / Reject.
- **As a worker**, I never see anomaly status directly. If my punch is rejected I see "Flagged for supervisor review" with a friendly retry option.
- **As an admin**, I can mute a rule for a specific site (e.g., turn off `off_hours` for 24/7 projects).

## Functional spec

### Rule catalogue

Each rule has: an **id** (machine-readable), **severity** (`low/medium/high`), **scope** (rejects punch / flags only), **trigger**, **dashboard description**.

| ID | Severity | Action | Trigger | Description |
|---|---|---|---|---|
| `not_live_camera` | high | reject (4xx) | selfie metadata `captureMethod !== 'live_camera'` | Selfie wasn't from the live camera. |
| `low_gps_accuracy` | low | flag | `gps_accuracy_m > 80` | GPS fix isn't precise enough to validate location. |
| `geofence_far` | medium | flag | distance to site polygon > 30 m AND > gps_accuracy_m | Punch was outside the site geofence. |
| `edge_tolerance` | low | flag | distance ≤ 30 m AND > gps_accuracy_m | On the edge — supervisor confirms with one tap. |
| `in_motion` | medium | flag | `speed_ms > 8 km/h equiv` | Worker appears to be moving (driving?). |
| `impossible_speed` | high | flag | `speed_ms > 120 km/h` | Speed reading is implausible. |
| `mock_gps_signature` | high | flag | coords match a prior punch to >5 decimals | Repeated identical fine-grained coords = spoofer signature. |
| `geofence_teleport` | high | flag | distance from prior punch / Δt > 200 km/h | Two punches imply impossible travel. |
| `new_device` | medium | flag | `device_fingerprint` not seen for this worker before | Worker punching from an unrecognised device. |
| `camera_label_changed` | medium | flag | (from `feat-selfie-metadata-validation`) | Camera fingerprint drift. |
| `buddy_punch_suspected` | high | flag | same `device_fingerprint` used by a different worker in last 12 h | One device, two workers. |
| `off_hours` | low | flag | punch outside `sites.shift_window_local` | Outside the site's typical working hours. |
| `frame_too_dark` | low | flag | from selfie metadata | Image too dark to verify. |
| `frame_too_blurry` | low | flag | from selfie metadata | Image too blurry. |
| `metadata_gps_mismatch` | high | flag | EXIF GPS differs from punch GPS by > 100 m | Image taken elsewhere. |
| `metadata_timestamp_stale` | high | flag | EXIF timestamp differs from now by > 5 minutes | Image not freshly captured. |
| `duplicate_selfie` | high | flag | matching SHA-256 in last 30 days | Re-using a previously submitted image. |

### Schema deltas

```sql
-- migration 00NN_anomaly_rules.sql

-- already in 0001_init: attendance.flag_reasons text[]
-- add severity for sorting on the dashboard
alter table attendance add column if not exists max_flag_severity text
    check (max_flag_severity in ('low','medium','high','none')) default 'none';

-- per-site rule overrides (rule_id → 'enabled' | 'disabled' | severity override)
alter table sites add column if not exists rule_overrides jsonb not null default '{}';

-- per-site working hours for off_hours rule (local time strings)
alter table sites add column if not exists shift_window_local jsonb default
    '{"start":"06:00","end":"22:00","timezone":"site"}';
```

### Edge Function

In `punch-submit`, after running each rule, compute `max_flag_severity`:

```ts
const SEV: Record<string, 'low' | 'medium' | 'high'> = { /* table above */ }
const triggered = flags.map((f) => ({ id: f, sev: SEV[f] ?? 'low' }))
const order = { high: 3, medium: 2, low: 1 }
const max = triggered.reduce((m, x) => order[x.sev] > order[m] ? x.sev : m, 'none' as const)
// insert with max_flag_severity = max
```

Hard rejects (`not_live_camera`) never reach insert — they 4xx out.

### Dashboard pane

`apps/web/src/routes/supervisor/Dashboard.tsx`:

```
┌─────────────────────────────────────────────────────────────┐
│ Today                                       [Anomalies 5 ▾] │
├─────────────────────────────────────────────────────────────┤
│ 🔴  09:14  Ravi K   Tower A   geofence_far · new_device     │
│ 🟡  08:52  Anil Y   Tower A   in_motion                     │
│ 🟡  08:31  Priya S  Block 3   off_hours                     │
│ 🔴  07:55  Kiran R  Tower A   buddy_punch_suspected         │
│ 🟢  07:48  Suresh   Tower A   edge_tolerance                │
└─────────────────────────────────────────────────────────────┘
       ↓ click row
┌─────────────────────────────────────────────────────────────┐
│ Punch detail                                                │
│ [selfie thumbnail]    [map with site polygon + GPS dot]    │
│ Reasons: geofence_far (52 m outside polygon), new_device    │
│ Worker history: 3 prior punches, all clean                  │
│ Device: a3f7e1… (first seen today)                          │
│                                                              │
│ [ Verify ]  [ Flag with note ]  [ Reject with reason ]      │
└─────────────────────────────────────────────────────────────┘
```

Sort: severity desc, then time desc. Filter chips for each rule id. Bulk verify when ≥2 selected and *all* have severity ≤ low.

### Mocked notification channel

For v1, `punch-submit` writes a row to a `notification_outbox` table (not delivered). A button "Subscribe to anomaly alerts" appears on the supervisor profile page but only shows a toast: "Coming in v1.1 — for now, check the dashboard at the start of each shift." Keep the row writing in place so swapping the worker (Web Push, email, SMS) is a one-day job later.

```sql
create table if not exists notification_outbox (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001',
    target_user_id uuid not null,
    target_role text not null,
    channel text not null check (channel in ('mock','webpush','email','sms')) default 'mock',
    severity text not null,
    title text not null,
    body text not null,
    payload jsonb not null default '{}',
    delivered_at timestamptz,
    delivery_attempt_count int not null default 0,
    created_at timestamptz not null default now()
);
create index if not exists outbox_undelivered on notification_outbox(target_user_id, created_at desc)
    where delivered_at is null;
```

## Edge cases

- **Multi-flag punches**: a single punch can have all of `low_gps_accuracy + new_device + edge_tolerance` (legitimate first-day worker on a poor signal). Severity stays at the max. Supervisor sees all three reasons.
- **Rule mute**: `sites.rule_overrides = {"off_hours": "disabled"}` short-circuits the rule. The override IS audit-logged (admin action).
- **Time zones for `off_hours`**: always interpret `shift_window_local` against `sites.timezone`, not the supervisor's tz.
- **Velocity check on first punch ever**: skip `geofence_teleport` if no prior punch exists.

## Test plan

| Test | Expectation |
|---|---|
| Submit punch from inside polygon | No flags. |
| Submit punch 100 m outside polygon, accuracy 30 m | `geofence_far` only. |
| Submit punch 35 m outside polygon, accuracy 50 m | `edge_tolerance` only. |
| Submit two punches 50 km apart in 10 minutes | second has `geofence_teleport`. |
| Submit twice same device with different worker IDs in 1 h | both get `buddy_punch_suspected`. |
| Submit during 03:00 site-local with default shift window | `off_hours`. |
| Mute `off_hours` for site, repeat | no `off_hours` flag; audit_log captures the mute. |
| Bulk verify 5 punches with mixed severities | only low-severity rows toggle to `verified`; high-sev rows stay flagged. |

## Open questions

1. How should low-severity flags affect status? Today: `status='flagged'` for any flag. Alternative: status stays `pending` for severity=low, requiring no action. Defer the change until we see how often "just edge_tolerance" punches show up.
2. Should rule overrides be project-level too (currently site-level)? Yes if a customer with 10 sites wants "always disable off_hours". Add `projects.rule_overrides` later.
