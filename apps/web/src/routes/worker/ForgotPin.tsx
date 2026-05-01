import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { logger } from '@/lib/logger'

interface PickListWorker {
  id: string
  full_name: string
  status: string
}

export default function WorkerForgotPin() {
  const [workerId, setWorkerId] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [info, setInfo] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data: workers } = useQuery({
    queryKey: ['forgot-pin-pick-list'],
    queryFn: async (): Promise<PickListWorker[]> => {
      const { data } = await supabase.rpc('list_active_workers')
      return ((data as PickListWorker[]) ?? []).filter((w) => w.status === 'active')
    },
  })

  const submit = useMutation({
    mutationFn: async () => {
      if (!workerId) throw new Error('Pick your name')
      const { error } = await supabase.from('pin_reset_requests').insert({
        worker_id: workerId,
        contact_phone: phone || null,
        note: note || null,
        status: 'pending',
      })
      if (error) throw error
      logger.info('pin reset requested', { module: 'ForgotPin', workerId })
    },
    onSuccess: () => {
      setInfo(
        "Got it. Tell your supervisor — they'll see your request on their dashboard and reset your PIN within a short while.",
      )
      setWorkerId('')
      setPhone('')
      setNote('')
    },
    onError: (e) => {
      logger.error(e, { module: 'ForgotPin', action: 'submit' })
      setError((e as Error).message)
    },
  })

  return (
    <RoleScaffold title="Forgot PIN?" backTo="/worker/login">
      <p className="text-sm text-slate-600">
        Pick your name and submit. Your supervisor will reset your PIN for you in person — they'll
        give you the new PIN to use the next time you sign in.
      </p>

      <select
        className="input-field"
        value={workerId}
        onChange={(e) => setWorkerId(e.target.value)}
      >
        <option value="">— pick your name —</option>
        {(workers ?? []).map((w) => (
          <option key={w.id} value={w.id}>{w.full_name}</option>
        ))}
      </select>

      <input
        className="input-field"
        type="tel"
        inputMode="tel"
        placeholder="Your phone (so the supervisor can reach you)"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />

      <textarea
        className="input-field"
        rows={2}
        placeholder="Anything else? (optional)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
      {info && <div className="rounded-lg bg-green-50 p-3 text-sm text-green-700">{info}</div>}

      <button
        onClick={() => submit.mutate()}
        className="btn-primary"
        disabled={submit.isPending}
      >
        {submit.isPending ? 'Submitting…' : 'Submit reset request'}
      </button>

      <Link to="/worker/login" className="btn-secondary text-center">
        Back to login
      </Link>
    </RoleScaffold>
  )
}
