import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

export default function HomeRouter() {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-6 p-6">
      <header className="text-center">
        <h1 className="text-3xl font-bold text-slate-900">{t('app.name')}</h1>
        <p className="mt-1 text-slate-600">{t('app.tagline')}</p>
      </header>

      <div className="text-sm font-medium uppercase tracking-wider text-slate-500">
        {t('home.iAmA')}
      </div>

      <div className="flex w-full flex-col gap-3">
        <Link to="/worker/login" className="btn-primary text-center">
          {t('home.worker')}
        </Link>
        <Link to="/supervisor/login" className="btn-secondary text-center">
          {t('home.supervisor')}
        </Link>
        <Link to="/admin" className="btn-secondary text-center">
          {t('home.admin')}
        </Link>
      </div>

      <p className="mt-4 text-xs text-slate-400">v0 · scaffold · M0</p>
    </div>
  )
}
