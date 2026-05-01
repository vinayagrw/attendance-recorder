#!/usr/bin/env bash
# End-to-end test for the attendance recorder.
# Exercises: anon pick-list, worker registration (3 workers), supervisor approve,
# worker login post-approval, worker punch IN/OUT, audit trail, admin views.
#
# Prereqs:
#   1. `npx supabase start` — local stack on :54321
#   2. `npx supabase functions serve --no-verify-jwt` — Edge Functions on :54321
#   3. seed applied (3 invited workers, 1 site, supervisor viagr@ciklum.com / LocalDev2026!)
#
# Usage: bash scripts/e2e.sh

set -e

API_URL="${API_URL:-http://127.0.0.1:54321}"
ANON_KEY="${ANON_KEY:-sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH}"
SUPERVISOR_EMAIL="${SUPERVISOR_EMAIL:-viagr@ciklum.com}"
SUPERVISOR_PASS="${SUPERVISOR_PASS:-LocalDev2026!}"

# Tiny 1x1 transparent PNG as a data URL (real selfie isn't needed for the API smoke).
SELFIE_DATAURL="data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AAAA//Z"

GREEN="\033[0;32m"
RED="\033[0;31m"
YELLOW="\033[0;33m"
RESET="\033[0m"

PASS=0
FAIL=0

test_case() {
    local name="$1"
    local actual="$2"
    local expected_pattern="$3"
    if echo "$actual" | grep -qE "$expected_pattern"; then
        echo -e "  ${GREEN}✓${RESET} $name"
        PASS=$((PASS + 1))
    else
        echo -e "  ${RED}✗${RESET} $name"
        echo -e "    expected: $expected_pattern"
        echo -e "    actual:   $(echo "$actual" | head -c 200)"
        FAIL=$((FAIL + 1))
    fi
}

echo -e "${YELLOW}=== Phase 1: Anonymous pick-list ===${RESET}"

PICKLIST=$(curl -s -X POST "$API_URL/rest/v1/rpc/list_active_workers" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{}')
test_case "anon can list workers via RPC" "$PICKLIST" '"Ravi Kumar"|"Priya Singh"|"Anil Yadav"'

echo ""
echo -e "${YELLOW}=== Phase 2: Reset all workers to invited (idempotent test re-run) ===${RESET}"

docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -c "
    update workers set status='invited',
        pin_hash=null, baseline_selfie_url=null, auth_user_id=null,
        registered_at=null, approved_at=null, approved_by=null;
    delete from auth.users where email like '%@worker.local';
    delete from attendance;
" > /dev/null 2>&1
echo "  reset workers + cleared synthetic auth users + cleared attendance"

echo ""
echo -e "${YELLOW}=== Phase 3: Worker registration (all 3 workers) ===${RESET}"

WORKER_IDS=(
    "33333333-3333-3333-3333-333333333333:Ravi Kumar:1234"
    "44444444-4444-4444-4444-444444444444:Priya Singh:5678"
    "55555555-5555-5555-5555-555555555555:Anil Yadav:9012"
)

for triplet in "${WORKER_IDS[@]}"; do
    IFS=':' read -r WID NAME PIN <<< "$triplet"
    REG=$(curl -s -X POST "$API_URL/functions/v1/worker-register" \
        -H "apikey: $ANON_KEY" \
        -H "Content-Type: application/json" \
        -d "{
            \"workerId\":\"$WID\",
            \"pin\":\"$PIN\",
            \"selfieDataUrl\":\"$SELFIE_DATAURL\",
            \"gps\":{\"lat\":12.9698,\"lng\":77.7500,\"accuracy_m\":15},
            \"deviceFingerprint\":\"e2e-fp-$(echo $WID | head -c 6)\",
            \"userAgent\":\"e2e-test\"
        }")
    test_case "register $NAME" "$REG" '"status":"pending_approval"'
done

echo ""
echo -e "${YELLOW}=== Phase 4: Worker login BEFORE approval (should be allowed but worker is non-active) ===${RESET}"

LOGIN_RAVI=$(curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"email":"33333333-3333-3333-3333-333333333333@worker.local","password":"1234-33333333"}')
test_case "Ravi can sign in (auth succeeds; punch will be gated)" "$LOGIN_RAVI" '"access_token"'

echo ""
echo -e "${YELLOW}=== Phase 5: Supervisor login + approves all 3 workers ===${RESET}"

SUPER_LOGIN=$(curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$SUPERVISOR_EMAIL\",\"password\":\"$SUPERVISOR_PASS\"}")
test_case "supervisor login" "$SUPER_LOGIN" '"access_token"'

SUPER_TOKEN=$(echo "$SUPER_LOGIN" | grep -o '"access_token":"[^"]*"' | sed 's/.*:"//;s/"$//')

for triplet in "${WORKER_IDS[@]}"; do
    IFS=':' read -r WID NAME PIN <<< "$triplet"
    APPROVE=$(curl -s -X PATCH "$API_URL/rest/v1/workers?id=eq.$WID" \
        -H "apikey: $ANON_KEY" \
        -H "Authorization: Bearer $SUPER_TOKEN" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=representation" \
        -d '{"status":"active"}')
    test_case "approve $NAME" "$APPROVE" '"status":"active"'
done

echo ""
echo -e "${YELLOW}=== Phase 6: Audit trail captures the approvals ===${RESET}"

AUDIT_COUNT=$(docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    select count(*) from audit_log
    where action = 'update_workers' and target_table = 'workers'
      and after_state->>'status' = 'active';
" | tr -d ' ')
echo "  audit rows: $AUDIT_COUNT (expected ≥ 3)"
test_case "audit trigger fired for ≥3 approvals" "$AUDIT_COUNT" '^[3-9]$|^[1-9][0-9]+$'

echo ""
echo -e "${YELLOW}=== Phase 7: Worker punch IN (all 3 workers) ===${RESET}"

declare -A WORKER_TOKENS

for triplet in "${WORKER_IDS[@]}"; do
    IFS=':' read -r WID NAME PIN <<< "$triplet"
    LOGIN=$(curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" \
        -H "apikey: $ANON_KEY" \
        -H "Content-Type: application/json" \
        -d "{\"email\":\"$WID@worker.local\",\"password\":\"$PIN-${WID:0:8}\"}")
    TOKEN=$(echo "$LOGIN" | grep -o '"access_token":"[^"]*"' | sed 's/.*:"//;s/"$//')
    WORKER_TOKENS[$WID]=$TOKEN
    test_case "$NAME login post-approval" "$LOGIN" '"access_token"'

    PUNCH=$(curl -s -X POST "$API_URL/functions/v1/punch-submit" \
        -H "apikey: $ANON_KEY" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" \
        -d "{
            \"siteId\":\"22222222-2222-2222-2222-222222222222\",
            \"type\":\"in\",
            \"selfieDataUrl\":\"$SELFIE_DATAURL\",
            \"gps\":{\"lat\":12.9698,\"lng\":77.7500,\"accuracy_m\":15,\"speed_ms\":null},
            \"deviceFingerprint\":\"e2e-fp-${WID:0:6}\",
            \"userAgent\":\"e2e-test\"
        }")
    test_case "$NAME punch IN succeeds" "$PUNCH" '"status":"pending"|"status":"flagged"'
done

echo ""
echo -e "${YELLOW}=== Phase 8: Worker punch OUT (Ravi only) ===${RESET}"

RAVI_TOKEN=${WORKER_TOKENS[33333333-3333-3333-3333-333333333333]}
PUNCH_OUT=$(curl -s -X POST "$API_URL/functions/v1/punch-submit" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $RAVI_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"siteId\":\"22222222-2222-2222-2222-222222222222\",
        \"type\":\"out\",
        \"selfieDataUrl\":\"$SELFIE_DATAURL\",
        \"gps\":{\"lat\":12.9698,\"lng\":77.7500,\"accuracy_m\":15,\"speed_ms\":null},
        \"deviceFingerprint\":\"e2e-fp-333333\",
        \"userAgent\":\"e2e-test\"
    }")
test_case "Ravi punch OUT succeeds" "$PUNCH_OUT" '"status":"pending"|"status":"flagged"'

echo ""
echo -e "${YELLOW}=== Phase 9: Supervisor sees attendance feed ===${RESET}"

ATT_FEED=$(curl -s "$API_URL/rest/v1/attendance?select=worker_id,type,status,workers(full_name)&order=punched_at.desc&limit=10" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN")
test_case "supervisor reads today's attendance" "$ATT_FEED" '"Ravi Kumar"|"Priya Singh"|"Anil Yadav"'
COUNT=$(echo "$ATT_FEED" | grep -o '"type"' | wc -l | tr -d ' ')
test_case "≥4 attendance rows visible (3 IN + 1 OUT)" "$COUNT" '^[4-9]$|^[1-9][0-9]+$'

echo ""
echo -e "${YELLOW}=== Phase 10: Anomaly flag fires on far-from-site punch ===${RESET}"

PUNCH_FAR=$(curl -s -X POST "$API_URL/functions/v1/punch-submit" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer ${WORKER_TOKENS[44444444-4444-4444-4444-444444444444]}" \
    -H "Content-Type: application/json" \
    -d "{
        \"siteId\":\"22222222-2222-2222-2222-222222222222\",
        \"type\":\"out\",
        \"selfieDataUrl\":\"$SELFIE_DATAURL\",
        \"gps\":{\"lat\":12.9000,\"lng\":77.7500,\"accuracy_m\":15,\"speed_ms\":null},
        \"deviceFingerprint\":\"e2e-fp-444444\",
        \"userAgent\":\"e2e-test\"
    }")
test_case "Priya punch 7km away gets geofence_far flag" "$PUNCH_FAR" '"geofence_far"'

echo ""
echo -e "${YELLOW}=== Phase 11: Admin views (projects, sites, workers, audit) ===${RESET}"

PROJECTS=$(curl -s "$API_URL/rest/v1/projects?select=id,name,status" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN")
test_case "admin reads projects" "$PROJECTS" 'Demo Project'

SITES=$(curl -s "$API_URL/rest/v1/sites?select=id,name,default_lat" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN")
test_case "admin reads sites" "$SITES" 'Tower A'

WORKERS=$(curl -s "$API_URL/rest/v1/workers?select=id,full_name,status" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN")
test_case "admin reads workers" "$WORKERS" 'Ravi Kumar'

AUDIT=$(curl -s "$API_URL/rest/v1/audit_log?select=action,target_table,row_hash&limit=5&order=created_at.desc" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN")
test_case "admin reads audit log with hashes" "$AUDIT" '"row_hash"'

echo ""
echo -e "${YELLOW}=== Phase 12: Worker sees own history only (RLS enforcement) ===${RESET}"

RAVI_HISTORY=$(curl -s "$API_URL/rest/v1/attendance?select=type,status,worker_id" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $RAVI_TOKEN")
RAVI_COUNT=$(echo "$RAVI_HISTORY" | grep -o '"worker_id":"33333333' | wc -l | tr -d ' ')
test_case "Ravi sees only Ravi's punches via RLS" "$RAVI_HISTORY" '"33333333'
echo "  Ravi sees $RAVI_COUNT row(s); should match Ravi punches only"
RAVI_OTHER=$(echo "$RAVI_HISTORY" | grep -o '"worker_id":"44444444' | wc -l | tr -d ' ')
test_case "Ravi cannot see Priya's punches (RLS)" "$RAVI_OTHER" '^0$'

echo ""
echo -e "${YELLOW}=== Phase 13: Worker offboarding bans the auth user ===${RESET}"

# Set Anil as offboarded
curl -s -X PATCH "$API_URL/rest/v1/workers?id=eq.55555555-5555-5555-5555-555555555555" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"offboarded"}' > /dev/null

ANIL_LOGIN_AFTER_BAN=$(curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"email":"55555555-5555-5555-5555-555555555555@worker.local","password":"9012-55555555"}')
test_case "offboarded Anil cannot sign in (banned_until trigger)" "$ANIL_LOGIN_AFTER_BAN" '"error_description"|"error":|"msg":'

echo ""
echo -e "${YELLOW}=== Phase 14: Reset state for clean re-runs ===${RESET}"

docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -c "
    update workers set status='invited',
        pin_hash=null, baseline_selfie_url=null, auth_user_id=null,
        registered_at=null, approved_at=null, approved_by=null;
    delete from auth.users where email like '%@worker.local';
" > /dev/null 2>&1
echo "  reset complete"

echo ""
echo "================================================"
echo -e "  Tests passed:  ${GREEN}$PASS${RESET}"
echo -e "  Tests failed:  ${RED}$FAIL${RESET}"
echo "================================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
