#!/usr/bin/env bash
# CI bootstrap script: run after `supabase start` to:
#   1. Extract the locally-generated anon + service-role keys
#   2. Create the supervisor admin auth user
#   3. Insert the supervisors row linking that user to the seed project
#   4. Export keys to GITHUB_ENV so downstream steps can use them
#
# Usage:    bash scripts/ci-setup.sh
# Env:      ADMIN_EMAIL, ADMIN_PASSWORD, ADMIN_NAME (all have sensible defaults)

set -e

ADMIN_EMAIL="${ADMIN_EMAIL:-viagr@ciklum.com}"
ADMIN_PASSWORD="${ADMIN_PASSWORD:-LocalDev2026!}"
ADMIN_NAME="${ADMIN_NAME:-Vinay (admin)}"
SEED_PROJECT_ID="${SEED_PROJECT_ID:-11111111-1111-1111-1111-111111111111}"

# 1. Get keys from supabase status
STATUS=$(npx -y supabase status -o env 2>/dev/null)

ANON_KEY=$(echo "$STATUS" | grep -E '^(ANON_KEY|SUPABASE_ANON_KEY|PUBLISHABLE)' | head -1 | cut -d= -f2 | tr -d '"')
SERVICE_KEY=$(echo "$STATUS" | grep -E '^(SERVICE_ROLE_KEY|SUPABASE_SERVICE_ROLE_KEY|SECRET)' | head -1 | cut -d= -f2 | tr -d '"')
API_URL=$(echo "$STATUS" | grep -E '^(API_URL|SUPABASE_URL)' | head -1 | cut -d= -f2 | tr -d '"')
API_URL="${API_URL:-http://127.0.0.1:54321}"

if [ -z "$ANON_KEY" ] || [ -z "$SERVICE_KEY" ]; then
    echo "ERROR: failed to extract Supabase keys from 'supabase status'"
    echo "$STATUS"
    exit 1
fi

# 2. Create the admin auth user (idempotent — ignore "already registered")
echo "Creating admin auth user $ADMIN_EMAIL …"
RESP=$(curl -s -X POST "$API_URL/auth/v1/admin/users" \
    -H "apikey: $SERVICE_KEY" \
    -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASSWORD\",\"email_confirm\":true}")

USER_ID=$(echo "$RESP" | grep -o '"id":"[^"]*"' | head -1 | sed 's/.*:"//;s/"$//')

if [ -z "$USER_ID" ]; then
    # Fallback: user already exists, fetch their id
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
    echo "ERROR: could not create or find admin user."
    echo "Response: $RESP"
    exit 1
fi

echo "  user id: $USER_ID"

# 3. Insert/update supervisors row
DB_CONTAINER=$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1)
if [ -z "$DB_CONTAINER" ]; then
    echo "ERROR: no supabase_db container found."
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

# 4. Export to GitHub Actions env (if running in CI)
if [ -n "$GITHUB_ENV" ]; then
    echo "ANON_KEY=$ANON_KEY" >> "$GITHUB_ENV"
    echo "SECRET_KEY=$SERVICE_KEY" >> "$GITHUB_ENV"
    echo "API_URL=$API_URL" >> "$GITHUB_ENV"
    echo "ADMIN_EMAIL=$ADMIN_EMAIL" >> "$GITHUB_ENV"
    echo "ADMIN_PASSWORD=$ADMIN_PASSWORD" >> "$GITHUB_ENV"
    echo "Exported ANON_KEY, SECRET_KEY, API_URL, ADMIN_EMAIL, ADMIN_PASSWORD to GITHUB_ENV"
fi

echo "✓ admin user provisioned + linked as supervisor"
echo "  email:    $ADMIN_EMAIL"
echo "  password: (from \$ADMIN_PASSWORD env)"
echo "  api url:  $API_URL"
