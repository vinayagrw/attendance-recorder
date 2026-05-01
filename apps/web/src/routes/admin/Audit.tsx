import RoleScaffold from '../_RoleScaffold'

export default function AdminAudit() {
  return (
    <RoleScaffold title="Audit log" backTo="/admin/projects">
      <p className="text-slate-600">
        Append-only audit trail (hash-chained for tamper evidence). M6.
      </p>
    </RoleScaffold>
  )
}
