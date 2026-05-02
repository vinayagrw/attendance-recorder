# Cloudflare Pages — first-time setup

Step-by-step guide for hosting the Attendance Recorder PWA on Cloudflare Pages, with the backend on Supabase Cloud (see `docs/runbook.md` § "Cloud dev project — first-time setup" for the Supabase side).

---

## Architecture split

| Layer | Service | Notes |
|---|---|---|
| Static frontend (PWA) | **Cloudflare Pages** | Hosts the Vite-built bundle from `apps/web/dist` + `_redirects` + service worker + manifest. |
| Database, Auth, Storage, Edge Functions | **Supabase Cloud** | Hit directly from the PWA (no proxy). The dev-only Vite proxy in `vite.config.ts` does not apply to production builds. |

The PWA bundle has `NEXT_PUBLIC_SUPABASE_URL` baked in at build time and points at `https://<ref>.supabase.co`. There's no server in front — browser → Cloudflare CDN for HTML/JS, browser → Supabase directly for API.

---

## Prerequisites

1. The Supabase Cloud dev project is up (`docs/runbook.md` § "Cloud dev project").
2. The repo is pushed to GitHub / GitLab / Bitbucket.
3. `apps/web/public/_redirects` exists with `/* /index.html 200` (it does — checked at the time of this writing). Without it, deep links like `/supervisor/dashboard` 404 on hard refresh.
4. Your Supabase Cloud project's `anon` / publishable key — you'll paste it into Cloudflare Pages env vars.

> **Never** paste the `service_role` key into Cloudflare. Service-role calls happen inside Supabase Edge Functions, not from the browser. If a dashboard prompts you to add it as a Pages env var, that prompt is wrong.

---

## 1. Connect repo to Cloudflare Pages

1. https://dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git**.
2. Pick the repo and the production branch (`main`).

## 2. Build settings

Paste these exactly into the Pages build configuration:

| Field | Value |
|---|---|
| Framework preset | `None` (or `Vite` — both work) |
| **Build command** | `pnpm install --frozen-lockfile && pnpm --filter @attendance/web build` |
| **Build output directory** | `apps/web/dist` |
| Root directory | `/` (leave default) |
| Production branch | `main` |
| **Deploy command** | `cd apps/web && npx wrangler pages deploy ./dist` |

> **The Deploy command is required in newer Pages projects.** Use `cd apps/web && npx wrangler pages deploy ./dist`. The `cd` is load-bearing — wrangler 4.x refuses to operate from a pnpm workspace root (it sees `pnpm-workspace.yaml` and bails *before* reading any config file). This repo ships `apps/web/wrangler.toml` declaring `pages_build_output_dir = "dist"` so wrangler, once inside `apps/web/`, knows it's a Pages project and where the artefacts are. See "Troubleshooting" if you still hit the workspace-detection error.

> **Common mistake**: setting the Build command to `pnpm dev`. The root `dev` script in `package.json` runs `concurrently vite + supabase functions serve` — a *local development* script that requires Docker. It will always fail on Cloudflare's build host. Use `pnpm build` (or the explicit form above), never `pnpm dev`.

## 3. Environment variables

Settings → **Environment variables → Production**:

| Variable | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<ref>.supabase.co` | Same as `apps/web/.env.cloud`'s value. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` | Public anon key. RLS-bound; safe in the browser bundle. |
| `NODE_VERSION` | `20` | Cloudflare's default is older than this repo's `engines.node`. |
| `PNPM_VERSION` | `10` | Match `packageManager: "pnpm@10.33.0"` in root `package.json`. |

> **Never** put `SB_SERVICE_ROLE_KEY` or the DB password in Cloudflare env vars.

If you want PR previews to hit a separate **staging** Supabase project, set the same vars under **Preview** (in the same dashboard panel) but pointing at the staging project. Otherwise preview deploys share the production Supabase, which means a preview branch can write test rows into prod.

## 4. Deploy

- First deploy auto-runs after you save build settings. Watch the build log; the first build pulls all pnpm deps (~2–3 minutes), subsequent builds are ~30–60s with cache.
- You'll get a `<random-name>.pages.dev` URL. Open it on a phone — HTTPS is automatic, so camera + geolocation now work.
- Add a custom domain under **Custom domains** if you have one.

## 5. Verify

1. Open the `*.pages.dev` URL in a desktop browser. DevTools → Network: confirm `/auth/v1/token` requests go to `<your-ref>.supabase.co`, not `localhost`.
2. Sign in with the admin credentials you created on cloud (see "Bootstrap admin user" below).
3. Phone test — open the same URL, install as PWA, run through the punch-in flow.

```bash
insert into supervisors (id, full_name, role, scope_project_ids)
select id, 'Vinay (admin)', 'admin', '{}'::uuid[]
from auth.users where email = 'viagr@ciklum.com'
on conflict (id) do update
  set full_name = excluded.full_name, role = excluded.role;
  
  ```
---

## Bootstrap admin user (one-time, after migrations are applied)

`scripts/ci-setup.sh` creates the admin supervisor row + Supabase Auth user. **Keep credentials in a gitignored env file**, never paste them into source-controlled docs.

Recommended pattern — write `supabase/.env.cloud` once (it's gitignored via `.gitignore` `supabase/.env.cloud` rule):

```bash
# supabase/.env.cloud   (gitignored — never commit)
SB_URL=https://<ref>.supabase.co
SB_SERVICE_ROLE_KEY=<service-role-from-Supabase-dashboard>
ADMIN_EMAIL=<your-email>
ADMIN_PASSWORD=<strong-password-for-cloud>
ADMIN_NAME="Your Name (admin)"
```

Run the bootstrap:

```bash
set -a && source supabase/.env.cloud && set +a
bash scripts/ci-setup.sh
```

The script auto-detects `cloud` mode from the `https://` URL and writes via PostgREST (no local psql install required).

---

## Things that bite people the first time

1. **Service-worker update lag.** PWA installs cache aggressively. After a deploy, your phone may keep serving the previous bundle until the SW does its update check. Force-update: in the open PWA, Chrome → kebab → Reload, or close and reopen the PWA. For users out in the field, this means a deploy isn't instantaneously visible — design around eventual consistency for UI changes.
2. **Cloudflare's build env strips `process.env`.** Vite reads env vars at build time, not runtime. If you change a Cloudflare env var, you must trigger a redeploy (Cloudflare dashboard → Deployments → "Retry deployment" or push a commit). The bundle has the URL baked in.
3. **`_redirects` only handles client-side routing.** It doesn't rewrite anything to Supabase — those calls are absolute URLs from the bundle. Don't try to recreate the dev-time Vite proxy here; the production architecture is "browser → Cloudflare CDN for HTML/JS, browser → Supabase directly for API."
4. **Bundle size warning from `pnpm build`.** The build emits a ~1.3 MB JS bundle (~380 KB gzipped). Loadable on cellular but not snappy. Code-splitting (`React.lazy()` on supervisor routes, dynamic-import on chart libs) is the lever to pull when the MVP ships and you need faster cold loads.
5. **Auth `site_url`.** PIN-based email+password sign-in doesn't need redirect URLs configured. If you later add password reset or magic link, go to Supabase Cloud Dashboard → Auth → URL Configuration and add `https://your-app.pages.dev` (and any custom domain) to Site URL + Redirect URLs. Email magic links will fail until you do.
6. **PR previews and the DB.** Preview deployments share the production Supabase by default if you only set Production env vars. To prevent a preview branch from writing test rows into prod, either point Preview at a separate Supabase project or skip Preview env vars entirely (preview builds will then fail to connect, which is sometimes what you want).

---

## Troubleshooting

### Build fails with `The Wrangler application detection logic has been run in the root of a workspace`

Symptom (CF Pages build log):
```
✘ [ERROR] The Wrangler application detection logic has been run in the root of a workspace instead of targeting a specific project. Change your working directory to one of the applications in the workspace and try again.
Failed: error occurred while running deploy command
```

Cause: wrangler 4.x detected a **pnpm workspace** at the repo root (via `pnpm-workspace.yaml`) and refused to deploy from there. This check runs *before* wrangler reads any config file, so a root-level `wrangler.toml` is silently ignored — moving the file alone won't fix it.

Two changes are required together:

1. **`apps/web/wrangler.toml`** must exist (shipped in this repo) with:
   ```toml
   compatibility_date = "2026-01-01"
   pages_build_output_dir = "dist"
   ```
   The `pages_build_output_dir` is now `"dist"` (relative to the file's location), not `"apps/web/dist"`.

2. **The Deploy command must `cd` into `apps/web/` first**:
   ```
   cd apps/web && npx wrangler pages deploy ./dist
   ```
   Plain `npx wrangler deploy` from the repo root will keep failing forever — the workspace check is non-negotiable as long as `pnpm-workspace.yaml` is at root.

If you used a previous version of these docs that put `wrangler.toml` at the repo root, delete it — the workspace check makes a root-level config worse than useless (it implies it should work and silently doesn't).

The `name` field is intentionally omitted — the CF Pages dashboard already owns the project slug; specifying it here would error on mismatch. If you want to tie the slug to source control, add `name = "<your-pages-project-slug>"`.

### Build fails with `[fns] supabase start is not running` + `[vite] Command failed with signal "SIGTERM"`

Symptom (CF Pages build log):
```
[fns] supabase start is not running.
[fns] npx supabase functions serve --no-verify-jwt exited with code 1
[vite] @attendance/web@0.0.0 dev: `vite`
[vite] Command failed with signal "SIGTERM"
[vite] pnpm --filter @attendance/web dev exited with code SIGTERM
ELIFECYCLE  Command failed with exit code 1.
Failed: error occurred while running deploy command
```

Cause: the **Build command** (or **Deploy command**) is set to `pnpm dev`. The root `dev` script in `package.json` runs `concurrently` over Vite-dev + `supabase functions serve` — both *local development* daemons. Vite dev never produces a build output; `supabase functions serve` requires the local Docker stack which doesn't exist on CF's build host.

Fix: open CF Pages → **Settings → Builds & deployments**:

| Field | Wrong (current) | Right |
|---|---|---|
| Build command | `pnpm dev` *(or `pnpm install && pnpm dev`)* | `pnpm install --frozen-lockfile && pnpm --filter @attendance/web build` |
| Deploy command | `pnpm dev` *(or anything dev-mode)* | `cd apps/web && npx wrangler pages deploy ./dist` |
| Build output directory | (anything) | `apps/web/dist` |

Save → Deployments → **Retry deployment** on the failed build.

The `cd apps/web && npx wrangler pages deploy ./dist` step relies on `apps/web/wrangler.toml` (NOT the repo root). If wrangler ends up at the repo root, you'll see the workspace-detection error from the previous troubleshooting block.

### Build fails with `It looks like you've run a Workers-specific command in a Pages project`

Symptom (CF Pages build log):
```
✘ [ERROR] It looks like you've run a Workers-specific command in a Pages project.
  For Pages, please run `wrangler pages deploy` instead.
Failed: error occurred while running deploy command
```

Cause: the **Deploy command** uses `wrangler deploy` (with or without `--assets=…`). In wrangler 4.x:

- `wrangler deploy` → **Workers** mode (deploys a Worker; `--assets=<dir>` is the Workers Static Assets flag).
- `wrangler pages deploy <dir>` → **Pages** mode (uploads a static directory to a Pages project).

`wrangler.toml`'s `pages_build_output_dir` is meant to tag a project as "Pages" but in 4.86.0 the unification isn't complete — `wrangler deploy` still routes to Workers mode and rejects Pages projects with the error above.

Fix: change the Deploy command to the explicit Pages syntax:

| Wrong | Right |
|---|---|
| `cd apps/web && npx wrangler deploy` | `cd apps/web && npx wrangler pages deploy ./dist` |
| `cd apps/web && npx wrangler deploy --assets=./dist` | `cd apps/web && npx wrangler pages deploy ./dist` |

The positional `./dist` replaces what `--assets=` was trying to do — it tells `wrangler pages deploy` which directory to upload. `apps/web/wrangler.toml`'s `pages_build_output_dir = "./dist"` makes the same value the implicit default if you ever drop the explicit arg.

### Build succeeds but the live site shows a blank page or "Failed to fetch /auth/v1/token"

Cause: the bundle has the wrong `NEXT_PUBLIC_SUPABASE_URL` (often `http://127.0.0.1:54321` — meaning the env var wasn't set in CF Pages or wasn't picked up).

Fix:
1. Settings → Environment variables → confirm `NEXT_PUBLIC_SUPABASE_URL` is set under **Production** (not just **Preview**).
2. Trigger a new deploy — env var changes are not retroactive to existing builds.
3. After deploy, hard-refresh the PWA (close and reopen, or DevTools → Application → Storage → Clear site data) so the service worker doesn't keep serving the old bundle.

### `bash scripts/ci-setup.sh` says `Error: ADMIN_EMAIL already exists`

Cause: the admin auth user was created on a previous run; `ci-setup.sh` is idempotent on the `supervisors` row but the auth user create errors if the email is taken.

Fix: edit `supabase/.env.cloud` to use a different `ADMIN_EMAIL`, or delete the existing user via Studio → **Authentication → Users → … → Delete** before re-running.

---

## Why `wrangler.toml` lives at `apps/web/`, not the repo root

wrangler 4.x detects pnpm workspaces (via `pnpm-workspace.yaml`) and refuses to deploy from the workspace root with:
```
✘ The Wrangler application detection logic has been run in the root of a workspace …
```
That check fires *before* wrangler reads any config file, so a root-level `wrangler.toml` is silently ignored. The only paths around the check are (a) `cd` into the app first, or (b) use `wrangler pages deploy <dir> --project-name=<slug>` syntax (which moves the project name out of source control — worse).

So this repo ships `apps/web/wrangler.toml`:

```toml
compatibility_date = "2026-01-01"
pages_build_output_dir = "dist"
```

…and the dashboard's Deploy command starts with `cd apps/web &&`. Build settings still come from the dashboard — `wrangler.toml` is consumed at *deploy* time, not build time.

If you ever switch the Pages project slug, add `name = "<slug>"` here and source-control it.

---

## TL;DR

1. Connect the repo, paste the four env vars, save the build settings table.
2. **Build command**: `pnpm install --frozen-lockfile && pnpm --filter @attendance/web build`. **Never** `pnpm dev`.
3. **Build output directory**: `apps/web/dist`.
4. **Deploy command**: `cd apps/web && npx wrangler pages deploy ./dist` (relies on the shipped `wrangler.toml`).
5. Run `bash scripts/ci-setup.sh` once with cloud env vars sourced from `supabase/.env.cloud` (gitignored).
6. Done — production is "browser → Cloudflare CDN → static bundle, browser → Supabase Cloud → API."
