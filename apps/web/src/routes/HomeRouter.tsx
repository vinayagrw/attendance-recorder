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

      <a
        href="mailto:vinayagrw@gmail.com"
        className="group mt-4 rounded-2xl bg-gradient-to-r from-indigo-400 via-sky-400 to-emerald-400 p-[1px] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
      >
        <span className="flex items-center gap-3 rounded-2xl bg-white px-4 py-2">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-indigo-500 transition group-hover:rotate-[-8deg]" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          <span className="text-left leading-tight">
            <span className="block text-xs text-slate-500">Built by Vinay · say hello</span>
            <span className="block text-sm font-medium text-slate-800">vinayagrw@gmail.com</span>
          </span>
        </span>
      </a>
    </div>
  )
}
