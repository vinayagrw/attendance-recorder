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
    select
        p.id,
        p.name,
        coalesce(
            sum(
                extract(epoch from (
                    lag(a.punched_at) over (partition by a.worker_id order by a.punched_at)
                    - a.punched_at
                )) / 3600
            ) filter (where a.type = 'out'),
            0
        ) as total_hours,
        count(*) as punch_count,
        count(distinct a.worker_id) as worker_count
    from projects p
    left join sites s on p.id = s.project_id
    left join attendance a on s.id = a.site_id
        and a.status in ('verified', 'auto_closed')
        and a.punched_at >= p_start
        and a.punched_at < p_end
    where p.status != 'archived'
    group by p.id, p.name
    order by total_hours desc nulls last;
$$ immutable;

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
    select
        p.id,
        p.name,
        w.id,
        w.full_name,
        coalesce(
            sum(
                extract(epoch from (
                    lag(a.punched_at) over (partition by a.worker_id order by a.punched_at)
                    - a.punched_at
                )) / 3600
            ) filter (where a.type = 'out'),
            0
        ) as total_hours,
        count(*) as punch_count,
        count(distinct a.punched_at::date) as days_worked
    from projects p
    left join sites s on p.id = s.project_id
    left join attendance a on s.id = a.site_id
        and a.status in ('verified', 'auto_closed')
        and a.punched_at >= p_start
        and a.punched_at < p_end
    left join workers w on a.worker_id = w.id
    where p.status != 'archived'
        and (p_project_id is null or p.id = p_project_id)
    group by p.id, p.name, w.id, w.full_name
    order by p.name, total_hours desc nulls last;
$$ immutable;

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
        count(*) filter (where w.status = 'active') as active_workers,
        count(*) as total_workers
    from projects p
    left join sites s on p.id = s.project_id
    left join worker_site_assignments wsa on s.id = wsa.site_id
    left join workers w on wsa.worker_id = w.id
    where p.status != 'archived'
    group by p.id, p.name
    order by p.name;
$$ immutable;

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
        coalesce(p.hours, 0),
        p.status,
        p.flag_reasons
    from paired_punches p
    left join workers w on p.worker_id = w.id
    left join sites s on p.site_id = s.id
    left join projects pr on s.project_id = pr.id
    where pr.status != 'archived'
        and (p_project_id is null or pr.id = p_project_id)
    order by p.punch_date desc, p.worker_id, p.punch_in;
$$ immutable;
