-- Restore analytics v2 signatures that were accidentally reverted in 0021_critical_fixes
-- while preserving the project_in_scope() supervisor filtering added in 0021.

drop function if exists analytics_hours_per_project(timestamptz, timestamptz);
drop function if exists analytics_hours_per_worker_project(timestamptz, timestamptz, uuid);

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
      and (is_admin() or project_in_scope(p.id))
    group by p.id, p.name
    order by total_hours desc nulls last;
$$;

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
      and (is_admin() or project_in_scope(p.id))
    group by p.id, p.name, w.id, w.full_name
    order by p.name, total_hours desc nulls last;
$$;
