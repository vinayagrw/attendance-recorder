-- M14: missing columns surfaced by field testing.
-- 1. attendance.{selfie_metadata, capture_method, selfie_sha256} — referenced
--    by EditPunch.tsx's select() but never added (only spec'd). Caused
--    "Punch not found" because the select erred out.
-- 2. sites.{daily_note_updated_at, daily_note_updated_by} — referenced by
--    Briefings.tsx update but never added. Updates silently no-op'd.
-- 3. pin_reset_requests.requested_pin — worker chooses desired PIN, supervisor
--    merely approves (was supervisor-sets-PIN; user corrected the model).

alter table attendance
    add column if not exists selfie_metadata jsonb default '{}'::jsonb,
    add column if not exists capture_method text,
    add column if not exists selfie_sha256 text;

alter table sites
    add column if not exists daily_note_updated_at timestamptz,
    add column if not exists daily_note_updated_by uuid references supervisors(id);

alter table pin_reset_requests
    add column if not exists requested_pin text;

-- index attendance.selfie_sha256 so duplicate-selfie checks (post-MVP) can
-- short-circuit cheaply
create index if not exists attendance_selfie_sha256_idx on attendance(selfie_sha256)
    where selfie_sha256 is not null;
