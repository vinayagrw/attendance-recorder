import RoleScaffold from '../_RoleScaffold'

export default function AdminSites() {
  return (
    <RoleScaffold title="Sites" backTo="/admin/projects">
      <p className="text-slate-600">
        Site CRUD with Leaflet polygon geofence editor (PostGIS-backed). M6.
      </p>
    </RoleScaffold>
  )
}
