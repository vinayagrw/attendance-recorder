# Supabase

This file used to contain a Next.js boilerplate snippet from initial scaffolding. The actual stack is **Vite + React** (see `apps/web/`), so the boilerplate didn't apply.

For everything Supabase-related, see:

- **Local dev (Docker)** — `README.md` quick start + `supabase/config.toml`.
- **Cloud dev project setup** — `docs/runbook.md` § "Cloud dev project — first-time setup".
- **Migrations** — `supabase/migrations/0001_init.sql` … `0020_safe_timezone.sql`.
- **Edge Functions** — `supabase/functions/*/index.ts`. Logging helper in `supabase/functions/_shared/log.ts`; tunables in `supabase/functions/_shared/config.ts`.
- **Storage** — single private bucket `selfies` created by `0006_storage_buckets.sql`.
- **Architecture & data model** — `docs/architecture.md`.
- **On-call runbook** — `docs/runbook.md`.

Env wiring lives in `apps/web/.env.example` (with the local + cloud + ngrok scenarios documented).
