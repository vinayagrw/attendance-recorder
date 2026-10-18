import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'

type Role = 'admin' | 'supervisor'

interface Staff {
  id: string
  full_name: string
  role: Role
  scope_project_ids: string[]
}

interface Project { id: string; name: string }

const emptyForm = { email: '', full_name: '', role: 'supervisor' as Role, password: '', scope: [] as string[] }

// Calls the admin-only staff-manage Edge Function (creating a login needs
// the service-role key, so it can't be done from the browser).
async function callStaffFn(body: Record<string, unknown>) {
  const session = (await supabase.auth.getSession()).data.session
  if (!session) throw new Error('Not signed in')
  const fnUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/staff-manage`
  const res = await fetch(fnUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      apikey:
        (import.meta.env.VITE_SUPABASE_ANON_KEY ??
          import.meta.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
          '') as string,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `Request failed (${res.status})`)
  return json
}

function ProjectPicker({ projects, value, onChange }: {
  projects: Project[]; value: string[]; onChange: (v: string[]) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {projects.length === 0 && <span className="text-sm text-gray-500">No projects yet</span>}
      {projects.map((p) => (
        <label key={p.id} className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={value.includes(p.id)}
            onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))}
          />
          {p.name}
        </label>
      ))}
    </div>
  )
}

export default function AdminStaff() {
  const qc = useQueryClient()
  const { supervisor: me } = useSupervisor()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [editing, setEditing] = useState<{ id: string; role: Role; scope: string[] } | null>(null)

  const { data: staff, isPending } = useQuery({
    queryKey: ['admin-staff'],
    queryFn: async (): Promise<Staff[]> => {
      const { data } = await supabase
        .from('supervisors')
        .select('id, full_name, role, scope_project_ids')
        .order('full_name')
      return (data as Staff[]) ?? []
    },
  })

  const { data: projects } = useQuery({
    queryKey: ['admin-projects-min'],
    queryFn: async (): Promise<Project[]> => {
      const { data } = await supabase.from('projects').select('id, name').order('name')
      return (data as Project[]) ?? []
    },
  })
  const projectName = (id: string) => projects?.find((p) => p.id === id)?.name ?? 'Unknown'

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-staff'] })

  const create = useMutation({
    mutationFn: () =>
      callStaffFn({
        action: 'create',
        email: form.email,
        fullName: form.full_name,
        role: form.role,
        password: form.password || undefined,
        scopeProjectIds: form.scope,
      }),
    onSuccess: () => {
      refresh()
      setForm(emptyForm)
      setShowForm(false)
    },
  })

  const update = useMutation({
    mutationFn: (e: { id: string; role: Role; scope: string[] }) =>
      callStaffFn({ action: 'update', id: e.id, role: e.role, scopeProjectIds: e.scope }),
    onSuccess: () => {
      refresh()
      setEditing(null)
    },
  })

  const remove = useMutation({
    mutationFn: (id: string) => callStaffFn({ action: 'remove', id }),
    onSuccess: refresh,
  })

  return (
    <RoleScaffold title="Staff" backTo="/admin/projects">
      <button onClick={() => setShowForm((s) => !s)} className="btn-secondary">
        {showForm ? 'Cancel' : '+ Add admin or supervisor'}
      </button>

      {showForm && (
        <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
          <input className="input-field" type="email" placeholder="Email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <input className="input-field" placeholder="Full name" value={form.full_name}
            onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
          <select className="input-field" value={form.role}
            onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            <option value="supervisor">Supervisor</option>
            <option value="admin">Admin</option>
          </select>
          <input className="input-field" type="password" autoComplete="new-password"
            placeholder="Temporary password (8+ chars, leave blank if they already have a login)"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} />
          {form.role === 'supervisor' && (
            <>
              <div className="text-sm font-medium">Projects they can see</div>
              <ProjectPicker projects={projects ?? []} value={form.scope}
                onChange={(scope) => setForm({ ...form, scope })} />
            </>
          )}
          <button
            onClick={() => create.mutate()}
            className="btn-primary"
            disabled={create.isPending || !form.email.trim() || !form.full_name.trim()}
          >
            {create.isPending ? 'Saving…' : 'Add'}
          </button>
          {create.error && <div className="text-sm text-red-700">{(create.error as Error).message}</div>}
        </div>
      )}

      {isPending && <div className="text-sm text-gray-500">Loading…</div>}
      {(update.error || remove.error) && (
        <div className="text-sm text-red-700">{((update.error ?? remove.error) as Error).message}</div>
      )}

      <ul className="flex flex-col gap-2">
        {(staff ?? []).map((s) => (
          <li key={s.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-medium">{s.full_name}{s.id === me?.id ? ' (you)' : ''}</div>
                <div className="text-sm text-gray-600">
                  {s.role === 'admin' ? 'Admin · all projects' :
                    `Supervisor · ${s.scope_project_ids.length ? s.scope_project_ids.map(projectName).join(', ') : 'no projects'}`}
                </div>
              </div>
              <div className="flex gap-2">
                <button className="btn-secondary"
                  onClick={() => setEditing({ id: s.id, role: s.role, scope: s.scope_project_ids })}>
                  Edit
                </button>
                {s.id !== me?.id && (
                  <button className="btn-secondary" disabled={remove.isPending}
                    onClick={() => confirm(`Remove ${s.full_name}'s staff access?`) && remove.mutate(s.id)}>
                    Remove
                  </button>
                )}
              </div>
            </div>

            {editing?.id === s.id && (
              <div className="mt-2 flex flex-col gap-2">
                <select className="input-field" value={editing.role}
                  onChange={(e) => setEditing({ ...editing, role: e.target.value as Role })}>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
                {editing.role === 'supervisor' && (
                  <ProjectPicker projects={projects ?? []} value={editing.scope}
                    onChange={(scope) => setEditing({ ...editing, scope })} />
                )}
                <div className="flex gap-2">
                  <button className="btn-primary" disabled={update.isPending}
                    onClick={() => update.mutate(editing)}>
                    {update.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
