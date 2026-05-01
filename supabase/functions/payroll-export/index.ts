// Edge Function: payroll-export
// CSV export of attendance for a date range. Pre-flight gate: blocks if
// any auto_closed rows are unresolved in the period (see docs/feat-forgotten-punchout.md).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SB_ANON_KEY') ?? ''

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }))
  if (req.method !== 'POST' && req.method !== 'GET')
    return cors(new Response('Method not allowed', { status: 405 }))

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return cors(jsonError('Missing token', 401))

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: auth } },
  })
  const { data: userData, error } = await userClient.auth.getUser()
  if (error || !userData.user) return cors(jsonError('Invalid session', 401))

  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const { data: sup } = await sb
    .from('supervisors')
    .select('role, scope_project_ids')
    .eq('id', userData.user.id)
    .maybeSingle()
  if (!sup) return cors(jsonError('Not a supervisor', 403))

  const params =
    req.method === 'GET'
      ? Object.fromEntries(new URL(req.url).searchParams)
      : await req.json().catch(() => ({}))
  const { startDate, endDate, projectId, siteId } = params as Record<string, string | undefined>
  if (!startDate || !endDate) return cors(jsonError('startDate + endDate required', 400))

  // pre-flight: count unresolved auto-close + pending rows in range
  const { count: unresolvedAutoClosed } = await sb
    .from('attendance')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'auto_closed')
    .gte('punched_at', startDate)
    .lt('punched_at', addDay(endDate))
  if ((unresolvedAutoClosed ?? 0) > 0) {
    return cors(
      new Response(
        JSON.stringify({ error: 'unresolved_auto_closed', count: unresolvedAutoClosed }),
        { status: 422, headers: { 'content-type': 'application/json' } },
      ),
    )
  }

  const { data: rows } = await sb.rpc('payroll_rows', {
    p_start: startDate,
    p_end: endDate,
    p_project_id: projectId ?? null,
    p_site_id: siteId ?? null,
  })

  const csv = toCsv(rows ?? [])
  return cors(
    new Response(csv, {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="payroll-${startDate}-${endDate}.csv"`,
      },
    }),
  )
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
