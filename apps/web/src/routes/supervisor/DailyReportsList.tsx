import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

interface DailyReportRow {
  id: string
  site_id: string
  report_date: string
  weather_summary: string | null
  headcount_reported: number | null
  headcount_attendance: number | null
  work_completed: string | null
  blockers: string | null
  status: string
  submitted_at: string
  sites: { name: string; project_id: string; projects?: { name: string } | null } | null
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}
function daysAgoIso(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

export default function SupervisorDailyReportsList() {
  const [startDate, setStartDate] = useState(daysAgoIso(30))
  const [endDate, setEndDate] = useState(todayIso())
  const [projectId, setProjectId] = useState('')
  const [siteId, setSiteId] = useState('')

  const { data: projects } = useQuery({
    queryKey: ['drl-projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, name').order('name')
      return (data as Array<{ id: string; name: string }>) ?? []
    },
  })

  const { data: sites } = useQuery({
    queryKey: ['drl-sites', projectId],
    queryFn: async () => {
      let q = supabase.from('sites').select('id, name, project_id').order('name')
      if (projectId) q = q.eq('project_id', projectId)
      const { data } = await q
      return (data as Array<{ id: string; name: string; project_id: string }>) ?? []
    },
  })

  const { data: reports, isFetching } = useQuery({
    queryKey: ['daily-reports', startDate, endDate, projectId, siteId],
    queryFn: async (): Promise<DailyReportRow[]> => {
      let q = supabase
        .from('daily_site_reports')
        .select(
          'id, site_id, report_date, weather_summary, headcount_reported, ' +
            'headcount_attendance, work_completed, blockers, status, submitted_at, ' +
            'sites(name, project_id, projects(name))',
        )
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .order('report_date', { ascending: false })
      if (siteId) q = q.eq('site_id', siteId)
      else if (projectId) q = q.in('site_id', (sites ?? []).map((s) => s.id))
      const { data, error } = await q
      if (error) throw error
      return (data as unknown as DailyReportRow[]) ?? []
    },
  })

  const summary = (() => {
    if (!reports) return null
    return {
      total: reports.length,
      submitted: reports.filter((r) => r.status === 'submitted').length,
      mismatched: reports.filter(
        (r) =>
          r.headcount_reported != null &&
          r.headcount_attendance != null &&
          r.headcount_reported !== r.headcount_attendance,
      ).length,
      uniqueSites: new Set(reports.map((r) => r.site_id)).size,
    }
  })()

  return (
    <RoleScaffold title="Daily reports" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Browse historical daily site reports. Submit a new one via{' '}
        <Link to="/supervisor/daily-report" className="text-brand-600 underline">
          Daily report
        </Link>.
      </p>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-3 shadow-sm">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">From</span>
          <input
            type="date"
            className="input-field py-2 text-sm"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">To</span>
          <input
            type="date"
            className="input-field py-2 text-sm"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Project</span>
          <select
            className="input-field py-2 text-sm"
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setSiteId('') }}
          >
            <option value="">All projects</option>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Site</span>
          <select
            className="input-field py-2 text-sm"
            value={siteId}
            onChange={(e) => setSiteId(e.target.value)}
          >
            <option value="">{projectId ? 'All sites in project' : 'All sites'}</option>
            {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>

      {summary && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-xl bg-white p-2 text-center shadow-sm">
            <div className="text-slate-500">Total</div>
            <div className="text-lg font-bold">{summary.total}</div>
          </div>
          <div className="rounded-xl bg-green-50 p-2 text-center text-green-700 shadow-sm">
            <div>Submitted</div>
            <div className="text-lg font-bold">{summary.submitted}</div>
          </div>
          <div className="rounded-xl bg-amber-50 p-2 text-center text-amber-800 shadow-sm">
            <div>Headcount mismatch</div>
            <div className="text-lg font-bold">{summary.mismatched}</div>
          </div>
        </div>
      )}

      {isFetching && <p className="text-sm text-slate-400">Loading…</p>}
      {reports && reports.length === 0 && !isFetching && (
        <p className="text-sm text-slate-500">No daily reports match the filters.</p>
      )}

      <ul className="flex flex-col gap-2">
        {(reports ?? []).map((r) => {
          const mismatch =
            r.headcount_reported != null &&
            r.headcount_attendance != null &&
            r.headcount_reported !== r.headcount_attendance
          return (
            <li key={r.id}>
              <Link
                to={`/supervisor/daily-report?siteId=${r.site_id}&date=${r.report_date}`}
                className="block rounded-xl bg-white p-3 shadow-sm hover:bg-slate-50"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">
                    {new Date(r.report_date).toLocaleDateString()}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${
                      r.status === 'submitted'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500">
                  {r.sites?.projects?.name ?? '—'} · {r.sites?.name ?? r.site_id.slice(0, 6)}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs">
                  <div className="text-slate-500">
                    Weather:{' '}
                    <span className="font-mono text-slate-700">{r.weather_summary ?? '—'}</span>
                  </div>
                  <div className="text-slate-500">
                    Headcount:{' '}
                    <span className={`font-mono ${mismatch ? 'text-amber-700' : 'text-slate-700'}`}>
                      {r.headcount_reported ?? '—'} / {r.headcount_attendance ?? '—'}
                    </span>
                  </div>
                </div>
                {r.work_completed && (
                  <div className="mt-1 text-xs text-slate-700">
                    <strong>Work:</strong> {r.work_completed}
                  </div>
                )}
                {r.blockers && (
                  <div className="mt-1 text-xs text-red-700">
                    <strong>Blockers:</strong> {r.blockers}
                  </div>
                )}
                <div className="mt-1 text-right text-xs text-brand-600">Edit →</div>
              </Link>
            </li>
          )
        })}
      </ul>
    </RoleScaffold>
  )
}
