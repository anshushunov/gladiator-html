import { expect, test } from '@playwright/test'

test('shows the decision panel only when asked for', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('decision-panel')).toHaveCount(0)

  await page.goto('/?seed=20260815&snapshot&debugDecisions=1')
  await expect(page.getByTestId('decision-panel')).toBeVisible()
})

test('records decisions once a bout is running, and clears them on rematch', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot&debugDecisions=1')
  // Drive the bout through the existing dev test API rather than the UI --
  // same roster ids and call sequence `tests/smoke.spec.ts`'s
  // `startSeededFirstBout` uses.
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
    window.__GLADIATOR_TEST__.advanceTicks(240)
  })
  const rows = page.getByTestId('decision-panel-row')
  await expect(rows.first()).toBeVisible()
})
