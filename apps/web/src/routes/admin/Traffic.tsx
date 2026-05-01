import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

type EventTypeFilter = '' | 'page_view' | 'login' | 'login_fail' | 'logout' | 'register' | 'pin_request'
type ActorTypeFilter = '' | 'worker' | 'supervisor' | 'admin' | 'anon'

interface TrafficRow {
  id: string
  occurred_at: string
  actor_type: 'worker' | 'supervisor' | 'admin' | 'anon'
  actor_id: string | null
  actor_label: string | null
  event_type: string
  route: string | null
  ip_address: string | null
  user_agent: string | null
  device_fingerprint: string | null
  referrer: string | null
  metadata: Record<string, unknown> | null
  is_known: boolean
}

interface TrafficSummary {
  total: number
  logins: number
  failed_logins: number
  page_views: number
  unknown_traffic: number
  unique_ips: number
  unique_fingerprints: number
}

const WINDOWS: Array<{ label: string; hours: number }> = [
  { label: '1 h', hours: 1 },
  { label: '24 h', hours: 24 },
  { label: '7 d', hours: 24 * 7 },
  { label: '30 d', hours: 24 * 30 },
]

export default function AdminTraffic() {
  const [windowH, setWindowH] = useState(24)
  const [eventType, setEventType] = useState<EventTypeFilter>('')
  const [actorType, setActorType] = useState<ActorTypeFilter>('')
  const [search, setSearch] = useState('')
  const [unknownOnly, setUnknownOnly] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const since = useMemo(() => new Date(Date.now() - windowH * 3600_000).toISOString(), [windowH])

  const { data: summary } = useQuery({
    queryKey: ['traffic-summary', windowH],
    queryFn: async (): Promise<TrafficSummary> => {
      const { data, error } = await supabase.rpc('traffic_summary', { p_since: since })
      if (error) throw error
      return ((data as TrafficSummary[])?.[0]) ?? {
        total: 0, logins: 0, failed_logins: 0, page_views: 0,
        unknown_traffic: 0, unique_ips: 0, unique_fingerprints: 0,
      }
    },
    refetchInterval: 30_000,
  })

  const { data: rows, isPending } = useQuery({
    queryKey: ['traffic', windowH, eventType, actorType],
    queryFn: async (): Promise<TrafficRow[]> => {
      const { data, error } = await supabase.rpc('list_recent_traffic', {
        p_limit: 500,
        p_event_type: eventType || null,
        p_actor_type: actorType || null,
        p_since: since,
      })
      if (error) throw error
      return (data as TrafficRow[]) ?? []
    },
    refetchInterval: 30_000,
  })

  const filtered = (rows ?? []).filter((r) => {
    if (unknownOnly && r.is_known) return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (r.actor_label ?? '').toLowerCase().includes(q) ||
      (r.route ?? '').toLowerCase().includes(q) ||
      (r.ip_address ?? '').toLowerCase().includes(q) ||
      (r.user_agent ?? '').toLowerCase().includes(q) ||
      (r.device_fingerprint ?? '').toLowerCase().includes(q)
    )
  })

  return (
    <RoleScaffold title="Site traffic" backTo="/admin/projects">
      {/* Summary chips */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Events" value={summary?.total ?? 0} />
        <Stat label="Logins" value={summary?.logins ?? 0} />
        <Stat label="Failed" value={summary?.failed_logins ?? 0} tone={summary?.failed_logins ? 'red' : undefined} />
        <Stat label="Page views" value={summary?.page_views ?? 0} />
        <Stat label="Unknown" value={summary?.unknown_traffic ?? 0} tone={summary?.unknown_traffic ? 'amber' : undefined} />
        <Stat label="Unique IPs" value={summary?.unique_ips ?? 0} />
      </div>

      {/* Window picker */}
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-slate-500">Window:</span>
        {WINDOWS.map((w) => (
          <button
            key={w.hours}
            onClick={() => setWindowH(w.hours)}
            className={
              windowH === w.hours
                ? 'rounded-md bg-brand-600 px-2 py-1 font-medium text-white'
                : 'rounded-md bg-slate-200 px-2 py-1 text-slate-700'
            }
          >
            {w.label}
          </button>
        ))}
      </div>

      {/* Filter row */}
      <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
        <input
          className="input-field"
          placeholder="Search name / route / IP / fingerprint / user agent"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input-field"
            value={eventType}
            onChange={(e) => setEventType(e.target.value as EventTypeFilter)}
          >
            <option value="">All events</option>
            <option value="page_view">page_view</option>
            <option value="login">login</option>
            <option value="login_fail">login_fail</option>
            <option value="logout">logout</option>
            <option value="register">register</option>
            <option value="pin_request">pin_request</option>
          </select>
          <select
            className="input-field"
            value={actorType}
            onChange={(e) => setActorType(e.target.value as ActorTypeFilter)}
          >
            <option value="">All actors</option>
            <option value="worker">worker</option>
            <option value="supervisor">supervisor</option>
            <option value="admin">admin</option>
            <option value="anon">anon</option>
          </select>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={unknownOnly}
            onChange={(e) => setUnknownOnly(e.target.checked)}
            className="h-4 w-4"
          />
          <span>Unknown traffic only (no actor_id)</span>
        </label>
        <div className="text-xs text-slate-500">
          Showing {filtered.length} / {rows?.length ?? 0} events in last {windowH}h
        </div>
      </div>

      {/* Event list */}
      {isPending && <p className="text-slate-500">Loading…</p>}
      <ul className="flex flex-col gap-2">
        {filtered.map((r) => (
          <TrafficCard
            key={r.id}
            row={r}
            expanded={expandedId === r.id}
            onToggle={() => setExpandedId(expandedId === r.id ? null : r.id)}
          />
        ))}
      </ul>
    </RoleScaffold>
  )
}

function Stat({
  label, value, tone,
}: { label: string; value: number; tone?: 'red' | 'amber' }) {
  const toneClass =
    tone === 'red' ? 'bg-red-50 text-red-700'
    : tone === 'amber' ? 'bg-amber-50 text-amber-800'
    : 'bg-white text-slate-700'
  return (
    <div className={`rounded-xl ${toneClass} p-2 text-center text-xs shadow-sm`}>
      <div className="text-lg font-bold">{value.toLocaleString()}</div>
      <div className="opacity-70">{label}</div>
    </div>
  )
}

function eventBadge(t: string) {
  switch (t) {
    case 'login': return 'bg-green-100 text-green-800'
    case 'login_fail': return 'bg-red-100 text-red-800'
    case 'register': return 'bg-blue-100 text-blue-800'
    case 'pin_request': return 'bg-amber-100 text-amber-800'
    case 'logout': return 'bg-slate-200 text-slate-700'
    default: return 'bg-slate-100 text-slate-700'
  }
}

function TrafficCard({
  row, expanded, onToggle,
}: { row: TrafficRow; expanded: boolean; onToggle: () => void }) {
  const dt = new Date(row.occurred_at)
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  const screen = meta.screen as { width?: number; height?: number } | undefined
  const conn = meta.connection as { effectiveType?: string; downlinkMbps?: number } | undefined
  const tz = meta.timezone as string | undefined
  const lang = meta.language as string | undefined
  const platform = meta.platform as string | undefined

  return (
    <li className={`rounded-xl bg-white p-3 shadow-sm ${!row.is_known ? 'border border-amber-200' : ''}`}>
      <div className="flex items-start gap-2 text-sm">
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${eventBadge(row.event_type)}`}>
          {row.event_type}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold truncate">
              {row.actor_label ?? <em className="text-amber-700">unknown</em>}
              <span className="ml-2 text-xs font-normal text-slate-400">{row.actor_type}</span>
            </span>
            <span className="shrink-0 text-xs text-slate-400">{dt.toLocaleString()}</span>
          </div>
          <div className="mt-0.5 truncate font-mono text-xs text-slate-500">
            {row.route ?? '—'}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
            {row.ip_address && <span>IP {row.ip_address}</span>}
            {tz && <span>tz {tz}</span>}
            {lang && <span>{lang}</span>}
            {platform && <span>{platform}</span>}
            {screen?.width && <span>{screen.width}×{screen.height}</span>}
            {conn?.effectiveType && (
              <span>{conn.effectiveType}{conn.downlinkMbps ? ` ${conn.downlinkMbps}Mbps` : ''}</span>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md bg-slate-200 px-2 py-1 text-xs text-slate-700"
          aria-label={expanded ? 'Hide details' : 'Show details'}
        >
          {expanded ? '▴' : '▾'}
        </button>
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px]">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono">
            <dt className="text-slate-500">User agent</dt>
            <dd className="break-all">{row.user_agent ?? '—'}</dd>
            <dt className="text-slate-500">Fingerprint</dt>
            <dd className="break-all">{row.device_fingerprint ?? '—'}</dd>
            <dt className="text-slate-500">Referrer</dt>
            <dd className="break-all">{row.referrer ?? '—'}</dd>
          </dl>
          {Object.keys(meta).length > 0 && (
            <details className="mt-2" open>
              <summary className="cursor-pointer text-slate-600">Full digital footprint</summary>
              <pre className="mt-1 max-h-72 overflow-auto rounded bg-white p-2 text-[10px] text-slate-700">
                {JSON.stringify(meta, null, 2)}
              </pre>
            </details>
          )}
        </div>
      )}
    </li>
  )
}
