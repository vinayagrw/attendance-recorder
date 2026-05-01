import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

export default function SupervisorInviteWorker() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [siteId, setSiteId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  // Sites in supervisor's scope (RLS filters)
  const { data: sites } = useQuery({
    queryKey: ['supervisor-invite-sites'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('sites')
        .select('id, name, project_id, projects(name)')
        .eq('status', 'active')
        .order('name')
      if (error) throw error
      return data ?? []
    },
  })

  const invite = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error('Worker name is required')
      if (!siteId) throw new Error('Pick a site to assign')
      const { data: worker, error: e1 } = await supabase
        .from('workers')
        .insert({
          full_name: name.trim(),
          phone: phone.trim() || null,
          status: 'invited',
        })
        .select('id, full_name')
        .single()
      if (e1) throw e1
      const { error: e2 } = await supabase
        .from('worker_site_assignments')
        .insert({ worker_id: worker.id, site_id: siteId, is_primary: true })
      if (e2) throw e2
      return worker
    },
    onSuccess: (worker) => {
      qc.invalidateQueries({ queryKey: ['pending-workers'] })
      qc.invalidateQueries({ queryKey: ['admin-workers'] })
      qc.invalidateQueries({ queryKey: ['worker-pick-list'] })
      setInfo(
        `Invited ${worker.full_name}. Share this URL: /worker/register — they pick their name, set a PIN, take a selfie.`,
      )
      setName('')
      setPhone('')
      setSiteId('')
    },
    onError: (e) => setError((e as Error).message),
  })

  return (
    <RoleScaffold title="Invite worker" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Add a worker to a site. They'll appear in the worker registration
        dropdown. Once they pick their name and set a PIN, they'll show up in
        the approvals queue.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Full name *</span>
        <input
          className="input-field"
          placeholder="e.g. Suresh Patel"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Phone (optional)</span>
        <input
          className="input-field"
          inputMode="tel"
          placeholder="+91 ..."
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Assign to site *</span>
        <select
          className="input-field"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          <option value="">— pick a site —</option>
          {(sites ?? []).map((s) => {
            const p = (s as { projects?: { name?: string } | null }).projects
            return (
              <option key={s.id} value={s.id}>
                {s.name}
                {p?.name ? ` · ${p.name}` : ''}
              </option>
            )
          })}
        </select>
      </label>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && (
        <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>
      )}

      <button onClick={() => invite.mutate()} className="btn-primary" disabled={invite.isPending}>
        {invite.isPending ? 'Inviting…' : 'Invite worker'}
      </button>

      <button
        onClick={() => navigate('/supervisor/dashboard')}
        className="btn-secondary"
      >
        Back to dashboard
      </button>
    </RoleScaffold>
  )
}
