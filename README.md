# Attendance Recorder

Browser-based attendance system for remote construction-site staff. Selfie + GPS + device fingerprint per punch, supervisor verification, project lifecycle, free-tier MVP.

Full design & architecture: [plan.md](plan.md) (single source of truth — competitive research, schema, RLS, milestones, anti-patterns).

## Stack

- **Frontend** — React + Vite + TypeScript, Tailwind, TanStack Query, react-router, react-i18next, vite-plugin-pwa
- **Backend** — Supabase (Postgres + Auth + Storage + Edge Functions + Realtime)
- **Hosting** — Cloudflare Pages (static) + Supabase managed (data)
- **Maps** — Leaflet + OpenStreetMap

## Repo layout

```
.
├── apps/
│   └── web/                   # React PWA (workers + supervisor + admin)
├── supabase/
│   ├── migrations/            # SQL schema + RLS + audit chain
│   ├── functions/             # Edge functions: worker-register, worker-login, punch-submit
│   ├── config.toml            # Local stack config
│   └── seed.sql               # Local dev seed
└── docs/
```

## Local dev

Prereqs: Node 20+, pnpm 9+, Docker Desktop (for Supabase local stack).

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local       # fill in values from Supabase dashboard
pnpm supabase:start                                # spins up local Postgres+Storage+Auth on :54321
pnpm dev                                            # vite on http://localhost:5173
```

In a second terminal:
```bash
pnpm supabase:functions:serve                      # Edge Functions on :54321/functions/v1/*
```

Edge Functions need these secrets at runtime (set with `npx supabase secrets set`):
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `SUPABASE_JWT_SECRET`

## Roles

| URL prefix | Auth | Notes |
|---|---|---|
| `/worker/*` | Custom JWT (PIN → `worker-login` Edge Function) | No Supabase Auth seat |
| `/supervisor/*` | Supabase Auth (email + password + TOTP) | Linked to `supervisors` row |
| `/admin/*` | Supabase Auth, role=admin | Linked to `supervisors` row |

## Milestones

| | Milestone | Status |
|---|---|---|
| **M0** | Scaffold + repo + CI to Cloudflare Pages | ✅ this commit |
| **M1** | Schema + RLS + admin auth | next |
| **M2** | Worker register + login Edge Functions | |
| **M3** | Camera + GPS + device fingerprint capture + Storage upload | |
| **M4** | Worker UI: punch flow end-to-end | |
| **M5** | Supervisor dashboard: live feed + approval queue + verify | |
| **M6** | Admin CRUD UI for projects/sites/workers + audit log viewer | |
| **M7** | Reports & CSV export + i18n + PWA install polish | |
| **M8** | Hardening: rate limit, retention job, backups verified, runbook | |

## Deploy

- **Frontend** → Cloudflare Pages, auto-deploy on push to `main`. Build command `pnpm build`, output dir `apps/web/dist`. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Pages env.
- **Database & functions** → push migrations with `npx supabase db push`; deploy functions with `npx supabase functions deploy <name>`.


