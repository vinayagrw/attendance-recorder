import { useEffect, useState } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const DISMISS_KEY = 'pwa-install-dismissed-at'
const DISMISS_TTL_DAYS = 14

export default function InstallPrompt() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null)

  useEffect(() => {
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0)
    const tooSoon = Date.now() - dismissedAt < DISMISS_TTL_DAYS * 24 * 3600 * 1000

    const handler = (e: Event) => {
      e.preventDefault()
      if (!tooSoon) setEvent(e as BeforeInstallPromptEvent)
    }
    window.addEventListener('beforeinstallprompt', handler)
    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  if (!event) return null

  const handleInstall = async () => {
    await event.prompt()
    const result = await event.userChoice
    if (result.outcome !== 'accepted') {
      localStorage.setItem(DISMISS_KEY, String(Date.now()))
    }
    setEvent(null)
  }

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setEvent(null)
  }

  return (
    <div className="fixed inset-x-2 bottom-2 z-50 rounded-xl bg-slate-900 p-3 text-sm text-white shadow-lg">
      <div className="font-semibold">Install Attendance app</div>
      <div className="text-slate-300">
        Add it to your home screen for fast launch and offline support.
      </div>
      <div className="mt-2 flex gap-2">
        <button onClick={handleInstall} className="rounded-md bg-brand-600 px-3 py-1 font-medium">
          Install
        </button>
        <button onClick={handleDismiss} className="rounded-md bg-slate-700 px-3 py-1">
          Not now
        </button>
      </div>
    </div>
  )
}
