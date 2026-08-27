import { expect, test, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Bout orders and opponent temperaments (2026-08-22): end-to-end acceptance for
// the player-facing half of the feature -- the per-bout order selector on the
// planning screen and on the between-bouts interstitial, the temperament badges
// on both the series and season screens, the order/temperament labels in the
// battle HUD, the locking rule that only the next pending bout's order may be
// changed, and the guarantee that leaving every order on `standard` does not
// perturb the frozen simulation core.
//
// Same fixture every other e2e file in this suite pins: `?seed=20260815`
// (deterministic season/series seed) plus `?snapshot` (boots paused, so ticks
// only advance where a test explicitly asks). Every test opens series 0
// explicitly -- `main.ts` boots onto the season board with `activeSeries` still
// `null` and there is no bridge past it, so either a real `start-series` click
// or `window.__GLADIATOR_TEST__.startNextSeries()` is what actually reaches the
// planning screen (see `smoke.spec.ts`'s file header).
//
// The lineup below is brutus/aquila/nerva in slots 0/1/2, i.e. bout 0 is
// `home.brutus` vs `away.drusus` -- deliberately the exact same bout
// `combat-visuals.spec.ts` freezes its key poses against, so the determinism
// guard at the bottom of this file can check the order plumbing against an
// already-frozen outcome rather than against a literal invented here.
// ---------------------------------------------------------------------------

/** Opens series 0's planning screen through the season board's own button and
 * fills all three slots. Assignment goes through the dev command surface (the
 * same shortcut every other e2e file takes for lineup setup) -- the real DOM
 * clicks in this file are spent on the controls this task actually added. */
async function openPlannedSeries(page: Page): Promise<void> {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('season-board')).toBeVisible()
  await page.getByTestId('start-series').click()
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.assign('brutus', 0)
    window.__GLADIATOR_TEST__.assign('aquila', 1)
    window.__GLADIATOR_TEST__.assign('nerva', 2)
  })
}

function seriesOrders(page: Page): Promise<readonly string[]> {
  return page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()!.orders)
}

/** Plans the series, sets bout 0's order through the real selector button, and
 * confirms -- landing in `fighting` on bout 0 under that order. */
async function fightBoutZeroUnder(page: Page, order: 'standard' | 'press' | 'guarded'): Promise<void> {
  await openPlannedSeries(page)
  if (order !== 'standard') await page.getByTestId(`order-0-${order}`).click()
  await page.getByTestId('confirm-lineup').click()
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')
}

/** Bout 0 under `order`, played to its finish so the between-bouts
 * interstitial (bout 1's order selector, and the locking rule around it) is on
 * screen. `MAX_BOUT_TICKS` is 3600, so one burst always resolves a bout. */
async function reachInterstitialAfterBoutZero(page: Page, order: 'standard' | 'press' | 'guarded'): Promise<void> {
  await fightBoutZeroUnder(page, order)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'between-bouts')
}

// ---------------------------------------------------------------------------
// 1. The planning screen's order selector and temperament badge.
// ---------------------------------------------------------------------------

test('picks a per-bout order on the planning screen without touching the other bouts', async ({ page }) => {
  await openPlannedSeries(page)

  const standard = page.getByTestId('order-0-standard')
  const press = page.getByTestId('order-0-press')
  // The default really is `standard`, asserted before the click -- otherwise
  // "press is pressed afterwards" would hold even if the selector had been
  // stuck on `press` from the start and the click did nothing.
  await expect(standard).toHaveAttribute('aria-pressed', 'true')
  await expect(press).toHaveAttribute('aria-pressed', 'false')

  await press.click()
  await expect(press).toHaveAttribute('aria-pressed', 'true')
  await expect(standard).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('order-0-guarded')).toHaveAttribute('aria-pressed', 'false')

  // Each slot's selector is independent: bouts 1 and 2 stay on their default.
  await expect(page.getByTestId('order-1-standard')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('order-2-standard')).toHaveAttribute('aria-pressed', 'true')

  // ...and the click reached the simulation state, not merely the button's own
  // ARIA attribute -- a selector that rendered its pressed state locally while
  // never dispatching the intent would satisfy every assertion above.
  expect(await seriesOrders(page)).toEqual(['press', 'standard', 'standard'])

  // Challenge 1 is the frozen baseline series: all three opponents are
  // `standard`/`Steady` (`content/season.ts`'s `TEMPERAMENTS` row 0).
  const badge = page.getByTestId('temperament-0')
  await expect(badge).toHaveAttribute('data-temperament', 'standard')
  await expect(badge).toContainText('Steady')
  await expect(page.getByTestId('temperament-1')).toHaveAttribute('data-temperament', 'standard')
  await expect(page.getByTestId('temperament-2')).toHaveAttribute('data-temperament', 'standard')

  // Every order telegraphs its own trade, not only the selected one: the
  // `.order-selector__telegraph` line describes the CURRENT order, so without
  // the per-button `title` a player who never picks `Guarded` never learns
  // what it costs (design.md, acceptance 1).
  await expect(page.getByTestId('order-0-guarded')).toHaveAttribute('title', 'Guarded: keeps HP and wear down, worse odds to win.')
  await expect(standard).toHaveAttribute('title', 'Standard: fights as trained.')
})

// ---------------------------------------------------------------------------
// 1b. Height budget. The order selectors and temperament badges first shipped
//     as a full-width row beneath each matchup slot, which added ~78px per
//     slot (~233px across three) to a screen that `style.css` documents as
//     having had ~5px of headroom under 800px on win32 and none at all on
//     Linux. That pushed `Confirm lineup` to y~949 -- the planning screen's
//     primary action, below the fold on an ordinary 1280x800 laptop -- and it
//     took `decision-panel.spec.ts`'s viewport check (which measures a
//     dev-only panel, several screens away from this feature) to notice.
//     Asserted here too, next to the controls that caused it, so the next
//     addition to this screen fails against its own spec.
// ---------------------------------------------------------------------------

test('keeps the planning screen, Confirm lineup included, inside a 1280x800 viewport', async ({ page }) => {
  const viewport = { width: 1280, height: 800 }
  await page.setViewportSize(viewport)
  // `openPlannedSeries` fills all three slots, which is the taller state --
  // each occupied slot also renders a `Remove` button beside its selector.
  await openPlannedSeries(page)

  // The taller state is what is actually on screen: `openPlannedSeries` drives
  // the assignments through the dev API, so a regression that stopped them
  // reaching the DOM would leave this test measuring the SHORTER, unassigned
  // planning screen and passing for the wrong reason.
  await expect(page.getByTestId('slot-2')).toContainText('Nerva')

  // Nothing scrolled to get here; the assertions below are about the first
  // paint a player sees, not about what is reachable after scrolling.
  expect(await page.evaluate(() => window.scrollY)).toBe(0)

  for (const testId of ['confirm-lineup', 'order-0-standard', 'order-2-guarded', 'temperament-2']) {
    const box = await page.getByTestId(testId).boundingBox()
    expect(box, `${testId} has no layout box`).not.toBeNull()
    expect(box!.y, `${testId} starts above the viewport`).toBeGreaterThanOrEqual(0)
    expect(box!.y + box!.height, `${testId} extends below the 800px fold`).toBeLessThanOrEqual(viewport.height)
    // Both horizontal edges, for the same reason both vertical ones are
    // checked: a control pushed off the LEFT of the viewport is just as
    // unreachable as one pushed off the right, and `x + width <= 1280` alone
    // is satisfied by any amount of negative `x`.
    expect(box!.x, `${testId} starts left of the viewport`).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width, `${testId} extends past the right edge`).toBeLessThanOrEqual(viewport.width)
  }
})

// ---------------------------------------------------------------------------
// 2. The battle HUD names the order being fought under and the foe's
//    temperament -- the one place a player can see both mid-bout.
// ---------------------------------------------------------------------------

test('names the chosen order and the opponent temperament in the battle status line', async ({ page }) => {
  await fightBoutZeroUnder(page, 'press')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(1))

  // The whole line, not just the two new fragments: the order/temperament
  // labels were appended to an existing status string, so asserting the full
  // text also proves nothing already there was displaced.
  await expect(page.getByTestId('battle-status')).toHaveText('Bout I · Brutus vs Drusus · Order: Press · Foe: Steady')
})

// ---------------------------------------------------------------------------
// 3. The interstitial's selector is a real second decision point: changing
//    bout 1's order between bouts is carried into bout 1 itself.
// ---------------------------------------------------------------------------

test('changes the next bout\'s order from the interstitial and fights the next bout under it', async ({ page }) => {
  await reachInterstitialAfterBoutZero(page, 'press')

  // Only the next pending bout's selector is on screen. Bout 0 is already
  // resolved and bout 2 is not yet the next decision, so neither is offered --
  // the DOM half of the same locking rule test 4 checks through the API.
  await expect(page.getByTestId('order-1-standard')).toBeVisible()
  await expect(page.locator('[data-testid^="order-0-"]')).toHaveCount(0)
  await expect(page.locator('[data-testid^="order-2-"]')).toHaveCount(0)

  const guarded = page.getByTestId('order-1-guarded')
  await guarded.click()
  await expect(guarded).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('order-1-standard')).toHaveAttribute('aria-pressed', 'false')
  // Bout 0's order stayed locked at what it was actually fought under, and
  // bout 2's is untouched.
  expect(await seriesOrders(page)).toEqual(['press', 'guarded', 'standard'])

  await page.getByTestId('start-next-bout').click()
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(1))
  await expect(page.getByTestId('battle-status')).toHaveText('Bout II · Aquila vs Cassius · Order: Guarded · Foe: Steady')
})

// ---------------------------------------------------------------------------
// 3b. The series summary names the order each bout was fought under
//     (acceptance 6, the series half). Three DIFFERENT orders on three bouts,
//     so the assertion pins which order printed on which row: a summary that
//     read every row's order off bout 0, or off `state.orders` instead of the
//     recorded `homeOrder`, would pass an all-`standard` check happily.
// ---------------------------------------------------------------------------

test('names each bout\'s order on the series summary rows', async ({ page }) => {
  await openPlannedSeries(page)
  await page.getByTestId('order-0-press').click()
  await page.getByTestId('order-2-guarded').click()
  // Bout 1 is deliberately left on its default, so the middle row is the one
  // that proves `Standard` is printed rather than omitted.
  expect(await seriesOrders(page)).toEqual(['press', 'standard', 'guarded'])

  await page.getByTestId('confirm-lineup').click()
  // Three bouts: each `advanceTicks` burst exceeds `MAX_BOUT_TICKS` (3600), so
  // one burst per bout always resolves it, and `start-next-bout` walks the two
  // interstitials in between.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
  for (let bout = 0; bout < 2; bout += 1) {
    await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'between-bouts')
    await page.getByTestId('start-next-bout').click()
    await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
  }
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'summary')

  const rows = page.getByTestId('bout-result')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(0)).toContainText('Order: Press.')
  await expect(rows.nth(1)).toContainText('Order: Standard.')
  await expect(rows.nth(2)).toContainText('Order: Guarded.')
  // Row identity, so the three assertions above cannot be read off the wrong
  // bouts if the summary is ever reordered. Includes each fighter's type
  // (`Name (Type)`, Task 2's series-summary format) so this still matches the
  // literal rendered text rather than a substring the rename made stale.
  await expect(rows.nth(0)).toContainText('Brutus (Murmillo) vs Drusus (Retiarius)')
  await expect(rows.nth(2)).toContainText('Nerva (Hoplomachus) vs Magnus (Murmillo)')
})

// ---------------------------------------------------------------------------
// 4. The locking rule, through the command surface: between bouts, only the
//    next pending bout's order may be set.
// ---------------------------------------------------------------------------

test('refuses to re-order a resolved bout or a bout beyond the next one', async ({ page }) => {
  await reachInterstitialAfterBoutZero(page, 'press')

  // Bout 0 has already been fought; bout 2 is not the next decision yet.
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.setBoutOrder(0, 'press'))).toEqual({ ok: false, reason: 'order-locked' })
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.setBoutOrder(2, 'press'))).toEqual({ ok: false, reason: 'order-locked' })
  // A refusal must also leave the state alone, not merely report `ok: false`.
  expect(await seriesOrders(page)).toEqual(['press', 'standard', 'standard'])

  // Non-vacuity: `setBoutOrder` is not simply refusing everything in this
  // phase -- the one legal slot is accepted, and takes effect.
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.setBoutOrder(1, 'guarded'))).toEqual({ ok: true })
  expect(await seriesOrders(page)).toEqual(['press', 'guarded', 'standard'])
})

// ---------------------------------------------------------------------------
// 5. The season board reads out every challenge's temperaments before the
//    player commits to a series -- the scouting half of the feature.
// ---------------------------------------------------------------------------

test('shows every challenge\'s opponent temperaments on the season board', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('season-board')).toBeVisible()

  // Three challenges x three opponents, one badge each.
  await expect(page.getByTestId('challenge-temperament')).toHaveCount(9)

  const cards = page.getByTestId('season-challenge-card')
  const readTemperaments = (index: number) =>
    cards.nth(index).locator('[data-testid="challenge-temperament"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-temperament')))

  // Card identity is asserted rather than assumed, so the rows below cannot
  // silently be read off the wrong challenge if the board is ever reordered.
  await expect(cards.nth(0).getByRole('heading', { name: 'Challenge 1' })).toBeVisible()
  await expect(cards.nth(1).getByRole('heading', { name: 'Challenge 2' })).toBeVisible()
  await expect(cards.nth(2).getByRole('heading', { name: 'Challenge 3' })).toBeVisible()

  // `content/season.ts`'s authored `TEMPERAMENTS` rows, in opponent order
  // (Drusus, Cassius, Magnus). Challenge 1 is all-`standard` on purpose -- it
  // is the frozen baseline series -- so the whole set is asserted rather than
  // just challenge 2's, or "at least one press badge exists somewhere" would
  // pass against a board that pairs the badges with the wrong opponents.
  expect(await readTemperaments(0)).toEqual(['standard', 'standard', 'standard'])
  expect(await readTemperaments(1)).toEqual(['press', 'guarded', 'standard'])
  expect(await readTemperaments(2)).toEqual(['standard', 'press', 'standard'])

  // Challenge 2 is the first card a player meets a non-neutral opponent on,
  // and the badge has to read as words, not just carry a data attribute.
  const challengeTwoPress = cards.nth(1).locator('[data-testid="challenge-temperament"][data-temperament="press"]')
  await expect(challengeTwoPress).toHaveCount(1)
  await expect(challengeTwoPress).toHaveText('Aggressive')
})

// ---------------------------------------------------------------------------
// 6. Determinism guard.
//
// `dc635911` is the frozen canonical adapter-duel trace hash from
// `src/simulation/battle.test.ts` ("matches its frozen canonical adapter-duel
// trace hash", Task 13 Step 6), the same literal `combat-visuals.spec.ts`
// already re-checks in Chromium. Nothing here invents a new one.
//
// What this adds over that existing cross-runtime check: it passes
// `dispositions` explicitly at `standard` on both sides. `encounter.ts` only
// stores the field when it is not `standard`, and `disposition.ts` maps
// `standard` to an empty modifier list, so the whole disposition feature must
// be a bit-for-bit no-op at its default -- the property the season's entire
// frozen balance still rests on. A `standard` that quietly perturbed the RNG
// would break every frozen fixture in the repo, and this is the fastest place
// to see it.
// ---------------------------------------------------------------------------

// RE-FROZEN with `battle.test.ts`'s own literal by the retiarius-reach slice.
// What this file asserts is that an explicit `standard` disposition perturbs
// nothing -- the VALUE is incidental, the equality is the claim.
const CANONICAL_DUEL_HASH = '2a0f3da2'

test('leaves the frozen canonical duel hash untouched under explicit standard dispositions', async ({ page }) => {
  await page.goto('/?snapshot')

  const { standardHash, pressHash, omittedHash } = await page.evaluate(async () => {
    // Root-relative specifiers held in `string`-typed locals, exactly as
    // `combat-visuals.spec.ts` does it and for the same reason: `tsc` cannot
    // statically resolve a dynamic `import()` with a non-literal specifier, so
    // it stops trying instead of failing to resolve `/src/...` from the
    // Node-side project. Runtime behaviour in Chromium is unaffected.
    const battlePath: string = '/src/simulation/battle.ts'
    const stylesPath: string = '/src/content/combatStyles.ts'
    const randomPath: string = '/src/simulation/random.ts'
    const { createBattle, advanceBattleTicks, MAX_BOUT_TICKS } = await import(battlePath)
    const { COMBAT_STYLES } = await import(stylesPath)
    const { formatTraceHash } = await import(randomPath)

    // `battle.test.ts`'s own local fixtures, copied from its frozen-hash
    // comment -- deliberately not the roster rows of the same name, so the
    // literal stays insulated from roster retuning.
    const brutus = { id: 'brutus', name: 'Brutus', school: 'Test', archetype: 'heavy' as const, maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }
    const drusus = { id: 'drusus', name: 'Drusus', school: 'Test', archetype: 'fast' as const, maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }
    const base = { home: brutus, away: drusus, seed: 123, combatStyles: COMBAT_STYLES }
    const run = (dispositions?: Record<string, string>) =>
      formatTraceHash(advanceBattleTicks(createBattle(dispositions ? { ...base, dispositions } : base), MAX_BOUT_TICKS).traceHash)

    return {
      standardHash: run({ home: 'standard', away: 'standard' }),
      pressHash: run({ home: 'press', away: 'standard' }),
      omittedHash: run(),
    }
  })

  expect(standardHash).toBe(CANONICAL_DUEL_HASH)
  // Omitting `dispositions` altogether and passing `standard` explicitly are
  // the same run, so no caller can be broken by starting to pass the default.
  expect(omittedHash).toBe(CANONICAL_DUEL_HASH)
  // Non-vacuity: a disposition that never reached the decision layer at all
  // would satisfy both assertions above just as well.
  expect(pressHash).not.toBe(CANONICAL_DUEL_HASH)
})

test('plays the seeded bout 0 to its frozen outcome when every order is left standard', async ({ page }) => {
  // The real product path (season -> series -> battle), not a direct module
  // call: `series.ts` always passes `dispositions` now, so the default lineup
  // must still reproduce the bout `combat-visuals.spec.ts` freezes its key
  // poses and its `combat-outcomes.png` baseline against -- which the
  // retiarius-reach slice reverses: `away.drusus` is now the one defeated, by
  // `home.brutus`, on tick 1827.
  await fightBoutZeroUnder(page, 'standard')
  expect(await seriesOrders(page)).toEqual(['standard', 'standard', 'standard'])
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))

  const standardOutcome = await page.evaluate(() => {
    const battle = window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!
    return { tick: battle.encounter.tick, winnerSide: battle.winnerSide, finishReason: battle.finishReason, hash: window.__GLADIATOR_TEST__.getActiveBattleTraceHash() }
  })
  expect(standardOutcome).toMatchObject({ tick: 1827, winnerSide: 'home', finishReason: 'defeat' })

  // ...and the order the player picks genuinely reaches that simulation: the
  // same seeded bout under `press` produces a different trace, so the
  // unchanged result above is a real invariance claim rather than proof that
  // orders are inert.
  await fightBoutZeroUnder(page, 'press')
  expect(await seriesOrders(page)).toEqual(['press', 'standard', 'standard'])
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
  const pressHash = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveBattleTraceHash())
  expect(pressHash).not.toBe(standardOutcome.hash)
})
