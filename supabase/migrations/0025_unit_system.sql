-- Migration 0025 — org-wide display units (metric / imperial).
-- Storage and geofence maths stay in metres; this only drives what the UI
-- shows and accepts. Workers can't read organisations directly, so the
-- value is exposed through a security definer getter.

alter table organisations
    add column if not exists unit_system text not null default 'metric'
        check (unit_system in ('metric', 'imperial'));

create or replace function get_unit_system() returns text
language sql stable security definer set search_path = public as $$
    select coalesce(
        (select unit_system from organisations
         where id = '00000000-0000-0000-0000-000000000001'),
        'metric')
$$;

create or replace function set_unit_system(p_unit_system text) returns text
language plpgsql security definer set search_path = public as $$
declare
    v_before text;
begin
    if not is_admin() then
        raise exception 'Admins only' using errcode = '42501';
    end if;
    if p_unit_system not in ('metric', 'imperial') then
        raise exception 'unit_system must be metric or imperial' using errcode = '22023';
    end if;

    select unit_system into v_before from organisations
    where id = '00000000-0000-0000-0000-000000000001';

    update organisations set unit_system = p_unit_system
    where id = '00000000-0000-0000-0000-000000000001';

    insert into audit_log (actor_id, actor_role, action, target_table, target_id, before_state, after_state)
    values (auth.uid(), 'admin', 'unit_system_update', 'organisations',
            '00000000-0000-0000-0000-000000000001',
            jsonb_build_object('unit_system', v_before),
            jsonb_build_object('unit_system', p_unit_system));

    return p_unit_system;
end
$$;

revoke execute on function get_unit_system() from public, anon;
grant execute on function get_unit_system() to authenticated;
revoke execute on function set_unit_system(text) from public, anon;
grant execute on function set_unit_system(text) to authenticated;
