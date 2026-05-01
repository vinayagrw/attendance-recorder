# Attendance Recorder — MVP Design & Architecture

## Context

You need a browser-based attendance system for remote construction-site staff. No client install, low cost (free tier where possible), MVP-friendly but with a project lifecycle so sites can be created → in-progress → archived as new ones come online. Identity is verified via selfie + GPS captured at punch-in/out, with supervisor manual review (auto face-matching is scaffolded but mocked for v1).

**Confirmed scope (from your answers):**
- Scale: 5–10 sites initially, growing. Project lifecycle is required.
- Verification: selfie + GPS + device fingerprint captured every punch; supervisor reviews; auto face-match deferred (mocked).
- Connectivity: 4G/wifi mostly available (online-first; basic retry is enough).
- Backend: Supabase.
- Auth: name-from-dropdown + PIN, with registration flow gated by supervisor approval.

---

## 1. Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Frontend | **React + Vite + TypeScript**, installable as PWA | Fast, zero-install, works in any modern mobile browser. Vite over Next.js since you don't need SSR for a private app. |
| Styling | **Tailwind CSS** + **shadcn/ui** | Fast UI iteration, mobile-first defaults. |
| State / data | **TanStack Query** + Supabase JS client | Caching, optimistic updates, retry-on-fail out of the box. |
| PWA | **vite-plugin-pwa** (Workbox) | Service worker, install prompt, app-like icons. |
| Forms | **react-hook-form** + **zod** | Schema-validated, lightweight. |
| Charts (dashboard) | **Recharts** | Simple, MIT, small bundle. |
| Backend (BaaS) | **Supabase**: Postgres + Auth + Storage + Edge Functions + Realtime | One-stop. Free tier covers MVP. |
| Auth | **Supabase Auth** with custom flow: PIN stored as bcrypt hash in `workers` table; we use Supabase Auth only for supervisors/admins (email+password), and a **session-token Edge Function** for workers. |
| File storage | **Supabase Storage** bucket `selfies/` (private, signed URLs) |
| Hosting (frontend) | **Cloudflare Pages** or **Vercel** (free) | Global CDN, free SSL. |
| Hosting (backend) | Supabase managed | No servers to operate. |
| Maps (admin geofence config) | **Leaflet + OpenStreetMap** (free) | Avoid Google Maps billing. |
| Geolocation / Camera | Browser APIs: `navigator.geolocation`, `getUserMedia` |
| Reporting | CSV export client-side; PDF later via `jspdf` |
| Error tracking | **Sentry** (free tier 5k events/mo) — optional, add post-MVP |

**Why this combo over alternatives:**
- Firebase: NoSQL doesn't fit attendance reporting queries as cleanly as SQL. Supabase Postgres lets you write straightforward joins for payroll-style reports.
- Cloudflare D1: still maturing for Postgres-style needs; Supabase has the auth/storage/realtime out of the box.
- Custom Node: more work, no MVP benefit at this scale.

---

## 2. Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Worker's mobile browser (PWA)                           │
│  ─ Pick name ─ Enter PIN ─ Punch In/Out                  │
│  ─ Captures: selfie, GPS, device fingerprint, IP         │
└─────────────┬────────────────────────────────────────────┘
              │ HTTPS
              ▼
┌──────────────────────────────────────────────────────────┐
│  Cloudflare Pages / Vercel  (static PWA, free)           │
└─────────────┬────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────┐
│  Supabase                                                 │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Postgres                                            │  │
│  │  workers, sites, projects, attendance,             │  │
│  │  device_logs, audit_log                            │  │
│  └────────────────────────────────────────────────────┘  │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐     │
│  │ Auth        │ │ Storage     │ │ Edge Functions  │     │
│  │ (admin/sup) │ │ (selfies)   │ │ worker-login    │     │
│  │             │ │             │ │ worker-register │     │
│  │             │ │             │ │ punch-submit    │     │
│  └─────────────┘ └─────────────┘ └─────────────────┘     │
│  ┌────────────────────────────────────────────────────┐  │
│  │ Realtime (live dashboard updates)                  │  │
│  └────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
              ▲
              │
┌──────────────────────────────────────────────────────────┐
│  Supervisor / Admin browser (Web Dashboard, same PWA)    │
│  ─ Approve registrations ─ Review daily punches          │
│  ─ Manage projects/sites ─ Export reports                │
└──────────────────────────────────────────────────────────┘
```

### Why Edge Functions for worker-login / punch-submit
Workers don't get a Supabase Auth account; they authenticate via a thin Edge Function that:
1. Looks up the worker by `id` + bcrypt-verifies the PIN.
2. On success, mints a short-lived JWT (1–8 hr) signed with a server secret.
3. Postgres **Row-Level Security (RLS)** policies trust this JWT (custom claim `worker_id`) for read/write on the worker's own attendance rows.

This keeps the front-end stateless, lets RLS do authorization, and avoids paying for Supabase Auth seats for every worker.

---

## 3. Data Flow

### 3a. Worker registration (one-time per worker)
1. Admin pre-creates a `workers` row: `name`, assigned `site_id`, status `invited`.
2. Worker opens app → name dropdown shows all `invited` + `active` workers for the device's last-known site (or "search by name").
3. Worker picks own name, sees "First time? Register" → enters PIN twice, grants camera + location permission → app captures **selfie**, **GPS**, **device fingerprint** (user-agent + canvas fingerprint via `@fingerprintjs/fingerprintjs` open-source build), **IP** (server-derived).
4. Edge Function `worker-register` writes:
   - `workers.pin_hash`, `workers.baseline_selfie_url`, `workers.status = pending_approval`
   - `device_logs` row (device, IP, GPS, timestamp)
5. Supervisor sees worker in **Pending Approval** queue → views selfie, device info, location → **Approves** (status → `active`) or **Rejects** (with reason).
6. Worker is notified next time they open the app.

### 3b. Punch In / Out (every shift)
1. Worker opens app → picks name → enters PIN → Edge Function `worker-login` returns short-lived JWT.
2. App stores JWT in memory only (not localStorage, to limit theft).
3. Worker taps **Punch In** → app captures selfie + GPS + device fingerprint.
4. Edge Function `punch-submit` validates:
   - JWT valid, worker `active`.
   - Distance from assigned site geofence (warn if outside, still record but flag).
   - Last punch state (can't Punch In twice).
   - Device fingerprint vs. registered device — flag if changed.
5. Inserts `attendance` row + uploads selfie to Storage; returns confirmation.
6. **Realtime** channel pushes update to supervisor dashboard.

### 3c. Supervisor daily review
1. Supervisor logs in (Supabase Auth, email+password).
2. Dashboard subscribes to today's `attendance` rows via Realtime.
3. For each row, supervisor sees: worker name, time, selfie thumbnail, GPS map pin, distance from site, device flag, status.
4. Actions: **Verify** (status → `verified`), **Flag** (with reason), **Reject** (status → `rejected`, optional comment).
5. End of day: auto-summary (hours worked = punch-out − punch-in per worker) — exportable to CSV.

---

## 4. Database Schema (Postgres)

```sql
-- Projects (a customer/site contract; sites belong to a project)
projects (
  id uuid pk,
  name text,
  client_name text,
  status text check (status in ('planning','active','on_hold','completed','archived')),
  start_date date, end_date date,
  created_at timestamptz, archived_at timestamptz
)

-- Sites (physical construction locations under a project)
sites (
  id uuid pk,
  project_id uuid fk → projects.id,
  name text,
  address text,
  geofence_lat double precision,
  geofence_lng double precision,
  geofence_radius_m int default 150,
  timezone text default 'Asia/Kolkata',
  status text check (status in ('active','paused','closed')),
  created_at timestamptz
)

-- Workers (no Supabase Auth account; authenticate via PIN)
workers (
  id uuid pk,
  full_name text,
  phone text nullable,
  assigned_site_id uuid fk → sites.id,
  pin_hash text,                         -- bcrypt
  baseline_selfie_url text,              -- registration photo
  status text check (status in ('invited','pending_approval','active','suspended','offboarded')),
  registered_at timestamptz,
  approved_by uuid fk → supervisors.id,
  approved_at timestamptz,
  last_login_at timestamptz,
  created_at timestamptz
)

-- Supervisors / admins (use Supabase Auth)
supervisors (
  id uuid pk references auth.users(id),
  full_name text,
  role text check (role in ('admin','supervisor')),
  scope_project_ids uuid[],              -- which projects they can see
  created_at timestamptz
)

-- Attendance records (immutable insert; status updated by supervisor)
attendance (
  id uuid pk,
  worker_id uuid fk → workers.id,
  site_id uuid fk → sites.id,
  type text check (type in ('in','out')),
  punched_at timestamptz,
  device_lat double precision,
  device_lng double precision,
  gps_accuracy_m real,
  distance_from_site_m real,
  selfie_url text,
  device_fingerprint text,
  user_agent text,
  ip_address inet,
  status text check (status in ('pending','verified','flagged','rejected')) default 'pending',
  flag_reasons text[],
  reviewed_by uuid fk → supervisors.id,
  reviewed_at timestamptz,
  reviewer_comment text,
  created_at timestamptz
)

-- Device & login attempts (security log)
device_logs (
  id uuid pk,
  worker_id uuid fk → workers.id,
  event text check (event in ('register','login','login_fail','punch')),
  device_fingerprint text,
  user_agent text,
  ip_address inet,
  lat double precision, lng double precision,
  created_at timestamptz
)

-- Audit (any state-changing supervisor action)
audit_log (
  id uuid pk,
  actor_id uuid,             -- supervisor.id
  actor_role text,
  action text,               -- 'approve_worker','reject_worker','verify_attendance','update_site'
  target_table text,
  target_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz
)
```

**Key indexes:**
- `attendance(worker_id, punched_at desc)` for worker history
- `attendance(site_id, punched_at desc)` for site daily view
- `attendance(status, punched_at desc) where status='pending'` for review queue
- `workers(status, assigned_site_id)` for dropdown loads

**Row-Level Security (sketch):**
- Workers (via custom JWT claim): can `insert` into `attendance` only for `worker_id = auth.jwt()->>'worker_id'`; can `select` only own rows.
- Supervisors: `select/update` rows where `site.project_id = ANY(supervisors.scope_project_ids)`.
- Admins: full access.

---

## 5. Feature List

### MVP (build now)
**Worker app (mobile PWA)**
- [ ] Name-search dropdown (by site, with "show all")
- [ ] PIN registration (first-time) with selfie + GPS + device capture
- [ ] PIN login
- [ ] Punch In / Punch Out single-screen flow with live preview of selfie + GPS dot on map
- [ ] "Pending approval" wait screen
- [ ] My attendance history (last 7 days) with status badges
- [ ] Online-first with friendly retry on network failure
- [ ] Multi-language UI (English + 1 local language; i18n scaffolding)
- [ ] PWA install prompt + offline shell

**Supervisor dashboard**
- [ ] Email+password login (Supabase Auth)
- [ ] Today's attendance live feed (Realtime)
- [ ] Pending registrations queue with selfie & device review
- [ ] Per-worker history & per-site daily view
- [ ] Manual verify / flag / reject with reason
- [ ] Manual punch correction (with audit log) — for missed punches
- [ ] CSV export per site / per date range

**Admin**
- [ ] Project CRUD with lifecycle states (planning / active / on_hold / completed / archived)
- [ ] Site CRUD: pick location on map → set geofence radius
- [ ] Worker CRUD: invite, edit assigned site, suspend, offboard
- [ ] Supervisor CRUD with project scope
- [ ] Audit log viewer

**Cross-cutting**
- [ ] Stub `face_match_score` field + mocked "Run auto-match" button (returns null/random for now)
- [ ] Privacy policy & data retention setting (default: keep selfies 90 days, attendance 7 years)

### Should-have (after first user feedback)
- Holiday & leave management (sick, paid, unpaid)
- Working-hours auto-calculation + overtime threshold per project
- WhatsApp/email reminder if a worker forgot to punch out (cron via Supabase scheduled functions)
- Bulk worker import (CSV)
- Subcontractor / vendor grouping
- Photo of work-area at end of day (separate optional capture)

### Nice-to-have (later)
- Auto face-match (un-mock the stub) — face-api.js client-side first
- Liveness detection (blink challenge) to deter selfie reuse
- QR code at site as a second factor
- Payroll export (Tally / Excel templates)
- Native wrappers via Capacitor if PWA limits hit (e.g., background geofencing)
- Weather auto-log per site per day
- Manager mobile app variant of dashboard

### Security & compliance must-haves (don't skip even at MVP)
- bcrypt PIN hashing; rate-limit `worker-login` to 5 fails / 15 min per worker_id+IP
- HTTPS-only; HSTS via host
- Selfie storage: private bucket, signed URLs only (15-min expiry)
- IP + device fingerprint logged on every login & punch
- Server-derived `punched_at` (don't trust device clock)
- RLS enforced on all tables
- PII data export & delete on request (GDPR-style worker right) — even if not legally required, good hygiene
- Backups: enable Supabase daily backups (free tier 7 days)

---

## 6. Cost Estimate (MVP, 5–10 sites)

| Service | Free tier | Estimated MVP usage | Cost |
|---|---|---|---|
| Supabase | 500MB DB, 1GB storage, 2GB egress, 50K MAU | ~50MB DB, ~200MB selfies/mo, low egress | **$0** |
| Cloudflare Pages | Unlimited requests, 500 builds/mo | Well within | **$0** |
| Domain (optional) | — | $10–15/yr | ~$1/mo |
| Sentry (optional) | 5k events/mo | Within | **$0** |
| Total | | | **≈ $0–1/mo** |

**Watch points as you scale:**
- 100+ workers × 2 selfies/day × 30 days × ~150KB ≈ 900MB/mo → still within Storage free tier.
- 300+ workers will push you past free Storage; switch selfies to **Cloudflare R2** (10GB free, $0.015/GB after) and store URL in Postgres.
- DB size: attendance rows are ~500 bytes; 300 workers × 60 days × 2 punches ≈ 18MB. Plenty of room.

---

## 7. Suggested Project Structure

```
attendance-recorder/
├── apps/
│   ├── web/                       # React PWA (workers + dashboard share routes by role)
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   │   ├── worker/        # /punch, /history, /register, /pending
│   │   │   │   ├── supervisor/    # /dashboard, /approvals, /reports
│   │   │   │   └── admin/         # /projects, /sites, /workers, /audit
│   │   │   ├── components/
│   │   │   ├── lib/
│   │   │   │   ├── supabase.ts
│   │   │   │   ├── geolocation.ts
│   │   │   │   ├── camera.ts
│   │   │   │   ├── deviceFingerprint.ts
│   │   │   │   └── i18n.ts
│   │   │   ├── hooks/
│   │   │   └── store/
│   │   ├── public/manifest.webmanifest
│   │   └── vite.config.ts
│   └── (future: capacitor wrapper)
├── supabase/
│   ├── migrations/                # SQL migrations
│   ├── functions/                 # Edge Functions
│   │   ├── worker-register/
│   │   ├── worker-login/
│   │   └── punch-submit/
│   └── seed.sql
├── docs/
│   ├── architecture.md
│   ├── data-model.md
│   └── runbook.md
└── README.md
```

---

## 8. Implementation Milestones

| # | Milestone | Output |
|---|---|---|
| **M0** | Supabase project + repo + CI to Cloudflare Pages | Empty PWA deployed to a URL |
| **M1** | Schema + RLS + admin auth | Admin can create projects/sites/workers via SQL or temp UI |
| **M2** | Worker register + login Edge Functions + RLS proof | One worker can register, get JWT, insert dummy attendance row |
| **M3** | Camera + GPS + device-fingerprint capture + Storage upload | Selfie shows up in admin's Supabase Storage browser |
| **M4** | Worker UI: punch flow end-to-end | Real punch-in / punch-out works on a phone |
| **M5** | Supervisor dashboard: live feed + approval queue + verify | Whole loop works for one site |
| **M6** | Admin CRUD UI for projects/sites/workers + audit log viewer | No more SQL needed for daily ops |
| **M7** | Reports & CSV export + i18n + PWA install polish | MVP-launchable |
| **M8** | Hardening: rate limit, retention job, backups verified, runbook | Production-ready |

---

## 9. Verification (how to test end-to-end)

**Local dev:**
1. `supabase start` → local stack with Postgres + Auth + Storage.
2. Apply migrations + seed sample project, site, supervisor, 3 workers.
3. `pnpm dev` in `apps/web` → open in two browsers (one as worker on a phone over the LAN URL, one as supervisor on desktop).
4. Walk the three flows in section 3 manually.

**Geofence check:**
- Use Chrome DevTools → Sensors → spoof location to a coordinate inside vs. outside the site geofence and confirm flag.

**Device-change flag:**
- Register on one browser; punch from a second browser and confirm the dashboard flags the device change.

**RLS check:**
- With supervisor JWT, attempt to read another supervisor's project's data → expect empty result.
- With worker JWT, attempt to insert attendance for a different worker → expect 403.

**Load smoke (later):**
- Script 100 concurrent punch-submits via `k6` → confirm Edge Function and DB latency stay reasonable.

**Production deploy:**
- Push to main → Cloudflare Pages builds → smoke-test register/punch/review on prod URL.
- Verify daily Supabase backup is enabled in dashboard.

---

## 10. Risks & Things to Watch

| Risk | Mitigation |
|---|---|
| Worker shares phone & PIN with someone | Device fingerprint flag; supervisor reviews selfie daily; PIN reset flow with re-approval. |
| GPS spoofing apps | Compare GPS accuracy field; flag suspiciously round coordinates; cross-check with IP geolocation. |
| Selfie reuse (showing old photo to camera) | Mocked auto-match for now; later add liveness (blink). Supervisor visual review catches the obvious cases. |
| Free-tier limits exceeded silently | Monitor Supabase usage weekly; set up email alert at 80% storage. |
| Worker can't access camera/GPS (denied permission) | Clear instructions screen; supervisor can record manual punch with reason (logged in audit). |
| Clock drift between worker phone and server | Server-derived `punched_at`; device time stored separately for forensic comparison only. |
| Data residency | Pick Supabase region close to workers (e.g., `ap-south-1` Mumbai for India). Document in privacy policy. |
| Vendor lock-in (Supabase) | Postgres + standard JWT means you can self-host or migrate to RDS later with limited rewrite. Keep all auth logic in Edge Functions, not vendor-only auth flows. |

---

## 11. Critical Files to Create First (for M0–M2)

- `supabase/migrations/0001_init.sql` — schema from §4
- `supabase/migrations/0002_rls.sql` — row-level security policies
- `supabase/functions/worker-register/index.ts`
- `supabase/functions/worker-login/index.ts`
- `supabase/functions/punch-submit/index.ts`
- `apps/web/src/lib/supabase.ts` — client init
- `apps/web/src/lib/deviceFingerprint.ts` — fingerprintjs wrapper
- `apps/web/src/routes/worker/register.tsx`
- `apps/web/src/routes/worker/punch.tsx`
- `apps/web/src/routes/supervisor/approvals.tsx`
- `apps/web/src/routes/supervisor/dashboard.tsx`

---

## 12. Open Decisions for You

1. **Region** for Supabase project (impacts latency for workers): Mumbai? Frankfurt? US-East?
2. **Domain name** for the app — or use the free `*.pages.dev` subdomain initially.
3. **Languages** to support at launch beyond English (Hindi? Tamil? Russian? Ukrainian?).
4. **Photo retention** policy — default proposed: 90 days for selfies, then deleted; attendance metadata kept indefinitely (or per local labour-law requirement).
5. **Holiday calendar** source — manual per project, or pull from a country calendar API.

---

## 13. Competitive Research — Top 3 in 2026 (construction-specific)

> Sourced from 2026 / late-2025 product pages and verified reviews on G2, Capterra, GetApp. Generic time-trackers (Clockify, Toggl) excluded.

### #1 — Workyard
Category leader for 2026 by feature depth. **Polygon multi-site geofencing**, **automatic drive-time vs on-site discrimination** with mileage capture, **AI Smart-Form builder** (no-code generator that clones existing safety / compliance forms), and one-click payroll export to QuickBooks / ADP / Gusto / Sage 300 CRE / Foundation. Audit-ready timesheets with prevailing-wage documentation. Offline-first.
**Pricing:** $6–$13 / user / month + $50 base. No free plan, 14-day trial.
**Target:** Mid-size specialty/general contractors (10–500 field workers) with multi-site and union/prevailing-wage exposure.

### #2 — busybusy
Two construction-native differentiators that matured in 2025–2026: (a) **AI facial-verification kiosk mode** that notifies the office when someone clocks in for someone else, (b) **equipment-level GPS** so heavy machinery is "assigned" to a job site and a "**Required Onsite**" rule ties a punch to the job's polygon. Strong offline-first behavior is widely cited as why field crews actually use it. Also ships an AI Smart-Forms builder.
**Pricing:** Freemium. Pro ~$11.99 / user / month + $40 admin license.
**Target:** Heavy-civil, excavation, equipment-intensive contractors; smaller crews who want to start free.

### #3 — SmartBarrel
The cleanest reference design for the user's MVP flow: **AI facial-verification (verification, not 1:N recognition) tuned for hardhats / masks / safety glasses**, with phone-number or fob as the identity claim. Delivered as a rugged 5G/LTE solar **kiosk** that needs no Wi-Fi and no personal-device app — directly addresses the "workers won't install apps on personal phones" adoption killer.
**Pricing:** Quote-based, hardware + SaaS bundle (TimeClock 4.0 unit + per-user SaaS). Enterprise / mid-market.
**Target:** Commercial / industrial GCs and self-perform contractors who don't want to depend on personal smartphones.

**Honourable mentions:** Connecteam ($29/mo for 30 users, all-in-one with comms/scheduling — but **no offline mode**, biggest construction weakness), Truein (face + GPS, mask-tolerant, popular in India/MENA labor markets), Procore (broad construction PM, **time tracking is intentionally basic** — many pair it with Workyard; in 2026 added unified "labor + equipment" grid), Raken (daily reports + time), ExakTime (legacy, hardware-replacement complaints), Hubstaff Field, Jibble (free tier with face recognition), Timeero (polygonal geofences).

### Feature matrix (at a glance)

| Capability | Workyard | busybusy | SmartBarrel | Your MVP (proposed) |
|---|---|---|---|---|
| Selfie + GPS per punch | ✅ | ✅ | ✅ | ✅ |
| Face verification (vs recognition) | ✅ | ✅ kiosk | ✅ PPE-tolerant | 🕐 mocked v1 → un-mock with on-device descriptor |
| Passive liveness | partial | partial (behavior) | ✅ | ❌ → **add to MVP (heuristic)** |
| Polygonal geofence | ✅ | ✅ | n/a (kiosk) | ❌ circle only → **upgrade in MVP** |
| Mock-GPS / teleport detection | server heuristics | server heuristics | bypassed (kiosk) | ❌ → **add to MVP** |
| Driving / motion gate | ✅ (drive-time discrimination) | ✅ | n/a | ❌ → **add to MVP** |
| Auto clock-in on geofence entry | ✅ | ✅ Required Onsite | n/a | post-MVP |
| Offline-first punch queue | ✅ | ✅ | n/a (LTE) | partial → **upgrade to IndexedDB queue in MVP** |
| Kiosk / shared device | ✅ | ✅ flagship | ✅ flagship | post-MVP |
| Equipment-tied geofences | partial | ✅ flagship | n/a | out of scope |
| Smart-Form / safety form builder | ✅ AI | ✅ AI | partial | out of scope |
| AI anomaly detection on timesheets | ✅ | ✅ | ✅ | ❌ → **add daily digest in MVP** |
| Payroll integrations | deep | deep | deep | CSV only at MVP |
| Pricing | paid-only | freemium | enterprise | **$0/mo** ← your edge |

---

## 14. 2026 Innovations & What's Now Table-Stakes

These are the things that have **shifted from "nice-to-have" to expected** in the last 12–18 months. Calling them out so we can decide which to absorb into the MVP vs. roadmap.

| # | Feature | Status in 2026 | Cheap to add? | Recommendation |
|---|---|---|---|---|
| 1 | **Passive liveness** (no blink challenge — texture/depth from single image) | Table-stakes | Medium — small ONNX model in browser | **Add to MVP** (catches printed photos at near-zero ongoing cost) |
| 2 | **PPE-aware face recognition** (works with hard hat, glasses, mask) | Differentiator | Hard | Defer; when we un-mock face match, use a model fine-tuned for PPE |
| 3 | **Polygonal / multi-zone geofences** | Table-stakes | Easy | **Add to MVP** (Leaflet draws polygons; Postgres has `ST_Contains`) |
| 4 | **Auto clock-in on geofence entry** (Web Geolocation watcher when app open) | Differentiator | Medium | Post-MVP, opt-in. Background geofencing needs Capacitor |
| 5 | **AI PPE detection from selfie** (helmet/vest/glasses) | New differentiator (2026) | Medium | **Strong opportunity** — even a basic YOLO-nano model in a Supabase Edge Function or client-side TF.js, run on the existing selfie. Flags non-compliance; supervisors love it. Add post-MVP. |
| 6 | **Voice-first / conversational UI** for low-literacy or hands-busy workers | Emerging | Easy | Add a mic button on registration ("speak your name") and Q&A help. Browser SpeechRecognition is free. Post-MVP. |
| 7 | **Predictive absenteeism** (flag workers trending toward attendance issues) | Emerging | Easy heuristic, hard if ML-based | Heuristic version: "missed N of last M days" → flag in dashboard. Add post-MVP. |
| 8 | **Wearable / health integration** (Fit/Health/Garmin sync, heat-stress alerts) | Emerging in adjacent wellness apps | Hard | Out of scope for MVP. Reconsider if user injuries / heat issues are a real risk. |
| 9 | **Selfie watermark with timestamp + GPS overlay** burnt into the image | Now common | Easy | **Add to MVP** — tamper-evident record at near-zero cost (canvas overlay before upload) |
| 10 | **Anomaly alerts** (punch from 100 km away, unusual hour, new device) | Common | Easy | **Add to MVP** — pure server-side rules in the Edge Function; flag → supervisor reviews |
| 11 | **Crew / group punch (with safeguards)** | Construction-specific | Medium | Post-MVP — common request, but ethically tricky; gate behind supervisor presence |
| 12 | **Site-of-day briefing** (supervisor's note + safety reminder shown at punch-in) | New + sticky | Easy | **Add to MVP** — just a `daily_notes` field on `sites` shown on punch screen. Big retention boost. |
| 13 | **Daily site report** (Raken-style: weather, headcount, blockers, photos) | Established | Medium | Post-MVP — gives the app a second job, pulls supervisors in daily |
| 14 | **2FA for admin/supervisors via TOTP** | Now expected for any work tool | Easy | **Add to MVP** — Supabase Auth supports TOTP natively |
| 15 | **Web Push notifications** for missed punch / pending approval | Common | Easy | **Add to MVP** for supervisors; defer for workers (PWA on iOS still flaky) |
| 16 | **Automatic break/overtime calc with regional rules** | Table-stakes for paid tools | Medium | Post-MVP — needs labour-law rule per region |
| 17 | **Audit-log immutability with hash chain** | Niche but increasingly demanded for compliance | Easy | **Add to MVP** — append-only table + each row stores `prev_hash` + `row_hash`; cheap, gives credibility |
| 18 | **Conversational data export ("show hours for site X last week")** | Emerging | Hard | Out of scope. A hardcoded reports page is enough. |

---

## 15. Design Critique — Gaps in the Original Plan

Self-critique of v1, calibrated against the 2026 baseline. Severity: 🔴 must-fix before launch · 🟡 should-fix in MVP · 🟢 acceptable to defer.

| # | Gap | Severity | Fix |
|---|---|---|---|
| 1 | No **passive liveness** — printed selfie photo defeats the system today | 🔴 | Add a small browser ONNX liveness model (e.g., MiniFASNet) before submit; flag low-score punches for supervisor. |
| 2 | **Geofence is a single circle** — real construction sites are L-shaped / multi-building | 🔴 | Schema: replace `geofence_lat/lng/radius_m` with `geofence_polygon geometry(Polygon, 4326)` (PostGIS). Allow multiple polygons per site. |
| 3 | **No PIN brute-force lockout** beyond rate-limiting; attacker still gets unlimited tries via IP rotation | 🔴 | After 5 fails per worker_id (any IP) within 15 min → lock worker account, supervisor unlocks. |
| 4 | **No PIN reset flow** | 🔴 | Worker requests reset → supervisor sees in queue, captures fresh selfie + new PIN in person, approves. |
| 5 | **Forgotten punch-out** is hand-waved as "manual correction" | 🟡 | Auto-close shifts at midnight site-time with status `auto_closed`; supervisor must adjust before payroll export. |
| 6 | **No client-side selfie quality check** — workers will upload blurry, dark, no-face photos all day | 🟡 | Use `face-api.js` tiny detector before submit: must detect a face, brightness > threshold, sharpness > threshold. Re-prompt if fail. |
| 7 | **No client-side photo compression** — 3MB iPhone photos waste storage and bandwidth | 🟡 | Resize to 800px longest edge + JPEG q=0.7 in browser. Drops ~3MB → ~80KB. |
| 8 | **No selfie watermark** with timestamp/GPS overlaid on the image itself | 🟡 | Canvas-draw timestamp+coords on the bottom of the photo before upload. Tamper-evident at zero cost. |
| 9 | **No "site-of-day briefing"** on the punch screen | 🟡 | `sites.daily_note` text field, supervisor edits, shown above the Punch button. Big retention/UX win. |
| 10 | **No anomaly alerts** beyond the static `flag_reasons` array | 🟡 | Add server-side rules in `punch-submit`: distance>500m → `geofence_far`; new device → `new_device`; unusual hour → `off_hours`. Push to dashboard alert pane. |
| 11 | **No 2FA for admins/supervisors** | 🟡 | Enable Supabase Auth TOTP for `role in ('admin','supervisor')`. |
| 12 | **No Web Push notifications** for supervisor (pending approvals, anomalies) | 🟡 | Add Web Push subscription on supervisor dashboard; Supabase Edge cron fires alerts. |
| 13 | **Audit log is mutable** (any DB writer with creds can edit `audit_log`) | 🟡 | Add `prev_hash`, `row_hash` columns; trigger computes hash on insert; revoke UPDATE/DELETE on the table at SQL level. |
| 14 | **`workers.assigned_site_id` forces 1 site** — workers in construction frequently rotate | 🟡 | Promote to `worker_site_assignments` (worker_id, site_id, valid_from, valid_to, primary). Worker can punch at any current site. |
| 15 | **No buddy-punch heuristic** — same device used by 2+ workers in a day should flag | 🟡 | Edge Function checks prior punches by `device_fingerprint` in last 12h; if different `worker_id`, flag both. |
| 16 | **No connectivity indicator / queued-state UX** | 🟡 | Service Worker queues failed punches in IndexedDB; banner shows "Punch queued, will sync when online" + count. |
| 17 | **No GDPR-style worker data export & delete** | 🟢 | Add admin action: "Export worker JSON + selfies zip" / "Delete worker (cascade)". Defer to launch + 1. |
| 18 | **Multi-tenancy** not addressed (if you ever sell this to a second company) | 🟢 | Add `org_id` column on every table now (default to single org). Cheap insurance. |
| 19 | **No kiosk mode** for crews without smartphones | 🟢 | Defer; design `/kiosk/:siteId` route post-MVP — auto-logout after each punch, requires PIN on every punch. |
| 20 | **PPE detection from selfie** not in plan | 🟢 | Strong differentiator for 2026 but heavy lift. Defer to post-MVP. |
| 21 | **Internationalization** mentioned but no locale list and no RTL support | 🟢 | Choose 2 locales upfront; ensure i18n library (react-i18next) is wired even if only English at launch. |
| 22 | **Selfie storage retention** says 90 days but no automated cleanup job | 🟢 | Supabase Scheduled Function, daily, deletes selfie blobs older than retention. Add at M8. |

**Net effect on MVP scope:** ~12 🟡+🔴 items must shift left. Most are small (≤1 day each). Total added work: roughly 1 extra week vs. original plan.

---

## 16. User Research — Personas & Field Constraints

> Quick personas to sanity-check feature decisions. Not formal research — assemble actual interviews after MVP launch (3–5 workers, 2 supervisors, 1 admin).

### Persona A — "Ravi", the worker
- **Demographics:** 28–45, mixed literacy, often migrant. Mid-range Android (₹10–20k phone, 4–32 GB storage). Sometimes shares device with family.
- **Goals:** Get clocked in fast. Get paid right. Avoid arguments about hours.
- **Frustrations:** Slow apps, surveillance feeling, missed punches costing wages, confusing English UIs, low data plan.
- **Implications for design:**
  - Big touch targets (gloves), bottom-anchored CTA.
  - Worker name shown with avatar/photo (not just text — helps low-literacy).
  - Visible "queued/sent" state — never let them wonder if their punch saved.
  - Local-language UI is not optional.
  - Camera permission denial must have a graceful fallback (supervisor manual punch).

### Persona B — "Priya", the supervisor / site engineer
- **Demographics:** 30–50, mid-tech-comfort, juggling material orders, safety, headcount.
- **Goals:** See who's on site right now. Catch anomalies fast. Approve/reject in seconds.
- **Frustrations:** Drowning in dashboards, false flags she has to chase, end-of-month reconciliation hell.
- **Implications for design:**
  - Single-pane "today" view: anomalies on top, normal punches below.
  - Bulk verify (select all → approve) for clean days.
  - Mobile-friendly dashboard — they're often in the site office or roaming.
  - Push notification for anomalies, not every punch.

### Persona C — "Vinay", the admin / owner
- **Demographics:** Decision-maker, cost-conscious, growing business.
- **Goals:** Cheap to run, accurate hours for payroll, insights about attendance trends.
- **Frustrations:** Time theft, messy CSV exports, vendor lock-in.
- **Implications for design:**
  - Free tier path must stay viable as you scale to 10–15 sites.
  - CSV export must match payroll provider's column expectations (config later).
  - Easy data export "just in case I switch tools".
  - Headline KPIs: hours-per-site-this-week, attendance-%, anomalies-count.

### Field constraints to bake in (from construction-tech research)
- **GPS accuracy on metal/concrete sites:** routinely 30–80 m. Geofence radius default of 150 m is reasonable; allow 50–500 m.
- **Battery anxiety:** workers don't keep apps open. Don't rely on background location.
- **Hot/dirty hands:** capacitive touch may fail; design forgiving touch targets.
- **Bright sun:** screens are unreadable; high-contrast UI, large text.
- **Hard hat + safety glasses:** when face match returns, must work without removal — reflects in our model choice later.

---

## 17. Anti-Patterns to Avoid (from competitor review complaints)

Things real customers complained about on Capterra / G2 / Reddit in 2026 — design against these.

1. **Surveillance creep** — apps that ping location every minute or take random photos. Workers revolt. **Our line:** capture only on punch events; explicit, predictable, never silent.
2. **"AI verification" that fails on hard hats** — a known SmartBarrel-killer when generic models are used. **Our line:** when we un-mock face match, use a PPE-aware model or fall back to manual review.
3. **Hidden fees / surprise application fees on payroll exports** — actual G2 complaint. **Our line:** zero cost at MVP, transparent pricing if commercialized.
4. **Bloated dashboards** that bury daily must-do actions. **Our line:** supervisor sees pending approvals + anomalies first — a single screen.
5. **Native-app-only** — alienates BYOD workers and IT-locked Android. **Our line:** PWA primary; Capacitor wrap only if needed.
6. **Unexpected logouts / data loss** — common reliability complaint. **Our line:** queue all writes locally with Service Worker; never lose a punch.
7. **GPS lag in remote areas** treated as user error. **Our line:** show GPS-fix progress; allow soft-submit with `gps_pending` flag if no fix in 10s.
8. **Slow approval workflow** on supervisor side. **Our line:** bulk verify + keyboard shortcuts + sensible default-approve for clean punches.
9. **Job-costing weakness** when workers split shop/field time. **Our line:** allow `task_tag` (optional) per punch in post-MVP; carry through to reports.
10. **Setup requires consultants.** **Our line:** admin can self-onboard (project → site → invite workers) in <10 minutes.

---

## 18. Revised MVP Scope (Delta)

Items added to MVP from the critique (§15) plus the deeper-research additions (§19a). Each "Spec" link below is the developer-facing implementation doc. **TBD** = needs a spec written before implementation.

### Worker app additions

| Feature | Status | Milestone | Spec |
|---|---|---|---|
| Selfie quality check (face detected + brightness/sharpness) | Approved | M4 | [feat-selfie-metadata-validation.md](docs/feat-selfie-metadata-validation.md) |
| Selfie metadata cross-validation (NEW — anti-spoof) | Proposed | M4 | [feat-selfie-metadata-validation.md](docs/feat-selfie-metadata-validation.md) |
| Client-side photo compression (≤100 KB) | Approved | M3 | [feat-photo-compression.md](docs/feat-photo-compression.md) |
| Selfie watermark (timestamp + GPS + device-fingerprint hash) | Approved | M3 | [feat-selfie-watermark.md](docs/feat-selfie-watermark.md) |
| Connectivity indicator + queued-state banner (Service Worker) | Approved | M4 | TBD |
| Site-of-day briefing shown above Punch button | Approved | M4/M5 | [feat-site-of-day-briefing.md](docs/feat-site-of-day-briefing.md) |
| Forgot-PIN flow (request → supervisor) | Approved | M5 | TBD |

### Supervisor / admin additions

| Feature | Status | Milestone | Spec |
|---|---|---|---|
| Anomaly pane on dashboard (geofence_far, new_device, off_hours, buddy_punch, etc.) | Approved | M5 | [feat-anomaly-detection.md](docs/feat-anomaly-detection.md) |
| Mocked anomaly notification channel (`notification_outbox`) | Approved | M5 | [feat-anomaly-detection.md](docs/feat-anomaly-detection.md) |
| Bulk verify | Approved | M5 | [feat-anomaly-detection.md](docs/feat-anomaly-detection.md) |
| Web Push subscription for supervisor (mocked v1) | Approved | M5 | [feat-anomaly-detection.md](docs/feat-anomaly-detection.md) |
| 2FA via TOTP (Supabase Auth) | Approved | M8 | TBD |
| Polygonal geofence editor (Leaflet draw + PostGIS `ST_Contains`) | Approved | M6 | TBD |
| PIN reset / lockout admin action | Approved | M6 | TBD |
| Multi-site assignment (`worker_site_assignments`) | Approved | M6 | TBD (schema in `supabase/migrations/0001_init.sql`) |
| Forgotten punch-out auto-correction | Approved | M8 | [feat-forgotten-punchout.md](docs/feat-forgotten-punchout.md) |
| Daily site report (Raken-style) | Approved | M7 | [feat-daily-site-report.md](docs/feat-daily-site-report.md) |
| Selfie storage lifecycle (retention + cleanup + GDPR) | Approved | M8 | [feat-selfie-storage-lifecycle.md](docs/feat-selfie-storage-lifecycle.md) |
| Payroll integration (CSV in v1, named integrations later) | Mocked v1 | M7 (CSV) / Post-MVP (deeper) | [feat-payroll-integration.md](docs/feat-payroll-integration.md) |

### Schema deltas (consolidated)

- Replace `sites.geofence_lat/lng/radius_m` with `sites.geofence geography(MultiPolygon, 4326)` + keep `default_lat/lng/radius_m` as fallback. *(Already in `0001_init.sql`.)*
- Replace `workers.assigned_site_id` with `worker_site_assignments(worker_id, site_id, valid_from, valid_to, is_primary)`. *(Already in `0001_init.sql`.)*
- Add `sites.daily_note text` + history table `site_briefings` (+ trigger). *(See `feat-site-of-day-briefing.md`.)*
- Add `attendance.is_live_score real`, `attendance.face_quality_score real`, `attendance.face_match_score real` *(stub)*. *(Already in `0001_init.sql`.)*
- Add `attendance.selfie_metadata jsonb`, `attendance.selfie_sha256 text`, `attendance.capture_method text`. *(See `feat-selfie-metadata-validation.md`.)*
- Add `attendance.max_flag_severity text` + `sites.rule_overrides jsonb` + `sites.shift_window_local jsonb`. *(See `feat-anomaly-detection.md`.)*
- Add `audit_log.prev_hash`, `audit_log.row_hash`; revoke UPDATE/DELETE. *(Already in `0003_audit_chain.sql`.)*
- Add `notification_outbox` table. *(See `feat-anomaly-detection.md`.)*
- Add `daily_site_reports` table + `site-reports` storage bucket. *(See `feat-daily-site-report.md`.)*
- Add `projects.retention_days jsonb`, `workers.erased boolean`. *(See `feat-selfie-storage-lifecycle.md`.)*
- Add `org_id uuid` on all tables (default value, single org for now) — multi-tenant insurance. *(Already in `0001_init.sql`.)*

### Milestone changes

- **M3** expands: photo compression + watermark + selfie metadata capture (no liveness model yet).
- **M4** expands: site-of-day briefing display + connectivity indicator + selfie quality client-side checks.
- **M5** expands: anomaly pane, bulk verify, mocked push subscription, forgot-PIN flow, supervisor-edited briefing, mocked anomaly notifications.
- **M6** expands: polygon editor, PIN reset/lockout, multi-site assignment UI, admin storage view (lite).
- **M7** expands: payroll CSV export with pre-flight gates + daily site report (full).
- **M8** expands: TOTP enrolment, audit hash chain (already wired), retention cron, auto-close cron, GDPR erase admin action.

Estimated added time vs. original v1 plan: **~7–10 working days** (raised from earlier estimate of 5–7 to account for daily-site-report, forgotten-punch-out, and storage-lifecycle work that wasn't in the first critique).

---

## 19. Additional 2026 Findings (deep-dive supplement)

Net-new insights from the deeper competitive research pass. These either modify the MVP scope or document genuinely-2026 directions worth knowing.

### 19a. New must-have in MVP (gaps the first critique missed)

| # | Gap | Why it matters in 2026 | Concrete fix |
|---|---|---|---|
| 23 | **Server-side mock-GPS / teleport detection** | Spoofer apps are ubiquitous; basic GPS+selfie is now defeatable | In `punch-submit` Edge Function: reject if `gps_accuracy_m > 80`; flag if velocity from previous punch is impossible (>120 km/h on foot/vehicle); flag if coords match prior punch to >5 decimal places (mock-app signature); optionally store Wi-Fi BSSID hash and cross-check vs prior punches at the same site. |
| 24 | **Driving / motion gate** | Workyard reviewers explicitly flag punching while driving as unsafe | If `speed` from `navigator.geolocation` > 8 km/h, show a "You appear to be moving — confirm you are not driving" interstitial; log `flag_reason='in_motion'`. |
| 25 | **GPS edge-bounce tolerance** | Workyard's #1 complaint: workers physically on site can't punch because GPS drift puts them just outside the polygon | Soft tolerance: if distance to polygon ≤ 30 m AND gps_accuracy ≥ that distance, accept with `flag_reason='edge_tolerance'`; supervisor sees and approves with one tap. Add explicit "Request Override" button that creates a flagged punch for supervisor approval. |
| 26 | **"Photo theatre" guard** | Connecteam captures a selfie but does NOT compare to a profile — a placebo control. We must not ship the same illusion. | While auto-match is mocked, the UI must label this honestly ("Selfie captured for supervisor review"). When un-mocked, store the descriptor distance, not just the photo, and surface confidence on the dashboard. |
| 27 | **Auto-suggest job site from current location** | Workyard ships this; users love it. Removes a tap and prevents wrong-site punches | On punch screen, compute `ST_Distance` from current GPS to all sites the worker is assigned to; pre-select the nearest one; one-tap to switch. |

### 19b. New innovations worth tracking (not for MVP)

| # | Feature | Why it's interesting in 2026 | When to revisit |
|---|---|---|---|
| 19 | **WebAuthn / passkey biometrics for PWAs** | Use the device's built-in Face ID / Android face-unlock as a second factor. Biometric vectors never leave the device. PWAs installed to home screen support this in 2026. | Post-MVP; replaces or augments PIN. Big trust + UX boost. |
| 20 | **Equipment-tied geofences** | Heavy machinery has its own geofence; punches correlate to equipment presence to validate operating-vs-idle hours | Only if user expands into equipment rental / heavy-civil work. |
| 21 | **AI Smart-Form / safety-form builder** | Workyard and busybusy both ship no-code generators that clone existing toolbox-talk / JHA forms from images | Post-MVP — opens a "second job" for the app (safety + attendance) and dramatically improves stickiness. |
| 22 | **Conversational / agentic AI workforce assistant** | Procore + Datagrid + Connecteam: workers ask "did I clock out?" via chat/voice and get authoritative answers; supervisors get NL ("show me last week's anomalies on Site B"). | Post-launch +6 months. LLM costs drop, this gets cheap. Phase as add-on, not core. |
| 23 | **Wearable / IoT integrations** (smart hardhats, gas detectors, lone-worker beacons) | Construction wearables market growing ~10% CAGR 2026–2036; same DB as time records | Only if user has wearables in the field already. |
| 24 | **PPE computer vision on the punch selfie** (helmet/vest/glasses present?) | Currently most common in CCTV; flowing into clock-in selfies in 2026 | Post-MVP — strong differentiator at low marginal cost (small YOLO-class model). |
| 25 | **Voice biometric clock-in** | Hands-free / gloves-on environments; emerging trend lists | Niche, watch only. |
| 26 | **Weather-driven schedule auto-adjust + heat-stress alerts** | Kwant / Procore / Datagrid use weather + historical productivity to flag risk | Post-MVP, especially relevant in hot-climate regions (India, Middle East). |

### 19c. Updated anti-patterns (additions to §17)

11. **GPS edge-bounce blocking** — the single most-complained-about workflow in 2026 reviews. Always allow soft tolerance + override path.
12. **Punching while driving** — Workyard reviewers flag this as actively unsafe. Always speed-gate the punch.
13. **Photo theatre** — Connecteam's "selfie capture but no comparison" pattern is a placebo. When we un-mock, actually compare descriptors and surface the confidence score; until then, label the UI honestly.
14. **Hardware-version forced obsolescence** — ExakTime users repeatedly complain about being forced onto new "Hornet" devices on version bumps. We should **lean into** "PWA, no hardware, your existing phones" as a marketing edge.
15. **Adoption death from BYOD refusal** — the #1 reason time-tracking deployments fail. Even a basic `/kiosk/:siteId` route on a shared site phone tablet (worker selects name, enters PIN, snaps selfie, auto-logs-out) would dramatically raise adoption among non-smartphone workers. Promote to MVP if any pilot site has this profile.

### 19d. Strategic positioning

The agent's verdict, which I endorse: **shipping `PWA + on-device face descriptor (when un-mocked) + polygon geofence with smart server-side anti-spoof + offline IndexedDB queue + supervisor real-time approval + daily anomaly digest`** lands you at 70–80 % of what makes Workyard / busybusy / SmartBarrel feel like 2026 products, on a Supabase budget. The remaining 20–30 % — deep payroll integrations, equipment GPS, hardware kiosks, prevailing-wage compliance — is where incumbents have a moat. Don't fight there in MVP.

The full agent research is preserved at `C:\Users\viagr\.claude\plans\i-need-to-build-binary-giraffe-agent-a902332d6093af0e5.md` for reference.

---

## 21. Code Review Findings & Fixes (M9, 2026-05-01)

After M0–M8 shipped, a structured `/code-review` pass surfaced critical RLS bugs that blocked real usage and several gaps where the code was less complete than the milestones implied. This section documents what was found and what's been fixed; live status is in the table below.

### 21a. Critical bugs found and fixed

| # | Bug | Symptom | Fix | Status |
|---|---|---|---|---|
| 1 | RLS infinite recursion on `workers` | Any authenticated SELECT on `workers` returned `54001 stack depth limit exceeded`. Broke supervisor dashboard, approvals, admin workers list, and worker pick-list. | Marked `jwt_worker_id()`, `is_admin()`, `is_supervisor()`, `project_in_scope()` as `SECURITY DEFINER` with `set search_path = public` so they bypass RLS while evaluating their own queries. | ✅ Fixed in [`0009_critical_fixes.sql`](supabase/migrations/0009_critical_fixes.sql) |
| 2 | Anon worker pick-list blocked by RLS | The login + register dropdowns called `select … from workers` as the anonymous role and got an empty list once recursion was fixed (RLS denied access). | New `list_active_workers()` SECURITY DEFINER RPC granted `EXECUTE` to `anon` + `authenticated`. Frontend updated to call `supabase.rpc('list_active_workers')`. | ✅ Fixed |
| 3 | Non-admin supervisors couldn't approve workers | `workers_admin_write` policy was admin-only. A `role='supervisor'` user clicking Approve got a 403. Worked in our seed because viagr@ciklum.com is admin. | Added `workers_supervisor_approve` policy that allows UPDATE when the supervisor scopes contain the worker's site's project. | ✅ Fixed |
| 4 | Audit log INSERT silently denied | `revoke insert on audit_log` from `authenticated` (correctly) prevented client-side INSERTs. The Approvals UI tried to log a reject reason and silently swallowed the 42501 error. | Replaced client-side audit writes with `trg_audit_changes` triggers on `workers`, `attendance`, `sites`, `projects`. Triggers run as SECURITY DEFINER so they write through. Removed the now-unnecessary client INSERT. | ✅ Fixed |
| 5 | Edge Functions weren't being served | `supabase start` runs the runtime container but doesn't auto-serve `supabase/functions/`. Worker register and punch flows would 404 without running `supabase functions serve` in a separate terminal. | Root `dev` script now uses **concurrently** to spawn both vite and `supabase functions serve` together. `pnpm dev` is now the single command. Standalone `pnpm dev:vite` and `pnpm dev:functions` retained for selective starts. | ✅ Fixed |
| 6 | Offboarding didn't disable auth user | Setting `workers.status='offboarded'` left the auth.users row active — the worker could still sign in. | New `trg_worker_offboard_ban` trigger sets `auth.users.banned_until = 'infinity'` on offboard, and clears it if the worker is reactivated. | ✅ Fixed |

### 21b. Promised-but-not-built items, now built

| # | Feature | Was | Now | Notes |
|---|---|---|---|---|
| 7 | IndexedDB offline queue + connectivity indicator | Punch flow required online | [`apps/web/src/lib/offlineQueue.ts`](apps/web/src/lib/offlineQueue.ts) — enqueue/list/drain. [`Punch.tsx`](apps/web/src/routes/worker/Punch.tsx) shows offline + queue-length banners and drains on `online` event. | Punches captured offline survive reload and replay automatically when network returns. |
| 8 | Site-of-day briefing acknowledgement gate | Briefing was shown but not enforced | [`Punch.tsx`](apps/web/src/routes/worker/Punch.tsx) now blocks IN punches until the worker ticks the ack checkbox. Punch payload carries `acknowledgedBriefingId` to `punch-submit`, which writes it to `attendance.briefing_acknowledged_id`. | OUT punches still allowed without ack. |
| 9 | Polygon geofence preview | Admin used circle (lat/lng + radius) only with no map visual | [`SiteMapPreview.tsx`](apps/web/src/components/SiteMapPreview.tsx) — Leaflet + OSM map showing site marker + circle. Embedded inline on each site card in Admin Sites. | Polygon **drawing** still post-MVP — preview renders the existing circle. |
| 10 | Daily site report submission UI | Schema only, no form | [`DailyReport.tsx`](apps/web/src/routes/supervisor/DailyReport.tsx) — supervisor picks site, enters weather/headcount/work-completed/blockers/notes, submits to `daily_site_reports`. Pre-fills attendance headcount automatically. Idempotent (one row per site per day). | New tile on the supervisor dashboard. |
| 11 | E2E test scaffold | None | [`apps/web/playwright.config.ts`](apps/web/playwright.config.ts) + [`apps/web/e2e/home.spec.ts`](apps/web/e2e/home.spec.ts) — 3 smoke tests for the home, worker login, supervisor login routes. | Run with `pnpm test:e2e` after `pnpm test:e2e:install` (downloads Chromium). |

### 21c. Known follow-ups (deferred deliberately)

These were flagged by the review but not urgent for the next deploy. Tracked here so they don't fall off:

- **Selfie metadata cross-validation** — full implementation per [docs/feat-selfie-metadata-validation.md](docs/feat-selfie-metadata-validation.md). Spec written, schema column reserved.
- **Selfie watermark with device fingerprint hash + ULID overlay** — current overlay shows timestamp + GPS only.
- **Photo compression quality ladder** — currently fixed JPEG quality 0.7; spec calls for 0.7→0.6→0.5→0.4 ladder targeting ≤100KB.
- **Auto-close cron timezone math** — uses naïve UTC; need IANA TZ-aware arithmetic via `Temporal` once Deno ships it stable.
- **Selfie retention cron project-level config** — currently uses defaults; should read `projects.retention_days`.
- **2FA TOTP for supervisors** — Supabase Auth supports it; UI not wired.
- **PIN reset flow** for workers — supervisor-mediated request UI not built.
- **Forgot-PIN recovery** — workers stuck if they forget; need supervisor reset path.
- **Worker brute-force lockout** — schema fields exist (`failed_login_count`, `locked_until`) but `signInWithPassword` doesn't read them. Either add a custom Edge Function gating sign-in or document Supabase's built-in rate limit as our control.
- **Worker password entropy** — synthetic password = `pin + workerId.slice(0,8)` and `workerId` is queryable for the pick-list. Effective entropy is just the PIN. Either accept the risk (low — supervisor still reviews) or add a per-worker secret.
- **CSP / security headers** — add `_headers` file for Cloudflare Pages.
- **Code-split admin and supervisor routes** — bundle is 654 KB unminified (196 KB gzipped). Lazy-load.
- **Error boundaries** — a thrown error in any route renders blank.
- **`.gitattributes` with `* text=auto eol=lf`** — eliminate the CRLF warnings on every commit.
- **Anomaly notification delivery** — `notification_outbox` table not yet created; anomaly rules fire but write nowhere. Wire in v1.1.

### 21d. Feature status (consolidated)

Updated since [§18](#18-revised-mvp-scope-delta). ✅ = shipped + verified · 🟡 = scaffold/skeleton · ⏳ = deferred.

| Feature | Status | Reference |
|---|---|---|
| Worker auth via Supabase synthetic emails | ✅ | M2 |
| Worker register + login UI | ✅ | M2 |
| Camera + GPS + device fingerprint capture | ✅ | M3 |
| Punch flow end-to-end with anomaly detection | ✅ | M4 |
| Selfie watermark (timestamp + GPS) | 🟡 (no device hash / ULID) | M3 |
| Client-side photo compression | 🟡 (no quality ladder) | M3 |
| Supervisor dashboard with realtime feed | ✅ | M5 |
| Pending approvals queue | ✅ | M5 |
| Anomaly pane + bulk verify | ✅ | M5 |
| Admin CRUD (projects / sites / workers) | ✅ | M6 |
| Site map preview (Leaflet) | ✅ M9 | M6+M9 |
| Audit log viewer (server-side trigger writes) | ✅ M9 | M6+M9 |
| Payroll CSV export with auto-close gate | ✅ | M7 |
| Hindi locale | ✅ | M7 |
| PWA install prompt | ✅ | M7 |
| Daily site report form | ✅ M9 | M9 |
| Auto-close shifts cron | 🟡 (UTC tz math) | M8 |
| Selfie retention cron | 🟡 (no project config) | M8 |
| Operations runbook | ✅ | M8 |
| IndexedDB offline queue + briefing ack gate | ✅ M9 | M9 |
| Auto-spawn `supabase functions serve` in `pnpm dev` | ✅ M9 | M9 |
| Server-side audit trigger | ✅ M9 | M9 |
| Auto-ban auth user on offboarding | ✅ M9 | M9 |
| E2E smoke test (3 routes) | ✅ M9 | M9 |
| Selfie metadata cross-validation | ⏳ | spec only |
| 2FA TOTP for supervisors | ⏳ | |
| Polygon-drawing geofence editor | ⏳ | preview only |
| PIN reset / forgot-PIN flows | ⏳ | |
| Worker brute-force lockout enforced | ⏳ | schema only |
| Anomaly notification delivery | ⏳ | mocked |

---

## 20. Sources (2026 references used in §13–§19)

- [Top 6 Geofencing Time Clock Apps 2026 — Truein](https://truein.com/blogs/best-geofencing-time-clock-apps-for-employees)
- [Best Geofencing Apps for Mobile Teams 2026 — Timeero](https://timeero.com/post/best-geofencing-apps)
- [Geofence Time Tracking for Construction — SmartBarrel](https://smartbarrel.io/geofence-time-tracking-software/)
- [Best Construction Time Tracking Software 2026 — SmartBarrel review](https://smartbarrel.io/blog/best-construction-time-tracking-software/)
- [6 Best Time Tracking Apps for Contractors 2026 — Connecteam](https://connecteam.com/best-time-tracking-apps-for-contractors/)
- [Workyard vs Procore review](https://www.workyard.com/compare/workyard-vs-procore)
- [Top 9 Geofence Time Tracking Apps for Field Crews 2026 — Workstatus](https://www.workstatus.io/blog/time-attendance/field-crew-geofence-time-tracking-apps/)
- [Mobile Face Attendance / Truein product page](https://truein.com/mobile-based-attendance-system)
- [How AI is Transforming Construction Site Safety 2026 — CompScience](https://www.compscience.com/blog/how-ai-is-transforming-construction-site-safety-in-2026/)
- [PPE compliance via deep learning + pose estimation — ScienceDirect 2025/26](https://www.sciencedirect.com/science/article/pii/S0926580525002717)
- [Discover 7 Top AI Tools for Construction 2026 — SmartBarrel](https://smartbarrel.io/blog/7-top-construction-ai-solutions/)
- [2026 HR Tech Predictions: Voice-assisted UIs — Deloitte](https://action.deloitte.com/insight/4833/2026-hr-tech-predictions-voice-assisted-user-interfaces-will-accelerate-ai-adoption)
- [Workforce Reliability 2026: Absenteeism Impact — EAWorkforce](https://eaworkforce.com/workforce-reliability-absenteeism-productivity-2026/)
- [Best Time Tracking Software 2026 — Capterra index](https://www.capterra.com/time-tracking-software/)