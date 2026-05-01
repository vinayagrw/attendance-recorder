import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

interface AuditRow {
  id: string
  actor_id: string | null
  actor_role: string | null
  action: string
  target_table: string
  target_id: string | null
  before_state: Record<string, unknown> | null
  after_state: Record<string, unknown> | null
  prev_hash: string | null
  row_hash: string | null
  created_at: string
}

export default function AdminAudit() {
  const [filterTable, setFilterTable] = useState<string>('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['audit-log'],
    queryFn: async (): Promise<AuditRow[]> => {
      const { data } = await supabase
        .from('audit_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200)
      return (data as AuditRow[]) ?? []
    },
    refetchInterval: 30_000,
  })

  const tables = Array.from(new Set((data ?? []).map((r) => r.target_table))).sort()
  const visible = filterTable
    ? (data ?? []).filter((r) => r.target_table === filterTable)
    : data ?? []

  return (
    <RoleScaffold title="Audit log" backTo="/admin/projects">
      <p className="text-xs text-slate-400">
        Last 200 entries. Each row's <code>row_hash</code> chains via{' '}
        <code>prev_hash</code> (SHA-256). UPDATE / DELETE on this table is revoked. Tap a row
        to see the before/after diff.
      </p>

      <div className="flex flex-wrap items-center gap-1 text-xs">
        <button
          onClick={() => setFilterTable('')}
          className={`rounded-full px-2 py-1 ${
            !filterTable ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-700'
          }`}
        >
          All ({data?.length ?? 0})
        </button>
        {tables.map((t) => (
          <button
            key={t}
            onClick={() => setFilterTable(t)}
            className={`rounded-full px-2 py-1 ${
              filterTable === t
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {isPending && <p className="text-slate-500">Loading…</p>}
      {!isPending && visible.length === 0 && (
        <p className="text-sm text-slate-500">No audit entries match.</p>
      )}

      <ul className="flex flex-col gap-1.5 text-xs">
        {visible.map((r) => {
          const isOpen = expanded === r.id
          return (
            <li key={r.id} className="rounded bg-white p-2 shadow-sm">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : r.id)}
                className="block w-full text-left"
              >
                <div className="flex items-center justify-between font-mono">
                  <span className="text-slate-500">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                  <span className="text-slate-400">
                    {r.row_hash ? r.row_hash.slice(0, 8) : '—'}
                  </span>
                </div>
                <div className="mt-0.5 font-mono">
                  <strong>{r.action}</strong> on {r.target_table}
                  {r.target_id ? `:${r.target_id.slice(0, 8)}` : ''}
                </div>
                {r.actor_id && (
                  <div className="font-mono text-slate-400">
                    by {r.actor_role ?? '?'} {r.actor_id.slice(0, 8)}
                  </div>
                )}
              </button>

              {isOpen && (
                <DiffView before={r.before_state} after={r.after_state} />
              )}
            </li>
          )
        })}
      </ul>
    </RoleScaffold>
  )
}

function DiffView({
  before,
  after,
}: {
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}) {
  // Build the union of keys to render side-by-side
  const allKeys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ).sort()

  if (allKeys.length === 0) {
    return (
      <div className="mt-2 rounded border border-slate-200 p-2 text-[11px] text-slate-500">
        No before/after data on this entry.
      </div>
    )
  }

  return (
    <div className="mt-2 overflow-x-auto rounded border border-slate-200">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="bg-slate-100 text-left text-slate-600">
            <th className="px-2 py-1">field</th>
            <th className="px-2 py-1">before</th>
            <th className="px-2 py-1">after</th>
          </tr>
        </thead>
        <tbody>
          {allKeys.map((k) => {
            const b = before?.[k]
            const a = after?.[k]
            const changed = JSON.stringify(b) !== JSON.stringify(a)
            return (
              <tr
                key={k}
                className={changed ? 'bg-amber-50' : 'border-t border-slate-100'}
              >
                <td className="px-2 py-1 font-mono text-slate-700">{k}</td>
                <td className="px-2 py-1 font-mono text-slate-600 break-all">
                  {b === undefined ? <em className="text-slate-300">—</em> : pretty(b)}
                </td>
                <td
                  className={`px-2 py-1 font-mono break-all ${
                    changed ? 'font-semibold text-slate-900' : 'text-slate-600'
                  }`}
                >
                  {a === undefined ? <em className="text-slate-300">—</em> : pretty(a)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function pretty(v: unknown): string {
  if (v === null) return 'null'
  if (typeof v === 'string') return v.length > 80 ? v.slice(0, 80) + '…' : v
  return JSON.stringify(v)
}
