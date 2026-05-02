import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { useSupervisor } from '@/hooks/useSupervisor'
import { useTodayAttendance, type AttendanceRow } from '@/hooks/useTodayAttendance'
import { useFeatureFlag } from '@/hooks/useFeatureFlag'
import SelfieThumb from '@/components/SelfieThumb'
import SelfieLightbox from '@/components/SelfieLightbox'
import { APP_CONFIG } from '@/config/app'

const SEVERITY: Record<string, number> = {
  not_live_camera: 3, impossible_speed: 3, mock_gps_signature: 3, buddy_punch_suspected: 3,
  metadata_gps_mismatch: 3, metadata_timestamp_stale: 3, duplicate_selfie: 3,
  geofence_far: 2, in_motion: 2, new_device: 2, camera_label_changed: 2,
  low_gps_accuracy: 1, edge_tolerance: 1, off_hours: 1, frame_too_dark: 1, frame_too_blurry: 1,
}
const sevOf = (flags: string[]) => Math.max(0, ...flags.map((f) => SEVERITY[f] ?? 1))
const sevColor = (n: number) =>
  n >= 3 ? 'bg-red-100 text-red-700'
  : n === 2 ? 'bg-amber-100 text-amber-700'
  : n === 1 ? 'bg-slate-100 text-slate-700'
  : 'bg-green-100 text-green-700'

export default function SupervisorDashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { supervisor } = useSupervisor()
  const { data: today, isPending } = useTodayAttendance()
  const { enabled: analyticsEnabled } = useFeatureFlag('analytics_dashboard')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [lightboxPath, setLightboxPath] = useState<string | null>(null)

  const { data: pendingCount } = useQuery({
    queryKey: ['pending-approvals-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_approval')
      return count ?? 0
    },
    refetchInterval: APP_CONFIG.PENDING_APPROVALS_REFETCH_MS,
  })

  const verify = useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase
        .from('attendance')
        .update({ status: 'verified', reviewed_by: supervisor?.id, reviewed_at: new Date().toISOString() })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['attendance-today'] })
      setSelected(new Set())
    },
  })

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt('Reason for rejection?') ?? ''
      const { error } = await supabase
        .from('attendance')
        .update({
          status: 'rejected',
          reviewer_comment: reason,
          reviewed_by: supervisor?.id,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['attendance-today'] }),
  })

  // M13 fix: only currently-flagged punches (status = 'flagged') stay in
  // anomalies. Once a supervisor verifies / rejects, they leave this pane.
  const flagged = (today ?? []).filter((r) => r.status === 'flagged')
  const clean = (today ?? []).filter((r) => r.status !== 'flagged')
  const sortedFlagged = [...flagged].sort((a, b) => sevOf(b.flag_reasons) - sevOf(a.flag_reasons))

  const toggle = (id: string) => {
    const next = new Set(selected)
    next.has(id) ? next.delete(id) : next.add(id)
    setSelected(next)
  }

  return (
    <RoleScaffold title="Dashboard" backTo="/">
      <div className="flex items-center justify-between text-sm">
        <div className="text-slate-600">
          {supervisor?.full_name} <span className="text-slate-400">· {supervisor?.role}</span>
        </div>
        <button
          onClick={async () => {
            await signOut()
            navigate('/supervisor/login', { replace: true })
          }}
          className="text-slate-500 underline"
        >
          Sign out
        </button>
      </div>

       <div className="grid grid-cols-2 gap-2">
         <Link to="/supervisor/approvals"
           className="rounded-xl bg-blue-50 p-3 text-center text-xs text-blue-900 hover:bg-blue-100">
           Approvals
           <div className="text-lg font-bold">{pendingCount ?? 0}</div>
         </Link>
         <Link to="/supervisor/reports-list"
           className="rounded-xl bg-slate-100 p-3 text-center text-xs text-slate-800 hover:bg-slate-200">
           Reports (filter)
           <div className="text-lg font-bold">📋</div>
         </Link>
         <Link to="/supervisor/reports"
           className="rounded-xl bg-slate-100 p-3 text-center text-xs text-slate-800 hover:bg-slate-200">
           Payroll CSV
           <div className="text-lg font-bold">⬇</div>
         </Link>
         <Link to="/supervisor/daily-report"
           className="rounded-xl bg-slate-100 p-3 text-center text-xs text-slate-800 hover:bg-slate-200">
           Daily report
           <div className="text-lg font-bold">{new Date().getDate()}</div>
         </Link>
         {analyticsEnabled && (
           <Link to="/supervisor/analytics"
             className="rounded-xl bg-violet-50 p-3 text-center text-xs text-violet-900 hover:bg-violet-100">
             Analytics
             <div className="text-lg font-bold">📊</div>
           </Link>
         )}
       </div>

      <div className="grid grid-cols-2 gap-2">
        <Link to="/supervisor/invite-worker"
          className="rounded-xl bg-emerald-50 p-3 text-center text-sm text-emerald-900 hover:bg-emerald-100">
          + Invite worker
        </Link>
        <Link to="/supervisor/manual-punch"
          className="rounded-xl bg-emerald-50 p-3 text-center text-sm text-emerald-900 hover:bg-emerald-100">
          + Manual punch
        </Link>
        <Link to="/supervisor/briefings"
          className="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900 hover:bg-amber-100">
          ✏ Briefings
        </Link>
        <Link to="/supervisor/pin-resets"
          className="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-900 hover:bg-amber-100">
          🔑 PIN resets
        </Link>
        <Link to="/supervisor/daily-reports-list"
          className="col-span-2 rounded-xl bg-slate-100 p-3 text-center text-sm text-slate-800 hover:bg-slate-200">
          📋 Browse daily reports
        </Link>
      </div>

      <section>
        <h2 className="mb-2 text-lg font-bold text-slate-900">
          Anomalies <span className="text-slate-400">({sortedFlagged.length})</span>
        </h2>
        {isPending && <p className="text-slate-500">Loading…</p>}
        {sortedFlagged.length === 0 && <p className="text-sm text-slate-500">No anomalies today.</p>}

        {sortedFlagged.length > 0 && selected.size > 0 && (
          <div className="mb-2 flex items-center gap-2 rounded-xl bg-slate-100 p-2 text-sm">
            <span>{selected.size} selected</span>
            <button
              onClick={() => verify.mutate([...selected])}
              className="ml-auto rounded-md bg-green-600 px-3 py-1 text-white"
            >
              Verify all
            </button>
            <button onClick={() => setSelected(new Set())} className="text-slate-600 underline">
              Clear
            </button>
          </div>
        )}

        <ul className="flex flex-col gap-2">
          {sortedFlagged.map((row) => (
            <Row
              key={row.id}
              row={row}
              checked={selected.has(row.id)}
              expanded={expandedId === row.id}
              onToggle={() => toggle(row.id)}
              onExpand={() => setExpandedId(expandedId === row.id ? null : row.id)}
              onSelfieClick={() => setLightboxPath(row.selfie_url)}
              onVerify={() => verify.mutate([row.id])}
              onReject={() => reject.mutate(row.id)}
            />
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold text-slate-900">
          All today <span className="text-slate-400">({clean.length})</span>
        </h2>
        <ul className="flex flex-col gap-2">
          {clean.map((row) => (
            <Row
              key={row.id}
              row={row}
              compact
              expanded={expandedId === row.id}
              onExpand={() => setExpandedId(expandedId === row.id ? null : row.id)}
              onSelfieClick={() => setLightboxPath(row.selfie_url)}
              onVerify={() => verify.mutate([row.id])}
            />
          ))}
        </ul>
      </section>

      <SelfieLightbox path={lightboxPath} onClose={() => setLightboxPath(null)} />
    </RoleScaffold>
  )
}

/**
 * Renders the captured digital footprint as TWO separate collapsible
 * sections so the supervisor can audit the image evidence and the device
 * context independently (M17).
 */
function MetadataPanels({ metadata }: { metadata: Record<string, unknown> | null }) {
  if (!metadata || Object.keys(metadata).length === 0) return null
  const image  = (metadata as { image?: unknown }).image  ?? null
  const camera = (metadata as { camera?: unknown }).camera ?? null
  const device = (metadata as { device?: unknown }).device ?? null
  // Anything we don't recognise (forwards-compat) falls into 'other'
  const other: Record<string, unknown> = { ...metadata }
  delete other.image
  delete other.camera
  delete other.device

  const renderJson = (label: string, value: unknown, palette = 'bg-white') =>
    value && Object.keys(value as object).length > 0 ? (
      <details className="mt-2">
        <summary className="cursor-pointer text-slate-600">{label}</summary>
        <pre className={`mt-1 max-h-48 overflow-auto rounded ${palette} p-2 text-[10px] text-slate-700`}>
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    ) : null

  return (
    <>
      {(image || camera) && (
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-600">
            🖼 Image metadata (selfie + camera track)
          </summary>
          <div className="mt-1 rounded bg-white p-2 text-[10px] text-slate-700">
            {image  ? renderJson('Image', image, 'bg-slate-50')  : null}
            {camera ? renderJson('Camera track', camera, 'bg-slate-50') : null}
          </div>
        </details>
      )}
      {device && Object.keys(device as object).length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-slate-600">
            💻 Device metadata (browser + screen + timezone + WebGL + network)
          </summary>
          <pre className="mt-1 max-h-72 overflow-auto rounded bg-white p-2 text-[10px] text-slate-700">
            {JSON.stringify(device, null, 2)}
          </pre>
        </details>
      )}
      {Object.keys(other).length > 0 && renderJson('Other', other)}
    </>
  )
}

function Row({
  row, compact, checked, expanded,
  onToggle, onExpand, onSelfieClick, onVerify, onReject,
}: {
  row: AttendanceRow
  compact?: boolean
  checked?: boolean
  expanded?: boolean
  onToggle?: () => void
  onExpand?: () => void
  onSelfieClick?: () => void
  onVerify?: () => void
  onReject?: () => void
}) {
  const dt = new Date(row.punched_at)
  const sev = sevOf(row.flag_reasons)
  return (
    <li className="rounded-xl bg-white p-3 shadow-sm">
      <div className="flex gap-3">
        {!compact && (
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            className="mt-2 h-5 w-5"
            aria-label="Select for bulk action"
          />
        )}
        <button
          type="button"
          onClick={onSelfieClick}
          className="shrink-0"
          aria-label="View selfie full size"
        >
          <SelfieThumb path={row.selfie_url} size={56} />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between">
            <span className="font-semibold truncate">
              {row.workers?.full_name ?? row.worker_id.slice(0, 6)}
            </span>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${sevColor(sev)}`}>
              {row.status}
            </span>
          </div>
          <div className="text-sm text-slate-500">
            {row.type.toUpperCase()} · {dt.toLocaleTimeString()} ·{' '}
            {row.sites?.name ?? row.site_id.slice(0, 6)}
          </div>
          {row.flag_reasons?.length > 0 && (
            <div className="mt-1 text-xs text-amber-700">⚠ {row.flag_reasons.join(', ')}</div>
          )}
          {row.distance_from_site_m != null && (
            <div className="mt-1 text-xs text-slate-400">
              {row.distance_from_site_m.toFixed(0)} m from site
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          {row.status !== 'verified' && row.status !== 'rejected' && (
            <button
              onClick={onVerify}
              className="rounded-md bg-green-600 px-2 py-1 text-xs text-white"
              aria-label="Verify"
            >
              ✓
            </button>
          )}
          {!compact && onReject && row.status !== 'rejected' && (
            <button
              onClick={onReject}
              className="rounded-md bg-red-600 px-2 py-1 text-xs text-white"
              aria-label="Reject"
            >
              ✗
            </button>
          )}
          <button
            type="button"
            onClick={onExpand}
            className="rounded-md bg-slate-200 px-2 py-1 text-center text-xs text-slate-700"
            aria-label={expanded ? 'Hide details' : 'Show details'}
          >
            {expanded ? '▴' : '▾'}
          </button>
          <Link
            to={`/supervisor/edit-punch/${row.id}`}
            className="rounded-md bg-slate-100 px-2 py-1 text-center text-xs text-slate-700"
            aria-label="Edit punch"
          >
            ✎
          </Link>
        </div>
      </div>

      {expanded && (
        <div className="mt-2 rounded-lg bg-slate-50 p-2 text-[11px]">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 font-mono">
            <dt className="text-slate-500">GPS coords</dt>
            <dd className="break-all">
              {row.device_lat?.toFixed(5) ?? '—'}, {row.device_lng?.toFixed(5) ?? '—'}
              {row.device_lat != null && row.device_lng != null && (
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${row.device_lat},${row.device_lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-2 text-brand-600 underline"
                >
                  open in Maps
                </a>
              )}
            </dd>

            <dt className="text-slate-500">GPS accuracy</dt>
            <dd>{row.gps_accuracy_m?.toFixed(0) ?? '—'} m</dd>

            <dt className="text-slate-500">Speed</dt>
            <dd>
              {row.speed_ms != null ? `${(row.speed_ms * 3.6).toFixed(1)} km/h` : '—'}
            </dd>

            <dt className="text-slate-500">Capture method</dt>
            <dd>{row.capture_method ?? '—'}</dd>

            <dt className="text-slate-500">Device fingerprint</dt>
            <dd className="break-all">{row.device_fingerprint ?? '—'}</dd>

            <dt className="text-slate-500">IP address</dt>
            <dd>{row.ip_address ?? '—'}</dd>

            <dt className="text-slate-500">User agent</dt>
            <dd className="break-all">{row.user_agent ?? '—'}</dd>

            {row.reviewer_comment && (
              <>
                <dt className="text-slate-500">Reviewer note</dt>
                <dd className="break-words">{row.reviewer_comment}</dd>
              </>
            )}
          </dl>

          <MetadataPanels metadata={row.selfie_metadata} />
        </div>
      )}
    </li>
  )
}
