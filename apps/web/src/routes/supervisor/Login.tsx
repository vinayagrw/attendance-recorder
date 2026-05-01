import RoleScaffold from '../_RoleScaffold'

export default function SupervisorLogin() {
  return (
    <RoleScaffold title="Supervisor login" backTo="/">
      <p className="text-slate-600">
        Email + password (Supabase Auth) with TOTP 2FA. Wired up in M1.
      </p>
    </RoleScaffold>
  )
}
