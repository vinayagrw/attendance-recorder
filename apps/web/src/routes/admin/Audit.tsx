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
  before_state: unknown
  after_state: unknown
  prev_hash: string | null
  row_hash: string | null
  created_at: string
}

export default function AdminAudit() {
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

  return (
    <RoleScaffold title="Audit log" backTo="/admin/projects">
      <p className="text-xs text-slate-400">
        Last 200 entries. Each row's <code>row_hash</code> chains to the previous via{' '}
        <code>prev_hash</code> (SHA-256). UPDATE / DELETE on this table is revoked.
      </p>
      {isPending && <p className="text-slate-500">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">No audit entries yet.</p>
      )}
      <ul className="flex flex-col gap-1.5 text-xs font-mono">
        {(data ?? []).map((r) => (
          <li key={r.id} className="rounded bg-white p-2 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">{new Date(r.created_at).toLocaleString()}</span>
              <span className="text-slate-400">
                {r.row_hash ? r.row_hash.slice(0, 8) : '—'}
              </span>
            </div>
            <div className="mt-0.5">
              <strong>{r.action}</strong> on {r.target_table}
              {r.target_id ? `:${r.target_id.slice(0, 8)}` : ''}
            </div>
            {r.actor_id && (
              <div className="text-slate-400">
                by {r.actor_role ?? '?'} {r.actor_id.slice(0, 8)}
              </div>
            )}
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
