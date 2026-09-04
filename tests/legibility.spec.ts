import { expect, test, type Page } from '@playwright/test'
import type { BoutIndex } from '../src/simulation/series'

// ---------------------------------------------------------------------------
// Task 8: legibility acceptance for the readable-gladiator-types slice, run
// against the real app -- the scale floor, the safe area, the screen-vs-world
// separation scale, and the type vocabulary on every phase.
//
// ===========================================================================
// THE CRITERIA BELOW ARE THE AMENDED ONES (human ruling of 2026-08-24).
// They supersede the plan's originals on two points, and only two. If you are
// reading `130` here and reaching for the plan, read this block first.
// ===========================================================================
//
//   1. SCALE FLOOR. The floor VALUE is unchanged: 130 px, pre-committed, never
//      lowered to make a run green. What the amendment changed is WHICH FRAMES
//      must clear it -- the 92nd percentile of in-band ticks at 1280x820,
//      rather than every in-band tick. So a run in which some in-band ticks sit
//      below 130 px is NOT a failure under this criterion: 29.9% of them do
//      (Task 6's measured full-matrix pass), and the p92 reading is
//      132.93 px, +2.25% over the floor. A test that failed on those ticks
//      would be a test written against the superseded criterion.
//
//      `BODY_FLOOR_PERCENTILE` is FROZEN: p92 was fixed in writing, derived
//      from Task 5's already-recorded trace of the *old* camera, before Task
//      6's camera sweep ran (see `scripts/measure-framing.ts`'s
//      `FROZEN_BODY_FLOOR_PERCENTILE` and Task 6's report §1). It is an input
//      to the camera, never an output of it -- do not re-derive it here, and
//      do not move it.
//
//   2. SAFE AREA. Long handheld props -- the hoplomachus' spear shaft and the
//      retiarius' trident -- MAY leave frame. Everything else (body, helmet,
//      shield, net, galerus, greaves, and the murmillo's gladius, which is not
//      a polearm) stays inside the 5% CANVAS inset, on every tick of all nine
//      pairings, at all three viewports.
//
// Everything else the plan states is unchanged, including that the safe area is
// an inset of the CANVAS (730x518 at a 1280x820 page, 542x518 at 1024x768,
// 786x428 at 820x640) and never of the viewport. The two rectangles are very
// different: the arena is one cell of a page that also carries HP cards and a
// battle feed, and a rule checked against viewport width would be satisfied by
// a fighter halfway off the canvas.
//
// None of the numbers asserted here were read off a run. The floor (130), the
// percentile (p92), the inset (5%) and `MIN_ATTENUATION_RATIO` were all fixed
// before this file was executed; where a run disagrees with one, the run is
// the finding.
//
// THIS FILE IS WHY `playwright.config.ts` SETS `workers: 1`.
// It drives 45 full bouts, each stepping and rendering ~1200-2700 ticks through
// Chromium's software rasterizer, which is itself multi-threaded. Run
// concurrently with the other spec files it starves them, and their (default,
// 30 s) timeouts are what fail -- measured on this machine: default workers
// gave 3 deliberate screenshot failures plus 7 spurious timeouts in 14.6 min,
// against 3 deliberate failures and nothing else in 12.5 min at one worker.
// Serialising is both cleaner and faster here, because this file dominates the
// wall clock either way. The config comment carries the full measurement and
// the reason a `dependencies:` project split was rejected.
// ---------------------------------------------------------------------------

const SEED = 20260815

/** One frame of `x1` playback -- what the camera is charged per simulation tick, exactly as `scripts/measure-framing.ts` charges it. */
const CAMERA_DELTA_SECONDS = 1 / 60

/** A bout runs ~1200-2700 ticks; this is the ceiling before the trace gives up on one (and fails, rather than silently measuring half a bout). */
const MAX_BOUT_TICKS = 4000

/** The pre-committed on-screen body-height floor. Never lowered -- see the amendment block above. */
const MIN_BODY_HEIGHT_PX = 130

/** Frozen before Task 6's camera sweep, from Task 5's trace. See the amendment block above. */
const BODY_FLOOR_PERCENTILE = 0.92

/** The safe area is this fraction of the CANVAS, inset on all four edges. */
const SAFE_INSET = 0.05

/**
 * The floor of "how much of a real approach or retreat survives to the screen",
 * measured against a camera nailed at `FLAT_DISTANCE` (see `attenuationRatio`).
 *
 * **Pre-committed from Task 5's measurement, before this file was run**, on the
 * same discipline as the 130 px floor. Task 5 §3 measured, on the camera as it
 * then shipped, per-tick |d(screen px)| / |d(world units)| against the frame's
 * own pixels-per-world-unit at every one of the nine pairings: 52.4 vs 52.0
 * overall (ratio 1.008), with the worst pairing at 55.2/56.9 = 0.970 and the
 * best at 1.083. Its round-2 §B then calibrated the projection absolutely --
 * measured px/unit over the value predicted from the camera's own FOV,
 * elevation ratio and distance, with no free parameter -- at a median of 0.9939
 * (range 0.9869..1.0078), attributing the ~1% shortfall to the damped yaw
 * sitting a few degrees off broadside, i.e. to this measurement's own
 * resolution floor rather than to any camera behaviour.
 *
 * `0.90` sits below the worst pairing Task 5 measured (0.970) by about seven
 * points -- room for that ~1% resolution floor, for pose noise and for the
 * distance-damping residue Task 7 measured (0.0677 of distance after a wide
 * excursion, -0.76% of body height) -- while still failing decisively on the
 * regression it names: the ratio is essentially `FLAT_DISTANCE / the distance
 * the camera actually sat at`, so restoring the old `11` lower clamp (0.80) or
 * any other 10%-or-worse loss of on-screen scale inside the band fails it.
 */
const MIN_ATTENUATION_RATIO = 0.9

/**
 * The tactical band, in PAIR SEPARATION (world units): closest legal contact to
 * the longest authored attack reach (design spec, "Terminology"). Converted to
 * the GROUP EXTENT `extentToDistance` actually consumes by adding both
 * fighters' equipment radii with the camera's own 10% margin -- so the band's
 * edges differ per pairing, which is why they are computed per trace here
 * rather than taken as one number.
 *
 * These three literals duplicate `ArenaCamera`'s own `BAND_HIGH_SEPARATION` /
 * `EQUIPMENT_MARGIN_FRACTION` (both module-private there) and
 * `scripts/measure-framing.ts`'s copies of them. The duplication is pinned
 * rather than trusted: `pins the widest pairing's band edge to the camera's own
 * flat region` below asserts that the widest pairing's upper edge is exactly
 * the extent at which the shipped `extentToDistance` stops being flat, so a
 * change to either constant on either side breaks that test rather than
 * silently re-defining "in band" underneath the floor.
 */
const BAND_SEPARATION_LOW = 0.9
const BAND_SEPARATION_HIGH = 3.1
const EQUIPMENT_MARGIN = 1.1

/**
 * Below this many in-band ticks a percentile is not a measurement. Task 6's
 * full pass measured 1055-1833 in-band ticks per pairing at 1280x820, so this
 * is two orders of magnitude of slack -- it exists to catch a trace that ended
 * early or a band filter that stopped matching, not to bound the real spread.
 */
const MIN_IN_BAND_TICKS = 100

const VIEWPORTS = [
  { width: 1280, height: 820 },
  { width: 1024, height: 768 },
  { width: 820, height: 640 },
] as const

/** The floor is stated at this viewport only (the plan, unchanged by the amendment). */
const FLOOR_VIEWPORT = VIEWPORTS[0]

type Archetype = 'heavy' | 'fast' | 'technical'

/** Player-facing type names (Task 2), so the pairing labels read in the vocabulary the slice ships. */
const TYPE_NAME: Readonly<Record<Archetype, string>> = {
  heavy: 'Murmillo',
  fast: 'Retiarius',
  technical: 'Hoplomachus',
}

/**
 * The kits whose weapon is a polearm, and so the only two the amended safe area
 * lets out of frame. Deliberately NOT "every weapon": the murmillo's gladius is
 * built under the same `'weapon'` slot and is still required inside the inset.
 */
const POLEARM_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(['fast', 'technical'])

// ---------------------------------------------------------------------------
// The nine pairings, built exactly as `scripts/measure-framing.ts` builds them:
// each of the three home gladiators in each of the three bout slots, against
// that slot's fixed opponent.
// ---------------------------------------------------------------------------

const LINEUPS: readonly (readonly [string, string, string])[] = [
  ['brutus', 'aquila', 'nerva'],
  ['aquila', 'nerva', 'brutus'],
  ['nerva', 'brutus', 'aquila'],
]
const OPPONENT_BY_SLOT = ['drusus', 'cassius', 'magnus'] as const

interface Pairing {
  index: number
  label: string
  homeId: string
  opponentId: string
  boutIndex: BoutIndex
  lineup: readonly [string, string, string]
}

function buildPairings(): Pairing[] {
  const pairings: Pairing[] = []
  for (const homeId of ['brutus', 'aquila', 'nerva']) {
    for (const boutIndex of [0, 1, 2] as const) {
      const lineup = LINEUPS.find((candidate) => candidate[boutIndex] === homeId)
      if (!lineup) throw new Error(`No lineup puts ${homeId} in slot ${boutIndex}`)
      const index = pairings.length + 1
      pairings.push({
        index,
        label: `${String(index).padStart(2, '0')} ${homeId} vs ${OPPONENT_BY_SLOT[boutIndex]}`,
        homeId,
        opponentId: OPPONENT_BY_SLOT[boutIndex],
        boutIndex,
        lineup,
      })
    }
  }
  return pairings
}

const PAIRINGS = buildPairings()

// ---------------------------------------------------------------------------
// Per-tick record
// ---------------------------------------------------------------------------

interface BoundsPx {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface Sample {
  tick: number
  groupExtent: number
  distance: number
  /** Home first, then away -- see `collectPerTick`. */
  bodyHeightPx: [number, number]
  fullBoundsPx: [BoundsPx, BoundsPx]
  boundsPxWithoutWeapon: [BoundsPx, BoundsPx]
  worldSeparation: number
  screenSeparationPx: number
}

interface Trace {
  canvas: { width: number; height: number }
  archetypes: [Archetype, Archetype]
  ids: [string, string]
  samples: Sample[]
  /** `false` when the trace hit `MAX_BOUT_TICKS` instead of the bout ending -- a partial trace cannot support an "every tick" claim. */
  completed: boolean
}

/** The rig and camera numbers the measurements are checked against, read off the running app rather than copied here as literals. */
interface RigConstants {
  radii: Record<Archetype, number>
  cameraElevationRatio: number
  cameraFovDegrees: number
  flatDistance: number
  /** The largest group extent the shipped `extentToDistance` still frames at exactly `flatDistance` -- the camera's own flat-region edge, found by bisection. */
  flatRegionEdgeExtent: number
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * Opens the series, fields `pairing.lineup`, and reaches `pairing.boutIndex`
 * with the arena rendering that bout.
 *
 * **The non-vacuity assertion at the end is the point of this helper.** The app
 * boots on the season board, and every tick-stepping entry point returns early
 * with no active series (`stepBattleTick`'s `if (!activeSeries) return`), so a
 * spec that only advances ticks iterates an EMPTY metrics object and passes
 * every geometry assertion without ever measuring a fighter. Asserting that the
 * debug snapshot carries exactly two fighters -- and that they are the two this
 * pairing names -- before any geometry runs is what makes everything after it
 * non-vacuous.
 */
async function startBout(page: Page, pairing: Pairing): Promise<void> {
  await page.goto(`/?seed=${SEED}&snapshot`)
  await page.waitForFunction(() => Boolean(window.__GLADIATOR_TEST__))
  await page.evaluate((assignments) => {
    const api = window.__GLADIATOR_TEST__
    api.startNextSeries()
    assignments.forEach((fighterId, slot) => api.assign(fighterId, slot as BoutIndex))
    api.confirm()
  }, [...pairing.lineup])

  // The bouts before the target slot are not the pairing being measured: run
  // them out instantly (no per-tick render) and step to the next one.
  for (let index = 0; index < pairing.boutIndex; index += 1) {
    await page.evaluate(() => {
      const api = window.__GLADIATOR_TEST__
      while (api.getActiveSeriesState()!.phase === 'fighting') api.advanceTicks(240)
      api.startNextBout()
    })
  }

  // Deliberately BEFORE `waitForCanvasSize`: a bout that never started has no
  // arena to size, so waiting first would report the vacuity as a canvas
  // timeout instead of as "there are no fighters here".
  const opened = await page.evaluate(() => {
    const api = window.__GLADIATOR_TEST__
    const series = api.getActiveSeriesState()
    const snapshot = api.getArenaDebugSnapshot!()
    return {
      phase: series?.phase ?? null,
      boutIndex: series?.activeBoutIndex ?? null,
      combatantIds: snapshot ? Object.keys(snapshot.bodyHeightPx) : [],
    }
  })

  expect(opened.phase, `${pairing.label}: the series should be fighting`).toBe('fighting')
  expect(opened.boutIndex, `${pairing.label}: should be at the requested bout slot`).toBe(pairing.boutIndex)
  // The assertion this helper exists for: exactly two fighters, and exactly the
  // two this pairing names. An unstarted bout produces `[]` here -- an empty
  // metrics object every geometry loop below would iterate zero times and pass.
  // Pinning the identities as well as the count also means a lineup that landed
  // in the wrong slot fails here rather than quietly measuring another pairing.
  expect(opened.combatantIds.sort(), `${pairing.label}: the arena should be rendering exactly the two named fighters`).toEqual(
    [`away.${pairing.opponentId}`, `home.${pairing.homeId}`],
  )

  const canvas = await waitForCanvasSize(page)
  expect(canvas.width, `${pairing.label}: the canvas should have settled at a real size`).toBeGreaterThan(0)
  expect(canvas.height).toBeGreaterThan(0)
}

/**
 * Waits for the arena canvas to have settled at its final CSS size: two
 * identical readings an animation frame apart, not merely non-zero. The canvas
 * is sized by a `ResizeObserver` on its parent and the renderer's aspect ratio
 * follows from that, so a pixel figure measured before it settles belongs to a
 * frame that was never shown -- and a layout can pass through an intermediate
 * width on the way. (Same wait, and the same reason, as
 * `scripts/measure-framing.ts`'s.)
 */
async function waitForCanvasSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(async () => {
    const api = window.__GLADIATOR_TEST__
    const read = (): { width: number; height: number } => api.getArenaDebugSnapshot!()!.canvasPx
    const nextFrame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => done()))
    let previous = read()
    for (let attempt = 0; attempt < 120; attempt += 1) {
      await nextFrame()
      const current = read()
      if (current.width > 0 && current.height > 0 && current.width === previous.width && current.height === previous.height) return current
      previous = current
    }
    throw new Error('Canvas size never settled')
  })
}

/**
 * Steps the open bout tick by tick to its end, reading exactly one debug
 * snapshot after each step.
 *
 * The whole bout runs inside ONE `page.evaluate` callback, and each step and
 * its snapshot read sit in the same synchronous statement sequence, for the
 * reason `scripts/measure-framing.ts` documents: `main.ts`'s own
 * `requestAnimationFrame` loop keeps re-rendering in the background even while
 * `?snapshot` holds the runtime paused, at its own paused-pegged alpha, so a
 * step and a read split across two round-trips can observe two different
 * frames -- and the background frame would additionally feed the camera's
 * dead-zone references a frame the measurement never observed. A synchronous
 * callback cannot be interleaved with an animation frame.
 */
async function collectPerTick(page: Page, maxTicks: number): Promise<Trace> {
  const collected = await page.evaluate(
    ({ dt, cap }) => {
      const api = window.__GLADIATOR_TEST__
      const battle = api.getActiveSeriesState()!.activeBattle!
      // Home first, always: `combatantIds` is the encounter's own order, which
      // is not guaranteed to lead with the home fighter, and every index into
      // `bodyHeightPx`/`fullBoundsPx` below means "home" or "away".
      const ids = [...battle.encounter.combatantIds].sort(
        (a, b) => (a.startsWith('home.') ? -1 : 0) - (b.startsWith('home.') ? -1 : 0),
      ) as [string, string]
      const archetypes = ids.map((id) => battle.encounter.combatants[id].definition.archetype)

      const samples: unknown[] = []
      let previousTick = api.getRenderDebugState().currentTick
      let completed = false
      for (let step = 0; step < cap; step += 1) {
        api.stepBattleAndCamera(1, dt)
        const snapshot = api.getArenaDebugSnapshot!()
        const tick = api.getRenderDebugState().currentTick
        // The bout is over the moment a step no longer advances the tick:
        // `advanceSeriesTicks` returns its input untouched once the phase
        // leaves `fighting`, which is the same boundary the runtime sees.
        if (!snapshot || tick === null || tick === previousTick) {
          completed = true
          break
        }
        previousTick = tick

        const [home, away] = ids
        const dxWorld = snapshot.rootPositions[home].x - snapshot.rootPositions[away].x
        const dzWorld = snapshot.rootPositions[home].z - snapshot.rootPositions[away].z
        const dxScreen = snapshot.centerPx[home].x - snapshot.centerPx[away].x
        const dyScreen = snapshot.centerPx[home].y - snapshot.centerPx[away].y
        samples.push({
          tick,
          groupExtent: snapshot.groupExtent,
          distance: snapshot.camera.distance,
          bodyHeightPx: [snapshot.bodyHeightPx[home], snapshot.bodyHeightPx[away]],
          fullBoundsPx: [snapshot.fullBoundsPx[home], snapshot.fullBoundsPx[away]],
          boundsPxWithoutWeapon: [snapshot.boundsPxWithoutWeapon[home], snapshot.boundsPxWithoutWeapon[away]],
          worldSeparation: Math.hypot(dxWorld, dzWorld),
          screenSeparationPx: Math.hypot(dxScreen, dyScreen),
        })
      }
      return {
        canvas: api.getArenaDebugSnapshot!()!.canvasPx,
        archetypes,
        ids,
        samples,
        completed,
      }
    },
    { dt: CAMERA_DELTA_SECONDS, cap: maxTicks },
  )
  return collected as unknown as Trace
}

/** Reads the rig radii and camera constants off the running app, and bisects the shipped `extentToDistance` for its flat-region edge. */
async function readRigConstants(page: Page): Promise<RigConstants> {
  // Passed as source text rather than as a function: a real `import()` inside a
  // transpiled callback body is rewritten by the test runner's own loader into
  // a helper that does not exist in the page. A string reaches the browser
  // untransformed. (`scripts/measure-framing.ts` reads these the same way, and
  // for the same reason.)
  const measured = await page.evaluate(`(async () => {
    const rig = await import('/src/presentation/SkinnedFighter.ts')
    const view = await import('/src/presentation/ArenaView.ts')
    const cameraModule = await import('/src/presentation/ArenaCamera.ts')
    const models = await rig.loadFighterModels()
    const radii = {}
    for (const archetype of ['heavy', 'fast', 'technical']) {
      const fighter = rig.createSkinnedFighter(models, archetype)
      radii[archetype] = fighter.horizontalEquipmentRadius
      fighter.dispose()
    }
    // Bisect for the largest extent still framed at exactly FLAT_DISTANCE. The
    // eased branch is a smoothstep, so it leaves the flat value with zero
    // derivative -- but it leaves it, and double precision resolves the
    // crossing to ~1e-7 of extent, two orders of magnitude tighter than the
    // tolerance the caller compares against.
    const flat = cameraModule.FLAT_DISTANCE
    const isFlat = (extent) => cameraModule.extentToDistance(extent, flat, 18) <= flat
    let low = 0
    let high = 64
    for (let step = 0; step < 200; step += 1) {
      const mid = (low + high) / 2
      if (isFlat(mid)) low = mid
      else high = mid
    }
    return {
      radii,
      cameraElevationRatio: view.CAMERA_ELEVATION_RATIO,
      cameraFovDegrees: view.CAMERA_FOV_DEGREES,
      flatDistance: flat,
      flatRegionEdgeExtent: low,
    }
  })()`)
  return measured as RigConstants
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

/** This pairing's tactical band, in the group extent the camera's distance mapping consumes. */
function tacticalBandExtent(archetypes: readonly Archetype[], radii: Record<Archetype, number>): { low: number; high: number } {
  const margin = EQUIPMENT_MARGIN * (radii[archetypes[0]] + radii[archetypes[1]])
  return { low: BAND_SEPARATION_LOW + margin, high: BAND_SEPARATION_HIGH + margin }
}

/** Nearest-rank quantile on an ASCENDING array, so every figure reported is a value some tick actually produced. */
function percentile(ascending: readonly number[], q: number): number {
  if (ascending.length === 0) return Number.NaN
  const rank = Math.max(1, Math.ceil(q * ascending.length))
  return ascending[Math.min(rank, ascending.length) - 1]
}

function median(values: readonly number[]): number {
  return percentile([...values].sort((a, b) => a - b), 0.5)
}

/**
 * The boxes the AMENDED safe area is asserted on: a polearm carrier drops the
 * `'weapon'` slot (`boundsPxWithoutWeapon`), everyone else keeps everything
 * (`fullBoundsPx`).
 *
 * This is the weapon-excluded snapshot variant the amendment calls for, applied
 * only where the amendment allows it. `boundsPxWithoutWeapon` alone would be
 * too permissive -- the murmillo's gladius carries the same `'weapon'` slot
 * tag as the polearms, and the ruling exempts the spear shaft and the trident, not
 * every blade. Task 5 measured that the two variants happen to bind at the same
 * distance today (the binding frame is retiarius vs hoplomachus, which carries
 * no gladius at all); asserting the narrower one means that stays a measured
 * coincidence rather than a load-bearing one.
 */
function amendedSafeAreaBoxes(sample: Sample, archetypes: readonly Archetype[]): BoundsPx[] {
  return sample.fullBoundsPx.map((box, index) =>
    POLEARM_ARCHETYPES.has(archetypes[index]) ? sample.boundsPxWithoutWeapon[index] : box,
  )
}

/** The smallest gap in px between any of `boxes` and the canvas's 5% inset. Negative is a violation. */
function insetMarginPx(boxes: readonly BoundsPx[], canvas: { width: number; height: number }): number {
  const left = SAFE_INSET * canvas.width
  const right = (1 - SAFE_INSET) * canvas.width
  const top = SAFE_INSET * canvas.height
  const bottom = (1 - SAFE_INSET) * canvas.height
  let margin = Infinity
  for (const box of boxes) {
    margin = Math.min(margin, box.minX - left, right - box.maxX, box.minY - top, bottom - box.maxY)
  }
  return margin
}

/**
 * How much of a real approach or retreat survives to the screen, as a fraction
 * of what a camera nailed at `FLAT_DISTANCE` would show.
 *
 * Numerator: the median over consecutive in-band ticks of
 * |change in on-screen root separation| / |change in world root separation|.
 * Denominator: the same quantity for a FIXED camera at `FLAT_DISTANCE`,
 * computed from the camera's own two constants with no free parameter --
 * `(canvasHeight/2)/tan(fov/2) / (distance * sqrt(1 + elevationRatio^2))`.
 * `centerPx` and `rootPositions` report the same pair of ground points, so the
 * two measurements pair exactly and the ratio is dimensionless.
 *
 * Inside the tactical band the shipped mapping IS flat, so a camera that frames
 * the band as designed scores ~1, and the ratio is in effect
 * `FLAT_DISTANCE / (the distance the camera actually sat at)`.
 *
 * **What that does and does not catch, stated exactly, because the denominator
 * is read off the app rather than pinned.** It catches anything that separates
 * the camera from its own flat distance INSIDE the band: the old `11` lower
 * clamp overriding the flat region (measured: 0.805), a mapping that zooms out
 * as the pair spreads, damping that never converges, a band edge that stops
 * covering the band. It does NOT catch `FLAT_DISTANCE` itself being raised --
 * the denominator moves with it and the ratio stays ~1. That regression is
 * group 1's: the 130 px floor is external to the camera and cannot follow it,
 * and a raised flat distance shrinks the body until p92 fails. Neither test is
 * a substitute for the other, and this one must not be read as covering the
 * constant it divides by.
 */
function attenuationRatio(
  inBand: readonly Sample[],
  canvas: { width: number; height: number },
  constants: RigConstants,
): { ratio: number; samples: number } {
  const focalPx = canvas.height / 2 / Math.tan((constants.cameraFovDegrees * Math.PI) / 360)
  const rangeFactor = Math.sqrt(1 + constants.cameraElevationRatio * constants.cameraElevationRatio)
  const fixedCameraPxPerWorldUnit = focalPx / (constants.flatDistance * rangeFactor)

  const ratios: number[] = []
  for (let index = 1; index < inBand.length; index += 1) {
    const previous = inBand[index - 1]
    const current = inBand[index]
    // Only consecutive ticks: the in-band filter can leave gaps where the pair
    // stepped outside the band, and a multi-tick jump is not a per-frame rate.
    if (current.tick !== previous.tick + 1) continue
    const worldStep = Math.abs(current.worldSeparation - previous.worldSeparation)
    // A tick where the pair barely moved carries no information about scale and
    // divides two roundings by each other. Same guard, same threshold, as
    // `scripts/measure-framing.ts`.
    if (worldStep <= 1e-4) continue
    const screenStep = Math.abs(current.screenSeparationPx - previous.screenSeparationPx)
    ratios.push(screenStep / worldStep / fixedCameraPxPerWorldUnit)
  }
  return { ratio: median(ratios), samples: ratios.length }
}

/** One compact measured line per geometry test: this file is an acceptance harness, and the numbers it measured are the evidence it exists to produce. */
function report(line: string): void {
  console.log(`  [legibility] ${line}`)
}

// ---------------------------------------------------------------------------
// A trace is ~1200-2700 stepped-and-rendered ticks; the default 30 s test
// timeout is for DOM tests, not for these.
// ---------------------------------------------------------------------------

const TRACE_TIMEOUT_MS = 180_000

// Deliberately NOT `test.describe.configure({ mode: 'parallel' })`. Every test
// here is independent (its own page, its own navigation, no shared state), and
// the measurements are load-independent -- `stepBattleAndCamera` charges the
// camera a fixed `CAMERA_DELTA_SECONDS` per tick rather than reading the wall
// clock -- so running them across workers is correct in principle and was
// measured: it saved ~13% of wall time (10.0 min against ~11.5), because
// Chromium's software rasterizer is already multi-threaded and eight traces
// contend for the same cores. It also stretched individual traces from ~15 s to
// ~2 min under that contention, and four safe-area traces failed on the run
// that measured it -- every one of them passing unchanged, with identical
// measured margins, when re-run without it.
//
// Those four were almost certainly timeouts (a ~2 min trace against the 180 s
// limit below leaves little room, and the same contention timed out DOM tests
// in other files at their 30 s default) -- but the failure detail was not
// captured before the next run overwrote it, so read that as inference, not as
// record. What is on record is that the measurements themselves are
// load-independent: two full runs at different worker counts and very different
// machine load printed byte-identical numbers for all 52 measured lines.

// ---------------------------------------------------------------------------
// Group 0: the band definition itself
// ---------------------------------------------------------------------------

test('pins the widest pairing\'s band edge to the camera\'s own flat region', async ({ page }) => {
  await page.goto(`/?seed=${SEED}&snapshot`)
  await page.waitForFunction(() => Boolean(window.__GLADIATOR_TEST__))
  const constants = await readRigConstants(page)

  // The flat region has to cover the tactical band for EVERY pairing, so it
  // ends at the widest pairing's upper edge -- hoplomachus vs hoplomachus,
  // the widest equipment radius twice over. If this identity breaks, "in band"
  // in this file has stopped meaning "inside the camera's flat region", and
  // every floor and attenuation number below is being read over the wrong
  // population.
  const widest = Math.max(constants.radii.heavy, constants.radii.fast, constants.radii.technical)
  const widestBandHigh = BAND_SEPARATION_HIGH + EQUIPMENT_MARGIN * 2 * widest
  // Three decimals, not exact equality, and the residual is understood rather
  // than absorbed: `ArenaCamera` states the widest radius as a literal
  // (`WIDEST_EQUIPMENT_RADIUS`, refreshed for Task 7's skinned-model rig to
  // `1.8127755462598738` -- previously the four-decimal `1.3511` against a rig
  // measuring `1.3511202...`), so any residual against the live measurement
  // here is rounding, not drift. Measured, and stable: anything larger than
  // half a thousandth means a real constant moved, not a rounding.
  expect(constants.flatRegionEdgeExtent).toBeCloseTo(widestBandHigh, 3)
  report(
    `band edge: widest pairing ${widestBandHigh.toFixed(5)}, camera flat region ends at ${constants.flatRegionEdgeExtent.toFixed(5)} ` +
      `(flat distance ${constants.flatDistance})`,
  )
})

// ---------------------------------------------------------------------------
// Group 1: the scale floor, at 1280x820, at the frozen percentile
// ---------------------------------------------------------------------------

test.describe(`scale floor at ${FLOOR_VIEWPORT.width}x${FLOOR_VIEWPORT.height}`, () => {
  test.use({ viewport: FLOOR_VIEWPORT })

  for (const pairing of PAIRINGS) {
    test(`body height clears ${MIN_BODY_HEIGHT_PX} px at p${Math.round(BODY_FLOOR_PERCENTILE * 100)} of in-band ticks -- ${pairing.label}`, async ({ page }) => {
      test.setTimeout(TRACE_TIMEOUT_MS)
      await startBout(page, pairing)
      const constants = await readRigConstants(page)
      const trace = await collectPerTick(page, MAX_BOUT_TICKS)
      expect(trace.completed, `${pairing.label}: the bout should have ended inside ${MAX_BOUT_TICKS} ticks`).toBe(true)

      const band = tacticalBandExtent(trace.archetypes, constants.radii)
      const inBand = trace.samples.filter((sample) => sample.groupExtent >= band.low && sample.groupExtent <= band.high)
      expect(inBand.length, `${pairing.label}: too few in-band ticks for a percentile to mean anything`).toBeGreaterThan(MIN_IN_BAND_TICKS)

      // The smaller of the two fighters on each tick: the frame has to read for
      // BOTH of them, so a tick is only as legible as its worse silhouette.
      const perTick = inBand.map((sample) => Math.min(sample.bodyHeightPx[0], sample.bodyHeightPx[1])).sort((a, b) => a - b)
      const atPercentile = percentile(perTick, BODY_FLOOR_PERCENTILE)
      const belowFloor = perTick.filter((value) => value < MIN_BODY_HEIGHT_PX).length

      report(
        `floor ${pairing.label} (${TYPE_NAME[trace.archetypes[0]]} vs ${TYPE_NAME[trace.archetypes[1]]}): ` +
          `p${Math.round(BODY_FLOOR_PERCENTILE * 100)} ${atPercentile.toFixed(2)} px ` +
          `(${(((atPercentile - MIN_BODY_HEIGHT_PX) / MIN_BODY_HEIGHT_PX) * 100).toFixed(2)}%), ` +
          `median ${percentile(perTick, 0.5).toFixed(1)}, min ${perTick[0].toFixed(1)}, ` +
          `${((belowFloor / perTick.length) * 100).toFixed(1)}% below floor, ${perTick.length} in-band ticks`,
      )

      // THE AMENDED CRITERION. Ticks below 130 px are expected here (29.9% of
      // them, measured) and are not a failure: the floor is asserted at the
      // frozen percentile, not on every tick.
      expect(
        atPercentile,
        `${pairing.label}: body height at p${Math.round(BODY_FLOOR_PERCENTILE * 100)} of ${perTick.length} in-band ticks`,
      ).toBeGreaterThanOrEqual(MIN_BODY_HEIGHT_PX)
    })
  }
})

// ---------------------------------------------------------------------------
// Group 2: the safe area, every tick, all nine pairings, all three viewports
// ---------------------------------------------------------------------------

for (const viewport of VIEWPORTS) {
  test.describe(`safe area at ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport })

    for (const pairing of PAIRINGS) {
      test(`nothing but a polearm leaves the ${SAFE_INSET * 100}% canvas inset -- ${pairing.label}`, async ({ page }) => {
        test.setTimeout(TRACE_TIMEOUT_MS)
        await startBout(page, pairing)
        const trace = await collectPerTick(page, MAX_BOUT_TICKS)
        expect(trace.completed, `${pairing.label}: the bout should have ended inside ${MAX_BOUT_TICKS} ticks`).toBe(true)
        expect(trace.samples.length, `${pairing.label}: an empty trace cannot show a safe area`).toBeGreaterThan(MIN_IN_BAND_TICKS)

        // The inset is of the CANVAS, never of the viewport -- the arena is one
        // cell of a page that also carries HP cards and a battle feed, and at
        // 820x640 the canvas is even WIDER than at 1024x768 while being much
        // shorter. A viewport-based inset would be a different rectangle
        // entirely, and a much easier one.
        const canvas = trace.canvas
        let tightest = Infinity
        let tightestTick = -1
        let violations = 0
        let nonFinite = 0
        for (const sample of trace.samples) {
          const margin = insetMarginPx(amendedSafeAreaBoxes(sample, trace.archetypes), canvas)
          // `NaN` is a violation, not a skip. `insetMarginPx` propagates a
          // non-finite bound (a point behind the camera, a degenerate box)
          // straight through `Math.min`, and BOTH comparisons below are false
          // for `NaN` -- so counting only `margin < 0` would drop those ticks
          // out of the measurement silently, and a trace where every tick was
          // non-finite would leave `tightest` at `Infinity` and pass all four
          // assertions having measured nothing.
          if (!Number.isFinite(margin)) {
            nonFinite += 1
            violations += 1
          } else if (margin < 0) {
            violations += 1
          }
          if (margin < tightest) {
            tightest = margin
            tightestTick = sample.tick
          }
        }

        report(
          `safe area ${viewport.width}x${viewport.height} ${pairing.label}: ${violations} violation ticks` +
            `${nonFinite > 0 ? ` (${nonFinite} non-finite)` : ''}, ` +
            `tightest ${tightest.toFixed(2)} px at tick ${tightestTick}, canvas ${canvas.width}x${canvas.height}, ${trace.samples.length} ticks`,
        )

        expect(
          violations,
          `${pairing.label} at ${viewport.width}x${viewport.height}: ticks with anything but a polearm outside the ${SAFE_INSET * 100}% canvas inset (${nonFinite} of them non-finite)`,
        ).toBe(0)
        // Belt and braces on the same population, and not a restatement: this
        // one fails on `Infinity` -- the value `tightest` still holds if the
        // loop never saw a finite margin at all.
        expect(
          tightest,
          `${pairing.label} at ${viewport.width}x${viewport.height}: tightest inset margin, at tick ${tightestTick} on a ${canvas.width}x${canvas.height} canvas`,
        ).toBeLessThan(Number.POSITIVE_INFINITY)
        expect(tightest).toBeGreaterThanOrEqual(0)
      })
    }
  })
}

// ---------------------------------------------------------------------------
// Group 3: screen separation tracks world separation inside the band
// ---------------------------------------------------------------------------

test.describe(`screen separation at ${FLOOR_VIEWPORT.width}x${FLOOR_VIEWPORT.height}`, () => {
  test.use({ viewport: FLOOR_VIEWPORT })

  for (const pairing of PAIRINGS) {
    test(`spacing changes occupy real screen distance inside the band -- ${pairing.label}`, async ({ page }) => {
      test.setTimeout(TRACE_TIMEOUT_MS)
      await startBout(page, pairing)
      const constants = await readRigConstants(page)
      const trace = await collectPerTick(page, MAX_BOUT_TICKS)
      expect(trace.completed, `${pairing.label}: the bout should have ended inside ${MAX_BOUT_TICKS} ticks`).toBe(true)

      const band = tacticalBandExtent(trace.archetypes, constants.radii)
      const inBand = trace.samples.filter((sample) => sample.groupExtent >= band.low && sample.groupExtent <= band.high)
      expect(inBand.length, `${pairing.label}: too few in-band ticks to measure a rate over`).toBeGreaterThan(MIN_IN_BAND_TICKS)

      const { ratio, samples } = attenuationRatio(inBand, trace.canvas, constants)
      expect(samples, `${pairing.label}: too few moving in-band ticks to take a median over`).toBeGreaterThan(MIN_IN_BAND_TICKS)

      report(
        `separation ${pairing.label}: ratio ${ratio.toFixed(4)} of the fixed-camera projection ` +
          `(floor ${MIN_ATTENUATION_RATIO}), over ${samples} moving in-band ticks`,
      )

      expect(
        ratio,
        `${pairing.label}: median in-band |d(screen px)|/|d(world unit)| over a camera fixed at ${constants.flatDistance}`,
      ).toBeGreaterThan(MIN_ATTENUATION_RATIO)
    })
  }
})

// ---------------------------------------------------------------------------
// Group 4: the vocabulary, on every phase a player can reach
// ---------------------------------------------------------------------------

/**
 * The three internal mechanics ids. `\b`-bounded and case-insensitive, for two
 * reasons that pull the same way:
 *
 *   - several of these surfaces are styled `text-transform: uppercase`, and
 *     `innerText` reports text as RENDERED, so a type label reads `RETIARIUS`
 *     rather than `Retiarius`. A case-sensitive `not.toContain('Heavy')` could
 *     therefore never fire on an uppercased surface -- it would pass while the
 *     screen said `HEAVY`;
 *   - no rendered string in this UI contains any of these words in any case
 *     (swept across every presentation module; the only hits are `archetype:
 *     'heavy'` data fields and code comments, neither of which is text).
 *
 * So the case-insensitive form is strictly the stronger assertion here.
 */
const MECHANICS_IDS = ['Heavy', 'Fast', 'Technical'] as const

const TYPE_NAMES_PATTERN = /Murmillo|Hoplomachus|Retiarius/i

/**
 * Every surface, per phase, that presents a gladiator to the player -- and
 * therefore every surface acceptance #1 ("every fighter is named by type")
 * governs. `expectPhaseNamesTypes` asserts the type name on EACH element each
 * selector matches, not once across the page.
 *
 * The weaker form this replaces (one `/Murmillo|.../` match anywhere in
 * `body.innerText`) was green-lighting partial coverage by construction: the
 * planning screen alone renders eight type labels, so any one of them carried
 * the whole assertion and a surface that named nobody could not be seen. It
 * was in fact hiding two of them -- the between-bouts forfeit result line
 * ("forfeited, no fighter available", naming neither man nor type) and the
 * `Next:` preview's empty-paragraph path -- both found by review rather than
 * by this test, which is what a per-page assertion buys you.
 *
 * Selectors, not text: each of these is the exact element the corresponding
 * builder emits, so a phase that stops rendering one fails on the count check
 * rather than passing because a neighbour still carries a type name.
 */
const TYPE_BEARING_SURFACES: Readonly<Record<string, readonly string[]>> = {
  // Roster cards and the three challenge cards. `SeasonView.buildRosterCard` /
  // `buildChallengeCard`.
  'season-board': ['[data-testid="season-roster-card"]', '[data-testid="season-challenge-card"]'],
  // Every home gladiator card (fit and unavailable alike) and every opponent
  // slot. `SeriesView.buildFighterOption` / `buildUnavailableFighterCard` /
  // `buildMatchupSlot`.
  planning: ['[data-role="home-fighter"], [data-role="unavailable-fighter"]', '[data-role="opponent-slot"]'],
  // Both live fighter cards. `SeriesView.buildFighterCard`.
  fighting: ['[data-testid="active-home"]', '[data-testid="active-away"]'],
  // The bout that just ended AND the one coming next -- the two lines that are
  // the whole of this phase's vocabulary, since it shows no fighter cards.
  'between-bouts': ['[data-testid="bout-result-summary"]', '[data-testid="next-matchup"]'],
  // All three bout rows. `SeriesView.buildSummaryBout`.
  'series-summary': ['[data-testid="bout-result"]'],
  // All nine bout rows and every roster row. `SeasonView.buildOutcomeRow` and
  // `renderSummary`'s roster block.
  'season-summary': ['[data-testid="season-summary-bout"]', '.season-summary__roster-row'],
}

async function expectPhaseNamesTypes(page: Page, phase: string): Promise<void> {
  const text = await page.locator('body').innerText()
  for (const id of MECHANICS_IDS) {
    expect(text, `${phase}: should not leak the internal archetype id "${id}"`).not.toMatch(new RegExp(`\\b${id}\\b`, 'i'))
  }

  const selectors = TYPE_BEARING_SURFACES[phase]
  expect(selectors, `${phase}: has no declared type-bearing surfaces -- add them rather than skipping the phase`).toBeDefined()
  let surfaces = 0
  for (const selector of selectors) {
    const elements = page.locator(selector)
    const count = await elements.count()
    // Non-vacuity first: an empty locator would pass a `for` loop silently, and
    // a renamed testid is exactly how this whole check would stop meaning
    // anything without failing.
    expect(count, `${phase}: expected at least one \`${selector}\` on screen`).toBeGreaterThan(0)
    for (let index = 0; index < count; index += 1) {
      const surface = await elements.nth(index).innerText()
      expect(
        surface,
        `${phase}: \`${selector}\` #${index + 1} of ${count} presents a gladiator without naming his type -- ${JSON.stringify(surface)}`,
      ).toMatch(TYPE_NAMES_PATTERN)
      surfaces += 1
    }
  }
  report(`naming ${phase}: ${surfaces} fighter-bearing surface(s), each naming a type; leaks no mechanics id`)
}

test('every phase names gladiators by type and no phase names a mechanics id', async ({ page }) => {
  test.setTimeout(TRACE_TIMEOUT_MS)
  await page.goto(`/?seed=${SEED}&snapshot`)
  await page.waitForFunction(() => Boolean(window.__GLADIATOR_TEST__))

  // 1. season-board -- where the app boots.
  await expect(page.getByTestId('season-board')).toBeVisible()
  await expectPhaseNamesTypes(page, 'season-board')

  // 2. planning.
  await page.evaluate(() => window.__GLADIATOR_TEST__.startNextSeries())
  expect(await seriesPhase(page)).toBe('planning')
  await expectPhaseNamesTypes(page, 'planning')

  // 3. fighting.
  await page.evaluate(() => {
    const api = window.__GLADIATOR_TEST__
    ;['brutus', 'aquila', 'nerva'].forEach((fighterId, slot) => api.assign(fighterId, slot as BoutIndex))
    api.confirm()
    api.advanceTicks(120)
  })
  expect(await seriesPhase(page)).toBe('fighting')
  await expectPhaseNamesTypes(page, 'fighting')

  // 4. between-bouts -- bout 0 run out.
  await page.evaluate(() => {
    const api = window.__GLADIATOR_TEST__
    while (api.getActiveSeriesState()!.phase === 'fighting') api.advanceTicks(240)
  })
  expect(await seriesPhase(page)).toBe('between-bouts')
  await expectPhaseNamesTypes(page, 'between-bouts')

  // 5. series-summary -- the remaining bouts run out.
  await playOutSeries(page)
  expect(await seriesPhase(page)).toBe('summary')
  await expectPhaseNamesTypes(page, 'series-summary')

  // 6. season-summary -- the remaining two series played and closed out.
  await page.evaluate(() => window.__GLADIATOR_TEST__.continueSeason())
  for (const lineup of [
    ['vitus', 'sura', 'brutus'],
    ['aquila', 'nerva', 'vitus'],
  ]) {
    await page.evaluate((names) => {
      const api = window.__GLADIATOR_TEST__
      api.startNextSeries()
      names.forEach((fighterId, slot) => api.assign(fighterId, slot as BoutIndex))
      api.confirm()
    }, lineup)
    await playOutSeries(page)
    await page.evaluate(() => window.__GLADIATOR_TEST__.continueSeason())
  }
  const season = await page.evaluate(() => window.__GLADIATOR_TEST__.getSeasonState().phase)
  expect(season).toBe('season-summary')
  await expect(page.getByTestId('season-summary')).toBeVisible()
  await expectPhaseNamesTypes(page, 'season-summary')
})

function seriesPhase(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__GLADIATOR_TEST__.getActiveSeriesState()?.phase ?? null)
}

/**
 * Runs the open series out to its own summary. Bounded rather than `for (;;)`:
 * a series is three bouts, so it can stop in `between-bouts` at most twice, and
 * a fourth pass is already slack -- an unbounded loop would turn a series that
 * stops progressing into a bare test timeout with nothing said about why. (Same
 * shape, and the same reasoning, as `tests/season.spec.ts`'s `playSeries`.)
 */
async function playOutSeries(page: Page): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    const phase = await page.evaluate(() => {
      const api = window.__GLADIATOR_TEST__
      while (api.getActiveSeriesState()!.phase === 'fighting') api.advanceTicks(240)
      const current = api.getActiveSeriesState()!.phase
      if (current === 'between-bouts') api.startNextBout()
      return current
    })
    if (phase !== 'between-bouts') break
    expect(attempt, `series stuck in 'between-bouts' after ${attempt} startNextBout() calls`).toBeLessThan(4)
  }
}
