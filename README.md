# Attendance Recorder

Browser-based attendance system for remote construction-site staff. Selfie + GPS + device fingerprint per punch, supervisor verification, project lifecycle, free-tier MVP.

Full design & architecture: [plan.md](plan.md) (single source of truth — competitive research, schema, RLS, milestones, anti-patterns).
Operations runbook: [docs/runbook.md](docs/runbook.md).
Per-feature implementation specs: [docs/feat-*.md](docs/).

## Stack

- **Frontend** — React 18 + Vite 6 + TypeScript PWA, Tailwind, TanStack Query, react-router, react-i18next, vite-plugin-pwa, Leaflet, FingerprintJS
- **Backend** — Supabase (Postgres 15 + Auth + Storage + Edge Functions + Realtime)
- **Hosting** — Cloudflare Pages (static) + Supabase managed (data)
- **Maps** — Leaflet + OpenStreetMap

## Repo layout

```
.
├── apps/
│   └── web/                     React PWA (workers + supervisor + admin)
│       ├── src/
│       └── e2e/                 Playwright UI tests
├── supabase/
│   ├── migrations/              SQL schema + RLS + audit chain (0001…0011)
│   ├── functions/               Edge Functions: worker-register, punch-submit,
│   │                            payroll-export, auto-close-shifts, selfie-retention-cron
│   ├── config.toml              Local stack config
│   └── seed.sql                 Local dev seed (1 project, 1 site, 3 workers)
├── scripts/
│   ├── e2e.sh                   API E2E smoke (27 tests, ~12 s)
│   ├── cleanup-tables.sh        Reset all data → seed
│   └── ci-setup.sh              Bootstrap admin supervisor (used by CI)
├── docs/                        Per-feature implementation specs + runbook
├── .github/workflows/ci.yml     Lint + build + API E2E + Playwright on every PR
└── plan.md                      Strategic plan (architecture, scope, milestones)
```

## Quick start (one terminal)

Prereqs: **Node 20+**, **pnpm 10+**, **Docker Desktop running**, **Supabase CLI** (auto-installed via `npx`).

```bash
# 1. Install
pnpm install

# 2. Start the local Supabase stack (Postgres + Auth + Storage + Edge Functions on :54321)
pnpm supabase:start

# 3. Bootstrap the admin supervisor (creates viagr@ciklum.com / LocalDev2026!)
bash scripts/ci-setup.sh

# 4. Start vite + edge functions in parallel (single command, courtesy of `concurrently`)
pnpm dev
```

App runs on **http://localhost:5173** (Vite picks the next free port if 5173/5174 are taken — watch the console).

Default credentials (created by `ci-setup.sh`):

| Who | Email | Password | Role |
|---|---|---|---|
| Admin | `viagr@ciklum.com` | `LocalDev2026!` | admin (full scope on the seed project) |

Three seeded workers (status `invited`, no PIN yet) — pick one in the worker register flow:

| Name | Worker ID | PIN to use in tests |
|---|---|---|
| Ravi Kumar | `33333333-…` | `1234` |
| Priya Singh | `44444444-…` | `5678` |
| Anil Yadav | `55555555-…` | `9012` |

## Reset state any time

```bash
bash scripts/cleanup-tables.sh
```

Wipes all attendance, audit, device logs, daily reports, worker assignments, workers — and re-seeds projects/sites/workers. **Preserves supervisor accounts** so you don't have to re-bootstrap. Run before every E2E re-run if you've been clicking around manually.

---

## Testing

Three layers, all green:

```
        / E2E API     \    27 tests · ~12 s     scripts/e2e.sh
       / E2E UI         \   14 tests · ~46 s     pnpm test:e2e (Playwright)
      / typecheck + build \ pnpm typecheck + pnpm build
```

### Layer 1 — typecheck + build (fastest, runs on every commit)

```bash
pnpm typecheck     # tsc -b --noEmit, ~5 s
pnpm build         # vite build → dist/, ~12 s
```

### Layer 2 — API E2E (no browsers required)

```bash
# Prereqs: supabase started, ci-setup.sh run, edge functions serving
bash scripts/e2e.sh
```

Covers (27 tests across 14 phases):

1. Anonymous worker pick-list (`list_active_workers` RPC)
2. State reset (idempotent re-runs)
3. Worker registration for 3 personas (Ravi / Priya / Anil)
4. Pre-approval auth sign-in
5. Supervisor login + approval of all 3 workers
6. Audit trigger captures the approvals (hash-chained)
7. Worker login + punch IN for all 3
8. Worker punch OUT
9. Supervisor sees attendance feed via Realtime
10. Anomaly flag (`geofence_far`) fires when punch is 7 km off-site
11. Admin reads projects + sites + workers + audit log
12. Worker RLS — Ravi sees only Ravi's punches
13. Offboarded worker cannot sign in (auth user banned via trigger)
14. Final state reset

Pass with custom env (CI / staging):

```bash
API_URL=https://staging.example.com \
ANON_KEY=sb_publishable_xxx \
SUPERVISOR_EMAIL=qa@example.com \
SUPERVISOR_PASS=staging-pass \
bash scripts/e2e.sh
```

### Layer 3 — Playwright UI (real Chromium browser)

One-time setup (downloads ~150 MB of Chromium):

```bash
pnpm test:e2e:install
```

Then run any time the dev stack is up:

```bash
# In one terminal:
pnpm dev

# In another:
E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
# or against the production preview:
pnpm build && pnpm preview
E2E_BASE_URL=http://localhost:4173 pnpm test:e2e
```

Covers (14 tests across 5 personas):

| Spec file | Tests | What's exercised |
|---|---|---|
| [`e2e/home.spec.ts`](apps/web/e2e/home.spec.ts) | 3 | home renders, login form renders, 404 renders |
| [`e2e/worker-flow.spec.ts`](apps/web/e2e/worker-flow.spec.ts) | 4 | worker pick-list populated from anon RPC, register screen, pending screen, PIN sanitisation |
| [`e2e/supervisor-flow.spec.ts`](apps/web/e2e/supervisor-flow.spec.ts) | 7 | login + dashboard tiles, invite-worker form validation, end-to-end invite (verified via fresh anon context), manual punch entry, edit punch flow, admin navigation (projects/sites/workers/audit), sign out |

Auth is shared via the `loginAsSupervisor()` helper in [`e2e/fixtures.ts`](apps/web/e2e/fixtures.ts).

### Run everything in sequence (the full pyramid)

```bash
bash scripts/cleanup-tables.sh && \
pnpm typecheck && pnpm build && \
bash scripts/e2e.sh && \
E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
```

---

## Continuous Integration

Every PR to `main` runs three jobs in [`.github/workflows/ci.yml`](.github/workflows/ci.yml):

| Job | What it does | Typical time |
|---|---|---|
| `lint-and-build` | `pnpm install`, `pnpm typecheck`, `pnpm build` | ~2 min |
| `e2e-api` | Spins up Supabase via `supabase/setup-cli`, bootstraps admin, runs `scripts/e2e.sh` | ~5 min |
| `e2e-ui` | Same setup as e2e-api + `playwright install chromium` + `vite preview` + `pnpm test:e2e` | ~7 min |

On Playwright failure the workflow uploads the `playwright-report/` directory as an artifact; download it from the GitHub Actions run page to see the trace + screenshots.

The CI reads Supabase keys from `npx supabase status -o env` so it works against the locally-generated keys (no secrets needed in repo).

---

## Roles & auth

| URL prefix | Auth | Notes |
|---|---|---|
| `/worker/*` | Supabase Auth with synthetic email `<workerId>@worker.local` (password = `pin + workerId.slice(0,8)`) | One Auth user per worker; banned automatically on offboarding via trigger |
| `/supervisor/*` | Supabase Auth (email + password) + RLS scoped via `scope_project_ids` | Linked to `supervisors.id = auth.users.id` |
| `/admin/*` | Supabase Auth, gated by `requiredRole="admin"` in [ProtectedRoute.tsx](apps/web/src/components/ProtectedRoute.tsx) | A supervisor with `role='admin'` passes |

Worker pick-list (login + register dropdowns) is served by the anon-readable `list_active_workers()` RPC — see [migration 0009](supabase/migrations/0009_critical_fixes.sql).

---

## Deploy

- **Frontend** → Cloudflare Pages, auto-deploy on push to `main`. Build command `pnpm build`, output dir `apps/web/dist`. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in Pages env.
- **Database & functions** → push migrations with `npx supabase db push`; deploy functions with `npx supabase functions deploy <name>`.
- **Cron schedules** (`auto-close-shifts`, `selfie-retention-cron`) → set up once via SQL Editor — see [docs/runbook.md](docs/runbook.md).

---

## Milestones

| | Milestone | Status |
|---|---|---|
| **M0** | Scaffold + repo + CI to Cloudflare Pages | ✅ |
| **M1** | Schema + RLS + admin auth | ✅ |
| **M2** | Worker register + login (Supabase synthetic emails) | ✅ |
| **M3** | Camera + GPS + device-fingerprint capture + Storage upload | ✅ |
| **M4** | Worker UI: punch flow end-to-end + IndexedDB offline queue | ✅ |
| **M5** | Supervisor dashboard: live feed + anomaly pane + bulk verify + approvals | ✅ |
| **M6** | Admin CRUD (projects, sites, workers, audit log) | ✅ |
| **M7** | CSV payroll export + Hindi locale + PWA install prompt + daily site report | ✅ |
| **M8** | Hardening: rate limit + retention cron + auto-close cron + runbook | 🟡 |
| **M9** | Code-review fixes (RLS recursion, audit triggers, audit hash, offline queue, briefing ack, daily report UI, Playwright scaffold) | ✅ |
| **M10** | Supervisor self-service (invite worker / manual punch / edit punch / multi-site assignments) + UI tests + CI | ✅ |

🟡 = scaffolded; deferred follow-ups tracked in [plan.md §21c](plan.md).

---

## Common ops

| What | How |
|---|---|
| See latest local logs | `npx supabase status` and follow the URLs |
| Tail Edge Function output | `npx supabase functions serve --no-verify-jwt` (foreground) |
| Reset all data → seed | `bash scripts/cleanup-tables.sh` |
| Re-bootstrap admin | `bash scripts/ci-setup.sh` |
| Apply a new migration | `npx supabase db reset` (local) or `npx supabase db push` (cloud) |
| Stop everything | `pnpm supabase:stop` |
| Inspect DB | open http://127.0.0.1:54323 (Studio) |
| Inspect emails | open http://127.0.0.1:54324 (Inbucket) |

## License

UNLICENSED (private project — pick a license before going commercial).
