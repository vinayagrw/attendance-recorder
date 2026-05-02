import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useLayoutMode } from '@/hooks/useViewport'

interface Props {
  title: string
  backTo?: string
  children: ReactNode
}

/**
 * Page shell shared by every role. Has two layout modes that the user can
 * toggle via the header button:
 *   - **mobile**:  narrow column (max-w-md) — phone-friendly
 *   - **desktop**: wide canvas (max-w-screen-2xl) — full standards view
 *
 * The choice is persisted in localStorage by `useLayoutMode`, so it sticks
 * across reloads + propagates to every mounted RoleScaffold via a custom
 * event.
 */
export default function RoleScaffold({ title, backTo, children }: Props) {
  const { mode, toggleMode } = useLayoutMode()
  const isDesktop = mode === 'desktop'

  const containerClass = isDesktop
    ? 'mx-auto flex min-h-full w-full max-w-screen-2xl flex-col gap-4 p-6 sm:p-8'
    : 'mx-auto flex min-h-full max-w-md flex-col gap-4 p-6'

  return (
    <div className={containerClass}>
      <header className="flex items-center gap-3">
        {backTo && (
          <Link
            to={backTo}
            aria-label="Back"
            className="rounded-full p-2 text-slate-600 hover:bg-slate-200"
          >
            ←
          </Link>
        )}
        <h1 className="flex-1 text-2xl font-bold text-slate-900">{title}</h1>
        <button
          type="button"
          onClick={toggleMode}
          aria-label={`Switch to ${isDesktop ? 'mobile' : 'desktop'} layout`}
          title={`Currently ${mode}. Click to switch to ${isDesktop ? 'mobile' : 'desktop'}.`}
          className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-200"
        >
          {isDesktop ? '🖥 Desktop' : '📱 Mobile'}
        </button>
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}
