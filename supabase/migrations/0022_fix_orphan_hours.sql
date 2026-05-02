-- Daily attendance summary (fixed window, added filter parameters, scope filtering)
-- Fixes hours_worked to return NULL instead of 0 for orphan IN punches
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
