// Edge Function: worker-pin-reset
// Two modes:
//   A) Supervisor-set PIN  →  POST { workerId, newPin }   (legacy / admin path)
//   B) Approve worker request → POST { requestId }        (M14, primary flow:
//       worker chose the PIN, supervisor only approves)
// Both paths gated by the caller's supervisor JWT.
//
// PII: never log the PIN itself — _shared/log.ts redacts `pin`/`newPin`/
// `requested_pin` fields automatically, but call sites must never pass
// them in unredacted under a different key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { logError, logInfo, logWarn } from '../_shared/log.ts'

const FN = 'worker-pin-reset'

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
  try {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
    if (req.method !== 'POST') return cors(new Response('Method not allowed', { status: 405 }))

    const auth = req.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ')) {
      logWarn('missing bearer token', { fn: FN, step: 'auth' })
      return cors(jsonError('Missing token', 401))
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    const { data: userData, error: userErr } = await userClient.auth.getUser()
    if (userErr || !userData.user) {
      logWarn('invalid session', { fn: FN, step: 'auth', errMsg: userErr?.message })
      return cors(jsonError('Invalid session', 401))
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    const { data: sup, error: supErr } = await sb
      .from('supervisors')
      .select('id, role')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (supErr) {
      logError(supErr, { fn: FN, step: 'supervisor-load', authUserId: userData.user.id })
      return cors(jsonError('Supervisor lookup failed', 500))
    }
    if (!sup) {
      logWarn('not a supervisor', { fn: FN, step: 'supervisor-load', authUserId: userData.user.id })
      return cors(jsonError('Not a supervisor', 403))
    }

    let body: ResetBody
    try {
      body = await req.json()
    } catch (e) {
      logError(e, { fn: FN, step: 'parse-body' })
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
      if (reqErr) {
        logError(reqErr, { fn: FN, step: 'request-load', requestId })
        return cors(jsonError('Reset request lookup failed', 500))
      }
      if (!reqRow) {
        logWarn('request not found', { fn: FN, step: 'request-load', requestId })
        return cors(jsonError('Reset request not found', 404))
      }
      if (reqRow.status !== 'pending') {
        logWarn('request not pending', { fn: FN, step: 'request-load', requestId, status: reqRow.status })
        return cors(jsonError(`Request is ${reqRow.status}`, 409))
      }
      if (!reqRow.requested_pin) {
        logWarn('request has no requested_pin', { fn: FN, step: 'request-load', requestId })
        return cors(jsonError('Request has no requested_pin — worker must resubmit', 400))
      }
      workerId = reqRow.worker_id as string
      newPin = reqRow.requested_pin as string
    }

    if (!workerId || !newPin) {
      logWarn('missing workerId or newPin', { fn: FN, step: 'validate', hasWorkerId: !!workerId, hasNewPin: !!newPin })
      return cors(jsonError('Missing workerId or newPin', 400))
    }
    if (!/^\d{4,6}$/.test(newPin)) {
      logWarn('pin format rejected', { fn: FN, step: 'validate', workerId })
      return cors(jsonError('PIN must be 4-6 digits', 400))
    }

    const { data: worker, error: workerErr } = await sb
      .from('workers')
      .select('id, auth_user_id')
      .eq('id', workerId)
      .maybeSingle()
    if (workerErr) {
      logError(workerErr, { fn: FN, step: 'worker-load', workerId })
      return cors(jsonError('Worker lookup failed', 500))
    }
    if (!worker?.auth_user_id) {
      logWarn('worker has no auth user', { fn: FN, step: 'worker-load', workerId })
      return cors(jsonError('Worker has no auth user', 404))
    }

    const newPassword = `${newPin}-${workerId.slice(0, 8)}`
    const { error: updateErr } = await sb.auth.admin.updateUserById(worker.auth_user_id, {
      password: newPassword,
    })
    if (updateErr) {
      logError(updateErr, { fn: FN, step: 'auth-update', workerId })
      return cors(jsonError(`Auth update failed: ${updateErr.message}`, 500))
    }

    const { error: clearErr } = await sb
      .from('workers')
      .update({ failed_login_count: 0, locked_until: null })
      .eq('id', workerId)
    if (clearErr) logWarn('failed to clear lockout (continuing)', {
      fn: FN, step: 'lockout-clear',
      workerId, errMsg: clearErr.message,
    })

    const { error: deviceLogErr } = await sb.from('device_logs').insert({
      worker_id: workerId,
      event: 'pin_reset',
      metadata: { reset_by: sup.id, request_id: requestId ?? null },
    })
    if (deviceLogErr) logWarn('device_logs insert failed (continuing)', {
      fn: FN, step: 'device-log',
      workerId, errMsg: deviceLogErr.message,
    })

    if (requestId) {
      const { error: markErr } = await sb
        .from('pin_reset_requests')
        .update({
          status: 'approved',
          reviewed_by: sup.id,
          reviewed_at: new Date().toISOString(),
          requested_pin: null,
        })
        .eq('id', requestId)
      if (markErr) logWarn('failed to mark request approved (continuing)', {
        fn: FN, step: 'request-mark',
        requestId, errMsg: markErr.message,
      })
    }

    logInfo('pin reset applied', {
      fn: FN, step: 'done',
      workerId, requestId: requestId ?? null, mode: requestId ? 'approve' : 'admin-set',
    })

    return cors(
      new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
        status: 200,
      }),
    )
  } catch (e) {
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
