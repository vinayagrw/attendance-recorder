-- Migration 0017 — projects.address + site-traffic monitoring + GPS-tolerance bump
--
-- Adds:
--   1. projects.address text          — full mailing/site address per project
--   2. access_events table             — every login / page-view / logout, with
--      automatic IP capture via PostgREST request headers
--   3. RLS so anon clients can INSERT (so anon page-views are logged) but only
--      supervisors/admins can SELECT
--   4. Helper RPC list_recent_traffic() — joins access_events with the
--      worker/supervisor display name so the /admin/traffic page is one query

-- ─────────────────────────────────────────────────────────────────────────
-- 1. projects.address
-- ─────────────────────────────────────────────────────────────────────────
alter table projects
    add column if not exists address text;

-- ─────────────────────────────────────────────────────────────────────────
-- 2. access_events — site traffic / browsing log
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists access_events (
    id uuid primary key default gen_random_uuid(),
    org_id uuid not null default '00000000-0000-0000-0000-000000000001'
        references organisations(id),
    occurred_at timestamptz not null default now(),

    -- WHO
    actor_type text not null
        check (actor_type in ('worker','supervisor','admin','anon')),
    actor_id uuid,            -- worker.id OR supervisor.id (nullable for anon)
    actor_label text,         -- "Ravi Kumar" / "viagr@ciklum.com" / NULL

    -- WHAT
    event_type text not null
        check (event_type in (
            'page_view','login','login_fail','logout','register','pin_request'
        )),
    route text,               -- e.g. '/worker/punch', '/admin/projects'
    referrer text,

    -- DEVICE / NETWORK
    ip_address inet,          -- auto-filled by trigger from x-forwarded-for
    user_agent text,
    device_fingerprint text,

    -- EXTENDED CONTEXT (digital footprint snapshot)
    metadata jsonb not null default '{}',

    created_at timestamptz not null default now()
);
create index if not exists access_events_time_idx on access_events(occurred_at desc);
create index if not exists access_events_actor_idx on access_events(actor_type, actor_id);
create index if not exists access_events_event_idx on access_events(event_type);
create index if not exists access_events_ip_idx on access_events(ip_address);

-- ─────────────────────────────────────────────────────────────────────────
-- 3. Auto-fill IP address from PostgREST x-forwarded-for header
-- ─────────────────────────────────────────────────────────────────────────
create or replace function ip_from_request() returns inet
language plpgsql stable as $$
declare
    ip text;
begin
    begin
        ip := current_setting('request.headers', true)::json->>'x-forwarded-for';
    exception when others then
        ip := null;
    end;
    if ip is null or ip = '' then return null; end if;
    -- x-forwarded-for is a comma-separated list — take the first
    begin
        return split_part(ip, ',', 1)::inet;
    exception when others then
        return null;
    end;
end;
$$;

create or replace function trg_set_access_event_ip() returns trigger
language plpgsql as $$
begin
    if new.ip_address is null then
        new.ip_address := ip_from_request();
    end if;
    return new;
end;
$$;

drop trigger if exists set_ip_before_insert on access_events;
create trigger set_ip_before_insert
    before insert on access_events
    for each row execute function trg_set_access_event_ip();

-- ─────────────────────────────────────────────────────────────────────────
-- 4. RLS — anon may INSERT only; supervisors may SELECT all
-- ─────────────────────────────────────────────────────────────────────────
alter table access_events enable row level security;

drop policy if exists "anon can insert access events" on access_events;
-- Keep as `to public` (no role clause) so the policy applies to every role,
-- mirroring `pin_reset_anon_insert` which works the same way. The
-- supervisors-only SELECT policy still gates reading rows back, so anon
-- callers must NOT send `Prefer: return=representation`.
create policy "anon can insert access events"
    on access_events for insert
    with check (true);

drop policy if exists "supervisors read access events" on access_events;
create policy "supervisors read access events"
    on access_events for select
    to authenticated
    using (is_supervisor() or is_admin());

-- ─────────────────────────────────────────────────────────────────────────
-- 5. RPC: list_recent_traffic — supervisor dashboard convenience
--    Joins to worker.full_name / supervisor display so the UI doesn't
--    have to make N+1 queries.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function list_recent_traffic(
    p_limit int default 200,
    p_event_type text default null,
    p_actor_type text default null,
    p_since timestamptz default null
) returns table (
    id uuid,
    occurred_at timestamptz,
    actor_type text,
    actor_id uuid,
    actor_label text,
    event_type text,
    route text,
    ip_address inet,
    user_agent text,
    device_fingerprint text,
    referrer text,
    metadata jsonb,
    is_known boolean
) language sql security definer set search_path = public as $$
    select
        e.id, e.occurred_at, e.actor_type, e.actor_id,
        coalesce(
            e.actor_label,
            case e.actor_type
                when 'worker' then (select w.full_name from workers w where w.id = e.actor_id)
                when 'supervisor' then (select s.full_name from supervisors s where s.id = e.actor_id)
                when 'admin' then (select s.full_name from supervisors s where s.id = e.actor_id)
                else null
            end
        ) as actor_label,
        e.event_type, e.route, e.ip_address, e.user_agent,
        e.device_fingerprint, e.referrer, e.metadata,
        (e.actor_id is not null) as is_known
    from access_events e
    where (p_event_type is null or e.event_type = p_event_type)
      and (p_actor_type is null or e.actor_type = p_actor_type)
      and (p_since      is null or e.occurred_at >= p_since)
    order by e.occurred_at desc
    limit greatest(p_limit, 1);
$$;

revoke all on function list_recent_traffic(int, text, text, timestamptz) from public;
grant execute on function list_recent_traffic(int, text, text, timestamptz) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6. RPC: traffic_summary — counts for the dashboard chips
-- ─────────────────────────────────────────────────────────────────────────
create or replace function traffic_summary(
    p_since timestamptz default (now() - interval '24 hours')
) returns table (
    total bigint,
    logins bigint,
    failed_logins bigint,
    page_views bigint,
    unknown_traffic bigint,
    unique_ips bigint,
    unique_fingerprints bigint
) language sql security definer set search_path = public as $$
    select
        count(*) as total,
        count(*) filter (where event_type = 'login') as logins,
        count(*) filter (where event_type = 'login_fail') as failed_logins,
        count(*) filter (where event_type = 'page_view') as page_views,
        count(*) filter (where actor_id is null) as unknown_traffic,
        count(distinct ip_address) as unique_ips,
        count(distinct device_fingerprint) as unique_fingerprints
    from access_events
    where occurred_at >= p_since;
$$;

revoke all on function traffic_summary(timestamptz) from public;
grant execute on function traffic_summary(timestamptz) to authenticated;
