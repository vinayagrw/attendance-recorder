-- M12: support self-registration of unlisted workers + filtered reports.
-- 1. list_active_sites() RPC for the anon site dropdown on the register page
-- 2. attendance_filtered() RPC for the supervisor's reports-list view

-- ────────────────────────────────────────────────────────────────────────
-- 1. Anon-readable list of active sites for the register screen.
--    Mirrors list_active_workers() (M9) — SECURITY DEFINER, granted to anon.
-- ────────────────────────────────────────────────────────────────────────
create or replace function list_active_sites()
returns table (
    id uuid,
    name text,
    project_id uuid,
    project_name text,
    timezone text
)
    language sql stable security definer set search_path = public as $$
    select s.id, s.name, s.project_id, p.name as project_name, s.timezone
    from sites s
    join projects p on p.id = s.project_id
    where s.status = 'active' and p.status not in ('completed', 'archived')
    order by p.name, s.name;
$$;
grant execute on function list_active_sites() to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Filtered attendance RPC for the supervisor's report list.
--    Returns enriched rows with worker + site + project names so the UI
--    doesn't have to do N+1 joins client-side.
-- ────────────────────────────────────────────────────────────────────────
create or replace function attendance_filtered(
    p_start timestamptz default null,
    p_end   timestamptz default null,
    p_project_id uuid default null,
    p_site_id    uuid default null,
    p_worker_id  uuid default null,
    p_status     text default null,
    p_type       text default null,
    p_limit      int  default 200,
    p_offset     int  default 0
) returns table (
    id uuid,
    worker_id uuid,
    worker_name text,
    site_id uuid,
    site_name text,
    project_id uuid,
    project_name text,
    type text,
    status text,
    punched_at timestamptz,
    distance_from_site_m real,
    selfie_url text,
    flag_reasons text[],
    reviewer_comment text
)
    language sql stable security invoker set search_path = public as $$
    select
        a.id,
        a.worker_id, w.full_name as worker_name,
        a.site_id, s.name as site_name,
        s.project_id, pr.name as project_name,
        a.type, a.status, a.punched_at,
        a.distance_from_site_m, a.selfie_url,
        a.flag_reasons, a.reviewer_comment
    from attendance a
    join workers  w  on w.id  = a.worker_id
    join sites    s  on s.id  = a.site_id
    join projects pr on pr.id = s.project_id
    where (p_start is null or a.punched_at >= p_start)
      and (p_end   is null or a.punched_at <= p_end)
      and (p_project_id is null or s.project_id = p_project_id)
      and (p_site_id    is null or a.site_id    = p_site_id)
      and (p_worker_id  is null or a.worker_id  = p_worker_id)
      and (p_status is null or a.status = p_status)
      and (p_type   is null or a.type   = p_type)
    order by a.punched_at desc
    limit p_limit
    offset p_offset;
$$;
grant execute on function attendance_filtered(
    timestamptz, timestamptz, uuid, uuid, uuid, text, text, int, int
) to authenticated;
