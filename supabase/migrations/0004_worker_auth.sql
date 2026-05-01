-- M2: link workers to auth.users so we can use Supabase Auth's standard
-- signInWithPassword flow instead of building a custom JWT minter.
-- Synthetic email format: '<worker_uuid>@worker.local'.
-- Password is constructed client-side as (pin + worker_uuid_suffix) so a
-- short 4-6 digit PIN can satisfy Auth's minimum password length.

alter table workers
    add column if not exists auth_user_id uuid references auth.users(id) on delete set null;

create index if not exists workers_auth_user_idx on workers(auth_user_id);
