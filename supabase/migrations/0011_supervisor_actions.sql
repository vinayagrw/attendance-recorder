-- M10: extend supervisor capabilities
-- 1. Supervisors can invite workers (INSERT into workers)
-- 2. Supervisors can assign workers to sites in their scope
-- 3. Supervisors can enter manual punches and edit existing ones
-- 4. Workers cannot delete their own attendance (only update via supervisor)

-- ────────────────────────────────────────────────────────────────────────
-- 1. Allow supervisors to INSERT workers. Worker has no site yet at this
--    moment, so we don't gate on scope here — gate on the assignment INSERT.
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists workers_supervisor_invite on workers;
create policy workers_supervisor_invite on workers for insert
    with check (is_supervisor());

-- ────────────────────────────────────────────────────────────────────────
-- 2. Supervisors can INSERT/DELETE worker_site_assignments only if the
--    target site is in their project scope.
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists wsa_supervisor_write on worker_site_assignments;
create policy wsa_supervisor_write on worker_site_assignments for all
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = worker_site_assignments.site_id
            and project_in_scope(s.project_id)
        )
    )
    with check (
        is_admin() or exists (
            select 1 from sites s
            where s.id = worker_site_assignments.site_id
            and project_in_scope(s.project_id)
        )
    );

-- ────────────────────────────────────────────────────────────────────────
-- 3. Manual punches by supervisor — INSERT into attendance for workers
--    assigned to a site within the supervisor's scope.
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists attendance_supervisor_insert on attendance;
create policy attendance_supervisor_insert on attendance for insert
    with check (
        is_admin() or (
            is_supervisor() and exists (
                select 1 from sites s
                where s.id = attendance.site_id
                and project_in_scope(s.project_id)
            )
        )
    );

-- attendance_supervisor_update was already added in 0002_rls.sql
-- (allows reviewer to verify/flag/reject + edit punched_at and reviewer_comment).

-- ────────────────────────────────────────────────────────────────────────
-- 4. Convenience view: workers visible to supervisor with their assignments
-- ────────────────────────────────────────────────────────────────────────
create or replace view supervisor_workers as
    select
        w.id,
        w.full_name,
        w.phone,
        w.status,
        w.registered_at,
        w.approved_at,
        coalesce(
            (select array_agg(distinct s.id)
             from worker_site_assignments wsa
             join sites s on s.id = wsa.site_id
             where wsa.worker_id = w.id
               and (wsa.valid_to is null or wsa.valid_to > now())),
            '{}'::uuid[]
        ) as site_ids,
        coalesce(
            (select array_agg(distinct s.name)
             from worker_site_assignments wsa
             join sites s on s.id = wsa.site_id
             where wsa.worker_id = w.id
               and (wsa.valid_to is null or wsa.valid_to > now())),
            '{}'::text[]
        ) as site_names
    from workers w;

grant select on supervisor_workers to authenticated;
