// Mounts once at the App root. Listens to react-router location changes and
// fires a `page_view` access_event for each one, tagged with the current
// session's actor (worker / supervisor / admin / anon).
//
// Debounced — only logs after the route is stable for 250ms — so rapid
// redirects (e.g. /  → /worker/login) don't double-fire.

import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useSession } from './useSession'
import { useSupervisor } from './useSupervisor'
import { useWorker } from './useWorker'
import { logAccess, type AccessActorType } from '@/lib/trafficLog'
import { APP_CONFIG } from '@/config/app'

export function useTrafficLogger() {
  const location = useLocation()
  const { session } = useSession()
  const { supervisor } = useSupervisor()
  const { worker } = useWorker()
  const lastLoggedRef = useRef<string | null>(null)

  useEffect(() => {
    const path = location.pathname + location.search

    let actorType: AccessActorType = 'anon'
    let actorId: string | null = null
    let actorLabel: string | null = null

    if (supervisor) {
      actorType = supervisor.role === 'admin' ? 'admin' : 'supervisor'
      actorId = supervisor.id
      actorLabel = supervisor.full_name
    } else if (worker) {
      actorType = 'worker'
      actorId = worker.id
      actorLabel = worker.full_name
    } else if (session) {
      actorType = 'worker'
      actorId = session.user.id
    }

    // Avoid double-logging the same path on remount / state churn.
    const key = `${actorType}:${actorId ?? 'anon'}:${path}`
    if (lastLoggedRef.current === key) return
    lastLoggedRef.current = key

    const t = window.setTimeout(() => {
      void logAccess({
        eventType: 'page_view',
        actorType,
        actorId,
        actorLabel,
        route: path,
      })
    }, APP_CONFIG.TRAFFIC_LOGGER_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [location.pathname, location.search, session, supervisor, worker])
}
