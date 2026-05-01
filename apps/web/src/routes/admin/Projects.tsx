import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

interface Project {
  id: string
  name: string
  client_name: string | null
  status: string
  start_date: string | null
  end_date: string | null
  created_at: string
}

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived']

export default function AdminProjects() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [client, setClient] = useState('')

  const { data, isPending } = useQuery({
    queryKey: ['admin-projects'],
    queryFn: async (): Promise<Project[]> => {
      const { data } = await supabase
        .from('projects')
        .select('*')
        .order('created_at', { ascending: false })
      return (data as Project[]) ?? []
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Name required')
      const { error } = await supabase
        .from('projects')
        .insert({ name: name.trim(), client_name: client.trim() || null, status: 'planning' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      setName('')
      setClient('')
      setShowForm(false)
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: Record<string, unknown> = { status }
      if (status === 'archived') update.archived_at = new Date().toISOString()
      const { error } = await supabase.from('projects').update(update).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-projects'] }),
  })

  return (
    <RoleScaffold title="Projects" backTo="/">
      <button onClick={() => setShowForm((s) => !s)} className="btn-secondary">
        {showForm ? 'Cancel' : '+ New project'}
      </button>

      {showForm && (
        <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
          <input className="input-field" placeholder="Project name" value={name}
            onChange={(e) => setName(e.target.value)} />
          <input className="input-field" placeholder="Client (optional)" value={client}
            onChange={(e) => setClient(e.target.value)} />
          <button onClick={() => create.mutate()} className="btn-primary"
            disabled={create.isPending || !name.trim()}>
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
          {create.error && <div className="text-sm text-red-700">{(create.error as Error).message}</div>}
        </div>
      )}

      {isPending && <p className="text-slate-500">Loading…</p>}
      <ul className="flex flex-col gap-2">
        {(data ?? []).map((p) => (
          <li key={p.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{p.name}</span>
              <select
                className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                value={p.status}
                onChange={(e) => updateStatus.mutate({ id: p.id, status: e.target.value })}
              >
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {p.client_name && <div className="text-sm text-slate-500">{p.client_name}</div>}
            <div className="mt-1 text-xs text-slate-400">
              Created {new Date(p.created_at).toLocaleDateString()}
            </div>
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
