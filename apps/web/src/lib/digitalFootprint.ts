// Digital footprint snapshot — every detail the browser will tell us about
// the device + network + locale, used as additional evidence for supervisor
// review of any punch / login. Keep this purely passive: do not request any
// new permissions; whatever the browser doesn't expose, just leave undefined.

export interface DigitalFootprint {
  // browser identity
  userAgent: string
  platform: string | null
  vendor: string | null
  language: string | null
  languages: readonly string[] | null
  // hardware hints
  hardwareConcurrency: number | null
  deviceMemoryGb: number | null
  maxTouchPoints: number | null
  // screen
  screen: {
    width: number
    height: number
    availWidth: number
    availHeight: number
    devicePixelRatio: number
    colorDepth: number
    orientation: string | null
  }
  // viewport (as it stood at capture)
  viewport: { innerWidth: number; innerHeight: number }
  // timezone / locale
  timezone: string | null
  timezoneOffsetMinutes: number
  locale: string | null
  // network
  connection: {
    effectiveType: string | null
    downlinkMbps: number | null
    rttMs: number | null
    saveData: boolean | null
  } | null
  online: boolean
  cookieEnabled: boolean
  doNotTrack: string | null
  // privacy / referrer
  referrer: string | null
  origin: string | null
  pageUrl: string
  // GPU hints (best-effort, requires WebGL — falls back gracefully)
  webgl: { vendor: string | null; renderer: string | null } | null
  // session
  capturedAt: string // ISO
}

interface NavigatorWithDeviceMemory extends Navigator {
  deviceMemory?: number
  connection?: {
    effectiveType?: string
    downlink?: number
    rtt?: number
    saveData?: boolean
  }
}

function readWebgl(): { vendor: string | null; renderer: string | null } | null {
  try {
    const canvas = document.createElement('canvas')
    const gl =
      (canvas.getContext('webgl') as WebGLRenderingContext | null) ??
      (canvas.getContext('experimental-webgl') as WebGLRenderingContext | null)
    if (!gl) return null
    const dbg = gl.getExtension('WEBGL_debug_renderer_info')
    if (!dbg) {
      return { vendor: gl.getParameter(gl.VENDOR) ?? null, renderer: gl.getParameter(gl.RENDERER) ?? null }
    }
    return {
      vendor: gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL) ?? null,
      renderer: gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) ?? null,
    }
  } catch {
    return null
  }
}

export function getDigitalFootprint(): DigitalFootprint {
  const nav = navigator as NavigatorWithDeviceMemory
  const conn = nav.connection
    ? {
        effectiveType: nav.connection.effectiveType ?? null,
        downlinkMbps: nav.connection.downlink ?? null,
        rttMs: nav.connection.rtt ?? null,
        saveData: nav.connection.saveData ?? null,
      }
    : null

  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform ?? null,
    vendor: navigator.vendor ?? null,
    language: navigator.language ?? null,
    languages: navigator.languages ? Object.freeze([...navigator.languages]) : null,
    hardwareConcurrency: navigator.hardwareConcurrency ?? null,
    deviceMemoryGb: nav.deviceMemory ?? null,
    maxTouchPoints: navigator.maxTouchPoints ?? null,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      availWidth: window.screen.availWidth,
      availHeight: window.screen.availHeight,
      devicePixelRatio: window.devicePixelRatio,
      colorDepth: window.screen.colorDepth,
      orientation: window.screen.orientation?.type ?? null,
    },
    viewport: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
    },
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    timezoneOffsetMinutes: new Date().getTimezoneOffset(),
    locale: Intl.DateTimeFormat().resolvedOptions().locale ?? null,
    connection: conn,
    online: navigator.onLine,
    cookieEnabled: navigator.cookieEnabled,
    doNotTrack: navigator.doNotTrack ?? null,
    referrer: document.referrer || null,
    origin: window.location.origin || null,
    pageUrl: window.location.href,
    webgl: readWebgl(),
    capturedAt: new Date().toISOString(),
  }
}

// Compact JSON-safe variant (drops Object.freeze on languages so it serialises cleanly)
export function getDigitalFootprintJSON(): Record<string, unknown> {
  const fp = getDigitalFootprint()
  return JSON.parse(JSON.stringify(fp))
}
