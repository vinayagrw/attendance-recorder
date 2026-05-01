import { useTranslation } from 'react-i18next'
import RoleScaffold from '../_RoleScaffold'

export default function WorkerRegister() {
  const { t } = useTranslation()
  return (
    <RoleScaffold title={t('worker.register.title')} backTo="/worker/login">
      <p className="text-slate-600">{t('worker.register.instructions')}</p>
      <p className="text-xs text-slate-400">
        Camera + GPS + device fingerprint capture lands in M3.
      </p>
    </RoleScaffold>
  )
}
