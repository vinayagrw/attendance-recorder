import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'

export default function SupervisorDailyReport() {
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()
  const today = new Date().toISOString().slice(0, 10)
  const [siteId, setSiteId] = useState('')
  const [headcount, setHeadcount] = useState('')
  const [weather, setWeather] = useState('')
  const [workCompleted, setWorkCompleted] = useState('')
  const [blockers, setBlockers] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const { data: sites } = useQuery({
    queryKey: ['daily-report-sites'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sites')
        .select('id, name, default_lat, default_lng, timezone')
        .eq('status', 'active')
        .order('name')
      return data ?? []
    },
  })

  // Auto-pick first site
  useEffect(() => {
    if (!siteId && sites && sites.length > 0) setSiteId(sites[0].id)
  }, [sites, siteId])

  // Headcount from attendance for the selected site & today
  const { data: attendanceCount } = useQuery({
    queryKey: ['daily-report-headcount', siteId, today],
    enabled: !!siteId,
    queryFn: async () => {
      const start = `${today}T00:00:00Z`
      const end = `${today}T23:59:59Z`
      const { count } = await supabase
        .from('attendance')
        .select('worker_id', { count: 'exact', head: true })
        .eq('site_id', siteId)
        .eq('type', 'in')
        .gte('punched_at', start)
        .lte('punched_at', end)
      return count ?? 0
    },
  })

  // Existing report (so we don't double-submit)
  const { data: existing } = useQuery({
    queryKey: ['daily-report-existing', siteId, today],
    enabled: !!siteId,
    queryFn: async () => {
      const { data } = await supabase
        .from('daily_site_reports')
        .select('*')
        .eq('site_id', siteId)
        .eq('report_date', today)
        .maybeSingle()
      return data
    },
  })

  useEffect(() => {
    if (existing) {
      setHeadcount(String(existing.headcount_reported ?? ''))
      setWeather(existing.weather_summary ?? '')
      setWorkCompleted(existing.work_completed ?? '')
      setBlockers(existing.blockers ?? '')
      setNotes(existing.notes ?? '')
    } else {
      setHeadcount('')
      setWeather('')
      setWorkCompleted('')
      setBlockers('')
      setNotes('')
    }
  }, [existing])

  const submit = useMutation({
    mutationFn: async () => {
      if (!siteId) throw new Error('Pick a site')
      const payload = {
        site_id: siteId,
        report_date: today,
        submitted_by: supervisor?.id,
        weather_summary: weather || null,
        headcount_reported: headcount ? parseInt(headcount, 10) : null,
        headcount_attendance: attendanceCount ?? null,
        work_completed: workCompleted || null,
        blockers: blockers || null,
        notes: notes || null,
        status: 'submitted',
      }
      const { error } = existing
        ? await supabase.from('daily_site_reports').update(payload).eq('id', existing.id)
        : await supabase.from('daily_site_reports').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      setInfo('Daily report saved.')
      qc.invalidateQueries({ queryKey: ['daily-report-existing'] })
    },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <RoleScaffold title={`Daily report — ${today}`} backTo="/supervisor/dashboard">
      <select className="input-field" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
        {(sites ?? []).map((s) => (
          <option key={s.id} value={s.id}>{s.name}</option>
        ))}
      </select>

      <div className="rounded-xl bg-white p-3 text-sm shadow-sm">
        <div className="flex justify-between">
          <span className="text-slate-500">Attendance headcount today</span>
          <span className="font-mono">{attendanceCount ?? '—'}</span>
        </div>
      </div>

      <input
        className="input-field"
        placeholder="Weather (e.g. Sunny, 32°C)"
        value={weather}
        onChange={(e) => setWeather(e.target.value)}
      />

      <input
        className="input-field"
        type="number"
        min="0"
        placeholder={`Reported headcount (auto: ${attendanceCount ?? 0})`}
        value={headcount}
        onChange={(e) => setHeadcount(e.target.value)}
      />

      <textarea
        className="input-field"
        rows={3}
        placeholder="Work completed today…"
        value={workCompleted}
        onChange={(e) => setWorkCompleted(e.target.value)}
      />

      <textarea
        className="input-field"
        rows={2}
        placeholder="Blockers / safety incidents (optional)…"
        value={blockers}
        onChange={(e) => setBlockers(e.target.value)}
      />

      <textarea
        className="input-field"
        rows={2}
        placeholder="Notes (optional)…"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
      />

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

      <button onClick={() => submit.mutate()} className="btn-primary" disabled={submit.isPending}>
        {submit.isPending ? 'Saving…' : existing ? 'Update report' : 'Submit report'}
      </button>
    </RoleScaffold>
  )
}
