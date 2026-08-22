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
interface SeriesStateLike { phase: string; results: readonly BoutOutcomeLike[] }
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
  expect(outcomes.map(formatOutcome)).toEqual([
    'brutus vs drusus: away', 'aquila vs cassius: away', 'nerva vs magnus: home',
    'vitus vs drusus: home', 'sura vs cassius: away', 'brutus vs magnus: away',
    'aquila vs drusus: away', 'nerva vs cassius: away', 'vitus vs magnus: away',
  ])
  expect(season.score).toEqual({ home: 2, away: 7 })

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
    // `home`, not the `away` this row froze before bout orders shipped: this
    // is series 2, i.e. challenge 3, whose authored temperaments
    // (`content/season.ts`'s `TEMPERAMENTS` row 2) now have Drusus fighting
    // `press` instead of neutral. Vitus's own order is the default
    // `standard`, which is byte-identical to the old behaviour (the state
    // field is omitted entirely and the modifier list is empty), so the
    // opponent's temperament is the only changed input -- a pressing Drusus
    // trading itself into a loss is the risk half of the mechanic working,
    // not unexplained drift.
    'vitus vs drusus: home',
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
