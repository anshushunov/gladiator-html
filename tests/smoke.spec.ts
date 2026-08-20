import { expect, test } from '@playwright/test'
import { preview, type PreviewServer } from 'vite'

test('plans and locks three matchups', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextSeries())
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  // Season 0 opens with all five season roster members fightable (nobody has
  // fought yet), not just the original three -- `SEASON_ROSTER` (Task 4/6).
  await expect(page.locator('[data-role="home-fighter"]')).toHaveCount(5)
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
    window.__GLADIATOR_TEST__.startNextSeries()
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
  // `rematch()` is gone -- `continueSeason()` is its season-level successor
  // (close out the series that just finished; `main.ts`'s `autoAdvanceSeason`
  // immediately opens the next one, since `SeasonView` does not exist yet),
  // and it resets the render frame the exact same way: `activeSeries`'s
  // `activeBattle` reference changes from the finished third bout to
  // `undefined` while planning the next series.
  await page.evaluate(() => window.__GLADIATOR_TEST__.continueSeason())
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
    window.__GLADIATOR_TEST__.startNextSeries()
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

// ---------------------------------------------------------------------------
// Task 19 Step 2: reset fixtures (rig identity, pose, flashes, camera, and
// event cursor across bout boundaries) and reduced-motion behavior.
// ---------------------------------------------------------------------------

test('resets rig identity, pose, trails, flashes, camera framing, the audio cursor, and event cursor for every new bout', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  const boutZeroStart = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  // Bout 0: `home.aquila` vs `away.drusus`, at the arena's fixed authored
  // start positions -- see `battle.test.ts`'s "places home/away at the
  // authored duel start positions".
  expect(Object.keys(boutZeroStart!.rootPositions).sort()).toEqual(['away.drusus', 'home.aquila'])
  expect(boutZeroStart!.rootPositions).toEqual({ 'home.aquila': { x: -4.2, z: 0 }, 'away.drusus': { x: 4.2, z: 0 } })
  expect(boutZeroStart!.activeEffectIds).toEqual([])
  expect(boutZeroStart!.trailPointCounts).toEqual({ 'home.aquila': 0, 'away.drusus': 0 })
  expect(boutZeroStart!.eventCursor).toBe(-1)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getAudioEventCursor!())).toBe(-1)
  // Always 0 at a fresh bout start: both authored start positions are
  // symmetric about the arena's origin, regardless of which two archetypes
  // are fighting, so the look target's midpoint is always the same even
  // though the framing *distance* legitimately varies with each pair's own
  // equipment radii.
  expect(boutZeroStart!.camera.lookTargetX).toBe(0)

  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  const boutOneStart = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  // Bout 1: `home.nerva` vs `away.cassius` -- a different rig identity from
  // bout 0's (proves the prior bout's rigs were actually torn down, not
  // merely repositioned), reset to the same fixed start positions, with
  // trails, flashes, and the event cursor cleared again.
  expect(Object.keys(boutOneStart!.rootPositions).sort()).toEqual(['away.cassius', 'home.nerva'])
  expect(boutOneStart!.rootPositions).toEqual({ 'home.nerva': { x: -4.2, z: 0 }, 'away.cassius': { x: 4.2, z: 0 } })
  expect(boutOneStart!.activeEffectIds).toEqual([])
  expect(boutOneStart!.trailPointCounts).toEqual({ 'home.nerva': 0, 'away.cassius': 0 })
  expect(boutOneStart!.eventCursor).toBe(-1)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getAudioEventCursor!())).toBe(-1)
  expect(boutOneStart!.camera.lookTargetX).toBe(0)
  expect(boutOneStart!.jointTransformsFinite).toBe(true)

  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  const boutTwoStart = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  // Bout 2: `home.brutus` vs `away.magnus` -- same reset guarantees again.
  expect(Object.keys(boutTwoStart!.rootPositions).sort()).toEqual(['away.magnus', 'home.brutus'])
  expect(boutTwoStart!.rootPositions).toEqual({ 'home.brutus': { x: -4.2, z: 0 }, 'away.magnus': { x: 4.2, z: 0 } })
  expect(boutTwoStart!.activeEffectIds).toEqual([])
  expect(boutTwoStart!.trailPointCounts).toEqual({ 'home.brutus': 0, 'away.magnus': 0 })
  expect(boutTwoStart!.eventCursor).toBe(-1)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getAudioEventCursor!())).toBe(-1)
  expect(boutTwoStart!.camera.lookTargetX).toBe(0)
  expect(boutTwoStart!.jointTransformsFinite).toBe(true)

  // The sound control (and its underlying `CombatAudio.resetBout()` voice/
  // cursor reset, unit-tested directly in `CombatAudio.test.ts`) keeps
  // working across every one of these bout boundaries rather than wedging.
  await expect(page.getByTestId('toggle-sound')).toBeVisible()
})

test('resets rig identity, pose, trails, flashes, the audio cursor, and event cursor on rematch, and again for the bout that follows it', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })

  // Real, non-empty rig/event state (both the arena's own and
  // `CombatAudio`'s) exists partway through the series -- captured while
  // still mid-bout (`advanceTicks(600)`, well short of a bout's own
  // `MAX_BOUT_TICKS`), not after a bout finishes: a single `advanceTicks`
  // burst that both finishes a bout *and* is the only `render`/`syncArena`
  // call in that burst never actually calls `combatAudio.consume()` for it
  // (`syncArena` only consumes while `series.phase` is `fighting`/`between-
  // bouts`, and a finishing burst has already flipped `phase` to `between-
  // bouts`/`summary` by the time the one `renderDom()` call at the end of
  // `advanceTicks` runs) -- so a cursor read taken only after a bout
  // finishes is not a reliable "did real events flow through" signal, only
  // a live mid-bout read is.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const midBout = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  expect(Object.keys(midBout!.rootPositions).length).toBeGreaterThan(0)
  expect(midBout!.eventCursor).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getAudioEventCursor!())).toBeGreaterThan(0)

  // Finish the series (the rest of bout 0, all of bout 1, all of bout 2).
  // The arena clears itself at the `summary` transition regardless (existing
  // behavior, not itself what this test is about -- already covered by the
  // bout-boundary test above); `CombatAudio`'s own cursor may or may not
  // still read a stale non-zero value here depending on exactly which tick
  // range the final `consume()` call landed in (see the comment above), so
  // this test deliberately makes no claim about its value at this exact
  // instant -- only about `continueSeason()`'s own, unconditional effect on
  // it, asserted next.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3000))
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(3600))

  // `rematch()` is gone -- `continueSeason()` closes out the series that just
  // finished, and `main.ts`'s `autoAdvanceSeason` immediately opens the next
  // one (no `SeasonView` exists yet to pause on in between).
  await page.evaluate(() => window.__GLADIATOR_TEST__.continueSeason())
  const afterRematch = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  // `season.ts`'s own `continueSeason()` clears `activeSeries.activeBattle`,
  // which `main.ts`'s `resetRenderFrame` (reached because `activeBattle`
  // changed) tears every rig down for, and unconditionally resets
  // `CombatAudio` via `resetBout()` -- regardless of whatever value the
  // cursor held going in.
  expect(afterRematch!.rootPositions).toEqual({})
  expect(afterRematch!.activeEffectIds).toEqual([])
  expect(afterRematch!.trailPointCounts).toEqual({})
  expect(afterRematch!.eventCursor).toBe(-1)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getAudioEventCursor!())).toBe(-1)

  // The same reset guarantees `smoke.spec.ts`'s bout-boundary test proves for
  // bout 1/2 hold again for the fresh bout that follows a rematch -- rematch
  // is not a special case the ordinary per-bout reset path skips.
  //
  // `startNextSeries()` here is a defensive no-op, not a strict requirement:
  // `continueSeason()` above already left the season on the next series'
  // planning phase via `autoAdvanceSeason`. Calling it again once already
  // past `season-board` fails `no-series-pending` harmlessly and leaves the
  // season untouched.
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  const postRematchBoutStart = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  expect(Object.keys(postRematchBoutStart!.rootPositions).sort()).toEqual(['away.drusus', 'home.aquila'])
  expect(postRematchBoutStart!.rootPositions).toEqual({ 'home.aquila': { x: -4.2, z: 0 }, 'away.drusus': { x: 4.2, z: 0 } })
  expect(postRematchBoutStart!.activeEffectIds).toEqual([])
  expect(postRematchBoutStart!.trailPointCounts).toEqual({ 'home.aquila': 0, 'away.drusus': 0 })
  expect(postRematchBoutStart!.eventCursor).toBe(-1)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getAudioEventCursor!())).toBe(-1)
  expect(postRematchBoutStart!.camera.lookTargetX).toBe(0)
  expect(postRematchBoutStart!.jointTransformsFinite).toBe(true)

  // And the reset pipeline is genuinely live again afterward, not merely
  // stuck at its reset value: a modest, still-mid-bout advance (mirroring
  // the `advanceTicks(600)` read above, for the same reason) shows both
  // cursors climbing off `-1`/0 from fresh post-rematch events.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const postRematchMidBout = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  expect(postRematchMidBout!.eventCursor).toBeGreaterThan(0)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getAudioEventCursor!())).toBeGreaterThan(0)
})

test('reduced motion removes trails and flashes while a hit, its stagger, and its result still land unchanged', async ({ page }) => {
  const seenEvents = async (targetPage: import('@playwright/test').Page, tick: number) =>
    targetPage.evaluate((t) => window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!.events.filter((event) => event.tick === t), tick)

  // Baseline: the same seeded matchup, ordinary motion.
  const normalPage = page
  await normalPage.goto('/?seed=20260815&snapshot')
  await normalPage.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('brutus', 0)
    window.__GLADIATOR_TEST__.assign('aquila', 1)
    window.__GLADIATOR_TEST__.assign('nerva', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  // tick 256: the frozen mutual hit/stagger from `combat-visuals.spec.ts`'s
  // key-pose fixture -- a real, guaranteed contact-flash trigger.
  await normalPage.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(256))
  const normalSnapshot = await normalPage.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  const normalEvents = await seenEvents(normalPage, 255)
  expect(normalSnapshot!.activeEffectIds.length).toBeGreaterThan(0) // sanity: a real flash fired without reduced motion

  // Reduced motion: identical seed/lineup/tick count, `prefers-reduced-
  // motion: reduce` emulated from before navigation (matching how a real
  // browser reports the OS preference at page load).
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('brutus', 0)
    window.__GLADIATOR_TEST__.assign('aquila', 1)
    window.__GLADIATOR_TEST__.assign('nerva', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(256))
  const reducedSnapshot = await page.evaluate(() => window.__GLADIATOR_TEST__.getArenaDebugSnapshot!())
  const reducedEvents = await seenEvents(page, 255)

  // Anticipation/contact/result preserved: the simulation's own event trace
  // (amounts, remaining HP, stagger durations) is byte-identical regardless
  // of reduced motion -- a presentation preference never touches simulation.
  expect(reducedEvents).toEqual(normalEvents)
  const reducedCombatants = await page.evaluate(() => {
    const battle = window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!
    return { brutus: battle.encounter.combatants['home.brutus'], drusus: battle.encounter.combatants['away.drusus'] }
  })
  expect(reducedCombatants.brutus.hp).toBe(297)
  expect(reducedCombatants.drusus.hp).toBe(302)
  expect(reducedCombatants.brutus.staggerUntilTick).toBeGreaterThan(256)
  expect(reducedCombatants.drusus.staggerUntilTick).toBeGreaterThan(256)
  expect(reducedSnapshot!.jointTransformsFinite).toBe(true)

  // Trail/flash removed: the same contact that lit a flash above spawns none
  // under reduced motion (`ArenaView.ts`'s `processNewEvents`/weapon-trail
  // gating, both keyed off the same `isReducedMotion()` check).
  expect(reducedSnapshot!.activeEffectIds).toEqual([])
})

test('renders movement-rich encounter combat', async ({ page }) => {
  await startSeededFirstBout(page)
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(600))
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveCombatantPositions())
  expect(after).not.toEqual(before)
  await expect(page.locator('canvas')).toHaveAttribute('data-rendered-combatants', '2')
})

test('carries events from every tick in a multi-tick batch to the arena, not just the last', async ({ page }) => {
  // A single large `advanceTicks` burst mirrors what happens at x2/x4 speed
  // (or any render that falls behind): many `stepBattleTick()` calls run
  // before the one `syncArena()` call that follows. Every event from every
  // one of those ticks -- not only the final tick's -- must still reach
  // `ArenaView`'s cursor; a per-tick delta (this task's own self-caught
  // regression) would silently drop everything but the last tick's slice.
  await startSeededFirstBout(page)
  const burstLastEventId = await page.evaluate(() => {
    window.__GLADIATOR_TEST__.advanceTicks(700)
    return document.querySelector('canvas')!.getAttribute('data-last-event-id')
  })

  // Final-review fix #7: comparing the burst's own `data-last-event-id`
  // against `maxEventId` read from that SAME burst's final state (the
  // original assertion below) only actually catches a per-tick-delta
  // regression when tick 700 itself happens to emit an event -- otherwise
  // `maxEventId` legitimately comes from an earlier tick and the comparison
  // passes vacuously even under the regression. Re-running the identical
  // seeded bout via 700 single-tick `advanceTicks(1)` calls instead -- which
  // forces a `syncArena()`/cursor update after every tick, the known-correct
  // behaviour regardless of what any individual tick emits -- and comparing
  // its own `data-last-event-id` against the burst's discriminates
  // regardless of which tick actually carries the max event id.
  await startSeededFirstBout(page)
  const perTickLastEventId = await page.evaluate(() => {
    for (let step = 0; step < 700; step += 1) window.__GLADIATOR_TEST__.advanceTicks(1)
    return document.querySelector('canvas')!.getAttribute('data-last-event-id')
  })
  expect(burstLastEventId).toBe(perTickLastEventId)

  const { maxEventId, contactEventCount } = await page.evaluate(() => {
    const contactTypes = new Set(['damage-dealt', 'attack-blocked', 'attack-parried'])
    const events = window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!.events
    return {
      maxEventId: Math.max(...events.map((event) => event.id)),
      contactEventCount: events.filter((event) => contactTypes.has(event.type)).length,
    }
  })
  // Sanity: this seeded run must contain more than one contact-producing
  // event spread across the batch (not all concentrated on the final tick),
  // or the comparison above would be weaker than intended.
  expect(contactEventCount).toBeGreaterThan(1)
  // The per-tick run (known-correct) really does end up at the batch's true
  // max event id, so the equality above is actually pinning the burst to the
  // right value, not just to itself.
  expect(Number(perTickLastEventId)).toBe(maxEventId)
})

test('replays no new effects when the same tick pair is re-rendered at a different alpha', async ({ page }) => {
  await startSeededFirstBout(page)
  // Advance enough ticks that at least one contact-producing event (and
  // therefore an active contact flash) is essentially guaranteed for this
  // seeded lineup -- the same tick count used above, and empirically
  // verified to already contain several by then.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(700))

  const result = await page.evaluate(() => {
    const getSnapshot = window.__GLADIATOR_TEST__.getArenaDebugSnapshot
    const renderAtAlpha = window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha
    if (!getSnapshot || !renderAtAlpha) throw new Error('dev-only arena test API is unavailable')

    const before = getSnapshot()!
    // Re-render the exact same immutable previous/current pair at two
    // different alphas -- presentation-only, must never reprocess events.
    renderAtAlpha(0.1)
    const afterAlphaLow = getSnapshot()!
    renderAtAlpha(0.9)
    const afterAlphaHigh = getSnapshot()!
    return {
      eventCursor: before.eventCursor,
      activeEffectIds: before.activeEffectIds,
      afterAlphaLow: { eventCursor: afterAlphaLow.eventCursor, activeEffectIds: afterAlphaLow.activeEffectIds },
      afterAlphaHigh: { eventCursor: afterAlphaHigh.eventCursor, activeEffectIds: afterAlphaHigh.activeEffectIds },
    }
  })

  // Sanity: a real flash must actually be active, or "no new flash" would
  // hold vacuously for both an empty array before and after.
  expect(result.eventCursor).toBeGreaterThan(0)
  expect(result.activeEffectIds.length).toBeGreaterThan(0)

  // Same event cursor and the exact same set of active flash IDs (not just
  // the same count) at both alphas: no event was reprocessed by either
  // replay, regardless of which alpha it re-rendered at.
  expect(result.afterAlphaLow.eventCursor).toBe(result.eventCursor)
  expect(result.afterAlphaLow.activeEffectIds).toEqual(result.activeEffectIds)
  expect(result.afterAlphaHigh.eventCursor).toBe(result.eventCursor)
  expect(result.afterAlphaHigh.activeEffectIds).toEqual(result.activeEffectIds)
})

test('shows a readable fallback and keeps the series running after WebGL context loss', async ({ page }) => {
  await startSeededFirstBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))

  const tickBefore = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
  expect(tickBefore).toEqual(expect.any(Number))

  await page.evaluate(() => {
    document.querySelector('canvas')!.dispatchEvent(new Event('webglcontextlost'))
  })

  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()

  // The series and runtime continue after the presentation failure: ticks
  // still advance, and the fallback stays up rather than crashing the page.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  const tickAfter = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
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

// ---------------------------------------------------------------------------
// Final-review fix #2: `new ArenaView(canvas)` runs unguarded at `main.ts`
// module top level, and its constructor's first statement used to be `new
// THREE.WebGLRenderer(...)`, which throws when no WebGL context can be
// created at all -- a strictly earlier failure than `webglcontextlost`
// (tested above), which only covers a context lost *after* a working one was
// already constructed. Before the fix this took the whole app down before
// `renderDom()`/the first `requestAnimationFrame` ever ran, so nothing --
// not even the planning screen -- ever appeared.
// ---------------------------------------------------------------------------

test('falls back gracefully instead of crashing when WebGL is unavailable at startup', async ({ page }) => {
  // Makes `HTMLCanvasElement.getContext` return `null` for every WebGL
  // context type before the app's own module-scope code runs, so
  // `THREE.WebGLRenderer`'s constructor hits exactly the "no context at all"
  // failure this fix guards -- installed via `addInitScript` so it is in
  // place before Vite's bundle even starts executing on navigation.
  await page.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(HTMLCanvasElement.prototype as any).getContext = function (this: HTMLCanvasElement, type: string, ...args: unknown[]) {
      if (typeof type === 'string' && type.toLowerCase().includes('webgl')) return null
      return (originalGetContext as (...a: unknown[]) => unknown).apply(this, [type, ...args])
    }
  })

  await page.goto('/?seed=20260815&snapshot')

  // The app boots normally -- planning screen and controls -- despite zero
  // WebGL from the very first frame. `#battle-ui` (the fallback text's own
  // ancestor) is only unhidden once a bout starts (`SeriesView.render`), so
  // the fallback's own visibility is checked after that below, matching how
  // the mid-session context-loss test above orders its assertions.
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()

  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')
  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()

  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  const tick = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
  expect(tick).toBeGreaterThan(0)
  await expect(page.locator('.arena__webgl-fallback')).toBeVisible()
})

// ---------------------------------------------------------------------------
// Final-review fix #1: `requestAnimationFrame(frame)` used to be `frame()`'s
// last statement, with the whole `syncArena()` -> `ArenaView.sync()` ->
// pose sampling/IK/`renderer.render`/`combatAudio.consume` path unguarded --
// any throw there skipped the reschedule and silently stopped every future
// frame (and therefore every future simulation tick) forever.
// ---------------------------------------------------------------------------

test('a throwing presentation frame latches a disabled-presentation flag but never stops tick advancement', async ({ page }) => {
  // Unpaused (no `&snapshot`) so the real `requestAnimationFrame` loop drives
  // ticks from real wall-clock time, not test-driven `advanceTicks` bursts --
  // this is specifically about `frame()`'s own real rAF loop surviving a
  // presentation throw, not about the `advanceTicks` code path (which never
  // goes through `frame()` at all).
  await page.goto('/?seed=20260815')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')

  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState().presentationDisabled)).toBe(false)

  await page.evaluate(() => window.__GLADIATOR_TEST__.forcePresentationThrowOnce!())
  // Let the forced throw actually happen on a real animation frame, and a
  // few more real frames run after it.
  await page.waitForTimeout(200)

  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState().presentationDisabled)).toBe(true)

  const tickAfterDisable = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
  expect(tickAfterDisable).toEqual(expect.any(Number))

  // Ticks keep advancing from real wall-clock time even though presentation
  // stays latched off -- the failure never re-throws (a real frame already
  // ran since it fired) and never stops the simulation loop above it.
  await page.waitForTimeout(200)
  const tickLater = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
  expect(tickLater).toBeGreaterThan(tickAfterDisable as number)
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getRenderDebugState().presentationDisabled)).toBe(true)
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
    window.__GLADIATOR_TEST__.startNextSeries()
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

// ---------------------------------------------------------------------------
// Final-review fix #3: `series.ts` flips `phase` straight from `fighting` to
// `summary` on the very tick the series-ending (third) bout resolves, unlike
// bouts 1/2 which always land in `between-bouts` first. `syncArena`'s gate
// only forwarded batches while `fighting`/`between-bouts`, so the third
// bout's final `damage-dealt`/`fighter-staggered`/`fighter-defeated`/
// `encounter-finished` batch never reached `ArenaView`/`CombatAudio` --
// every series ended with the arena vanishing mid-killing-blow and no defeat
// sound.
// ---------------------------------------------------------------------------

test('flushes the series-ending bout\'s final event batch to audio instead of dropping it', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('brutus', 1)
    window.__GLADIATOR_TEST__.assign('nerva', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  for (let bout = 0; bout < 3; bout += 1) {
    await finishActiveBout(page)
    if (bout < 2) await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  }
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'summary')

  const { finalEvents, audioCursor } = await page.evaluate(() => ({
    finalEvents: window.__GLADIATOR_TEST__.getActiveSeriesState()!.activeBattle!.events,
    audioCursor: window.__GLADIATOR_TEST__.getAudioEventCursor!(),
  }))
  // Sanity: the finished battle's own event log really does end with the
  // killing-blow batch, or the cursor comparison below would hold vacuously.
  expect(finalEvents.some((event) => event.type === 'fighter-defeated' || event.type === 'encounter-finished')).toBe(true)

  const maxEventId = Math.max(...finalEvents.map((event) => event.id))
  // Before the fix, this cursor stayed stuck below the finished battle's own
  // max event id -- the third bout's final batch (landing on the exact tick
  // that flips `phase` to `summary`) never reached `CombatAudio.consume`, so
  // the defeat cue that bouts 1/2 both play never fired for bout 3. It must
  // now exactly match, proving every event -- including the last one --
  // actually reached `CombatAudio`.
  expect(audioCursor).toBe(maxEventId)
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
    window.__GLADIATOR_TEST__.startNextSeries()
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
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextSeries())
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
    window.__GLADIATOR_TEST__.startNextSeries()
    window.__GLADIATOR_TEST__.assign('aquila', 0)
    window.__GLADIATOR_TEST__.assign('nerva', 1)
    window.__GLADIATOR_TEST__.assign('brutus', 2)
    window.__GLADIATOR_TEST__.confirm()
  })
  await page.getByTestId('speed-4').click()
  await expect(page.getByTestId('speed-4')).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick ?? 0)).toBeGreaterThan(0)
  await page.getByTestId('toggle-pause').click()
  const before = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
  expect(before).toEqual(expect.any(Number))
  await page.waitForTimeout(150)
  const after = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
  expect(after).toBe(before)
})

test('shows both interstitials with result and next matchup context', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => {
    window.__GLADIATOR_TEST__.startNextSeries()
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
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextSeries())
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('canvas')).toBeHidden()
  // Expected to fail here (Task 7 brief, Step 5): the season roster now
  // shows five fighter cards instead of three (`SEASON_ROSTER`, Task 4/6), so
  // this baseline is stale. Task 9 regenerates it once `SeasonView` (Task 8)
  // has settled the rest of the season-board layout too.
  await expect(page).toHaveScreenshot('planning.png', { fullPage: true })
})

// ---------------------------------------------------------------------------
// Task 18: optional event-driven combat audio
// ---------------------------------------------------------------------------

test('turns sound on by default after a real lineup-confirm click, and Sound off mutes without affecting the series', async ({ page }) => {
  await page.goto('/?seed=20260815&snapshot')
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextSeries())
  for (const [fighterId, boutIndex] of [['aquila', 0], ['nerva', 1], ['brutus', 2]] as const) {
    await page.getByTestId(`fighter-${fighterId}`).click()
    await page.getByTestId(`slot-${boutIndex}`).click()
  }
  // The gesture-eligible click itself: `combatAudio.enableAfterGesture()`
  // fires synchronously inside this click's handler (see main.ts's
  // `applyIntent` 'confirm' case), so `AudioContext.resume()` begins inside
  // this real browser gesture -- the same requirement Playwright's own
  // click satisfies for autoplay policy purposes.
  await page.getByTestId('confirm-lineup').click()
  await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')

  // The enable promise settles asynchronously; the visible control catches
  // up once it does.
  await expect(page.getByTestId('toggle-sound')).toHaveText('Sound on')
  await expect(page.getByTestId('toggle-sound')).toHaveAttribute('aria-pressed', 'true')

  await page.getByTestId('toggle-sound').click()
  await expect(page.getByTestId('toggle-sound')).toHaveText('Sound off')
  await expect(page.getByTestId('toggle-sound')).toHaveAttribute('aria-pressed', 'false')

  // A presentation/audio control can never stop or mutate the simulation.
  await page.evaluate(() => window.__GLADIATOR_TEST__.advanceTicks(60))
  const tick = await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.activeBattle?.encounter.tick)
  expect(tick).toBeGreaterThan(0)
})

test('keeps the sound control (and its audio voice/cursor reset) working across the second bout', async ({ page }) => {
  await startSeededFirstBout(page)
  await finishActiveBout(page)
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextBout())
  // The Sound on/off control survives a bout boundary rather than resetting
  // to its planning-phase absence -- audio enablement is a session concern,
  // not a per-bout one (design.md: "Persistence across page loads is out of
  // scope", but persistence *within* a session across bouts is expected).
  // `CombatAudio.resetBout()` itself (voices/cursors) is exercised at the
  // unit level in `CombatAudio.test.ts`; this only proves the surrounding
  // wiring still functions across a real bout boundary.
  await expect(page.getByTestId('toggle-sound')).toBeVisible()
})

test('audio debug: triggers all nine cues via the dev-only ?audioDebug=1 panel without starting a bout', async ({ page }) => {
  await page.goto('/?audioDebug=1&seed=20260815&snapshot')
  await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
  await expect(page.locator('[data-testid="audio-debug"]')).toBeVisible()

  const cues = [
    'footstep-light',
    'footstep-heavy',
    'weapon-whoosh-light',
    'weapon-whoosh-heavy',
    'body-hit',
    'shield-block',
    'weapon-parry',
    'stagger',
    'defeat',
  ]
  for (const cue of cues) {
    await expect(page.getByTestId(`audio-debug-${cue}`)).toBeVisible()
    await page.getByTestId(`audio-debug-${cue}`).click()
  }

  await expect.poll(() => page.evaluate(() => window.__GLADIATOR_TEST__.getAudioDebugLog?.())).toEqual(cues)
  // No bout was ever started by exercising the debug panel.
  expect(await page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()!.phase)).toBe('planning')
})

/**
 * Serves the already-built `dist/` output (via Vite's own `preview()` API,
 * the programmatic equivalent of `npm run preview`) on a dedicated port,
 * distinct from `tests/global-setup.ts`'s dev server on 4173 -- that global
 * server always runs with `import.meta.env.DEV` true, so it can never stand
 * in for "what does a production build actually ship". Requires `dist/` to
 * already exist (`npm run build`, which `npm run check` always runs before
 * `test:e2e`); `vite.preview()` itself throws a clear, actionable error
 * otherwise.
 */
async function withProductionPreview<T>(run: (baseUrl: string) => Promise<T>): Promise<T> {
  const previewPort = 4174
  const server: PreviewServer = await preview({ preview: { host: '127.0.0.1', port: previewPort, strictPort: true } })
  try {
    return await run(`http://127.0.0.1:${previewPort}`)
  } finally {
    await server.close()
  }
}

test('a production build renders no audio debug UI even with ?audioDebug=1, and exposes no test API at all (base or debug)', async ({ page }) => {
  await withProductionPreview(async (baseUrl) => {
    await page.goto(`${baseUrl}/?audioDebug=1&seed=20260815&snapshot`)
    await expect(page.getByRole('heading', { name: 'Plan the series' })).toBeVisible()
    await expect(page.locator('[data-testid="audio-debug"]')).toHaveCount(0)

    // Task 6: the decision trace panel is the same kind of dev-only surface
    // as the audio debug panel above -- `?debugDecisions=1` must render
    // nothing in a production build either.
    await page.goto(`${baseUrl}/?debugDecisions=1&seed=20260815&snapshot`)
    await expect(page.getByTestId('decision-panel')).toHaveCount(0)

    // Final-review fix #4: the base command/inspection API
    // (`getState`/`assign`/`advanceTicks`/etc.) used to be assigned
    // unconditionally, so this test previously only checked the dev-only
    // *extensions* on top of it. The whole surface is dev-only now --
    // `window.__GLADIATOR_TEST__` itself is `undefined` in a production
    // build, not merely missing individual fields.
    const testApiType = await page.evaluate(() => typeof window.__GLADIATOR_TEST__)
    expect(testApiType).toBe('undefined')
  })
})

test('a production build ignores ?snapshot and never starts a real session paused', async ({ page }) => {
  await withProductionPreview(async (baseUrl) => {
    // Final-review fix #4: `?snapshot` (pauses on load, for stable Playwright
    // fixtures) used to be read unconditionally, making it a production-
    // reachable URL param that could silently start a real player's session
    // paused. No test API is available in production (see the test above),
    // so this plays the lineup through real DOM clicks and confirms the
    // canvas's own `data-last-event-id` attribute keeps climbing over real
    // wall-clock time -- proving ticks are not stuck paused.
    await page.goto(`${baseUrl}/?seed=20260815&snapshot`)
    for (const [fighterId, boutIndex] of [['aquila', 0], ['nerva', 1], ['brutus', 2]] as const) {
      await page.getByTestId(`fighter-${fighterId}`).click()
      await page.getByTestId(`slot-${boutIndex}`).click()
    }
    await page.getByTestId('confirm-lineup').click()
    await expect(page.getByTestId('series-phase')).toHaveAttribute('data-phase', 'fighting')

    const canvas = page.locator('canvas')
    await expect.poll(async () => Number(await canvas.getAttribute('data-last-event-id'))).toBeGreaterThan(0)
  })
})