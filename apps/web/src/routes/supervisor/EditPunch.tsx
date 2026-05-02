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
const TYPE_OPTIONS: Array<'in' | 'out'> = ['in', 'out']

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
  device_lat: number | null
  device_lng: number | null
  gps_accuracy_m: number | null
  speed_ms: number | null
  device_fingerprint: string | null
  user_agent: string | null
  ip_address: string | null
  selfie_metadata: Record<string, unknown> | null
  capture_method: string | null
  briefing_acknowledged_id: string | null
  workers?: { full_name: string } | null
  sites?: { name: string; project_id: string } | null
}

export default function SupervisorEditPunch() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()

  const [punchedAtLocal, setPunchedAtLocal] = useState('')
  const [status, setStatus] = useState('pending')
  const [type, setType] = useState<'in' | 'out'>('in')
  const [siteId, setSiteId] = useState('')
  const [comment, setComment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)

  const { data: row, isPending } = useQuery({
    queryKey: ['edit-punch', id],
    enabled: !!id,
    queryFn: async (): Promise<PunchDetail | null> => {
      const { data, error } = await supabase
        .from('attendance')
        .select(
          'id, worker_id, site_id, type, status, punched_at, selfie_url, ' +
            'distance_from_site_m, flag_reasons, reviewer_comment, ' +
            'device_lat, device_lng, gps_accuracy_m, speed_ms, ' +
            'device_fingerprint, user_agent, ip_address, ' +
            'selfie_metadata, capture_method, briefing_acknowledged_id, ' +
            'workers(full_name), sites(name, project_id)',
        )
        .eq('id', id!)
        .single()
      if (error) throw error
      return data as unknown as PunchDetail
    },
  })

  const { data: sites } = useQuery({
    queryKey: ['edit-punch-sites'],
    queryFn: async () => {
      const { data } = await supabase
        .from('sites')
        .select('id, name, project_id, projects(name)')
        .order('name')
      return ((data as unknown) as Array<{
        id: string
        name: string
        project_id: string
        projects?: { name: string } | null
      }>) ?? []
    },
  })

  useEffect(() => {
    if (row) {
      setPunchedAtLocal(localFromIso(row.punched_at))
      setStatus(row.status)
      setType(row.type)
      setSiteId(row.site_id)
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
          type,
          site_id: siteId,
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
        siteId,
        type,
        userId: supervisor?.id,
      })
      setInfo('Punch updated.')
    },
    onError: (e) => {
      logger.error(e, {
        module: 'EditPunch',
        action: 'update',
        attendanceId: id,
        userId: supervisor?.id,
      })
      setError((e as Error).message)
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
      {/* Header summary */}
      <div className="flex items-center gap-3 rounded-xl bg-white p-3 shadow-sm">
        <SelfieThumb path={row.selfie_url} size={72} />
        <div className="flex-1 min-w-0">
          <div className="font-semibold truncate">
            {row.workers?.full_name ?? row.worker_id.slice(0, 6)}
          </div>
          <div className="text-xs text-slate-500">
            {new Date(row.punched_at).toLocaleString()}
          </div>
          {row.flag_reasons?.length > 0 && (
            <div className="mt-1 text-xs text-amber-700">⚠ {row.flag_reasons.join(', ')}</div>
          )}
        </div>
      </div>

      {/* Editable fields */}
      <div className="rounded-xl bg-white p-3 shadow-sm">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Editable</div>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Site</span>
          <select className="input-field" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            {(sites ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} {s.projects?.name ? `· ${s.projects.name}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Type</span>
          <div className="grid grid-cols-2 gap-2">
            {TYPE_OPTIONS.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={
                  type === t
                    ? 'rounded-xl bg-brand-600 py-2 text-sm font-semibold text-white'
                    : 'rounded-xl bg-slate-200 py-2 text-sm font-medium text-slate-700'
                }
              >
                {t.toUpperCase()}
              </button>
            ))}
          </div>
        </label>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Date & time</span>
          <input
            type="datetime-local"
            className="input-field"
            value={punchedAtLocal}
            onChange={(e) => setPunchedAtLocal(e.target.value)}
          />
        </label>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Status</span>
          <select className="input-field" value={status} onChange={(e) => setStatus(e.target.value)}>
            {STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>

        <label className="mt-3 flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Reviewer comment</span>
          <textarea
            className="input-field"
            rows={2}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </label>
      </div>

      {/* Read-only metadata block — useful when investigating a flag */}
      <div className="rounded-xl bg-white p-3 text-xs shadow-sm">
        <div className="mb-2 text-xs font-semibold uppercase text-slate-500">Captured metadata</div>
        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono">
          <dt className="text-slate-500">GPS</dt>
          <dd>
            {row.device_lat?.toFixed(5) ?? '—'}, {row.device_lng?.toFixed(5) ?? '—'}
          </dd>
          <dt className="text-slate-500">GPS accuracy</dt>
          <dd>{row.gps_accuracy_m?.toFixed(0) ?? '—'} m</dd>
          <dt className="text-slate-500">Distance from site</dt>
          <dd>{row.distance_from_site_m?.toFixed(0) ?? '—'} m</dd>
          <dt className="text-slate-500">Speed</dt>
          <dd>{row.speed_ms != null ? `${(row.speed_ms * 3.6).toFixed(1)} km/h` : '—'}</dd>
          <dt className="text-slate-500">Capture method</dt>
          <dd>{row.capture_method ?? '—'}</dd>
          <dt className="text-slate-500">Device fingerprint</dt>
          <dd className="break-all">{row.device_fingerprint ?? '—'}</dd>
          <dt className="text-slate-500">IP address</dt>
          <dd>{row.ip_address ?? '—'}</dd>
          <dt className="text-slate-500">User agent</dt>
          <dd className="break-all">{row.user_agent ?? '—'}</dd>
          <dt className="text-slate-500">Briefing ack'd</dt>
          <dd>{row.briefing_acknowledged_id ? '✓' : '—'}</dd>
        </dl>
        {row.selfie_metadata && (() => {
          const meta = row.selfie_metadata as Record<string, unknown>
          const image  = meta.image  ?? null
          const camera = meta.camera ?? null
          const device = meta.device ?? null
          return (
            <>
              {(image || camera) && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-600">
                    🖼 Image metadata (selfie + camera track)
                  </summary>
                  <pre className="mt-1 max-h-56 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">
                    {JSON.stringify({ image, camera }, null, 2)}
                  </pre>
                </details>
              )}
              {device && Object.keys(device as object).length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-slate-600">
                    💻 Device metadata (browser + screen + timezone + WebGL + network)
                  </summary>
                  <pre className="mt-1 max-h-72 overflow-auto rounded bg-slate-50 p-2 text-[10px] text-slate-700">
                    {JSON.stringify(device, null, 2)}
                  </pre>
                </details>
              )}
            </>
          )
        })()}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

      <button onClick={() => save.mutate()} className="btn-primary" disabled={save.isPending}>
        {save.isPending ? 'Saving…' : 'Save changes'}
      </button>
      <button onClick={() => navigate('/supervisor/dashboard')} className="btn-secondary">
        Back to dashboard
      </button>
    </RoleScaffold>
  )
}
