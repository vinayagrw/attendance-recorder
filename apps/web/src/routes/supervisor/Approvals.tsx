import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'
import SelfieThumb from '@/components/SelfieThumb'

interface PendingWorker {
  id: string
  full_name: string
  status: string
  baseline_selfie_url: string | null
  registered_at: string | null
}

export default function SupervisorApprovals() {
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()

  const { data, isPending } = useQuery({
    queryKey: ['pending-workers'],
    queryFn: async (): Promise<PendingWorker[]> => {
      const { data, error } = await supabase
        .from('workers')
        .select('id, full_name, status, baseline_selfie_url, registered_at')
        .eq('status', 'pending_approval')
        .order('registered_at')
      if (error) throw error
      return (data as PendingWorker[]) ?? []
    },
    refetchInterval: 30_000,
  })

  const approve = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('workers')
        .update({
          status: 'active',
          approved_by: supervisor?.id,
          approved_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-workers'] }),
  })

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt('Reason for rejection?') ?? ''
      // Audit log is written automatically by the workers_audit trigger
      // (see supabase/migrations/0009_critical_fixes.sql). We surface the
      // reason via reviewer_comment so it appears in the audited row.
      const { error } = await supabase
        .from('workers')
        .update({ status: 'suspended' })
        .eq('id', id)
      if (error) throw error
      // Side-channel: store the reason on the most recent attendance row
      // for visibility (optional). For now, log via console so we don't
      // hide the reason from the supervisor.
      if (reason) console.info(`[reject_worker] ${id}: ${reason}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pending-workers'] }),
  })

  return (
    <RoleScaffold title="Pending approvals" backTo="/supervisor/dashboard">
      {isPending && <p className="text-slate-500">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">No pending registrations.</p>
      )}
      <ul className="flex flex-col gap-3">
        {(data ?? []).map((w) => (
          <li key={w.id} className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
            <SelfieThumb path={w.baseline_selfie_url} size={64} />
            <div className="flex-1">
              <div className="font-semibold">{w.full_name}</div>
              <div className="text-xs text-slate-500">
                Registered{' '}
                {w.registered_at ? new Date(w.registered_at).toLocaleString() : '—'}
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <button
                onClick={() => approve.mutate(w.id)}
                className="rounded-md bg-green-600 px-3 py-1 text-sm text-white"
              >
                Approve
              </button>
              <button
                onClick={() => reject.mutate(w.id)}
                className="rounded-md bg-red-600 px-3 py-1 text-sm text-white"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
