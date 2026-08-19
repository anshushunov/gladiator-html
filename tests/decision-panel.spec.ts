import { expect, test } from '@playwright/test'

test('shows the decision panel only when asked for', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('decision-panel')).toHaveCount(0)

  await page.goto('/?seed=20260815&snapshot&debugDecisions=1')
  await expect(page.getByTestId('decision-panel')).toBeVisible()
})

async function assignAndConfirm(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
}

test('records decisions once a bout is running, without being swamped by skipped noise', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot&debugDecisions=1')
  // Drive the bout through the existing dev test API rather than the UI --
  // same roster ids and call sequence `tests/smoke.spec.ts`'s
  // `startSeededFirstBout` uses.
  await assignAndConfirm(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(240))

  const rows = page.getByTestId('decision-panel-row')
  await expect(rows.first()).toBeVisible()

  // The panel's whole purpose is explaining decisions -- `skipped` fires for
  // every non-ready combatant every tick and is not a decision, so it must
  // never appear as a rendered row (it is dropped in favour of the separate
  // skipped-count summary below).
  const rowTexts = await rows.allTextContents()
  expect(rowTexts.length).toBeGreaterThan(0)
  for (const text of rowTexts) expect(text).not.toContain('skipped')
  // At least one row is a real weighted roll -- proof the visible rows are
  // decisions, not just forced/fallback bookkeeping.
  expect(rowTexts.some((text) => text.includes('roll'))).toBe(true)

  // The skipped count is tracked, just not rendered as rows: over 240 ticks
  // of a duel, both combatants are non-ready most ticks (not-due/mid-action).
  const skippedSummary = await page.getByTestId('decision-panel-skipped-count').textContent()
  expect(skippedSummary).toMatch(/\d+ skipped/)
})

test('clears decisions on rematch, with no leak into the next bout', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot&debugDecisions=1')
  await assignAndConfirm(page)

  // Play out all three bouts of the series so `rematch()` (which only
  // applies from the series' `summary` phase) is actually callable.
  for (let bout = 0; bout < 3; bout += 1) {
    await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }

  const rows = page.getByTestId('decision-panel-row')
  await expect(rows.first()).toBeVisible()
  const boutThreeCount = await rows.count()
  expect(boutThreeCount).toBeGreaterThan(0)

  await page.evaluate(() => window.__GLADIATOR_TEST__.rematch())
  await expect(rows).toHaveCount(0)
  await expect(page.getByTestId('decision-panel-skipped-count')).toHaveText('')

  // Start the next bout post-rematch and confirm nothing from the finished
  // series leaks in: every visible row must carry a tick number from the
  // fresh, short 240-tick window, never one of bout three's (which ran the
  // full 3600 ticks, so any surviving row would show a much higher tick).
  await assignAndConfirm(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(240))
  await expect(rows.first()).toBeVisible()
  const postRematchTexts = await rows.allTextContents()
  expect(postRematchTexts.length).toBeGreaterThan(0)
  for (const text of postRematchTexts) {
    const tick = Number(text.match(/^t(\d+)/)?.[1])
    expect(Number.isFinite(tick)).toBe(true)
    expect(tick).toBeLessThanOrEqual(240)
  }
})
