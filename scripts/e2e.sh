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
echo -e "${YELLOW}=== Phase 14 (M9): list_active_workers RPC returns ≥2 active ===${RESET}"
# Phase 13 already offboarded Anil, so we only expect Ravi + Priya here.
# Response is multi-line JSON — strip newlines so the regex matches.
SITES_PUB=$(curl -s -X POST "$API_URL/rest/v1/rpc/list_active_workers" \
    -H "apikey: $ANON_KEY" -H "Content-Type: application/json" -d '{}' | tr -d '\n')
test_case "list_active_workers includes Ravi Kumar" "$SITES_PUB" '"Ravi Kumar"'
test_case "list_active_workers includes Priya Singh" "$SITES_PUB" '"Priya Singh"'

echo ""
echo -e "${YELLOW}=== Phase 15 (M13): list_assignable_sites returns is_assigned flag ===${RESET}"
ASSIGN=$(curl -s -X POST "$API_URL/rest/v1/rpc/list_assignable_sites" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer ${WORKER_TOKENS[33333333-3333-3333-3333-333333333333]}" \
    -H "Content-Type: application/json" \
    -d '{"p_worker_id":"33333333-3333-3333-3333-333333333333"}')
test_case "list_assignable_sites returns Tower A with is_assigned" "$ASSIGN" '"is_assigned":true'

echo ""
echo -e "${YELLOW}=== Phase 16 (M14): GPS accuracy 95m does NOT flag low_gps_accuracy ===${RESET}"
PUNCH_95=$(curl -s -X POST "$API_URL/functions/v1/punch-submit" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer ${WORKER_TOKENS[33333333-3333-3333-3333-333333333333]}" \
    -H "Content-Type: application/json" \
    -d "{
        \"siteId\":\"22222222-2222-2222-2222-222222222222\",
        \"type\":\"in\",
        \"selfieDataUrl\":\"$SELFIE_DATAURL\",
        \"gps\":{\"lat\":12.9698,\"lng\":77.7500,\"accuracy_m\":95,\"speed_ms\":null},
        \"deviceFingerprint\":\"e2e-fp-acc95\",
        \"userAgent\":\"e2e-test\"
    }")
echo "$PUNCH_95" | grep -q 'low_gps_accuracy' && \
    { echo -e "  ${RED}✗${RESET} 95m should NOT flag low_gps_accuracy"; FAIL=$((FAIL+1)); } || \
    { echo -e "  ${GREEN}✓${RESET} 95m does NOT flag low_gps_accuracy (threshold raised to 100m)"; PASS=$((PASS+1)); }

echo ""
echo -e "${YELLOW}=== Phase 17: GPS accuracy 150m DOES flag low_gps_accuracy ===${RESET}"
PUNCH_150=$(curl -s -X POST "$API_URL/functions/v1/punch-submit" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer ${WORKER_TOKENS[33333333-3333-3333-3333-333333333333]}" \
    -H "Content-Type: application/json" \
    -d "{
        \"siteId\":\"22222222-2222-2222-2222-222222222222\",
        \"type\":\"out\",
        \"selfieDataUrl\":\"$SELFIE_DATAURL\",
        \"gps\":{\"lat\":12.9698,\"lng\":77.7500,\"accuracy_m\":150,\"speed_ms\":null},
        \"deviceFingerprint\":\"e2e-fp-acc150\",
        \"userAgent\":\"e2e-test\"
    }")
test_case "150m accuracy flags low_gps_accuracy" "$PUNCH_150" '"low_gps_accuracy"'

echo ""
echo -e "${YELLOW}=== Phase 18 (M13): in_motion + impossible_speed flags ===${RESET}"
# Use Ravi (Anil is offboarded by Phase 13).
PUNCH_FAST=$(curl -s -X POST "$API_URL/functions/v1/punch-submit" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer ${WORKER_TOKENS[33333333-3333-3333-3333-333333333333]}" \
    -H "Content-Type: application/json" \
    -d "{
        \"siteId\":\"22222222-2222-2222-2222-222222222222\",
        \"type\":\"in\",
        \"selfieDataUrl\":\"$SELFIE_DATAURL\",
        \"gps\":{\"lat\":12.9698,\"lng\":77.7500,\"accuracy_m\":15,\"speed_ms\":40},
        \"deviceFingerprint\":\"e2e-fp-driving\",
        \"userAgent\":\"e2e-test\"
    }")
test_case "speed 40 m/s triggers in_motion + impossible_speed" "$PUNCH_FAST" '"in_motion".*"impossible_speed"|"impossible_speed".*"in_motion"'

echo ""
echo -e "${YELLOW}=== Phase 19 (M14): worker forgot-PIN flow end-to-end ===${RESET}"
# Re-activate Anil first (Phase 13 offboarded him); his auth user is needed for the new PIN to work.
curl -s -X PATCH "$API_URL/rest/v1/workers?id=eq.55555555-5555-5555-5555-555555555555" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"active"}' > /dev/null

# Anon worker creates a pin reset request with their requested PIN. We do NOT
# use Prefer: return=representation because the supervisors-only SELECT policy
# would block the implicit SELECT-back. Just check the HTTP status, then have
# the supervisor read the request id back to drive the next steps.
PIN_REQ_BODY='{"worker_id":"55555555-5555-5555-5555-555555555555","note":"Forgot PIN, requesting reset","requested_pin":"7777"}'
PIN_REQ_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/pin_reset_requests" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "$PIN_REQ_BODY")
test_case "anon insert pin_reset_request (HTTP 201)" "$PIN_REQ_CODE" '^201$'

# Supervisor reads the latest pending request to grab its id
PEND=$(curl -s "$API_URL/rest/v1/pin_reset_requests?status=eq.pending&worker_id=eq.55555555-5555-5555-5555-555555555555&order=requested_at.desc&limit=1" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN")
test_case "supervisor sees the pending request with requested_pin=7777" "$PEND" '"requested_pin":[[:space:]]*"7777"'
REQ_ID=$(echo "$PEND" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | sed 's/.*:"//;s/"$//')
echo "  request id: $REQ_ID"

# Supervisor approves via requestId — Edge Function reads requested_pin from DB
APPROVE=$(curl -s -X POST "$API_URL/functions/v1/worker-pin-reset" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"requestId\":\"$REQ_ID\"}")
test_case "supervisor approves via requestId" "$APPROVE" '"ok":true'

LOGIN_NEW=$(curl -s -X POST "$API_URL/auth/v1/token?grant_type=password" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d '{"email":"55555555-5555-5555-5555-555555555555@worker.local","password":"7777-55555555"}')
test_case "Anil can sign in with new PIN" "$LOGIN_NEW" '"access_token"'

echo ""
echo -e "${YELLOW}=== Phase 20 (M14): site daily_note + daily_note_updated_at column ===${RESET}"
NOTE_UPDATE=$(curl -s -X PATCH "$API_URL/rest/v1/sites?id=eq.22222222-2222-2222-2222-222222222222" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "{\"daily_note\":\"E2E test briefing $(date +%s)\",\"daily_note_updated_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}")
test_case "site briefing update with daily_note_updated_at" "$NOTE_UPDATE" '"daily_note_updated_at"'

echo ""
echo -e "${YELLOW}=== Phase 21 (M13): bulk verify multiple attendance rows ===${RESET}"
# Grab two flagged attendance ids and verify both in one PATCH
FLAGGED_IDS=$(docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    select id from attendance where status = 'flagged' limit 2;
" | tr -d ' ' | tr '\n' ',' | sed 's/,$//')
FLAG_COUNT=$(echo "$FLAGGED_IDS" | tr ',' '\n' | grep -c -E '^[a-f0-9-]+$' || true)
if [ "$FLAG_COUNT" -ge 2 ]; then
    # PostgREST id=in.(uuid1,uuid2) — no quotes around uuids
    BULK=$(curl -s -X PATCH "$API_URL/rest/v1/attendance?id=in.($FLAGGED_IDS)" \
        -H "apikey: $ANON_KEY" \
        -H "Authorization: Bearer $SUPER_TOKEN" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=representation" \
        -d '{"status":"verified"}')
    VERIFIED_COUNT=$(echo "$BULK" | grep -oE '"status":"verified"' | wc -l | tr -d ' ')
    test_case "bulk-verify ≥2 flagged rows in one PATCH" "$VERIFIED_COUNT" '^[2-9]$|^[1-9][0-9]+$'
else
    echo "  (only $FLAG_COUNT flagged row; skipping bulk-verify)"
fi

echo ""
echo -e "${YELLOW}=== Phase 22 (M14): projects.address column accepts text ===${RESET}"
PROJ_ADDR=$(curl -s -X POST "$API_URL/rest/v1/projects" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d '{
        "name":"E2E Address Project",
        "client_name":"E2E Client",
        "address":"Plot 42, MG Road, Bengaluru 560001",
        "status":"planning"
    }')
test_case "create project with full address" "$PROJ_ADDR" '"address":"Plot 42, MG Road, Bengaluru 560001"'
NEW_PROJ_ID=$(echo "$PROJ_ADDR" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | sed 's/.*:"//;s/"$//')
echo "  project id: $NEW_PROJ_ID"

# Edit it to update address
PROJ_EDIT=$(curl -s -X PATCH "$API_URL/rest/v1/projects?id=eq.$NEW_PROJ_ID" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d '{"address":"Plot 99, Indiranagar, Bengaluru 560038","client_name":"Edited Client"}')
test_case "edit project: new address persisted" "$PROJ_EDIT" '"address":"Plot 99, Indiranagar, Bengaluru 560038"'
test_case "edit project: new client persisted"  "$PROJ_EDIT" '"client_name":"Edited Client"'

# Cleanup
curl -s -X DELETE "$API_URL/rest/v1/projects?id=eq.$NEW_PROJ_ID" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" > /dev/null

echo ""
echo -e "${YELLOW}=== Phase 23 (M15): access_events anon insert + supervisor read ===${RESET}"
# Anon can insert page_view. NOTE: do NOT use Prefer: return=representation here —
# the implicit SELECT-back is gated by the supervisors-only SELECT policy and
# would (correctly) fail. Just check the HTTP status code.
ACCESS_BODY='{"actor_type":"anon","event_type":"page_view","route":"/worker/login","user_agent":"e2e-test-agent","device_fingerprint":"e2e-fp-anon","metadata":{"language":"en-US","timezone":"Asia/Kolkata"}}'
ACCESS_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API_URL/rest/v1/access_events" \
    -H "apikey: $ANON_KEY" \
    -H "Content-Type: application/json" \
    -d "$ACCESS_BODY")
test_case "anon can INSERT access_event (HTTP 201)" "$ACCESS_CODE" '^201$'

# Supervisor reads via list_recent_traffic RPC
TRAFFIC=$(curl -s -X POST "$API_URL/rest/v1/rpc/list_recent_traffic" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_limit":50}')
test_case "supervisor reads list_recent_traffic" "$TRAFFIC" '"event_type":"page_view"|e2e-fp-anon'

# Anon CANNOT read access_events directly (RLS denies)
ACCESS_READ_ANON=$(curl -s "$API_URL/rest/v1/access_events?select=id&limit=1" \
    -H "apikey: $ANON_KEY")
test_case "anon CANNOT read access_events (RLS)" "$ACCESS_READ_ANON" '^\[\]$|"code":"42501"|"message":'

echo ""
echo -e "${YELLOW}=== Phase 24: traffic_summary RPC returns counters ===${RESET}"
SUMMARY=$(curl -s -X POST "$API_URL/rest/v1/rpc/traffic_summary" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{}')
test_case "traffic_summary returns total + page_views" "$SUMMARY" '"total":[0-9]+.*"page_views":[0-9]+'

echo ""
echo -e "${YELLOW}=== Phase 25 (M14): selfie_metadata + capture_method + selfie_sha256 stored ===${RESET}"
# Re-activate Priya for one more punch with full metadata
curl -s -X PATCH "$API_URL/rest/v1/workers?id=eq.44444444-4444-4444-4444-444444444444" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"status":"active"}' > /dev/null

PUNCH_META=$(curl -s -X POST "$API_URL/functions/v1/punch-submit" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer ${WORKER_TOKENS[44444444-4444-4444-4444-444444444444]}" \
    -H "Content-Type: application/json" \
    -d "{
        \"siteId\":\"22222222-2222-2222-2222-222222222222\",
        \"type\":\"in\",
        \"selfieDataUrl\":\"$SELFIE_DATAURL\",
        \"gps\":{\"lat\":12.9698,\"lng\":77.7500,\"accuracy_m\":15,\"speed_ms\":null},
        \"deviceFingerprint\":\"e2e-fp-meta\",
        \"userAgent\":\"e2e-test-meta\",
        \"captureMethod\":\"camera\",
        \"selfieSha256\":\"abc123def456\",
        \"selfieMetadata\":{\"image\":{\"widthPx\":800,\"heightPx\":600,\"byteSize\":42},\"camera\":{\"facingMode\":\"user\"},\"device\":{\"timezone\":\"Asia/Kolkata\"}}
    }")
test_case "punch with metadata returns id" "$PUNCH_META" '"status":"pending"|"status":"flagged"'

META_PUNCH_ID=$(echo "$PUNCH_META" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | sed 's/.*:"//;s/"$//')
META_ROW=$(curl -s "$API_URL/rest/v1/attendance?id=eq.$META_PUNCH_ID&select=selfie_metadata,capture_method,selfie_sha256" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN")
# Postgres jsonb pretty-prints with whitespace ("timezone": "..."), accept either form.
test_case "selfie_metadata.device.timezone persisted" "$META_ROW" '"timezone":[[:space:]]*"Asia/Kolkata"'
test_case "capture_method=camera persisted" "$META_ROW" '"capture_method":"camera"'
test_case "selfie_sha256 persisted" "$META_ROW" '"selfie_sha256":"abc123def456"'

echo ""
echo -e "${YELLOW}=== Phase 26 (M13): audit log captures before/after diff ===${RESET}"
AUDIT_DIFF=$(docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    select count(*) from audit_log
    where action = 'update_workers'
      and before_state ? 'status'
      and after_state ? 'status'
      and before_state->>'status' <> after_state->>'status';
")
test_case "audit_log has ≥3 rows with status before/after diff" "$AUDIT_DIFF" '^[3-9]$|^[1-9][0-9]+$'

echo ""
echo -e "${YELLOW}=== Phase 27 (M13): project archive cascade closes sites ===${RESET}"
# Create a tiny throwaway project + site, archive the project, observe site → closed
ARCH_PROJ=$(curl -s -X POST "$API_URL/rest/v1/projects" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d '{"name":"E2E Archive Test","status":"active"}')
ARCH_PROJ_ID=$(echo "$ARCH_PROJ" | grep -oE '"id":"[a-f0-9-]+"' | head -1 | sed 's/.*:"//;s/"$//')

curl -s -X POST "$API_URL/rest/v1/sites" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
        \"project_id\":\"$ARCH_PROJ_ID\",
        \"name\":\"E2E archive site\",
        \"default_lat\":12.97,\"default_lng\":77.75,
        \"status\":\"active\"
    }" > /dev/null

# Archive the project — trigger should set its sites to 'closed'
curl -s -X PATCH "$API_URL/rest/v1/projects?id=eq.$ARCH_PROJ_ID" \
    -H "apikey: $ANON_KEY" \
    -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"status\":\"archived\",\"archived_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null

ARCH_SITES=$(curl -s "$API_URL/rest/v1/sites?project_id=eq.$ARCH_PROJ_ID&select=name,status" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN")
test_case "archive project cascades sites → closed" "$ARCH_SITES" '"status":"closed"'

# Cleanup the throwaway
curl -s -X DELETE "$API_URL/rest/v1/projects?id=eq.$ARCH_PROJ_ID" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" > /dev/null

echo ""
echo -e "${YELLOW}=== Phase 29 (M17): analytics_hours_per_project rejects project NAME as UUID ===${RESET}"
# ASCII-only payload so curl in any shell delivers it intact (was failing on
# em-dashes when piped through Windows bash). Tests the same NAME-as-UUID
# guard the dropdown bug needed.
HPP_BAD_NAME=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_hours_per_project" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_project_id":"Amli"}')
test_case "passing a project NAME instead of UUID returns 22P02 / invalid input syntax" \
    "$HPP_BAD_NAME" '"22P02"|invalid input syntax for type uuid'

echo ""
echo -e "${YELLOW}=== Phase 30 (M17): analytics_hours_per_project accepts a real UUID ===${RESET}"
HPP_OK=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_hours_per_project" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_project_id":"11111111-1111-1111-1111-111111111111"}')
test_case "real UUID returns the Demo Project row" "$HPP_OK" 'Demo Project — Bangalore Tower A'

echo ""
echo -e "${YELLOW}=== Phase 31 (M17): analytics_daily_attendance honors p_site_id ===${RESET}"
DA_SITE=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_daily_attendance" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_site_id":"22222222-2222-2222-2222-222222222222"}')
SITE_ROWS=$(echo "$DA_SITE" | grep -oE '"site_id":"[^"]+"' | sort -u | wc -l | tr -d ' ')
test_case "every row has site_id = Tower A (count of distinct sites = 1)" "$SITE_ROWS" '^[01]$'

echo ""
echo -e "${YELLOW}=== Phase 32 (M17): analytics_daily_attendance honors p_worker_id ===${RESET}"
DA_WORKER=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_daily_attendance" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_worker_id":"33333333-3333-3333-3333-333333333333"}')
NON_RAVI=$(echo "$DA_WORKER" | grep -oE '"worker_id":"[^"]+"' | grep -v '33333333' | wc -l | tr -d ' ')
test_case "filtering by Ravi returns 0 non-Ravi rows" "$NON_RAVI" '^0$'

echo ""
echo -e "${YELLOW}=== Phase 33 (M17): analytics_daily_attendance p_statuses=['flagged'] only ===${RESET}"
DA_STATUS=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_daily_attendance" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_statuses":["flagged"]}')
NON_FLAGGED=$(echo "$DA_STATUS" | grep -oE '"status":"[^"]+"' | grep -v 'flagged' | wc -l | tr -d ' ')
test_case "filtering by status=flagged returns 0 non-flagged rows" "$NON_FLAGGED" '^0$'

echo ""
echo -e "${YELLOW}=== Phase 34 (M17): analytics_daily_attendance shows orphan IN with NULL out ===${RESET}"
# Insert an IN-only attendance for Anil (re-activated by Phase 19) at Tower A,
# 2 hours ago, no OUT counterpart. Expect a row with hours_worked=null.
ORPHAN_TS=$(docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    insert into attendance (worker_id, site_id, type, status, punched_at, gps_accuracy_m, device_lat, device_lng)
    values ('55555555-5555-5555-5555-555555555555',
            '22222222-2222-2222-2222-222222222222',
            'in', 'verified', now() - interval '2 hours', 15, 12.9698, 77.7500)
    returning punched_at;
")
DA_ORPHAN=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_daily_attendance" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_worker_id":"55555555-5555-5555-5555-555555555555","p_statuses":["verified","auto_closed","flagged","pending"]}')
test_case "orphan IN appears with punch_out_time:null" "$DA_ORPHAN" '"punch_out_time":null'
test_case "orphan IN has hours_worked:null"            "$DA_ORPHAN" '"hours_worked":null'

echo ""
echo -e "${YELLOW}=== Phase 35 (M17): analytics_hours_per_project sums full shift correctly ===${RESET}"
# Insert IN @ 08:00 today + OUT @ 17:00 today for Ravi, both verified.
# Expect total_hours ~= 9.
docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    delete from attendance where worker_id='33333333-3333-3333-3333-333333333333' and punched_at::date = current_date;
    insert into attendance (worker_id, site_id, type, status, punched_at, gps_accuracy_m, device_lat, device_lng) values
        ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','in', 'verified', current_date::timestamp + interval '8 hours', 15, 12.9698, 77.7500),
        ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','out','verified', current_date::timestamp + interval '17 hours', 15, 12.9698, 77.7500);
" > /dev/null
HPP_SHIFT=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_hours_per_project" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_project_id":"11111111-1111-1111-1111-111111111111","p_worker_id":"33333333-3333-3333-3333-333333333333","p_statuses":["verified"]}')
test_case "total_hours for Ravi 08:00→17:00 == 9.00" "$HPP_SHIFT" '"total_hours":9(\.0+)?'

echo ""
echo -e "${YELLOW}=== Phase 36 (M17): duplicate IN within shift uses first-in / last-out ===${RESET}"
# Add a duplicate IN at 09:00 — first-in is still 08:00, last-out 17:00 ⇒ still 9h.
docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    insert into attendance (worker_id, site_id, type, status, punched_at, gps_accuracy_m, device_lat, device_lng) values
        ('33333333-3333-3333-3333-333333333333','22222222-2222-2222-2222-222222222222','in', 'verified', current_date::timestamp + interval '9 hours', 15, 12.9698, 77.7500);
" > /dev/null
HPP_DUP=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_hours_per_project" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_project_id":"11111111-1111-1111-1111-111111111111","p_worker_id":"33333333-3333-3333-3333-333333333333","p_statuses":["verified"]}')
test_case "duplicate IN at 09:00 still yields total_hours=9.00 (first-in/last-out)" \
    "$HPP_DUP" '"total_hours":9(\.0+)?'

echo ""
echo -e "${YELLOW}=== Phase 37 (M17): analytics_hours_per_worker_project p_worker_id filter ===${RESET}"
HPW=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_hours_per_worker_project" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_worker_id":"33333333-3333-3333-3333-333333333333","p_statuses":["verified"]}')
NON_RAVI_WP=$(echo "$HPW" | grep -oE '"worker_id":"[^"]+"' | grep -v '33333333' | wc -l | tr -d ' ')
test_case "p_worker_id filter excludes other workers" "$NON_RAVI_WP" '^0$'

echo ""
echo -e "${YELLOW}=== Phase 38 (M17): analytics_hours_per_worker_project rejects worker NAME as UUID ===${RESET}"
HPW_BAD=$(curl -s -X POST "$API_URL/rest/v1/rpc/analytics_hours_per_worker_project" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"p_project_id":"Amli"}')
test_case "name in p_project_id returns 22P02" "$HPW_BAD" '"22P02"|invalid input syntax for type uuid'

echo ""
echo -e "${YELLOW}=== Phase 39 (M17): attendance_filter_options returns sites + workers ===${RESET}"
OPTS=$(curl -s -X POST "$API_URL/rest/v1/rpc/attendance_filter_options" \
    -H "apikey: $ANON_KEY" -H "Authorization: Bearer $SUPER_TOKEN" \
    -H "Content-Type: application/json" -d '{}')
test_case "filter options include Tower A as a site"   "$OPTS" 'Tower A'
test_case "filter options include Ravi as a worker"    "$OPTS" 'Ravi Kumar'

echo ""
echo -e "${YELLOW}=== Phase 40 (M17): purge_old_access_events deletes only old rows ===${RESET}"
# Seed: insert 2 access_events; backdate the first one 100 days; new one stays.
docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    insert into access_events (actor_type, event_type, route, occurred_at)
        values ('anon','page_view','/old-test', now() - interval '100 days') returning id;
    insert into access_events (actor_type, event_type, route, occurred_at)
        values ('anon','page_view','/new-test', now()) returning id;
" > /dev/null
PURGE=$(docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    select deleted_count, kept_count from purge_old_access_events(30);
")
echo "  purge result: $PURGE"
test_case "purge removed ≥1 old row"  "$PURGE" '^[1-9][0-9]*\|'
NEW_KEPT=$(docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    select count(*) from access_events where route = '/new-test';
")
test_case "fresh /new-test row still present"  "$NEW_KEPT" '^[1-9][0-9]*$'
OLD_GONE=$(docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -tA -c "
    select count(*) from access_events where route = '/old-test';
")
test_case "old /old-test row gone"             "$OLD_GONE" '^0$'

echo ""
echo -e "${YELLOW}=== Phase 41: Final cleanup (reset state for clean re-runs) ===${RESET}"

docker exec supabase_db_attendance-recorder psql -U postgres -d postgres -c "
    update workers set status='invited',
        pin_hash=null, baseline_selfie_url=null, auth_user_id=null,
        registered_at=null, approved_at=null, approved_by=null;
    delete from auth.users where email like '%@worker.local';
    delete from pin_reset_requests;
    delete from access_events where actor_label is null and (user_agent like 'e2e%' or user_agent is null);
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
