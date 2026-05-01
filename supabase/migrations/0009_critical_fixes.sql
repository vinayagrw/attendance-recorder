-- M9: critical fixes from the M0–M8 code review (see plan.md §21).
-- 1. Helper functions marked SECURITY DEFINER so RLS doesn't infinitely recurse
-- 2. Anon-readable worker pick-list via SECURITY DEFINER RPC
-- 3. Supervisor (non-admin) approval policy on workers
-- 4. Server-side audit log triggers (replaces client-side inserts that were
--    silently denied by `revoke insert on audit_log`)
-- 5. Auto-ban auth user on worker offboarding
-- 6. Briefing acknowledgement column

-- ────────────────────────────────────────────────────────────────────────
-- 1. Make RLS helpers SECURITY DEFINER so they don't re-trigger RLS on the
--    tables they query. Without this, jwt_worker_id() (which queries workers)
--    causes infinite recursion when called from a workers policy.
-- ────────────────────────────────────────────────────────────────────────
create or replace function jwt_worker_id() returns uuid
    language sql stable security definer set search_path = public as $$
    select w.id from workers w where w.auth_user_id = auth.uid() limit 1
$$;

create or replace function is_admin() returns boolean
    language sql stable security definer set search_path = public as $$
    select exists (select 1 from supervisors s where s.id = auth.uid() and s.role = 'admin')
$$;

create or replace function is_supervisor() returns boolean
    language sql stable security definer set search_path = public as $$
    select exists (select 1 from supervisors s where s.id = auth.uid())
$$;

create or replace function project_in_scope(p_project_id uuid) returns boolean
    language sql stable security definer set search_path = public as $$
    select exists (
        select 1 from supervisors s
        where s.id = auth.uid()
        and (s.role = 'admin' or p_project_id = any(s.scope_project_ids))
    )
$$;

-- ────────────────────────────────────────────────────────────────────────
-- 2. Anon-readable worker pick-list (login + register dropdowns).
-- ────────────────────────────────────────────────────────────────────────
create or replace function list_active_workers()
returns table (id uuid, full_name text, status text)
    language sql stable security definer set search_path = public as $$
    select id, full_name, status
    from workers
    where status in ('invited', 'pending_approval', 'active')
    order by full_name;
$$;
grant execute on function list_active_workers() to anon, authenticated;

-- ────────────────────────────────────────────────────────────────────────
-- 3. Allow non-admin supervisors to approve workers in their project scope.
--    The existing workers_admin_write policy still covers admins (OR'd).
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists workers_supervisor_approve on workers;
create policy workers_supervisor_approve on workers for update
    using (
        is_supervisor() and exists (
            select 1 from worker_site_assignments wsa
            join sites s on s.id = wsa.site_id
            where wsa.worker_id = workers.id and project_in_scope(s.project_id)
        )
    )
    with check (
        is_supervisor() and exists (
            select 1 from worker_site_assignments wsa
            join sites s on s.id = wsa.site_id
            where wsa.worker_id = workers.id and project_in_scope(s.project_id)
        )
    );

-- ────────────────────────────────────────────────────────────────────────
-- 4. Server-side audit log triggers — replaces silently-denied client INSERTs.
--    Triggers run as the function owner (postgres via SECURITY DEFINER) so
--    they bypass RLS on audit_log without needing to grant INSERT to
--    authenticated.
-- ────────────────────────────────────────────────────────────────────────
create or replace function trg_audit_changes() returns trigger
    language plpgsql security definer set search_path = public as $$
declare
    v_actor_id uuid := auth.uid();
    v_actor_role text;
    v_target_id uuid;
begin
    select role into v_actor_role from supervisors where id = v_actor_id;

    if TG_OP = 'DELETE' then
        v_target_id := (old).id;
    else
        v_target_id := (new).id;
    end if;

    insert into audit_log (
        actor_id, actor_role, action, target_table, target_id, before_state, after_state
    ) values (
        v_actor_id,
        coalesce(v_actor_role, 'system'),
        lower(TG_OP) || '_' || TG_TABLE_NAME,
        TG_TABLE_NAME,
        v_target_id,
        case TG_OP when 'INSERT' then null else to_jsonb(old) end,
        case TG_OP when 'DELETE' then null else to_jsonb(new) end
    );

    return case TG_OP when 'DELETE' then old else new end;
end $$;

drop trigger if exists workers_audit on workers;
create trigger workers_audit
    after insert or update or delete on workers
    for each row execute function trg_audit_changes();

drop trigger if exists attendance_audit on attendance;
create trigger attendance_audit
    after update or delete on attendance
    for each row execute function trg_audit_changes();

drop trigger if exists sites_audit on sites;
create trigger sites_audit
    after insert or update or delete on sites
    for each row execute function trg_audit_changes();

drop trigger if exists projects_audit on projects;
create trigger projects_audit
    after insert or update or delete on projects
    for each row execute function trg_audit_changes();

-- ────────────────────────────────────────────────────────────────────────
-- 5. Auto-ban auth user when worker is offboarded.
-- ────────────────────────────────────────────────────────────────────────
create or replace function trg_worker_offboard_ban() returns trigger
    language plpgsql security definer set search_path = public, auth as $$
begin
    if new.status = 'offboarded'
       and (old.status is null or old.status <> 'offboarded')
       and new.auth_user_id is not null
    then
        update auth.users
            set banned_until = 'infinity'::timestamptz
            where id = new.auth_user_id;
    end if;

    if new.status <> 'offboarded'
       and old.status = 'offboarded'
       and new.auth_user_id is not null
    then
        update auth.users
            set banned_until = null
            where id = new.auth_user_id;
    end if;

    return new;
end $$;

drop trigger if exists worker_offboard_ban on workers;
create trigger worker_offboard_ban
    after update on workers
    for each row execute function trg_worker_offboard_ban();

-- ────────────────────────────────────────────────────────────────────────
-- 6. Briefing acknowledgement column on attendance (feat-site-of-day-briefing.md)
-- ────────────────────────────────────────────────────────────────────────
alter table attendance
    add column if not exists briefing_acknowledged_id uuid;
