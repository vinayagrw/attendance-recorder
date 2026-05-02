-- Attendance Recorder — initial schema (M1)
-- See plan §4 + §18 (revised schema deltas).

create extension if not exists "uuid-ossp";
create extension if not exists postgis;
create extension if not exists pgcrypto;

-- ────────────────────────────────────────────────────────────────────────
-- Reference: organisations (multi-tenant insurance — single org for now)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists organisations (
    id uuid primary key default gen_random_uuid(),
    name text not null,
    created_at timestamptz not null default now()
);
insert into organisations (id, name)
    values ('00000000-0000-0000-0000-000000000001', 'Default Org')
    on conflict do nothing;

-- ────────────────────────────────────────────────────────────────────────
-- Projects: a customer/site contract; sites belong to a project
-- ────────────────────────────────────────────────────────────────────────
create table if not exists projects (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    name text not null,
    client_name text,
    status text not null default 'planning'
        check (status in ('planning','active','on_hold','completed','archived')),
    start_date date,
    end_date date,
    created_at timestamptz not null default now(),
    archived_at timestamptz
);

-- ────────────────────────────────────────────────────────────────────────
-- Sites: physical construction location(s) under a project
-- Geofence is a MultiPolygon in WGS84 (4326). default_radius_m kept as
-- a fallback if a polygon hasn't been drawn yet.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists sites (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    project_id uuid not null references projects(id) on delete cascade,
    name text not null,
    address text,
    geofence geography(MultiPolygon, 4326),
    default_lat double precision,
    default_lng double precision,
    default_radius_m int default 150,
    timezone text not null default 'Asia/Kolkata',
    daily_note text,
    status text not null default 'active'
        check (status in ('active','paused','closed')),
    created_at timestamptz not null default now()
);
create index if not exists sites_project_idx on sites(project_id);
create index if not exists sites_geofence_gix on sites using gist(geofence);

-- ────────────────────────────────────────────────────────────────────────
-- Supervisors / Admins (linked to Supabase Auth users)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists supervisors (
    id uuid primary key references auth.users(id) on delete cascade,
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    full_name text not null,
    role text not null default 'supervisor'
        check (role in ('admin','supervisor')),
    scope_project_ids uuid[] not null default '{}',
    created_at timestamptz not null default now()
);

-- ────────────────────────────────────────────────────────────────────────
-- Workers: no Supabase Auth account; PIN-based via Edge Function
-- ────────────────────────────────────────────────────────────────────────
create table if not exists workers (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    full_name text not null,
    phone text,
    pin_hash text,
    baseline_selfie_url text,
    status text not null default 'invited'
        check (status in ('invited','pending_approval','active','suspended','offboarded')),
    failed_login_count int not null default 0,
    locked_until timestamptz,
    registered_at timestamptz,
    approved_by uuid references supervisors(id),
    approved_at timestamptz,
    last_login_at timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists workers_status_idx on workers(status);

-- Worker can be on multiple sites (rotation). Replaces the old
-- workers.assigned_site_id from the v1 plan.
create table if not exists worker_site_assignments (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references workers(id) on delete cascade,
    site_id uuid not null references sites(id) on delete cascade,
    is_primary boolean not null default false,
    valid_from timestamptz not null default now(),
    valid_to timestamptz,
    created_at timestamptz not null default now()
);
create index if not exists wsa_worker_idx on worker_site_assignments(worker_id);
create index if not exists wsa_site_idx on worker_site_assignments(site_id);
create unique index if not exists wsa_one_primary
    on worker_site_assignments(worker_id) where is_primary;

-- ────────────────────────────────────────────────────────────────────────
-- Attendance: immutable insert; status updated by supervisor
-- ────────────────────────────────────────────────────────────────────────
create table if not exists attendance (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    worker_id uuid not null references workers(id),
    site_id uuid not null references sites(id),
    type text not null check (type in ('in','out')),
    punched_at timestamptz not null default now(),
    device_lat double precision,
    device_lng double precision,
    gps_accuracy_m real,
    speed_ms real,
    distance_from_site_m real,
    selfie_url text,
    face_quality_score real,
    is_live_score real,
    face_match_score real,                     -- mocked v1
    device_fingerprint text,
    user_agent text,
    ip_address inet,
    status text not null default 'pending'
        check (status in ('pending','verified','flagged','rejected','auto_closed')),
    flag_reasons text[] not null default '{}',
    reviewed_by uuid references supervisors(id),
    reviewed_at timestamptz,
    reviewer_comment text,
    created_at timestamptz not null default now()
);
create index if not exists attendance_worker_time on attendance(worker_id, punched_at desc);
create index if not exists attendance_site_time on attendance(site_id, punched_at desc);
create index if not exists attendance_pending on attendance(status, punched_at desc)
    where status = 'pending';

-- ────────────────────────────────────────────────────────────────────────
-- Device & login attempts (security log)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists device_logs (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    worker_id uuid references workers(id),
    event text not null check (event in ('register','login','login_fail','login_lockout','punch','pin_reset')),
    device_fingerprint text,
    user_agent text,
    ip_address inet,
    lat double precision,
    lng double precision,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default now()
);
create index if not exists device_logs_worker_time on device_logs(worker_id, created_at desc);

-- ────────────────────────────────────────────────────────────────────────
-- Audit log: append-only, hash-chained for tamper evidence
-- (chain trigger added in 0003_audit_chain.sql)
-- ────────────────────────────────────────────────────────────────────────
create table if not exists audit_log (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    actor_id uuid,
    actor_role text,
    action text not null,
    target_table text not null,
    target_id uuid,
    before_state jsonb,
    after_state jsonb,
    prev_hash text,
    row_hash text,
    created_at timestamptz not null default now()
);
create index if not exists audit_log_target on audit_log(target_table, target_id);
create index if not exists audit_log_time on audit_log(created_at desc);

-- ────────────────────────────────────────────────────────────────────────
-- Helper: distance from site (uses polygon if available, else default circle)
-- ────────────────────────────────────────────────────────────────────────
create or replace function distance_from_site_m(
    p_site_id uuid, p_lat double precision, p_lng double precision
) returns double precision language sql stable as $$
    select case
        when s.geofence is not null then
            st_distance(
                s.geofence,
                st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
            )
        when s.default_lat is not null and s.default_lng is not null then
            st_distance(
                st_setsrid(st_makepoint(s.default_lng, s.default_lat), 4326)::geography,
                st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography
            )
        else null
    end
    from sites s where s.id = p_site_id;
$$;
