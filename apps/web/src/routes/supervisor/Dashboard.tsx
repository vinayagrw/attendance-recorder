import RoleScaffold from '../_RoleScaffold'

export default function SupervisorDashboard() {
  return (
    <RoleScaffold title="Dashboard" backTo="/supervisor/login">
      <p className="text-slate-600">
        Today's live attendance feed + anomaly pane. M5.
      </p>
    </RoleScaffold>
  )
}
