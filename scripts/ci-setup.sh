#!/usr/bin/env bash
# Bootstrap script: create the supervisor admin auth user and link them
# in the supervisors table.
#
# Two modes — auto-detected from $SB_URL (override with $MODE):
#
#   LOCAL  (default)  Reads keys from `supabase status -o env`; writes via
#                     `docker exec ... psql` against the local supabase_db
#                     container. No env vars required.
#
#                       bash scripts/ci-setup.sh
#
#   CLOUD             Reads keys from your shell env; writes via PostgREST
#                     (service-role key) so no psql install is needed on the
#                     host. Requires the project to already have migrations
#                     applied (`npx supabase db push` first).
#
#                       SB_URL=https://<ref>.supabase.co \
#                       SB_SERVICE_ROLE_KEY=<service role from dashboard> \
#                       bash scripts/ci-setup.sh
#
# Optional in either mode:
#   ADMIN_EMAIL       (default: viagr@ciklum.com)
#   ADMIN_PASSWORD    (default: LocalDev2026!  — change for cloud!)
#   ADMIN_NAME        (default: "Vinay (admin)")
#   SEED_PROJECT_ID   (default: 11111111-1111-1111-1111-111111111111)
#   MODE              ('local' or 'cloud') — overrides auto-detect

set -e

ADMIN_EMAIL="${ADMIN_EMAIL:-viagr@ciklum.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-LocalDev2026!}"
ADMIN_NAME="${ADMIN_NAME:-Vinay (admin)}"
SEED_PROJECT_ID="${SEED_PROJECT_ID:-11111111-1111-1111-1111-111111111111}"

# Auto-detect mode
if [ -z "$MODE" ]; then
    if [[ "$SB_URL" =~ ^https:// ]]; then
        MODE="cloud"
    else
        MODE="local"
    fi
fi

# 1. Resolve API_URL + SERVICE_KEY (and ANON_KEY for local) per mode
case "$MODE" in
    cloud)
        if [ -z "$SB_URL" ] || [ -z "$SB_SERVICE_ROLE_KEY" ]; then
            cat <<'USAGE' >&2

ERROR: cloud mode requires the following env vars:
  SB_URL=https://<your-project-ref>.supabase.co
  SB_SERVICE_ROLE_KEY=<service role key from Project Settings → API>

Optional:
  ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME, SEED_PROJECT_ID

For local development run without any env vars (defaults to MODE=local).

USAGE
            exit 1
        fi
        API_URL="$SB_URL"
        SERVICE_KEY="$SB_SERVICE_ROLE_KEY"
        ANON_KEY="${SB_PUBLISHABLE_KEY:-${SB_ANON_KEY:-}}"
        ;;
    local)
        STATUS=$(npx -y supabase status -o env 2>/dev/null)
        ANON_KEY=$(echo "$STATUS" | grep -E '^(ANON_KEY|SUPABASE_ANON_KEY|PUBLISHABLE)' | head -1 | cut -d= -f2 | tr -d '"')
        SERVICE_KEY=$(echo "$STATUS" | grep -E '^(SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|SECRET)' | head -1 | cut -d= -f2 | tr -d '"')
        API_URL=$(echo "$STATUS" | grep -E '^(API_URL|SUPABASE_URL)' | head -1 | cut -d= -f2 | tr -d '"')
        API_URL="${API_URL:-http://127.0.0.1:54321}"
        if [ -z "$ANON_KEY" ] || [ -z "$SERVICE_KEY" ]; then
            echo "ERROR: failed to extract Supabase keys from 'supabase status'" >&2
            echo "Is the local stack running? Try 'pnpm supabase:start' first." >&2
            echo "$STATUS" >&2
            exit 1
        fi
        ;;
    *)
        echo "ERROR: invalid MODE='$MODE' (expected 'local' or 'cloud')" >&2
        exit 1
        ;;
esac

echo "Mode: $MODE   API: $API_URL"

# 2. Create the admin auth user (idempotent — fall back to lookup if it exists)
echo "Creating admin auth user $ADMIN_EMAIL …"
RESP=$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"email_confirm\":true}")

USER_ID=$(echo "$RESP" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')

if [ -z "$USER_ID" ]; then
    echo "Auth create returned no id; user may already exist. Fetching…"
    USERS=$(curl -s "$API_URL/auth/v1/admin/users" \
        -H "apikey: $SERVICE_KEY" \
        -H "Authorization: Bearer $SERVICE_KEY")
    USER_ID=$(echo "$USERS" | python3 -c "
import json, sys
data = json.load(sys.stdin)
users = data.get('users', data) if isinstance(data, dict) else data
for u in users:
    if u.get('email') == '$ADMIN_EMAIL':
        print(u.get('id', ''))
        break
" 2>/dev/null)
fi

if [ -z "$USER_ID" ]; then
    echo "ERROR: could not create or find admin user." >&2
    echo "Response: $RESP" >&2
    exit 1
fi

echo "  user id: $USER_ID"

# 3. Upsert the supervisors row — REST in cloud mode, psql via docker in local
case "$MODE" in
    cloud)
        # PostgREST upsert: Prefer: resolution=merge-duplicates does INSERT … ON
        # CONFLICT on the primary key (id). Service-role key bypasses RLS.
        TMP=$(mktemp 2>/dev/null || echo "/tmp/ci-setup-upsert.$$")
        HTTP_CODE=$(curl -s -o "$TMP" -w "%{http_code}" \
            -X POST "$API_URL/rest/v1/supervisors" \
            -H "apikey: $SERVICE_KEY" \
            -H "Authorization: Bearer $SERVICE_KEY" \
            -H "Content-Type: application/json" \
            -H "Prefer: resolution=merge-duplicates,return=minimal" \
            -d "{\"id\":\"$USER_ID\",\"full_name\":\"$ADMIN_NAME\",\"role\":\"admin\",\"scope_project_ids\":[\"$SEED_PROJECT_ID\"]}")
        if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
            echo "ERROR: supervisors upsert failed (HTTP $HTTP_CODE)" >&2
            cat "$TMP" >&2
            rm -f "$TMP"
            exit 1
        fi
        rm -f "$TMP"
        ;;
    local)
        DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)
        if [ -z "$DB_CONTAINER" ]; then
            echo "ERROR: no supabase_db container found." >&2
            exit 1
        fi
        docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -c "
            insert into supervisors (id, full_name, role, scope_project_ids)
            values ('$USER_ID', '$ADMIN_NAME', 'admin',
                    array['$SEED_PROJECT_ID']::uuid[])
            on conflict (id) do update set
                role = 'admin',
                full_name = excluded.full_name,
                scope_project_ids = excluded.scope_project_ids;
        " >/dev/null
        ;;
esac

# 4. Export to GitHub Actions env — local mode only.
# Cloud service-role keys never go to CI env unless you wire it up explicitly.
if [ "$MODE" = "local" ] && [ -n "$GITHUB_ENV" ]; then
    echo "ANON_KEY=$ANON_KEY" >> "$GITHUB_ENV"
    echo "SECRET_KEY=$SERVICE_KEY" >> "$GITHUB_ENV"
    echo "API_URL=$API_URL" >> "$GITHUB_ENV"
    echo "ADMIN_EMAIL=$ADMIN_EMAIL" >> "$GITHUB_ENV"
    echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> "$GITHUB_ENV"
    echo "Exported ANON_KEY, SECRET_KEY, API_URL, ADMIN_EMAIL, ADMIN_PASSWORD to GITHUB_ENV"
fi

echo "✓ admin user provisioned + linked as supervisor"
echo "  email:    $ADMIN_EMAIL"
echo "  api url:  $API_URL"
echo "  mode:     $MODE"
