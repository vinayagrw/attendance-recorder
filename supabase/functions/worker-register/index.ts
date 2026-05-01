// Edge Function: worker-register
// Creates a Supabase Auth user for the worker (synthetic email), uploads the
// baseline selfie, and flips the worker row to pending_approval.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

interface RegisterBody {
  workerId: string
  pin: string
  selfieDataUrl: string
  gps?: { lat?: number; lng?: number; accuracy_m?: number; speed_ms?: number | null }
  deviceFingerprint: string
  userAgent: string
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
  if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }))

  let body: RegisterBody
  try {
    body = await req.json()
  } catch {
    return cors(jsonError('Invalid JSON', 400))
  }

  if (!body.workerId || !body.pin || !body.selfieDataUrl) {
    return cors(jsonError('Missing required fields', 400))
  }
  if (!/^\d{4,6}$/.test(body.pin)) return cors(jsonError('PIN must be 4-6 digits', 400))

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: worker, error: workerErr } = await sb
    .from('workers')
    .select('id, status, auth_user_id')
    .eq('id', body.workerId)
    .maybeSingle()

  if (workerErr || !worker) return cors(jsonError('Worker not found', 404))
  if (!['invited', 'pending_approval'].includes(worker.status))
    return cors(jsonError(`Worker is ${worker.status}; cannot register`, 409))

  const ipAddress = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null
  const email = `${body.workerId}@worker.local`
  const password = `${body.pin}-${body.workerId.slice(0, 8)}`

  let authUserId = worker.auth_user_id as string | null
  if (!authUserId) {
    const { data: created, error: createErr } = await sb.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { worker_id: body.workerId, kind: 'worker' },
    })
    if (createErr) return cors(jsonError(`Auth create failed: ${createErr.message}`, 500))
    authUserId = created.user.id
  } else {
    const { error: updateErr } = await sb.auth.admin.updateUserById(authUserId, { password })
    if (updateErr) return cors(jsonError(`Auth update failed: ${updateErr.message}`, 500))
  }

  const path = `${body.workerId}/baseline-${Date.now()}.jpg`
  const blob = dataUrlToBlob(body.selfieDataUrl)
  const { error: uploadErr } = await sb.storage
    .from('selfies')
    .upload(path, blob, { contentType: 'image/jpeg', upsert: false })
  if (uploadErr) return cors(jsonError(`Upload failed: ${uploadErr.message}`, 500))

  const { error: updateErr } = await sb
    .from('workers')
    .update({
      auth_user_id: authUserId,
      baseline_selfie_url: path,
      status: 'pending_approval',
      registered_at: new Date().toISOString(),
    })
    .eq('id', body.workerId)
  if (updateErr) return cors(jsonError(`Worker update failed: ${updateErr.message}`, 500))

  await sb.from('device_logs').insert({
    worker_id: body.workerId,
    event: 'register',
    device_fingerprint: body.deviceFingerprint,
    user_agent: body.userAgent,
    ip_address: ipAddress,
    lat: body.gps?.lat ?? null,
    lng: body.gps?.lng ?? null,
  })

  return cors(
    new Response(
      JSON.stringify({ status: 'pending_approval', authEmail: email }),
      { headers: { 'content-type': 'application/json' }, status: 200 },
    ),
  )
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
