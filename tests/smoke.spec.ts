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
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
}

async function startSeededFirstBout(page: import('@playwright/test').Page) {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
}

test('tracks previous/current tick snapshots for render interpolation', async ({ page }) => {
  await startSeededFirstBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(10))
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).toMatchObject({
    previousTick: 9,
    currentTick: 10,
    paused: true,
  })
})

test('resets render snapshot ticks to zero when the next bout starts', async ({ page }) => {
  await startSeededFirstBout(page)
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).toMatchObject({
    previousTick: 0,
    currentTick: 0,
  })
})

test('clears render snapshots and combatant data on rematch, with no leak from the prior bout', async ({ page }) => {
  await startSeededFirstBout(page)
  for (let bout = 0; bout < 3; bout += 1) {
    await finishActiveBout(page)
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveBattleTraceHash())).not.toBeNull()
  await page.evaluate(() => window.__GLADIATOR_TEST__.rematch())
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).toMatchObject({
    previousTick: null,
    currentTick: null,
  })
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveBattleTraceHash())).toBeNull()
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())).toEqual({})
})

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

test('renders movement-rich encounter combat', async ({ page }) => {
  await startSeededFirstBout(page)
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  expect(after).not.toEqual(before)
  await expect(page.locator('canvas')).toHaveAttribute('data-rendered-combatants', '2')
})

test('shows a readable fallback and keeps the series running after WebGL context loss', async ({ page }) => {
  await startSeededFirstBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))

  const tickBefore = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(tickBefore).toEqual(expect.any(Number))

  await page.evaluate(() => {
    document.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost'))
  })

  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()

  // The series and runtime continue after the presentation failure: ticks
  // still advance, and the fallback stays up rather than crashing the page.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  const tickAfter = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(tickAfter).toBeGreaterThan(tickBefore as number)
  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()

  // A later bout boundary must not silently re-show the disposed canvas or
  // rebuild rigs against it -- the fallback owns the arena for the rest of
  // the session (no context-loss recovery is attempted).
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()
})

test('plays three bouts, reports a 2–1 win, and rematches the same seed', async ({ page }) => {
  // A stats-led ordering, deliberately NOT the all-counter one. Under Task 13's
  // final balance the all-counter lineup (Brutus->Drusus, Aquila->Cassius,
  // Nerva->Magnus) actually loses 1-2, which is the design's golden scenario
  // working as intended: the visible counter triangle is useful but is not a
  // mechanical answer to stronger individual opponents. See series.test.ts's
  // golden-scenario block for the full six-lineup table.
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('brutus', 1)
    window.__GLADIATOR_TEST__.assign('nerva', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  for (let bout = 0; bout < 3; bout += 1) {
    await finishActiveBout(page)
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  await expect(page.getByRole('heading', { name: 'School victory' })).toBeFocused()
  await expect(page.getByTestId('series-score')).toHaveText('2–1')
  await expect(page.getByTestId('bout-result')).toHaveCount(3)
  await expect(page.getByTestId('bout-result').first()).toContainText('%')
  await page.getByTestId('rematch').click()
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeFocused()
  await expect(page.getByTestId('confirm-lineup')).toBeDisabled()
  expect(new URL(page.url()).searchParams.get('seed')).toBe('20260815')
})

test('reports school defeat in the summary heading for a losing lineup', async ({ page }) => {
  // Task 11 swapped this test off the all-counter ordering because that lineup
  // had started sweeping 3-0, and left a note to revisit "once the golden
  // lineup loses again". Under Task 13's final calibration it does lose -- the
  // all-counter lineup `brutus/aquila/nerva` finishes 1-2 -- so the note's
  // condition is met, but that makes it a candidate for THIS test rather than
  // for the victory test above, which now plays `aquila/brutus/nerva`.
  //
  // `nerva/aquila/brutus` is used here instead simply to keep the two tests on
  // different orderings. This test's job is the "School defeat" heading and
  // score rendering, so which losing lineup it uses is incidental -- but it is
  // chosen from the final measured balance rather than to dodge it. See
  // series.test.ts's golden-scenario block for the full six-lineup table.
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('nerva', 0)
    window.__GLADIATOR_TEST__.assign('aquila', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  for (let bout = 0; bout < 3; bout += 1) {
    await finishActiveBout(page)
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  await expect(page.getByRole('heading', { name: 'School defeat' })).toBeFocused()
  await expect(page.getByTestId('series-score')).toHaveText('1–2')
})

test('supports keyboard planning and deterministic focus', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  const aquila = page.getByTestId('fighter-aquila')
  await aquila.focus()
  await page.keyboard.press('Enter')
  await expect(aquila).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(aquila).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press('Enter')
  await page.getByTestId('slot-0').focus()
  await page.keyboard.press('Space')
  await expect(page.getByTestId('slot-0')).toContainText('Aquila')
  await expect(page.getByTestId('fighter-brutus')).toBeFocused()
})

test('normalizes an invalid URL seed', async ({ page }) => {
  await page.goto('/?seed=invalid&snapshot')
  const seed = new URL(page.url()).searchParams.get('seed')
  expect(seed).toMatch(/^\d+$/)
  expect(Number(seed)).toBeGreaterThanOrEqual(0)
  expect(Number(seed)).toBeLessThanOrEqual(0xffff_ffff)
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'planning')
})

test('changes speed without advancing while paused', async ({ page }) => {
  await page.goto('/?seed=20260815')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await page.getByTestId('speed-4').click()
  await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick ?? 0)).toBeGreaterThan(0)
  await page.getByTestId('toggle-pause').click()
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(before).toEqual(expect.any(Number))
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getState().activeBattle?.encounter.tick)
  expect(after).toBe(before)
})

test('shows both interstitials with result and next matchup context', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
    window.__GLADIATOR_TEST__.advanceTicks(3600)
  })
  await expect(page.getByTestId('bout-result-summary')).toContainText(/wins.*defeat|wins.*time limit/i)
  await expect(page.getByTestId('next-matchup')).toContainText('Nerva')
  await expect(page.getByTestId('next-matchup')).toContainText('Cassius')
  await expect(page.getByTestId('next-matchup')).toContainText('neutral')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextBout()
    window.__GLADIATOR_TEST__.advanceTicks(3600)
  })
  await expect(page.getByTestId('next-matchup')).toContainText('Brutus')
  await expect(page.getByTestId('next-matchup')).toContainText('Magnus')
  await expect(page.getByTestId('next-matchup')).toContainText('neutral')
})

test('matches the stable planning snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()
  await expect(page).toHaveScreenshot('planning.png', { fullPage: true })
})