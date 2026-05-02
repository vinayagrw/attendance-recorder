// Structured stderr logging for Edge Functions.
//
// `supabase functions logs <name> --tail` surfaces everything written to
// console.error / console.log on the cloud project. We emit JSON lines so
// future log shippers (Logflare / Datadog) can parse them without a regex.
//
// Levels:
//   logError(err, ctx) → console.error → shows up as level=error in tail
//   logWarn(msg,  ctx) → console.warn  → for soft-failures we still served
//   logInfo(msg,  ctx) → console.log   → for milestone events on success
//
// PII discipline (matches docs/feat-selfie-storage-lifecycle.md):
//   NEVER pass body.pin, body.requested_pin, body.selfieDataUrl, full
//   Authorization headers, or full IPs. The helper redacts the obvious
//   fields defensively, but the caller is the last line of defence.

export interface FnLogContext {
  fn: string                 // 'punch-submit' | 'worker-register' | …
  step?: string              // 'parse-body' | 'gps-bounds' | 'storage-upload' | …
  workerId?: string
  siteId?: string
  attendanceId?: string
  status?: number | string
  [k: string]: unknown
}

const REDACTED_KEYS = new Set([
  'pin',
  'newPin',
  'requested_pin',
  'requestedPin',
  'password',
  'selfieDataUrl',
  'selfie_data_url',
  'authorization',
])

function redact(ctx: FnLogContext): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ctx)) {
    if (k === 'fn' || k === 'step') continue
    if (REDACTED_KEYS.has(k)) {
      out[k] = '[REDACTED]'
      continue
    }
    // Best-effort: trim long strings so a stray selfieDataUrl never leaks
    if (typeof v === 'string' && v.length > 500) {
      out[k] = `${v.slice(0, 200)}…[truncated ${v.length - 200} chars]`
      continue
    }
    out[k] = v
  }
  return out
}

function nowIso(): string {
  return new Date().toISOString()
}

export function logError(err: unknown, ctx: FnLogContext): void {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : JSON.stringify(err))
  console.error(JSON.stringify({
    level: 'error',
    fn: ctx.fn,
    step: ctx.step ?? null,
    msg: e.message,
    name: e.name,
    // top 8 stack frames is enough for triage and keeps log size sane
    stack: e.stack?.split('\n').slice(0, 8).join('\n') ?? null,
    ctx: redact(ctx),
    ts: nowIso(),
  }))
}

export function logWarn(msg: string, ctx: FnLogContext): void {
  console.warn(JSON.stringify({
    level: 'warn',
    fn: ctx.fn,
    step: ctx.step ?? null,
    msg,
    ctx: redact(ctx),
    ts: nowIso(),
  }))
}

export function logInfo(msg: string, ctx: FnLogContext): void {
  console.log(JSON.stringify({
    level: 'info',
    fn: ctx.fn,
    step: ctx.step ?? null,
    msg,
    ctx: redact(ctx),
    ts: nowIso(),
  }))
}
