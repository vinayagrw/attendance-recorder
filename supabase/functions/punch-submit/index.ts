// Edge Function: punch-submit
// Stub for M4 — applies the anomaly checks from plan §15 + §19a.
//
// Deploy: `npx supabase functions deploy punch-submit`
//
// Headers: Authorization: Bearer <worker JWT from worker-login>
// Body (JSON):
//   {
//     siteId, type ('in'|'out'),
//     selfieDataUrl, gps: { lat, lng, accuracy_m, speed_ms },
//     deviceFingerprint, userAgent
//   }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { verify as verifyJwt } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET')!

interface PunchBody {
  siteId: string
  type: 'in' | 'out'
  selfieDataUrl: string
  gps: { lat: number; lng: number; accuracy_m: number; speed_ms: number | null }
  deviceFingerprint: string
  userAgent: string
}

const MAX_GPS_ACCURACY_M = 80
const MAX_REASONABLE_SPEED_MS = 33 // ~120 km/h
const DRIVING_THRESHOLD_MS = 8 / 3.6 // 8 km/h

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const auth = req.headers.get('authorization') ?? ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return jsonError('Missing token', 401)

  let workerId: string
  try {
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(JWT_SECRET),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    )
    const payload = await verifyJwt(token, key)
    workerId = payload.worker_id as string
    if (!workerId) throw new Error('no worker_id claim')
  } catch (e) {
    return jsonError(`Invalid token: ${(e as Error).message}`, 401)
  }

  let body: PunchBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: worker } = await sb
    .from('workers')
    .select('id, status, baseline_selfie_url')
    .eq('id', workerId)
    .single()
  if (!worker) return jsonError('Worker not found', 404)
  if (worker.status !== 'active') return jsonError(`Worker status ${worker.status}`, 403)

  const flags: string[] = []

  if (!body.gps || body.gps.accuracy_m == null || body.gps.accuracy_m > MAX_GPS_ACCURACY_M) {
    flags.push('low_gps_accuracy')
  }
  if (body.gps?.speed_ms != null) {
    if (body.gps.speed_ms > DRIVING_THRESHOLD_MS) flags.push('in_motion')
    if (body.gps.speed_ms > MAX_REASONABLE_SPEED_MS) flags.push('impossible_speed')
  }

  // Repeated identical six-decimal coords = mock-app signature
  const { data: prior } = await sb
    .from('attendance')
    .select('device_lat, device_lng, device_fingerprint, punched_at, worker_id')
    .eq('worker_id', workerId)
    .order('punched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (prior && body.gps) {
    if (
      prior.device_lat &&
      prior.device_lng &&
      Math.abs(prior.device_lat - body.gps.lat) < 1e-6 &&
      Math.abs(prior.device_lng - body.gps.lng) < 1e-6
    )
      flags.push('mock_gps_signature')
  }

  // Device-fingerprint buddy-punch heuristic (last 12h, different worker)
  const sinceIso = new Date(Date.now() - 12 * 3600_000).toISOString()
  const { data: buddyHits } = await sb
    .from('attendance')
    .select('worker_id')
    .eq('device_fingerprint', body.deviceFingerprint)
    .neq('worker_id', workerId)
    .gte('punched_at', sinceIso)
    .limit(1)
  if (buddyHits && buddyHits.length > 0) flags.push('buddy_punch_suspected')

  const { data: distRow } = await sb.rpc('distance_from_site_m', {
    p_site_id: body.siteId,
    p_lat: body.gps.lat,
    p_lng: body.gps.lng,
  })
  const distance = (distRow as unknown as number) ?? null
  if (distance != null && distance > 30 && distance > (body.gps.accuracy_m ?? 0))
    flags.push('geofence_far')

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null

  const path = `${workerId}/${body.type}-${Date.now()}.jpg`
  const blob = dataUrlToBlob(body.selfieDataUrl)
  await sb.storage.from('selfies').upload(path, blob, { contentType: 'image/jpeg' })

  const { data: row, error } = await sb
    .from('attendance')
    .insert({
      worker_id: workerId,
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
    })
    .select('id, status, flag_reasons, distance_from_site_m, punched_at')
    .single()

  if (error) return jsonError(error.message, 500)

  return new Response(JSON.stringify(row), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
})

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
