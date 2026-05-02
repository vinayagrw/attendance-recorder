# 📍 Attendance Recorder

> **Browser-based attendance system for construction workers** with real-time verification, anomaly detection, and multi-role dashboards. Selfie + GPS + device fingerprint per punch, supervisor review, project lifecycle management—all on free-tier infrastructure.

[![Node 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js)](https://nodejs.org/)
[![pnpm 10+](https://img.shields.io/badge/pnpm-%3E%3D10-blue?logo=pnpm)](https://pnpm.io/)
[![React 18](https://img.shields.io/badge/react-18-61dafb?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/typescript-5.x-3178c6?logo=typescript)](https://www.typescriptlang.org/)
[![Supabase](https://img.shields.io/badge/supabase-postgres%2B--auth-24b39a?logo=supabase)](https://supabase.com/)
[![Tailwind CSS](https://img.shields.io/badge/tailwind-3.x-06b6d4?logo=tailwindcss)](https://tailwindcss.com/)
[![License: UNLICENSED](https://img.shields.io/badge/license-UNLICENSED-red)](LICENSE)

**Status:** ![MVP Complete](https://img.shields.io/badge/Status-MVP%20Complete-success) ![Tests Passing](https://img.shields.io/badge/Tests-27%20E2E%20%2B%2014%20UI-brightgreen) ![Hardening](https://img.shields.io/badge/Hardening-In%20Progress-yellow)

---

## 📋 Quick Navigation

| Section | Description |
|---------|-------------|
| [🚀 Quick Start](#-quick-start-one-terminal) | 4-step local dev setup |
| [💡 Features](#-features-at-a-glance) | Capability grid & feature matrix |
| [🏗️ Architecture](#-architecture) | System design & data flow |
| [👥 Role-Based Access](#-role-based-access-control) | Workers vs Supervisors vs Admins |
| [🔬 Advanced Features](#-advanced-features) | Anomaly detection, analytics, offline queue |
| [🛠️ Tech Stack](#-tech-stack-breakdown) | Frontend, backend, hosting details |
| [✅ Testing](#-testing--qa) | 3-layer testing pyramid |
| [🚢 Deployment](#-deployment-guide) | Frontend, backend, cloud setup |
| [🔒 Security](#-security--compliance) | RLS, rate limiting, PII protection |
| [📚 Documentation](#-documentation-hub) | Architecture, features, operations |
| [❓ FAQ & Troubleshooting](#-faq--troubleshooting) | Common issues & solutions |

---

## 🚀 Quick Start (One Terminal)

> **Prerequisites:** Node 20+, pnpm 10+, Docker Desktop, Supabase CLI (auto-installed)

<details open>
<summary><strong>⏱️ Expand for step-by-step setup (takes ~2 min)</strong></summary>

```bash
# 1️⃣ Install dependencies
pnpm install

# 2️⃣ Start local Supabase (Postgres + Auth + Storage + Functions + Realtime)
pnpm supabase:start

# 3️⃣ Bootstrap admin supervisor (creates test account automatically)
bash scripts/ci-setup.sh

# 4️⃣ Start Vite dev server + Edge Functions in parallel
pnpm dev
```

**✅ Ready!** App runs on **http://localhost:5173** (Vite auto-picks next port if taken—check console)

</details>

### 🎫 Default Test Credentials

Created automatically by `scripts/ci-setup.sh`:

<table>
<tr>
<th>Role</th>
<th>Email</th>
<th>Password</th>
<th>Capabilities</th>
</tr>
<tr>
<td><strong>Admin</strong></td>
<td><code>viagr@ciklum.com</code></td>
<td><code>LocalDev2026!</code></td>
<td>Full CRUD: projects, sites, workers, supervisors, audit</td>
</tr>
<tr>
<td colspan="4" style="background:#f0f0f0;"><strong>Worker Personas</strong> (register first, use PIN-based auth)</td>
</tr>
<tr>
<td>👷 Worker</td>
<td>Ravi Kumar (ID: <code>333...</code>)</td>
<td>PIN: <code>1234</code></td>
<td>Punch in/out, view own history, offline queue</td>
</tr>
<tr>
<td>👷 Worker</td>
<td>Priya Singh (ID: <code>444...</code>)</td>
<td>PIN: <code>5678</code></td>
<td>Same as above</td>
</tr>
<tr>
<td>👷 Worker</td>
<td>Anil Yadav (ID: <code>555...</code>)</td>
<td>PIN: <code>9012</code></td>
<td>Same as above</td>
</tr>
</table>

---

## 💡 Features at a Glance

### 🎯 Core Capabilities

```
┌─────────────────────────────────────────────────────────────┐
│  WORKER FLOW                                                │
│  ✅ Registration (selfie + GPS + device fingerprint)        │
│  ✅ PIN-based login (no email)                              │
│  ✅ Punch in/out with real-time location                    │
│  ✅ Offline queue (IndexedDB) + sync on reconnect           │
│  ✅ 7-day attendance history                                │
│  ✅ Multi-language UI (English + Hindi)                     │
│  ✅ PWA install (works offline)                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  SUPERVISOR DASHBOARD                                       │
│  ✅ Real-time punch feed (Supabase Realtime)                │
│  ✅ Pending registrations queue + photo review              │
│  ✅ Anomaly pane (geofence, device, motion violations)      │
│  ✅ Manual verification / flag / reject                     │
│  ✅ Manual punch correction (with audit trail)              │
│  ✅ CSV payroll export (per site / date range)              │
│  ✅ Daily site report + staff briefing acknowledgment       │
│  ✅ Multi-site management (scoped to projects)              │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  ADMIN PANEL                                                │
│  ✅ Project lifecycle (planning → active → archived)        │
│  ✅ Site CRUD with geofence (map-based radius config)       │
│  ✅ Worker CRUD + bulk import + status transitions          │
│  ✅ Supervisor management (scoped to projects)              │
│  ✅ Hash-chained audit log viewer                           │
│  ✅ Device logs + anomaly rule configuration                │
└─────────────────────────────────────────────────────────────┘
```

### 🎆 Premium Features

| Feature | What it does | Status |
|---------|-------------|--------|
| **🚨 Anomaly Detection** | Rules flag geofence violations, device sharing, mock GPS, off-hours punches, biometric mismatches | ✅ Live, 10+ rules |
| **📊 Self-Service Analytics** | Dashboard: daily heatmaps, attendance trends, anomaly stats, worker efficiency scorecards | ✅ Implemented |
| **📸 Selfie Lifecycle Mgmt** | Auto-delete after 90 days; watermark with timestamp + GPS; metadata validation (blink detection ready) | ✅ Cron-driven |
| **💰 Payroll Export** | CSV with attendance hours, anomalies flagged, multi-currency ready | ✅ Edge Function |
| **⏰ Auto-Close Shifts** | Daily cron closes pending shifts; worker reminder on forgotten punch-out | ✅ Scheduled |
| **🔗 Hash-Chained Audit** | Immutable log with `prev_hash` + `row_hash`; tamper-evident | ✅ Trigger-based |
| **📱 PWA + Offline Queue** | Install as app; failed punches queue in IndexedDB; auto-sync | ✅ Service Worker |
| **🌍 Geofencing** | Server-side distance calc; configurable radius per site; 30m soft boundary | ✅ PostGIS ready |
| **🎯 Device Fingerprinting** | Canvas + user-agent + IP logging; flags device sharing; rate limit per ID | ✅ FingerprintJS |
| **🗣️ Multi-Language Support** | English + Hindi (i18next); extend via locale files | ✅ 2 languages |

---

## 🏗️ Architecture

### High-Level System Design

```
┌─────────────────────────────────────────────────────────────────┐
│                     WORKER MOBILE BROWSER (PWA)                 │
│                 Pick Name → PIN → Capture → Punch                │
├─────────────────────────────────────────────────────────────────┤
│ Selfie (getUserMedia) | GPS (geolocation) | Device ID (Canvas) │
│                         ↓ HTTPS                                   │
├─────────────────────────────────────────────────────────────────┤
│              CLOUDFLARE PAGES (Edge Deployment)                  │
│               Static React PWA + service worker                  │
│                         ↓ API Calls                               │
├─────────────────────────────────────────────────────────────────┤
│                       SUPABASE REGION                            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ PostgreSQL 15                                            │   │
│  │ ├─ projects, sites, workers, attendance                 │   │
│  │ ├─ supervisors, audit_log, device_logs                  │   │
│  │ ├─ daily_site_reports, briefing_acknowledgments         │   │
│  │ └─ RLS policies (workers see own, supervisors see scope)│   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐  │
│  │ Auth             │  │ Storage (Selfies)│  │ Edge Fns     │  │
│  │ ├─ Supervisors   │  │ ├─ Private bucket│  │ ├─ register  │  │
│  │ └─ Workers       │  │ ├─ Signed URLs   │  │ ├─ login     │  │
│  │   (synthetic)    │  │ └─ 90-day TTL    │  │ ├─ punch     │  │
│  │                  │  │                  │  │ ├─ payroll   │  │
│  │                  │  │                  │  │ └─ crons     │  │
│  └──────────────────┘  └──────────────────┘  └──────────────┘  │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Realtime Subscriptions (Supervisor Dashboard)            │  │
│  │ Punch feed, approval notifications, anomaly updates      │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                            ↑
                       SUPERVISOR / ADMIN
                    Web Dashboard (same PWA)
```



## 👥 Role-Based Access Control

<details>
<summary><strong>🔐 View authentication patterns & RLS policies</strong></summary>

### Authentication Flows

| Role | Identity | Auth Method | Session Duration | Extra |
|------|----------|---|---|---|
| **Worker** | Name + ID (UUID) | PIN (bcrypt) | 1–8 hrs (JWT from Edge Fn) | Synthetic email: `<workerId>@worker.local`; device fingerprint logged; rate-limited 5 fails/15min |
| **Supervisor** | Email | Email + password (Supabase Auth) | Browser session (refresh token in secure HTTP-only cookie) | Optional TOTP 2FA; project scope via `scope_project_ids` array |
| **Admin** | Email | Email + password (Supabase Auth) | Browser session | Same as supervisor; `role='admin'` flag gates `/admin/*` routes |

### Row-Level Security (RLS) Policies

```sql
-- Worker RLS: can only see own attendance
CREATE POLICY worker_own_attendance ON attendance
  FOR SELECT USING (worker_id = auth.jwt()->>'worker_id');

-- Supervisor RLS: scoped to project + site assignments
CREATE POLICY supervisor_scoped ON attendance
  FOR SELECT USING (
    is_admin() OR
    site_id IN (
      SELECT site_id FROM sites WHERE project_id = ANY(
        (SELECT scope_project_ids FROM supervisors WHERE id = auth.uid())
      )
    )
  );

-- Admin: full access (checked via frontend route guard)
CREATE POLICY admin_all ON attendance
  FOR ALL USING (is_admin());
```

### URL Access Matrix

| Path | Who | How | Notes |
|------|-----|----|-------|
| `/worker/*` | Workers | PIN login | Synthetic email auth; one user per worker |
| `/supervisor/*` | Supervisors | Email+password | Project scope via `scope_project_ids` |
| `/admin/*` | Admins only | Email+password + `role='admin'` check | Route guard in [ProtectedRoute.tsx](apps/web/src/components/ProtectedRoute.tsx) |
| `/api/*` (Edge Fns) | Public | API key (anon) or custom JWT | Anon: `list_active_workers`, supervised: `punch-submit`, etc. |

</details>

---

## 🔬 Advanced Features

### 🚨 Anomaly Detection Engine

<details>
<summary><strong>View 10+ rule catalogue & severity levels</strong></summary>

**Rules trigger at punch-submit time.** Supervisor triages from **Anomalies** pane on dashboard.

| Rule ID | Severity | Trigger | Action | Example |
|---------|----------|---------|--------|---------|
| `geofence_far` | 🔴 High | `distance_m > 30` soft or `> 100` hard | Reject or flag | Punch submitted 5km away from site boundary |
| `new_device` | 🟠 Medium | `device_fingerprint` differs from last 5 punches | Flag | Worker using different phone/browser |
| `buddy_punch_suspected` | 🔴 High | Same `device_fingerprint`, 2+ worker IDs in 1h | Flag + audit | Device shared between Ravi & Anil |
| `mock_gps_signature` | 🟠 Medium | Same lat/lng for 3+ consecutive punches | Flag | Identical coords from WiFi spoofing |
| `gps_accuracy_poor` | 🟠 Medium | `accuracy_m > 80` | Reject | GPS locked indoors with low confidence |
| `in_motion` | 🟡 Low | `speed_ms > 2.2` (8 km/h walking + drift) | Flag | Punch while driving / moving |
| `off_hours` | 🟡 Low | `punched_at` outside shift window | Flag (mutable per site) | 3am punch (ok for 24/7 sites) |
| `long_idle` | 🟡 Low | No punch-out after 16h of punch-in | Auto-close + flag | Forgotten punch-out overnight |
| `rapid_location_change` | 🟠 Medium | `distance_m > 50km` between punches < 15min | Flag | Teleportation (spoofing) |
| `face_mismatch` | 🔴 High | Selfie biometric ≠ registered face | Flag (awaiting ML model) | Impersonation attempt |

**Dashboard UX:**
- **Anomalies (5)** pane shows newest first, sorted by severity.
- Click a row → see selfie + map + all triggered rules + supervisor buttons: Verify / Flag / Reject.
- Filter by rule type, date, worker, site.
- Mute rule for specific site (e.g., disable `off_hours` for 24/7 project).

**Backend:**
Edge Function `punch-submit` evaluates all rules in 1 transaction; writes `punches.anomalies` JSON array. Supervisor review writes to `audit_log` with before/after state.

</details>

### 📊 Self-Service Analytics Dashboard

<details>
<summary><strong>View available reports & metrics</strong></summary>

Supervisors see role-scoped analytics on **Analytics** tab:

| Report | Metrics | Granularity | Export |
|--------|---------|-------------|--------|
| **Daily Heatmap** | Punch count by hour; late/absent clusters | Per site, per day | PNG chart |
| **Attendance Trends** | Week/month view; on-time %, anomaly rate | Per site, per worker | CSV |
| **Worker Scorecards** | Avg hours, punctuality, device stability, anomaly count | Per worker, rolling 30d | PDF |
| **Anomaly Stats** | Top rule types, severity distribution, geofence violations | Per site, per rule | CSV |
| **Payroll Export** | Hours, flags, rates (multi-currency ready) | Per site, date range | CSV + headers for Excel |

**Tech:**
- Real-time data from Postgres views + RPC functions
- TanStack Query caching (5min TTL)
- Recharts for interactive visualizations
- Client-side CSV generation (no additional backend)

</details>

### 📱 PWA + Offline-First Queue

<details>
<summary><strong>How offline queue works & service worker caching</strong></summary>

**PWA Benefits:**
- ✅ Install as app on home screen (iOS + Android + Windows)
- ✅ Works without internet (offline shell + cached pages)
- ✅ Background sync (queued punches sync when online)
- ✅ Push notifications (future: for approvals)

**Offline Queue (IndexedDB):**

When worker punches **offline**:
1. Service worker intercepts fetch to `punch-submit`.
2. User sees message: "⚠️ No internet. Punch queued locally."
3. Details stored in IndexedDB: `{ workerId, photo, gps, timestamp, ... }`.
4. Queue banner shows: "Queued: 2 punches" with sync button.
5. When online, punches auto-sync (or user taps "Sync").
6. On success, remove from queue; on error, show retry prompt.

**Caching Strategy (vite-plugin-pwa):**
- `/` + `/login` + `/punch` → cache-first (offline works)
- `/api/*` → network-first (always fresh from server)
- Images + fonts → cache with 30-day TTL

> ⚠️ **Note:** Offline registration is **not supported**—first-time selfie capture requires camera + server validation. Workers must be online for initial PIN registration.

</details>

### 🎯 Device Fingerprinting & Security

<details>
<summary><strong>Fingerprinting strategy & buddy-punch detection</strong></summary>

**Why fingerprint?**
- Catch shared devices (same worker using 2 phones, or 2 workers sharing 1 phone = fraud)
- Prevent simple fixes to authentication (just a PIN is too weak alone)
- Detect device theft or loss (alert supervisor to new device mid-shift)

**Collection Method:**
- Canvas fingerprint (rendering characteristics)
- User-agent (browser, OS, version)
- IP address (Supabase request context)
- Stored in `device_logs` table; indexed by `worker_id` + `created_at`

**Buddy-Punch Detection:**
```sql
SELECT worker_id, device_fingerprint, COUNT(DISTINCT worker_id)
FROM device_logs
WHERE punched_at > now() - interval '1 hour'
GROUP BY device_fingerprint
HAVING COUNT(DISTINCT worker_id) > 1;
-- Flags multiple workers on same device in last hour
```

**Supervisor Visibility:**
- "Device" badge on punch tiles shows: ✅ Trusted (last 3 uses), 🆕 New device, 🚨 Shared
- Tap badge → see last 10 device logs for that worker
- Report: "Device anomalies" → top shared devices across workers

> ⚠️ Shared devices are **flagged not blocked**—supervisor decides if ok (e.g., 1 device per site is distributed).

</details>

### 🌍 Geofencing with PostGIS

<details>
<summary><strong>Server-side radius check & soft boundaries</strong></summary>

**At punch-submit:**
```sql
SELECT 
  ST_DistanceSphere(
    ST_Point(lat, lng)::geography,
    ST_Point(site.lat, site.lng)::geography
  ) / 1000 as distance_km
FROM sites WHERE id = punch.site_id;
```

**Safety Margins:**
- `< 30m` (soft): ✅ Approved
- `30–100m` (soft boundary): 🟡 Flagged, auto-approved (user error: GPS drift)
- `> 100m` (hard): 🔴 Rejected (on supervisor approval)

**Admin Config:**
- Map-based UI (Leaflet) to draw site geofence circle
- Radius slider: 20–500m (defaults 50m)
- Optional: polygon for irregular sites (wip)

**Supervisor Override:**
- Can approve rejected punches (editable timestamp too) with reason audit log
- Bulk approve geofence-flagged punches for site if GPS was bad that day

</details>

### 📸 Selfie Lifecycle & Metadata Validation

<details>
<summary><strong>Compression, watermarking, retention cron, tamper detection</strong></summary>

**Capture & Compression (Browser):**
1. `getUserMedia()` → hardware camera
2. Client validates: face detected? eyes open? (basic checks, ml-ready)
3. Canvas → JPEG, quality 85, target ≤ 100KB
4. Show to user for confirmation
5. Upload as multipart to Edge Function

**Server-Side Processing (Edge Function):**
1. Receive JPEG + metadata (GPS, timestamp)
2. Optional: run lightweight face detection (unused yet, ml scaffold)
3. Add **watermark**: timestamp + GPS coordinates + worker ID (tamper-evident)
4. Store in private Storage bucket: `selfies/<worker_id>/<date>/<uuid>.jpg`
5. Record metadata in `attendance.selfie_metadata` JSON:
   ```json
   {
     "url": "https://cdn.example.com/selfies/...",
     "size_bytes": 45123,
     "watermark": "2026-05-02 10:23 AM | +28.1234, +77.5678 | Ravi",
     "captured_at": "2026-05-02T10:23:00Z",
     "face_detected": true,
     "liveness_score": null
   }
   ```

**Retention Cron (via Supabase scheduled function `selfie-retention-cron`):**
- Daily at 2 AM UTC: scan `attendance` for selfies > 90 days old
- Delete from Storage + null out `selfie_metadata.url`
- Keep metadata for audit (attendance rows unchanged)
- Log deletion in `audit_log`

**Supervisors can access:**
- View selfie via signed URL (valid 15 min)
- Cannot download/forward (no bulk export)
- Logs track who viewed when

</details>

### 💰 Payroll Export Integration

<details>
<summary><strong>CSV schema, multi-currency support, anomaly inclusion</strong></summary>

**CSV Columns (per punch):**
```
date, site_name, worker_name, punch_in, punch_out, hours_worked,
status (approved/flagged/rejected), anomalies (geofence_far, new_device),
rate_currency, hourly_rate, gross_amount, notes
```

**Export Flow:**
1. Supervisor selects: date range, site(s), workers (optional filter)
2. Taps "Export Payroll" → [Edge Function: payroll-export]
3. Function queries `attendance` + `workers` + `sites`, applies RLS
4. Calculates hours; multiplies by rate from `workers.hourly_rate` + `workers.currency`
5. Flags anomalies on same row (supervisor reviews before submitting to HR)
6. Returns CSV; browser downloads as `payroll_2026-05-02_example-site.csv`

**Multi-Currency:**
- `workers.hourly_rate` (decimal)
- `workers.currency` (ISO 4217: USD, INR, GBP, etc.)
- CSV includes currency in header: "gross_amount (INR)"
- No auto-conversion (supervisor handles in accounting tool)

**Audit Trail:**
- Export logged in `audit_log` with query params (date range, site filter)
- Can recreate export from logs (immutable via hash chain)

</details>

### ⏰ Auto-Close Shifts Cron

<details>
<summary><strong>Forgotten punch-out handling & nightly cleanup</strong></summary>

**Scheduled Function:** Daily at 11:59 PM UTC (configurable per timezone)

**Logic:**
```sql
UPDATE attendance
SET punched_out_at = now(), status = 'auto_closed', anomalies = array_append(anomalies, 'long_idle')
WHERE worker_id IN (select id from workers where status='active')
  AND punched_in_at > now() - interval '24 hours'
  AND punched_out_at IS NULL
  AND punched_in_at < now() - interval '16 hours';

-- Sends notification (future: WhatsApp/email via Twilio)
-- Logs in audit_log
```

**Supervisor UX:**
- Dashboard shows auto-closed punches in special section
- Can manually re-open + edit timestamps if data was wrong
- Report available: "Top 10 workers with forgotten punch-outs"

</details>

### 🔗 Hash-Chained Audit Log

<details>
<summary><strong>Immutable tamper-evident history</strong></summary>

**Every state-changing action logs to `audit_log` with hash chain:**

```sql
CREATE TABLE audit_log (
  id uuid PRIMARY KEY,
  actor_id uuid,                    -- supervisor or admin
  action text,                      -- 'approve_worker', 'verify_punch', 'edit_punch', 'delete_selfie'
  target_table text,                -- 'workers', 'attendance', 'supervisors'
  target_id uuid,                   -- e.g. worker_id being approved
  before_state jsonb,               -- old values
  after_state jsonb,                -- new values
  prev_hash text,                   -- SHA256 of previous audit row
  row_hash text,                    -- SHA256(this_row including prev_hash)
  created_at timestamptz DEFAULT now()
);
```

**Hash Chain:**
- `row_hash = SHA256(actor_id || action || target_table || target_id || before_state || after_state || prev_hash)`
- If someone tries to edit an old audit row, `row_hash` mismatches
- Supervisor can detect tampering: "SELECT * FROM audit_log WHERE row_hash != computed_hash"

**Trigger (automatic):**
Postgres trigger on `INSERT` calculates hash. Edge Function never computes—DB-guaranteed.

**Admin Viewer (UI):**
- Full filter: by action, actor, date range, target table
- Displays chain visually: unbroken green line = trusted, broken line = alert
- Can prove "I approved this punch on 2026-05-01 at 10:23 AM" via hash

</details>

---

## 🛠️ Tech Stack Breakdown

### Frontend (React + Vite + PWA)

| Layer | Technology | Why |
|-------|-----------|-----|
| **Framework** | React 18 + TypeScript | Component-driven, zero-install, type-safe |
| **Build Tool** | Vite 6 | Lightning-fast HMR, sub-second reloads |
| **Styling** | Tailwind CSS 3 + shadcn/ui | Utility-first, pre-built components, mobile-first |
| **State & Data** | TanStack Query (React Query) | Auto-caching, optimistic updates, background refetch |
| **Forms** | React Hook Form + Zod | Lightweight, schema validation, minimal re-renders |
| **Routing** | React Router v6 | Nested routes, lazy loading, role-based guards |
| **Realtime** | Supabase JS client + Realtime |​ WebSocket subscribe to punch feed |
| **Charts** | Recharts | Interactive, MIT license, small bundle |
| **Maps** | Leaflet + OpenStreetMap | Free, no API key, offline tiles cached |
| **Camera** | Browser `getUserMedia()` | Native API, no lib needed |
| **Geolocation** | Browser `navigator.geolocation` | Native, automatic permission UI |
| **Device ID** | @fingerprintjs/fingerprintjs (open-source) | Canvas + user-agent fingerprinting |
| **Icons** | Heroicons + Tailwind | SVG, 0 external requests |
| **i18n** | i18next | English + Hindi, extendable |
| **Notifications** | React Toaster | Non-blocking snackbars |
| **PWA** | vite-plugin-pwa + Workbox | Service worker, install prompt, offline |
| **Error Tracking** | IndexedDB logger (custom) | Client-side only, no external service (Sentry optional) |

### Backend (Supabase: Postgres + Auth + Storage + Edge Functions + Realtime)

| Component | Details |
|-----------|---------|
| **Database** | PostgreSQL 15 + PostGIS 3 (for geofencing) + pgcrypto (for hashing) |
| **Schema** | 13 tables: projects, sites, workers, sites_workers, attendance, supervisors, device_logs, audit_log, daily_site_reports, briefing_acknowledgments, feature_flags, plus migrations |
| **Auth** | Supabase Auth (supervisors/admins) + custom JWT Edge Functions (workers) |
| **Storage** | Private `selfies/` bucket, signed URLs (15-min expiry) |
| **RLS Policies** | Row-level security on attendance, workers; scoped by `scope_project_ids` |
| **Edge Functions** | Deno runtime; 5 functions deployed: `worker-register`, `worker-login`, `punch-submit`, `payroll-export`, `list_active_workers` + 2 crons (`auto-close-shifts`, `selfie-retention-cron`) |
| **Realtime** | Supabase Realtime (WebSocket) for supervisor dashboard live punch feed |
| **Triggers** | Audit triggers (auto-log state changes), RLS-bypassing batch operations, device ban on worker offboarding |

### Hosting & Deployment

| Layer | Service | Free Tier | Details |
|-------|---------|-----------|---------|
| **Frontend Static** | Cloudflare Pages | Unlimited requests | Auto-deploy on `main` push; global CDN |
| **Database + Auth + Storage** | Supabase (Postgres+cloud) | 500MB DB, 1GB storage, 50K MAU | Managed backups (7-day free retention) |
| **Function Hosting** | Supabase Edge Functions | 500K invocations/mo | Deno runtime, near-DB execution |
| **Custom Domain** | Cloudflare or AWS Route53 | ~$1/mo | Optional |
| **Backups** | Supabase daily snapshots | 7 days free | WAL archiving after paid plan |

---

## ✅ Testing & QA

### 3-Layer Testing Pyramid

<details>
<summary><strong>📊 View detailed test coverage & commands</strong></summary>

```
                        🎭 Playwright UI Tests
                      (14 tests, ~46 s, real browser)
                    ✅ home.spec.ts (3 tests)
                    ✅ worker-flow.spec.ts (4 tests)
                    ✅ supervisor-flow.spec.ts (7 tests)
                              ↑
                   ┌──────────────────────┐
                   │   27 API E2E Tests   │
                   │  (~12s, no browser)  │
                   ├──────────────────────┤
                   │ 1. RPC: list_active  │
                   │ 2. Worker register × 3│
                   │ 3. Supervisor approve│
                   │ 4. Punch in/out × 3  │
                   │ 5. Anomaly trigger   │
                   │ 6. Admin CRUD        │
                   │ 7. RLS verification  │
                   │ 8. Audit chain       │
                   │ 9. Realtime updates  │
                   │ 10. Offboarding ban  │
                   └──────────────────────┘
                              ↑
                   ┌──────────────────────┐
                   │  TypeScript + Build  │
                   │  (fastest, ~5 s)     │
                   ├──────────────────────┤
                   │ pnpm typecheck       │
                   │ pnpm build           │
                   └──────────────────────┘
```

### Layer 1: TypeScript + Build (5 sec)

```bash
pnpm typecheck    # Type-check Web + Functions via tsconfig
pnpm build        # Vite production build → dist/
```

✅ **Validates:** No syntax errors, types align, imports resolve, PWA manifest valid.

### Layer 2: API E2E (12 sec)

```bash
bash scripts/e2e.sh
```

**27 tests across 14 phases** (no browser, direct API calls):

1. ✅ RPC: `list_active_workers` (anon-readable)
2. ✅ State reset (idempotent re-runs)
3. ✅ Worker registration × 3 personas (selfie, GPS, device fingerprint)
4. ✅ Pre-approval: worker login attempt → fails (status pending)
5. ✅ Supervisor login + bulk approve (via Realtime confirmation)
6. ✅ Audit trigger captures approvals (hash-chained)
7. ✅ Punch in/out × 3 workers (~4 hours each)
8. ✅ Supervisor punch feed (Realtime subscription updated)
9. ✅ Anomaly rule fires: punch 7km away → `geofence_far` flagged
10. ✅ Admin reads projects + sites + workers + audit log (full RLS scope)
11. ✅ Worker RLS: Ravi cannot see Priya's punches
12. ✅ Supervisor RLS: multi-site scope enforcement
13. ✅ Offboarded worker: auth user banned via trigger
14. ✅ Final state reset

**Run against staging/cloud:**

```bash
API_URL=https://staging.example.com \
ANON_KEY=sb_publishable_xxx \
SERVICE_ROLE_KEY=sb_service_xxx \
SUPERVISOR_EMAIL=qa@example.com \
SUPERVISOR_PASS=staging-pass \
bash scripts/e2e.sh
```

### Layer 3: Playwright UI (46 sec)

```bash
# One-time setup
pnpm test:e2e:install     # Downloads ~150 MB Chromium

# Run with local dev server
pnpm dev
E2E_BASE_URL=http://localhost:5173 pnpm test:e2e

# Or against production build
pnpm build && pnpm preview
E2E_BASE_URL=http://localhost:4173 pnpm test:e2e
```

**14 tests across 5 personas:**

| Spec | Tests | What's covered |
|------|-------|---|
| `home.spec.ts` | 3 | Home page renders, login form renders, 404 page |
| `worker-flow.spec.ts` | 4 | Worker pick-list (from RPC), register UI, selfie capture, pending screen |
| `supervisor-flow.spec.ts` | 7 | Login, dashboard tiles, invite form, bulk approve, manual punch, edit punch, admin nav |

**Auth flow:** `e2e/fixtures.ts` provides `loginAsSupervisor()` helper (shared session across tests).

### Run Full Pyramid (Sequential)

```bash
bash scripts/cleanup-tables.sh && \
pnpm typecheck && pnpm build && \
bash scripts/e2e.sh && \
E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
```

✅ **Total time:** ~70 sec. All tests must pass.

### CI/CD Pipeline (.github/workflows/ci.yml)

Every PR to `main` runs:

| Job | Time | What |
|-----|------|-----|
| `lint-and-build` | ~2 min | `pnpm install`, `typecheck`, `build` |
| `e2e-api` | ~5 min | Supabase setup, `scripts/e2e.sh` (27 tests) |
| `e2e-ui` | ~7 min | Same Supabase + Playwright (14 tests) + `vite preview` |

**Failure artifacts:** Playwright generates `playwright-report/` (traces, screenshots, videos) if UI tests fail.

### Reset Data Between Test Runs

```bash
bash scripts/cleanup-tables.sh
```

Wipes: `attendance`, `audit_log`, `device_logs`, `daily_site_reports`, `briefing_acknowledgments`, `workers`, `sites_workers`.

**Preserves:** `supervisors`, `projects`, `sites` (idempotent seed data).

> ✅ Always run before manual testing or re-running E2E suite.

</details>

---

## 🚢 Deployment Guide

### Frontend → Cloudflare Pages

<details>
<summary><strong>Auto-deploy on Git push</strong></summary>

1. **Connect repo:** Cloudflare Pages → "Create a project" → Connect GitHub → select `attendance-recorder`
2. **Build settings:**
   - Framework preset: `None`
   - Build command: `pnpm build`
   - Build output directory: `apps/web/dist`
   - Node version: `20`
3. **Environment variables:** Set in Pages UI:
   ```
   NEXT_PUBLIC_SUPABASE_URL = https://<ref>.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = sb_publishable_xxx
   ```
4. **Deploy:** Push to `main` → Cloudflare auto-builds + deploys in ~2 min

**Custom domain:** Add via Pages settings. DNS via Cloudflare registrar (free HTTPS auto).

**Preview URLs:** Auto-generated per PR (`https://pr-123-—xyz.attendance-recorder.pages.dev`); great for QA.

</details>

### Backend: Postgres Migrations

<details>
<summary><strong>Safe migration workflow for cloud</strong></summary>

**⚠️ CRITICAL: Never use `db reset` on cloud. Use `db push` instead.**

```bash
# 1. Create new migration (generates timestamp file)
npx supabase migration new add_my_feature

# 2. Edit file: supabase/migrations/0022_add_my_feature.sql

# 3. Apply locally first (test with real data volume)
npx supabase db reset

# 4. Run tests
bash scripts/e2e.sh && pnpm test:e2e

# 5. When ready for cloud, link to project
npx supabase link --project-ref <ref>

# 6. Review diff (safe mode)
npx supabase db push    # will prompt: "Confirm to push? (y/n)"

# 7. View in Studio at https://supabase.com/dashboard/project/<ref>/sql/migrations
```

**Advanced: Deploy via GitHub Actions**

Add to `.github/workflows/deploy.yml`:
```yaml
- name: Deploy migrations
  if: github.event_name == 'push' && github.ref == 'refs/heads/main'
  run: npx supabase link && npx supabase db push
  env:
    SUPABASE_ACCESS_TOKEN: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
```

</details>

### Edge Functions Deployment

<details>
<summary><strong>Deploy worker-register, punch-submit, crons</strong></summary>

```bash
# Deploy one function
npx supabase functions deploy worker-register

# Deploy all functions
for fn in worker-register worker-login punch-submit payroll-export \
          auto-close-shifts selfie-retention-cron; do
  npx supabase functions deploy $fn
done

# View logs in cloud
npx supabase functions logs worker-register --limit 20
```

**Deno permissions:**
- `--allow-net`: HTTPS calls (to Supabase, external APIs)
- `--allow-env`: Read environment variables (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`)

Defined in `deno.json` at function level.

**Debugging:**
- Local: `npx supabase functions serve --no-verify-jwt` (foreground, watch logs)
- Cloud: Studio → Functions → select function → Logs tab

</details>

### Scheduled Functions (Crons)

<details>
<summary><strong>Set up auto-close-shifts & selfie-retention-cron</strong></summary>

**One-time setup via Supabase Studio:**

1. Navigate to **SQL Editor**
2. Run these commands:

```sql
-- Auto-close forgotten punches daily at 11:59 PM UTC
SELECT cron.schedule('auto-close-shifts', '59 23 * * *', 'SELECT invoke_function(''auto-close-shifts'')');

-- Delete old selfies daily at 2 AM UTC (90-day retention)
SELECT cron.schedule('selfie-retention-cron', '0 2 * * *', 'SELECT invoke_function(''selfie-retention-cron'')');
```

> 🕐 Times are in UTC. For your timezone, convert: 11:59 PM UTC = 5:29 AM IST (UTC+5:30).

**Monitor:**
- Logs appear in Edge Function logs tab
- Trigger manually for testing: Supabase CLI → `npx supabase functions invoke auto-close-shifts --no-verify-jwt`

**Pause/resume:** SQL Editor → `SELECT cron.unschedule('auto-close-shifts');` (to disable temporarily)

</details>

### Complete Deployment Checklist

- [ ] Migrations tested locally (`pnpm supabase db reset` + `bash scripts/e2e.sh`)
- [ ] Edge Functions tested locally (`npx supabase functions serve`)
- [ ] All tests passing (`pnpm typecheck && pnpm build && bash scripts/e2e.sh && pnpm test:e2e`)
- [ ] Frontend env vars set in Cloudflare Pages
- [ ] Git push to `main` → Cloudflare auto-deploys
- [ ] Link cloud project: `npx supabase link --project-ref <ref>`
- [ ] Migrations pushed: `npx supabase db push`
- [ ] Functions deployed: `npx supabase functions deploy <name>`
- [ ] Cron schedules added (SQL Editor)
- [ ] Storage bucket policies verified (private `selfies/` bucket)
- [ ] Auth redirect URLs set (Pages URL + any aliases)
- [ ] Smoke test: access production URL in browser, login, punch

---

## 🔒 Security & Compliance

### Implemented Safeguards

| Layer | Measure | Status |
|-------|---------|--------|
| **Authentication** | bcrypt PIN hashing (10+ rounds); Supabase Auth for supervisors; rate limit 5 fails / 15 min per worker | ✅ |
| **Transport** | HTTPS-only; HSTS headers via Cloudflare | ✅ |
| **Storage** | Private bucket; selfies signed URLs (15-min expiry); auto-delete after 90 days | ✅ |
| **Session** | Short-lived JWT for workers (1–8 hrs); refresh on re-login; HTTP-only cookies for supervisors | ✅ |
| **RLS** | All tables (attendance, workers, audit) protected; worker sees only own data; supervisor scoped by `scope_project_ids` | ✅ |
| **Logging** | Device logs (IP, fingerprint, event) on every login/punch; audit log with hash chain | ✅ |
| **Compliance** | PII data export (GDPR); data deletion on request; 7-year retention for payroll | 🟡 Scaffold only |

### Database RLS Policies (Overview)

<details>
<summary><strong>View key RLS policies & gotchas</strong></summary>

```sql
-- Workers: see own attendance + device logs only
CREATE POLICY worker_attend_select ON attendance
  FOR SELECT USING (worker_id = auth.jwt()->>'worker_id');

CREATE POLICY worker_device_logs ON device_logs
  FOR SELECT USING (worker_id = auth.jwt()->>'worker_id');

-- Supervisors: scoped to projects they manage
CREATE POLICY supervisor_attend ON attendance
  FOR SELECT
  USING (
    is_admin() OR
    site_id IN (
      SELECT site_id FROM sites
      WHERE project_id = ANY(
        (SELECT scope_project_ids FROM supervisors WHERE id = auth.uid())
      )
    )
  );

-- Admins: no restrictions (frontend gate ensures role='admin')
CREATE POLICY admin_all ON attendance FOR ALL USING (is_admin());

-- ⚠️ GOTCHA: RLS Recursion
-- If supervisor table itself has RLS, supervisor_id cannot update scope_project_ids.
-- SOLUTION: Use SECURITY DEFINER trigger on supervisor update, or grant supervisor edit via Edge Function.
```

**Test RLS:**
```bash
bash scripts/e2e.sh   # Phase 12: "Worker RLS - Ravi cannot see Priya"
```

### Compliance Tasks (Post-MVP)

<details>
<summary><strong>GDPR / data protection to-do</strong></summary>

- [ ] **PII Export Endpoint:** `GET /api/worker/export` → ZIP with all personal data (JSON, CSV)
- [ ] **Data Deletion:** `DELETE /api/worker/me` → anonymize rows (keep audit trail for payroll)
- [ ] **Audit Log Accessibility:** Provide audit log export to worker on demand
- [ ] **Privacy Policy:** Link in app footer; disclose selfie use, retention, 3rd parties (Cloudflare, Supabase)
- [ ] **Consent Form:** Signature on first login for biometric data (selfie) capture
- [ ] **Retention Policy:** Auto-delete older attendance rows (configurable, default 7 years for payroll)
- [ ] **Incident Response:** Document data breach notification process (alert supervisor, log to audit)

</details>

---

## 📚 Documentation Hub

| Document | Purpose |
|----------|---------|
| **[plan.md](plan.md)** | 🗺️ Single source of truth: architecture, schema, feature roadmap, milestones, cost estimates |
| **[docs/runbook.md](docs/runbook.md)** | 📖 Operations playbook: stack at a glance, troubleshooting, incident responses, cron setup |
| **[docs/feat-anomaly-detection.md](docs/feat-anomaly-detection.md)** | 🚨 Rule catalogue, severity levels, supervisor UX, dashboard mocking strategy |
| **[docs/feat-payroll-integration.md](docs/feat-payroll-integration.md)** | 💰 CSV schema, multi-currency, export flow, audit integration |
| **[docs/feat-selfie-storage-lifecycle.md](docs/feat-selfie-storage-lifecycle.md)** | 📸 Compression, watermarking, retention cron, signed URL strategy |
| **[docs/feat-forgotten-punchout.md](docs/feat-forgotten-punchout.md)** | ⏰ Auto-close cron, worker notification, supervisor override |
| **[docs/feat-daily-site-report.md](docs/feat-daily-site-report.md)** | 📊 Daily briefing, acknowledgment, multi-language, email integration |
| **[docs/feat-photo-compression.md](docs/feat-photo-compression.md)** | 🖼️ JPEG quality, bandwidth optimization, target file sizes |
| **[docs/feat-selfie-metadata-validation.md](docs/feat-selfie-metadata-validation.md)** | 👁️ Face detection, blink challenge (ml-ready), metadata schema |
| **[docs/feat-site-of-day-briefing.md](docs/feat-site-of-day-briefing.md)** | 🎯 Site-specific daily briefing, file attachment, ack workflow |
| **[docs/ANALYTICS_SETUP.md](docs/ANALYTICS_SETUP.md)** | 📈 Dashboard implementation, views, RPC functions, performance notes |
| **[docs/architecture.md](docs/architecture.md)** | 🏗️ Database schema diagram (ER), migrations map, triggers overview |

---

## ❓ FAQ & Troubleshooting

<details>
<summary><strong>❌ "Supabase won't start" / Docker errors</strong></summary>

**Error:** `docker: command not found` or `Cannot connect to Docker daemon`

**Fix:**
1. Install Docker Desktop from [docker.com](https://www.docker.com/products/docker-desktop)
2. Launch Docker Desktop app (not just the CLI)
3. Retry: `pnpm supabase:start`

**Still stuck?**
```bash
docker ps                    # Check if Docker daemon is running
docker system prune --all   # Free up space if disk full
pnpm supabase:stop          # Stop all containers
pnpm supabase:start         # Fresh restart
```

</details>

<details>
<summary><strong>❌ "Worker cannot log in" / Synthetic email auth fails</strong></summary>

**Error:** Worker picks name, enters PIN, sees "Invalid credentials"

**Possible causes:**
1. Worker status is not `active` (must be `approved` by supervisor first)
   - **Fix:** Login as supervisor, approve worker from pending queue
2. PIN is wrong (test with seeded workers: Ravi=1234, Priya=5678, Anil=9012)
3. Auth user not created (Edge Function `worker-register` didn't run)
   - **Fix:** Check Edge Function logs: `npx supabase functions logs worker-register`

**Diagnosis:**
```bash
# Check worker status in DB
npx supabase db connection-string   # Get postgres connection string
psql $CONNECTION_STRING
SELECT id, name, status FROM workers LIMIT 5;
-- Should show status='active'

SELECT * FROM auth.users WHERE email ~* 'worker.local';
-- Should show 1+ users for active workers
```

</details>

<details>
<summary><strong>❌ "Punch submitted but supervisor doesn't see it" / Realtime broken</strong></summary>

**Error:** Worker punches in, supervisor dashboard doesn't update

**Possible causes:**
1. Realtime subscription didn't attach or disconnected
   - **Fix:** Check network tab in DevTools; look for WebSocket to Supabase (`wss://...`)
2. Supervisor RLS doesn't match worker's site
   - **Fix:** Check `supervisors.scope_project_ids` includes the project containing that site
3. Punch status is `rejected` (due to anomaly rule) → supervisor sees in Anomalies pane, not main feed
   - **Fix:** Check Anomalies pane; if `geofence_far`, punch was far from site

**Diagnosis:**
```bash
# Check punch was recorded
psql $CONNECTION_STRING
SELECT id, worker_id, site_id, status, anomalies FROM attendance 
WHERE worker_id = '<worker-uuid>' 
ORDER BY punched_at DESC LIMIT 1;

# Check supervisor scope
SELECT id, email, scope_project_ids FROM supervisors;
-- scope_project_ids should include project.id of that site
```

</details>

<details>
<summary><strong>❌ "Geofence not working" / All punches approved despite distance</strong></summary>

**Error:** Punch 10km away is auto-approved (no `geofence_far` flag)

**Possible causes:**
1. Site coordinates not set (edge_tolerance defaults to 0, so any distance is far)
   - **Fix:** Admin panel → Sites → edit site → set lat/lng + radius
2. Edge Function `punch-submit` crashed and defaulted to no anomaly
   - **Fix:** Check function logs: `npx supabase functions logs punch-submit`
3. Rule is disabled for the site (via feature flag)
   - **Fix:** Check `feature_flags.rule_enabled_geofence` for that site

**Diagnosis (from E2E test):**
```bash
# In Phase 10 of e2e.sh, punch is made 7km away:
curl -X POST http://localhost:54321/functions/v1/punch-submit \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "site_id": "...", "lat": 28.9999, "lng": 77.9999, "photo": "...", "fingerprint": "..." }'

# Should return: { "status": "flagged", "anomalies": ["geofence_far"] }
```

</details>

<details>
<summary><strong>❌ "Test suite failing" / E2E tests time out</strong></summary>

**Error:** `bash scripts/e2e.sh` gets stuck at "Waiting for functions to be ready"

**Possible causes:**
1. Edge Functions not deployed (still compiling, or Docker is slow)
   - **Fix:** Wait ~30 sec for Deno to compile; check: `npx supabase functions logs`
2. Supabase isn't fully started (check SQL Editor accessibility)
   - **Fix:** `curl http://127.0.0.1:54321/health` should return `200 OK`
3. Port conflict (54321 already in use)
   - **Fix:** `lsof -i :54321` (macOS/Linux) or `Get-NetTCPConnection -LocalPort 54321` (Windows); kill the process

**Quickest fix:**
```bash
pnpm supabase:stop
pnpm supabase:start --ignore-health-check
# Give it 30 sec to be ready
sleep 30
bash scripts/e2e.sh
```

</details>

<details>
<summary><strong>❌ "Playwright tests fail locally but pass in CI"</strong></summary>

**Error:** `pnpm test:e2e` fails; `playwright-report/` shows flaky timing

**Possible causes:**
1. Local dev server too slow; element not rendered by timeout
   - **Fix:** Increase viewport, close other apps, use headless (faster): `PLAYWRIGHT_DEBUG=0 pnpm test:e2e`
2. Missing `pnpm test:e2e:install` (Chromium not downloaded)
   - **Fix:** `pnpm test:e2e:install` (150 MB download, one-time)
3. Old build; Vite cache stale
   - **Fix:** `rm -rf apps/web/dist apps/web/.vite && pnpm build && pnpm preview`

**Fastest turnaround:**
```bash
pnpm test:e2e:install                 # One-time
pnpm dev                               # Terminal 1
E2E_BASE_URL=http://localhost:5173 \
PLAYWRIGHT_LAUNCH_ARGS='--headed' \
pnpm test:e2e                          # Terminal 2 (headed = see browser)
```

</details>

<details>
<summary><strong>❌ "Cloudflare deployment blank" / 404 on pages URL</strong></summary>

**Error:** `https://attendance-recorder.pages.dev` returns 404 or blank page

**Possible causes:**
1. Build command didn't run or output directory is wrong
   - **Fix:** Cloudflare Pages → Settings → Build & deploy. Should be:
     - Build command: `pnpm build`
     - Output dir: `apps/web/dist`
2. Env vars missing (app can't reach Supabase)
   - **Fix:** Pages → Settings → Environment variables. Must have:
     - `NEXT_PUBLIC_SUPABASE_URL = https://<ref>.supabase.co`
     - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = sb_publishable_...`
   - Note: `NEXT_PUBLIC_*` prefix makes them available to frontend
3. Build failed silently; check logs
   - **Fix:** Pages → Deployments → latest → scroll to "Build logs" section

**Quickest check:**
```bash
pnpm build
npx vite preview --port 4173           # Mimics production build
# Visit http://localhost:4173/
# If blank, check browser DevTools Console for errors (missing env vars)
```

</details>

---

## 🎯 Common Operations Cheat Sheet

### Development

| Command | What it does |
|---------|---------|
| `pnpm dev` | Start Vite dev + Edge Functions (watch mode) |
| `pnpm dev:vite` | Vite only (skip functions) |
| `pnpm dev:functions` | Edge Functions only (no Vite) |
| `pnpm build` | Production build to `apps/web/dist/` |
| `pnpm preview` | Run production build locally on :4173 |
| `pnpm typecheck` | TypeScript type-check (no emit) |

### Testing

| Command | What it does |
|---------|---------|
| `bash scripts/cleanup-tables.sh` | Wipe & re-seed database |
| `bash scripts/e2e.sh` | Run 27 API E2E tests |
| `pnpm test:e2e:install` | Download Chromium (one-time) |
| `E2E_BASE_URL=http://localhost:5173 pnpm test:e2e` | Run 14 UI tests |

### Database & Supabase

| Command | What it does |
|---------|---------|
| `npx supabase status` | Show local Supabase stack URLs & health |
| `npx supabase db reset` | Wipe + rebuild local database |
| `npx supabase db pull` | Download remote schema (cloud) |
| `npx supabase db push` | Apply local migrations to cloud |
| `npx supabase migration new <name>` | Create new migration file |
| `npx supabase link --project-ref <ref>` | Link to cloud project |
| `psql $SUPABASE_DB_URL` | Connect to local Postgres directly |
| `npx supabase functions serve` | Run Edge Functions locally (foreground) |
| `npx supabase functions deploy <name>` | Deploy function to cloud |
| `npx supabase functions logs <name>` | Tail function logs |

### Inspecting Local Services

| What | URL |
|------|-----|
| Supabase Studio (DB UI) | http://127.0.0.1:54323 |
| Supabase Auth (magic links) | Inbucket at http://127.0.0.1:54324 |
| Local Postgres | `postgresql://postgres:postgres@127.0.0.1:54322/postgres` |
| Vite dev server | http://localhost:5173 (or next free port) |

### Reset Everything (Nuclear Option)

```bash
pnpm supabase:stop              # Stop containers
docker container prune -f       # Clean up stopped containers
docker volume prune -f          # Clean up orphaned volumes
rm -rf supabase/.temp/          # Remove temp files
pnpm supabase:start             # Fresh start
bash scripts/ci-setup.sh        # Re-bootstrap admin
pnpm dev                        # Ready
```

---

## 📦 Project Structure

```
attendance-recorder/
├── apps/web/                          # React PWA app
│   ├── src/
│   │   ├── App.tsx                    # Route definitions + role guards
│   │   ├── main.tsx                   # Entry point + PWA setup
│   │   ├── routes/
│   │   │   ├── worker/                # /worker/punch, /history, /register, /pending
│   │   │   ├── supervisor/            # /supervisor/dashboard, /approvals, /reports
│   │   │   └── admin/                 # /admin/projects, /sites, /workers, /audit
│   │   ├── components/                # React components (auth, forms, cards, etc.)
│   │   ├── hooks/                     # useWorker(), useSupervisor(), useTodayAttendance(), etc.
│   │   ├── lib/
│   │   │   ├── supabase.ts            # Client config + RLS
│   │   │   ├── camera.ts              # Selfie capture + compression
│   │   │   ├── geolocation.ts         # GPS + accuracy validation
│   │   │   └── deviceFingerprint.ts   # FingerprintJS integration
│   │   ├── store/                     # Zustand or Context state (IndexedDB queue, auth)
│   │   └── i18n/                      # i18next + locale files (en, hi)
│   ├── e2e/                           # Playwright tests
│   │   ├── home.spec.ts, worker-flow.spec.ts, supervisor-flow.spec.ts
│   │   └── fixtures.ts                # Shared auth helpers
│   ├── vite.config.ts                 # PWA plugin + build config
│   ├── tailwind.config.js             # Tailwind theme
│   └── index.html                     # PWA manifest link
├── supabase/
│   ├── migrations/                    # SQL DDL (0001…0021)
│   │   └── 0021_critical_fixes.sql    # Latest consolidated fixes
│   ├── functions/                     # Edge Functions (Deno)
│   │   ├── worker-register/
│   │   ├── worker-login/
│   │   ├── punch-submit/              # Core punch logic + anomaly rules
│   │   ├── payroll-export/
│   │   ├── auto-close-shifts/         # Cron function
│   │   ├── selfie-retention-cron/     # Cron function
│   │   ├── _shared/                   # Shared utilities (auth, errors)
│   │   └── tsconfig.json
│   ├── config.toml                    # Local Supabase config
│   └── seed.sql                       # Local dev seed
├── docs/                              # Per-feature specs
│   ├── feat-anomaly-detection.md
│   ├── feat-payroll-integration.md
│   ├── feat-selfie-storage-lifecycle.md
│   ├── runbook.md
│   └── ...
├── scripts/
│   ├── ci-setup.sh                    # Bootstrap admin supervisor
│   ├── e2e.sh                         # Run 27 API tests
│   └── cleanup-tables.sh              # Wipe & re-seed
├── .github/workflows/ci.yml           # GitHub Actions (lint + build + tests)
├── plan.md                            # Strategic roadmap
├── README.md                          # This file
└── package.json, pnpm-workspace.yaml, ...
```

---

## 🚀 Next Steps After Setup

1. **Try worker flow:** Pick "Ravi Kumar" → PIN `1234` → Punch in/out
2. **Approve as supervisor:** Login as `viagr@ciklum.com` / `LocalDev2026!` → approve Ravi
3. **Explore anomalies:** Set site location; punch 10km away to see geofence flag
4. **Check analytics:** Supervisor → Analytics tab
5. **Export payroll:** Supervisor → Reports → CSV download
6. **Architecture:** See [plan.md](plan.md) for full design & roadmap

---

## 📄 License

**UNLICENSED**. Pick before commercial: MIT, Apache 2.0, or Proprietary.

---

## 🤝 Contributing

1. Create feature branch from `main`
2. Make changes + write tests
3. Run: `bash scripts/cleanup-tables.sh && pnpm typecheck && pnpm build && bash scripts/e2e.sh && pnpm test:e2e`
4. All tests must pass
5. Push → GitHub Actions auto-runs CI
6. Open PR
7. Merge after approval (auto-deploys)

---


