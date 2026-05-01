import RoleScaffold from '../_RoleScaffold'

export default function WorkerHistory() {
  return (
    <RoleScaffold title="My attendance" backTo="/worker/punch">
      <p className="text-slate-600">Last 7 days with status badges. M4.</p>
    </RoleScaffold>
  )
}
