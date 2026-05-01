-- M13: address fields gaps surfaced after M12 user feedback.
-- 1. Site picker that returns ALL active sites with an `is_assigned` flag —
--    so worker can punch at unassigned sites with a flag.
-- 2. PIN reset workflow tables.
-- 3. Project / site archive cascade — when a project archives, its sites close
--    and active worker assignments expire.
-- 4. Helper to detect unassigned punches (called from punch-submit Edge Fn).

-- ────────────────────────────────────────────────────────────────────────
-- 1. list_assignable_sites(worker_id) — for the worker punch dropdown.
-- ────────────────────────────────────────────────────────────────────────
create or replace function list_assignable_sites(p_worker_id uuid)
returns table (
    site_id uuid,
    name text,
    project_id uuid,
    project_name text,
    default_lat double precision,
    default_lng double precision,
    default_radius_m int,
    timezone text,
    daily_note text,
    is_assigned boolean,
    is_primary boolean
)
    language sql stable security definer set search_path = public as $$
    select
        s.id as site_id,
        s.name,
        s.project_id,
        p.name as project_name,
        s.default_lat,
        s.default_lng,
        s.default_radius_m,
        s.timezone,
        s.daily_note,
        wsa.id is not null as is_assigned,
        coalesce(wsa.is_primary, false) as is_primary
    from sites s
    join projects p on p.id = s.project_id
    left join worker_site_assignments wsa
        on wsa.site_id = s.id and wsa.worker_id = p_worker_id
        and (wsa.valid_to is null or wsa.valid_to > now())
    where s.status = 'active' and p.status not in ('completed', 'archived')
    order by is_assigned desc, is_primary desc, s.name;
$$;
grant execute on function list_assignable_sites(uuid) to anon, authenticated;

-- Helper used by punch-submit to know whether to flag a punch as unassigned.
create or replace function is_worker_assigned(p_worker_id uuid, p_site_id uuid)
returns boolean
    language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from worker_site_assignments
        where worker_id = p_worker_id and site_id = p_site_id
        and (valid_to is null or valid_to > now())
    );
$$;
grant execute on function is_worker_assigned(uuid, uuid) to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 2. PIN reset tracking — workers request a reset, admin/supervisor approves
-- ────────────────────────────────────────────────────────────────────────
create table if not exists pin_reset_requests (
    id uuid primary key default uuid_generate_v4(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001',
    worker_id uuid references workers(id) on delete cascade,
    contact_phone text,
    note text,
    status text not null default 'pending'
        check (status in ('pending', 'approved', 'rejected', 'expired')),
    requested_at timestamptz not null default now(),
    reviewed_by uuid references supervisors(id),
    reviewed_at timestamptz,
    reviewer_comment text
);
create index if not exists pin_reset_pending on pin_reset_requests(status, requested_at)
    where status = 'pending';

alter table pin_reset_requests enable row level security;
-- Anyone can INSERT (the form is public; abuse is low because supervisor still gates it)
create policy pin_reset_anon_insert on pin_reset_requests for insert
    with check (true);
-- Supervisors read + update in their scope (or admin sees all)
create policy pin_reset_supervisor_read on pin_reset_requests for select
    using (
        is_admin() or exists (
            select 1 from worker_site_assignments wsa
            join sites s on s.id = wsa.site_id
            where wsa.worker_id = pin_reset_requests.worker_id and project_in_scope(s.project_id)
        )
    );
create policy pin_reset_supervisor_update on pin_reset_requests for update
    using (
        is_admin() or exists (
            select 1 from worker_site_assignments wsa
            join sites s on s.id = wsa.site_id
            where wsa.worker_id = pin_reset_requests.worker_id and project_in_scope(s.project_id)
        )
    );

-- ────────────────────────────────────────────────────────────────────────
-- 3. Project archive cascade trigger.
-- ────────────────────────────────────────────────────────────────────────
create or replace function trg_project_archive_cascade() returns trigger
    language plpgsql security definer set search_path = public as $$
begin
    if new.status = 'archived' and (old.status is null or old.status <> 'archived') then
        -- Close every site under the project
        update sites set status = 'closed' where project_id = new.id and status = 'active';
        -- Expire all open worker assignments for those sites
        update worker_site_assignments
            set valid_to = now()
            where valid_to is null
            and site_id in (select id from sites where project_id = new.id);
        -- Auto-close any open attendance shifts
        insert into attendance (worker_id, site_id, type, punched_at, status, flag_reasons)
        select a.worker_id, a.site_id, 'out', now(), 'auto_closed',
               array['auto_closed_project_archived']
        from attendance a
        join sites s on s.id = a.site_id
        where s.project_id = new.id
          and a.type = 'in'
          and not exists (
              select 1 from attendance a2
              where a2.worker_id = a.worker_id
                and a2.site_id = a.site_id
                and a2.type = 'out'
                and a2.punched_at > a.punched_at
          )
          and a.punched_at::date = current_date;

        new.archived_at := now();
    end if;
    return new;
end $$;

drop trigger if exists project_archive_cascade on projects;
create trigger project_archive_cascade
    before update on projects
    for each row execute function trg_project_archive_cascade();

-- ────────────────────────────────────────────────────────────────────────
-- 4. Site briefing edit — supervisors with project_in_scope can update sites.daily_note
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists sites_supervisor_briefing on sites;
create policy sites_supervisor_briefing on sites for update
    using (
        is_admin() or (is_supervisor() and project_in_scope(project_id))
    )
    with check (
        is_admin() or (is_supervisor() and project_in_scope(project_id))
    );
