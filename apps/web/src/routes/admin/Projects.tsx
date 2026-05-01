import RoleScaffold from '../_RoleScaffold'

export default function AdminProjects() {
  return (
    <RoleScaffold title="Projects" backTo="/">
      <p className="text-slate-600">
        Project lifecycle CRUD (planning → active → on_hold → completed →
        archived). M6.
      </p>
    </RoleScaffold>
  )
}
