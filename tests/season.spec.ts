import { expect, test, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Task 9: end-to-end acceptance for the whole season meta-loop -- the season
// board, the condition ladder, starting HP, forfeits, and the season summary
// -- on top of everything `smoke.spec.ts`/`combat-visuals.spec.ts` already
// hold frozen for a single series/bout. Every test drives the real dev
// command surface (`window.__GLADIATOR_TEST__`), the same one `smoke.spec.ts`
// uses, at the same `?seed=20260815&snapshot` every other e2e file pins.
//
// Every lineup/wear sequence below is not guessed: test 1 reuses
// `seasonBalance.test.ts`'s own frozen "golden season" lineups verbatim, and
// tests 2/3's wear sequence was independently derived by running the exact
// same deterministic `simulation/season.ts` state machine ahead of time. The
// cross-runtime determinism `combat-visuals.spec.ts` already establishes
// (Node vs this same Chromium, same seed, same trace hash) is why it is safe
// to assume either reproduces bit-for-bit here too.
// ---------------------------------------------------------------------------

interface BoutOutcomeLike {
  kind: 'fought' | 'forfeit'
  boutIndex: number
  homeFighterId?: string
  opponentId: string
  winnerSide?: 'home' | 'away'
}
interface RosterEntryLike { fighter: { id: string }; condition: string }
interface SeasonStateLike {
  phase: string
  seriesIndex: number
  roster: readonly RosterEntryLike[]
  records: readonly { outcomes: readonly BoutOutcomeLike[] }[]
  score: { home: number; away: number }
}
interface SeriesStateLike { phase: string; results: readonly BoutOutcomeLike[]; orders: readonly string[] }
interface CommandResult { ok: boolean; reason?: string }
interface TestApi {
  getSeasonState: () => SeasonStateLike
  getActiveSeriesState: () => SeriesStateLike | null
  startNextSeries: () => CommandResult
  continueSeason: () => CommandResult
  assign: (fighterId: string, boutIndex: number) => CommandResult
  confirm: () => CommandResult
  advanceTicks: (ticks: number) => void
  startNextBout: () => CommandResult
  setBoutOrder: (boutIndex: number, order: string) => CommandResult
}

function getSeasonState(page: Page): Promise<SeasonStateLike> {
  return page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.getSeasonState())
}

function getActiveSeriesState(page: Page): Promise<SeriesStateLike | null> {
  return page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.getActiveSeriesState())
}

function formatOutcome(outcome: BoutOutcomeLike): string {
  return outcome.kind === 'forfeit' ? `forfeit vs ${outcome.opponentId} (slot ${outcome.boutIndex})` : `${outcome.homeFighterId} vs ${outcome.opponentId}: ${outcome.winnerSide}`
}

/** Opens the next series (the season board's own `startNextSeries`) and plays
 * it out to its own summary, assigning exactly `lineup.length` gladiators to
 * the first `lineup.length` bout slots in order -- matching every other e2e
 * file's convention of driving through `assign`/`confirm`/`advanceTicks`/
 * `startNextBout` rather than clicking through the DOM. `lineup.length` may be
 * fewer than 3 (test 3's short-handed series): the remaining slot(s) are left
 * unassigned, which `confirmLineup` accepts as long as it meets
 * `requiredAssignmentCount` (`min(3, fightable roster size)`). */
async function playSeries(page: Page, lineup: readonly string[]): Promise<void> {
  await page.evaluate((names) => {
    const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    test.startNextSeries()
    names.forEach((fighterId, index) => test.assign(fighterId, index))
    test.confirm()
    test.advanceTicks(20_000)
  }, lineup)
  // Ticks run inside `page.evaluate`, which drives the between-bouts -> next-
  // bout walk from the Node side (Playwright's own loop, not the page's rAF),
  // so this has to poll rather than assume one `evaluate` call reaches
  // `summary` in a single round-trip -- a series with a forfeit can finish in
  // fewer of them than a fully-fought one.
  // Bounded at four iterations rather than `for (;;)`: a series is three
  // bouts, so it can stop in `between-bouts` at most twice and the fourth
  // check is already slack. An unbounded loop turns a series that fails to
  // progress into a Playwright test-timeout with no indication of what
  // actually happened; this fails on the spot, naming the stuck phase.
  for (let attempt = 0; ; attempt += 1) {
    const phase = (await getActiveSeriesState(page))?.phase
    if (phase !== 'between-bouts') break
    expect(attempt, `series stuck in 'between-bouts' after ${attempt} startNextBout() calls`).toBeLessThan(4)
    await page.evaluate(() => {
      const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
      test.startNextBout()
      test.advanceTicks(20_000)
    })
  }
}

/** `playSeries` above, immediately followed by `continueSeason()` -- closes
 * the series out (roster wear, its own `SeriesRecord`, the season score) and
 * lands back on the season board (or the season summary, for series 2). */
async function playAndCloseSeries(page: Page, lineup: readonly string[]): Promise<void> {
  await playSeries(page, lineup)
  await page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.continueSeason())
}

/** Series 0 and 1, both fielding the exact same three gladiators
 * (brutus/aquila/nerva) in the exact same slots (vs drusus/cassius/magnus).
 * `condition.ts`'s `conditionAfterBout` charges at least one ladder step for
 * every bout fought, win or lose -- fielding the same three twice in a row
 * therefore drives every one of them from `fresh` to `broken` on this seed
 * (measured ahead of time by running `simulation/season.ts` directly: series
 * 0 costs each of them 1-2 steps, already at or past `bruised`; fielding them
 * again in series 1 costs at least one more, which is enough from anywhere at
 * or past `wounded`), while `vitus`/`sura` -- never fielded, so always rested
 * -- stay `fresh` throughout, since resting away from `fresh` is a no-op
 * (`conditionAfterRest`). By the season board that follows series 1, exactly
 * two gladiators (`vitus`, `sura`) are still fightable. */
async function breakTheThreeVeterans(page: Page): Promise<void> {
  await playAndCloseSeries(page, ['brutus', 'aquila', 'nerva'])
  await playAndCloseSeries(page, ['brutus', 'aquila', 'nerva'])
}

test('plays a full three-series season through the real dev command surface, ending with nine outcomes and a season summary', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('season-board')).toBeVisible()

  // The exact three lineups `seasonBalance.test.ts`'s "golden season" cohort
  // holds frozen at the unit level (same seed, same simulation module) -- no
  // gladiator here is ever driven below `wounded`, so this season plays out
  // with zero forfeits, unlike tests 2/3 below.
  await playAndCloseSeries(page, ['brutus', 'aquila', 'nerva'])
  await playAndCloseSeries(page, ['vitus', 'sura', 'brutus'])
  await playAndCloseSeries(page, ['aquila', 'nerva', 'vitus'])

  const season = await getSeasonState(page)
  expect(season.phase).toBe('season-summary')
  expect(season.records).toHaveLength(3)
  const outcomes = season.records.flatMap((record) => record.outcomes)
  expect(outcomes).toHaveLength(9)
  expect(outcomes.every((outcome) => outcome.kind === 'fought')).toBe(true)
  // RE-BASELINED with `frozenFixtures/goldenSeason.ts` by the retiarius-reach
  // slice, and still the same nine bouts in the same order: three of them
  // change hands.
  expect(outcomes.map(formatOutcome)).toEqual([
    'brutus vs drusus: home', 'aquila vs cassius: away', 'nerva vs magnus: home',
    'vitus vs drusus: home', 'sura vs cassius: home', 'brutus vs magnus: away',
    'aquila vs drusus: away', 'nerva vs cassius: away', 'vitus vs magnus: away',
  ])
  expect(season.score).toEqual({ home: 4, away: 5 })

  // The season-summary screen itself, not just the dev-API state -- a real
  // player only ever sees this DOM, never `getSeasonState()`.
  await expect(page.getByTestId('season-summary')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Season defeat' })).toBeFocused()
  await expect(page.getByTestId('season-summary-bout')).toHaveCount(9)

  // `Rematch season` is acceptance criterion 7 and the only control on this
  // screen -- click it rather than merely checking it exists. Its handler
  // (`main.ts`'s `handleSeasonClick`, the `rematchSeason` branch) had never
  // once run at runtime in this suite: every other assertion about a season
  // restart went through the dev API.
  await page.getByTestId('rematch-season').click()
  await expect(page.getByTestId('season-board')).toBeVisible()
  await expect(page.getByText('Season board — Series 1 of 3')).toBeVisible()
  await expect(page.getByText('Season score 0–0')).toBeVisible()
  await expect(page.locator('[data-testid="season-roster-card"] [data-testid="condition-badge"][data-condition="fresh"]')).toHaveCount(5)
  // Nothing carried over: same seed, series index back to 0, no records.
  const restarted = await getSeasonState(page)
  expect(restarted.phase).toBe('season-board')
  expect(restarted.seriesIndex).toBe(0)
  expect(restarted.records).toEqual([])
  expect(restarted.score).toEqual({ home: 0, away: 0 })
  expect(restarted.roster.every((entry) => entry.condition === 'fresh')).toBe(true)
})

// Acceptance 6, the season half: `SeasonView.buildOutcomeRow` appends the order
// each recorded bout was fought under. Series 0 is played under three DIFFERENT
// orders so the assertion pins WHICH order printed on which row -- a summary
// that read every row off the same bout, or off the live `orders` array rather
// than the recorded `homeOrder`, passes an all-`standard` check happily. This
// season is deliberately NOT the golden one above and asserts no outcome or
// score: changing an order changes the bouts, and the frozen trace belongs to
// the test that owns it.
test('names the order each recorded bout was fought under on the season summary', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('season-board')).toBeVisible()

  await page.evaluate(() => {
    const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    test.startNextSeries()
    test.assign('brutus', 0)
    test.assign('aquila', 1)
    test.assign('nerva', 2)
    // All three set during planning, where every slot is unlocked; bout 1 is
    // left on its default so one row proves `Standard` prints rather than
    // being omitted.
    test.setBoutOrder(0, 'press')
    test.setBoutOrder(2, 'guarded')
  })
  expect((await getActiveSeriesState(page))!.orders).toEqual(['press', 'standard', 'guarded'])

  await page.evaluate(() => {
    const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    test.confirm()
    test.advanceTicks(20_000)
  })
  for (let attempt = 0; ; attempt += 1) {
    const phase = (await getActiveSeriesState(page))?.phase
    if (phase !== 'between-bouts') break
    expect(attempt, `series stuck in 'between-bouts' after ${attempt} startNextBout() calls`).toBeLessThan(4)
    await page.evaluate(() => {
      const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
      test.startNextBout()
      test.advanceTicks(20_000)
    })
  }
  await page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.continueSeason())

  // Series 1 and 2 are played on their defaults, purely to reach the season
  // summary -- it is the only screen that renders a `SeriesRecord`.
  await playAndCloseSeries(page, ['vitus', 'sura', 'brutus'])
  await playAndCloseSeries(page, ['aquila', 'nerva', 'vitus'])

  await expect(page.getByTestId('season-summary')).toBeVisible()
  const bouts = page.getByTestId('season-summary-bout')
  await expect(bouts).toHaveCount(9)
  await expect(bouts.nth(0)).toContainText('Order: Press.')
  await expect(bouts.nth(1)).toContainText('Order: Standard.')
  await expect(bouts.nth(2)).toContainText('Order: Guarded.')
  // Row identity, so the three assertions above cannot be read off the wrong
  // bouts if the summary is ever reordered. Includes each fighter's type
  // (`Name (Type)`, added to the season summary in Task 2's fix round) so
  // this still matches the literal rendered text rather than a substring
  // the rename made stale.
  await expect(bouts.nth(0)).toContainText('Brutus (Murmillo) vs Drusus (Retiarius)')
  await expect(bouts.nth(2)).toContainText('Nerva (Hoplomachus) vs Magnus (Murmillo)')
})

test('keeps a gladiator driven to broken off the roster, says why on the planning screen, and still lets the player confirm the short lineup', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await breakTheThreeVeterans(page)

  const boardState = await getSeasonState(page)
  expect(boardState.phase).toBe('season-board')
  expect(boardState.seriesIndex).toBe(2)
  const conditionById = Object.fromEntries(boardState.roster.map((entry) => [entry.fighter.id, entry.condition]))
  expect(conditionById.brutus).toBe('broken')
  expect(conditionById.aquila).toBe('broken')
  expect(conditionById.nerva).toBe('broken')
  expect(conditionById.vitus).toBe('fresh')
  expect(conditionById.sura).toBe('fresh')

  // The board itself shows a `Broken` badge, not just the dev API -- the
  // season board's own roster cards (`SeasonView.buildRosterCard`).
  await expect(page.getByTestId('season-board')).toBeVisible()
  const brutusBadge = page.locator('[data-testid="season-roster-card"]:has-text("Brutus") [data-testid="condition-badge"]')
  await expect(brutusBadge).toHaveAttribute('data-condition', 'broken')

  await page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.startNextSeries())
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()

  // The dev API itself refuses the assignment -- `season.ts`'s
  // `assignFighter` checks `isFightable` before ever delegating to the
  // series layer, the same guard the planning screen's own fighter cards
  // never even offer a broken gladiator through.
  const rejected = await page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.assign('brutus', 0))
  expect(rejected).toEqual({ ok: false, reason: 'fighter-unavailable' })

  // Every gladiator keeps a card; only the two fightable ones are pickable.
  // A broken one stays on screen as a disabled card carrying its rest
  // forecast, because benching is the other half of the decision this screen
  // supports — dropping them from the grid hid what waiting would buy.
  await expect(page.locator('[data-role="home-fighter"]')).toHaveCount(2)
  await expect(page.locator('[data-role="unavailable-fighter"]')).toHaveCount(3)
  await expect(page.getByTestId('fighter-brutus')).toBeDisabled()
  await expect(page.getByTestId('fighter-brutus')).toContainText('Rest: broken → wounded')

  // The planning screen says why the missing three are missing --
  // `SeriesView.buildDisabledRosterRow` -- rather than leaving their absence
  // silent.
  const disabledRow = page.getByTestId('roster-disabled')
  await expect(disabledRow).toBeVisible()
  await expect(disabledRow).toContainText('Brutus')
  await expect(disabledRow).toContainText('Aquila')
  await expect(disabledRow).toContainText('Nerva')
  await expect(disabledRow).toContainText(/broken, cannot fight this series/)

  // Fewer than three fightable gladiators also means this series cannot even
  // fill all three slots -- the forfeit warning is telegraphed in advance,
  // before the player confirms anything (`SeriesView.buildForfeitNotice`).
  const forfeitNotice = page.getByTestId('forfeit-notice')
  await expect(forfeitNotice).toBeVisible()
  await expect(forfeitNotice).toContainText('2 gladiators are fit to fight')
  await expect(forfeitNotice).toContainText('1 slot will be forfeited')

  // ...and the player can actually act on that notice. Everything above this
  // point, and the forfeit test below it, reaches `confirm` through the dev
  // API (`page.evaluate`), which bypasses the DOM entirely -- so the whole
  // forfeit machinery was reachable in tests while a real player, and every
  // production build (no dev API at all), was stuck on this screen forever:
  // the confirm button was disabled unless all THREE slots were filled, and
  // `assignFighter` moves a gladiator between slots rather than cloning them,
  // so two fightable gladiators can never fill three. That made acceptance
  // criterion 6 unreachable outside `window.__GLADIATOR_TEST__`. Clicks only
  // from here down, exactly like `smoke.spec.ts`'s production-preview tests.
  const confirm = page.getByTestId('confirm-lineup')
  await expect(confirm).toBeDisabled()
  await page.getByTestId('fighter-vitus').click()
  await page.getByTestId('slot-0').click()
  // Still short one assignment: the button tracks `requiredAssignmentCount`
  // (`min(3, fightable)` = 2 here), it is not simply always enabled.
  await expect(confirm).toBeDisabled()
  // The running count is measured against the same number, not a hardcoded
  // three -- "1 of 3" would describe a lineup this series never lets the
  // player reach. Select-then-Escape is what forces the re-render that shows
  // the unselected wording: `SeriesView.handleClick` clears its selection
  // after dispatching the assign intent, so the render the assignment itself
  // triggers still shows the selected-fighter sentence.
  await page.getByTestId('fighter-sura').click()
  await page.keyboard.press('Escape')
  await expect(page.locator('#assignment-instruction')).toHaveText('1 of 2 matchups assigned. Select a gladiator, then choose a bout slot.')
  await page.getByTestId('fighter-sura').click()
  await page.getByTestId('slot-1').click()
  await expect(confirm).toBeEnabled()

  await confirm.click()
  // The series really starts -- the third slot is forfeited, not blocking.
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')
  const started = await getActiveSeriesState(page)
  expect(started!.phase).toBe('fighting')
})

test('forfeits a slot when fewer than three gladiators are fit to fight, and the season still completes', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await breakTheThreeVeterans(page)

  // Only `vitus`/`sura` are fightable now -- field both, into slots 0 and 1,
  // and confirm with the third slot left empty. `requiredAssignmentCount` is
  // `min(3, 2)` here, so `confirm()` accepts exactly two assignments; the
  // resulting series treats the empty slot as an away win with no battle
  // fought for it (`series.ts`'s `freezeSlots`/`advancePastForfeits`).
  await playSeries(page, ['vitus', 'sura'])

  const activeSeries = await getActiveSeriesState(page)
  expect(activeSeries!.phase).toBe('summary')
  expect(activeSeries!.results.map(formatOutcome)).toEqual([
    // `away`, the same value this row held before bout orders shipped:
    // challenge 3's Drusus is `standard` (`content/season.ts`'s `TEMPERAMENTS`
    // row 2), and with Vitus on the default `standard` order the whole bout is
    // byte-identical to the pre-orders one -- the state field is omitted
    // entirely and the modifier list is empty. An intermediate revision of the
    // content had Drusus pressing here and this row read `home`; the
    // `TEMPERAMENTS` comment records why challenge 3 cannot afford that.
    'vitus vs drusus: away',
    'sura vs cassius: away',
    'forfeit vs magnus (slot 2)',
  ])

  // Series 2 is the season's last -- closing it out lands straight on the
  // season summary, no season board in between.
  await page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.continueSeason())
  const season = await getSeasonState(page)
  expect(season.phase).toBe('season-summary')
  expect(season.records).toHaveLength(3)
  expect(season.records[2].outcomes.some((outcome) => outcome.kind === 'forfeit')).toBe(true)

  // The forfeited slot is visible in the real season-summary DOM, not just
  // the dev-API state -- `SeasonView.buildOutcomeRow`'s forfeit branch.
  await expect(page.getByTestId('season-summary')).toBeVisible()
  const bouts = page.getByTestId('season-summary-bout')
  await expect(bouts).toHaveCount(9)
  await expect(bouts.filter({ hasText: 'forfeited' })).toHaveCount(1)
  await expect(bouts.filter({ hasText: 'forfeited' })).toContainText('Magnus')
})

test('the between-bouts screen names the forfeited slot\'s opponent by gladiator type', async ({ page }) => {
  // Final-review fix #5. The between-bouts interstitial is the one phase that
  // renders no fighter card at all, so its two text lines carry the whole of
  // its type vocabulary (design spec acceptance #1: "every fighter is named by
  // type"). Its forfeit branch named neither man nor type -- it read "Bout II:
  // forfeited, no fighter available." -- while the series summary and the
  // season summary both named the opponent and his type for the same
  // `BoutOutcome`.
  //
  // Reaching that branch needs a forfeit that is NOT the last slot, which is
  // why `tests/season.spec.ts`'s existing forfeit test does not cover it:
  // `series.ts`'s `advancePastForfeits` walks forward from the bout that just
  // ended, so a trailing forfeit takes the series straight to `summary` and is
  // only ever seen on a summary screen. With slots 0 and 2 filled and slot 1
  // left empty, bout 0 finishing records the forfeit for slot 1 and STOPS in
  // `between-bouts` with that forfeit as the latest result -- exactly the state
  // a real player sits in, looking at the button that starts bout 2.
  await page.goto('/?seed=20260815&snapshot')
  await breakTheThreeVeterans(page)

  await page.evaluate(() => {
    const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    test.startNextSeries()
    // `requiredAssignmentCount` is `min(3, fightable)` = 2 here, so this is a
    // complete lineup -- with the gap in the MIDDLE rather than at the end.
    test.assign('vitus', 0)
    test.assign('sura', 2)
    test.confirm()
    test.advanceTicks(20_000)
  })

  const series = await getActiveSeriesState(page)
  expect(series!.phase).toBe('between-bouts')
  expect(series!.results.map(formatOutcome)).toEqual([
    'vitus vs drusus: away',
    'forfeit vs cassius (slot 1)',
  ])

  // Cassius is challenge 3's slot-1 opponent and a Hoplomachus. Both halves
  // asserted: the man, and his type.
  const resultLine = page.getByTestId('bout-result-summary')
  await expect(resultLine).toContainText('forfeited')
  await expect(resultLine).toContainText('Cassius')
  await expect(resultLine).toContainText(/Murmillo|Retiarius|Hoplomachus/)

  // And the phase's other line still names both fighters of the bout that is
  // actually coming next, so the fix did not trade one typeless line for
  // another.
  const nextLine = page.getByTestId('next-matchup')
  await expect(nextLine).toContainText('Sura')
  await expect(nextLine).toContainText('Magnus')
})

test('matches the stable season-board snapshot', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 820 })
  await page.goto('/?seed=20260815&snapshot')
  await expect(page.getByTestId('season-board')).toBeVisible()

  // Structural assertions carry the actual regression-catching weight here,
  // not the screenshot -- see `smoke.spec.ts`'s "matches the stable planning
  // snapshot" for why a shared `maxDiffPixelRatio: 0.04` alone cannot: this
  // suite's own review found that threshold wide enough (~41,900 px on that
  // frame) that two whole new roster cards and fifteen lines of telegraph
  // text (~20,600 px) still passed silently against a stale baseline. These
  // checks fail on any content change regardless of how few pixels it costs.
  await expect(page.getByTestId('season-challenge-card')).toHaveCount(3)
  await expect(page.getByTestId('season-roster-card')).toHaveCount(5)
  await expect(page.locator('[data-testid="season-roster-card"] [data-testid="condition-badge"][data-condition="fresh"]')).toHaveCount(5)
  await expect(page.locator('[data-testid="season-challenge-card"][data-current="true"]')).toHaveCount(1)
  await expect(page.getByText('Season board — Series 1 of 3')).toBeVisible()
  await expect(page.getByText('Season score 0–0')).toBeVisible()
  await expect(page.getByTestId('start-series')).toHaveText('Start series 1')

  // The screenshot itself is left as a tight, frame-level guard on top of the
  // structural checks above -- `maxDiffPixelRatio: 0.002` (vs. the suite's
  // shared 4%) means this specific call cannot silently pass a real content
  // change the way `planning.png` once did, while still tolerating ordinary
  // font/AA/WebGL noise between machines on the same OS.
  await expect(page).toHaveScreenshot('season-board.png', { fullPage: true, maxDiffPixelRatio: 0.002 })
})
