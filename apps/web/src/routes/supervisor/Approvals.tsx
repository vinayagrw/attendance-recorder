import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'
import SelfieThumb from '@/components/SelfieThumb'
import { logger } from '@/lib/logger'

interface PendingWorker {
  id: string
  full_name: string
  status: string
  baseline_selfie_url: string | null
  registered_at: string | null
  phone: string | null
}

type Tab = 'pending_approval' | 'invited'

export default function SupervisorApprovals() {
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()
  const [tab, setTab] = useState<Tab>('pending_approval')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const { data, isPending } = useQuery({
    queryKey: ['workers-by-status', tab],
    queryFn: async (): Promise<PendingWorker[]> => {
      const { data, error } = await supabase
        .from('workers')
        .select('id, full_name, status, baseline_selfie_url, registered_at, phone')
        .eq('status', tab)
        .order('registered_at', { nullsFirst: true })
      if (error) throw error
      return (data as PendingWorker[]) ?? []
    },
    refetchInterval: 30_000,
  })

  const approve = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('workers')
        .update({
          status: 'active',
          approved_by: supervisor?.id,
          approved_at: new Date().toISOString(),
        })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      logger.info('workers approved', { module: 'Approvals', count: selected.size })
      qc.invalidateQueries({ queryKey: ['workers-by-status'] })
      qc.invalidateQueries({ queryKey: ['pending-approvals-count'] })
      setSelected(new Set())
    },
    onError: (e) => logger.error(e, { module: 'Approvals', action: 'approve' }),
  })

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt('Reason for rejection?') ?? ''
      const { error } = await supabase
        .from('workers')
        .update({ status: 'suspended' })
        .eq('id', id)
      if (error) throw error
      if (reason) console.info(`[reject_worker] ${id}: ${reason}`)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workers-by-status'] }),
  })

  const toggleAll = () => {
    if (!data) return
    if (selected.size === data.length) setSelected(new Set())
    else setSelected(new Set(data.map((w) => w.id)))
  }
  const toggle = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  return (
    <RoleScaffold title="Worker approvals" backTo="/supervisor/dashboard">
      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm">
        <button
          onClick={() => { setTab('pending_approval'); setSelected(new Set()) }}
          className={`flex-1 rounded-lg py-2 ${
            tab === 'pending_approval' ? 'bg-white shadow' : 'text-slate-600'
          }`}
        >
          Pending approval
        </button>
        <button
          onClick={() => { setTab('invited'); setSelected(new Set()) }}
          className={`flex-1 rounded-lg py-2 ${
            tab === 'invited' ? 'bg-white shadow' : 'text-slate-600'
          }`}
        >
          Invited (not registered)
        </button>
      </div>

      {/* Bulk actions */}
      {(data?.length ?? 0) > 0 && tab === 'pending_approval' && (
        <div className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 text-sm">
          <button
            onClick={toggleAll}
            className="rounded-md bg-slate-200 px-2 py-1 text-xs"
          >
            {selected.size === data?.length ? 'Clear' : 'Select all'}
          </button>
          <span className="text-slate-500">{selected.size} selected</span>
          <button
            onClick={() => approve.mutate([...selected])}
            disabled={selected.size === 0 || approve.isPending}
            className="ml-auto rounded-md bg-green-600 px-3 py-1 text-xs text-white disabled:opacity-50"
          >
            Approve {selected.size}
          </button>
        </div>
      )}

      {isPending && <p className="text-slate-500">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">
          No workers in {tab === 'pending_approval' ? 'pending' : 'invited'} state.
        </p>
      )}

      <ul className="flex flex-col gap-3">
        {(data ?? []).map((w) => (
          <li key={w.id} className="flex items-start gap-3 rounded-xl bg-white p-3 shadow-sm">
            {tab === 'pending_approval' && (
              <input
                type="checkbox"
                checked={selected.has(w.id)}
                onChange={() => toggle(w.id)}
                className="mt-1 h-5 w-5"
              />
            )}
            <SelfieThumb path={w.baseline_selfie_url} size={64} />
            <div className="flex-1">
              <div className="font-semibold">{w.full_name}</div>
              <div className="text-xs text-slate-500">
                {w.phone ?? 'no phone'}
                {w.registered_at
                  ? ` · registered ${new Date(w.registered_at).toLocaleString()}`
                  : ' · not yet registered'}
              </div>
            </div>
            {tab === 'pending_approval' && (
              <div className="flex flex-col gap-1">
                <button
                  onClick={() => approve.mutate([w.id])}
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
            )}
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
