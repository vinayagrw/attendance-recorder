import RoleScaffold from '../_RoleScaffold'

export default function AdminWorkers() {
  return (
    <RoleScaffold title="Workers" backTo="/admin/projects">
      <p className="text-slate-600">
        Invite, edit assigned site, suspend, offboard. PIN reset / lockout. M6.
      </p>
    </RoleScaffold>
  )
}
