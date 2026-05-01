import { useSignedUrl } from '@/hooks/useSignedUrl'

interface Props {
  path: string | null | undefined
  size?: number
  alt?: string
}

export default function SelfieThumb({ path, size = 56, alt = 'selfie' }: Props) {
  const url = useSignedUrl(path)
  const dim = `${size}px`
  if (!url) {
    return (
      <div
        className="rounded-md bg-slate-200 text-center text-xs leading-none text-slate-400"
        style={{ width: dim, height: dim, lineHeight: dim }}
      >
        —
      </div>
    )
  }
  return (
    <img
      src={url}
      alt={alt}
      className="rounded-md object-cover"
      style={{ width: dim, height: dim }}
    />
  )
}
