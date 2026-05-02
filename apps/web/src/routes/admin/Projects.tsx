import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'

interface Project {
  id: string
  name: string
  client_name: string | null
  address: string | null
  status: string
  start_date: string | null
  end_date: string | null
  created_at: string
}

const STATUSES = ['planning', 'active', 'on_hold', 'completed', 'archived']
const ALL_STATUSES = STATUSES // for filter chips

export default function AdminProjects() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', client: '', address: '' })

  // ── Advanced filter state ───────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [activeStatuses, setActiveStatuses] = useState<Set<string>>(
    new Set(['planning', 'active', 'on_hold', 'completed']),
  )
  const [hasAddress, setHasAddress] = useState<'any' | 'yes' | 'no'>('any')
  const [createdSince, setCreatedSince] = useState('')

  // ── Edit-in-place state ─────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState({
    name: '', client: '', address: '', start_date: '', end_date: '',
  })

  const { data, isPending } = useQuery({
    queryKey: ['admin-projects'],
    queryFn: async (): Promise<Project[]> => {
      const { data } = await supabase
        .from('projects')
        .select('id, name, client_name, address, status, start_date, end_date, created_at')
        .order('created_at', { ascending: false })
      return (data as Project[]) ?? []
    },
  })

  const { data: siteCounts } = useQuery({
    queryKey: ['admin-projects-site-counts'],
    queryFn: async () => {
      const { data } = await supabase.from('sites').select('project_id, status')
      const counts: Record<string, { active: number; total: number }> = {}
      ;(data ?? []).forEach((s) => {
        const id = s.project_id as string
        counts[id] ??= { active: 0, total: 0 }
        counts[id].total += 1
        if (s.status === 'active') counts[id].active += 1
      })
      return counts
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      if (!form.name.trim()) throw new Error('Name required')
      const { error } = await supabase.from('projects').insert({
        name: form.name.trim(),
        client_name: form.client.trim() || null,
        address: form.address.trim() || null,
        status: 'planning',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      setForm({ name: '', client: '', address: '' })
      setShowForm(false)
    },
  })

  const update = useMutation({
    mutationFn: async ({
      id, patch,
    }: { id: string; patch: Partial<Project> }) => {
      const { error } = await supabase.from('projects').update(patch).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      qc.invalidateQueries({ queryKey: ['admin-projects-site-counts'] })
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const update: Record<string, unknown> = { status }
      if (status === 'archived') update.archived_at = new Date().toISOString()
      const { error } = await supabase.from('projects').update(update).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-projects'] })
      qc.invalidateQueries({ queryKey: ['admin-projects-site-counts'] })
    },
  })

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const since = createdSince ? new Date(createdSince).getTime() : null
    return (data ?? []).filter((p) => {
      if (!activeStatuses.has(p.status)) return false
      if (q) {
        const blob = `${p.name} ${p.client_name ?? ''} ${p.address ?? ''}`.toLowerCase()
        if (!blob.includes(q)) return false
      }
      if (hasAddress === 'yes' && !p.address) return false
      if (hasAddress === 'no' && !!p.address) return false
      if (since != null && new Date(p.created_at).getTime() < since) return false
      return true
    })
  }, [data, search, activeStatuses, hasAddress, createdSince])

  const toggleStatus = (s: string) => {
    const next = new Set(activeStatuses)
    next.has(s) ? next.delete(s) : next.add(s)
    setActiveStatuses(next)
  }

  const startEdit = (p: Project) => {
    setEditingId(p.id)
    setEditForm({
      name: p.name,
      client: p.client_name ?? '',
      address: p.address ?? '',
      start_date: p.start_date ?? '',
      end_date: p.end_date ?? '',
    })
  }

  const saveEdit = () => {
    if (!editingId) return
    update.mutate({
      id: editingId,
      patch: {
        name: editForm.name.trim(),
        client_name: editForm.client.trim() || null,
        address: editForm.address.trim() || null,
        start_date: editForm.start_date || null,
        end_date: editForm.end_date || null,
      },
    })
    setEditingId(null)
  }

  return (
    <RoleScaffold title="Projects" backTo="/">
      {/* Top action row — feature flags is intentionally NOT linked here.
          Admins can still hit it directly at /admin/feature-flags. */}
      <div className="flex flex-wrap gap-2 mb-2">
        <button onClick={() => setShowForm((s) => !s)} className="btn-secondary">
          {showForm ? 'Cancel' : '+ New project'}
        </button>
        <Link to="/admin/traffic" className="btn-secondary">📡 Site traffic</Link>
        <Link to="/admin/audit" className="btn-secondary">🧾 Audit</Link>
      </div>

      {/* Create form */}
      {showForm && (
        <div className="flex flex-col gap-2 rounded-xl bg-white p-3 shadow-sm">
          <input
            className="input-field"
            placeholder="Project name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
          <input
            className="input-field"
            placeholder="Client (optional)"
            value={form.client}
            onChange={(e) => setForm({ ...form, client: e.target.value })}
          />
          <textarea
            className="input-field min-h-[5rem]"
            placeholder="Full address (optional) — e.g. Plot 12, Sector 5, Bengaluru, 560100"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
          <button
            onClick={() => create.mutate()}
            className="btn-primary"
            disabled={create.isPending || !form.name.trim()}
          >
            {create.isPending ? 'Creating…' : 'Create'}
          </button>
          {create.error && <div className="text-sm text-red-700">{(create.error as Error).message}</div>}
        </div>
      )}

      {/* Advanced filter */}
      <details className="rounded-xl bg-white p-3 shadow-sm" open>
        <summary className="cursor-pointer text-sm font-semibold text-slate-700">
          Advanced filter
        </summary>
        <div className="mt-2 flex flex-col gap-2">
          <input
            className="input-field"
            placeholder="Search name / client / address"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex flex-wrap gap-1 text-xs">
            <span className="self-center text-slate-500">Status:</span>
            {ALL_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => toggleStatus(s)}
                className={
                  activeStatuses.has(s)
                    ? 'rounded-full bg-brand-600 px-2.5 py-0.5 font-medium text-white'
                    : 'rounded-full bg-slate-200 px-2.5 py-0.5 text-slate-700'
                }
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Address present</span>
              <select
                className="input-field text-sm"
                value={hasAddress}
                onChange={(e) => setHasAddress(e.target.value as 'any' | 'yes' | 'no')}
              >
                <option value="any">Any</option>
                <option value="yes">Has address</option>
                <option value="no">Missing address</option>
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-slate-500">Created since</span>
              <input
                type="date"
                className="input-field text-sm"
                value={createdSince}
                onChange={(e) => setCreatedSince(e.target.value)}
              />
            </label>
          </div>
          <div className="text-xs text-slate-500">
            Showing {filtered.length} of {data?.length ?? 0} projects
          </div>
        </div>
      </details>

      {/* List */}
      {isPending && <p className="text-slate-500">Loading…</p>}
      <ul className="flex flex-col gap-2">
        {filtered.map((p) => {
          const counts = siteCounts?.[p.id] ?? { active: 0, total: 0 }
          const noSites = counts.total === 0
          const editing = editingId === p.id

          if (editing) {
            return (
              <li key={p.id} className="rounded-xl border border-brand-300 bg-white p-3 shadow-sm">
                <div className="mb-2 text-xs font-semibold uppercase text-brand-700">Editing project</div>
                <input
                  className="input-field mb-2"
                  placeholder="Name"
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                />
                <input
                  className="input-field mb-2"
                  placeholder="Client"
                  value={editForm.client}
                  onChange={(e) => setEditForm({ ...editForm, client: e.target.value })}
                />
                <textarea
                  className="input-field min-h-[4rem] mb-2"
                  placeholder="Full address"
                  value={editForm.address}
                  onChange={(e) => setEditForm({ ...editForm, address: e.target.value })}
                />
                <div className="grid grid-cols-2 gap-2">
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-500">Start date</span>
                    <input
                      type="date"
                      className="input-field text-sm"
                      value={editForm.start_date}
                      onChange={(e) => setEditForm({ ...editForm, start_date: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs">
                    <span className="text-slate-500">End date</span>
                    <input
                      type="date"
                      className="input-field text-sm"
                      value={editForm.end_date}
                      onChange={(e) => setEditForm({ ...editForm, end_date: e.target.value })}
                    />
                  </label>
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={saveEdit} className="btn-primary" disabled={update.isPending}>
                    {update.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button onClick={() => setEditingId(null)} className="btn-secondary">
                    Cancel
                  </button>
                </div>
              </li>
            )
          }

          return (
            <li key={p.id} className="rounded-xl bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{p.name}</div>
                  {p.client_name && <div className="text-sm text-slate-500">{p.client_name}</div>}
                  {p.address && (
                    <div className="mt-0.5 whitespace-pre-wrap text-xs text-slate-600">
                      📍 {p.address}
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap gap-x-3 text-xs text-slate-400">
                    <span>Created {new Date(p.created_at).toLocaleDateString()}</span>
                    {p.start_date && <span>Starts {new Date(p.start_date).toLocaleDateString()}</span>}
                    {p.end_date && <span>Ends {new Date(p.end_date).toLocaleDateString()}</span>}
                  </div>
                </div>
                <select
                  className="rounded-md border border-slate-200 px-2 py-1 text-xs"
                  value={p.status}
                  onChange={(e) => updateStatus.mutate({ id: p.id, status: e.target.value })}
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>

              <div className="mt-2 flex items-center justify-between">
                <span
                  className={`text-xs ${noSites ? 'text-amber-700' : 'text-slate-600'}`}
                >
                  {noSites
                    ? '⚠ 0 sites — workers can\'t punch here yet'
                    : `${counts.active} active site(s)${counts.total !== counts.active ? ` (${counts.total} total)` : ''}`}
                </span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-700 hover:bg-slate-200"
                  >
                    ✎ Edit
                  </button>
                  <Link
                    to={`/admin/sites?projectId=${p.id}`}
                    className="rounded-md bg-emerald-50 px-2 py-1 text-xs text-emerald-800 hover:bg-emerald-100"
                  >
                    + Add site
                  </Link>
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {filtered.length === 0 && !isPending && (
        <p className="rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-500">
          No projects match the current filter.
        </p>
      )}
    </RoleScaffold>
  )
}
