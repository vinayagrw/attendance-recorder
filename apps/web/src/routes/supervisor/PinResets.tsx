import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface PinResetRow {
  id: string
  worker_id: string
  contact_phone: string | null
  note: string | null
  requested_pin: string | null
  status: string
  requested_at: string
  workers?: { full_name: string; phone: string | null } | null
}

export default function SupervisorPinResets() {
  const qc = useQueryClient()

  const { data, isPending } = useQuery({
    queryKey: ['pin-resets'],
    queryFn: async (): Promise<PinResetRow[]> => {
      const { data, error } = await supabase
        .from('pin_reset_requests')
        .select(
          'id, worker_id, contact_phone, note, requested_pin, status, requested_at, ' +
            'workers(full_name, phone)',
        )
        .eq('status', 'pending')
        .order('requested_at')
      if (error) throw error
      return (data as unknown) as PinResetRow[]
    },
    refetchInterval: 30_000,
  })

  const approve = useMutation({
    mutationFn: async (req: PinResetRow) => {
      if (!req.requested_pin) throw new Error('Worker did not include a PIN — ask them to resubmit.')
      const session = (await supabase.auth.getSession()).data.session
      if (!session) throw new Error('Not signed in')
      const fnUrl = `${import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/worker-pin-reset`
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
        body: JSON.stringify({ requestId: req.id }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Approval failed (${res.status})`)
      logger.info('pin reset approved', {
        module: 'PinResets',
        requestId: req.id,
        workerId: req.worker_id,
      })
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pin-resets'] }),
    onError: (e) => logger.error(e, { module: 'PinResets', action: 'approve' }),
  })

  const reject = useMutation({
    mutationFn: async (req: PinResetRow) => {
      const reason = prompt('Reason for rejecting this reset?') ?? ''
      const { error } = await supabase
        .from('pin_reset_requests')
        .update({
          status: 'rejected',
          reviewer_comment: reason,
          requested_pin: null,
        })
        .eq('id', req.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pin-resets'] }),
  })

  return (
    <RoleScaffold title="PIN reset requests" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Workers tap "Forgot PIN?" and choose a new PIN themselves. You verify the worker's
        identity (in person or via phone) and tap <strong>Approve</strong> — that's it. The PIN
        they entered becomes their new password.
      </p>

      {isPending && <p className="text-slate-500">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">No pending reset requests.</p>
      )}

      {approve.error && (
        <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
          {(approve.error as Error).message}
        </div>
      )}

      <ul className="flex flex-col gap-2">
        {(data ?? []).map((r) => (
          <li key={r.id} className="rounded-xl bg-white p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <span className="font-semibold">
                {r.workers?.full_name ?? r.worker_id.slice(0, 6)}
              </span>
              <span className="text-xs text-slate-400">
                {new Date(r.requested_at).toLocaleString()}
              </span>
            </div>
            <div className="text-xs text-slate-500">
              Phone: {r.contact_phone || r.workers?.phone || 'unknown'}
            </div>
            {!r.requested_pin && (
              <div className="mt-1 rounded bg-amber-50 p-1 text-xs text-amber-800">
                ⚠ Worker didn't include a new PIN. Ask them to resubmit.
              </div>
            )}
            {r.note && <div className="mt-1 text-xs text-slate-600">"{r.note}"</div>}

            <div className="mt-2 flex gap-2">
              <button
                onClick={() => approve.mutate(r)}
                disabled={!r.requested_pin || approve.isPending}
                className="rounded-md bg-green-600 px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                onClick={() => reject.mutate(r)}
                className="rounded-md bg-red-600 px-3 py-1 text-sm text-white"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
