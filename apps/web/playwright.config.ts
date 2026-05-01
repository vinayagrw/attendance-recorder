import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 5175)
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  // 60 s per test (was 30 s). The dev server keeps a realtime websocket open
  // for live attendance, and context teardown occasionally takes 30+ seconds
  // to close those connections cleanly. Production builds (vite preview)
  // teardown faster; we still need this slack against `pnpm dev`.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: BASE_URL,
    headless: true,
    trace: 'retain-on-failure',
  },
  // Don't auto-spawn the dev server — the user runs `pnpm dev` from the
  // repo root which already starts vite + supabase functions in parallel.
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera', 'geolocation'],
        geolocation: { latitude: 12.9698, longitude: 77.75 },
      },
    },
  ],
})
