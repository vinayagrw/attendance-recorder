import { test, expect } from '@playwright/test'
import { SEED } from './fixtures'

test.describe.configure({ mode: 'serial' })

test('worker login dropdown is populated from anon RPC', async ({ page }) => {
  await page.goto('/worker/login')
  await expect(page.getByRole('heading', { name: 'Worker login' })).toBeVisible()

  const dropdown = page.getByLabel('Your name')
  await expect(dropdown).toBeVisible()
  // All seeded workers should appear (status filter inside the RPC)
  for (const w of SEED.workers) {
    await expect(dropdown).toContainText(w.name, { timeout: 10_000 })
  }
})

test('worker register screen renders both registration modes + form', async ({ page }) => {
  await page.goto('/worker/register')
  await expect(page.getByRole('heading', { name: 'Register' })).toBeVisible()
  await expect(page.getByText(/A supervisor will approve before you can punch in/)).toBeVisible()
  // M12: two modes via toggle buttons
  await expect(page.getByRole('button', { name: "I'm in the list" })).toBeVisible()
  await expect(page.getByRole('button', { name: "I'm not in the list" })).toBeVisible()
  await expect(page.getByPlaceholder('PIN (4-6 digits)')).toBeVisible()
  await expect(page.getByPlaceholder('Confirm PIN')).toBeVisible()
})

test('worker register self-mode reveals name + phone + site fields', async ({ page }) => {
  await page.goto('/worker/register')
  await page.getByRole('button', { name: "I'm not in the list" }).click()
  await expect(page.getByPlaceholder('Your full name')).toBeVisible()
  await expect(page.getByPlaceholder('Phone (optional)')).toBeVisible()
  await expect(page.getByLabel('Site')).toBeVisible()
})

test('worker pending screen has a sign-out path', async ({ page }) => {
  await page.goto('/worker/pending')
  await expect(page.getByRole('heading', { name: 'Awaiting approval' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
})

test('PIN form rejects non-numeric input', async ({ page }) => {
  await page.goto('/worker/login')
  const pin = page.getByLabel('PIN (4-6 digits)')
  await pin.fill('abc')
  // onChange handler strips non-digits → empty
  await expect(pin).toHaveValue('')
  // Use a string that fits within maxLength=6 so HTML truncation doesn't
  // shadow the JS strip we're testing.
  await pin.fill('12a3')
  await expect(pin).toHaveValue('123')
})
