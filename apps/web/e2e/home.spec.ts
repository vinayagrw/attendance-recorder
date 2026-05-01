import { test, expect } from '@playwright/test'

test('home page renders the three role buttons', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Attendance Recorder' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Worker' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Supervisor' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Admin' })).toBeVisible()
})

test('supervisor login renders the email/password form', async ({ page }) => {
  await page.goto('/supervisor/login')
  await expect(page.getByRole('heading', { name: 'Supervisor login' })).toBeVisible()
  await expect(page.getByLabel('Email')).toBeVisible()
  await expect(page.getByLabel('Password')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible()
})

test('not-found route renders the 404 page', async ({ page }) => {
  await page.goto('/this-does-not-exist')
  await expect(page.getByRole('heading', { name: '404' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Go home' })).toBeVisible()
})
