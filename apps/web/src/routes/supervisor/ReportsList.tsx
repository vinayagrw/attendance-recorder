import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import SelfieThumb from '@/components/SelfieThumb'
import { logger } from '@/lib/logger'

interface FilteredRow {
  id: string
  worker_id: string
  worker_name: string
  site_id: string
  site_name: string
  project_id: string
  project_name: string
  type: 'in' | 'out'
  status: string
  punched_at: string
  distance_from_site_m: number | null
  selfie_url: string | null
  flag_reasons: string[] | null
  reviewer_comment: string | null
}

type Grouping = 'flat' | 'project' | 'worker' | 'day'

const STATUSES = ['', 'pending', 'verified', 'flagged', 'rejected', 'auto_closed']
const TYPES = ['', 'in', 'out']

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

export default function SupervisorReportsList() {
  const [startDate, setStartDate] = useState(daysAgoIso(7))
  const [endDate, setEndDate] = useState(todayIso())
  const [projectId, setProjectId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [workerId, setWorkerId] = useState('')
  const [status, setStatus] = useState('')
  const [type, setType] = useState('')
  const [grouping, setGrouping] = useState<Grouping>('flat')
  const [page, setPage] = useState(0)
  const PAGE = 100

  const { data: projects } = useQuery({
    queryKey: ['rl-projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('id, name').order('name')
      return (data as Array<{ id: string; name: string }>) ?? []
    },
  })
  const { data: sites } = useQuery({
    queryKey: ['rl-sites', projectId],
    queryFn: async () => {
      let q = supabase.from('sites').select('id, name, project_id').order('name')
      if (projectId) q = q.eq('project_id', projectId)
      const { data } = await q
      return (data as Array<{ id: string; name: string; project_id: string }>) ?? []
    },
  })
  const { data: workers } = useQuery({
    queryKey: ['rl-workers'],
    queryFn: async () => {
      const { data } = await supabase
        .from('workers')
        .select('id, full_name, status')
        .order('full_name')
      return (data as Array<{ id: string; full_name: string; status: string }>) ?? []
    },
  })

  const { data: rows, isFetching, error } = useQuery({
    queryKey: ['reports-list', startDate, endDate, projectId, siteId, workerId, status, type, page],
    queryFn: async (): Promise<FilteredRow[]> => {
      const startTs = new Date(`${startDate}T00:00:00`).toISOString()
      const endTs = new Date(`${endDate}T23:59:59`).toISOString()
      const { data, error } = await supabase.rpc('attendance_filtered', {
        p_start: startTs,
        p_end: endTs,
        p_project_id: projectId || null,
        p_site_id: siteId || null,
        p_worker_id: workerId || null,
        p_status: status || null,
        p_type: type || null,
        p_limit: PAGE,
        p_offset: page * PAGE,
      })
      if (error) {
        logger.error(error, { module: 'ReportsList', action: 'attendance_filtered' })
        throw error
      }
      return (data as FilteredRow[]) ?? []
    },
  })

  const grouped = useMemo(() => {
    if (!rows || grouping === 'flat') return null
    const map = new Map<string, FilteredRow[]>()
    for (const r of rows) {
      let key: string
      if (grouping === 'project') key = r.project_name
      else if (grouping === 'worker') key = r.worker_name
      else /* day */ key = new Date(r.punched_at).toLocaleDateString()
      const arr = map.get(key) ?? []
      arr.push(r)
      map.set(key, arr)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [rows, grouping])

  const summary = useMemo(() => {
    if (!rows) return null
    return {
      total: rows.length,
      verified: rows.filter((r) => r.status === 'verified').length,
      flagged: rows.filter((r) => r.status === 'flagged').length,
      pending: rows.filter((r) => r.status === 'pending').length,
      autoClosed: rows.filter((r) => r.status === 'auto_closed').length,
      uniqueWorkers: new Set(rows.map((r) => r.worker_id)).size,
      uniqueSites: new Set(rows.map((r) => r.site_id)).size,
    }
  }, [rows])

  const clearFilters = () => {
    setStartDate(daysAgoIso(7))
    setEndDate(todayIso())
    setProjectId('')
    setSiteId('')
    setWorkerId('')
    setStatus('')
    setType('')
    setPage(0)
  }

  return (
    <RoleScaffold title="Attendance reports" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Filter punches by project, site, worker, status, type, and date range. Click any row to
        edit it.
      </p>

      {/* Filters */}
      <div className="grid grid-cols-2 gap-2 rounded-xl bg-white p-3 shadow-sm">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">From</span>
          <input
            type="date"
            className="input-field py-2 text-sm"
            value={startDate}
            onChange={(e) => { setStartDate(e.target.value); setPage(0) }}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">To</span>
          <input
            type="date"
            className="input-field py-2 text-sm"
            value={endDate}
            onChange={(e) => { setEndDate(e.target.value); setPage(0) }}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Project</span>
          <select
            className="input-field py-2 text-sm"
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); setSiteId(''); setPage(0) }}
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
            onChange={(e) => { setSiteId(e.target.value); setPage(0) }}
          >
            <option value="">{projectId ? 'All sites in project' : 'All sites'}</option>
            {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Worker</span>
          <select
            className="input-field py-2 text-sm"
            value={workerId}
            onChange={(e) => { setWorkerId(e.target.value); setPage(0) }}
          >
            <option value="">All workers</option>
            {(workers ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.full_name} · {w.status}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Status</span>
          <select
            className="input-field py-2 text-sm"
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPage(0) }}
          >
            {STATUSES.map((s) => <option key={s || 'all'} value={s}>{s || 'All'}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium text-slate-600">Type</span>
          <select
            className="input-field py-2 text-sm"
            value={type}
            onChange={(e) => { setType(e.target.value); setPage(0) }}
          >
            {TYPES.map((t) => <option key={t || 'all'} value={t}>{t || 'All'}</option>)}
          </select>
        </label>
        <div className="col-span-2 flex items-center justify-between gap-2 pt-1 text-xs">
          <div className="flex gap-1">
            {(['flat', 'project', 'worker', 'day'] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGrouping(g)}
                className={`rounded-full px-2 py-1 ${
                  grouping === g
                    ? 'bg-brand-600 text-white'
                    : 'bg-slate-100 text-slate-700'
                }`}
              >
                {g === 'flat' ? 'No grouping' : `By ${g}`}
              </button>
            ))}
          </div>
          <button onClick={clearFilters} className="text-slate-500 underline">
            Clear filters
          </button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-2 text-xs">
          <div className="rounded-xl bg-white p-2 text-center shadow-sm">
            <div className="text-slate-500">Total</div>
            <div className="text-lg font-bold">{summary.total}</div>
          </div>
          <div className="rounded-xl bg-green-50 p-2 text-center text-green-700 shadow-sm">
            <div>Verified</div>
            <div className="text-lg font-bold">{summary.verified}</div>
          </div>
          <div className="rounded-xl bg-amber-50 p-2 text-center text-amber-700 shadow-sm">
            <div>Flagged</div>
            <div className="text-lg font-bold">{summary.flagged}</div>
          </div>
          <div className="rounded-xl bg-slate-50 p-2 text-center text-slate-700 shadow-sm">
            <div>Pending</div>
            <div className="text-lg font-bold">{summary.pending}</div>
          </div>
          <div className="rounded-xl bg-purple-50 p-2 text-center text-purple-700 shadow-sm">
            <div>Auto-closed</div>
            <div className="text-lg font-bold">{summary.autoClosed}</div>
          </div>
          <div className="rounded-xl bg-blue-50 p-2 text-center text-blue-700 shadow-sm">
            <div>Workers · sites</div>
            <div className="text-lg font-bold">{summary.uniqueWorkers} · {summary.uniqueSites}</div>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {(error as Error).message}
        </div>
      )}
      {isFetching && <p className="text-sm text-slate-400">Loading…</p>}

      {/* Rows */}
      {!isFetching && rows && rows.length === 0 && (
        <p className="text-sm text-slate-500">No punches match the filters.</p>
      )}

      {!isFetching && grouped == null && rows && (
        <ul className="flex flex-col gap-2">
          {rows.map((r) => <PunchRow key={r.id} row={r} />)}
        </ul>
      )}

      {!isFetching && grouped != null && (
        <div className="flex flex-col gap-3">
          {grouped.map(([key, list]) => (
            <section key={key}>
              <h3 className="mb-1 text-sm font-semibold text-slate-700">
                {key} <span className="text-slate-400">({list.length})</span>
              </h3>
              <ul className="flex flex-col gap-2">
                {list.map((r) => <PunchRow key={r.id} row={r} />)}
              </ul>
            </section>
          ))}
        </div>
      )}

      {/* Pagination */}
      {rows && rows.length === PAGE && (
        <div className="flex items-center justify-center gap-2 pt-2 text-xs">
          <button
            disabled={page === 0}
            onClick={() => setPage(Math.max(0, page - 1))}
            className="rounded-md bg-slate-200 px-3 py-1 disabled:opacity-50"
          >
            ← prev
          </button>
          <span>page {page + 1}</span>
          <button
            onClick={() => setPage(page + 1)}
            className="rounded-md bg-slate-200 px-3 py-1"
          >
            next →
          </button>
        </div>
      )}
    </RoleScaffold>
  )
}

function PunchRow({ row }: { row: FilteredRow }) {
  const dt = new Date(row.punched_at)
  return (
    <li className="rounded-xl bg-white p-2 shadow-sm">
      <Link to={`/supervisor/edit-punch/${row.id}`} className="flex gap-2">
        <SelfieThumb path={row.selfie_url} size={48} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate font-semibold">{row.worker_name}</span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${STATUS_BADGE[row.status] ?? 'bg-slate-100'}`}>
              {row.status}
            </span>
          </div>
          <div className="text-xs text-slate-500">
            {row.type.toUpperCase()} · {dt.toLocaleString()}
          </div>
          <div className="truncate text-[11px] text-slate-400">
            {row.project_name} · {row.site_name}
            {row.distance_from_site_m != null ? ` · ${row.distance_from_site_m.toFixed(0)} m` : ''}
          </div>
          {row.flag_reasons && row.flag_reasons.length > 0 && (
            <div className="mt-1 text-[11px] text-amber-700">⚠ {row.flag_reasons.join(', ')}</div>
          )}
        </div>
      </Link>
    </li>
  )
}
