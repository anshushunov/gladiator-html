import { expect, test, type Page } from '@playwright/test'

// ---------------------------------------------------------------------------
// Task 19: Complete Determinism, Visual Acceptance, Human Review, and
// Handoff. Step 5 (the external human-review gate) is explicitly out of
// scope for this file/commit -- see docs/reviews/2026-08-16-readable-deep-
// combat-human-review.md's empty template and this task's report for why.
// Everything below is either a numeric/structural check (Steps 1-2) or an
// intentional visual baseline captured under Step 3's exact discipline.
// ---------------------------------------------------------------------------

const VIEWPORT = { width: 1280, height: 820 } as const

async function startBoutZeroWith(page: Page, homeFighterId: 'brutus' | 'aquila' | 'nerva'): Promise<void> {
  const order: readonly ('brutus' | 'aquila' | 'nerva')[] = ['brutus', 'aquila', 'nerva']
  const rest = order.filter((id) => id !== homeFighterId)
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(
    ([home, others]) => {
      window.__GLADIATOR_TEST__.assign(home, 0)
      window.__GLADIATOR_TEST__.assign(others[0], 1)
      window.__GLADIATOR_TEST__.assign(others[1], 2)
      window.__GLADIATOR_TEST__.confirm()
    },
    [homeFighterId, rest] as const,
  )
}

/** Advances from wherever the battle currently sits up to (and including) `tick`, an absolute encounter tick -- lets a sequence of checkpoints read like a timeline rather than a series of deltas. */
async function advanceToTick(page: Page, tick: number, cursor: { current: number }): Promise<void> {
  const delta = tick - cursor.current
  if (delta < 0) throw new Error(`advanceToTick: tick ${tick} is behind cursor ${cursor.current}`)
  await page.evaluate((n) => window.__GLADIATOR_TEST__.advanceTicks(n), delta)
  cursor.current = tick
}

async function combatantState(page: Page, combatantId: string) {
  return page.evaluate((id) => {
    const battle = window.__GLADIATOR_TEST__.getState().activeBattle!
    return battle.encounter.combatants[id]
  }, combatantId)
}

async function eventsAtTick(page: Page, tick: number) {
  return page.evaluate((t) => {
    const battle = window.__GLADIATOR_TEST__.getState().activeBattle!
    return battle.events.filter((event) => event.tick === t)
  }, tick)
}

async function arenaSnapshot(page: Page) {
  return page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
}

// ---------------------------------------------------------------------------
// Step 1: cross-runtime determinism vs. render interpolation.
//
// These are two separate properties, deliberately proven by two separate
// tests rather than one combined one (task-19 brief, "Resolutions of
// ambiguity" #1):
//
//   1. The SAME simulation code, executed by Chromium's V8 instead of
//      Node's, produces the byte-identical canonical trace hash Task 13
//      froze and Vitest already asserts (`battle.test.ts`'s "matches its
//      frozen canonical adapter-duel trace hash", `828ad7cb`). This is
//      deliberately NOT run through the roster/series UI -- that plays a
//      different matchup (`aquila`/`nerva`/`brutus` at seed 20260815) than
//      the one the frozen literal belongs to (`battle.test.ts`'s own local
//      `brutus`/`drusus` fixtures at seed 123) -- so this test dynamically
//      imports the exact same simulation modules Vitest imports, straight
//      from Vite's dev server (real TypeScript source, transformed but
//      logically unchanged -- the same server `tests/global-setup.ts`
//      already starts for every Playwright run), and calls the exact same
//      functions with the exact same fixture values, copied from that
//      file's own comment rather than re-derived. That is what "Node and
//      Chromium agree" actually means here: identical inputs producing an
//      identical output in a different JS engine, not a different matchup
//      that happens to reuse a fighter name.
//   2. `renderActiveBattleAtAlpha` changes presentation (interpolated root
//      position) without ever advancing `currentTick` -- proving alpha is a
//      presentation-only clock, never fed back into simulation. Deliberately
//      no fake refresh-rate/`requestAnimationFrame` global: `advanceTicks`
//      is synchronous and already independent of render rate, so the only
//      render-rate-sensitive property left to prove is this one.
// ---------------------------------------------------------------------------

const CANONICAL_CHROMIUM_DUEL_HASH = '828ad7cb'

test('matches the post-tuning Node trace hash in Chromium', async ({ page }) => {
  await page.goto('/?snapshot')

  const hash = await page.evaluate(async () => {
    // Root-relative specifiers (resolved by Vite's dev server against the
    // page's own origin, not the test file's location) so this reaches the
    // real simulation modules regardless of which URL `page.goto` used.
    // Held in `string`-typed (not string-*literal*-typed) locals rather than
    // passed as inline literals -- `tsc` cannot statically resolve a dynamic
    // `import()` whose specifier isn't a literal, so it falls back to
    // `Promise<any>` instead of trying (and failing) to resolve
    // `/src/...` as a module path from the Node-side TypeScript project.
    // This has no effect on the runtime behavior Chromium actually executes.
    const battlePath: string = '/src/simulation/battle.ts'
    const stylesPath: string = '/src/content/combatStyles.ts'
    const randomPath: string = '/src/simulation/random.ts'
    const { createBattle, advanceBattleTicks, MAX_BOUT_TICKS } = await import(battlePath)
    const { COMBAT_STYLES } = await import(stylesPath)
    const { formatTraceHash } = await import(randomPath)

    // The exact local fixtures `battle.test.ts` froze the literal against
    // (its own `brutus`/`drusus`, not the roster rows of the same name) --
    // see that file's "FROZEN CANONICAL HASH (Task 13 Step 6)" comment.
    const brutus = { id: 'brutus', name: 'Brutus', school: 'Test', archetype: 'heavy' as const, maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }
    const drusus = { id: 'drusus', name: 'Drusus', school: 'Test', archetype: 'fast' as const, maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }

    const battle = createBattle({ home: brutus, away: drusus, seed: 123, combatStyles: COMBAT_STYLES })
    const finished = advanceBattleTicks(battle, MAX_BOUT_TICKS)
    return formatTraceHash(finished.traceHash)
  })

  expect(hash).toBe(CANONICAL_CHROMIUM_DUEL_HASH)
})

test('interpolates presentation without advancing simulation', async ({ page }) => {
  await startBoutZeroWith(page, 'aquila')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(240))

  const tick = (await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).currentTick

  // Each render + snapshot pair is one atomic `page.evaluate` call,
  // deliberately not two separate round-trips: `main.ts`'s own
  // `requestAnimationFrame` loop keeps calling `syncArena()` in the
  // background even while `?snapshot` mode holds the simulation paused (it
  // gates tick-advancement, not the render sync itself), each time re-
  // applying the *runtime's* own alpha (pegged at 0 while paused, since the
  // accumulator that alpha is derived from never advances). A two-call
  // version can race that background sync between "set 0.25" and "read it
  // back", occasionally observing the loop's own alpha=0 render instead of
  // this test's. A single synchronous `evaluate` callback cannot be
  // interleaved with a `requestAnimationFrame` callback on the same JS
  // thread, so setting and reading back in one call is race-free.
  const atQuarter = await page.evaluate(() => {
    window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha!(0.25)
    return window.__GLADIATOR_TEST__.getArenaDebugSnapshot!()
  })
  const atThreeQuarters = await page.evaluate(() => {
    window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha!(0.75)
    return window.__GLADIATOR_TEST__.getArenaDebugSnapshot!()
  })

  expect(atThreeQuarters!.rootPositions).not.toEqual(atQuarter!.rootPositions)
  expect((await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())).currentTick).toBe(tick)
})

// ---------------------------------------------------------------------------
// Step 2: deterministic key-pose fixtures.
//
// Every tick below was read from a real, reproducible run of the seeded
// series (seed 20260815, boutIndex 0 -- `deriveBoutSeed(20260815, 0)`) and
// cross-checked against that run's own event trace, not guessed from
// windup/impact tick math alone. Two bouts cover every category the brief
// lists:
//
//   Bout A -- home.brutus (heavy) vs away.drusus (fast): heavy guard/cleave,
//   fast burst/disengage, a simultaneous hit+stagger, a shield block,
//   a defense-declined recognition window, and the bout's own defeat.
//
//   Bout B -- home.nerva (technical) vs away.drusus (fast): technical's
//   hold-range "measure" stance, a parry, and the forced parry-counter.
//
// `getArenaDebugSnapshot()` is the dev-only numeric surface this task's
// owned files can read without modifying `ArenaView.ts`/`main.ts`: it proves
// every rendered joint transform is finite (never NaN/Infinity) and reports
// which contact-flash effect IDs are live, at each frozen tick -- the
// "blocking pose checks" the brief asks for. `PoseController`'s own pose
// math (which semantic pose a given phase/tag maps to) is already unit
// tested elsewhere (Tasks 15-16); this task's job is proving these specific
// semantic states are actually reachable, at these specific frozen ticks, in
// a real deterministic run.
// ---------------------------------------------------------------------------

test('freezes heavy guard/cleave, fast burst/disengage, a mutual hit/stagger, a shield block, defense-declined recognition, and defeat', async ({ page }) => {
  await startBoutZeroWith(page, 'brutus')
  const cursor = { current: 0 }

  // tick 245: both fighters mid-windup on their signature committed attacks
  // -- home.brutus's `heavy-cleave` (started 221, windup ends 255) and
  // away.drusus's `fast-burst-lunge` (started 237, windup ends 255).
  await advanceToTick(page, 245, cursor)
  const brutusCleaveWindup = await combatantState(page, 'home.brutus')
  const drususBurstWindup = await combatantState(page, 'away.drusus')
  expect(brutusCleaveWindup.action).toMatchObject({ type: 'active', definitionId: 'heavy-cleave', phase: 'windup' })
  expect(drususBurstWindup.action).toMatchObject({ type: 'active', definitionId: 'fast-burst-lunge', phase: 'windup' })
  let snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
  expect(Number.isFinite(snapshot!.rootPositions['home.brutus'].x)).toBe(true)
  expect(Number.isFinite(snapshot!.rootPositions['away.drusus'].x)).toBe(true)

  // tick 256: both attacks connected simultaneously at 255 (frozen trace: two
  // `damage-dealt` + two `fighter-staggered` events on the same tick) --
  // proving a real hit and its resulting stagger are both reachable, and
  // that the contact flash system actually lit up for them.
  await advanceToTick(page, 256, cursor)
  const contactEvents = await eventsAtTick(page, 255)
  expect(contactEvents.filter((event) => event.type === 'damage-dealt')).toHaveLength(2)
  expect(contactEvents.filter((event) => event.type === 'fighter-staggered')).toHaveLength(2)
  const brutusAfterHit = await combatantState(page, 'home.brutus')
  const drususAfterHit = await combatantState(page, 'away.drusus')
  expect(brutusAfterHit.hp).toBe(298) // 324 - 26 (fast-burst-lunge body hit)
  expect(drususAfterHit.hp).toBe(302) // 350 - 48 (heavy-cleave body hit)
  expect(brutusAfterHit.staggerUntilTick).toBeGreaterThan(256)
  expect(drususAfterHit.staggerUntilTick).toBeGreaterThan(256)
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
  expect(snapshot!.activeEffectIds.some((id) => id.startsWith('body-'))).toBe(true)

  // tick 324: home.brutus mid `heavy-guard` windup, reacting to away.drusus's
  // second `fast-burst-lunge` (started 311, windup ends 329).
  await advanceToTick(page, 324, cursor)
  const guardWindup = await combatantState(page, 'home.brutus')
  expect(guardWindup.action).toMatchObject({ type: 'active', definitionId: 'heavy-guard', phase: 'windup' })

  // tick 329: the guard actually blocks -- `attack-blocked` + a shield-zone
  // `damage-dealt` (reduced chip damage, not the full hit) on the frozen
  // trace, and the shield contact flash is live.
  await advanceToTick(page, 329, cursor)
  const blockEvents = await eventsAtTick(page, 329)
  expect(blockEvents.some((event) => event.type === 'attack-blocked')).toBe(true)
  const shieldDamage = blockEvents.find((event) => event.type === 'damage-dealt')
  expect(shieldDamage).toMatchObject({ contactZone: 'shield', amount: 9 })
  const brutusAfterBlock = await combatantState(page, 'home.brutus')
  expect(brutusAfterBlock.hp).toBe(289) // 298 - 9 (shield chip damage, not a full hit)
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.activeEffectIds.some((id) => id.startsWith('shield-'))).toBe(true)

  // tick 357: away.drusus's forced disengage (Fast's post-burst-lunge
  // recovery locomotion) -- on the frozen trace this is a genuine, if
  // single-tick, `movement-intent-changed` to `'disengage'`.
  await advanceToTick(page, 357, cursor)
  const disengaging = await combatantState(page, 'away.drusus')
  expect(disengaging.locomotionIntent).toBe('disengage')

  // tick 400: a quiet baseline read, before the decline below -- away.drusus
  // is neutral (recovered from its previous stagger at tick 393, its next
  // action doesn't start until tick 417), so no reaction-overlay layer
  // (recognition-flinch, block/evade/parry, stagger, or defeat) touches its
  // `head` joint here. `PoseController`'s own layering leaves an untouched
  // joint at the identity transform, so this is `[0, 0, 0]` -- captured only
  // to give the tick-478 assertion below a same-run, same-rig comparison
  // point, not asserted as a standalone fact about the renderer.
  await advanceToTick(page, 400, cursor)
  const drususBaselineHead = (await arenaSnapshot(page))!.jointRotations['away.drusus'].head

  // tick 478: a `defense-declined` window -- away.drusus declined to defend
  // against home.brutus's `heavy-cleave` (instance `home.brutus:4`, event at
  // tick 475), and the eventual damage (tick 482) has not landed yet.
  //
  // This is the recognition-flinch trigger window `PoseController`/
  // `ArenaView` consume (see `ArenaView.ts`'s `pendingDefenseDeclinedTick`).
  // Asserting only `jointTransformsFinite` here would pass identically even
  // if the flinch had never been wired into `PoseController`/`ArenaView` at
  // all -- an unrendered flinch is still a finite, non-crashing frame. The
  // renderer-specific guarantee is the `head` joint itself: `PoseController`
  // only ever writes `head` from `recognitionFlinch`/`stagger`/`defeat`
  // overlays (`buildRecognitionFlinch` in `combatPoses.ts` sets it to
  // `[0.14, 0.08, 0]`, distinct from every other overlay's own value), and
  // away.drusus is in neither a stagger nor defeated state at this tick, so
  // observing that exact value -- differing from the tick-400 baseline
  // above, taken from the same rig in the same run -- is only possible if
  // the flinch overlay actually fired. Removing the `defenseDeclinedTick`
  // wiring in `ArenaView.ts`, or the `recognitionFlinchActive` branch in
  // `PoseController.ts`, would leave this `head` reading at the tick-400
  // baseline and fail this assertion, unlike the old finite-only check.
  await advanceToTick(page, 478, cursor)
  const declineEvents = await eventsAtTick(page, 475)
  expect(declineEvents).toContainEqual(expect.objectContaining({ type: 'defense-declined', defenderId: 'away.drusus', incomingActionId: 'home.brutus:4' }))
  const drususBeforeDamage = await combatantState(page, 'away.drusus')
  expect(drususBeforeDamage.hp).toBe(254) // unchanged -- the decline's own damage lands at tick 482, not yet
  expect(drususBeforeDamage.staggerUntilTick).toBeLessThanOrEqual(478) // not staggered -- isolates the flinch overlay from the stagger overlay
  expect(drususBeforeDamage.status).toBe('active') // not defeated -- isolates the flinch overlay from the defeat overlay
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
  const drususFlinchHead = snapshot!.jointRotations['away.drusus'].head
  expect(drususFlinchHead).not.toEqual(drususBaselineHead)
  expect(drususFlinchHead).toEqual([0.14, 0.08, 0])

  // tick 1910: home.brutus's defeat -- the bout's decisive `fighter-defeated`.
  await advanceToTick(page, 1910, cursor)
  const defeatEvents = await eventsAtTick(page, 1910)
  expect(defeatEvents).toContainEqual(expect.objectContaining({ type: 'fighter-defeated', defeatedId: 'home.brutus', sourceId: 'away.drusus' }))
  const brutusDefeated = await combatantState(page, 'home.brutus')
  expect(brutusDefeated.status).toBe('defeated')
  expect(brutusDefeated.hp).toBe(0)
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
})

test('freezes technical measure/parry/counter', async ({ page }) => {
  await startBoutZeroWith(page, 'nerva')
  const cursor = { current: 0 }

  // tick 1090: home.nerva settles into `hold-range` -- Technical's
  // "measuring" stance between exchanges (movement-intent-changed to
  // `hold-range` at tick 1085).
  await advanceToTick(page, 1090, cursor)
  const measuring = await combatantState(page, 'home.nerva')
  expect(measuring.locomotionIntent).toBe('hold-range')
  let snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)

  // tick 1560: home.nerva mid `technical-parry` windup, reacting to
  // away.drusus's `fast-slash` (both started tick 1557, windup ends 1567).
  await advanceToTick(page, 1560, cursor)
  const parryWindup = await combatantState(page, 'home.nerva')
  expect(parryWindup.action).toMatchObject({ type: 'active', definitionId: 'technical-parry', phase: 'windup' })

  // tick 1567: the parry connects -- `attack-parried` on the frozen trace,
  // weapon-zone contact flash live.
  await advanceToTick(page, 1567, cursor)
  const parryEvents = await eventsAtTick(page, 1567)
  expect(parryEvents.some((event) => event.type === 'attack-parried')).toBe(true)
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.activeEffectIds.some((id) => id.startsWith('weapon-'))).toBe(true)

  // tick 1570: the forced `technical-parry-counter` windup immediately
  // follows the parry (started tick 1568).
  await advanceToTick(page, 1570, cursor)
  const counterWindup = await combatantState(page, 'home.nerva')
  expect(counterWindup.action).toMatchObject({ type: 'active', definitionId: 'technical-parry-counter', phase: 'windup' })

  // tick 1576: the counter connects -- `damage-dealt` against away.drusus.
  await advanceToTick(page, 1576, cursor)
  const counterEvents = await eventsAtTick(page, 1576)
  expect(counterEvents).toContainEqual(expect.objectContaining({ type: 'damage-dealt', actorId: 'home.nerva', actionId: 'technical-parry-counter' }))
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
})

// ---------------------------------------------------------------------------
// Step 3: intentional visual baselines.
//
// Exact discipline per the task brief: fixed 1280x820 viewport, `?snapshot`
// (which starts paused), advance explicitly to the frozen tick, assert
// `paused === true`, render one fixed alpha (1 -- the exact frozen tick, no
// blend, for a fully reproducible pixel baseline), and only then capture.
// Update ONLY through `npx playwright test tests/combat-visuals.spec.ts
// --update-snapshots`, and review every diff by hand -- never accept an
// unrelated planning/interstitial/summary change riding along.
// ---------------------------------------------------------------------------

async function captureFrame(page: Page, name: string): Promise<void> {
  const debugState = await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())
  expect(debugState.paused).toBe(true)
  await page.evaluate(() => window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha!(1))
  await expect(page).toHaveScreenshot(name)
}

test('key pose: heavy cleave windup', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(253))
  await captureFrame(page, 'heavy-cleave.png')
})

test('key pose: fast burst-lunge windup', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  // away.drusus's `fast-burst-lunge` windup starting tick 759 (recovered and
  // re-spaced since the previous exchange, unlike the earlier tick-670
  // instance where both fighters were still crowded from the prior clash) --
  // from the same bout A run Step 2 freezes above, picked for a clearer,
  // less cluttered silhouette than the earlier instance.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(765))
  await captureFrame(page, 'fast-burst.png')
})

test('key pose: technical parry contact', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'nerva')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(1567))
  await captureFrame(page, 'technical-parry.png')
})

test('combat outcomes: defeat', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  // The killing blow (tick 1910) is atomic -- home.brutus holds at 11 HP
  // through tick 1909, then the final `fast-burst-lunge` deals 40 in one
  // tick, past the point of gradual decline. By this exact tick the series
  // has already transitioned to `between-bouts` (`advanceSeriesTicks`
  // processes the finish the same tick the battle finishes), so the real
  // "combat outcome" a player sees here genuinely includes the between-
  // bouts result panel -- this is the actual, deterministic post-defeat UI,
  // not an unrelated interstitial riding along.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(1910))
  await captureFrame(page, 'combat-outcomes.png')
})

test('a complete safe two-fighter frame', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  await captureFrame(page, 'combat-safe-frame.png')
})
