import RoleScaffold from '../_RoleScaffold'

export default function WorkerPunch() {
  return (
    <RoleScaffold title="Punch In / Out" backTo="/worker/login">
      <p className="text-slate-600">
        Single-screen punch flow: live selfie + GPS dot + Punch In/Out button.
        Wired up in M4.
      </p>
    </RoleScaffold>
  )
}
