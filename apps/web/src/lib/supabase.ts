import { createClient } from '@supabase/supabase-js'

const env = import.meta.env

const url =
  env.VITE_SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  ''

const anonKey =
  env.VITE_SUPABASE_ANON_KEY ??
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  ''

if (!url || !anonKey) {
  console.warn(
    '[supabase] Missing Supabase URL / anon key. Copy apps/web/.env.example to ' +
      'apps/web/.env.local and fill values from `supabase start` (local) or ' +
      'Supabase dashboard → Project Settings → API (cloud).',
  )
}

export const supabase = createClient(url, anonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})
