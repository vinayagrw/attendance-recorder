// Edge Function: worker-pin-reset
// Admin/supervisor-only. Sets a new PIN for a worker by updating their
// auth.users password (since the worker password is `<pin>-<workerId.slice(0,8)>`).
//
// POST /functions/v1/worker-pin-reset
//   Authorization: Bearer <supervisor JWT>
//   { workerId, newPin, requestId? }
//
// Returns { ok: true } on success.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''

interface ResetBody {
  workerId: string
  newPin: string
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
  if (!body.workerId || !body.newPin) return cors(jsonError('Missing fields', 400))
  if (!/^\d{4,6}$/.test(body.newPin)) return cors(jsonError('PIN must be 4-6 digits', 400))

  const { data: worker } = await sb
    .from('workers')
    .select('id, auth_user_id')
    .eq('id', body.workerId)
    .maybeSingle()
  if (!worker?.auth_user_id) return cors(jsonError('Worker has no auth user', 404))

  const newPassword = `${body.newPin}-${body.workerId.slice(0, 8)}`
  const { error: updateErr } = await sb.auth.admin.updateUserById(worker.auth_user_id, {
    password: newPassword,
  })
  if (updateErr) return cors(jsonError(`Auth update failed: ${updateErr.message}`, 500))

  // Clear any failed-login lockout
  await sb
    .from('workers')
    .update({ failed_login_count: 0, locked_until: null })
    .eq('id', body.workerId)

  // Log the action
  await sb.from('device_logs').insert({
    worker_id: body.workerId,
    event: 'pin_reset',
    metadata: { reset_by: sup.id, request_id: body.requestId ?? null },
  })

  // Mark the reset request fulfilled, if one was passed
  if (body.requestId) {
    await sb
      .from('pin_reset_requests')
      .update({
        status: 'approved',
        reviewed_by: sup.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', body.requestId)
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
