// Edge Function: payroll-export
// CSV export of attendance for a date range. Pre-flight gate: blocks if
// any auto_closed rows are unresolved in the period (see docs/feat-forgotten-punchout.md).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { logError, logInfo, logWarn } from '../_shared/log.ts'

const FN = 'payroll-export'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''

Deno.serve(async (req) => {
  try {
    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
    if (req.method !== 'POST' && req.method !== 'GET')
      return cors(new Response('Method not allowed', { status: 405 }))

    const auth = req.headers.get('authorization') ?? ''
    if (!auth.startsWith('Bearer ')) {
      logWarn('missing bearer token', { fn: FN, step: 'auth' })
      return cors(jsonError('Missing token', 401))
    }

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      auth: { persistSession: false },
      global: { headers: { Authorization: auth } },
    })
    const { data: userData, error } = await userClient.auth.getUser()
    if (error || !userData.user) {
      logWarn('invalid session', { fn: FN, step: 'auth', errMsg: error?.message })
      return cors(jsonError('Invalid session', 401))
    }

    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    const { data: sup, error: supErr } = await sb
      .from('supervisors')
      .select('role, scope_project_ids')
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

    let params: Record<string, string | undefined>
    try {
      params =
        req.method === 'GET'
          ? Object.fromEntries(new URL(req.url).searchParams)
          : (await req.json()) as Record<string, string | undefined>
    } catch (e) {
      logError(e, { fn: FN, step: 'parse-params' })
      return cors(jsonError('Invalid params', 400))
    }
    const { startDate, endDate, projectId, siteId } = params
    if (!startDate || !endDate) {
      logWarn('missing date range', { fn: FN, step: 'validate', startDate, endDate })
      return cors(jsonError('startDate + endDate required', 400))
    }

    // pre-flight: count unresolved auto-close + pending rows in range
    const { count: unresolvedAutoClosed, error: unresErr } = await sb
      .from('attendance')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'auto_closed')
      .gte('punched_at', startDate)
      .lt('punched_at', addDay(endDate))
    if (unresErr) {
      logError(unresErr, { fn: FN, step: 'unresolved-count', startDate, endDate })
      return cors(jsonError('Pre-flight check failed', 500))
    }
    if ((unresolvedAutoClosed ?? 0) > 0) {
      logWarn('unresolved auto-closed blocks export', {
        fn: FN, step: 'unresolved-count',
        startDate, endDate, count: unresolvedAutoClosed ?? 0,
      })
      return cors(
        new Response(
          JSON.stringify({ error: 'unresolved_auto_closed', count: unresolvedAutoClosed }),
          { status: 422, headers: { 'content-type': 'application/json' } },
        ),
      )
    }

    const { data: rows, error: rowsErr } = await sb.rpc('payroll_rows', {
      p_start: startDate,
      p_end: endDate,
      p_project_id: projectId ?? null,
      p_site_id: siteId ?? null,
    })
    if (rowsErr) {
      logError(rowsErr, { fn: FN, step: 'payroll-rows-rpc', startDate, endDate, projectId, siteId })
      return cors(jsonError(`Payroll query failed: ${rowsErr.message}`, 500))
    }

    const csv = toCsv(rows ?? [])

    logInfo('payroll exported', {
      fn: FN, step: 'done',
      startDate, endDate, projectId, siteId,
      rowCount: (rows ?? []).length, byteSize: csv.length,
    })

    return cors(
      new Response(csv, {
        headers: {
          'content-type': 'text/csv; charset=utf-8',
          'content-disposition': `attachment; filename="payroll-${startDate}-${endDate}.csv"`,
        },
      }),
    )
  } catch (e) {
    logError(e, { fn: FN, step: 'top-level' })
    return cors(jsonError('Internal server error', 500))
  }
})

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) return 'worker_id,worker_name,phone,project,site,work_date,clock_in,clock_out,hours_worked,status,flag_reasons\n'
  const headers = Object.keys(rows[0])
  const escape = (v: unknown) => {
    if (v == null) return ''
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const lines = [headers.join(',')]
  for (const r of rows) lines.push(headers.map((h) => escape(r[h])).join(','))
  return lines.join('\n') + '\n'
}

function addDay(yyyyMmDd: string): string {
  const d = new Date(yyyyMmDd + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function cors(res: Response) {
  res.headers.set('access-control-allow-origin', '*')
  res.headers.set('access-control-allow-headers', 'authorization, content-type, apikey')
  res.headers.set('access-control-allow-methods', 'POST, GET, OPTIONS')
  return res
}

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    headers: { 'content-type': 'application/json' },
    status,
  })
}
