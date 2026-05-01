import { supabase } from './supabase'

const cache = new Map<string, { url: string; expiresAt: number }>()

export async function getSignedSelfieUrl(
  path: string | null | undefined,
  expirySeconds = 60 * 10,
): Promise<string | null> {
  if (!path) return null

  const cached = cache.get(path)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const { data, error } = await supabase.storage
    .from('selfies')
    .createSignedUrl(path, expirySeconds)
  if (error || !data) return null

  cache.set(path, { url: data.signedUrl, expiresAt: Date.now() + expirySeconds * 900 })
  return data.signedUrl
}
