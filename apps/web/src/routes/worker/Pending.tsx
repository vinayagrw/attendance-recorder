import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import RoleScaffold from '../_RoleScaffold'
import { useWorker } from '@/hooks/useWorker'
import { signOut } from '@/lib/auth'

export default function WorkerPending() {
  const navigate = useNavigate()
  const { worker, loading } = useWorker()

  useEffect(() => {
    if (loading) return
    if (worker?.status === 'active') navigate('/worker/punch', { replace: true })
  }, [worker, loading, navigate])

  return (
    <RoleScaffold title="Awaiting approval">
      <p className="text-slate-600">
        Your registration was submitted. A supervisor will review your photo and approve your
        account before you can punch in.
      </p>
      <p className="text-sm text-slate-400">
        Status: {worker?.status ?? 'unknown'}. Pull to refresh, or sign in again later.
      </p>
      <button
        type="button"
        className="btn-secondary"
        onClick={async () => {
          await signOut()
          navigate('/worker/login', { replace: true })
        }}
      >
        Sign out
      </button>
    </RoleScaffold>
  )
}
