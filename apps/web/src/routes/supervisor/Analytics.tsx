import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import RoleScaffold from '../_RoleScaffold'
import { BarChart, PieChart, HorizontalBarChart } from '@/components/Charts'
import { useViewportWidth } from '@/hooks/useViewport'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import {
  useAnalyticsHoursPerProject,
  useAnalyticsHoursPerWorkerProject,
  useAnalyticsWorkerCountPerProject,
  useAnalyticsDailyAttendance,
  useAttendanceFilterOptions,
  type AnalyticsFilters,
} from '@/hooks/useAnalytics'
import { logger } from '@/lib/logger'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function daysAgoIso(n: number) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

const STATUS_BADGE: Record<string, string> = {
  verified: 'bg-green-100 text-green-700',
  pending: 'bg-slate-100 text-slate-700',
  flagged: 'bg-amber-100 text-amber-800',
  rejected: 'bg-red-100 text-red-700',
  auto_closed: 'bg-purple-100 text-purple-700',
}

const HOURS_STATUSES = ['verified', 'auto_closed']
const ALL_STATUSES = ['verified', 'pending', 'flagged', 'rejected', 'auto_closed']

const QUICK_RANGES: Array<{ label: string; days: number }> = [
  { label: 'Today',    days: 0 },
  { label: '7 d',      days: 7 },
  { label: '30 d',     days: 30 },
  { label: '90 d',     days: 90 },
]

export default function Analytics() {
  const navigate = useNavigate()
  const { enabled: flagEnabled } = useFeatureFlag('analytics_dashboard')
  const { enabled: dailyTableEnabled } = useFeatureFlag('daily_attendance_table')
  const { isDesktop } = useViewportWidth()

  // ── Filter state ────────────────────────────────────────────────────────
  const [startDate, setStartDate] = useState(daysAgoIso(30))
  const [endDate, setEndDate] = useState(todayIso())
  const [projectId, setProjectId] = useState<string | null>(null)
  const [siteId, setSiteId] = useState<string | null>(null)
  const [workerId, setWorkerId] = useState<string | null>(null)
  const [hoursStatuses, setHoursStatuses] = useState<string[]>(HOURS_STATUSES)
  const [dailyStatuses, setDailyStatuses] = useState<string[]>(ALL_STATUSES)

  // ── Filter options for site / worker dropdowns ──────────────────────────
  const { data: filterOptions } = useAttendanceFilterOptions(projectId, flagEnabled)
  const sites   = filterOptions?.sites   ?? []
  const workers = filterOptions?.workers ?? []

  // ── Shared filter object ────────────────────────────────────────────────
  const hoursFilters: AnalyticsFilters = {
    startDate, endDate, projectId, siteId, workerId, statuses: hoursStatuses,
  }
  const dailyFilters: AnalyticsFilters = {
    startDate, endDate, projectId, siteId, workerId, statuses: dailyStatuses,
  }

  // ── Data hooks ──────────────────────────────────────────────────────────
  const {
    data: hoursPerProject = [],
    isPending: hoursPerProjectLoading,
    error: hoursPerProjectError,
  } = useAnalyticsHoursPerProject(hoursFilters, flagEnabled)

  const {
    data: hoursPerWorker = [],
    isPending: hoursPerWorkerLoading,
    error: hoursPerWorkerError,
  } = useAnalyticsHoursPerWorkerProject(hoursFilters, flagEnabled)

  const {
    data: workerCounts = [],
    isPending: workerCountsLoading,
    error: workerCountsError,
  } = useAnalyticsWorkerCountPerProject({ projectId, siteId }, flagEnabled)

  const {
    data: dailyAttendance = [],
    isPending: dailyAttendanceLoading,
    error: dailyAttendanceError,
  } = useAnalyticsDailyAttendance(dailyFilters, dailyTableEnabled)

  const errors = [
    hoursPerProjectError, hoursPerWorkerError, workerCountsError, dailyAttendanceError,
  ].filter(Boolean)
  errors.forEach((error) => {
    logger.error(error as Error, { module: 'Analytics', action: 'data_fetch' })
  })

  // ── Chart data transforms (id is preserved so dropdowns work correctly) ─
  const chartHoursPerProject = useMemo(
    () => hoursPerProject.map((d) => ({
      id: d.project_id,
      name: d.project_name,
      hours: parseFloat(d.total_hours.toString()),
      workers: d.worker_count,
      punches: d.punch_count,
    })),
    [hoursPerProject],
  )

  const chartWorkerCounts = useMemo(
    () => workerCounts.map((d) => ({
      id: d.project_id,
      name: d.project_name,
      active: d.active_workers,
      total: d.total_workers,
    })),
    [workerCounts],
  )

  const filteredHoursPerWorker = useMemo(
    () => hoursPerWorker.map((d) => ({
      name: `${d.worker_name} (${d.project_name})`,
      hours: parseFloat(d.total_hours.toString()),
      days: d.days_worked,
    })).slice(0, 15),
    [hoursPerWorker],
  )

  const gridClass = isDesktop ? 'grid-cols-2 gap-6 lg:grid-cols-4' : 'grid-cols-1 gap-4'
  const isLoading =
    hoursPerProjectLoading ||
    hoursPerWorkerLoading ||
    workerCountsLoading ||
    (dailyTableEnabled && dailyAttendanceLoading)

  const setQuickRange = (days: number) => {
    setStartDate(days === 0 ? todayIso() : daysAgoIso(days))
    setEndDate(todayIso())
  }

  const toggleHoursStatus = (s: string) => {
    setHoursStatuses((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])
  }
  const toggleDailyStatus = (s: string) => {
    setDailyStatuses((cur) => cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s])
  }

  if (!flagEnabled) {
    return (
      <RoleScaffold title="Analytics" backTo="/supervisor/dashboard">
        <div className="rounded-lg bg-amber-50 p-4 text-center text-sm text-amber-800">
          <p>The analytics dashboard is not enabled yet.</p>
          <p className="mt-2 text-xs text-amber-700">
            Enable it via /admin/feature-flags (admin only).
          </p>
        </div>
      </RoleScaffold>
    )
  }

  return (
    <RoleScaffold title="Analytical Dashboard" backTo="/supervisor/dashboard">
      <div className="space-y-4">
        {/* ── Filters ───────────────────────────────────────────────────── */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Filters</h2>

          {/* Quick ranges */}
          <div className="mb-3 flex flex-wrap items-center gap-1 text-xs">
            <span className="text-slate-500">Quick range:</span>
            {QUICK_RANGES.map((r) => (
              <button
                key={r.label}
                onClick={() => setQuickRange(r.days)}
                className="rounded-md bg-slate-200 px-2 py-1 text-slate-700 hover:bg-slate-300"
              >
                {r.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">From</span>
              <input
                type="date" className="input-field" value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">To</span>
              <input
                type="date" className="input-field" value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Project</span>
              <select
                className="input-field"
                value={projectId ?? ''}
                onChange={(e) => {
                  setProjectId(e.target.value || null)
                  setSiteId(null)   // reset narrower filters
                  setWorkerId(null)
                }}
              >
                <option value="">All projects</option>
                {chartHoursPerProject.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Site</span>
              <select
                className="input-field"
                value={siteId ?? ''}
                onChange={(e) => setSiteId(e.target.value || null)}
              >
                <option value="">All sites</option>
                {sites
                  .filter((s) => !projectId || s.project_id === projectId)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Worker</span>
              <select
                className="input-field"
                value={workerId ?? ''}
                onChange={(e) => setWorkerId(e.target.value || null)}
              >
                <option value="">All workers</option>
                {workers.map((w) => (
                  <option key={w.id} value={w.id}>{w.full_name}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Status chips for hours */}
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium text-slate-600">
              Hours from punches with status:
            </div>
            <div className="flex flex-wrap gap-1 text-xs">
              {ALL_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleHoursStatus(s)}
                  className={
                    hoursStatuses.includes(s)
                      ? 'rounded-full bg-brand-600 px-2.5 py-0.5 font-medium text-white'
                      : 'rounded-full bg-slate-200 px-2.5 py-0.5 text-slate-700'
                  }
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {dailyTableEnabled && (
            <div className="mt-3">
              <div className="mb-1 text-xs font-medium text-slate-600">
                Daily-attendance table includes status:
              </div>
              <div className="flex flex-wrap gap-1 text-xs">
                {ALL_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => toggleDailyStatus(s)}
                    className={
                      dailyStatuses.includes(s)
                        ? 'rounded-full bg-brand-600 px-2.5 py-0.5 font-medium text-white'
                        : 'rounded-full bg-slate-200 px-2.5 py-0.5 text-slate-700'
                    }
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
            <span>
              {projectId || siteId || workerId ? 'Filters active.' : 'Showing every project / site / worker.'}
            </span>
            <button
              onClick={() => {
                setStartDate(daysAgoIso(30))
                setEndDate(todayIso())
                setProjectId(null)
                setSiteId(null)
                setWorkerId(null)
                setHoursStatuses(HOURS_STATUSES)
                setDailyStatuses(ALL_STATUSES)
              }}
              className="rounded-md bg-slate-100 px-3 py-1 text-slate-700 hover:bg-slate-200"
            >
              Reset filters
            </button>
          </div>
        </div>

        {/* ── Errors ──────────────────────────────────────────────────────── */}
        {errors.length > 0 && (
          <div className="rounded-lg bg-red-50 p-3 text-xs text-red-700">
            <p className="font-medium">Failed to load some data:</p>
            <ul className="mt-1 list-disc pl-5">
              {errors.map((e, i) => (
                <li key={i}>{(e as Error)?.message || 'Unknown error'}</li>
              ))}
            </ul>
          </div>
        )}

        {isLoading && (
          <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-600">
            Loading analytics data…
          </div>
        )}

        {/* ── Charts ──────────────────────────────────────────────────────── */}
        {!isLoading && (
          <div className={`grid ${gridClass}`}>
            <div className={isDesktop ? 'lg:col-span-2' : ''}>
              <BarChart
                data={chartHoursPerProject}
                dataKey="hours"
                nameKey="name"
                title="📊 Hours per Project"
                height={300}
                color="#3b82f6"
              />
            </div>
            <div className={isDesktop ? 'lg:col-span-2' : ''}>
              <BarChart
                data={chartWorkerCounts}
                dataKey="active"
                nameKey="name"
                title="👥 Active Workers per Project"
                height={300}
                color="#10b981"
              />
            </div>
            <div className={isDesktop ? 'lg:col-span-2' : ''}>
              <PieChart
                data={chartHoursPerProject}
                dataKey="hours"
                nameKey="name"
                title="🥧 Hours Distribution by Project"
                height={300}
              />
            </div>
            <div className={isDesktop ? 'lg:col-span-2' : ''}>
              <PieChart
                data={chartWorkerCounts}
                dataKey="active"
                nameKey="name"
                title="🥧 Worker Distribution by Project"
                height={300}
              />
            </div>
            {filteredHoursPerWorker.length > 0 && (
              <div className={isDesktop ? 'lg:col-span-4' : ''}>
                <HorizontalBarChart
                  data={filteredHoursPerWorker}
                  dataKey="hours"
                  nameKey="name"
                  title="⭐ Top Workers by Hours (Last 15)"
                  height={Math.max(300, filteredHoursPerWorker.length * 30)}
                  color="#8b5cf6"
                />
              </div>
            )}
          </div>
        )}

        {/* ── Daily attendance table ─────────────────────────────────────── */}
        {dailyTableEnabled && (
          <div className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-700">📅 Daily Attendance</h2>
              <span className="text-xs text-slate-500">{dailyAttendance.length} rows</span>
            </div>

            {dailyAttendanceLoading && (
              <div className="p-4 text-center text-sm text-slate-500">Loading…</div>
            )}

            {!dailyAttendanceLoading && dailyAttendance.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500">
                No attendance records match the selected filters.
              </div>
            )}

            {!dailyAttendanceLoading && dailyAttendance.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Date</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Worker</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Project</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Site</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">In</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">Out</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">Hours</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Status</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Flags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyAttendance.map((row, idx) => (
                      <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                        <td className="px-3 py-2 text-slate-700">{row.attendance_date}</td>
                        <td className="px-3 py-2 font-medium text-slate-700">{row.worker_name}</td>
                        <td className="px-3 py-2 text-slate-600">{row.project_name}</td>
                        <td className="px-3 py-2 text-slate-600">{row.site_name}</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {row.punch_in_time ?? '—'}
                        </td>
                        <td className={`px-3 py-2 text-right ${row.punch_out_time ? 'text-slate-700' : 'text-amber-700'}`}>
                          {row.punch_out_time ?? 'open'}
                        </td>
                        <td className={`px-3 py-2 text-right font-medium ${row.hours_worked == null ? 'text-amber-700' : 'text-slate-700'}`}>
                          {row.hours_worked == null ? '—' : Number(row.hours_worked).toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              STATUS_BADGE[row.status] || 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {row.status}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-amber-700">
                          {row.flag_reasons?.length ? row.flag_reasons.join(', ') : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </RoleScaffold>
  )
}
