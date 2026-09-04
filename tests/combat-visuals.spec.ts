import { expect, test, type Page } from '@playwright/test'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { advanceBattleTicks, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { formatTraceHash } from '../src/simulation/random'

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
  // `page.goto` resolves on `load`, which does not guarantee the app has
  // installed `window.__GLADIATOR_TEST__`: `main.ts` assigns it inside an
  // `import.meta.env.DEV` block at the end of its own module evaluation, and
  // that evaluation now suspends on a top-level `await loadFighterModels()`
  // -- so the surface reliably appears one network round-trip AFTER `load`,
  // where it used to appear before it only by luck. A timeout cannot fix the
  // resulting `TypeError`; waiting for the surface can. Every `goto` in the
  // suite is followed by this same wait, for the same reason.
  await page.waitForFunction(() => Boolean(window.__GLADIATOR_TEST__))
  // `main.ts` now boots straight onto the season board (Task 8) -- there is
  // no bridge past it -- so `startNextSeries()` is what actually opens
  // series 0's planning screen before any `assign`/`confirm` call can
  // succeed.
  await page.evaluate(
    ([home, others]) => {
      window.__GLADIATOR_TEST__.startNextSeries()
      window.__GLADIATOR_TEST__.assign(home, 0)
      window.__GLADIATOR_TEST__.assign(others[0], 1)
      window.__GLADIATOR_TEST__.assign(others[1], 2)
      window.__GLADIATOR_TEST__.confirm()
    },
    [homeFighterId, rest] as const,
  )
}

/**
 * Plays series 0's bout 0 out and starts bout 1, for checkpoints whose
 * condition no longer occurs in bout 0.
 *
 * The retiarius-reach slice made this necessary rather than convenient: at
 * this seed, `nerva vs drusus` (bout 0 with Nerva in slot 0) now contains NO
 * PARRY AT ALL -- Nerva declines every defence opportunity, so
 * `technical-parry` is never even started, and with it the forced counter and
 * the counter's damage vanish from that trace. The mechanic itself is
 * healthy: the 200-seed acceptance cohort records 1109 parries converting at
 * 95.8%. It simply no longer happens in that one bout.
 *
 * `brutus/nerva/aquila` bout 1 is `nerva vs cassius`, which contains three
 * parries, each with its forced counter and the counter's damage -- the same
 * condition the checkpoints were chosen for, found by querying the new trace
 * for it rather than by nudging the old ticks.
 */
async function startBoutOneWith(page: Page, lineup: readonly ['brutus' | 'aquila' | 'nerva', 'brutus' | 'aquila' | 'nerva', 'brutus' | 'aquila' | 'nerva']): Promise<void> {
  await page.goto('/?seed=20260815&snapshot')
  await page.waitForFunction(() => Boolean(window.__GLADIATOR_TEST__))
  await page.evaluate((slots) => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign(slots[0], 0)
    window.__GLADIATOR_TEST__.assign(slots[1], 1)
    window.__GLADIATOR_TEST__.assign(slots[2], 2)
    window.__GLADIATOR_TEST__.confirm()
  }, lineup)
  // Bout 0 (`brutus vs drusus`) runs 1827 ticks; a generous margin, then the
  // explicit hand-off the season surface exposes.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(1900))
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
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
    const battle = window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!
    return battle.encounter.combatants[id]
  }, combatantId)
}

async function eventsAtTick(page: Page, tick: number) {
  return page.evaluate((t) => {
    const battle = window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!
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
//      frozen canonical adapter-duel trace hash", `dc635911`). This is
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

// Node's own answer, computed live in the test process rather than pinned as a
// literal: what this test proves is that Node and Chromium agree, not what the
// value is, so a content change never has to re-freeze anything here.
function nodeCanonicalDuelHash(): string {
  const brutus = { id: 'brutus', name: 'Brutus', school: 'Test', archetype: 'heavy' as const, maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }
  const drusus = { id: 'drusus', name: 'Drusus', school: 'Test', archetype: 'fast' as const, maxHp: 100, power: 10, accuracy: 0.8, defenseChance: 0.3, criticalChance: 0.1 }
  const battle = createBattle({ home: brutus, away: drusus, seed: 123, combatStyles: COMBAT_STYLES })
  return formatTraceHash(advanceBattleTicks(battle, MAX_BOUT_TICKS).traceHash)
}

test('matches the Node trace hash in Chromium', async ({ page }) => {
  await page.goto('/?snapshot')
  await page.waitForFunction(() => Boolean(window.__GLADIATOR_TEST__))

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

  expect(hash).toMatch(/^[0-9a-f]{8}$/)
  expect(hash).toBe(nodeCanonicalDuelHash())
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
// Root-yaw regression (2026-08-19 combat-legibility follow-up).
//
// Root-yaw regression: pose application must never touch the root's world
// facing. Kept as the guard for the clip-driven rig too.
//
// `renderActiveBattleAtAlpha(1)` (the same dev-only hook the key-pose
// captures below use) forces a full-alpha render, so the rendered facing is
// exactly `currState.facing` with no interpolation gap against the raw
// simulation state read alongside it in the same atomic `page.evaluate`.
// ---------------------------------------------------------------------------

test("keeps each rig's rendered root yaw locked to its simulation facing, never zeroed by the pose layer", async ({ page }) => {
  await startBoutZeroWith(page, 'brutus')
  const cursor = { current: 0 }

  // A spread of ticks already established deterministic by this file's own
  // Step 2 fixtures (mid-windup, post-contact, post-stagger, later exchanges)
  // -- reused here rather than arbitrary numbers so this test's ticks are
  // independently known to land mid-combat, not just at the bout's opening
  // approach where both fighters might coincidentally already face +Z.
  const ticks = [40, 231, 254, 930, 1242, 1658]

  for (const tick of ticks) {
    await advanceToTick(page, tick, cursor)

    // One atomic `evaluate` call for the same race-avoidance reason
    // `captureFrame`/the alpha-interpolation test above document: a
    // background `requestAnimationFrame` loop keeps calling `syncArena()`
    // with its own (paused-pegged) alpha even in `?snapshot` mode, so
    // setting alpha=1 and reading the snapshot back must happen in one
    // synchronous callback to guarantee they observe the same render.
    const { combatants, snapshot } = await page.evaluate(() => {
      window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha!(1)
      return {
        combatants: window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!.encounter.combatants,
        snapshot: window.__GLADIATOR_TEST__.getArenaDebugSnapshot!()!,
      }
    })

    for (const id of Object.keys(combatants)) {
      const facing = combatants[id].facing
      const expectedYaw = Math.atan2(facing.x, facing.z)
      const actualYaw = snapshot.rootYaw[id]
      expect(
        actualYaw,
        `t${tick} ${id}: rendered root yaw ${actualYaw} should match simulation facing yaw ${expectedYaw} (facing ${JSON.stringify(facing)})`,
      ).toBeCloseTo(expectedYaw, 5)
    }
  }
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
//   Bout A -- home.brutus (heavy) vs away.drusus (fast), series 0 bout 0:
//   heavy guard/cleave, fast burst/disengage, an ordinary hit+stagger, a
//   shield block, a defense-declined recognition window, and the bout's own
//   defeat.
//
//   Bout B -- home.nerva (technical) vs away.cassius (technical), series 0
//   bout 1 of the `brutus/nerva/aquila` lineup: technical's hold-range
//   "measure" stance, a parry, and the forced parry-counter.
//
// Both descriptions moved with the retiarius-reach slice, and the two changes
// are findings rather than bookkeeping. Bout A's exchange is no longer
// SIMULTANEOUS -- no tick in it carries two `damage-dealt` events, because the
// retiarius no longer trades at the arena floor. And bout B is a different
// bout: `nerva vs drusus` stopped containing a parry at all, so the pairing
// that demonstrates the mechanic had to be found by searching for it. See
// each test's own comment for the measurement.
//
// `getArenaDebugSnapshot()` is the dev-only numeric surface this task's
// owned files can read without modifying `ArenaView.ts`/`main.ts`: it proves
// every rendered joint transform is finite (never NaN/Infinity) and reports
// which contact-flash effect IDs are live, at each frozen tick -- the
// "blocking pose checks" the brief asks for. `clipMapping`'s own selection
// math (which clip and clip time a given phase/state maps to) is already unit
// tested elsewhere; this task's job is proving these specific
// semantic states are actually reachable, at these specific frozen ticks, in
// a real deterministic run.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Framing measurement surface (2026-08-23 slice, Task 5).
//
// `bodyHeightPx` and `fullBoundsPx` are deliberately different numbers: the
// first projects only what a fighter *wears*, the second everything he
// carries too. The whole reason the split exists is that the slice's
// pre-committed scale floor is a floor on how big the *man* reads, and a
// hoplomachus holding a 1.30-unit spear or a murmillo behind a 1.10-unit
// scutum would satisfy a floor measured over everything on screen without
// being any easier to see. `fighterModelContract.test.ts` pins the slot tags
// the shipped models carry; this pins that the partition
// actually reaches the rendered pixels, against a real bout, through the real
// projection, at the viewport the floor is stated at.
//
// Functional and numeric only -- no screenshot, no baseline. `stepBattleAndCamera`
// is used exactly as `scripts/measure-framing.ts` uses it, so this also pins
// the atomic step's contract (one tick per call) that every measured number in
// that harness depends on.
// ---------------------------------------------------------------------------

test('separates body height from full prop bounds in the arena debug snapshot', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  // home.nerva is the hoplomachus, whose spear is the longest handheld prop in
  // the roster and the one most likely to be wrongly counted as body.
  await startBoutZeroWith(page, 'nerva')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(240))

  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState().currentTick)

  // One atomic call, then one snapshot, in a single synchronous callback --
  // the same race the alpha-interpolation test above documents (a background
  // `requestAnimationFrame` keeps re-rendering at the runtime's own
  // paused-pegged alpha, so a two-round-trip version can observe a different
  // frame than the one it stepped).
  const { snapshot, after } = await page.evaluate(() => {
    window.__GLADIATOR_TEST__.stepBattleAndCamera!(30, 1 / 60)
    return {
      snapshot: window.__GLADIATOR_TEST__.getArenaDebugSnapshot!()!,
      after: window.__GLADIATOR_TEST__.getRenderDebugState().currentTick,
    }
  })

  // One simulation tick per requested tick, no more and no fewer.
  expect(after).toBe(before! + 30)

  expect(snapshot.canvasPx.width).toBeGreaterThan(0)
  expect(snapshot.canvasPx.height).toBeGreaterThan(0)
  expect(snapshot.groupExtent).toBeGreaterThan(0)

  const ids = Object.keys(snapshot.bodyHeightPx)
  expect(ids).toHaveLength(2)

  for (const id of ids) {
    const body = snapshot.bodyHeightPx[id]
    const full = snapshot.fullBoundsPx[id]
    const fullHeight = full.maxY - full.minY

    expect(Number.isFinite(body), `${id} body height should be finite`).toBe(true)
    expect(body, `${id} should have a positive body height`).toBeGreaterThan(0)
    // The body silhouette is a strict subset of the full one, so its projected
    // height can never exceed it. A body height that reached the full height
    // would mean a held prop had leaked into the body set.
    expect(fullHeight, `${id} full bounds should contain the body silhouette`).toBeGreaterThanOrEqual(body)

    // Everything measured is on the canvas and in front of the camera: a point
    // behind it would come back mirrored through the perspective divide, which
    // is how a projection bug would present.
    expect(Number.isFinite(full.minX) && Number.isFinite(full.maxX)).toBe(true)
    expect(full.maxX).toBeGreaterThan(full.minX)
    expect(full.maxY).toBeGreaterThan(full.minY)

    // `boundsPxWithoutWeapon` sits between the two by construction.
    const withoutWeapon = snapshot.boundsPxWithoutWeapon[id]
    expect(withoutWeapon.maxY - withoutWeapon.minY).toBeLessThanOrEqual(fullHeight + 1e-6)
    expect(withoutWeapon.maxY - withoutWeapon.minY).toBeGreaterThanOrEqual(body - 1e-6)
  }

  // The spear carrier specifically: his polearm must add real, measurable
  // extent beyond everything he wears, or the two numbers would be measuring
  // the same thing and the scale floor could be satisfied by the polearm.
  //
  // Measured across both axes, and against `boundsPxWithoutWeapon` (body +
  // helmet + shield) rather than against `bodyHeightPx` alone. The procedural
  // hoplomachus held his spear upright, so the prop's whole contribution was
  // vertical and a height difference was a sufficient proxy; the shipped model
  // levels the spear at his opponent, which puts the same reach into
  // `minX`/`maxX` instead -- 36 px of width here against 1.6 px of extra
  // height. Asserting height alone would now be asserting the authored pose
  // rather than the slot partition this test exists for. Same 5 px magnitude.
  const spearCarrier = 'home.nerva'
  const spearFull = snapshot.fullBoundsPx[spearCarrier]
  const spearWorn = snapshot.boundsPxWithoutWeapon[spearCarrier]
  const overhang = Math.max(
    spearFull.maxX - spearFull.minX - (spearWorn.maxX - spearWorn.minX),
    spearFull.maxY - spearFull.minY - (spearWorn.maxY - spearWorn.minY),
  )
  expect(overhang, 'the hoplomachus should carry visible prop beyond his own silhouette').toBeGreaterThan(5)
})

test('freezes heavy guard/cleave, fast burst/disengage, an ordinary hit/stagger, a shield block, defense-declined recognition, and defeat', async ({ page }) => {
  await startBoutZeroWith(page, 'brutus')
  const cursor = { current: 0 }


  // tick 232: a real body hit and its resulting stagger, with the contact
  // flash lit -- away.drusus's `fast-slash` lands 31 at tick 231.
  //
  // A FINDING, recorded rather than papered over. This checkpoint used to
  // freeze a SIMULTANEOUS mutual hit: two `damage-dealt` and two
  // `fighter-staggered` events on the same tick. There is no such tick left
  // in this bout -- not one tick in 1827 carries two `damage-dealt` events at
  // all. That is not a regression, it is the slice's own thesis showing up in
  // the trace: a simultaneous mutual exchange is what two fighters produce
  // when they are locked at the arena's 0.90 minimum separation, and the
  // retiarius no longer fights there. He strikes from 1.89 and withdraws, so
  // the blows alternate instead of landing together.
  //
  // What the checkpoint is FOR -- that a real hit, its stagger, and the body
  // flash are all reachable and rendered -- is unchanged and still asserted.
  // The simultaneity is what is gone, and it is gone on purpose.
  await advanceToTick(page, 232, cursor)
  let snapshot = await arenaSnapshot(page)
  const contactEvents = await eventsAtTick(page, 231)
  expect(contactEvents.filter((event) => event.type === 'damage-dealt')).toHaveLength(1)
  expect(contactEvents.filter((event) => event.type === 'fighter-staggered')).toHaveLength(1)
  const brutusAfterHit = await combatantState(page, 'home.brutus')
  expect(brutusAfterHit.hp).toBe(389) // 420 - 31 (fast-slash body hit)
  expect(brutusAfterHit.staggerUntilTick).toBeGreaterThan(232)
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
  expect(snapshot!.activeEffectIds.some((id) => id.startsWith('body-'))).toBe(true)

  // tick 250: home.brutus mid `heavy-guard` windup, reacting to away.drusus's
  // `fast-slash` (the guard's windup runs 246..253).
  await advanceToTick(page, 250, cursor)
  const guardWindup = await combatantState(page, 'home.brutus')
  expect(guardWindup.action).toMatchObject({ type: 'active', definitionId: 'heavy-guard', phase: 'windup' })

  // tick 254: the guard actually blocks -- `attack-blocked` + a shield-zone
  // `damage-dealt` (reduced chip damage, not the full hit), and the shield
  // contact flash is live.
  await advanceToTick(page, 254, cursor)
  const blockEvents = await eventsAtTick(page, 254)
  expect(blockEvents.some((event) => event.type === 'attack-blocked')).toBe(true)
  const shieldDamage = blockEvents.find((event) => event.type === 'damage-dealt')
  expect(shieldDamage).toMatchObject({ contactZone: 'shield', amount: 11 })
  const brutusAfterBlock = await combatantState(page, 'home.brutus')
  expect(brutusAfterBlock.hp).toBe(378) // 389 - 11 (shield chip damage, not a full hit)
  snapshot = await arenaSnapshot(page)
  // Exactly one shield flash, not merely "one or more": a guard-blocked hit
  // emits both `attack-blocked` and a paired `damage-dealt` for the same
  // `actionInstanceId`, and `ArenaView.processNewEvents`'s `blockedInstanceIds`
  // dedupe exists precisely so that single exchange spawns one flash, not two
  // overlapping ones burning both of `shield`'s pool slots. `.some(...)`
  // alone is satisfied by either outcome, so it is not a regression guard for
  // that dedupe -- assert the count.
  expect(snapshot!.activeEffectIds.filter((id) => id.startsWith('shield-'))).toHaveLength(1)

  // tick 930: away.drusus's forced disengage (Fast's post-burst-lunge
  // recovery locomotion), stamped at 926 and still held here, four ticks in
  // -- it stays until drusus has opened the range back out to
  // `FAST_FORCED_DISENGAGE_END_RANGE` (now 3.35 units) or the tick cap (now
  // 37) elapses. Before `hasFastForcedDisengageEnded`'s range test was fixed
  // this was a single-tick blip, which is why the assertion names the stamp
  // too: an intent that merely happens to read `'disengage'` on one frame is
  // not the mechanic.
  await advanceToTick(page, 930, cursor)
  const disengaging = await combatantState(page, 'away.drusus')
  expect(disengaging.locomotionIntent).toBe('disengage')
  expect(disengaging.forcedDisengageStartTick).toBe(926)

  // tick 1242: a `defense-declined` window -- away.drusus declined to defend
  // against home.brutus (instance `home.brutus:11`, the SAME instance the old
  // freeze named, at event tick 1239), and the eventual damage has not landed
  // yet.
  //
  // The skinned rig plays authored clips, and the clip table has no entry for
  // "declined a defense" -- a decline is a decision, not an action with its
  // own phase timeline, so nothing in `clipMapping` branches on it. (The
  // procedural rig used to overlay a recognition flinch here, keyed off a
  // `pendingDefenseDeclinedTick` `ArenaView` no longer carries.) What is
  // still worth pinning is that this window is reachable at this frozen tick
  // and renders without a NaN: the surrounding state assertions isolate it
  // from a stagger or a defeat, so the frame really is the decline's own.
  await advanceToTick(page, 1242, cursor)
  const declineEvents = await eventsAtTick(page, 1239)
  expect(declineEvents).toContainEqual(expect.objectContaining({ type: 'defense-declined', defenderId: 'away.drusus', incomingActionId: 'home.brutus:11' }))
  const drususBeforeDamage = await combatantState(page, 'away.drusus')
  expect(drususBeforeDamage.hp).toBe(287) // unchanged -- the decline's own damage has not landed yet
  expect(drususBeforeDamage.staggerUntilTick).toBeLessThanOrEqual(1242) // not staggered
  expect(drususBeforeDamage.status).toBe('active') // not defeated
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)

  // tick 1658: both fighters mid-windup on their signature committed attacks
  // -- home.brutus's `heavy-cleave` (started 1654) and away.drusus's
  // `fast-burst-lunge` (started 1644). RE-LOCATED by querying the new trace
  // for that exact condition rather than by moving the old number: the two
  // committed windups overlap for eight ticks, 1654..1661, and nowhere else
  // in the bout.
  await advanceToTick(page, 1658, cursor)
  const brutusCleaveWindup = await combatantState(page, 'home.brutus')
  const drususBurstWindup = await combatantState(page, 'away.drusus')
  expect(brutusCleaveWindup.action).toMatchObject({ type: 'active', definitionId: 'heavy-cleave', phase: 'windup' })
  expect(drususBurstWindup.action).toMatchObject({ type: 'active', definitionId: 'fast-burst-lunge', phase: 'windup' })
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
  expect(Number.isFinite(snapshot!.rootPositions['home.brutus'].x)).toBe(true)
  expect(Number.isFinite(snapshot!.rootPositions['away.drusus'].x)).toBe(true)

  // tick 1827: away.drusus's defeat -- the bout's decisive `fighter-defeated`.
  // The bout CHANGES HANDS with this slice: the murmillo used to be the one
  // who fell here, at tick 2106. Same checkpoint, same condition, opposite
  // fighter, and that reversal is the counter triangle returning to its band.
  await advanceToTick(page, 1827, cursor)
  const defeatEvents = await eventsAtTick(page, 1827)
  expect(defeatEvents).toContainEqual(expect.objectContaining({ type: 'fighter-defeated', defeatedId: 'away.drusus', sourceId: 'home.brutus' }))
  const drususDefeated = await combatantState(page, 'away.drusus')
  expect(drususDefeated.status).toBe('defeated')
  expect(drususDefeated.hp).toBe(0)
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)
})

test('freezes technical measure/parry/counter', async ({ page }) => {
  // RE-POINTED, not re-numbered. See `startBoutOneWith`: after the
  // retiarius-reach slice, `nerva vs drusus` (this test's old bout) contains
  // no parry at all -- Nerva declines every defence opportunity at this seed,
  // so `technical-parry` is never started and the forced counter never
  // happens. Nudging these ticks would have frozen a bout that no longer
  // shows what the test is named for. `nerva vs cassius` does, three times
  // over, and the sequence maps one-to-one onto the old checkpoints:
  //
  //   measuring stance   860 -> 900     parry windup     951 -> 908
  //   parry contact      958 -> 913     counter windup   961 -> 916
  //   counter damage     967 -> 922
  await startBoutOneWith(page, ['brutus', 'nerva', 'aquila'])
  const cursor = { current: 0 }

  // tick 900: home.nerva settles into `hold-range` -- Technical's "measuring"
  // stance between exchanges (the first such tick is 873), with no action of
  // its own running.
  await advanceToTick(page, 900, cursor)
  const measuring = await combatantState(page, 'home.nerva')
  expect(measuring.locomotionIntent).toBe('hold-range')
  expect(measuring.action.type).not.toBe('active')
  let snapshot = await arenaSnapshot(page)
  expect(snapshot!.jointTransformsFinite).toBe(true)

  // tick 908: home.nerva mid `technical-parry` windup, reacting to
  // away.cassius's `technical-thrust` (the parry started 903 and both reach
  // contact at 913).
  await advanceToTick(page, 908, cursor)
  const parryWindup = await combatantState(page, 'home.nerva')
  expect(parryWindup.action).toMatchObject({ type: 'active', definitionId: 'technical-parry', phase: 'windup' })

  // tick 913: the parry connects -- `attack-parried` on the frozen trace,
  // weapon-zone contact flash live.
  await advanceToTick(page, 913, cursor)
  const parryEvents = await eventsAtTick(page, 913)
  expect(parryEvents.some((event) => event.type === 'attack-parried')).toBe(true)
  snapshot = await arenaSnapshot(page)
  expect(snapshot!.activeEffectIds.some((id) => id.startsWith('weapon-'))).toBe(true)

  // tick 916: the forced `technical-parry-counter` windup immediately follows
  // the parry (started tick 914, the very next tick).
  await advanceToTick(page, 916, cursor)
  const counterWindup = await combatantState(page, 'home.nerva')
  expect(counterWindup.action).toMatchObject({ type: 'active', definitionId: 'technical-parry-counter', phase: 'windup' })

  // tick 922: the counter connects -- `damage-dealt` against away.cassius.
  await advanceToTick(page, 922, cursor)
  const counterEvents = await eventsAtTick(page, 922)
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

// Every capture in this file inherits `playwright.config.ts`'s
// `maxDiffPixelRatio`. That used to be a per-test override here, tighter than
// a loose 0.05 global; the global is now the single measured value for the
// whole suite (0.04, set between a 9.0% frame swap and 2.5% of cross-machine
// WebGL shading -- see the config's own comment), so pose captures and the
// safe-frame capture are held to the same bar and neither can silently drift.
/**
 * Seconds of simulated camera time every capture settles before shooting.
 * `?snapshot` holds the runtime paused and a paused frame advances no camera
 * time at all, so without this the camera would still sit exactly where the
 * bout's opening `reset()` left it -- a wide arena shot with the fighters
 * small and off-centre wherever they have walked to by the frozen tick. Four
 * seconds is past five look-target time constants (0.75 s), three distance
 * constants (1.25 s), and eight yaw constants (0.5 s, tightened from the
 * 2026-08-18 amendment's 1.5 s by the 2026-08-19 legibility slice), so every
 * axis has settled onto the framing a player would be looking at, and the
 * capture stays a pure function of the tick count rather than of wall-clock
 * time.
 */
const CAMERA_SETTLE_SECONDS = 4

async function captureFrame(page: Page, name: string): Promise<void> {
  const debugState = await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState())
  expect(debugState.paused).toBe(true)
  await page.evaluate((seconds) => window.__GLADIATOR_TEST__.settleCameraSeconds!(seconds), CAMERA_SETTLE_SECONDS)
  await page.evaluate(() => window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha!(1))
  await expect(page).toHaveScreenshot(name)
}

test('key pose: heavy cleave windup', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  // Tick 420 sits inside the `heavy-cleave` windup that starts at 395 -- the
  // second of eight in the bout, and the first that is not pre-empted by a
  // `heavy-guard` reaction (at the old tick 253 home.brutus is now mid-GUARD,
  // not mid-cleave, which is why this pose is re-located by its condition and
  // not by its number).
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(420))
  await captureFrame(page, 'heavy-cleave.png')
})

test('key pose: fast burst-lunge windup', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  // away.drusus's `fast-burst-lunge` windup starting tick 884 (recovered and
  // re-spaced since the previous exchange, a `fast-slash` back at 826, rather
  // than an instance where both fighters are still crowded from the prior
  // clash) -- from the same bout Step 2 freezes above, picked for a clearer,
  // less cluttered silhouette. The old tick 817 no longer sits inside any
  // lunge windup at all; this one is re-located by the condition.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(890))
  await captureFrame(page, 'fast-burst.png')
})

test('key pose: technical parry contact', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  // Same re-pointing as the checkpoint test above: the parry this pose exists
  // to show no longer happens in `nerva vs drusus`. Tick 913 of
  // `nerva vs cassius` is the parry's own contact tick.
  await startBoutOneWith(page, ['brutus', 'nerva', 'aquila'])
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(913))
  await captureFrame(page, 'technical-parry.png')
})

test('combat outcomes: defeat', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  // The killing blow (tick 1827) is atomic, and it now falls the other way:
  // away.drusus is the one defeated, by a `heavy-cleave`. By this exact tick the series
  // has already transitioned to `between-bouts` (`advanceSeriesTicks`
  // processes the finish the same tick the battle finishes), so the real
  // "combat outcome" a player sees here genuinely includes the between-
  // bouts result panel -- this is the actual, deterministic post-defeat UI,
  // not an unrelated interstitial riding along.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(1827))
  await captureFrame(page, 'combat-outcomes.png')
})

test('a complete safe two-fighter frame', async ({ page }) => {
  await page.setViewportSize(VIEWPORT)
  await startBoutZeroWith(page, 'brutus')
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  await captureFrame(page, 'combat-safe-frame.png')
})
