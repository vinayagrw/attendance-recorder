-- Audit log hash chain (M8 hardening, but added now so we don't bolt on later)

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
        digest(
            coalesce(last_hash, '') ||
            coalesce(new.actor_id::text, '') ||
            coalesce(new.action, '') ||
            coalesce(new.target_table, '') ||
            coalesce(new.target_id::text, '') ||
            coalesce(new.before_state::text, '') ||
            coalesce(new.after_state::text, '') ||
            new.created_at::text,
            'sha256'
        ),
        'hex'
    );
    return new;
end $$;

drop trigger if exists audit_log_hash_chain_trg on audit_log;
create trigger audit_log_hash_chain_trg
    before insert on audit_log
    for each row execute function audit_log_hash_chain();
