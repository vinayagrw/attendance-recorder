import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import RoleScaffold from '../_RoleScaffold'
import { BarChart, PieChart, HorizontalBarChart } from '@/components/Charts'
import { useLayoutMode, useViewportWidth } from '@/hooks/useViewport'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import {
  useAnalyticsHoursPerProject,
  useAnalyticsHoursPerWorkerProject,
  useAnalyticsWorkerCountPerProject,
  useAnalyticsDailyAttendance,
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

export default function Analytics() {
  const navigate = useNavigate()
  const { enabled: flagEnabled } = useFeatureFlag('analytics_dashboard')
  const { enabled: dailyTableEnabled } = useFeatureFlag('daily_attendance_table')
  const { mode, toggleMode } = useLayoutMode()
  const { isDesktop } = useViewportWidth()

  const [startDate, setStartDate] = useState(daysAgoIso(30))
  const [endDate, setEndDate] = useState(todayIso())
  const [projectId, setProjectId] = useState<string | null>(null)

  // Fetch analytics data
  const {
    data: hoursPerProject = [],
    isPending: hoursPerProjectLoading,
    error: hoursPerProjectError,
  } = useAnalyticsHoursPerProject(startDate, endDate, flagEnabled)

  const {
    data: hoursPerWorker = [],
    isPending: hoursPerWorkerLoading,
    error: hoursPerWorkerError,
  } = useAnalyticsHoursPerWorkerProject(startDate, endDate, projectId, flagEnabled)

  const {
    data: workerCounts = [],
    isPending: workerCountsLoading,
    error: workerCountsError,
  } = useAnalyticsWorkerCountPerProject(flagEnabled)

  const {
    data: dailyAttendance = [],
    isPending: dailyAttendanceLoading,
    error: dailyAttendanceError,
  } = useAnalyticsDailyAttendance(startDate, endDate, projectId, dailyTableEnabled)

  // Log errors
  const errors = [
    hoursPerProjectError,
    hoursPerWorkerError,
    workerCountsError,
    dailyAttendanceError,
  ].filter(Boolean)

  errors.forEach((error) => {
    logger.error(error as Error, { module: 'Analytics', action: 'data_fetch' })
  })

  // Transform data for charts
  const chartHoursPerProject = useMemo(() => {
    return hoursPerProject.map((d) => ({
      name: d.project_name,
      hours: parseFloat(d.total_hours.toString()),
      workers: d.worker_count,
      punches: d.punch_count,
    }))
  }, [hoursPerProject])

  const chartWorkerCounts = useMemo(() => {
    return workerCounts.map((d) => ({
      name: d.project_name,
      active: d.active_workers,
      total: d.total_workers,
    }))
  }, [workerCounts])

  const filteredHoursPerWorker = useMemo(() => {
    return hoursPerWorker
      .filter((d) => !projectId || d.project_id === projectId)
      .map((d) => ({
        name: `${d.worker_name} (${d.project_name})`,
        hours: parseFloat(d.total_hours.toString()),
        days: d.days_worked,
      }))
      .slice(0, 15) // Top 15 workers
  }, [hoursPerWorker, projectId])

  // Grid classes based on layout mode
  const gridClass =
    mode === 'desktop' && isDesktop
      ? 'grid-cols-2 gap-6 lg:grid-cols-4'
      : 'grid-cols-1 gap-4'

  const isLoading =
    hoursPerProjectLoading ||
    hoursPerWorkerLoading ||
    workerCountsLoading ||
    (dailyTableEnabled && dailyAttendanceLoading)

  if (!flagEnabled) {
    return (
      <RoleScaffold title="Analytics" backTo="/supervisor/dashboard">
        <div className="rounded-lg bg-amber-50 p-4 text-center text-sm text-amber-800">
          <p>The analytics dashboard is not enabled yet.</p>
          <p className="mt-2 text-xs text-amber-700">
            Contact your administrator to enable this feature.
          </p>
        </div>
      </RoleScaffold>
    )
  }

  return (
    <RoleScaffold title="Analytical Dashboard" backTo="/supervisor/dashboard">
      <div className="space-y-4">
        {/* Filters & Controls */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Filters & View</h2>
            <button
              onClick={toggleMode}
              className="text-xs px-3 py-1 rounded-md bg-slate-100 text-slate-700 hover:bg-slate-200"
            >
              {mode === 'desktop' ? '📱 Mobile' : '🖥 Desktop'}
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">From</span>
              <input
                type="date"
                className="input-field"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">To</span>
              <input
                type="date"
                className="input-field"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-slate-600">Project</span>
              <select
                className="input-field"
                value={projectId || ''}
                onChange={(e) => setProjectId(e.target.value || null)}
              >
                <option value="">All projects</option>
                {chartHoursPerProject.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              onClick={() => {
                setStartDate(daysAgoIso(30))
                setEndDate(todayIso())
                setProjectId(null)
              }}
              className="rounded-md bg-slate-100 px-3 py-2 text-xs text-slate-700 hover:bg-slate-200 mt-5"
            >
              Reset filters
            </button>
          </div>
        </div>

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

        {!isLoading && (
          <div className={`grid ${gridClass}`}>
            {/* Hours per Project */}
            <div className={mode === 'desktop' && isDesktop ? 'lg:col-span-2' : ''}>
              <BarChart
                data={chartHoursPerProject}
                dataKey="hours"
                nameKey="name"
                title="📊 Hours per Project"
                height={300}
                color="#3b82f6"
              />
            </div>

            {/* Worker Count per Project */}
            <div className={mode === 'desktop' && isDesktop ? 'lg:col-span-2' : ''}>
              <BarChart
                data={chartWorkerCounts}
                dataKey="active"
                nameKey="name"
                title="👥 Active Workers per Project"
                height={300}
                color="#10b981"
              />
            </div>

            {/* Hours Distribution Pie Chart */}
            <div className={mode === 'desktop' && isDesktop ? 'lg:col-span-2' : ''}>
              <PieChart
                data={chartHoursPerProject}
                dataKey="hours"
                nameKey="name"
                title="🥧 Hours Distribution by Project"
                height={300}
              />
            </div>

            {/* Worker Distribution */}
            <div className={mode === 'desktop' && isDesktop ? 'lg:col-span-2' : ''}>
              <PieChart
                data={chartWorkerCounts}
                dataKey="active"
                nameKey="name"
                title="🥧 Worker Distribution by Project"
                height={300}
              />
            </div>

            {/* Top Workers by Hours */}
            {filteredHoursPerWorker.length > 0 && (
              <div className={mode === 'desktop' && isDesktop ? 'lg:col-span-4' : ''}>
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

        {/* Daily Attendance Table */}
        {dailyTableEnabled && (
          <div className="rounded-xl bg-white shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h2 className="text-sm font-semibold text-slate-700">📅 Daily Attendance</h2>
            </div>

            {dailyAttendanceLoading && (
              <div className="p-4 text-center text-sm text-slate-500">
                Loading attendance data…
              </div>
            )}

            {!dailyAttendanceLoading && dailyAttendance.length === 0 && (
              <div className="p-4 text-center text-sm text-slate-500">
                No attendance records found for the selected period.
              </div>
            )}

            {!dailyAttendanceLoading && dailyAttendance.length > 0 && (
              <div className={mode === 'desktop' && isDesktop ? 'overflow-x-auto' : ''}>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Date</th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Worker
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Project
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">Site</th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        In Time
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Out Time
                      </th>
                      <th className="px-3 py-2 text-right font-semibold text-slate-700">
                        Hours
                      </th>
                      <th className="px-3 py-2 text-left font-semibold text-slate-700">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyAttendance.map((row, idx) => (
                      <tr
                        key={idx}
                        className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}
                      >
                        <td className="px-3 py-2 text-slate-700">{row.attendance_date}</td>
                        <td className="px-3 py-2 text-slate-700 font-medium">
                          {row.worker_name}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{row.project_name}</td>
                        <td className="px-3 py-2 text-slate-600">{row.site_name}</td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {row.punch_in_time}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-700">
                          {row.punch_out_time || '—'}
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-slate-700">
                          {row.hours_worked.toFixed(2)}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                              STATUS_BADGE[row.status] ||
                              'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {row.status}
                          </span>
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

