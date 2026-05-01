import { useEffect, useState } from 'react'
import RoleScaffold from '../_RoleScaffold'
import { logger, type LogEntry } from '@/lib/logger'

const LEVEL_BADGE: Record<string, string> = {
  error: 'bg-red-100 text-red-700',
  warn: 'bg-amber-100 text-amber-800',
  info: 'bg-slate-100 text-slate-700',
}

export default function AdminDiagnostics() {
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [filter, setFilter] = useState<'all' | 'error' | 'warn' | 'info'>('all')
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    setLoading(true)
    setEntries(await logger.listRecent(200))
    setLoading(false)
  }

  useEffect(() => {
    void refresh()
    // Live-update on new log events
    const onLog = () => void refresh()
    window.addEventListener('app:log', onLog)
    return () => window.removeEventListener('app:log', onLog)
  }, [])

  const visible = entries.filter((e) => filter === 'all' || e.level === filter)

  return (
    <RoleScaffold title="Diagnostics" backTo="/admin/projects">
      <p className="text-sm text-slate-600">
        Client-side log captured locally on this device (last {entries.length} of up to 500
        entries). Persists across reloads via IndexedDB. <em>Never</em> sent to a server unless
        you explicitly enable it.
      </p>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        {(['all', 'error', 'warn', 'info'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs ${
              filter === f
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            {f} {f === 'all' ? `(${entries.length})` : `(${entries.filter((e) => e.level === f).length})`}
          </button>
        ))}
        <button onClick={refresh} className="ml-auto rounded-md bg-slate-200 px-3 py-1 text-xs">
          Refresh
        </button>
        <button
          onClick={async () => {
            if (confirm('Clear all log entries from this device?')) {
              await logger.clearAll()
              await refresh()
            }
          }}
          className="rounded-md bg-red-600 px-3 py-1 text-xs text-white"
        >
          Clear
        </button>
      </div>

      {loading && <p className="text-sm text-slate-400">Loading…</p>}
      {!loading && visible.length === 0 && (
        <p className="text-sm text-slate-500">No entries match the filter.</p>
      )}

      <ul className="flex flex-col gap-1.5 text-xs">
        {visible.map((e, i) => (
          <li key={(e.id ?? i).toString()} className="rounded-lg bg-white p-2.5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <span
                className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${
                  LEVEL_BADGE[e.level] ?? 'bg-slate-100'
                }`}
              >
                {e.level}
              </span>
              <span className="text-slate-400">
                {new Date(e.timestamp).toLocaleString()}
              </span>
            </div>
            <div className="mt-1 font-mono text-xs text-slate-900 break-words">
              {e.message}
            </div>
            {e.context && Object.keys(e.context).length > 0 && (
              <div className="mt-1 text-[11px] text-slate-500">
                {Object.entries(e.context).map(([k, v]) => (
                  <span key={k} className="mr-2">
                    <strong>{k}</strong>={String(v).slice(0, 60)}
                  </span>
                ))}
              </div>
            )}
            {e.errorStack && (
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-slate-400">stack</summary>
                <pre className="mt-1 max-h-32 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-600">
                  {e.errorStack}
                </pre>
              </details>
            )}
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
