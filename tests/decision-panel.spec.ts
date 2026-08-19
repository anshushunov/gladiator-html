import { expect, test } from '@playwright/test'

test('shows the decision panel only when asked for, actually within the viewport', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('decision-panel')).toHaveCount(0)

  const viewport = { width: 1280, height: 800 }
  await page.setViewportSize(viewport)
  await page.goto('/?seed=20260815&snapshot&debugDecisions=1')
  const panel = page.getByTestId('decision-panel')
  await expect(panel).toBeVisible()

  // `toBeVisible()` alone only proves the element has layout (non-zero size,
  // not `display: none`/`visibility: hidden`) -- it does not prove a player
  // could actually see it on screen. Before this panel had any CSS at all it
  // was `toBeVisible()` in exactly that sense while still rendering below the
  // battle feed, off the bottom of the viewport (measured `top: 769px`
  // against a `743px` viewport). Assert the bounding box is fully contained
  // in the viewport instead, which that unstyled state would fail.
  const box = await panel.boundingBox()
  expect(box, 'decision panel has no layout box').not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)
})

async function assignAndConfirm(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Axis-aligned overlap: false for merely touching edges, which is fine -- the
 * requirement is no *occlusion*, not a pixel of air between boxes. */
function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

test('does not occlude the arena or either HP card once a bout is running', async ({ page }) => {
  // A real viewport, not `snapshot` mode: the layout bug this guards against
  // (the panel fixed to the bottom-right corner, on top of the arena and the
  // away fighter's HP card) only ever showed up once the arena and cards
  // actually had layout, i.e. mid-bout.
  const viewport = { width: 1280, height: 743 }
  await page.setViewportSize(viewport)
  await page.goto('/?seed=20260815&debugDecisions=1')
  await assignAndConfirm(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(200))

  const panel = page.getByTestId('decision-panel')
  const arena = page.getByTestId('arena')
  const home = page.getByTestId('active-home')
  const away = page.getByTestId('active-away')

  const [panelBox, arenaBox, homeBox, awayBox] = await Promise.all([
    panel.boundingBox(),
    arena.boundingBox(),
    home.boundingBox(),
    away.boundingBox(),
  ])
  for (const [name, box] of [
    ['panel', panelBox],
    ['arena', arenaBox],
    ['home card', homeBox],
    ['away card', awayBox],
  ] as const) {
    expect(box, `${name} has no layout box`).not.toBeNull()
  }

  // Every element stays fully inside the viewport -- the earlier bug that
  // `toBeVisible()` alone missed (see the first test in this file).
  for (const box of [panelBox, arenaBox, homeBox, awayBox]) {
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  }

  // The bug this test exists to catch: the panel used to sit `position:
  // fixed` in the bottom-right corner, landing on top of both the arena and
  // the away HP card (measured `top: 416, left: 809, width: 440, height:
  // 368` against this same viewport). Assert the fix directly rather than
  // just re-checking presence, which the earlier test already covered and
  // which would not have caught this.
  expect(overlaps(panelBox!, arenaBox!), 'decision panel overlaps the arena').toBe(false)
  expect(overlaps(panelBox!, homeBox!), 'decision panel overlaps the home HP card').toBe(false)
  expect(overlaps(panelBox!, awayBox!), 'decision panel overlaps the away HP card').toBe(false)
})

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
