import { useEffect } from 'react'
import { useSignedUrl } from '@/hooks/useSignedUrl'

interface Props {
  path: string | null
  onClose: () => void
}

// Full-size selfie viewer. Click outside or press Esc to close. Includes the
// download link so the supervisor can save evidence for HR/payroll cases.
export default function SelfieLightbox({ path, onClose }: Props) {
  const url = useSignedUrl(path)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!path) return null

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-full max-w-full"
        onClick={(e) => e.stopPropagation()}
      >
        {url ? (
          <img
            src={url}
            alt="selfie full size"
            className="max-h-[85vh] max-w-full rounded-lg object-contain"
          />
        ) : (
          <div className="flex h-64 items-center justify-center text-white">Loading…</div>
        )}
        <div className="mt-3 flex items-center justify-between text-sm text-white">
          <a
            href={url ?? '#'}
            download
            target="_blank"
            rel="noreferrer"
            className="rounded-md bg-white/15 px-3 py-1 hover:bg-white/25"
          >
            Download / open in new tab
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-white/15 px-3 py-1 hover:bg-white/25"
          >
            Close (Esc)
          </button>
        </div>
      </div>
    </div>
  )
}
