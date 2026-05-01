import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'

interface Props {
  title: string
  backTo?: string
  children: ReactNode
}

export default function RoleScaffold({ title, backTo, children }: Props) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col gap-4 p-6">
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
        <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      </header>
      <div className="flex flex-col gap-4">{children}</div>
    </div>
  )
}
