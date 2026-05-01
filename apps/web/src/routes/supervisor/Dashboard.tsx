import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { signOut } from '@/lib/auth'
import { useSupervisor } from '@/hooks/useSupervisor'
import { useTodayAttendance, type AttendanceRow } from '@/hooks/useTodayAttendance'
import SelfieThumb from '@/components/SelfieThumb'

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
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const { data: pendingCount } = useQuery({
    queryKey: ['pending-approvals-count'],
    queryFn: async () => {
      const { count } = await supabase
        .from('workers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending_approval')
      return count ?? 0
    },
    refetchInterval: 60_000,
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

  const flagged = (today ?? []).filter((r) => r.status === 'flagged' || r.flag_reasons?.length > 0)
  const clean = (today ?? []).filter((r) => !flagged.includes(r))
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

      <div className="grid grid-cols-3 gap-2">
        <Link to="/supervisor/approvals"
          className="rounded-xl bg-blue-50 p-3 text-center text-xs text-blue-900 hover:bg-blue-100">
          Approvals
          <div className="text-lg font-bold">{pendingCount ?? 0}</div>
        </Link>
        <Link to="/supervisor/reports"
          className="rounded-xl bg-slate-100 p-3 text-center text-xs text-slate-800 hover:bg-slate-200">
          Reports
          <div className="text-lg font-bold">CSV</div>
        </Link>
        <Link to="/supervisor/daily-report"
          className="rounded-xl bg-slate-100 p-3 text-center text-xs text-slate-800 hover:bg-slate-200">
          Daily report
          <div className="text-lg font-bold">{new Date().getDate()}</div>
        </Link>
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
              onToggle={() => toggle(row.id)}
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
            <Row key={row.id} row={row} compact onVerify={() => verify.mutate([row.id])} />
          ))}
        </ul>
      </section>
    </RoleScaffold>
  )
}

function Row({
  row, compact, checked, onToggle, onVerify, onReject,
}: {
  row: AttendanceRow
  compact?: boolean
  checked?: boolean
  onToggle?: () => void
  onVerify?: () => void
  onReject?: () => void
}) {
  const dt = new Date(row.punched_at)
  const sev = sevOf(row.flag_reasons)
  return (
    <li className="flex gap-3 rounded-xl bg-white p-3 shadow-sm">
      {!compact && (
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-2 h-5 w-5"
        />
      )}
      <SelfieThumb path={row.selfie_url} size={56} />
      <div className="flex-1">
        <div className="flex items-center justify-between">
          <span className="font-semibold">{row.workers?.full_name ?? row.worker_id.slice(0, 6)}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs ${sevColor(sev)}`}>{row.status}</span>
        </div>
        <div className="text-sm text-slate-500">
          {row.type.toUpperCase()} · {dt.toLocaleTimeString()} · {row.sites?.name ?? row.site_id.slice(0, 6)}
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
        <Link
          to={`/supervisor/edit-punch/${row.id}`}
          className="rounded-md bg-slate-200 px-2 py-1 text-center text-xs text-slate-700"
          aria-label="Edit punch"
        >
          Edit
        </Link>
      </div>
    </li>
  )
}
