-- Helper function used by auto-close-shifts cron (M8).
-- See docs/feat-forgotten-punchout.md.

create or replace function open_shifts_for_site(p_site_id uuid, p_local_date date)
returns table (worker_id uuid, last_in_at timestamptz)
language plpgsql stable as $$
declare
    v_tz text;
    v_day_start timestamptz;
    v_day_end timestamptz;
begin
    select timezone into v_tz from sites where id = p_site_id;
    if v_tz is null then v_tz := 'UTC'; end if;
    v_day_start := (p_local_date::timestamp at time zone v_tz);
    v_day_end   := ((p_local_date + 1)::timestamp at time zone v_tz);

    return query
    with ins as (
        select a.worker_id, max(a.punched_at) as last_in_at
        from attendance a
        where a.site_id = p_site_id
          and a.type = 'in'
          and a.punched_at >= v_day_start and a.punched_at < v_day_end
        group by a.worker_id
    ),
    outs as (
        select a.worker_id, max(a.punched_at) as last_out_at
        from attendance a
        where a.site_id = p_site_id
          and a.type = 'out'
          and a.punched_at >= v_day_start and a.punched_at < v_day_end
        group by a.worker_id
    )
    select i.worker_id, i.last_in_at
    from ins i
    left join outs o using (worker_id)
    where o.last_out_at is null or o.last_out_at < i.last_in_at;
end $$;
