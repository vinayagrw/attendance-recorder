-- M9 follow-up: the original audit_log_hash_chain function (from 0003) calls
-- digest() from pgcrypto. In Supabase's local stack pgcrypto lives in the
-- `extensions` schema and isn't on the trigger's search_path, so every INSERT
-- into audit_log fails with "function digest(text, unknown) does not exist".
-- This cascaded into the new server-side audit triggers from 0009, which
-- silently broke any UPDATE on workers/sites/projects.
--
-- Fix: replace digest() with the built-in sha256() (Postgres 11+, no extension
-- needed).

create or replace function audit_log_hash_chain() returns trigger
    language plpgsql as $$
declare
    last_hash text;
begin
    select row_hash into last_hash
    from audit_log
    where org_id = new.org_id
    order by created_at desc
    limit 1;

    new.prev_hash := last_hash;
    new.row_hash := encode(
        sha256(
            (
                coalesce(last_hash, '') ||
                coalesce(new.actor_id::text, '') ||
                coalesce(new.action, '') ||
                coalesce(new.target_table, '') ||
                coalesce(new.target_id::text, '') ||
                coalesce(new.before_state::text, '') ||
                coalesce(new.after_state::text, '') ||
                new.created_at::text
            )::bytea
        ),
        'hex'
    );
    return new;
end $$;
