import { useEffect, useState } from 'react'
import { getSignedSelfieUrl } from '@/lib/storage'

export function useSignedUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let active = true
    if (!path) {
      setUrl(null)
      return
    }
    getSignedSelfieUrl(path).then((u) => {
      if (active) setUrl(u)
    })
    return () => {
      active = false
    }
  }, [path])
  return url
}
