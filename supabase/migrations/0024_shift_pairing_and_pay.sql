-- Migration 0024 — fix IN/OUT pairing in daily attendance, add hourly pay.
--
-- Bug: analytics_daily_attendance (0022) filtered `type = 'in'` BEFORE
-- lead(), so each IN was paired with the worker's next IN and the last IN
-- of the day always showed "open" even after a punch-out.
--
-- Fix: shift_pairs() runs lead() over IN and OUT rows together, keeps the
-- IN rows, and only treats the next row as the punch-out when it is an OUT.
-- Days are bucketed in the site's local timezone (safe_timezone, 0020).
--
-- Pay: worker_rates holds effective-dated hourly rates. A shift is paid at
-- the rate whose effective_from is the latest on or before its work date,
-- so a mid-month raise keeps old days at the old rate.

-- ─────────────────────────────────────────────────────────────────────────
-- 1. worker_rates
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists worker_rates (
    id uuid primary key default gen_random_uuid(),
    worker_id uuid not null references workers(id) on delete cascade,
    hourly_rate numeric(10,2) not null check (hourly_rate > 0),
    effective_from date not null,
    created_by uuid references supervisors(id) on delete set null,
    created_at timestamptz not null default now(),
    unique (worker_id, effective_from)
);
create index if not exists worker_rates_lookup on worker_rates(worker_id, effective_from desc);

alter table worker_rates enable row level security;

-- Supervisors may manage rates for workers assigned to a site in their scope.
create or replace function worker_in_scope(p_worker_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
    select is_admin() or exists (
        select 1
        from worker_site_assignments wsa
        join sites s on s.id = wsa.site_id
        where wsa.worker_id = p_worker_id
          and project_in_scope(s.project_id)
    )
$$;

drop policy if exists worker_rates_select on worker_rates;
create policy worker_rates_select on worker_rates for select
    using (worker_in_scope(worker_id));
drop policy if exists worker_rates_insert on worker_rates;
create policy worker_rates_insert on worker_rates for insert
    with check (is_supervisor() and worker_in_scope(worker_id));
drop policy if exists worker_rates_update on worker_rates;
create policy worker_rates_update on worker_rates for update
    using (is_supervisor() and worker_in_scope(worker_id))
    with check (is_supervisor() and worker_in_scope(worker_id));
drop policy if exists worker_rates_delete on worker_rates;
create policy worker_rates_delete on worker_rates for delete
    using (is_supervisor() and worker_in_scope(worker_id));

create or replace function rate_on(p_worker_id uuid, p_date date) returns numeric
language sql stable security definer set search_path = public as $$
    select r.hourly_rate from worker_rates r
    where r.worker_id = p_worker_id and r.effective_from <= p_date
    order by r.effective_from desc
    limit 1
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. shift_pairs — one row per IN punch, with its matching OUT (if any)
-- ─────────────────────────────────────────────────────────────────────────
create or replace function shift_pairs(p_start timestamptz, p_end timestamptz)
returns table (
    in_id uuid,
    worker_id uuid,
    site_id uuid,
    work_date date,
    in_local time,
    out_local time,
    hours numeric,
    status text,
    flag_reasons text[]
)
language sql stable security definer set search_path = public as $$
    with punches as (
        select
            a.id, a.worker_id, a.site_id, a.type, a.punched_at, a.status, a.flag_reasons,
            safe_timezone(s.timezone) as tz,
            lead(a.type) over w as next_type,
            lead(a.punched_at) over w as next_at
        from attendance a
        join sites s on s.id = a.site_id
        where a.status in ('verified', 'auto_closed', 'flagged', 'pending')
          and a.punched_at >= p_start
          and a.punched_at < p_end + interval '1 day'  -- let a late OUT close a shift
        window w as (partition by a.worker_id, a.site_id order by a.punched_at)
    )
    select
        p.id,
        p.worker_id,
        p.site_id,
        (p.punched_at at time zone p.tz)::date,
        (p.punched_at at time zone p.tz)::time,
        case when p.next_type = 'out' then (p.next_at at time zone p.tz)::time end,
        case when p.next_type = 'out'
             then round((extract(epoch from (p.next_at - p.punched_at)) / 3600)::numeric, 2) end,
        p.status,
        p.flag_reasons
    from punches p
    where p.type = 'in'
      and p.punched_at < p_end
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3. analytics_daily_attendance — same filters, now with rate + amount
-- ─────────────────────────────────────────────────────────────────────────
drop function if exists analytics_daily_attendance(timestamptz, timestamptz, uuid, uuid, uuid, text[]);
create function analytics_daily_attendance(
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
    flag_reasons text[],
    hourly_rate numeric,
    amount numeric
)
language sql stable security definer set search_path = public as $$
    select
        p.work_date,
        pr.id,
        pr.name,
        p.site_id,
        s.name,
        p.worker_id,
        w.full_name,
        p.in_local,
        p.out_local,
        p.hours,
        p.status,
        p.flag_reasons,
        rate_on(p.worker_id, p.work_date),
        round(p.hours * rate_on(p.worker_id, p.work_date), 2)
    from shift_pairs(p_start, p_end) p
    left join workers w on w.id = p.worker_id
    left join sites s on s.id = p.site_id
    left join projects pr on pr.id = s.project_id
    where pr.status != 'archived'
      and (p_project_id is null or pr.id = p_project_id)
      and (p_site_id is null or p.site_id = p_site_id)
      and (p_worker_id is null or p.worker_id = p_worker_id)
      and (p_statuses is null or p.status = any(p_statuses))
      and (is_admin() or project_in_scope(pr.id))
    order by p.work_date desc, w.full_name, p.in_local
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4. analytics_pay — closed shifts with rate and amount, for pay rollups
-- ─────────────────────────────────────────────────────────────────────────
create or replace function analytics_pay(
    p_start timestamptz default (now()::date - interval '30 days'),
    p_end timestamptz default (now()::date + interval '1 day'),
    p_project_id uuid default null,
    p_site_id uuid default null
)
returns table (
    work_date date,
    project_id uuid,
    project_name text,
    site_id uuid,
    site_name text,
    worker_id uuid,
    worker_name text,
    hours numeric,
    hourly_rate numeric,
    amount numeric
)
language sql stable security definer set search_path = public as $$
    select
        p.work_date,
        pr.id,
        pr.name,
        p.site_id,
        s.name,
        p.worker_id,
        w.full_name,
        p.hours,
        rate_on(p.worker_id, p.work_date),
        round(p.hours * rate_on(p.worker_id, p.work_date), 2)
    from shift_pairs(p_start, p_end) p
    left join workers w on w.id = p.worker_id
    left join sites s on s.id = p.site_id
    left join projects pr on pr.id = s.project_id
    where p.hours is not null
      and pr.status != 'archived'
      and (p_project_id is null or pr.id = p_project_id)
      and (p_site_id is null or p.site_id = p_site_id)
      and (is_admin() or project_in_scope(pr.id))
$$;

grant execute on function analytics_daily_attendance(timestamptz, timestamptz, uuid, uuid, uuid, text[]) to authenticated;
grant execute on function analytics_pay(timestamptz, timestamptz, uuid, uuid) to authenticated;
revoke execute on function shift_pairs(timestamptz, timestamptz) from public, anon, authenticated;
