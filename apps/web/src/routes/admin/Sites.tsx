import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

interface Site {
  id: string
  name: string
  project_id: string
  default_lat: number | null
  default_lng: number | null
  default_radius_m: number | null
  daily_note: string | null
  status: string
  timezone: string
}

interface Project { id: string; name: string }

export default function AdminSites() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', project_id: '', lat: '', lng: '', radius: '150', timezone: 'Asia/Kolkata' })

  const { data: projects } = useQuery({
    queryKey: ['admin-projects-min'],
    queryFn: async (): Promise<Project[]> => {
      const { data } = await supabase.from('projects').select('id, name').order('name')
      return (data as Project[]) ?? []
    },
  })

  const { data: sites, isPending } = useQuery({
    queryKey: ['admin-sites'],
    queryFn: async (): Promise<Site[]> => {
      const { data } = await supabase
        .from('sites')
        .select('id, name, project_id, default_lat, default_lng, default_radius_m, daily_note, status, timezone')
        .order('name')
      return (data as Site[]) ?? []
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const lat = parseFloat(form.lat)
      const lng = parseFloat(form.lng)
      const radius = parseInt(form.radius, 10)
      if (!form.name.trim()) throw new Error('Name required')
      if (!form.project_id) throw new Error('Pick a project')
      if (isNaN(lat) || isNaN(lng)) throw new Error('Lat/lng required')
      const { error } = await supabase.from('sites').insert({
        name: form.name.trim(),
        project_id: form.project_id,
        default_lat: lat, default_lng: lng,
        default_radius_m: isNaN(radius) ? 150 : radius,
        timezone: form.timezone,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-sites'] })
      setShowForm(false)
      setForm({ name: '', project_id: '', lat: '', lng: '', radius: '150', timezone: 'Asia/Kolkata' })
    },
  })

  const updateNote = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase
        .from('sites')
        .update({ daily_note: note, daily_note_updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sites'] }),
  })

  return (
    <RoleScaffold title="Sites" backTo="/admin/projects">
      <button onClick={() => setShowForm((s) => !s)} className="btn-secondary">
        {showForm ? 'Cancel' : '+ New site'}
      </button>

      {showForm && (
        <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
          <select className="input-field" value={form.project_id}
            onChange={(e) => setForm({ ...form, project_id: e.target.value })}>
            <option value="">— pick project —</option>
            {(projects ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <input className="input-field" placeholder="Site name" value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="grid grid-cols-3 gap-2">
            <input className="input-field" placeholder="Lat" value={form.lat}
              onChange={(e) => setForm({ ...form, lat: e.target.value })} />
            <input className="input-field" placeholder="Lng" value={form.lng}
              onChange={(e) => setForm({ ...form, lng: e.target.value })} />
            <input className="input-field" placeholder="Radius m" value={form.radius}
              onChange={(e) => setForm({ ...form, radius: e.target.value })} />
          </div>
          <input className="input-field" placeholder="Timezone" value={form.timezone}
            onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
          <button onClick={() => create.mutate()} className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
          {create.error && <div className="text-sm text-red-700">{(create.error as Error).message}</div>}
        </div>
      )}

      {isPending && <p className="text-slate-500">Loading…</p>}
      <ul className="flex flex-col gap-2">
        {(sites ?? []).map((s) => (
          <li key={s.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{s.name}</span>
              <span className="text-xs text-slate-400">{s.status}</span>
            </div>
            <div className="text-xs text-slate-500">
              {s.default_lat?.toFixed(5)}, {s.default_lng?.toFixed(5)} · {s.default_radius_m} m · {s.timezone}
            </div>
            <textarea
              className="mt-2 w-full rounded-lg border border-slate-200 p-2 text-sm"
              rows={2}
              placeholder="Today's site briefing (shown on the worker punch screen)…"
              defaultValue={s.daily_note ?? ''}
              onBlur={(e) => {
                if (e.target.value !== (s.daily_note ?? '')) {
                  updateNote.mutate({ id: s.id, note: e.target.value })
                }
              }}
            />
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
