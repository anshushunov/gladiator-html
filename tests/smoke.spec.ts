import { expect, test } from '@playwright/test'

test('loads the arena and starts a bout', async ({ page }) => {
  await page.goto('/?snapshot')

  await expect(page.getByRole('heading', { name: 'Blood & Sand' })).toBeVisible()
  await expect(page.getByTestId('arena')).toBeVisible()
  await expect(page.getByTestId('fighter-red')).toContainText('Brutus')
  await expect(page.getByTestId('fighter-blue')).toContainText('Cassius')
  await expect(page.getByTestId('battle-status')).toHaveText('READY')

  await page.getByTestId('toggle-bout').click()
  await expect(page.getByTestId('battle-status')).toHaveText('FIGHT')

  await page.evaluate(() => window.__GLADIATOR_TEST__.advance(20))
  await expect(page.getByTestId('battle-status')).toHaveText(/wins|Draw/)
  await expect(page.getByTestId('toggle-bout')).toBeDisabled()
})

test('matches the stable arena snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/?snapshot')
  await expect(page.getByTestId('battle-status')).toHaveText('READY')
  await expect(page).toHaveScreenshot('arena.png', { fullPage: true })
})
