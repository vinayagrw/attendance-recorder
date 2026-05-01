// Best-effort site-traffic logger. Inserts a row into `access_events` for every
// page view / login / login_fail / logout / register so /admin/traffic can
// surface "who is on the app right now" and "unknown traffic" patterns.
//
// Failures are intentionally silent — we never want to block UX on a logging
// hiccup. RLS on access_events allows anon INSERT; trigger fills ip_address
// from x-forwarded-for, so the client just sends the rest.

import { supabase } from './supabase'
import { getDigitalFootprintJSON } from './digitalFootprint'
import { getDeviceInfo } from './deviceFingerprint'

export type AccessEventType =
  | 'page_view'
  | 'login'
  | 'login_fail'
  | 'logout'
  | 'register'
  | 'pin_request'

export type AccessActorType = 'worker' | 'supervisor' | 'admin' | 'anon'

export interface LogAccessOptions {
  eventType: AccessEventType
  actorType: AccessActorType
  actorId?: string | null
  actorLabel?: string | null
  route?: string
  metadata?: Record<string, unknown>
}

let cachedFingerprint: string | null = null

async function fingerprint(): Promise<string | null> {
  if (cachedFingerprint) return cachedFingerprint
  try {
    const info = await getDeviceInfo()
    cachedFingerprint = info.fingerprint
    return info.fingerprint
  } catch {
    return null
  }
}

export async function logAccess(opts: LogAccessOptions): Promise<void> {
  try {
    const fp = await fingerprint()
    const footprint = getDigitalFootprintJSON()
    await supabase.from('access_events').insert({
      actor_type: opts.actorType,
      actor_id: opts.actorId ?? null,
      actor_label: opts.actorLabel ?? null,
      event_type: opts.eventType,
      route: opts.route ?? window.location.pathname,
      referrer: document.referrer || null,
      user_agent: navigator.userAgent,
      device_fingerprint: fp,
      metadata: { ...footprint, ...(opts.metadata ?? {}) },
    })
  } catch {
    // swallow — never block UX on a logging failure
  }
}
