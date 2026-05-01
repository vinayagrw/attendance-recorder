# Feature: Selfie metadata cross-validation

**Status:** Proposed
**Milestone:** M4 (extends the punch-submit Edge Function shipped in M2 stub)
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §15 #15 (buddy-punch heuristic), §19a #23 (mock-GPS detection), §17 anti-pattern #6 (photo theatre)

## Goal

Capture rich metadata at the moment of selfie capture and cross-validate it against the device fingerprint and GPS already captured. Catch the most common spoof: a worker uploading a *previously-taken* selfie (saved file, screenshot, photo of a photo) instead of capturing live from the camera.

## Why

Today the system trusts that a selfie POSTed to `punch-submit` came from the live camera stream. It doesn't actually. A motivated worker could:
1. Take a selfie weeks ago, save it, and re-submit on punch day from a different device.
2. Screenshot another worker's verified attendance selfie.
3. Photograph a printed photo held up to the lens.

Connecteam ships "selfie capture but no validation" — a placebo control that 2026 buyers see through. We will not. Even before we un-mock the face-match score (post-MVP), we can flag obviously-wrong submissions using metadata that's free to collect.

## User stories

- **As a worker**, I see no extra UX — capture and submit work exactly as before.
- **As a supervisor**, when reviewing a flagged punch, I see *why* it was flagged: "Image dimensions don't match this device's typical capture", "GPS in metadata is 50 km from punch GPS", "EXIF DateTimeOriginal is 3 days old".
- **As an admin**, I can tune the flag thresholds per project (some projects accept lower-quality selfies than others).

## Functional spec

### Metadata captured at the moment of selfie

In the browser, alongside the existing `selfieDataUrl`:

| Field | Source | Notes |
|---|---|---|
| `capture_method` | `'live_camera' \| 'file_picker'` | Enforce live-camera path; reject `file_picker` for the punch flow. |
| `video_resolution` | `videoWidth × videoHeight` from the `<video>` element | The camera-native resolution before our compression. |
| `compressed_dimensions` | `width × height` after `camera.ts` resizes | Sanity check vs `video_resolution`. |
| `device_pixel_ratio` | `window.devicePixelRatio` | Helps fingerprint the device class. |
| `capture_started_at` | `performance.now()` when stream opened | |
| `capture_ended_at` | `performance.now()` when canvas frame drawn | |
| `capture_duration_ms` | computed | Should be ≥ 200 ms (no human captures faster). Flag if < 100 ms. |
| `frame_dark_score` | mean luminance from a 32×32 thumbnail | Pure-black frames = lens covered or stream stopped. |
| `frame_blur_score` | Laplacian variance on a 32×32 thumbnail | Below threshold = blurry. |
| `media_track_settings` | `track.getSettings()` | `facingMode`, `frameRate`, `aspectRatio`, `deviceId` (if exposed). |
| `media_track_label` | `track.label` | e.g. "Front Camera" — fingerprintable. |
| `user_agent_camera_label_combo` | hashed | Stable per device-camera pairing. |

### Server-side cross-validation rules (in `punch-submit`)

Each rule may add a flag string to `attendance.flag_reasons`. Multiple flags allowed.

| Rule | Adds flag | Trigger |
|---|---|---|
| Capture method check | `not_live_camera` | `capture_method !== 'live_camera'`. Auto-reject (4xx). |
| Capture duration sanity | `instant_capture` | `capture_duration_ms < 100`. |
| Resolution sanity | `dimension_mismatch` | `compressed_dimensions` larger than `video_resolution`. |
| Dark frame | `frame_too_dark` | `frame_dark_score < 18` (out of 255). |
| Blur | `frame_too_blurry` | `frame_blur_score < 100` (Laplacian variance threshold). |
| Track label drift | `camera_label_changed` | `user_agent_camera_label_combo` differs from baseline. |
| EXIF GPS mismatch | `metadata_gps_mismatch` | If EXIF has GPS coords, distance from `gps.lat/lng` > 100 m. |
| EXIF DateTimeOriginal mismatch | `metadata_timestamp_stale` | If EXIF has a timestamp, distance from `now` > 5 minutes. |
| Stored selfie hash collision | `duplicate_selfie` | SHA-256 of compressed JPEG matches any prior selfie for this worker in last 30 days. |

> Note on EXIF: photos taken via `getUserMedia` + `canvas.toBlob` typically strip EXIF. EXIF-bearing photos arriving here are a strong signal of *not* live capture. Flag, don't trust the EXIF — but the *presence* is itself the signal.

### Schema changes

```sql
-- migration 00NN_selfie_metadata.sql
alter table attendance add column if not exists selfie_metadata jsonb default '{}';
alter table attendance add column if not exists selfie_sha256 text;
alter table attendance add column if not exists capture_method text
    check (capture_method in ('live_camera','file_picker','unknown'))
    default 'unknown';

create index if not exists attendance_selfie_hash on attendance(selfie_sha256)
    where selfie_sha256 is not null;

-- store the device's "camera fingerprint" on workers for drift detection
alter table workers add column if not exists baseline_camera_label_hash text;
```

### Edge Function changes

`supabase/functions/punch-submit/index.ts` request body grows:

```ts
interface PunchBody {
  // existing fields…
  selfieMetadata: {
    captureMethod: 'live_camera' | 'file_picker'
    videoResolution: { w: number; h: number }
    compressedDimensions: { w: number; h: number }
    devicePixelRatio: number
    captureDurationMs: number
    frameDarkScore: number
    frameBlurScore: number
    mediaTrackLabel: string
    cameraLabelHash: string         // sha256(userAgent + mediaTrackLabel)
    selfieSha256: string             // sha256 of the compressed JPEG bytes
    exifGps?: { lat: number; lng: number } | null
    exifDateTimeOriginal?: string | null
  }
}
```

Rule application order: hard rejects first (`not_live_camera`), then flag-only rules. The function inserts the row with `status = 'flagged'` if any flag fired.

### Client changes

In `apps/web/src/lib/camera.ts`, extend `captureSelfie()`:

```ts
export async function captureSelfieWithMetadata(
  video: HTMLVideoElement,
  watermark: WatermarkInput,
): Promise<{ selfie: CapturedSelfie; metadata: SelfieMetadata }> {
  const captureStartMs = performance.now()
  const settings = video.srcObject instanceof MediaStream
    ? video.srcObject.getVideoTracks()[0]?.getSettings()
    : undefined
  const trackLabel = (video.srcObject as MediaStream)?.getVideoTracks()[0]?.label ?? ''

  // Pull a 32x32 thumbnail for dark/blur analysis BEFORE drawing the full frame.
  const { darkScore, blurScore } = await analyseThumb(video)

  const selfie = await captureSelfie(video, watermark)
  const captureEndMs = performance.now()

  const cameraLabelHash = await sha256Hex(navigator.userAgent + '|' + trackLabel)
  const selfieSha256 = await sha256HexBlob(selfie.blob)

  return {
    selfie,
    metadata: {
      captureMethod: 'live_camera',
      videoResolution: { w: video.videoWidth, h: video.videoHeight },
      compressedDimensions: { w: selfie.widthPx, h: selfie.heightPx },
      devicePixelRatio: window.devicePixelRatio,
      captureDurationMs: Math.round(captureEndMs - captureStartMs),
      frameDarkScore: darkScore,
      frameBlurScore: blurScore,
      mediaTrackLabel: trackLabel,
      cameraLabelHash,
      selfieSha256,
      exifGps: null,           // canvas.toBlob strips EXIF; if we ever accept uploads, parse here
      exifDateTimeOriginal: null,
    },
  }
}
```

### Camera fingerprint baseline

On worker registration, store `cameraLabelHash` to `workers.baseline_camera_label_hash`. Future punches compare against it; supervisor sees `camera_label_changed` flag if drift.

## Edge cases

- **iOS Safari** sometimes returns empty `track.label` for privacy. Treat empty as "no fingerprint contribution" — don't flag if both baseline and current are empty.
- **Front and rear camera switch** legitimately changes label. UI should not allow this on the punch screen (force `facingMode: 'user'`). If it happens anyway, flag.
- **Browser update** can change UA string → `cameraLabelHash` shifts → would falsely flag every worker after a Chrome update. Mitigation: store the *track label only* hash separately and prefer it over the UA-combined one when comparing.
- **Worker gets a new phone**: legitimate flag, supervisor approves once and we accept the new baseline. Add an admin action `Reset camera baseline`.

## Test plan

| Test | Expectation |
|---|---|
| Capture via live camera in Chrome desktop | All metadata populated; no flags. |
| Save selfie blob, reload page, re-submit the saved blob | `not_live_camera` flag fires. |
| Cover camera lens during capture | `frame_too_dark` flag fires. |
| Capture in motion (shake phone) | `frame_too_blurry` flag fires (probabilistic). |
| Submit twice in <30 days with the *same* image bytes | second one gets `duplicate_selfie`. |
| Open punch screen on a *different* phone after registering on phone A | `camera_label_changed` flag fires. |

Manual: Chrome DevTools → Sources → throttle CPU + simulate "Disabled" video device, ensure UI surfaces a clean error.

## Open questions

1. Reject (4xx) `not_live_camera`, or accept-and-flag? Recommendation: reject — there's no legit reason for it on the punch screen.
2. Store `selfie_metadata` as raw `jsonb`, or extract specific columns? `jsonb` keeps schema flexible while we iterate; columnar later if reporting needs it.
3. Should `frame_dark_score` / `frame_blur_score` thresholds be per-site? Sites in low light (warehouses, night shifts) need looser thresholds. Add `sites.selfie_quality_overrides jsonb` if real complaints arrive.
