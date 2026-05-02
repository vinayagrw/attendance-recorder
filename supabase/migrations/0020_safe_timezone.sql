-- Migration 0020 — make every analytics + payroll query tolerant of bad
-- sites.timezone values, repair existing bad rows, and prevent future ones.
--
-- The user reported "Failed to load some data: time zone 'usa' not
-- recognized" on /supervisor/analytics. Root cause: a site row had
-- `timezone = 'usa'` (free-text input on /admin/sites), and every
-- analytics RPC does `at time zone coalesce(s.timezone, 'UTC')`, which
-- fatally rejects unknown zone names.
--
-- Three-pronged fix:
--   1. Helper `safe_timezone(text)` — returns the input if it's a valid
--      IANA name (per `pg_timezone_names`), else 'UTC'.
--   2. Repair existing rows: any sites.timezone not in pg_timezone_names
--      gets normalised to 'UTC'.
--   3. CHECK constraint so future inserts can't smuggle bad zones in.
--
-- Then we redefine every analytics + payroll RPC that uses sites.timezone
-- to call safe_timezone() instead, so even if step 3 is somehow bypassed
-- (DB-direct inserts), the dashboards keep working.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. safe_timezone helper
-- ─────────────────────────────────────────────────────────────────────────
create or replace function safe_timezone(tz text) returns text
language sql stable parallel safe as $$
    select case
        when tz is null or tz = '' then 'UTC'
        when exists (select 1 from pg_timezone_names where name = tz) then tz
        else 'UTC'
    end;
$$;

revoke all on function safe_timezone(text) from public;
grant execute on function safe_timezone(text) to anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. Repair existing bad rows
-- ─────────────────────────────────────────────────────────────────────────
update sites
   set timezone = 'UTC'
 where timezone is not null
   and timezone <> ''
   and not exists (select 1 from pg_timezone_names p where p.name = sites.timezone);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. BEFORE INSERT/UPDATE trigger that rejects unknown IANA names. CHECK
--    constraints can't reference other tables (pg_timezone_names), so we
--    use a trigger. Empty / NULL values are allowed — analytics queries
--    coalesce to UTC.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function trg_validate_site_timezone() returns trigger
language plpgsql as $$
begin
    if new.timezone is null or new.timezone = '' then
        return new;
    end if;
    if not exists (select 1 from pg_timezone_names where name = new.timezone) then
        raise exception
            'Invalid timezone "%". Use an IANA name like "UTC", "Asia/Kolkata", "America/New_York" — see SELECT name FROM pg_timezone_names for the full list.',
            new.timezone
            using errcode = '22023';   -- invalid_parameter_value
    end if;
    return new;
end;
$$;

drop trigger if exists sites_validate_timezone_ins on sites;
create trigger sites_validate_timezone_ins
    before insert on sites
    for each row execute function trg_validate_site_timezone();

drop trigger if exists sites_validate_timezone_upd on sites;
create trigger sites_validate_timezone_upd
    before update of timezone on sites
    for each row execute function trg_validate_site_timezone();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. Re-define analytics RPCs to use safe_timezone() as a runtime backstop.
--    Same signatures as 0018 — just swapping the timezone source.
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
            (a.punched_at at time zone safe_timezone(s.timezone))::date as work_date,
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
            (a.punched_at at time zone safe_timezone(s.timezone))::date as work_date,
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
    with raw as (
        select
            a.worker_id,
            a.site_id,
            a.punched_at,
            a.type,
            a.status,
            a.flag_reasons,
            (a.punched_at at time zone safe_timezone(s.timezone))::date as work_date
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
-- 5. Payroll RPC (0007) also did `at time zone s.timezone` — patch it too.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function attendance_summary(
    p_start date,
    p_end date,
    p_project_id uuid default null,
    p_site_id uuid default null
) returns table (
    worker_id uuid,
    worker_name text,
    phone text,
    project_name text,
    site_name text,
    work_date date,
    clock_in timestamptz,
    clock_out timestamptz,
    hours_worked numeric,
    status text,
    flag_reasons text
) language sql stable as $$
    with day_rows as (
        select
            w.id as worker_id, w.full_name as worker_name, w.phone,
            p.name as project_name, s.name as site_name, s.timezone,
            (a.punched_at at time zone safe_timezone(s.timezone))::date as work_date,
            a.type, a.punched_at, a.status as punch_status,
            fr as flag_reason
        from attendance a
        join workers w  on w.id = a.worker_id
        join sites s    on s.id = a.site_id
        join projects p on p.id = s.project_id
        left join lateral unnest(a.flag_reasons) fr on true
        where (a.punched_at at time zone safe_timezone(s.timezone))::date between p_start and p_end
          and (p_project_id is null or p.id = p_project_id)
          and (p_site_id is null or s.id = p_site_id)
    ),
    paired as (
        select worker_id, worker_name, phone, project_name, site_name, work_date,
               min(case when type='in'  then punched_at end) as clock_in,
               max(case when type='out' then punched_at end) as clock_out,
               max(punch_status) as status,
               array_remove(array_agg(distinct flag_reason), null) as flags
        from day_rows
        group by worker_id, worker_name, phone, project_name, site_name, work_date
    )
    select worker_id, worker_name, phone, project_name, site_name, work_date,
           clock_in, clock_out,
           case when clock_out is not null and clock_in is not null
                then round((extract(epoch from (clock_out - clock_in)) / 3600.0)::numeric, 2)
                else null end as hours_worked,
           status,
           array_to_string(flags, ';') as flag_reasons
    from paired
    order by work_date, worker_name;
$$;
