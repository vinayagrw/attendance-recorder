-- M2: replace the custom-claim worker auth with auth.uid()-based RLS
-- now that workers go through standard Supabase Auth.

create or replace function jwt_worker_id() returns uuid
    language sql stable as $$
    select w.id from workers w where w.auth_user_id = auth.uid() limit 1
$$;

-- attendance: worker insert/select policies already reference jwt_worker_id();
-- redefining the function above is enough — no policy changes needed.

-- workers self-read via auth.uid()
drop policy if exists workers_self_read on workers;
create policy workers_self_read on workers for select
    using (auth_user_id = auth.uid());

-- worker_site_assignments: workers can read their own assignments
drop policy if exists wsa_worker_self on worker_site_assignments;
create policy wsa_worker_self on worker_site_assignments for select
    using (worker_id = jwt_worker_id());

-- helpful view for the punch screen: nearest assigned site
create or replace view worker_my_sites as
    select wsa.worker_id, s.id as site_id, s.name, s.default_lat, s.default_lng,
           s.default_radius_m, s.timezone, s.daily_note, s.project_id, wsa.is_primary
    from worker_site_assignments wsa
    join sites s on s.id = wsa.site_id
    where (wsa.valid_to is null or wsa.valid_to > now())
      and wsa.valid_from <= now();
