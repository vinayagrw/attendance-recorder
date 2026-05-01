export interface CapturedSelfie {
  blob: Blob
  dataUrl: string
  widthPx: number
  heightPx: number
}

export async function startSelfieStream(
  video: HTMLVideoElement,
): Promise<MediaStream> {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 720 }, height: { ideal: 960 } },
    audio: false,
  })
  video.srcObject = stream
  await video.play()
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
  const scale = Math.min(1, maxLongEdgePx / Math.max(srcW, srcH))
  const w = Math.round(srcW * scale)
  const h = Math.round(srcH * scale)

  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
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

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
      'image/jpeg',
      jpegQuality,
    )
  })

  return {
    blob,
    dataUrl: canvas.toDataURL('image/jpeg', jpegQuality),
    widthPx: w,
    heightPx: h,
  }
}
