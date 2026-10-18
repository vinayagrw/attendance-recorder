// Edge Function: staff-manage
// Admin-only management of supervisors / admins from the web UI.
//   POST { action: 'create', email, fullName, role, password, scopeProjectIds }
//   POST { action: 'update', id, role, scopeProjectIds }
//   POST { action: 'remove', id }
// Creating an auth user needs the service-role key, hence a function.
//
// PII: never log the password — _shared/log.ts redacts `password`, but
// call sites must not pass it under another key.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { logError, logInfo, logWarn } from '../_shared/log.ts'

const FN = 'staff-manage'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''

type Role = 'admin' | 'supervisor'

interface StaffBody {
  action?: 'create' | 'update' | 'remove'
  id?: string
  email?: string
  fullName?: string
  role?: Role
  password?: string
  scopeProjectIds?: string[]
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

    const { data: caller, error: callerErr } = await sb
      .from('supervisors')
      .select('id, role')
      .eq('id', userData.user.id)
      .maybeSingle()
    if (callerErr) {
      logError(callerErr, { fn: FN, step: 'caller-load', authUserId: userData.user.id })
      return cors(jsonError('Caller lookup failed', 500))
    }
    if (caller?.role !== 'admin') {
      logWarn('not an admin', { fn: FN, step: 'caller-load', authUserId: userData.user.id })
      return cors(jsonError('Admins only', 403))
    }

    let body: StaffBody
    try {
      body = await req.json()
    } catch (e) {
      logError(e, { fn: FN, step: 'parse-body' })
      return cors(jsonError('Invalid JSON', 400))
    }

    if (body.role && body.role !== 'admin' && body.role !== 'supervisor') {
      return cors(jsonError('Role must be admin or supervisor', 400))
    }
    const scope = Array.isArray(body.scopeProjectIds) ? body.scopeProjectIds : []

    const audit = async (action: string, targetId: string, before: unknown, after: unknown) => {
      const { error } = await sb.from('audit_log').insert({
        actor_id: caller.id,
        actor_role: 'admin',
        action,
        target_table: 'supervisors',
        target_id: targetId,
        before_state: before,
        after_state: after,
      })
      if (error) logWarn('audit insert failed (continuing)', { fn: FN, step: 'audit', errMsg: error.message })
    }

    // Guard: never leave the org with zero admins.
    const isLastAdmin = async (id: string) => {
      const { data } = await sb.from('supervisors').select('id').eq('role', 'admin')
      return (data ?? []).length <= 1 && (data ?? []).some((r) => r.id === id)
    }

    if (body.action === 'create') {
      const email = body.email?.trim().toLowerCase()
      const fullName = body.fullName?.trim()
      const role: Role = body.role ?? 'supervisor'
      if (!email || !fullName) return cors(jsonError('Email and full name are required', 400))

      let userId: string | undefined
      if (body.password) {
        if (body.password.length < 8) return cors(jsonError('Password must be at least 8 characters', 400))
        const { data: created, error: createErr } = await sb.auth.admin.createUser({
          email,
          password: body.password,
          email_confirm: true,
        })
        if (created?.user) userId = created.user.id
        else if (createErr && !/already|registered|exists/i.test(createErr.message)) {
          logError(createErr, { fn: FN, step: 'auth-create' })
          return cors(jsonError(`Could not create login: ${createErr.message}`, 500))
        }
      }
      if (!userId) {
        // Existing login (or no password given): find it and promote.
        const { data: list, error: listErr } = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 })
        if (listErr) {
          logError(listErr, { fn: FN, step: 'auth-lookup' })
          return cors(jsonError('Login lookup failed', 500))
        }
        userId = list.users.find((u) => u.email?.toLowerCase() === email)?.id
      }
      if (!userId) return cors(jsonError('No login exists for that email. Enter a password to create one.', 404))

      const row = { id: userId, full_name: fullName, role, scope_project_ids: role === 'admin' ? [] : scope }
      const { error: upErr } = await sb.from('supervisors').upsert(row, { onConflict: 'id' })
      if (upErr) {
        logError(upErr, { fn: FN, step: 'supervisor-upsert' })
        return cors(jsonError(`Could not save staff: ${upErr.message}`, 500))
      }
      await audit('staff_create', userId, null, row)
      logInfo('staff saved', { fn: FN, step: 'done', role })
      return cors(ok({ id: userId }))
    }

    if (body.action === 'update' || body.action === 'remove') {
      if (!body.id) return cors(jsonError('Missing id', 400))
      const { data: before } = await sb.from('supervisors').select('*').eq('id', body.id).maybeSingle()
      if (!before) return cors(jsonError('Staff member not found', 404))

      if (body.action === 'remove') {
        if (body.id === caller.id) return cors(jsonError('You cannot remove yourself', 400))
        if (await isLastAdmin(body.id)) return cors(jsonError('Cannot remove the last admin', 400))
        const { error } = await sb.from('supervisors').delete().eq('id', body.id)
        if (error) return cors(jsonError(`Remove failed: ${error.message}`, 500))
        await audit('staff_remove', body.id, before, null)
        return cors(ok({ id: body.id }))
      }

      const role: Role = body.role ?? before.role
      if (role !== 'admin' && (await isLastAdmin(body.id))) {
        return cors(jsonError('Cannot demote the last admin', 400))
      }
      const patch = { role, scope_project_ids: role === 'admin' ? [] : scope }
      const { error } = await sb.from('supervisors').update(patch).eq('id', body.id)
      if (error) return cors(jsonError(`Update failed: ${error.message}`, 500))
      await audit('staff_update', body.id, before, { ...before, ...patch })
      return cors(ok({ id: body.id }))
    }

    return cors(jsonError('Unknown action', 400))
  } catch (e) {
    logError(e, { fn: FN, step: 'top-level' })
    return cors(jsonError('Internal server error', 500))
  }
})

function ok(payload: unknown) {
  return new Response(JSON.stringify({ ok: true, ...(payload as object) }), {
    headers: { 'content-type': 'application/json' },
    status: 200,
  })
}

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
