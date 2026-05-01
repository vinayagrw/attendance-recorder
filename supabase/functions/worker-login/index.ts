// Edge Function: worker-login
// Stub for M2 — verifies PIN and mints a short-lived JWT with `worker_id`
// claim that RLS policies in 0002_rls.sql trust.
//
// Deploy: `npx supabase functions deploy worker-login`
//
// Body (JSON): { workerId, pin }

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts'
import { create as createJwt, getNumericDate } from 'https://deno.land/x/djwt@v3.0.2/mod.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Same secret Supabase Auth uses to sign JWTs — set in `supabase secrets`.
const JWT_SECRET = Deno.env.get('SUPABASE_JWT_SECRET')!

const MAX_FAILS = 5
const LOCKOUT_MINUTES = 15
const TOKEN_TTL_HOURS = 8

interface LoginBody {
  workerId: string
  pin: string
}

serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: LoginBody
  try {
    body = await req.json()
  } catch {
    return jsonError('Invalid JSON', 400)
  }

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? null

  const { data: w } = await sb
    .from('workers')
    .select('id, status, pin_hash, failed_login_count, locked_until')
    .eq('id', body.workerId)
    .single()

  if (!w) return jsonError('Invalid credentials', 401)
  if (w.locked_until && new Date(w.locked_until).getTime() > Date.now())
    return jsonError('Account locked. Contact your supervisor.', 423)
  if (w.status !== 'active')
    return jsonError(`Account status: ${w.status}`, 403)
  if (!w.pin_hash) return jsonError('Account not registered', 401)

  const ok = await bcrypt.compare(body.pin, w.pin_hash)
  if (!ok) {
    const fails = (w.failed_login_count ?? 0) + 1
    const lockUntil =
      fails >= MAX_FAILS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null
    await sb
      .from('workers')
      .update({ failed_login_count: fails, locked_until: lockUntil })
      .eq('id', w.id)
    await sb.from('device_logs').insert({
      worker_id: w.id,
      event: lockUntil ? 'login_lockout' : 'login_fail',
      ip_address: ip,
    })
    return jsonError('Invalid credentials', 401)
  }

  await sb
    .from('workers')
    .update({
      failed_login_count: 0,
      locked_until: null,
      last_login_at: new Date().toISOString(),
    })
    .eq('id', w.id)
  await sb.from('device_logs').insert({
    worker_id: w.id,
    event: 'login',
    ip_address: ip,
  })

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(JWT_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  )
  const token = await createJwt(
    { alg: 'HS256', typ: 'JWT' },
    {
      role: 'authenticated',
      worker_id: w.id,
      exp: getNumericDate(60 * 60 * TOKEN_TTL_HOURS),
    },
    key,
  )

  return new Response(JSON.stringify({ token, expiresInSeconds: 60 * 60 * TOKEN_TTL_HOURS }), {
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
