import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import RoleScaffold from '../_RoleScaffold'
import { supabase } from '@/lib/supabase'
import { workerEmail, workerPassword } from '@/hooks/useWorker'
import { useSession } from '@/hooks/useSession'
import { logAccess } from '@/lib/trafficLog'

interface PickListWorker {
  id: string
  full_name: string
  status: string
}

export default function WorkerLogin() {
  const navigate = useNavigate()
  const { session, loading } = useSession()
  const [workerId, setWorkerId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!loading && session) {
      // route based on worker.status — handled by /worker/punch's effect
      navigate('/worker/punch', { replace: true })
    }
  }, [loading, session, navigate])

  const { data: workers, isPending } = useQuery({
    queryKey: ['worker-pick-list'],
    queryFn: async (): Promise<PickListWorker[]> => {
      // Anon-readable RPC — RLS-bypassing security-definer fn that returns
      // only id/full_name/status. See migration 0009.
      const { data, error } = await supabase.rpc('list_active_workers')
      if (error) throw error
      return (data as PickListWorker[]) ?? []
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!workerId) return setError('Pick your name')
    if (!/^\d{4,6}$/.test(pin)) return setError('PIN is 4-6 digits')

    setSubmitting(true)
    const { error } = await supabase.auth.signInWithPassword({
      email: workerEmail(workerId),
      password: workerPassword(pin, workerId),
    })
    setSubmitting(false)
    if (error) {
      void logAccess({
        eventType: 'login_fail',
        actorType: 'worker',
        actorId: workerId,
        actorLabel: workers?.find((w) => w.id === workerId)?.full_name ?? null,
        route: '/worker/login',
        metadata: { reason: error.message },
      })
      setError(error.message.includes('Invalid login') ? 'Wrong PIN' : error.message)
      return
    }
    void logAccess({
      eventType: 'login',
      actorType: 'worker',
      actorId: workerId,
      actorLabel: workers?.find((w) => w.id === workerId)?.full_name ?? null,
      route: '/worker/login',
    })
  }

  return (
    <RoleScaffold title="Worker login" backTo="/">
      <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">Your name</span>
          <select
            className="input-field"
            value={workerId}
            onChange={(e) => setWorkerId(e.target.value)}
            disabled={isPending}
          >
            <option value="">— pick your name —</option>
            {(workers ?? []).map((w) => (
              <option key={w.id} value={w.id}>
                {w.full_name}
                {w.status !== 'active' ? ` · ${w.status}` : ''}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-slate-700">PIN (4-6 digits)</span>
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            className="input-field text-center text-2xl tracking-widest"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        </label>

        {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Log in'}
        </button>

        <Link to="/worker/register" className="btn-secondary text-center">
          First time? Register
        </Link>

        <Link to="/worker/forgot-pin" className="text-center text-sm text-slate-500 underline">
          Forgot PIN?
        </Link>
      </form>
    </RoleScaffold>
  )
}
