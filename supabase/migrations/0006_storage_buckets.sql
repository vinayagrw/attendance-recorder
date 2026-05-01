-- Storage buckets for selfies (worker faces) and site reports.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('selfies', 'selfies', false, 500000, array['image/jpeg', 'image/png']),
  ('site-reports', 'site-reports', false, 5000000, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Workers can read their own selfies. Supervisors / admin read via API.
create policy "selfies_owner_read" on storage.objects for select
  using (
    bucket_id = 'selfies'
    and (
      -- worker reading their own folder (folder is the worker uuid)
      (split_part(name, '/', 1))::text in (
        select w.id::text from workers w where w.auth_user_id = auth.uid()
      )
      or
      -- supervisor/admin reading any selfie within their scope
      exists (
        select 1 from supervisors s where s.id = auth.uid()
      )
    )
  );

-- Workers cannot write directly; uploads go through Edge Functions which use
-- the service role. No INSERT/UPDATE/DELETE policies for authenticated role.
