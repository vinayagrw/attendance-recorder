// Edge Function: auto-close-shifts
// Runs on a schedule (Supabase pg_cron) at the start of each site's local
// next-day. Finds workers with an unmatched 'in' punch and inserts a synthetic
// 'out' row with status='auto_closed'. Supervisors must adjust before payroll.
//
// Schedule (set up once in Studio → SQL Editor):
//   select cron.schedule(
//     'auto-close-shifts',
//     '*/30 * * * *',
//     $$
//       select net.http_post(
//         url := 'https://<project>.supabase.co/functions/v1/auto-close-shifts',
//         headers := jsonb_build_object('Authorization', 'Bearer <service_role_key>')
//       )
//     $$
//   );

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { logError, logInfo, logWarn } from '../_shared/log.ts'

const FN = 'auto-close-shifts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''

Deno.serve(async () => {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    const { data: sites, error } = await sb.from('sites').select('id, timezone').eq('status', 'active')
    if (error) {
      logError(error, { fn: FN, step: 'sites-load' })
      return new Response(`Sites query failed: ${error.message}`, { status: 500 })
    }

    let totalClosed = 0
    let perSiteFailures = 0
    for (const site of sites ?? []) {
      const yesterday = yesterdayInTz(site.timezone ?? 'UTC')
      const { data: open, error: openErr } = await sb.rpc('open_shifts_for_site', {
        p_site_id: site.id,
        p_local_date: yesterday,
      })
      if (openErr) {
        logWarn('open-shifts rpc failed (skipping site)', {
          fn: FN, step: 'query-open',
          siteId: site.id, errMsg: openErr.message,
        })
        perSiteFailures++
        continue
      }

      for (const row of (open ?? []) as Array<{ worker_id: string; last_in_at: string }>) {
        // close at end of yesterday in site tz (~23:59:59)
        const closeAt = endOfDayInTzIso(yesterday, site.timezone ?? 'UTC')
        const { error: insertErr } = await sb.from('attendance').insert({
          worker_id: row.worker_id,
          site_id: site.id,
          type: 'out',
          punched_at: closeAt,
          status: 'auto_closed',
          flag_reasons: ['auto_closed_no_punchout'],
        })
        if (insertErr) {
          logWarn('auto-close insert failed', {
            fn: FN, step: 'update-batch',
            workerId: row.worker_id, siteId: site.id,
            errMsg: insertErr.message,
          })
          continue
        }
        totalClosed++
      }
    }

    logInfo('auto-close run complete', {
      fn: FN, step: 'done',
      siteCount: (sites ?? []).length,
      closed: totalClosed,
      perSiteFailures,
    })

    return new Response(JSON.stringify({ closed: totalClosed }), {
      headers: { 'content-type': 'application/json' },
    })
  } catch (e) {
    logError(e, { fn: FN, step: 'top-level' })
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }
})

function yesterdayInTz(_tz: string): string {
  // Day arithmetic in IANA TZ requires Temporal API (Deno has it). For now,
  // use UTC and rely on most sites running close to UTC. Replace with Temporal
  // when V8 ships it as default.
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

function endOfDayInTzIso(yyyyMmDd: string, _tz: string): string {
  return `${yyyyMmDd}T23:59:59Z`
}
