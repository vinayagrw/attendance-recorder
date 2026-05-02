// Edge Function: selfie-retention-cron
// Daily cron. Deletes selfie blobs older than the project-configured retention
// (default 90 days routine, 365 days flagged, indefinite for baselines).
// See docs/feat-selfie-storage-lifecycle.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { logError, logInfo, logWarn } from '../_shared/log.ts'

const FN = 'selfie-retention-cron'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''

const DEFAULT_ROUTINE_DAYS = 90
const DEFAULT_FLAGGED_DAYS = 365

Deno.serve(async () => {
  try {
    const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

    const routineCutoff = daysAgoIso(DEFAULT_ROUTINE_DAYS)
    const flaggedCutoff = daysAgoIso(DEFAULT_FLAGGED_DAYS)

    let deleted = 0
    let perRowFailures = 0

    // routine: verified rows with no flags
    const { data: routine, error: routineErr } = await sb
      .from('attendance')
      .select('id, selfie_url')
      .lt('punched_at', routineCutoff)
      .eq('status', 'verified')
      .filter('flag_reasons', 'eq', '{}')
      .not('selfie_url', 'is', null)
      .limit(500)
    if (routineErr) {
      logError(routineErr, { fn: FN, step: 'query-old-routine' })
    } else {
      for (const row of routine ?? []) {
        if (!row.selfie_url) continue
        const { error: removeErr } = await sb.storage.from('selfies').remove([row.selfie_url])
        if (removeErr) {
          logWarn('storage remove failed', {
            fn: FN, step: 'delete-blob',
            attendanceId: row.id, errMsg: removeErr.message,
          })
          perRowFailures++
          continue
        }
        const { error: nullErr } = await sb.from('attendance').update({ selfie_url: null }).eq('id', row.id)
        if (nullErr) {
          logWarn('null-out attendance.selfie_url failed', {
            fn: FN, step: 'null-url',
            attendanceId: row.id, errMsg: nullErr.message,
          })
          perRowFailures++
          continue
        }
        deleted++
      }
    }

    // flagged / rejected
    const { data: flagged, error: flaggedErr } = await sb
      .from('attendance')
      .select('id, selfie_url')
      .lt('punched_at', flaggedCutoff)
      .in('status', ['flagged', 'rejected'])
      .not('selfie_url', 'is', null)
      .limit(500)
    if (flaggedErr) {
      logError(flaggedErr, { fn: FN, step: 'query-old-flagged' })
    } else {
      for (const row of flagged ?? []) {
        if (!row.selfie_url) continue
        const { error: removeErr } = await sb.storage.from('selfies').remove([row.selfie_url])
        if (removeErr) {
          logWarn('storage remove failed', {
            fn: FN, step: 'delete-blob',
            attendanceId: row.id, errMsg: removeErr.message,
          })
          perRowFailures++
          continue
        }
        const { error: nullErr } = await sb.from('attendance').update({ selfie_url: null }).eq('id', row.id)
        if (nullErr) {
          logWarn('null-out attendance.selfie_url failed', {
            fn: FN, step: 'null-url',
            attendanceId: row.id, errMsg: nullErr.message,
          })
          perRowFailures++
          continue
        }
        deleted++
      }
    }

    logInfo('retention sweep complete', {
      fn: FN, step: 'done',
      deleted, perRowFailures,
      routineCutoff, flaggedCutoff,
    })

    return new Response(JSON.stringify({ deleted }), {
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

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}
