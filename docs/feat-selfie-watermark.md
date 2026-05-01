# Feature: Selfie watermark (timestamp + GPS + device fingerprint)

**Status:** Approved (drafted in `apps/web/src/lib/camera.ts`)
**Milestone:** M3
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §15 #8, §14 #9, §17 anti-pattern #6

## Goal

Burn a tamper-evident overlay (timestamp + GPS coords + device-fingerprint short-hash + worker name) into the selfie image *before* it leaves the worker's browser. If a saved/shared selfie is later edited or reused, the visible watermark — and the cryptographic hash we store alongside it — give us forensic value.

## Why

Two reasons:
1. **Operational trust:** when a supervisor reviews a punch, they should see proof on the face of the photo that it was taken at the right time and place. No flipping between metadata fields.
2. **Forensic evidence:** if a wage dispute or fraud allegation reaches HR/legal, an image with a baked-in watermark + a stored SHA-256 of the watermarked bytes is much harder to refute than a metadata claim in a database row.

## User stories

- **As a worker**, I see a small dark strip across the bottom of my captured selfie showing the timestamp and the location dot. It's subtle, doesn't cover my face, and I can submit immediately.
- **As a supervisor**, every selfie thumbnail I review on the dashboard already has the timestamp and GPS visible — I don't have to click into the row to see them.
- **As an auditor / admin**, the stored SHA-256 of the watermarked image is in the `attendance` row; if the file in storage is ever modified, the hash mismatch alarms.

## Functional spec

### What's in the watermark

Bottom strip of the image, ~64–72 px high, semi-transparent black background, white text. Three lines:

```
Line 1:  Ravi Kumar                                  (left)        ✓ Tower A — Whitefield  (right)
Line 2:  2026-05-01 09:14:23 IST                      (left)        12.96988, 77.74997     (right)
Line 3:  dev:a3f7e1   ip:198.51.x.x   id:7c3b2…       (left)
```

Line 1 = worker name + assigned site name.
Line 2 = timestamp in **site's** timezone (not device tz) + GPS to 5 decimals.
Line 3 = first 6 chars of `device_fingerprint` SHA-256, masked IP, first 6 chars of attendance ID. (Attendance ID is unknown until insert — we either inject after or use a client-generated ULID; see "Attendance ID timing" below.)

### Layout rules

- Strip height = `min(72, height * 0.10)` so it scales with image.
- Font: `system-ui, sans-serif`, 14 px (line 1), 13 px (lines 2-3), bold left text, regular right text.
- Background opacity 0.55 — enough to read on any photo, doesn't obliterate dark images.
- **Never overlap the face**: heuristic — if `face-api.js` (post-M3) detects a face whose bounding box `bottom` overlaps the strip area, raise the strip 24 px and shrink the canvas top-padding instead.

### Attendance ID timing

Two viable approaches:

**Option A — client-generated ULID (Recommended).** The client generates a ULID (`01JABCD…`), uses the first 6 chars in the watermark, and submits this as `attendance.id` to the server (RLS allows this). Server validates uniqueness.

**Option B — server-assigned, then re-watermark.** Server inserts row, returns ID, client redraws the watermark, re-uploads. Doubles the upload cost. Avoid.

Going with Option A. Add `ulid` (a small, MIT lib) to `apps/web`.

### Schema deltas

```sql
-- migration 00NN_watermark_columns.sql
alter table attendance add column if not exists watermarked_selfie_sha256 text;
-- (selfie_sha256 from feat-selfie-metadata-validation.md may be the same value if
-- that feature ships first; if both ship together, drop one column.)
```

Note: when `feat-selfie-metadata-validation` is delivered first, `selfie_sha256` already exists; this column is redundant. Reuse `selfie_sha256` and skip the migration.

### Code changes

`apps/web/src/lib/camera.ts` — extend the existing watermark code (already drafted in M0):

```ts
export interface WatermarkInput {
  workerName: string
  siteName: string
  punchedAtIso: string             // formatted in site timezone by caller
  lat: number | null
  lng: number | null
  deviceFingerprintShort: string   // first 6 chars of sha256(visitorId)
  ipAddressMasked: string          // last octet replaced with 'x'
  attendanceIdShort: string        // first 6 chars of ULID
}

// drawWatermark(canvas, input) — see implementation in lib/camera.ts
```

`apps/web/src/routes/worker/Punch.tsx` (M4) calls:

```ts
const ulid = generateUlid()
const watermark: WatermarkInput = {
  workerName: worker.full_name,
  siteName: site.name,
  punchedAtIso: formatInTz(new Date(), site.timezone),
  lat: gps.lat,
  lng: gps.lng,
  deviceFingerprintShort: deviceFingerprint.slice(0, 6),
  ipAddressMasked: maskIp(clientIp),
  attendanceIdShort: ulid.slice(0, 6),
}
const { selfie, metadata } = await captureSelfieWithMetadata(videoEl, watermark)
await submitPunch({ id: ulid, selfie, metadata, /* ... */ })
```

Server (`punch-submit`) computes SHA-256 of the uploaded blob and stores into `selfie_sha256`. If feat-selfie-metadata-validation is shipped, the client also sends its computed hash — server compares the two as a corruption check.

### IP for the watermark

Client doesn't know its real IP (unless we round-trip). Two options:

- **Skip the IP line** for the watermark, store the IP server-side only (current plan).
- **Pre-flight call** to a tiny `/whoami` Edge Function that returns the request IP, then include it in the watermark.

Going with **skip the IP line in the watermark** for v1; the IP is in the database row and visible to supervisors. The watermark stays narrow.

## Edge cases

- **No GPS fix.** Watermark line 2 right-side reads `GPS pending`. The punch row carries `flag_reasons: ['gps_pending']`.
- **Long worker / site names.** Truncate with `…` at 18 chars on each side.
- **RTL languages** (Arabic, Urdu). When site timezone region is RTL, swap the alignment. Tailwind RTL plugin handles the rest of the UI; for canvas, we explicitly choose `ctx.textAlign`.
- **Very dark images.** Increase the strip background opacity to 0.7 if `frame_dark_score < 30` so the white text stays readable.

## Test plan

| Test | Expectation |
|---|---|
| Capture in Chrome at 480×640 | Watermark scales, all 3 lines fit, ≤72 px high. |
| Capture with no GPS permission | Line 2 right reads "GPS pending". |
| Toggle device language to Hindi | Worker name appears in Devanagari, no truncation. |
| Manual file edit (open in Photoshop, save) | Server-stored `selfie_sha256` no longer matches the file's actual hash → admin alert. |
| Capture two punches within 1 sec | Two distinct ULIDs, different `attendanceIdShort` strings on the watermarks. |

## Open questions

1. Make the watermark optional per-site (some clients may not want photos with their site name visible)? Default on; add `sites.disable_watermark boolean default false` only if a customer asks.
2. Add the project's logo to the watermark (right side, 32 px)? Branded, but harder to read on small phones. Skip for MVP.
