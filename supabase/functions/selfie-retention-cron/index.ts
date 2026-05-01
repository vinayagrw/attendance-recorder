// Edge Function: selfie-retention-cron
// Daily cron. Deletes selfie blobs older than the project-configured retention
// (default 90 days routine, 365 days flagged, indefinite for baselines).
// See docs/feat-selfie-storage-lifecycle.md.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('SB_URL') ?? ''
const SERVICE_KEY =
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SB_SERVICE_ROLE_KEY') ?? ''

const DEFAULT_ROUTINE_DAYS = 90
const DEFAULT_FLAGGED_DAYS = 365

Deno.serve(async () => {
  const sb = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

  const routineCutoff = daysAgoIso(DEFAULT_ROUTINE_DAYS)
  const flaggedCutoff = daysAgoIso(DEFAULT_FLAGGED_DAYS)

  // routine: verified rows with no flags
  const { data: routine } = await sb
    .from('attendance')
    .select('id, selfie_url')
    .lt('punched_at', routineCutoff)
    .eq('status', 'verified')
    .filter('flag_reasons', 'eq', '{}')
    .not('selfie_url', 'is', null)
    .limit(500)

  let deleted = 0
  for (const row of routine ?? []) {
    if (row.selfie_url) {
      await sb.storage.from('selfies').remove([row.selfie_url])
      await sb.from('attendance').update({ selfie_url: null }).eq('id', row.id)
      deleted++
    }
  }

  // flagged / rejected
  const { data: flagged } = await sb
    .from('attendance')
    .select('id, selfie_url')
    .lt('punched_at', flaggedCutoff)
    .in('status', ['flagged', 'rejected'])
    .not('selfie_url', 'is', null)
    .limit(500)

  for (const row of flagged ?? []) {
    if (row.selfie_url) {
      await sb.storage.from('selfies').remove([row.selfie_url])
      await sb.from('attendance').update({ selfie_url: null }).eq('id', row.id)
      deleted++
    }
  }

  return new Response(JSON.stringify({ deleted }), {
    headers: { 'content-type': 'application/json' },
  })
})

function daysAgoIso(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d.toISOString()
}
