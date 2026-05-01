import RoleScaffold from '../_RoleScaffold'

export default function SupervisorApprovals() {
  return (
    <RoleScaffold title="Pending approvals" backTo="/supervisor/dashboard">
      <p className="text-slate-600">
        Pending worker registrations queue with selfie & device review. M5.
      </p>
    </RoleScaffold>
  )
}
