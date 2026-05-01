import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { useSupervisor } from '@/hooks/useSupervisor'
import SelfieThumb from '@/components/SelfieThumb'
import { logger } from '@/lib/logger'

function localFromIso(iso: string): string {
  const d = new Date(iso)
  d.setSeconds(0, 0)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

const STATUS_OPTIONS = ['pending', 'verified', 'flagged', 'rejected', 'auto_closed']

export default function SupervisorEditPunch() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()

  const [punchedAtLocal, setPunchedAtLocal] = useState('')
  const [status, setStatus] = useState('pending')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  interface PunchDetail {
    id: string
    worker_id: string
    site_id: string
    type: 'in' | 'out'
    status: string
    punched_at: string
    selfie_url: string | null
    distance_from_site_m: number | null
    flag_reasons: string[]
    reviewer_comment: string | null
    workers?: { full_name: string } | null
    sites?: { name: string } | null
  }

  const { data: row, isPending } = useQuery({
    queryKey: ['edit-punch', id],
    enabled: !!id,
    queryFn: async (): Promise<PunchDetail | null> => {
      const { data, error } = await supabase
        .from('attendance')
        .select(
          'id, worker_id, site_id, type, status, punched_at, selfie_url, ' +
            'distance_from_site_m, flag_reasons, reviewer_comment, ' +
            'workers(full_name), sites(name)',
        )
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as PunchDetail
    },
  })

  useEffect(() => {
    if (row) {
      setPunchedAtLocal(localFromIso(row.punched_at))
      setStatus(row.status)
      setComment(row.reviewer_comment ?? '')
    }
  }, [row])

  const save = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing id')
      const punchedAt = new Date(punchedAtLocal).toISOString()
      const { error } = await supabase
        .from('attendance')
        .update({
          punched_at: punchedAt,
          status,
          reviewer_comment: comment || null,
          reviewed_by: supervisor?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-today'] })
      qc.invalidateQueries({ queryKey: ['edit-punch'] })
      logger.info('punch edited', {
        module: 'EditPunch',
        attendanceId: id,
        status,
        userId: supervisor?.id,
      })
      setInfo('Punch updated.')
    },
    onError: (e) => {
      logger.error(e, {
        module: 'EditPunch',
        action: 'update',
        attendanceId: id,
        status,
        userId: supervisor?.id,
      })
      setError((e as Error).message)
    },
  })

  const remove = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error('Missing id')
      if (!confirm('Reject this punch (cannot be un-rejected)?')) return
      const { error } = await supabase
        .from('attendance')
        .update({
          status: 'rejected',
          reviewer_comment: comment || 'Rejected by supervisor',
          reviewed_by: supervisor?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-today'] })
      navigate('/supervisor/dashboard')
    },
  })

  if (isPending) {
    return <RoleScaffold title="Edit punch"><p>Loading…</p></RoleScaffold>
  }
  if (!row) {
    return <RoleScaffold title="Edit punch"><p className="text-red-700">Punch not found.</p></RoleScaffold>
  }

  return (
    <RoleScaffold title="Edit punch" backTo="/supervisor/dashboard">
      <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
        <SelfieThumb path={row.selfie_url} size={64} />
        <div>
          <div className="font-semibold">{row.workers?.full_name ?? row.worker_id.slice(0, 6)}</div>
          <div className="text-sm text-slate-500">
            {row.type.toUpperCase()} · {row.sites?.name ?? row.site_id.slice(0, 6)}
          </div>
          {row.distance_from_site_m != null && (
            <div className="text-xs text-slate-400">{row.distance_from_site_m.toFixed(0)} m from site</div>
          )}
        </div>
      </div>

      {row.flag_reasons?.length > 0 && (
        <div className="rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
          ⚠ {row.flag_reasons.join(', ')}
        </div>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Date & time</span>
        <input
          type="datetime-local"
          className="input-field"
          value={punchedAtLocal}
          onChange={(e) => setPunchedAtLocal(e.target.value)}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Status</span>
        <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium text-slate-700">Reviewer comment</span>
        <textarea
          className="input-field"
          rows={2}
          placeholder="Why are you adjusting this punch?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </label>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

      <button onClick={() => save.mutate()} className="btn-primary" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>
      <button
        onClick={() => remove.mutate()}
        className="rounded-xl bg-red-600 py-2 font-medium text-white"
        disabled={remove.isPending}
      >
        Reject this punch
      </button>
      <button onClick={() => navigate('/supervisor/dashboard')} className="btn-secondary">
        Back to dashboard
      </button>
    </RoleScaffold>
  )
}
