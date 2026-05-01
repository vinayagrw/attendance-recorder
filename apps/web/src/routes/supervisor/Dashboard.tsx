import { useNavigate } from 'react-router-dom'
import RoleScaffold from '../_RoleScaffold'
import { useSupervisor } from '@/hooks/useSupervisor'
import { signOut } from '@/lib/auth'

export default function SupervisorDashboard() {
  const navigate = useNavigate()
  const { supervisor } = useSupervisor()

  const handleSignOut = async () => {
    await signOut()
    navigate('/supervisor/login', { replace: true })
  }

  return (
    <RoleScaffold title="Dashboard" backTo="/">
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <p className="text-sm text-slate-500">Signed in as</p>
        <p className="text-lg font-semibold text-slate-900">{supervisor?.full_name}</p>
        <p className="text-sm text-slate-500">
          Role: <span className="font-mono">{supervisor?.role}</span> · Scope:{' '}
          {supervisor?.scope_project_ids?.length ?? 0} project(s)
        </p>
      </div>

      <p className="text-slate-600">
        Today's live attendance feed + anomaly pane wires up in M5
        (see <code>docs/feat-anomaly-detection.md</code>).
      </p>

      <button type="button" className="btn-secondary" onClick={handleSignOut}>
        Sign out
      </button>
    </RoleScaffold>
  )
}
