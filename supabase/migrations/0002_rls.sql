-- Attendance Recorder — Row Level Security (M1)
-- Worker JWTs carry a custom claim `worker_id`; supervisor/admin JWTs come
-- from Supabase Auth and are linked via the `supervisors` table.

alter table organisations            enable row level security;
alter table projects                 enable row level security;
alter table sites                    enable row level security;
alter table supervisors              enable row level security;
alter table workers                  enable row level security;
alter table worker_site_assignments  enable row level security;
alter table attendance               enable row level security;
alter table device_logs              enable row level security;
alter table audit_log                enable row level security;

-- ─── helpers ─────────────────────────────────────────────────────────────
create or replace function jwt_worker_id() returns uuid
    language sql stable as $$
    select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'worker_id', '')::uuid
$$;

create or replace function is_admin() returns boolean
    language sql stable as $$
    select exists (
        select 1 from supervisors s
        where s.id = auth.uid() and s.role = 'admin'
    )
$$;

create or replace function is_supervisor() returns boolean
    language sql stable as $$
    select exists (
        select 1 from supervisors s where s.id = auth.uid()
    )
$$;

create or replace function project_in_scope(p_project_id uuid) returns boolean
    language sql stable as $$
    select exists (
        select 1 from supervisors s
        where s.id = auth.uid()
        and (s.role = 'admin' or p_project_id = any(s.scope_project_ids))
    )
$$;

-- ─── policies ────────────────────────────────────────────────────────────

-- supervisors: read own row, admins read all
create policy supervisors_read_self on supervisors for select
    using (auth.uid() = id or is_admin());
create policy supervisors_admin_write on supervisors for all
    using (is_admin()) with check (is_admin());

-- projects: scoped to supervisor
create policy projects_select on projects for select
    using (is_admin() or project_in_scope(id));
create policy projects_admin_write on projects for all
    using (is_admin()) with check (is_admin());

-- sites: scoped via project
create policy sites_select on sites for select
    using (is_admin() or project_in_scope(project_id));
create policy sites_admin_write on sites for all
    using (is_admin()) with check (is_admin());

-- workers: supervisor sees workers assigned to sites in scope; admin sees all
create policy workers_select on workers for select
    using (
        is_admin() or exists (
            select 1
            from worker_site_assignments wsa
            join sites s on s.id = wsa.site_id
            where wsa.worker_id = workers.id and project_in_scope(s.project_id)
        )
        or jwt_worker_id() = workers.id
    );
create policy workers_admin_write on workers for all
    using (is_admin()) with check (is_admin());

-- worker_site_assignments
create policy wsa_select on worker_site_assignments for select
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = worker_site_assignments.site_id
            and project_in_scope(s.project_id)
        )
        or jwt_worker_id() = worker_id
    );
create policy wsa_admin_write on worker_site_assignments for all
    using (is_admin()) with check (is_admin());

-- attendance: worker inserts own; supervisor reads/updates in-scope
create policy attendance_worker_insert on attendance for insert
    with check (jwt_worker_id() = worker_id);
create policy attendance_worker_read_own on attendance for select
    using (jwt_worker_id() = worker_id);
create policy attendance_supervisor_select on attendance for select
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = attendance.site_id and project_in_scope(s.project_id)
        )
    );
create policy attendance_supervisor_update on attendance for update
    using (
        is_admin() or exists (
            select 1 from sites s
            where s.id = attendance.site_id and project_in_scope(s.project_id)
        )
    );

-- device_logs: read-only for supervisors in scope; insert by edge functions only
create policy device_logs_supervisor_select on device_logs for select
    using (
        is_admin() or exists (
            select 1 from worker_site_assignments wsa
            join sites s on s.id = wsa.site_id
            where wsa.worker_id = device_logs.worker_id and project_in_scope(s.project_id)
        )
    );

-- audit_log: read-only for admins; writes via service role only.
revoke insert, update, delete on audit_log from authenticated, anon;
create policy audit_log_admin_select on audit_log for select using (is_admin());
