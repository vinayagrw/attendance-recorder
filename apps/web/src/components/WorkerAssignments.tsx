import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

interface Assignment {
  id: string
  site_id: string
  is_primary: boolean
  sites: { name: string } | null
}

interface SiteOption {
  id: string
  name: string
}

interface Props {
  workerId: string
  allSites: SiteOption[]
}

// Inline chip-style manager for a worker's site assignments. Drop into any
// row showing a worker. Hits worker_site_assignments directly; RLS gates
// supervisors to sites in their project scope.
export default function WorkerAssignments({ workerId, allSites }: Props) {
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [siteToAdd, setSiteToAdd] = useState('')

  const { data: assignments, isPending } = useQuery({
    queryKey: ['worker-assignments', workerId],
    queryFn: async (): Promise<Assignment[]> => {
      const { data, error } = await supabase
        .from('worker_site_assignments')
        .select('id, site_id, is_primary, sites(name)')
        .eq('worker_id', workerId)
        .is('valid_to', null)
      if (error) throw error
      return ((data as unknown) as Assignment[]) ?? []
    },
  })

  const add = useMutation({
    mutationFn: async (siteId: string) => {
      const { error } = await supabase.from('worker_site_assignments').insert({
        worker_id: workerId,
        site_id: siteId,
        is_primary: false,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['worker-assignments', workerId] })
      setSiteToAdd('')
      setAdding(false)
    },
  })

  const remove = useMutation({
    mutationFn: async (assignmentId: string) => {
      const { error } = await supabase
        .from('worker_site_assignments')
        .delete()
        .eq('id', assignmentId)
      if (error) throw error
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['worker-assignments', workerId] }),
  })

  const togglePrimary = useMutation({
    mutationFn: async (assignmentId: string) => {
      // Clear all is_primary flags for this worker, then set the chosen one
      const { error: e1 } = await supabase
        .from('worker_site_assignments')
        .update({ is_primary: false })
        .eq('worker_id', workerId)
      if (e1) throw e1
      const { error: e2 } = await supabase
        .from('worker_site_assignments')
        .update({ is_primary: true })
        .eq('id', assignmentId)
      if (e2) throw e2
    },
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ['worker-assignments', workerId] }),
  })

  const assignedIds = new Set((assignments ?? []).map((a) => a.site_id))
  const candidates = allSites.filter((s) => !assignedIds.has(s.id))

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-slate-500">Sites:</span>
      {isPending && <span className="text-slate-400">…</span>}
      {(assignments ?? []).length === 0 && !isPending && (
        <span className="italic text-slate-400">none assigned</span>
      )}
      {(assignments ?? []).map((a) => (
        <span
          key={a.id}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
            a.is_primary
              ? 'bg-emerald-100 text-emerald-800'
              : 'bg-slate-100 text-slate-700'
          }`}
        >
          <button
            type="button"
            onClick={() => togglePrimary.mutate(a.id)}
            title={a.is_primary ? 'Primary site' : 'Set as primary'}
            className="hover:underline"
          >
            {a.sites?.name ?? a.site_id.slice(0, 6)}
            {a.is_primary && ' ★'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirm(`Remove ${a.sites?.name ?? 'this site'} from this worker?`))
                remove.mutate(a.id)
            }}
            aria-label="Remove assignment"
            className="text-slate-500 hover:text-red-600"
          >
            ×
          </button>
        </span>
      ))}

      {!adding && candidates.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-slate-600 hover:bg-slate-50"
        >
          + Site
        </button>
      )}
      {adding && (
        <span className="inline-flex items-center gap-1">
          <select
            value={siteToAdd}
            onChange={(e) => setSiteToAdd(e.target.value)}
            className="rounded-md border border-slate-300 px-1 py-0.5 text-xs"
          >
            <option value="">— pick —</option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => siteToAdd && add.mutate(siteToAdd)}
            disabled={!siteToAdd || add.isPending}
            className="rounded-md bg-brand-600 px-2 py-0.5 text-white disabled:opacity-50"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setSiteToAdd('') }}
            className="text-slate-500"
          >
            Cancel
          </button>
        </span>
      )}
    </div>
  )
}
