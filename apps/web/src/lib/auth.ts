import { supabase } from './supabase'

export type SignInResult =
  | { ok: true }
  | { ok: false; error: string }

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<SignInResult> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}
