# Attendance Recorder — AI Agent Guidelines

## Architecture Overview

Browser-based attendance system for construction workers using a Progressive Web App (PWA) architecture:

- **Frontend**: React 18 + Vite 6 + TypeScript PWA with Tailwind CSS, deployed to Cloudflare Pages
- **Backend**: Supabase (Postgres 15 + Auth + Storage + Edge Functions + Realtime)
- **Workers**: Authenticate via PIN + device fingerprint (no Supabase Auth account); supervisors use email/password
- **Data Flow**: Worker picks name → enters PIN → captures selfie + GPS + device fingerprint → Edge Function validates and stores → supervisor reviews via realtime dashboard
- **Multi-tenant**: Projects contain sites; workers assigned to sites; supervisors scoped to projects via `scope_project_ids`

## Critical Developer Workflows

### Local Development Setup
```bash
pnpm install
pnpm supabase:start          # Start local Supabase stack (Postgres + Auth + Storage + Functions)
bash scripts/ci-setup.sh     # Bootstrap admin supervisor account
pnpm dev                     # Start Vite + Edge Functions concurrently (uses concurrently)
```

### Testing Pyramid
```bash
pnpm typecheck               # TypeScript compilation check
pnpm build                   # Production build validation
bash scripts/e2e.sh          # API smoke tests (27 tests, ~12s, requires local stack)
pnpm test:e2e                # Playwright UI tests (14 tests, ~46s, requires pnpm test:e2e:install first)
```

### Data Reset Between Tests
```bash
bash scripts/cleanup-tables.sh  # Wipes attendance + audit + device logs + workers (preserves supervisors)
```

### Production Deploy
- Frontend: Push to `main` → Cloudflare Pages auto-builds
- Backend: `npx supabase db push` for migrations, `npx supabase functions deploy <name>` for Edge Functions

## Project-Specific Conventions

### Authentication Patterns
- **Workers**: Synthetic email `workerId@worker.local`, password `pin-workerId.slice(0,8)`, authenticated via Edge Functions returning short-lived JWTs
- **Supervisors**: Standard Supabase Auth with email/password + optional TOTP 2FA
- **RLS Policies**: Workers see only their own data; supervisors see data for sites in their `scope_project_ids`

### Data Validation & Anomaly Detection
- **Geofencing**: Server-side distance calculation with `edge_tolerance` (30m soft boundary)
- **Device Continuity**: Flag `new_device` if fingerprint changes; `buddy_punch_suspected` if same device used by multiple workers
- **GPS Quality**: Reject punches with `accuracy_m > 80`; flag `mock_gps_signature` for identical coordinates
- **Motion Detection**: Flag `in_motion` if `speed_ms > 8 km/h` (walking threshold)

### File Organization
- **Routes**: `/worker/*`, `/supervisor/*`, `/admin/*` with role-based access control
- **Hooks**: `useWorker()`, `useSupervisor()`, `useTodayAttendance()` encapsulate auth + data fetching
- **Edge Functions**: Business logic for `worker-register`, `punch-submit`, `payroll-export`, `auto-close-shifts`
- **Migrations**: Incremental SQL schema changes with RLS policies and triggers

### UI Patterns
- **Error Handling**: `ErrorBoundary` wraps app; `logger.error()` captures to IndexedDB with structured context
- **Forms**: React Hook Form + Zod validation; camera/GPS permission flows with graceful degradation
- **Real-time**: Supervisor dashboard subscribes to attendance changes via Supabase Realtime
- **Offline**: Service Worker queues failed punches in IndexedDB; `connectivity` banner shows queue status

## Integration Points

### External Dependencies
- **Supabase Client**: Custom auth flow for workers; standard for supervisors
- **Leaflet**: Polygon geofencing in admin UI; circle preview in worker punch flow
- **FingerprintJS**: Device fingerprinting for security validation
- **TanStack Query**: Caching + optimistic updates for attendance operations
- **i18next**: English + Hindi localization (extendable to other languages)

### Cross-Component Communication
- **Worker Flow**: Login → Register (first-time) → Punch → History, with offline queue fallback
- **Supervisor Flow**: Login → Dashboard (realtime feed + anomaly pane) → Approvals → Reports → Manual corrections
- **Admin Flow**: CRUD for projects/sites/workers + audit log viewer + diagnostics

## Key Files & Directories

| Path | Purpose |
|------|---------|
| `plan.md` | Single source of truth for architecture, schema, and feature roadmap |
| `supabase/migrations/0001_init.sql` | Core schema (projects/sites/workers/attendance/audit) |
| `supabase/functions/punch-submit/index.ts` | Attendance validation + anomaly detection logic |
| `apps/web/src/App.tsx` | Route definitions with role-based protection |
| `apps/web/src/hooks/useWorker.ts` | Worker auth + site assignment data fetching |
| `apps/web/src/lib/supabase.ts` | Supabase client configuration |
| `apps/web/src/lib/camera.ts` | Selfie capture with quality validation |
| `apps/web/src/lib/geolocation.ts` | GPS acquisition with accuracy checks |
| `docs/feat-*.md` | Feature implementation specifications |
| `docs/runbook.md` | Operational procedures and incident response |

## Common Patterns

### Database Queries
- Use RPC functions for complex reads (`list_active_workers`, `attendance_filtered`, `distance_from_site_m`)
- Audit triggers (`trg_audit_changes`) automatically log all supervisor/admin actions
- Hash-chained audit log with `prev_hash` + `row_hash` for immutability

### Error Handling
- Edge Functions return structured JSON errors with HTTP status codes
- Frontend catches and logs to IndexedDB with `logger.error(e, context)`
- Camera/GPS failures show user-friendly messages with retry options

### Security Measures
- Selfie URLs are signed and private; retention cron deletes after 90 days
- Device fingerprint validation prevents account sharing
- Rate limiting on worker login attempts (5 fails / 15min per worker)
- IP + device logging on all authentication events

### Performance Optimizations
- Client-side photo compression (target ≤100KB JPEG)
- Selfie watermark with timestamp/GPS overlay for tamper evidence
- IndexedDB offline queue prevents data loss on network issues
- Supervisor dashboard shows only today's data with realtime updates</content>
<parameter name="filePath">C:\Users\viagr\Documents\Vinay\git\attendance-recorder\AGENTS.md
