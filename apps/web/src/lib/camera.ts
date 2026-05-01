export interface CapturedSelfie {
  blob: Blob
  dataUrl: string
  widthPx: number
  heightPx: number
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
  await video.play()
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
      setTimeout(onReady, 3_000)
    })
  }
  return stream
}

export function stopStream(stream: MediaStream | null) {
  stream?.getTracks().forEach((t) => t.stop())
}

export async function captureSelfie(
  video: HTMLVideoElement,
  watermark?: { timestamp: string; lat?: number; lng?: number },
  maxLongEdgePx = 800,
  jpegQuality = 0.7,
): Promise<CapturedSelfie> {
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

  return {
    blob,
    dataUrl: canvas.toDataURL('image/jpeg', jpegQuality),
    widthPx: w,
    heightPx: h,
  }
}
