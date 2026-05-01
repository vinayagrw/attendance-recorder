-- Analytics RPC functions for dashboard
-- Aggregates hours, worker counts, and daily attendance summaries

-- Hours per project (sum of verified + auto_closed punches, grouped by project)
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
    with punch_durations as (
        select
            a.site_id,
            a.worker_id,
            a.punched_at,
            a.type,
            extract(epoch from (
                a.punched_at - lag(a.punched_at) over (partition by a.worker_id, a.site_id, a.punched_at::date order by a.punched_at)
            )) / 3600.0 as duration_hours
        from attendance a
        where a.status in ('verified', 'auto_closed')
            and a.punched_at >= p_start
            and a.punched_at < p_end
    )
    select
        p.id,
        p.name,
        coalesce(
            sum(pd.duration_hours) filter (where pd.type = 'out'),
            0
        )::numeric as total_hours,
        count(pd.punched_at) as punch_count,
        count(distinct pd.worker_id) as worker_count
    from projects p
    left join sites s on p.id = s.project_id
    left join punch_durations pd on s.id = pd.site_id
    where p.status != 'archived'
    group by p.id, p.name
    order by total_hours desc nulls last;
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
    with punch_durations as (
        select
            a.site_id,
            a.worker_id,
            a.punched_at,
            a.type,
            extract(epoch from (
                a.punched_at - lag(a.punched_at) over (partition by a.worker_id, a.site_id, a.punched_at::date order by a.punched_at)
            )) / 3600.0 as duration_hours
        from attendance a
        where a.status in ('verified', 'auto_closed')
            and a.punched_at >= p_start
            and a.punched_at < p_end
    )
    select
        p.id,
        p.name,
        w.id,
        w.full_name,
        coalesce(
            sum(pd.duration_hours) filter (where pd.type = 'out'),
            0
        )::numeric as total_hours,
        count(pd.punched_at) as punch_count,
        count(distinct pd.punched_at::date) as days_worked
    from projects p
    left join sites s on p.id = s.project_id
    left join punch_durations pd on s.id = pd.site_id
    left join workers w on pd.worker_id = w.id
    where p.status != 'archived'
        and (p_project_id is null or p.id = p_project_id)
        and w.id is not null
    group by p.id, p.name, w.id, w.full_name
    order by p.name, total_hours desc nulls last;
$$ stable;

-- Worker count per project
create or replace function analytics_worker_count_per_project()
returns table (
    project_id uuid,
    project_name text,
    active_workers bigint,
    total_workers bigint
)
language sql
security definer
set search_path = public
as $$
    select
        p.id,
        p.name,
        count(w.id) filter (where w.status = 'active') as active_workers,
        count(w.id) as total_workers
    from projects p
    left join sites s on p.id = s.project_id
    left join worker_site_assignments wsa on s.id = wsa.site_id
    left join workers w on wsa.worker_id = w.id
    where p.status != 'archived'
    group by p.id, p.name
    order by p.name;
$$ stable;

-- Daily attendance summary per project (for the table view)
create or replace function analytics_daily_attendance(
    p_start timestamptz default (now()::date - interval '7 days'),
    p_end timestamptz default (now()::date + interval '1 day'),
    p_project_id uuid default null
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
    with all_punches as (
        select
            a.id,
            a.worker_id,
            a.site_id,
            a.punched_at,
            a.type,
            a.status,
            a.flag_reasons,
            lead(a.punched_at) over (partition by a.worker_id, a.site_id, a.punched_at::date order by a.punched_at) as next_punched_at,
            lead(a.type) over (partition by a.worker_id, a.site_id, a.punched_at::date order by a.punched_at) as next_type
        from attendance a
        where a.status in ('verified', 'auto_closed', 'flagged', 'pending')
            and a.punched_at >= p_start
            and a.punched_at < p_end
    ),
    paired_punches as (
        select
            worker_id,
            site_id,
            punched_at::date as punch_date,
            punched_at::time as punch_in,
            next_punched_at::time as punch_out,
            extract(epoch from (next_punched_at - punched_at)) / 3600.0 as hours,
            status,
            flag_reasons
        from all_punches
        where type = 'in'
          and next_type = 'out'
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
        coalesce(p.hours, 0)::numeric,
        p.status,
        p.flag_reasons
    from paired_punches p
    join workers w on p.worker_id = w.id
    join sites s on p.site_id = s.id
    join projects pr on s.project_id = pr.id
    where pr.status != 'archived'
        and (p_project_id is null or pr.id = p_project_id)
    order by p.punch_date desc, p.worker_id, p.punch_in;
$$ stable;

