// Edge Function: punch-submit
// Validates the worker's Supabase Auth session, runs anomaly rules, stores
// the selfie, inserts the attendance row.
//
// All failure paths log a structured stderr line via _shared/log.ts so
// `supabase functions logs punch-submit --tail` captures the why behind
// every 4xx / 5xx response.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { ATTENDANCE_CONFIG } from '../_shared/config.ts'
import { logError, logInfo, logWarn } from '../_shared/log.ts'

const FN = 'punch-submit'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''

interface PunchBody {
  siteId: string
  type: 'in' | 'out'
  selfieDataUrl: string
  gps: { lat: number; lng: number; accuracy_m: number; speed_ms: number | null }
  deviceFingerprint: string
  userAgent: string
  attendanceId?: string
  selfieMetadata?: Record<string, unknown>
  selfieSha256?: string | null
  captureMethod?: string
  acknowledgedBriefingId?: string | null
}

// All anomaly thresholds are pulled from `_shared/config.ts`, which reads
// `ATT_*` env vars with sensible defaults. See that file for tuning notes.
const {
  MAX_GPS_ACCURACY_M,
  DRIVING_THRESHOLD_MS,
  IMPLAUSIBLE_SPEED_MS,
  GEOFENCE_FAR_THRESHOLD_M,
  BUDDY_PUNCH_WINDOW_HRS,
  SELFIES_BUCKET,
  EMIT_PUNCH_ACCESS_EVENT,
} = ATTENDANCE_CONFIG

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
    if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }))

    const auth = req.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ')) {
      logWarn('missing bearer token', { fn: FN, step: 'auth' })
      return cors(jsonError('Missing token', 401))
    }

    // Validate the worker's JWT by asking Supabase Auth (works with the new
    // asymmetric ES256 keys without us needing to know the signing secret).
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) {
      logWarn('invalid session', { fn: FN, step: 'auth', errMsg: userErr?.message })
      return cors(jsonError('Invalid session', 401))
    }
    const authUserId = userData.user.id

    let body: PunchBody
    try {
      body = await req.json()
    } catch (e) {
      logError(e, { fn: FN, step: 'parse-body' })
      return cors(jsonError('Invalid JSON', 400))
    }

    // Code review #6 — server-side lat/lng bounds. Reject obvious garbage
    // before it lands in the DB (the column is `double precision`, so DB
    // accepts anything).
    if (
      !body.gps ||
      typeof body.gps.lat !== 'number' || typeof body.gps.lng !== 'number' ||
      Math.abs(body.gps.lat) > 90 || Math.abs(body.gps.lng) > 180
    ) {
      logWarn('lat/lng out of range', {
        fn: FN, step: 'gps-bounds',
        workerId: authUserId, siteId: body?.siteId,
        lat: body?.gps?.lat, lng: body?.gps?.lng,
      })
      return cors(jsonError('lat/lng out of range', 400))
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    const { data: worker, error: workerErr } = await sb
      .from('workers')
      .select('id, status, baseline_selfie_url')
      .eq('auth_user_id', authUserId)
      .maybeSingle()
    if (workerErr) {
      logError(workerErr, { fn: FN, step: 'worker-load', authUserId })
      return cors(jsonError('Worker lookup failed', 500))
    }
    if (!worker) {
      logWarn('worker not linked', { fn: FN, step: 'worker-load', authUserId })
      return cors(jsonError('Worker not linked to this account', 404))
    }
    if (worker.status !== 'active') {
      logWarn('worker not active', { fn: FN, step: 'worker-status', workerId: worker.id, status: worker.status })
      return cors(jsonError(`Worker status is ${worker.status}; not active`, 403))
    }

    const flags: string[] = []

    if (!body.gps || body.gps.accuracy_m == null || body.gps.accuracy_m > MAX_GPS_ACCURACY_M) {
      flags.push('low_gps_accuracy')
    }
    if (body.gps?.speed_ms != null) {
      if (body.gps.speed_ms > DRIVING_THRESHOLD_MS) flags.push('in_motion')
      if (body.gps.speed_ms > IMPLAUSIBLE_SPEED_MS) flags.push('impossible_speed')
    }

    const { data: prior, error: priorErr } = await sb
      .from('attendance')
      .select('device_lat, device_lng, device_fingerprint, punched_at')
      .eq('worker_id', worker.id)
      .order('punched_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (priorErr) logWarn('prior punch query failed (continuing)', { fn: FN, step: 'prior-punch', errMsg: priorErr.message })
    if (prior?.device_lat != null && prior?.device_lng != null && body.gps) {
      if (
        Math.abs(prior.device_lat - body.gps.lat) < 1e-6 &&
        Math.abs(prior.device_lng - body.gps.lng) < 1e-6
      ) flags.push('mock_gps_signature')
    }

    const sinceIso = new Date(Date.now() - BUDDY_PUNCH_WINDOW_HRS * 3600_000).toISOString()
    const { data: buddyHits, error: buddyErr } = await sb
      .from('attendance')
      .select('worker_id')
      .eq('device_fingerprint', body.deviceFingerprint)
      .neq('worker_id', worker.id)
      .gte('punched_at', sinceIso)
      .limit(1)
    if (buddyErr) logWarn('buddy-punch query failed (continuing)', { fn: FN, step: 'buddy-punch', errMsg: buddyErr.message })
    if (buddyHits && buddyHits.length > 0) flags.push('buddy_punch_suspected')

    const { data: distRow, error: distErr } = await sb.rpc('distance_from_site_m', {
      p_site_id: body.siteId,
      p_lat: body.gps.lat,
      p_lng: body.gps.lng,
    })
    if (distErr) logWarn('distance rpc failed (continuing)', { fn: FN, step: 'geofence', errMsg: distErr.message })
    const distance = (distRow as unknown as number | null) ?? null
    if (
      distance != null &&
      distance > GEOFENCE_FAR_THRESHOLD_M &&
      distance > (body.gps.accuracy_m ?? 0)
    ) {
      flags.push('geofence_far')
    }

    // M13: flag if the worker isn't assigned to this site (they punched at a
    // site they shouldn't be at — supervisor can investigate or accept).
    const { data: isAssigned, error: assignErr } = await sb.rpc('is_worker_assigned', {
      p_worker_id: worker.id,
      p_site_id: body.siteId,
    })
    if (assignErr) logWarn('is_worker_assigned rpc failed (continuing)', { fn: FN, step: 'site-assignment', errMsg: assignErr.message })
    if (!isAssigned) flags.push('site_not_assigned')

    const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null

    const path = `${worker.id}/${body.type}-${Date.now()}.jpg`
    const blob = dataUrlToBlob(body.selfieDataUrl)
    const { error: uploadErr } = await sb.storage
      .from(SELFIES_BUCKET)
      .upload(path, blob, { contentType: 'image/jpeg' })
    if (uploadErr) {
      logError(uploadErr, { fn: FN, step: 'storage-upload', workerId: worker.id, path, byteSize: blob.size })
      return cors(jsonError(`Selfie upload failed: ${uploadErr.message}`, 500))
    }

    const insert: Record<string, unknown> = {
      worker_id: worker.id,
      site_id: body.siteId,
      type: body.type,
      device_lat: body.gps.lat,
      device_lng: body.gps.lng,
      gps_accuracy_m: body.gps.accuracy_m,
      speed_ms: body.gps.speed_ms,
      distance_from_site_m: distance,
      selfie_url: path,
      device_fingerprint: body.deviceFingerprint,
      user_agent: body.userAgent,
      ip_address: ip,
      status: flags.length === 0 ? 'pending' : 'flagged',
      flag_reasons: flags,
      briefing_acknowledged_id: body.acknowledgedBriefingId ?? null,
      // M15 — richer digital footprint stored verbatim for forensic review
      selfie_metadata: body.selfieMetadata ?? {},
      selfie_sha256: body.selfieSha256 ?? null,
      capture_method: body.captureMethod ?? null,
    }
    if (body.attendanceId) insert.id = body.attendanceId

    const { data: row, error } = await sb
      .from('attendance')
      .insert(insert)
      .select('id, status, flag_reasons, distance_from_site_m, punched_at')
      .single()
    if (error) {
      logError(error, {
        fn: FN, step: 'attendance-insert',
        workerId: worker.id, siteId: body.siteId, type: body.type,
      })
      return cors(jsonError(error.message, 500))
    }

    const { error: deviceLogErr } = await sb.from('device_logs').insert({
      worker_id: worker.id,
      event: 'punch',
      device_fingerprint: body.deviceFingerprint,
      user_agent: body.userAgent,
      ip_address: ip,
      lat: body.gps.lat,
      lng: body.gps.lng,
      // store the broader device snapshot for traffic correlation
      metadata: {
        attendance_id: row.id,
        capture_method: body.captureMethod ?? null,
        selfie_sha256: body.selfieSha256 ?? null,
        device: (body.selfieMetadata as Record<string, unknown> | undefined)?.device ?? null,
        camera: (body.selfieMetadata as Record<string, unknown> | undefined)?.camera ?? null,
      },
    })
    if (deviceLogErr) logWarn('device_logs insert failed (continuing)', {
      fn: FN, step: 'device-log',
      workerId: worker.id, attendanceId: row.id, errMsg: deviceLogErr.message,
    })

    // also fire a traffic event so /admin/traffic captures the punch — opt-out
    // via ATT_EMIT_PUNCH_ACCESS_EVENT=false if access_events grow too quickly.
    if (EMIT_PUNCH_ACCESS_EVENT) {
      const { error: accessErr } = await sb.from('access_events').insert({
        actor_type: 'worker',
        actor_id: worker.id,
        event_type: 'page_view',
        route: '/worker/punch',
        user_agent: body.userAgent,
        device_fingerprint: body.deviceFingerprint,
        ip_address: ip,
        metadata: {
          action: 'punch_submit',
          type: body.type,
          site_id: body.siteId,
          attendance_id: row.id,
          device: (body.selfieMetadata as Record<string, unknown> | undefined)?.device ?? null,
        },
      })
      if (accessErr) logWarn('access_events insert failed (continuing)', {
        fn: FN, step: 'access-event',
        workerId: worker.id, attendanceId: row.id, errMsg: accessErr.message,
      })
    }

    logInfo('punch accepted', {
      fn: FN, step: 'done',
      workerId: worker.id, siteId: body.siteId,
      attendanceId: row.id, type: body.type,
      flagCount: flags.length, status: row.status,
    })

    return cors(
      new Response(JSON.stringify(row), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
  } catch (e) {
    // Catch-all: any uncaught throw lands here. Logged with no body context
    // because we may not have parsed it; supplement with any partials caught
    // earlier via step tags.
    logError(e, { fn: FN, step: 'top-level' })
    return cors(jsonError('Internal server error', 500))
  }
})

function cors(res: Response) {
  res.headers.set('access-control-allow-origin', '*')
  res.headers.set('access-control-allow-headers', 'authorization, content-type, apikey')
  res.headers.set('access-control-allow-methods', 'POST, OPTIONS')
  return res
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}

function dataUrlToBlob(dataUrl: string): Blob {
  const [header, base64] = dataUrl.split(',')
  const mime = header.match(/data:(.*?);base64/)?.[1] ?? 'image/jpeg'
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}
