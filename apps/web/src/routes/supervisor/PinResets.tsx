import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface PinResetRow {
  id: string
  worker_id: string
  contact_phone: string | null
  note: string | null
  status: string
  requested_at: string
  workers?: { full_name: string; phone: string | null } | null
}

export default function SupervisorPinResets() {
  const qc = useQueryClient()
  const [resetting, setResetting] = useState<string | null>(null)
  const [newPin, setNewPin] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isPending } = useQuery({
    queryKey: ['pin-resets'],
    queryFn: async (): Promise<PinResetRow[]> => {
      const { data, error } = await supabase
        .from('pin_reset_requests')
        .select('id, worker_id, contact_phone, note, status, requested_at, workers(full_name, phone)')
        .eq('status', 'pending')
        .order('requested_at')
      if (error) throw error
      return (data as unknown as PinResetRow[]) ?? []
    },
    refetchInterval: 30_000,
  })

  const reject = useMutation({
    mutationFn: async (id: string) => {
      const reason = prompt('Reason for rejecting this reset?') ?? ''
      const { error } = await supabase
        .from('pin_reset_requests')
        .update({ status: 'rejected', reviewer_comment: reason })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pin-resets'] }),
  })

  const doReset = async (workerId: string, requestId: string) => {
    setError(null)
    setInfo(null)
    if (!/^\d{4,6}$/.test(newPin)) {
      setError('PIN must be 4-6 digits')
      return
    }
    try {
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
        body: JSON.stringify({ workerId, newPin, requestId }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Reset failed (${res.status})`)
      setInfo(
        `PIN set to ${newPin}. Tell the worker in person — this won't be shown again.`,
      )
      logger.info('pin reset performed', { module: 'PinResets', workerId, requestId })
      setNewPin('')
      setResetting(null)
      qc.invalidateQueries({ queryKey: ['pin-resets'] })
    } catch (e) {
      logger.error(e, { module: 'PinResets', action: 'reset', workerId })
      setError((e as Error).message)
    }
  }

  return (
    <RoleScaffold title="PIN reset requests" backTo="/supervisor/dashboard">
      <p className="text-sm text-slate-600">
        Workers who tap "Forgot PIN?" land here. Pick a new 4-6 digit PIN, tell them
        verbally, and the worker can sign in immediately.
      </p>

      {isPending && <p className="text-slate-500">Loading…</p>}
      {data && data.length === 0 && (
        <p className="text-sm text-slate-500">No pending reset requests.</p>
      )}

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

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
            {r.note && <div className="mt-1 text-xs text-slate-600">"{r.note}"</div>}

            {resetting === r.id ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="New PIN"
                  className="input-field flex-1 text-center"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                />
                <button
                  onClick={() => doReset(r.worker_id, r.id)}
                  className="rounded-md bg-green-600 px-3 py-2 text-sm text-white"
                >
                  Set
                </button>
                <button
                  onClick={() => { setResetting(null); setNewPin('') }}
                  className="rounded-md bg-slate-200 px-3 py-2 text-sm"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex gap-2">
                <button
                  onClick={() => { setResetting(r.id); setNewPin('') }}
                  className="rounded-md bg-brand-600 px-3 py-1 text-sm text-white"
                >
                  Reset PIN
                </button>
                <button
                  onClick={() => reject.mutate(r.id)}
                  className="rounded-md bg-red-600 px-3 py-1 text-sm text-white"
                >
                  Reject
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </RoleScaffold>
  )
}
