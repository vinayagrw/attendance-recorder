import { APP_CONFIG } from '@/config/app'

export interface CapturedSelfie {
  blob: Blob
  dataUrl: string
  widthPx: number
  heightPx: number
  byteSize: number
  mimeType: string
  sha256: string | null
  captureMs: number
  watermarked: boolean
  cameraTrack: {
    label: string | null
    deviceId: string | null
    facingMode: string | null
    width: number | null
    height: number | null
    frameRate: number | null
    aspectRatio: number | null
  } | null
}

async function sha256Hex(blob: Blob): Promise<string | null> {
  if (!('crypto' in window) || !crypto.subtle) return null
  try {
    const buf = await blob.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    return [...new Uint8Array(digest)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  } catch {
    return null
  }
}

function readTrackInfo(video: HTMLVideoElement): CapturedSelfie['cameraTrack'] {
  const stream = video.srcObject as MediaStream | null
  if (!stream) return null
  const track = stream.getVideoTracks()[0]
  if (!track) return null
  const settings = (track.getSettings ? track.getSettings() : {}) as MediaTrackSettings
  return {
    label: track.label || null,
    deviceId: settings.deviceId ?? null,
    facingMode: settings.facingMode ?? null,
    width: settings.width ?? null,
    height: settings.height ?? null,
    frameRate: settings.frameRate ?? null,
    aspectRatio: settings.aspectRatio ?? null,
  }
}

export async function startSelfieStream(
  video: HTMLVideoElement,
): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error(
      'Camera not available in this browser. Use Chrome / Safari / Edge on a device with a front camera.',
    )
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
    audio: false,
  })
  video.srcObject = stream
  // play() can reject with AbortError when the component unmounts (or the
  // user clicks Retry) while the promise is still pending. That's noise,
  // not a real failure — the cleanup will close the stream cleanly. We
  // only surface real errors (NotAllowed, NotReadable, etc.).
  try {
    await video.play()
  } catch (e) {
    const name = (e as Error).name
    if (name === 'AbortError' || name === 'AbortError ') {
      // benign — outer caller's cancelled flag will skip the rest
      return stream
    }
    throw e
  }
  // play() resolves when playback starts, but videoWidth/Height may still be 0
  // for a few frames. Wait for actual data so capture doesn't fail with the
  // cryptic "toBlob failed" error.
  if (video.readyState < 2 /* HAVE_CURRENT_DATA */) {
    await new Promise<void>((resolve) => {
      const onReady = () => {
        video.removeEventListener('loadeddata', onReady)
        video.removeEventListener('canplay', onReady)
        resolve()
      }
      video.addEventListener('loadeddata', onReady, { once: true })
      video.addEventListener('canplay', onReady, { once: true })
      // Hard timeout so we don't hang forever on a stuck device
      setTimeout(onReady, APP_CONFIG.CAMERA_READY_TIMEOUT_MS)
    })
  }
  return stream
}

/**
 * Cleanly tear down a selfie stream + the video element it was attached to.
 * Pausing + nulling srcObject BEFORE stopping tracks avoids the
 *   "play() request was interrupted by a new load request"
 * console warning when React StrictMode re-mounts the component.
 */
export function stopStream(
  stream: MediaStream | null,
  video?: HTMLVideoElement | null,
) {
  if (video) {
    try { video.pause() } catch { /* fine if play() never started */ }
    video.srcObject = null
  }
  stream?.getTracks().forEach((t) => t.stop())
}

export async function captureSelfie(
  video: HTMLVideoElement,
  watermark?: { timestamp: string; lat?: number; lng?: number },
  maxLongEdgePx: number = APP_CONFIG.SELFIE_MAX_LONG_EDGE_PX,
  jpegQuality: number = APP_CONFIG.SELFIE_JPEG_QUALITY,
): Promise<CapturedSelfie> {
  const t0 = performance.now()
  const trackInfo = readTrackInfo(video)
  const srcW = video.videoWidth
  const srcH = video.videoHeight

  // Defensive: if the video stream isn't producing frames yet, fail with a
  // human-readable error instead of letting toBlob fail silently downstream.
  if (!srcW || !srcH || video.readyState < 2) {
    throw new Error(
      'Camera not ready yet — please wait a moment and try again. (If it persists, reload the page and grant camera permission.)',
    )
  }

  const scale = Math.min(1, maxLongEdgePx / Math.max(srcW, srcH))
  const w = Math.max(1, Math.round(srcW * scale))
  const h = Math.max(1, Math.round(srcH * scale))

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('Browser cannot create a 2D canvas — unsupported environment.')
  }
  ctx.drawImage(video, 0, 0, w, h)

  if (watermark) {
    const lines = [
      watermark.timestamp,
      watermark.lat != null && watermark.lng != null
        ? `${watermark.lat.toFixed(5)}, ${watermark.lng.toFixed(5)}`
        : 'GPS unavailable',
    ]
    const padding = 8
    const lineH = 18
    const boxH = lineH * lines.length + padding * 2
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    ctx.fillRect(0, h - boxH, w, boxH)
    ctx.fillStyle = '#ffffff'
    ctx.font = '14px system-ui, sans-serif'
    ctx.textBaseline = 'top'
    lines.forEach((line, i) => {
      ctx.fillText(line, padding, h - boxH + padding + i * lineH)
    })
  }

  // Try JPEG first, fall back to PNG if the browser refuses (very old WebViews).
  const blob: Blob = await new Promise((resolve, reject) => {
    let attempted = false
    const tryEncode = (mime: string, quality?: number) => {
      canvas.toBlob(
        (b) => {
          if (b) return resolve(b)
          if (!attempted) {
            attempted = true
            // PNG is mandatory in the spec — try as fallback
            return canvas.toBlob(
              (png) =>
                png
                  ? resolve(png)
                  : reject(
                      new Error(
                        `Could not encode selfie (${mime} + image/png both failed). Try a different browser.`,
                      ),
                    ),
              'image/png',
            )
          }
          reject(new Error(`Could not encode selfie as ${mime}.`))
        },
        mime,
        quality,
      )
    }
    tryEncode('image/jpeg', jpegQuality)
  })

  const dataUrl = canvas.toDataURL('image/jpeg', jpegQuality)
  const sha256 = await sha256Hex(blob)

  return {
    blob,
    dataUrl,
    widthPx: w,
    heightPx: h,
    byteSize: blob.size,
    mimeType: blob.type || 'image/jpeg',
    sha256,
    captureMs: Math.round(performance.now() - t0),
    watermarked: !!watermark,
    cameraTrack: trackInfo,
  }
}
