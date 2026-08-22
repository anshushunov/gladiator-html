import { expect, test } from '@playwright/test'

test('shows the decision panel only when asked for, actually within the viewport', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('decision-panel')).toHaveCount(0)

  const viewport = { width: 1280, height: 800 }
  await page.setViewportSize(viewport)
  await page.goto('/?seed=20260815&snapshot&debugDecisions=1')
  // Task 8 removed the old auto-advance bridge: a fresh load now lands on
  // the season board, not the planning screen. This test exists to catch
  // `.below-arena-row` (and the panel it can hold) being pushed below the
  // viewport by the planning screen's five fighter cards -- a defect the
  // season board's own, shorter layout cannot reproduce -- so it must
  // actually open the series before measuring, or it silently measures the
  // wrong screen.
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextSeries())
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

/**
 * Shared by every test below, in two different situations: right after
 * `page.goto` (the app boots onto the season board -- Task 8 removed the old
 * auto-advance bridge -- so this `startNextSeries()` is what actually opens
 * series 0's planning screen), and once, in `'clears decisions on
 * rematch...'` below, right after a mid-season `continueSeason()` -- which
 * leaves `season.activeSeries` `null` on the season board again, where this
 * same call is what opens the next series. Kept unconditional here, rather
 * than split into two variants, because this one helper has to stay correct
 * in both call sites.
 */
async function assignAndConfirm(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
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

async function startSeededBoutAndMeasure(page: import('@playwright/test').Page, url: string) {
  await page.goto(url)
  await assignAndConfirm(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(200))
  const box = async (testId: string) => page.getByTestId(testId).boundingBox()
  return { arena: await box('arena'), home: await box('active-home'), away: await box('active-away') }
}

// A first revision fixed non-overlap by giving the panel its own column
// beside `#series-ui`/`#battle-ui`, which shares the arena's *row* and so
// shrinks the arena to make room for the panel. That passed a pure
// non-overlap check at 1280px, where it degrades gracefully -- but at
// 1038px wide the arena collapsed to an unwatchably narrow strip (~200x520)
// with its own title clipped mid-word. Non-overlap alone does not catch a
// panel that fits only by starving the arena, so this checks the stronger
// property directly: the panel must not take width from the arena at any
// width, which a same-width with/without comparison proves and a mere
// non-overlap assertion does not.
for (const width of [1024, 1280, 1440]) {
  test(`arena keeps its exact geometry with the decision panel present, at ${width}px`, async ({ page }) => {
    const viewport = { width, height: 743 }
    await page.setViewportSize(viewport)

    const without = await startSeededBoutAndMeasure(page, '/?seed=20260815')
    const withPanel = await startSeededBoutAndMeasure(page, '/?seed=20260815&debugDecisions=1')

    for (const [name, box] of [
      ['arena', withPanel.arena],
      ['home card', withPanel.home],
      ['away card', withPanel.away],
    ] as const) {
      expect(box, `${name} has no layout box`).not.toBeNull()
    }

    // The core requirement: the panel must not take width from the arena (or
    // move the HP cards) at all, at any width -- not merely avoid overlapping
    // it. A tiny epsilon absorbs sub-pixel rounding, not a real size change.
    for (const key of ['arena', 'home', 'away'] as const) {
      const a = without[key]!
      const b = withPanel[key]!
      expect(b.x, `${key}.x changed with the panel present`).toBeCloseTo(a.x, 0)
      expect(b.y, `${key}.y changed with the panel present`).toBeCloseTo(a.y, 0)
      expect(b.width, `${key}.width changed with the panel present`).toBeCloseTo(a.width, 0)
      expect(b.height, `${key}.height changed with the panel present`).toBeCloseTo(a.height, 0)
    }

    const panel = page.getByTestId('decision-panel')
    const panelBox = await panel.boundingBox()
    expect(panelBox, 'decision panel has no layout box').not.toBeNull()

    // Every element stays fully inside the viewport -- the earlier bug that
    // `toBeVisible()` alone missed (see the first test in this file).
    for (const box of [panelBox, withPanel.arena, withPanel.home, withPanel.away]) {
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    }

    // No pair among the panel, the arena, and both HP cards may occlude
    // another -- the bug an earlier `position: fixed` revision had (measured
    // `top: 416, left: 809, width: 440, height: 368` against a ~1280x743
    // viewport, landing on the arena and the away HP card).
    expect(overlaps(panelBox!, withPanel.arena!), 'decision panel overlaps the arena').toBe(false)
    expect(overlaps(panelBox!, withPanel.home!), 'decision panel overlaps the home HP card').toBe(false)
    expect(overlaps(panelBox!, withPanel.away!), 'decision panel overlaps the away HP card').toBe(false)

    // The bout title must not be clipped -- the visible symptom of the
    // column-width revision's arena collapse ("ut I . Brutus vs Drus").
    const titleOverflow = await page.getByTestId('battle-status').evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(titleOverflow, 'bout title is clipped').toBe(false)
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

  // Play out all three bouts of the series so `continueSeason()` (which only
  // applies once the active series has reached its own `summary` phase) is
  // actually callable.
  for (let bout = 0; bout < 3; bout += 1) {
    await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }

  const rows = page.getByTestId('decision-panel-row')
  await expect(rows.first()).toBeVisible()
  const boutThreeCount = await rows.count()
  expect(boutThreeCount).toBeGreaterThan(0)

  // `rematch()` is gone -- `continueSeason()` closes out the series that just
  // finished (roster wear, its own `SeriesRecord`, the season score) and
  // returns to the season board. Mid-season (only one of three series
  // played), that board does not auto-open the next series -- `main.ts`
  // simply renders it and waits for a real `start-series` click (or, here,
  // the dev API's equivalent) -- so `season.activeSeries` is genuinely `null`
  // here, and stays that way until the `assignAndConfirm(page)` call below's
  // own `startNextSeries()` opens it (see that helper's own doc comment).
  await page.evaluate(() => window.__GLADIATOR_TEST__.continueSeason())
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
