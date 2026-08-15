import { expect, test } from '@playwright/test'

test('plans and locks three matchups', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('[data-role="home-fighter"]')).toHaveCount(3)
  await expect(page.locator('[data-role="opponent-slot"]')).toHaveCount(3)
  await expect(page.getByTestId('confirm-lineup')).toBeDisabled()

  for (const [fighterId, boutIndex] of [['aquila', 0], ['nerva', 1], ['brutus', 2]] as const) {
    await page.getByTestId(`fighter-${fighterId}`).click()
    await page.getByTestId(`slot-${boutIndex}`).click()
  }

  await expect(page.getByTestId('confirm-lineup')).toBeEnabled()
  await page.getByTestId('confirm-lineup').click()
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')
})

async function finishActiveBout(page: import('@playwright/test').Page) {
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(2700))
}

test('resets arena presentation for the second bout', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const canvas = page.locator('canvas')
  await expect(canvas).toHaveAttribute('data-active-bout-index', '1')
  await expect.poll(async () => Number(await canvas.getAttribute('data-last-event-id'))).toBeGreaterThan(0)
})