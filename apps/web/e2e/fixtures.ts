// Shared test data + helpers for the Playwright suite.
// Mirrors what scripts/e2e.sh does at the API level so the UI tests can
// rely on a known seed state.

export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? 'http://127.0.0.1:54321'
export const ANON_KEY =
  process.env.E2E_ANON_KEY ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH'
export const SUPERVISOR_EMAIL = process.env.E2E_SUPERVISOR_EMAIL ?? 'viagr@ciklum.com'
export const SUPERVISOR_PASS = process.env.E2E_SUPERVISOR_PASS ?? 'LocalDev2026!'

export const SEED = {
  projectId: '11111111-1111-1111-1111-111111111111',
  siteId: '22222222-2222-2222-2222-222222222222',
  workers: [
    { id: '33333333-3333-3333-3333-333333333333', name: 'Ravi Kumar', pin: '1234' },
    { id: '44444444-4444-4444-4444-444444444444', name: 'Priya Singh', pin: '5678' },
    { id: '55555555-5555-5555-5555-555555555555', name: 'Anil Yadav', pin: '9012' },
  ],
}

export async function getSupervisorToken(): Promise<string> {
  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON_KEY },
    body: JSON.stringify({ email: SUPERVISOR_EMAIL, password: SUPERVISOR_PASS }),
  })
  if (!res.ok) throw new Error(`supervisor login failed: ${res.status}`)
  const json = (await res.json()) as { access_token: string }
  return json.access_token
}

export async function reactivateSeedWorkers() {
  const token = await getSupervisorToken()
  for (const w of SEED.workers) {
    await fetch(`${SUPABASE_URL}/rest/v1/workers?id=eq.${w.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: 'active' }),
    })
  }
}

// UI-based supervisor login. Reusable across tests that need an authenticated
// browser context. Slower than storageState reuse but robust against minor
// storage-key changes in supabase-js.
export async function loginAsSupervisor(page: import('@playwright/test').Page) {
  await page.goto('/supervisor/login')
  await page.getByLabel('Email').fill(SUPERVISOR_EMAIL)
  const pwd = page.getByLabel('Password')
  await pwd.fill(SUPERVISOR_PASS)
  await pwd.press('Enter')
  // Wait for the dashboard URL to confirm session is live
  await page.waitForURL(/\/supervisor\/dashboard$/, { timeout: 15_000 })
}

export async function deleteAllAttendance() {
  const token = await getSupervisorToken()
  await fetch(`${SUPABASE_URL}/rest/v1/attendance?id=neq.00000000-0000-0000-0000-000000000000`, {
    method: 'DELETE',
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
  })
}
