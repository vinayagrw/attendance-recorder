# Feature: Client-side photo compression

**Status:** Approved (drafted in `apps/web/src/lib/camera.ts`)
**Milestone:** M3
**Owner:** Vinay
**Last updated:** 2026-05-01
**Related:** [`../plan.md`](../plan.md) §15 #7, §6 cost estimate

## Goal

Resize and JPEG-compress every selfie *in the browser* before uploading. Target: **≤100 KB per image** with no perceptible loss of detail at supervisor-review thumbnail size.

## Why

- Free-tier Supabase Storage is 1 GB. A naive 3 MB iPhone selfie × 2 punches/day × 100 workers × 30 days = ~18 GB. Compression to ~80 KB makes that ~480 MB — still inside the free tier.
- Mobile-data-conscious workers see a ~4 s upload over 4G drop to <1 s.
- Smaller blobs upload reliably on flaky connectivity (fewer dropped retries).

## User stories

- **As a worker** on a 2G/3G connection, my punch goes through within a couple of seconds; I never see "uploading…" for more than 5 seconds.
- **As an admin** watching Supabase Storage usage, total selfie storage stays under 200 MB at MVP scale (5–10 sites, 50 workers).

## Functional spec

### Compression pipeline (in browser)

1. Capture full-resolution frame from the live camera into an off-screen `<canvas>`. Native resolution depends on phone — typically 720×960 to 1080×1440 for front cameras.
2. **Downscale** to `maxLongEdgePx` (default **800**), preserving aspect ratio. Use bilinear (default canvas) — bicubic is unnecessary at this size.
3. Burn the watermark (see `feat-selfie-watermark.md`).
4. Encode to JPEG via `canvas.toBlob('image/jpeg', quality)` with **quality = 0.7**.
5. If the resulting blob is still > `targetSizeKb` (default 100), recompress at 0.6, then 0.5. Stop at 0.4 — anything lower looks sketchy on faces.
6. Compute `selfieSha256` over the final blob bytes (used by `feat-selfie-metadata-validation.md`).

### Defaults

| Setting | Value | Rationale |
|---|---|---|
| `maxLongEdgePx` | 800 | Plenty for face recognition (post-MVP) and supervisor review. |
| `initialJpegQuality` | 0.7 | Industry sweet-spot. |
| `targetSizeKb` | 100 | Free-tier-friendly. |
| `qualityLadder` | `[0.7, 0.6, 0.5, 0.4]` | Minimum quality before we surrender. |
| `worstCaseMaxKb` | 200 | Hard ceiling — block submit beyond this. |

### Configurable per project (later)

`projects.selfie_compression jsonb default '{"max_long_edge_px": 800, "target_size_kb": 100}'` so a high-security site can crank it up.

### Code

Already drafted in `apps/web/src/lib/camera.ts` under `captureSelfie()`. The quality ladder is the only thing missing — add it:

```ts
async function compressToTarget(
  canvas: HTMLCanvasElement,
  targetKb = 100,
  qualityLadder = [0.7, 0.6, 0.5, 0.4],
): Promise<Blob> {
  for (const q of qualityLadder) {
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', q),
    )
    if (blob.size <= targetKb * 1024) return blob
  }
  // last attempt at lowest quality — submit even if oversized; server side will validate
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/jpeg', 0.4),
  )
}
```

### Server-side guard

`punch-submit` Edge Function rejects blobs > `worstCaseMaxKb` (200 KB) — protects storage from a malformed client.

```ts
if (blob.size > 200 * 1024) {
  return jsonError('Selfie too large after compression — please retry', 413)
}
```

## Edge cases

- **Very low-end Android browsers** (older WebViews): `canvas.toBlob` is slow on Android <8. Fallback: synchronous `canvas.toDataURL()` then convert.
- **Square selfies** from devices that ignore `width: { ideal: 720 }`. Rescale to `maxLongEdgePx` along whichever edge is longer.
- **Bright/dark images** compress to drastically different sizes at the same quality. Don't change defaults — `qualityLadder` handles outliers.
- **Already-compressed source** (some Android cameras pre-compress streams) — recompressing at 0.7 is essentially free; no measurable quality loss in our use case.

## Test plan

| Test | Expectation |
|---|---|
| Capture on iPhone 12 (default camera) | Final blob 60–90 KB. |
| Capture on a low-end Android (640×480 source) | Final blob 30–50 KB; UI doesn't stall > 500 ms. |
| Capture under bright sunlight (overexposed) | Final blob ≤ 100 KB. |
| Capture in dark warehouse | Final blob ≤ 100 KB; `frame_too_dark` flag may fire (separate feature). |
| Synthetic test: render a 1920×1080 noise pattern | Forces quality ladder to step down; ends at acceptable size. |
| Server fault injection: send a 5 MB blob | 413 returned; flag in `device_logs`. |

Add to the existing `apps/web/src/lib/camera.test.ts` (write when M3 starts):

```ts
test('compressToTarget hits ≤100 KB for a 720x960 photographic image', async () => {
  const canvas = await loadFixtureCanvas('fixtures/photo-720x960.jpg')
  const blob = await compressToTarget(canvas, 100)
  expect(blob.size).toBeLessThanOrEqual(100 * 1024)
})
```

## Open questions

1. Should we send a thumbnail (200×200) separately for fast supervisor list-view, in addition to the full 800-px image? Saves dashboard bandwidth on dense days. Defer to M5 once we measure list-view performance.
2. Adopt **WebP** instead of JPEG? ~25 % smaller at same quality, but iOS Safari support before iOS 14 is patchy. JPEG for MVP, revisit when usage analytics show iOS 14+ majority.
