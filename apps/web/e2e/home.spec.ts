import { test, expect } from '@playwright/test'

// Smoke test for the role picker home page. Doesn't depend on Supabase being
// reachable — purely renders the static shell.
test('home page renders the three role buttons', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByText('Attendance Recorder')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Worker' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Supervisor' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
})

test('worker login route renders the pin form (skeleton)', async ({ page }) => {
  await page.goto('/worker/login')
  await expect(page.getByRole('heading', { name: 'Worker login' })).toBeVisible()
  await expect(page.getByText('Your name')).toBeVisible()
  await expect(page.getByText('PIN (4-6 digits)')).toBeVisible()
})

test('supervisor login renders the email/password form', async ({ page }) => {
  await page.goto('/supervisor/login')
  await expect(page.getByRole('heading', { name: 'Supervisor login' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
})
