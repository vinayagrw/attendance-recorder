import RoleScaffold from '../_RoleScaffold'

export default function WorkerPending() {
  return (
    <RoleScaffold title="Awaiting approval" backTo="/">
      <p className="text-slate-600">
        Your registration is being reviewed by your supervisor. You'll be able
        to punch in once approved.
      </p>
    </RoleScaffold>
  )
}
