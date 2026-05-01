import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import RoleScaffold from '../_RoleScaffold'

export default function WorkerLogin() {
  const { t } = useTranslation()
  return (
    <RoleScaffold title={t('worker.login.title')} backTo="/">
      <p className="text-slate-600">
        Pick your name from the list, then enter your PIN. (Wired up in M2.)
      </p>
      <Link to="/worker/register" className="btn-secondary text-center">
        {t('worker.login.register')}
      </Link>
    </RoleScaffold>
  )
}
