-- Payroll RPC + daily_site_reports table (M7)

create or replace function payroll_rows(
    p_start date, p_end date,
    p_project_id uuid default null, p_site_id uuid default null
) returns table (
    worker_id uuid, worker_name text, phone text,
    project text, site text, work_date date,
    clock_in timestamptz, clock_out timestamptz, hours_worked numeric,
    status text, flag_reasons text
)
language sql stable as $$
    with day_rows as (
        select
            w.id as worker_id, w.full_name as worker_name, w.phone,
            p.name as project_name, s.name as site_name, s.timezone,
            (a.punched_at at time zone s.timezone)::date as work_date,
            a.type, a.punched_at, a.status as punch_status, a.flag_reasons
        from attendance a
        join workers w  on w.id = a.worker_id
        join sites s    on s.id = a.site_id
        join projects p on p.id = s.project_id
        where (a.punched_at at time zone s.timezone)::date between p_start and p_end
          and (p_project_id is null or p.id = p_project_id)
          and (p_site_id is null or s.id = p_site_id)
    ),
    grouped as (
        select worker_id, worker_name, phone, project_name, site_name, work_date,
               min(case when type='in'  then punched_at end) as clock_in,
               max(case when type='out' then punched_at end) as clock_out,
               max(punch_status) as status,
               array_remove(array_agg(distinct unnest(flag_reasons)), null) as flags
        from day_rows
        group by worker_id, worker_name, phone, project_name, site_name, work_date
    )
    select worker_id, worker_name, phone, project_name, site_name, work_date,
           clock_in, clock_out,
           case when clock_out is not null and clock_in is not null
                then round(extract(epoch from (clock_out - clock_in)) / 3600.0, 2)
                else null end as hours_worked,
           status,
           array_to_string(flags, ';') as flag_reasons
    from grouped
    order by work_date, worker_name;
$$;

-- Daily site reports (Raken-style — see docs/feat-daily-site-report.md)
create table if not exists daily_site_reports (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001',
    site_id uuid not null references sites(id) on delete cascade,
    report_date date not null,
    submitted_by uuid not null references supervisors(id),
    submitted_at timestamptz not null default now(),
    weather_summary text,
    weather_data jsonb,
    headcount_reported int,
    headcount_attendance int,
    work_completed text,
    blockers text,
    notes text,
    photo_paths text[] not null default '{}',
    status text not null default 'submitted'
        check (status in ('draft','submitted','revised'))
);
create unique index if not exists dsr_one_per_day on daily_site_reports(site_id, report_date);

alter table daily_site_reports enable row level security;
create policy dsr_select on daily_site_reports for select
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = daily_site_reports.site_id and project_in_scope(s.project_id)
        )
    );
create policy dsr_insert on daily_site_reports for insert
    with check (
        is_supervisor() and exists (
            select 1 from sites s
            where s.id = daily_site_reports.site_id and project_in_scope(s.project_id)
        )
    );
create policy dsr_update on daily_site_reports for update
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = daily_site_reports.site_id and project_in_scope(s.project_id)
        )
    );
