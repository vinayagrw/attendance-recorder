-- Fix critical implementation gaps
-- Addresses Issues #1-7, #10-11 from IMPLEMENTATION_GAPS.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Issue #1: Worker Approval - Allow supervisors to approve workers
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists workers_admin_write on workers;
drop policy if exists workers_supervisor_approve on workers;

create policy workers_supervisor_approve on workers for update
    using (
        is_admin() or exists (
            select 1 from worker_site_assignments wsa
            join sites s on s.id = wsa.site_id
            where wsa.worker_id = workers.id
            and project_in_scope(s.project_id)
        )
    )
    with check (
        is_admin() or (
            status in ('active', 'suspended', 'offboarded', 'pending_approval', 'invited')
            and exists (
                select 1 from worker_site_assignments wsa
                join sites s on s.id = wsa.site_id
                where wsa.worker_id = workers.id
                and project_in_scope(s.project_id)
            )
        )
    );

create policy workers_admin_write on workers for all
    using (is_admin()) with check (is_admin());

-- ─────────────────────────────────────────────────────────────────────────────
-- Issue #7: Feature Flags RLS - Allow supervisors to read flags
-- ─────────────────────────────────────────────────────────────────────────────
drop policy if exists feature_flags_admin_read on feature_flags;

create policy feature_flags_admin_read on feature_flags
    for select using (
        auth.uid() in (select id from supervisors where role = 'admin')
    );

create policy feature_flags_supervisor_read on feature_flags
    for select using (
        auth.uid() in (select id from supervisors)
    );

-- ─────────────────────────────────────────────────────────────────────────────
-- Issues #2, #3, #4, #8: Fix analytics RPC functions
-- ─────────────────────────────────────────────────────────────────────────────

-- Drop and recreate with fixed logic
drop function if exists analytics_hours_per_project(timestamptz, timestamptz) cascade;
drop function if exists analytics_hours_per_worker_project(timestamptz, timestamptz, uuid) cascade;
drop function if exists analytics_daily_attendance(timestamptz, timestamptz, uuid) cascade;

-- Hours per project (fixed window function: current - lag, not lag - current)
create or replace function analytics_hours_per_project(
    p_start timestamptz default (now()::date - interval '30 days'),
    p_end timestamptz default (now()::date + interval '1 day')
)
returns table (
    project_id uuid,
    project_name text,
    total_hours numeric,
    punch_count bigint,
    worker_count bigint
)
language sql
security definer
set search_path = public
as $$
    with paired_punches as (
        select
            a.worker_id,
            a.site_id,
            extract(epoch from (
                lead(a.punched_at) over (partition by a.worker_id order by a.punched_at)
                - a.punched_at
            )) / 3600 as hours_worked
        from attendance a
        where a.type = 'in'
            and a.status in ('verified', 'auto_closed')
            and a.punched_at >= p_start
            and a.punched_at < p_end
    )
    select
        p.id,
        p.name,
        coalesce(sum(pp.hours_worked), 0) as total_hours,
        count(*) as punch_count,
        count(distinct pp.worker_id) as worker_count
    from projects p
    left join sites s on p.id = s.project_id
    left join paired_punches pp on s.id = pp.site_id
    where p.status != 'archived'
        and (is_admin() or project_in_scope(p.id))
    group by p.id, p.name
    order by total_hours desc nulls last
$$ stable;

-- Hours per worker per project
create or replace function analytics_hours_per_worker_project(
    p_start timestamptz default (now()::date - interval '30 days'),
    p_end timestamptz default (now()::date + interval '1 day'),
    p_project_id uuid default null
)
returns table (
    project_id uuid,
    project_name text,
    worker_id uuid,
    worker_name text,
    total_hours numeric,
    punch_count bigint,
    days_worked bigint
)
language sql
security definer
set search_path = public
as $$
    with paired_punches as (
        select
            a.worker_id,
            a.site_id,
            extract(epoch from (
                lead(a.punched_at) over (partition by a.worker_id order by a.punched_at)
                - a.punched_at
            )) / 3600 as hours_worked,
            a.punched_at::date as punch_date
        from attendance a
        where a.type = 'in'
            and a.status in ('verified', 'auto_closed')
            and a.punched_at >= p_start
            and a.punched_at < p_end
    )
    select
        p.id,
        p.name,
        w.id,
        w.full_name,
        coalesce(sum(pp.hours_worked), 0) as total_hours,
        count(*) as punch_count,
        count(distinct pp.punch_date) as days_worked
    from projects p
    left join sites s on p.id = s.project_id
    left join paired_punches pp on s.id = pp.site_id
    left join workers w on pp.worker_id = w.id
    where p.status != 'archived'
        and (p_project_id is null or p.id = p_project_id)
        and (is_admin() or project_in_scope(p.id))
    group by p.id, p.name, w.id, w.full_name
    order by p.name, total_hours desc nulls last
$$ stable;

-- Daily attendance summary (fixed window, added filter parameters, scope filtering)
create or replace function analytics_daily_attendance(
    p_start timestamptz default (now()::date - interval '7 days'),
    p_end timestamptz default (now()::date + interval '1 day'),
    p_project_id uuid default null,
    p_site_id uuid default null,
    p_worker_id uuid default null,
    p_statuses text[] default null
)
returns table (
    attendance_date date,
    project_id uuid,
    project_name text,
    site_id uuid,
    site_name text,
    worker_id uuid,
    worker_name text,
    punch_in_time time,
    punch_out_time time,
    hours_worked numeric,
    status text,
    flag_reasons text[]
)
language sql
security definer
set search_path = public
as $$
    with paired_punches as (
        select
            a.id as in_id,
            lead(a.id) over (partition by a.worker_id, a.site_id, a.punched_at::date order by a.punched_at) as out_id,
            a.worker_id,
            a.site_id,
            a.punched_at::date as punch_date,
            a.punched_at::time as punch_in,
            lead(a.punched_at::time) over (partition by a.worker_id, a.site_id, a.punched_at::date order by a.punched_at) as punch_out,
            extract(epoch from (
                lead(a.punched_at) over (partition by a.worker_id, a.site_id, a.punched_at::date order by a.punched_at)
                - a.punched_at
            )) / 3600 as hours,
            a.status,
            a.flag_reasons
        from attendance a
        where a.type = 'in'
            and a.status in ('verified', 'auto_closed', 'flagged', 'pending')
            and a.punched_at >= p_start
            and a.punched_at < p_end
    )
    select
        p.punch_date,
        pr.id,
        pr.name,
        p.site_id,
        s.name,
        p.worker_id,
        w.full_name,
        p.punch_in,
        p.punch_out,
        p.hours,
        p.status,
        p.flag_reasons
    from paired_punches p
    left join workers w on p.worker_id = w.id
    left join sites s on p.site_id = s.id
    left join projects pr on s.project_id = pr.id
    where pr.status != 'archived'
        and (p_project_id is null or pr.id = p_project_id)
        and (p_site_id is null or p.site_id = p_site_id)
        and (p_worker_id is null or p.worker_id = p_worker_id)
        and (p_statuses is null or p.status = ANY(p_statuses))
        and (is_admin() or project_in_scope(pr.id))
    order by p.punch_date desc, p.worker_id, p.punch_in
$$ stable;

-- ─────────────────────────────────────────────────────────────────────────────
-- Issue #10: Missing RPC - is_worker_assigned
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function is_worker_assigned(
    p_worker_id uuid,
    p_site_id uuid
)
returns boolean
language sql
security definer
set search_path = public
as $$
    select exists (
        select 1 from worker_site_assignments wsa
        where wsa.worker_id = p_worker_id
        and wsa.site_id = p_site_id
        and (wsa.valid_to is null or wsa.valid_to > now())
        and wsa.valid_from <= now()
    )
$$ stable;

grant execute on function is_worker_assigned(uuid, uuid) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Issue #11: Missing RPC - distance_from_site_m
-- ─────────────────────────────────────────────────────────────────────────────
drop function if exists distance_from_site_m(uuid, double precision, double precision);

create or replace function distance_from_site_m(
    p_site_id uuid,
    p_lat double precision,
    p_lng double precision
)
returns numeric
language sql
security definer
set search_path = public
as $$
    select coalesce(
        round(
            st_distance(
                st_point(p_lng, p_lat)::geography,
                st_point(s.default_lng, s.default_lat)::geography
            )::numeric
        ),
        0
    )
    from sites s
    where s.id = p_site_id
$$ stable;

grant execute on function distance_from_site_m(uuid, double precision, double precision) to authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────────────
-- Issue #9: Missing RPC - attendance_filter_options
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function attendance_filter_options(
    p_project_id uuid default null
)
returns table (
    sites jsonb,
    workers jsonb
)
language sql
security definer
set search_path = public
as $$
    select
        coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'project_id', s.project_id)), '[]'::jsonb) as sites,
        coalesce(jsonb_agg(distinct jsonb_build_object('id', w.id, 'name', w.full_name)), '[]'::jsonb) as workers
    from sites s
    left join worker_site_assignments wsa on s.id = wsa.site_id
    left join workers w on wsa.worker_id = w.id
    where (is_admin() or project_in_scope(s.project_id))
        and (p_project_id is null or s.project_id = p_project_id)
        and s.status = 'active'
$$ stable;

grant execute on function attendance_filter_options(uuid) to authenticated, anon;







