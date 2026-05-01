import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

interface Worker {
  id: string
  full_name: string
  phone: string | null
  status: string
  registered_at: string | null
  approved_at: string | null
}

interface Site { id: string; name: string }

export default function AdminWorkers() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ full_name: '', phone: '', site_id: '' })

  const { data: workers, isPending } = useQuery({
    queryKey: ['admin-workers'],
    queryFn: async (): Promise<Worker[]> => {
      const { data } = await supabase
        .from('workers')
        .select('id, full_name, phone, status, registered_at, approved_at')
        .order('full_name')
      return (data as Worker[]) ?? []
    },
  })

  const { data: sites } = useQuery({
    queryKey: ['admin-sites-min'],
    queryFn: async (): Promise<Site[]> => {
      const { data } = await supabase.from('sites').select('id, name').order('name')
      return (data as Site[]) ?? []
    },
  })

  const invite = useMutation({
    mutationFn: async () => {
      if (!form.full_name.trim()) throw new Error('Name required')
      if (!form.site_id) throw new Error('Pick a site')
      const { data: worker, error } = await supabase
        .from('workers')
        .insert({ full_name: form.full_name.trim(), phone: form.phone.trim() || null, status: 'invited' })
        .select('id')
        .single()
      if (error) throw error
      const { error: wsaErr } = await supabase
        .from('worker_site_assignments')
        .insert({ worker_id: worker.id, site_id: form.site_id, is_primary: true })
      if (wsaErr) throw wsaErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-workers'] })
      setForm({ full_name: '', phone: '', site_id: '' })
      setShowForm(false)
    },
  })

  const setStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('workers').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-workers'] }),
  })

  const resetLockout = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('workers')
        .update({ failed_login_count: 0, locked_until: null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-workers'] }),
  })

  return (
    <RoleScaffold title="Workers" backTo="/admin/projects">
      <button onClick={() => setShowForm((s) => !s)} className="btn-secondary">
        {showForm ? 'Cancel' : '+ Invite worker'}
      </button>

      {showForm && (
        <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
          <input className="input-field" placeholder="Full name" value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <input className="input-field" placeholder="Phone (optional)" value={form.phone}
            onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <select className="input-field" value={form.site_id}
            onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
            <option value="">— assign site —</option>
            {(sites ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button onClick={() => invite.mutate()} className="btn-primary" disabled={invite.isPending}>
            {invite.isPending ? 'Inviting…' : 'Invite'}
          </button>
          {invite.error && <div className="text-sm text-red-700">{(invite.error as Error).message}</div>}
        </div>
      )}

      {isPending && <p className="text-slate-500">Loading…</p>}
      <ul className="flex flex-col gap-2">
        {(workers ?? []).map((w) => (
          <li key={w.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{w.full_name}</span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs">{w.status}</span>
            </div>
            <div className="text-xs text-slate-500">
              {w.phone ?? 'no phone'}
              {w.registered_at && ` · registered ${new Date(w.registered_at).toLocaleDateString()}`}
            </div>
            <div className="mt-2 flex flex-wrap gap-1 text-xs">
              {w.status === 'pending_approval' && (
                <button onClick={() => setStatus.mutate({ id: w.id, status: 'active' })}
                  className="rounded-md bg-green-600 px-2 py-1 text-white">Approve</button>
              )}
              {w.status === 'active' && (
                <button onClick={() => setStatus.mutate({ id: w.id, status: 'suspended' })}
                  className="rounded-md bg-amber-600 px-2 py-1 text-white">Suspend</button>
              )}
              {w.status === 'suspended' && (
                <button onClick={() => setStatus.mutate({ id: w.id, status: 'active' })}
                  className="rounded-md bg-green-600 px-2 py-1 text-white">Reactivate</button>
              )}
              <button onClick={() => resetLockout.mutate(w.id)}
                className="rounded-md bg-slate-200 px-2 py-1">Reset lockout</button>
              {w.status !== 'offboarded' && (
                <button onClick={() => {
                  if (confirm(`Offboard ${w.full_name}?`)) setStatus.mutate({ id: w.id, status: 'offboarded' })
                }} className="rounded-md bg-red-600 px-2 py-1 text-white">Offboard</button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
