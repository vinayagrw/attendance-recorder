import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'
import { logger } from '@/lib/logger'

function nowLocalIsoMinutes(): string {
  const d = new Date()
  d.setSeconds(0, 0)
  // Format yyyy-mm-ddThh:mm for <input type="datetime-local">
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function SupervisorManualPunch() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()

  const [workerId, setWorkerId] = useState('')
  const [siteId, setSiteId] = useState('')
  const [type, setType] = useState<'in' | 'out'>('in')
  const [punchedAtLocal, setPunchedAtLocal] = useState<string>(nowLocalIsoMinutes())
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const { data: workers } = useQuery({
    queryKey: ['manual-punch-workers'],
    queryFn: async () => {
      const { data } = await supabase
        .from('workers')
        .select('id, full_name, status')
        .eq('status', 'active')
        .order('full_name')
      return (data as Array<{ id: string; full_name: string; status: string }>) ?? []
    },
  })

  const { data: sites } = useQuery({
    queryKey: ['manual-punch-sites'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sites')
        .select('id, name')
        .eq('status', 'active')
        .order('name')
      return (data as Array<{ id: string; name: string }>) ?? []
    },
  })

  // Default site to first available
  useEffect(() => {
    if (!siteId && sites && sites.length > 0) setSiteId(sites[0].id)
  }, [sites, siteId])

  const submit = useMutation({
    mutationFn: async () => {
      if (!workerId) throw new Error('Pick a worker')
      if (!siteId) throw new Error('Pick a site')
      const punchedAt = new Date(punchedAtLocal).toISOString()
      const { error } = await supabase.from('attendance').insert({
        worker_id: workerId,
        site_id: siteId,
        type,
        punched_at: punchedAt,
        status: 'verified',
        flag_reasons: ['manual_entry'],
        reviewed_by: supervisor?.id,
        reviewed_at: new Date().toISOString(),
        reviewer_comment: comment || 'Manual entry by supervisor',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-today'] })
      logger.info('manual punch added', {
        module: 'ManualPunch',
        workerId,
        siteId,
        type,
        userId: supervisor?.id,
      })
      setInfo(`Manual ${type.toUpperCase()} punch added.`)
      setComment('')
    },
    onError: (e) => {
      logger.error(e, {
        module: 'ManualPunch',
        action: 'insert',
        workerId,
        siteId,
        type,
        userId: supervisor?.id,
      })
      setError((e as Error).message)
    },
  })

  return (
    <RoleScaffold title="Manual punch entry" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Record a punch on behalf of a worker (e.g. they forgot to punch, app
        was offline, or you're correcting after the fact). The entry is marked{' '}
        <code>manual_entry</code> for audit traceability.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Worker *</span>
        <select
          className="input-field"
          value={workerId}
          onChange={(e) => setWorkerId(e.target.value)}
        >
          <option value="">— pick worker —</option>
          {(workers ?? []).map((w) => (
            <option key={w.id} value={w.id}>{w.full_name}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Site *</span>
        <select
          className="input-field"
          value={siteId}
          onChange={(e) => setSiteId(e.target.value)}
        >
          {(sites ?? []).map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => setType('in')}
          className={
            type === 'in'
              ? 'rounded-xl bg-brand-600 py-3 font-semibold text-white'
              : 'rounded-xl bg-slate-200 py-3 font-medium text-slate-700'
          }
        >
          IN
        </button>
        <button
          type="button"
          onClick={() => setType('out')}
          className={
            type === 'out'
              ? 'rounded-xl bg-brand-600 py-3 font-semibold text-white'
              : 'rounded-xl bg-slate-200 py-3 font-medium text-slate-700'
          }
        >
          OUT
        </button>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Date & time *</span>
        <input
          type="datetime-local"
          className="input-field"
          value={punchedAtLocal}
          onChange={(e) => setPunchedAtLocal(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Reason / note</span>
        <textarea
          className="input-field"
          rows={2}
          placeholder="e.g. Worker's phone died — entering punch from on-site sign-in sheet"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

      <button
        onClick={() => submit.mutate()}
        className="btn-primary"
        disabled={submit.isPending}
      >
        {submit.isPending ? 'Recording…' : `Record ${type.toUpperCase()} punch`}
      </button>

      <button onClick={() => navigate('/supervisor/dashboard')} className="btn-secondary">
        Back to dashboard
      </button>
    </RoleScaffold>
  )
}
