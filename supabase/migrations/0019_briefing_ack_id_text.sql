-- Migration 0019 — relax attendance.briefing_acknowledged_id to text
--
-- Why
-- ────
-- Briefings currently live as `sites.daily_note` (text) — there's no
-- standalone `site_briefings` table yet. To make the ack auditable AND
-- tamper-evident, the worker UI synthesises an id like
-- `<site_uuid>:<note_length>` so a supervisor can later detect "worker
-- ack'd a 28-char briefing, but the briefing is now 35 chars — note
-- changed after ack". That synthetic id is NOT a uuid, so writing it to
-- a `uuid`-typed column produced:
--     invalid input syntax for type uuid:
--       "22222222-2222-2222-2222-222222222222:28"
-- on every IN punch when a briefing was present.
--
-- Two ways to fix:
--   A. Send only the site_id (a real uuid). Loses the note-length signal.
--   B. Relax the column to text and keep the rich id.
--
-- We pick B — it preserves the tamper signal and is forwards-compatible:
-- when the proper `site_briefings(id uuid)` table eventually lands, real
-- uuids cast to text just fine.
--
-- Safe migration: every existing value is either NULL or a uuid string,
-- and uuid → text is a no-op cast.

alter table attendance
    alter column briefing_acknowledged_id type text using briefing_acknowledged_id::text;

comment on column attendance.briefing_acknowledged_id is
    'Either a uuid (when site_briefings exists) or a synthetic '
    '<site_uuid>:<note_length> identifier. Stored as text so we can carry '
    'either form. See migration 0019 for rationale.';
