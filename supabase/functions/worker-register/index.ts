// Edge Function: worker-register
// Stub for M2 — wires the registration flow described in plan §3a.
//
// Deploy: `npx supabase functions deploy worker-register`
//
// Body (JSON):
//   {
//     workerId: string,        // pre-created by admin
//     pin: string,             // 4-6 digits
//     selfieDataUrl: string,   // data:image/jpeg;base64,...
//     gps: { lat, lng, accuracy_m, speed_ms },
//     deviceFingerprint: string,
//     userAgent: string
//   }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'

interface RegisterBody {
  workerId: string
  pin: string
  selfieDataUrl: string
  gps?: { lat?: number; lng?: number; accuracy_m?: number; speed_ms?: number | null }
  deviceFingerprint: string
  userAgent: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: RegisterBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  if (!body.workerId || !body.pin || !body.selfieDataUrl) {
    return jsonError('Missing required fields', 400)
  }
  if (!/^\d{4,6}$/.test(body.pin)) {
    return jsonError('PIN must be 4-6 digits', 400)
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  })

  const { data: worker, error: workerErr } = await sb
    .from('workers')
    .select('id, status')
    .eq('id', body.workerId)
    .single()

  if (workerErr || !worker) return jsonError('Worker not found', 404)
  if (!['invited', 'pending_approval'].includes(worker.status))
    return jsonError(`Worker is ${worker.status}; cannot register`, 409)

  const ipAddress =
    req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null

  const pinHash = await bcrypt.hash(body.pin)

  const selfieBlob = dataUrlToBlob(body.selfieDataUrl)
  const path = `${body.workerId}/baseline-${Date.now()}.jpg`
  const { error: uploadErr } = await sb.storage
    .from('selfies')
    .upload(path, selfieBlob, { contentType: 'image/jpeg', upsert: false })
  if (uploadErr) return jsonError(`Upload failed: ${uploadErr.message}`, 500)

  const { error: updateErr } = await sb
    .from('workers')
    .update({
      pin_hash: pinHash,
      baseline_selfie_url: path,
      status: 'pending_approval',
      registered_at: new Date().toISOString(),
    })
    .eq('id', body.workerId)
  if (updateErr) return jsonError(`Worker update failed: ${updateErr.message}`, 500)

  await sb.from('device_logs').insert({
    worker_id: body.workerId,
    event: 'register',
    device_fingerprint: body.deviceFingerprint,
    user_agent: body.userAgent,
    ip_address: ipAddress,
    lat: body.gps?.lat ?? null,
    lng: body.gps?.lng ?? null,
  })

  return new Response(JSON.stringify({ status: 'pending_approval' }), {
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
