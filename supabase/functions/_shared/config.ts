// Shared config for Edge Functions. Pure Deno — no DB, no fetch.
//
// Every threshold reads from an env var with a sensible default, so ops can
// tune behaviour per-env (local / staging / prod) without redeploying code.
//
// Env naming convention: ATT_<NAME> ("ATT" = ATTendance) — flat, all-caps,
// no nesting. Set them in `supabase/.env`, in the Edge Functions dashboard,
// or via `npx supabase secrets set ATT_MAX_GPS_ACCURACY_M=100`.
//
// All numeric values are parsed once at module load. Invalid / missing
// values fall through to the default — never crash the function.

function num(envName: string, fallback: number): number {
  const raw = Deno.env.get(envName)
  if (!raw) return fallback
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(envName: string, fallback: boolean): boolean {
  const raw = Deno.env.get(envName)
  if (!raw) return fallback
  const v = raw.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export const ATTENDANCE_CONFIG = {
  // ─── Anomaly thresholds (used by punch-submit) ─────────────────────────

  /** Max GPS accuracy radius (m). Above this, flag `low_gps_accuracy`. */
  MAX_GPS_ACCURACY_M: num('ATT_MAX_GPS_ACCURACY_M', 100),

  /** Speed (m/s) above which the worker is "in motion" — likely driving. */
  DRIVING_THRESHOLD_MS: num('ATT_DRIVING_THRESHOLD_MS', 8 / 3.6), // 8 km/h

  /** Speed (m/s) considered physically impossible — likely GPS spoof. */
  IMPLAUSIBLE_SPEED_MS: num('ATT_IMPLAUSIBLE_SPEED_MS', 33), // 120 km/h

  /**
   * `geofence_far` flag fires when distance > this threshold AND
   * distance > GPS accuracy (so a fuzzy fix doesn't false-flag).
   */
  GEOFENCE_FAR_THRESHOLD_M: num('ATT_GEOFENCE_FAR_THRESHOLD_M', 30),

  /** How far back to scan for buddy-punch (same fingerprint, different worker). */
  BUDDY_PUNCH_WINDOW_HRS: num('ATT_BUDDY_PUNCH_WINDOW_HRS', 12),

  // ─── Storage ────────────────────────────────────────────────────────────

  /** Bucket where selfies go. Override only if you migrate buckets. */
  SELFIES_BUCKET: Deno.env.get('ATT_SELFIES_BUCKET') ?? 'selfies',

  // ─── PIN policy (used by worker-pin-reset / worker-register) ───────────

  /** Min PIN length. Workers below this get rejected at register. */
  MIN_PIN_LENGTH: num('ATT_MIN_PIN_LENGTH', 4),
  /** Max PIN length (defensive). */
  MAX_PIN_LENGTH: num('ATT_MAX_PIN_LENGTH', 6),

  // ─── Feature toggles ───────────────────────────────────────────────────

  /** Enable/disable the auto access_events emit on punch (M15). */
  EMIT_PUNCH_ACCESS_EVENT: bool('ATT_EMIT_PUNCH_ACCESS_EVENT', true),
}

export type AttendanceConfig = typeof ATTENDANCE_CONFIG
