// Centralised client-side config. Every tunable value lives here.
//
// Defaults are baked in for safety, but each one can be overridden at build
// time via a Vite env var (VITE_*). Document new vars in `.env.example`.
//
// Naming: VITE_<UPPER_SNAKE>. Vite only exposes vars that start with VITE_
// to the client bundle, so secrets must NEVER live here.

interface ViteEnv extends Record<string, unknown> {
  VITE_MOBILE_BREAKPOINT_PX?: string
  VITE_DESKTOP_BREAKPOINT_PX?: string
  VITE_SELFIE_MAX_LONG_EDGE_PX?: string
  VITE_SELFIE_JPEG_QUALITY?: string
  VITE_CAMERA_READY_TIMEOUT_MS?: string
  VITE_GPS_TIMEOUT_MS?: string
  VITE_GPS_MAX_ACCURACY_M?: string
  VITE_TRAFFIC_LOGGER_DEBOUNCE_MS?: string
  VITE_ATTENDANCE_REFETCH_MS?: string
  VITE_PENDING_APPROVALS_REFETCH_MS?: string
  VITE_TRAFFIC_REFETCH_MS?: string
  VITE_FEATURE_FLAG_TTL_MS?: string
}

const env = (import.meta.env as ViteEnv | undefined) ?? {}

function num(key: keyof ViteEnv, fallback: number): number {
  const raw = env[key]
  if (raw === undefined || raw === null || raw === '') return fallback
  const parsed = Number.parseFloat(String(raw))
  return Number.isFinite(parsed) ? parsed : fallback
}

export const APP_CONFIG = {
  // ─── Responsive layout ──────────────────────────────────────────────────

  /** Width (px) below which we render the mobile-optimised narrow layout. */
  MOBILE_BREAKPOINT_PX: num('VITE_MOBILE_BREAKPOINT_PX', 768),

  /** Width (px) at and above which we auto-switch to desktop wide mode. */
  DESKTOP_BREAKPOINT_PX: num('VITE_DESKTOP_BREAKPOINT_PX', 1024),

  // ─── Selfie capture ────────────────────────────────────────────────────

  /** Resize the longest edge to this many px before JPEG-encoding. */
  SELFIE_MAX_LONG_EDGE_PX: num('VITE_SELFIE_MAX_LONG_EDGE_PX', 800),
  /** JPEG quality in [0..1]. 0.7 = good balance for face review. */
  SELFIE_JPEG_QUALITY: num('VITE_SELFIE_JPEG_QUALITY', 0.7),
  /** How long to wait for the camera stream to produce a frame before giving up. */
  CAMERA_READY_TIMEOUT_MS: num('VITE_CAMERA_READY_TIMEOUT_MS', 3_000),

  // ─── Geolocation ────────────────────────────────────────────────────────

  /** Max time (ms) to wait for a GPS fix before showing a soft hint. */
  GPS_TIMEOUT_MS: num('VITE_GPS_TIMEOUT_MS', 10_000),
  /**
   * Client-side preview threshold for "low accuracy" warnings on the punch
   * screen. Server-side enforcement lives in `ATT_MAX_GPS_ACCURACY_M`
   * (Edge Functions config) — keep them in sync for consistent UX.
   */
  GPS_MAX_ACCURACY_M: num('VITE_GPS_MAX_ACCURACY_M', 200),

  // ─── Traffic logger / queries ──────────────────────────────────────────

  TRAFFIC_LOGGER_DEBOUNCE_MS: num('VITE_TRAFFIC_LOGGER_DEBOUNCE_MS', 250),
  ATTENDANCE_REFETCH_MS: num('VITE_ATTENDANCE_REFETCH_MS', 30_000),
  PENDING_APPROVALS_REFETCH_MS: num('VITE_PENDING_APPROVALS_REFETCH_MS', 60_000),
  TRAFFIC_REFETCH_MS: num('VITE_TRAFFIC_REFETCH_MS', 30_000),

  // ─── Caching ────────────────────────────────────────────────────────────

  /** TanStack Query staleTime for feature flags. */
  FEATURE_FLAG_TTL_MS: num('VITE_FEATURE_FLAG_TTL_MS', 5 * 60 * 1000),
}

export type AppConfig = typeof APP_CONFIG
