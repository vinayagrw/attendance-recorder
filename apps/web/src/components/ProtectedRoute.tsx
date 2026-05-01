import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useSupervisor } from '@/hooks/useSupervisor'

interface Props {
  /** If set, only this role passes. Default: any logged-in supervisor or admin. */
  requiredRole?: 'admin' | 'supervisor'
  /** Where to send unauthenticated users. */
  redirectTo?: string
}

export default function ProtectedRoute({
  requiredRole,
  redirectTo = '/supervisor/login',
}: Props) {
  const { supervisor, loading, isLoggedIn } = useSupervisor()
  const location = useLocation()

  if (loading) {
    return (
      <div className="mx-auto flex min-h-full max-w-md items-center justify-center p-6 text-slate-500">
        Loading…
      </div>
    )
  }

  if (!isLoggedIn) {
    return <Navigate to={redirectTo} replace state={{ from: location.pathname }} />
  }

  if (!supervisor) {
    return (
      <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-3 p-6 text-center">
        <h1 className="text-xl font-bold text-slate-900">Account not linked</h1>
        <p className="text-slate-600">
          Your sign-in is valid, but your account isn't linked to a supervisor record.
          Ask an admin to add you to the <code>supervisors</code> table.
        </p>
      </div>
    )
  }

  if (requiredRole === 'admin' && supervisor.role !== 'admin') {
    return <Navigate to="/supervisor/dashboard" replace />
  }

  return <Outlet />
}
