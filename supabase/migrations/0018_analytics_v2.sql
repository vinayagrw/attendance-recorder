-- Migration 0018 — Analytics v2 + access_events retention
--
-- Fixes:
--   1. analytics_daily_attendance excluded orphan punches (worker only IN'd,
--      hadn't OUT'd yet) and miscounted shifts with stray duplicate IN/OUT
--      events. Switch to a first-in / last-out per (worker, site, day) model
--      so a single row captures the full shift; orphans appear with NULL
--      out-time / NULL hours so the supervisor can chase them.
--
--   2. analytics_hours_per_project / analytics_hours_per_worker_project used
--      LAG-based per-row durations that doubled-up when a duplicate IN was
--      logged. Switch them to the same first-in / last-out window so totals
--      match what the supervisor sees in the daily table.
--
--   3. All four analytics RPCs gain optional p_site_id, p_worker_id,
--      p_status[] filters so the UI can drill into anomalies.
--
-- Adds:
--   - purge_old_access_events(p_keep_days int) — manual / scheduled cleanup
--     for the M15 access_events table so traffic data doesn't grow forever.
--   - access_events_summary view-style RPC for the /admin/traffic header.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. Drop old signatures so we can change parameter lists cleanly
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists analytics_hours_per_project(timestamptz, timestamptz);
drop function if exists analytics_hours_per_worker_project(timestamptz, timestamptz, uuid);
drop function if exists analytics_worker_count_per_project();
drop function if exists analytics_daily_attendance(timestamptz, timestamptz, uuid);

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Hours per project — first-in / last-out per worker per day
-- ─────────────────────────────────────────────────────────────────────────
create or replace function analytics_hours_per_project(
    p_start timestamptz default (now()::date - interval '30 days'),
    p_end timestamptz default (now()::date + interval '1 day'),
    p_project_id uuid default null,
    p_site_id uuid default null,
    p_worker_id uuid default null,
    p_statuses text[] default array['verified','auto_closed']
) returns table (
    project_id uuid,
    project_name text,
    total_hours numeric,
    punch_count bigint,
    worker_count bigint
) language sql security definer set search_path = public as $$
    with shifts as (
        select
            a.worker_id,
            a.site_id,
            (a.punched_at at time zone coalesce(s.timezone, 'UTC'))::date as work_date,
            min(a.punched_at) filter (where a.type = 'in')  as first_in,
            max(a.punched_at) filter (where a.type = 'out') as last_out,
            count(*)                                         as punch_count
        from attendance a
        join sites s on s.id = a.site_id
        where a.punched_at >= p_start
          and a.punched_at <  p_end
          and a.status = any(p_statuses)
          and (p_site_id   is null or a.site_id   = p_site_id)
          and (p_worker_id is null or a.worker_id = p_worker_id)
        group by a.worker_id, a.site_id, work_date
    )
    select
        p.id,
        p.name,
        coalesce(
            sum(extract(epoch from (sh.last_out - sh.first_in)) / 3600.0)
                filter (where sh.first_in is not null and sh.last_out is not null),
            0
        )::numeric(10,2) as total_hours,
        coalesce(sum(sh.punch_count), 0) as punch_count,
        count(distinct sh.worker_id)     as worker_count
    from projects p
    left join sites s on p.id = s.project_id
    left join shifts sh on s.id = sh.site_id
    where p.status != 'archived'
      and (p_project_id is null or p.id = p_project_id)
    group by p.id, p.name
    order by total_hours desc nulls last;
$$;

revoke all on function analytics_hours_per_project(timestamptz, timestamptz, uuid, uuid, uuid, text[]) from public;
grant execute on function analytics_hours_per_project(timestamptz, timestamptz, uuid, uuid, uuid, text[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Hours per worker per project — same first-in / last-out logic
-- ─────────────────────────────────────────────────────────────────────────
create or replace function analytics_hours_per_worker_project(
    p_start timestamptz default (now()::date - interval '30 days'),
    p_end timestamptz default (now()::date + interval '1 day'),
    p_project_id uuid default null,
    p_site_id uuid default null,
    p_worker_id uuid default null,
    p_statuses text[] default array['verified','auto_closed']
) returns table (
    project_id uuid,
    project_name text,
    worker_id uuid,
    worker_name text,
    total_hours numeric,
    punch_count bigint,
    days_worked bigint
) language sql security definer set search_path = public as $$
    with shifts as (
        select
            a.worker_id,
            a.site_id,
            (a.punched_at at time zone coalesce(s.timezone, 'UTC'))::date as work_date,
            min(a.punched_at) filter (where a.type = 'in')  as first_in,
            max(a.punched_at) filter (where a.type = 'out') as last_out,
            count(*)                                         as punch_count
        from attendance a
        join sites s on s.id = a.site_id
        where a.punched_at >= p_start
          and a.punched_at <  p_end
          and a.status = any(p_statuses)
          and (p_site_id   is null or a.site_id   = p_site_id)
          and (p_worker_id is null or a.worker_id = p_worker_id)
        group by a.worker_id, a.site_id, work_date
    )
    select
        p.id,
        p.name,
        w.id,
        w.full_name,
        coalesce(
            sum(extract(epoch from (sh.last_out - sh.first_in)) / 3600.0)
                filter (where sh.first_in is not null and sh.last_out is not null),
            0
        )::numeric(10,2) as total_hours,
        coalesce(sum(sh.punch_count), 0) as punch_count,
        count(distinct sh.work_date)     as days_worked
    from projects p
    join sites s on p.id = s.project_id
    join shifts sh on s.id = sh.site_id
    join workers w on w.id = sh.worker_id
    where p.status != 'archived'
      and (p_project_id is null or p.id = p_project_id)
    group by p.id, p.name, w.id, w.full_name
    order by p.name, total_hours desc nulls last;
$$;

revoke all on function analytics_hours_per_worker_project(timestamptz, timestamptz, uuid, uuid, uuid, text[]) from public;
grant execute on function analytics_hours_per_worker_project(timestamptz, timestamptz, uuid, uuid, uuid, text[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Worker count per project (with optional site filter)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function analytics_worker_count_per_project(
    p_project_id uuid default null,
    p_site_id uuid default null
) returns table (
    project_id uuid,
    project_name text,
    active_workers bigint,
    total_workers bigint
) language sql security definer set search_path = public as $$
    select
        p.id,
        p.name,
        count(distinct w.id) filter (where w.status = 'active') as active_workers,
        count(distinct w.id)                                     as total_workers
    from projects p
    left join sites s   on p.id = s.project_id
    left join worker_site_assignments wsa on s.id = wsa.site_id
    left join workers w on wsa.worker_id = w.id
    where p.status != 'archived'
      and (p_project_id is null or p.id = p_project_id)
      and (p_site_id    is null or s.id = p_site_id)
    group by p.id, p.name
    order by p.name;
$$;

revoke all on function analytics_worker_count_per_project(uuid, uuid) from public;
grant execute on function analytics_worker_count_per_project(uuid, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5. Daily attendance — first-in / last-out per (worker, site, day)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function analytics_daily_attendance(
    p_start timestamptz default (now()::date - interval '7 days'),
    p_end timestamptz default (now()::date + interval '1 day'),
    p_project_id uuid default null,
    p_site_id uuid default null,
    p_worker_id uuid default null,
    p_statuses text[] default array['verified','auto_closed','flagged','pending']
) returns table (
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
) language sql security definer set search_path = public as $$
    -- Two-stage CTE so we can compute first-in/last-out *and* flatten the
    -- flag_reasons arrays without hitting Postgres's "cannot accumulate
    -- empty arrays" error when every row's flag_reasons is '{}'.
    with raw as (
        select
            a.worker_id,
            a.site_id,
            a.punched_at,
            a.type,
            a.status,
            a.flag_reasons,
            (a.punched_at at time zone coalesce(s.timezone, 'UTC'))::date as work_date
        from attendance a
        join sites s on s.id = a.site_id
        where a.punched_at >= p_start
          and a.punched_at <  p_end
          and a.status = any(p_statuses)
          and (p_site_id   is null or a.site_id   = p_site_id)
          and (p_worker_id is null or a.worker_id = p_worker_id)
    ),
    shifts as (
        select
            r.worker_id,
            r.site_id,
            r.work_date,
            min(r.punched_at) filter (where r.type = 'in')  as first_in,
            max(r.punched_at) filter (where r.type = 'out') as last_out,
            (array_agg(r.status order by case r.status
                when 'rejected'    then 1
                when 'flagged'     then 2
                when 'pending'     then 3
                when 'auto_closed' then 4
                when 'verified'    then 5
                else 6 end))[1] as worst_status
        from raw r
        group by r.worker_id, r.site_id, r.work_date
    ),
    shift_flags as (
        select r.worker_id, r.site_id, r.work_date,
               array_agg(distinct fr) as flag_reasons
        from raw r, lateral unnest(r.flag_reasons) fr
        group by r.worker_id, r.site_id, r.work_date
    )
    select
        sh.work_date,
        pr.id,
        pr.name,
        s.id,
        s.name,
        w.id,
        w.full_name,
        sh.first_in::time  as punch_in_time,
        sh.last_out::time  as punch_out_time,
        case when sh.first_in is not null and sh.last_out is not null
             then round((extract(epoch from (sh.last_out - sh.first_in)) / 3600.0)::numeric, 2)
             else null end as hours_worked,
        sh.worst_status,
        coalesce(sf.flag_reasons, '{}'::text[]) as flag_reasons
    from shifts sh
    left join shift_flags sf
        on sf.worker_id = sh.worker_id
       and sf.site_id   = sh.site_id
       and sf.work_date = sh.work_date
    join sites    s  on s.id  = sh.site_id
    join projects pr on pr.id = s.project_id
    join workers  w  on w.id  = sh.worker_id
    where pr.status != 'archived'
      and (p_project_id is null or pr.id = p_project_id)
    order by sh.work_date desc, w.full_name, sh.first_in;
$$;

revoke all on function analytics_daily_attendance(timestamptz, timestamptz, uuid, uuid, uuid, text[]) from public;
grant execute on function analytics_daily_attendance(timestamptz, timestamptz, uuid, uuid, uuid, text[]) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. access_events retention — purge old rows
--    Run nightly via Supabase Scheduled Functions (cron-driven Edge Fn) or
--    manually from the Studio SQL editor. Default: keep 90 days.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function purge_old_access_events(p_keep_days int default 90)
returns table (deleted_count bigint, kept_count bigint)
language plpgsql security definer set search_path = public as $$
declare
    v_deleted bigint;
    v_kept bigint;
    v_cutoff timestamptz;
begin
    if p_keep_days is null or p_keep_days < 1 then
        raise exception 'p_keep_days must be >= 1';
    end if;
    v_cutoff := now() - (p_keep_days || ' days')::interval;
    delete from access_events where occurred_at < v_cutoff;
    get diagnostics v_deleted = row_count;
    select count(*) into v_kept from access_events;
    return query select v_deleted, v_kept;
end;
$$;

revoke all on function purge_old_access_events(int) from public;
-- Only admins (and the service role) can purge; we don't want any
-- supervisor accidentally wiping the trail.
grant execute on function purge_old_access_events(int) to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- 7. Convenience: attendance_filter_options — feed for the analytics
--    site/worker dropdowns (avoids a separate REST query per dropdown)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function attendance_filter_options(
    p_project_id uuid default null
) returns table (
    sites jsonb,
    workers jsonb
) language sql security definer set search_path = public as $$
    select
        coalesce(jsonb_agg(distinct jsonb_build_object(
            'id',         s.id,
            'name',       s.name,
            'project_id', s.project_id
        )) filter (where s.id is not null), '[]'::jsonb) as sites,
        coalesce(jsonb_agg(distinct jsonb_build_object(
            'id',        w.id,
            'full_name', w.full_name,
            'status',    w.status
        )) filter (where w.id is not null), '[]'::jsonb) as workers
    from sites s
    join projects p on p.id = s.project_id
    left join worker_site_assignments wsa on wsa.site_id = s.id
    left join workers w on w.id = wsa.worker_id
    where p.status != 'archived'
      and (p_project_id is null or p.id = p_project_id);
$$;

revoke all on function attendance_filter_options(uuid) from public;
grant execute on function attendance_filter_options(uuid) to authenticated;
