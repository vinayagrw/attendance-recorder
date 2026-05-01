// Edge Function: worker-pin-reset
// Two modes:
//   A) Supervisor-set PIN  →  POST { workerId, newPin }   (legacy / admin path)
//   B) Approve worker request → POST { requestId }        (M14, primary flow:
//       worker chose the PIN, supervisor only approves)
// Both paths gated by the caller's supervisor JWT.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''

interface ResetBody {
  workerId?: string
  newPin?: string
  requestId?: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
  if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }))

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return cors(jsonError('Missing token', 401))

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data: userData, error: userErr } = await userClient.auth.getUser()
  if (userErr || !userData.user) return cors(jsonError('Invalid session', 401))

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: sup } = await sb
    .from('supervisors')
    .select('id, role')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!sup) return cors(jsonError('Not a supervisor', 403))

  let body: ResetBody
  try {
    body = await req.json()
  } catch {
    return cors(jsonError('Invalid JSON', 400))
  }

  let workerId = body.workerId
  let newPin = body.newPin
  const requestId = body.requestId

  // Mode B: Approve worker's request — load workerId + requested_pin from DB
  if (requestId && (!workerId || !newPin)) {
    const { data: reqRow, error: reqErr } = await sb
      .from('pin_reset_requests')
      .select('id, worker_id, requested_pin, status')
      .eq('id', requestId)
      .maybeSingle()
    if (reqErr || !reqRow) return cors(jsonError('Reset request not found', 404))
    if (reqRow.status !== 'pending')
      return cors(jsonError(`Request is ${reqRow.status}`, 409))
    if (!reqRow.requested_pin)
      return cors(jsonError('Request has no requested_pin — worker must resubmit', 400))
    workerId = reqRow.worker_id as string
    newPin = reqRow.requested_pin as string
  }

  if (!workerId || !newPin) return cors(jsonError('Missing workerId or newPin', 400))
  if (!/^\d{4,6}$/.test(newPin)) return cors(jsonError('PIN must be 4-6 digits', 400))

  const { data: worker } = await sb
    .from('workers')
    .select('id, auth_user_id')
    .eq('id', workerId)
    .maybeSingle()
  if (!worker?.auth_user_id) return cors(jsonError('Worker has no auth user', 404))

  const newPassword = `${newPin}-${workerId.slice(0, 8)}`
  const { error: updateErr } = await sb.auth.admin.updateUserById(worker.auth_user_id, {
    password: newPassword,
  })
  if (updateErr) return cors(jsonError(`Auth update failed: ${updateErr.message}`, 500))

  await sb
    .from('workers')
    .update({ failed_login_count: 0, locked_until: null })
    .eq('id', workerId)

  await sb.from('device_logs').insert({
    worker_id: workerId,
    event: 'pin_reset',
    metadata: { reset_by: sup.id, request_id: requestId ?? null },
  })

  if (requestId) {
    await sb
      .from('pin_reset_requests')
      .update({
        status: 'approved',
        reviewed_by: sup.id,
        reviewed_at: new Date().toISOString(),
        requested_pin: null,
      })
      .eq('id', requestId)
  }

  return cors(
    new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
      status: 200,
    }),
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
