#!/usr/bin/env bash
# Reset the local database back to its seed state.
# - Drops all attendance, audit, device logs, daily reports
# - Removes synthetic worker auth users (@worker.local)
# - Re-seeds projects, sites, workers, and their primary assignments
# - PRESERVES supervisor/admin auth users (so you don't have to re-bootstrap)
#
# Run after a long debugging session or before E2E re-runs.
#
# Usage: bash scripts/cleanup-tables.sh

set -e

DB_CONTAINER="${DB_CONTAINER:-supabase_db_attendance-recorder}"

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
    echo "✗ Container '${DB_CONTAINER}' not running. Start the stack with 'npx supabase start' first."
    exit 1
fi

GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"

echo "Resetting local Supabase data → seed state…"

docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres <<'SQL' >/dev/null
begin;

-- Wipe all transactional + log tables
truncate table audit_log restart identity cascade;
truncate table attendance restart identity cascade;
truncate table device_logs restart identity cascade;
truncate table daily_site_reports restart identity cascade;
truncate table worker_site_assignments restart identity cascade;
truncate table workers restart identity cascade;
-- Optional tables — only truncate if they exist (older snapshots may not have them)
do $cleanup$
begin
    if to_regclass('public.pin_reset_requests') is not null then
        execute 'truncate table pin_reset_requests restart identity cascade';
    end if;
    if to_regclass('public.access_events') is not null then
        execute 'truncate table access_events restart identity cascade';
    end if;
end
$cleanup$;

-- Wipe synthetic worker auth users so registration can be re-tested cleanly
delete from auth.users where email like '%@worker.local';

-- Re-seed projects (idempotent)
insert into projects (id, name, client_name, status)
values ('11111111-1111-1111-1111-111111111111',
        'Demo Project — Bangalore Tower A',
        'Acme Realty', 'active')
on conflict (id) do update set status='active', archived_at=null;

-- Re-seed site
insert into sites (id, project_id, name, address,
                   default_lat, default_lng, default_radius_m, timezone, status)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Tower A — Whitefield',
        'Whitefield Main Rd, Bangalore',
        12.9698, 77.7500, 150, 'Asia/Kolkata', 'active')
on conflict (id) do update set status='active', daily_note=null;

-- Re-seed three test workers
insert into workers (id, full_name, status) values
    ('33333333-3333-3333-3333-333333333333', 'Ravi Kumar',  'invited'),
    ('44444444-4444-4444-4444-444444444444', 'Priya Singh', 'invited'),
    ('55555555-5555-5555-5555-555555555555', 'Anil Yadav',  'invited');

-- Primary site assignment for each worker
insert into worker_site_assignments (worker_id, site_id, is_primary) values
    ('33333333-3333-3333-3333-333333333333', '22222222-2222-2222-2222-222222222222', true),
    ('44444444-4444-4444-4444-444444444444', '22222222-2222-2222-2222-222222222222', true),
    ('55555555-5555-5555-5555-555555555555', '22222222-2222-2222-2222-222222222222', true);

commit;

select 'projects' as table_name, count(*) as rows from projects
union all select 'sites', count(*) from sites
union all select 'workers', count(*) from workers
union all select 'worker_site_assignments', count(*) from worker_site_assignments
union all select 'attendance', count(*) from attendance
union all select 'audit_log', count(*) from audit_log
union all select 'supervisors (preserved)', count(*) from supervisors;
SQL

echo -e "${GREEN}✓${RESET} state reset to seed"
echo "  • 1 project, 1 site, 3 workers (invited), 3 assignments"
echo "  • supervisor accounts preserved"
echo "  • run 'bash scripts/e2e.sh' to re-verify"
