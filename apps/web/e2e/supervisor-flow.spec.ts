import { test, expect } from '@playwright/test'
import {
  SUPERVISOR_EMAIL, SUPERVISOR_PASS, SEED,
  reactivateSeedWorkers, deleteAllAttendance, loginAsSupervisor,
} from './fixtures'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  await reactivateSeedWorkers()
  await deleteAllAttendance()
})

test('supervisor logs in and lands on the dashboard', async ({ page }) => {
  await page.goto('/supervisor/login')
  await page.getByLabel('Email').fill(SUPERVISOR_EMAIL)
  const pwd = page.getByLabel('Password')
  await pwd.fill(SUPERVISOR_PASS)
  // Submit via Enter to dodge any "button stability" issues with btn-primary
  // transitions while react-hook-form's isSubmitting toggles.
  await pwd.press('Enter')

  await expect(page).toHaveURL(/\/supervisor\/dashboard$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible()
  await expect(page.getByText('Vinay (admin)')).toBeVisible()
  // 6 dashboard tiles (3 stat tiles + 2 action tiles + the row's edit/verify)
  await expect(page.getByRole('link', { name: /Approvals/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Reports/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Daily report/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /\+ Invite worker/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /\+ Manual punch/ })).toBeVisible()
})

test.describe('authenticated supervisor flows', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsSupervisor(page)
  })

  test('supervisor invite-worker form renders and validates', async ({ page }) => {
    await page.goto('/supervisor/invite-worker')
    await expect(page.getByRole('heading', { name: 'Invite worker' })).toBeVisible()
    await expect(page.getByText('Full name *')).toBeVisible()
    await expect(page.getByText('Assign to site *')).toBeVisible()

    // Submit empty → expect inline error
    await page.getByRole('button', { name: 'Invite worker' }).click()
    await expect(
      page.getByText(/Worker name is required|Pick a site/),
    ).toBeVisible({ timeout: 5_000 })
  })

  test('supervisor invites a brand-new worker end-to-end', async ({ browser, page }) => {
    const stamp = Date.now().toString().slice(-6)
    const newName = `E2E Worker ${stamp}`

    await page.goto('/supervisor/invite-worker')
    await page.getByLabel('Full name *').fill(newName)
    const siteSelect = page.getByLabel('Assign to site *')
    await siteSelect.selectOption({ index: 1 })
    await page.getByRole('button', { name: 'Invite worker' }).click()

    await expect(page.getByText(/Invited E2E Worker/)).toBeVisible({ timeout: 10_000 })

    // Verify the new worker appears in the anonymous pick-list. Use a fresh
    // context so the supervisor session doesn't redirect /worker/login away.
    const anonContext = await browser.newContext()
    const anonPage = await anonContext.newPage()
    await anonPage.goto('/worker/login')
    const dropdown = anonPage.getByLabel('Your name')
    await expect(dropdown).toContainText(newName, { timeout: 10_000 })
    await anonContext.close()
  })

  test('supervisor enters a manual punch (no camera needed)', async ({ page }) => {
    await page.goto('/supervisor/manual-punch')
    await expect(page.getByRole('heading', { name: 'Manual punch entry' })).toBeVisible()

    await page.getByLabel('Worker *').selectOption(SEED.workers[0].id)
    await page.getByLabel('Site *').selectOption(SEED.siteId)
    // Default IN, default time = now
    await page.getByLabel('Reason / note').fill('Worker phone died — entering from sign-in sheet')
    await page.getByRole('button', { name: /Record IN punch/ }).click()

    await expect(page.getByText(/Manual IN punch added/)).toBeVisible({ timeout: 10_000 })
  })

  test('supervisor sees the manual punch on the dashboard and can edit it', async ({ page }) => {
    await page.goto('/supervisor/dashboard')
    // wait for the realtime feed to populate
    await expect(page.getByText('Ravi Kumar').first()).toBeVisible({ timeout: 10_000 })

    // Click the Edit button on the first row
    const firstEdit = page.getByRole('link', { name: 'Edit punch' }).first()
    await firstEdit.click()

    await expect(page.getByRole('heading', { name: 'Edit punch' })).toBeVisible()
    await expect(page.getByText('Ravi Kumar')).toBeVisible()
    await expect(page.getByLabel('Date & time')).toBeVisible()

    // Set a reviewer comment and save
    await page.getByLabel('Reviewer comment').fill('Adjusted by supervisor in E2E test')
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText('Punch updated.')).toBeVisible({ timeout: 10_000 })
  })

  test('admin can navigate projects + workers + audit log', async ({ page }) => {
    await page.goto('/admin/projects')
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible()
    await expect(page.getByText(/Demo Project/)).toBeVisible()

    await page.goto('/admin/sites')
    await expect(page.getByRole('heading', { name: 'Sites' })).toBeVisible()
    await expect(page.getByText(/Tower A/)).toBeVisible()

    await page.goto('/admin/workers')
    await expect(page.getByRole('heading', { name: 'Workers' })).toBeVisible()
    await expect(page.getByText('Ravi Kumar')).toBeVisible()

    await page.goto('/admin/audit')
    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible()
    // Should have at least one row from the supervisor approval audit trigger
    await expect(page.getByText(/update_workers|insert_workers|update_attendance/).first())
      .toBeVisible({ timeout: 10_000 })
  })

  test('supervisor sign out returns to login', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/supervisor/dashboard')
    await page.getByRole('button', { name: 'Sign out' }).click()
    await expect(page).toHaveURL(/\/supervisor\/login$/)
    // Explicitly navigate away so the realtime channel from the dashboard
    // unsubscribes cleanly before context teardown — without this, the
    // websocket close occasionally exceeds the default 30s teardown budget.
    await page.goto('about:blank')
  })
})
