// Framing measurement harness (readable-gladiator-types, Task 5).
//
//   npx vite-node scripts/measure-framing.ts
//   npx vite-node scripts/measure-framing.ts -- --only=3      # one pairing
//   npx vite-node scripts/measure-framing.ts -- --width=1280  # one viewport
//
// This script measures; it changes nothing and asserts nothing. It exists
// because the camera constants Task 6 has to choose cannot be written from a
// desk, and because they have to be measured against the FINAL rig: each
// fighter's `horizontalEquipmentRadius` is the camera's own input, so a
// measurement taken before the silhouettes were re-drawn would describe a
// camera that is not going to ship.
//
// What it drives, and why in this exact shape:
//
//   - All nine ordered style pairings of the seeded series (seed 20260815),
//     three viewport sizes each, under `?snapshot` so the runtime is paused
//     and nothing advances except what this script asks for.
//   - `stepBattleAndCamera(1, 1/60)` per tick: one simulation tick, one
//     camera update charged exactly one frame of damping, one render. The
//     ordinary `advanceTicks` runs every tick and then renders once, while
//     camera damping is wall-clock -- under it, "the framing at tick N" is
//     whatever the camera reached in however long the burst took, which is
//     not a quantity a player ever sees.
//   - Exactly one `getArenaDebugSnapshot()` per step, in the same synchronous
//     `page.evaluate` callback as the step itself. `main.ts`'s own
//     `requestAnimationFrame` loop keeps re-rendering in the background even
//     while paused (at its own alpha, pegged to 0), so a step and a read in
//     two separate round-trips can observe two different frames. A single
//     synchronous callback cannot be interleaved with an animation frame.
//   - `groupExtent` comes from the snapshot, i.e. from `ArenaCamera`'s own
//     exported `measuredExtent` at the camera's own yaw -- never recomputed
//     here from positions and radii, which would drop the yaw projection and
//     the 10% per-target equipment margin and so measure a quantity
//     `extentToDistance` never sees.
//
// It drives a Vite *dev* server (like `tests/global-setup.ts` and
// `scripts/record-review-clips.ts`) because the `window.__GLADIATOR_TEST__`
// surface it uses is stripped from production builds by design.

import { resolve } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { createServer } from 'vite'

const PORT = 4176 // not 4173 (`npm run test:e2e`) and not 4174 (`npm run review:clips`)

/** The three viewports the slice's safe-area rule is stated at. */
const VIEWPORTS = [
  { width: 1280, height: 820 },
  { width: 1024, height: 768 },
  { width: 820, height: 640 },
] as const

/** One frame of `x1` playback -- what the camera is charged per simulation tick. */
const CAMERA_DELTA_SECONDS = 1 / 60

/** A bout runs 1200-2700 ticks; this is the ceiling before the harness gives up on one. */
const MAX_BOUT_TICKS = 4000

/**
 * The slice's safe area: each fighter's full AABB, every prop included, stays
 * inside a 5% inset of the CANVAS (never of the viewport -- the arena is one
 * cell of a page that also carries HP cards and a battle feed, so the two are
 * very different rectangles).
 */
const SAFE_AREA_INSET = 0.05

/** The pre-committed on-screen body-height floor, asserted at 1280x820 only, on in-band ticks only. */
const BODY_HEIGHT_FLOOR_PX = 130

/**
 * The tactical band, in *pair separation* (world units): from the closest
 * legal contact to the longest authored attack reach (design spec,
 * "Terminology"). Converted to group extent per pairing by adding both
 * fighters' equipment radii with the camera's own 10% margin -- which is what
 * `extentToDistance` actually consumes.
 */
const BAND_SEPARATION_LOW = 0.9
const BAND_SEPARATION_HIGH = 3.1
const EQUIPMENT_MARGIN = 1.1

// ---------------------------------------------------------------------------
// The nine pairings (identical construction to `scripts/record-review-clips.ts`)
// ---------------------------------------------------------------------------

const LINEUPS: readonly (readonly [string, string, string])[] = [
  ['brutus', 'aquila', 'nerva'],
  ['aquila', 'nerva', 'brutus'],
  ['nerva', 'brutus', 'aquila'],
]
const OPPONENT_BY_SLOT = ['drusus', 'cassius', 'magnus'] as const

type Archetype = 'heavy' | 'fast' | 'technical'

/** Player-facing type names (Task 2), used in the printed tables so the numbers read in the vocabulary the slice ships. */
const TYPE_NAME: Readonly<Record<Archetype, string>> = {
  heavy: 'murmillo',
  fast: 'retiarius',
  technical: 'hoplomachus',
}

interface Pairing {
  index: number
  homeId: string
  opponentId: string
  slot: 0 | 1 | 2
  lineup: readonly [string, string, string]
}

function buildPairings(): Pairing[] {
  const pairings: Pairing[] = []
  for (const homeId of ['brutus', 'aquila', 'nerva']) {
    for (const slot of [0, 1, 2] as const) {
      const lineup = LINEUPS.find((candidate) => candidate[slot] === homeId)
      if (!lineup) throw new Error(`No lineup puts ${homeId} in slot ${slot}`)
      pairings.push({ index: pairings.length + 1, homeId, opponentId: OPPONENT_BY_SLOT[slot], slot, lineup })
    }
  }
  return pairings
}

// ---------------------------------------------------------------------------
// The dev-only surface this script drives, narrowed to what it uses.
//
// Declared locally rather than merged into `main.ts`'s own `Window`
// declaration: `scripts/` is outside the tsconfig program, and a second
// global merge would clash with the real one anyway.
// ---------------------------------------------------------------------------

interface BoundsPx {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface DebugSnapshot {
  camera: { lookTargetX: number; lookTargetZ: number; distance: number; yaw: number }
  groupExtent: number
  rootPositions: Record<string, { x: number; z: number }>
  bodyHeightPx: Record<string, number>
  fullBoundsPx: Record<string, BoundsPx>
  boundsPxWithoutWeapon: Record<string, BoundsPx>
  centerPx: Record<string, { x: number; y: number }>
  canvasPx: { width: number; height: number }
}

interface TestApi {
  getActiveSeriesState: () => {
    phase: string
    activeBattle?: { encounter: { tick: number; combatantIds: string[]; combatants: Record<string, { definition: { archetype: Archetype; name: string } }> } }
  } | null
  getRenderDebugState: () => { currentTick: number | null }
  startNextSeries: () => unknown
  assign: (fighterId: string, slot: number) => unknown
  confirm: () => unknown
  advanceTicks: (ticks: number) => void
  stepBattleAndCamera: (ticks: number, dtSeconds: number) => void
  startNextBout: () => unknown
  getArenaDebugSnapshot: () => DebugSnapshot | null
}

// ---------------------------------------------------------------------------
// Per-tick record
// ---------------------------------------------------------------------------

interface RawSample {
  tick: number
  groupExtent: number
  distance: number
  yaw: number
  ids: [string, string]
  bodyHeightPx: [number, number]
  fullBoundsPx: [BoundsPx, BoundsPx]
  boundsPxWithoutWeapon: [BoundsPx, BoundsPx]
  centerPx: [{ x: number; y: number }, { x: number; y: number }]
  worldSeparation: number
  screenSeparationPx: number
}

interface BoutTrace {
  canvas: { width: number; height: number }
  archetypes: [Archetype, Archetype]
  names: [string, string]
  samples: RawSample[]
}

// ---------------------------------------------------------------------------
// Browser driving
// ---------------------------------------------------------------------------

async function openSeries(context: BrowserContext, seed: number, lineup: readonly [string, string, string]): Promise<Page> {
  const page = await context.newPage()
  await page.goto(`http://127.0.0.1:${PORT}/?seed=${seed}&snapshot`)
  await page.waitForFunction(() => Boolean((window as unknown as { __GLADIATOR_TEST__?: unknown }).__GLADIATOR_TEST__))
  await page.evaluate((assignments) => {
    const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    test.startNextSeries()
    assignments.forEach((fighterId, slot) => test.assign(fighterId, slot))
    test.confirm()
  }, [...lineup])
  return page
}

/** Runs the bouts before `slot` to completion instantly -- they are not the pairing being measured. */
async function skipToSlot(page: Page, slot: number): Promise<void> {
  for (let index = 0; index < slot; index += 1) {
    await page.evaluate(() => {
      const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
      while (test.getActiveSeriesState()!.phase === 'fighting') test.advanceTicks(240)
      test.startNextBout()
    })
  }
}

/**
 * Waits for the arena canvas to have settled at its final CSS size.
 *
 * The canvas is sized by a `ResizeObserver` on its parent, and the renderer's
 * aspect ratio follows from that, so every pixel figure measured before it
 * settles belongs to a frame that was never shown. "Settled" is two identical
 * readings an animation frame apart, not merely non-zero: a layout can pass
 * through an intermediate width.
 */
async function waitForCanvasSize(page: Page): Promise<{ width: number; height: number }> {
  return page.evaluate(async () => {
    const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    const read = (): { width: number; height: number } => test.getArenaDebugSnapshot()!.canvasPx
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
 * Steps the active bout tick by tick, reading exactly one snapshot after each
 * step, and returns the whole trace.
 *
 * The entire bout runs inside one `page.evaluate` callback on purpose: a
 * synchronous callback cannot be interleaved with `main.ts`'s own animation
 * frame loop, which would otherwise re-render between a step and its read (at
 * its own paused-pegged alpha, i.e. one tick behind) and, on the very next
 * step, feed the camera's dead-zone references a frame the measurement never
 * observed.
 */
async function traceBout(page: Page, dtSeconds: number, maxTicks: number): Promise<BoutTrace> {
  const canvas = await waitForCanvasSize(page)
  const trace = await page.evaluate(
    ({ dt, cap }) => {
      const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
      const battle = test.getActiveSeriesState()!.activeBattle!
      // Home first, always: `combatantIds` is the encounter's own order,
      // which is not guaranteed to lead with the home fighter, and every
      // printed pairing label reads "home vs opponent".
      const ids = [...battle.encounter.combatantIds].sort((a, b) => (a.startsWith('home.') ? -1 : 0) - (b.startsWith('home.') ? -1 : 0)) as [string, string]
      const archetypes = ids.map((id) => battle.encounter.combatants[id].definition.archetype)
      const names = ids.map((id) => battle.encounter.combatants[id].definition.name)

      const samples: RawSample[] = []
      let previousTick = test.getRenderDebugState().currentTick
      for (let step = 0; step < cap; step += 1) {
        test.stepBattleAndCamera(1, dt)
        const snapshot = test.getArenaDebugSnapshot()
        const tick = test.getRenderDebugState().currentTick
        // The bout is over the moment a step no longer advances the tick:
        // `advanceSeriesTicks` returns its input untouched once the phase
        // leaves `fighting`, so this is the same boundary the runtime sees.
        if (!snapshot || tick === null || tick === previousTick) break
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
          yaw: snapshot.camera.yaw,
          ids,
          bodyHeightPx: [snapshot.bodyHeightPx[home], snapshot.bodyHeightPx[away]],
          fullBoundsPx: [snapshot.fullBoundsPx[home], snapshot.fullBoundsPx[away]],
          boundsPxWithoutWeapon: [snapshot.boundsPxWithoutWeapon[home], snapshot.boundsPxWithoutWeapon[away]],
          centerPx: [snapshot.centerPx[home], snapshot.centerPx[away]],
          worldSeparation: Math.hypot(dxWorld, dzWorld),
          screenSeparationPx: Math.hypot(dxScreen, dyScreen),
        })
      }
      return { archetypes: archetypes as [Archetype, Archetype], names: names as [string, string], samples }
    },
    { dt: dtSeconds, cap: maxTicks },
  )
  return { canvas, ...trace }
}

interface RigConstants {
  radii: Record<Archetype, number>
  /** `ArenaView.CAMERA_ELEVATION_RATIO`, from which the camera's depression is `atan(ratio)`. */
  cameraElevationRatio: number
  /** `ArenaView.CAMERA_FOV_DEGREES` -- vertical, so it scales with canvas *height* on both axes. */
  cameraFovDegrees: number
}

/** The rig/camera constants the analyses depend on, read off freshly built rigs and the live module rather than copied into this file as literals. */
async function readRigConstants(browser: Browser): Promise<RigConstants> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 820 } })
  const page = await context.newPage()
  try {
    await page.goto(`http://127.0.0.1:${PORT}/?snapshot`)
    // Passed as source text rather than as a function: this script itself runs
    // through `vite-node`, which rewrites a real `import()` in a callback body
    // into its own SSR helper -- which does not exist in the page. A string is
    // handed to the browser untransformed.
    const measured = await page.evaluate(`(async () => {
      const rig = await import('/src/presentation/ProceduralFighter.ts')
      const view = await import('/src/presentation/ArenaView.ts')
      const radii = {}
      for (const archetype of ['heavy', 'fast', 'technical']) {
        const fighter = rig.createProceduralFighter({ archetype })
        radii[archetype] = fighter.horizontalEquipmentRadius
        fighter.dispose()
      }
      return { radii, cameraElevationRatio: view.CAMERA_ELEVATION_RATIO, cameraFovDegrees: view.CAMERA_FOV_DEGREES }
    })()`)
    return measured as RigConstants
  } finally {
    await context.close()
  }
}

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

/** Nearest-rank quantile (no interpolation), so every printed figure is a value that was actually measured on some tick. */
function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return Number.NaN
  const rank = Math.max(1, Math.ceil(q * sorted.length))
  return sorted[Math.min(rank, sorted.length) - 1]
}

interface Spread {
  count: number
  min: number
  median: number
  p95: number
  max: number
}

function spread(values: readonly number[]): Spread {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    count: sorted.length,
    min: sorted.length ? sorted[0] : Number.NaN,
    median: quantile(sorted, 0.5),
    p95: quantile(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1] : Number.NaN,
  }
}

function fixed(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : '--'
}

/**
 * How far this frame could be magnified about the canvas centre before some
 * part of either fighter left the safe area.
 *
 * The camera always looks straight at the group's midpoint, so that midpoint
 * projects to the canvas centre exactly, and pulling the camera in along its
 * own view ray magnifies screen offsets from that centre by roughly the ratio
 * of the two distances. **First order, not exact.** The camera sitting at
 * `height = distance x CAMERA_ELEVATION_RATIO` looking at `y = 0` does mean
 * that scaling the distance scales the whole camera-to-look-point offset
 * vector and leaves the depression angle alone -- but that governs the look
 * point, not the points being measured. For a point offset from the look
 * point by `v`, `px = f * v_t / (R - v.u)`, so magnifying by `m` gives
 *
 *     px' / px = m * (R - v.u) / (R - m * v.u)
 *
 * which equals `m` only where `v.u = 0`, i.e. at the look point's own depth.
 * A prop tip one world unit off in depth departs by about 2% at the binding
 * tick (`R = 13.67`, `m = 1.216`). The empirical size of the whole error is
 * measured, not assumed: re-running with the camera actually placed at the
 * predicted 9.313 re-derived 9.384 (0.76% high) and 6.278 against 6.317
 * (0.6% low). Treat every distance printed from this as +/- ~1%.
 *
 * `< 1` means this frame is already outside the safe area.
 *
 * `horizontal`/`vertical` are the same quantity restricted to one axis. They
 * are reported separately because the two axes respond differently to canvas
 * size: growing the canvas height scales the projected image AND the 5%
 * vertical inset together (the perspective camera's FOV is vertical, so pixels
 * per world unit is `(height/2)/tan(fov/2)/range` on both axes), so the
 * vertical bound on distance is invariant to canvas height, while the
 * horizontal bound scales with it. Analysis 2 turns on that difference.
 */
function safeAreaHeadroom(
  bounds: readonly BoundsPx[],
  canvas: { width: number; height: number },
): { headroom: number; horizontal: number; vertical: number; edge: string; fighter: number } {
  const centreX = canvas.width / 2
  const centreY = canvas.height / 2
  const left = SAFE_AREA_INSET * canvas.width
  const right = (1 - SAFE_AREA_INSET) * canvas.width
  const top = SAFE_AREA_INSET * canvas.height
  const bottom = (1 - SAFE_AREA_INSET) * canvas.height

  let headroom = Infinity
  let horizontal = Infinity
  let vertical = Infinity
  let edge = 'none'
  let fighter = -1
  let index = 0
  const consider = (candidate: number, name: string, axis: 'h' | 'v'): void => {
    if (axis === 'h') horizontal = Math.min(horizontal, candidate)
    else vertical = Math.min(vertical, candidate)
    if (candidate < headroom) {
      headroom = candidate
      edge = name
      fighter = index
    }
  }
  for (const box of bounds) {
    if (box.minX < centreX) consider((left - centreX) / (box.minX - centreX), 'left', 'h')
    if (box.maxX > centreX) consider((right - centreX) / (box.maxX - centreX), 'right', 'h')
    if (box.minY < centreY) consider((top - centreY) / (box.minY - centreY), 'top', 'v')
    if (box.maxY > centreY) consider((bottom - centreY) / (box.maxY - centreY), 'bottom', 'v')
    index += 1
  }
  return { headroom, horizontal, vertical, edge, fighter }
}

/** How far the nearest part of either fighter sits inside the safe-area inset, in px. Negative is a violation. */
function insetMarginPx(bounds: readonly BoundsPx[], canvas: { width: number; height: number }): number {
  const left = SAFE_AREA_INSET * canvas.width
  const right = (1 - SAFE_AREA_INSET) * canvas.width
  const top = SAFE_AREA_INSET * canvas.height
  const bottom = (1 - SAFE_AREA_INSET) * canvas.height
  let margin = Infinity
  for (const box of bounds) {
    margin = Math.min(margin, box.minX - left, right - box.maxX, box.minY - top, bottom - box.maxY)
  }
  return margin
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface PairingReport {
  label: string
  viewport: { width: number; height: number }
  canvas: { width: number; height: number }
  band: { low: number; high: number }
  ticks: number
  inBandTicks: number
  extent: Spread
  bodyHeight: Spread
  bodyHeightInBand: Spread
  safeViolationTicks: number
  /** Screen separation per world unit of separation, i.e. the frame's pixels-per-unit scale, per tick. */
  pxPerWorldUnit: Spread
  /** Tick-to-tick |screen change| / |world change|: how much of a real approach/retreat survives the camera's own zoom. */
  attenuation: Spread
  /**
   * Measured pixels per world unit divided by the value predicted from the
   * camera's own two constants and this tick's own framing distance --
   * `(canvasHeight/2)/tan(fov/2) / (distance * sqrt(1 + ratio^2))`. There is
   * no free parameter in that prediction, so a median away from `1.000` means
   * the projection in `ArenaView` and the geometry assumed here disagree, and
   * every absolute pixel figure in this report would be suspect. It is the
   * only *absolute* calibration of the projection available without a second
   * renderer.
   */
  projectionCalibration: Spread
  /** Full on-screen bounds (props included), per tick, both fighters. */
  fullWidthPx: Spread
  fullHeightPx: Spread
  /** Smallest gap in px between any part of either fighter and the safe-area inset; negative is a violation. */
  minInsetMarginPx: number
  /** The largest flat framing distance that would still clear the body floor on every in-band tick, first-order. */
  floorDistanceCeiling: number
  /**
   * The same, read on the *median* in-band tick rather than the worst one --
   * i.e. the distance at which half the in-band frames clear the floor.
   * Printed alongside the strict figure because the strict one turns out to
   * be set by deep-lunge frames, where the body genuinely is not vertical and
   * a head-to-foot *vertical* span is measuring lean as much as scale.
   */
  floorDistanceCeilingMedian: number
  /** Every in-band tick's own `bodyHeight x distance / floor`, so the shortfall can be read as a distribution rather than as one worst case. */
  floorCeilingSpread: Spread
  floorCeilingValues: readonly number[]
  /** The 5th and 25th percentile of that distribution (analysis 3). */
  floorCeilingP05: number
  floorCeilingP25: number
  /** The smallest framing distance that would still keep every prop inside the safe area on every tick, first-order. */
  safeDistanceFloor: number
  /**
   * The same over the ticks a **flat region** actually governs: `extent <=
   * band.high`, which includes every tick BELOW the band's low edge as well.
   * Those are the closest-range frames, with the largest on-screen
   * silhouettes and so the tightest safe area, and they exist in the traces
   * (pairing 01's extent minimum is 2.66 against a band low of 2.94). The
   * earlier `inBand`-only version of this number was a lower bound on the
   * real constraint -- correct as a direction, wrong as a constant to hand
   * Task 6.
   */
  safeDistanceFloorFlatRegion: number
  /** The same, split by axis (analysis 2) and with weapons dropped (analysis 1). */
  safeDistanceFloorFlatRegionHorizontal: number
  safeDistanceFloorFlatRegionVertical: number
  /**
   * With the `'weapon'` slot dropped for **both** fighters -- and `buildWeapon`
   * tags every kind with that slot, so this deletes the murmillo's gladius as
   * well as the two polearms. It is therefore the *most permissive* version of
   * "let long props leave frame", and a bound rather than the option itself.
   */
  safeDistanceFloorFlatRegionWithoutWeapon: number
  /**
   * The option as actually described: the weapon dropped only for the kits
   * that carry a **polearm** (retiarius' trident, hoplomachus' spear), with the
   * murmillo's gladius still required inside the inset. Assembled here rather
   * than in the snapshot because the harness already knows each fighter's
   * archetype, so no further dev-only surface was needed for it.
   */
  safeDistanceFloorFlatRegionWithoutPolearm: number
  flatRegionTicks: number
  minBodyHeightInBand: number
  /** The single in-band tick that sets `floorDistanceCeiling`, so the finding can be re-derived by hand. */
  bindingFloorTick?: { tick: number; extent: number; distance: number; bodyHeightPx: number }
  /**
   * The single flat-region tick that sets `safeDistanceFloorFlatRegion`,
   * including whose silhouette binds and by how much its props overhang his
   * own body:
   * `fullHeightPx` far above `bodyHeightPx` means the frame is capped by
   * something the fighter is *carrying*, not by the fighter.
   */
  bindingSafeTick?: {
    tick: number
    extent: number
    distance: number
    edge: string
    headroom: number
    marginPx: number
    fighter: string
    fullHeightPx: number
    bodyHeightPx: number
  }
}

function analyse(
  label: string,
  viewport: { width: number; height: number },
  trace: BoutTrace,
  rig: RigConstants,
): PairingReport {
  const radii = rig.radii
  // Focal length in pixels: the perspective camera's FOV is vertical, so this
  // is set by canvas *height* alone and governs both axes.
  const focalPx = trace.canvas.height / 2 / Math.tan((rig.cameraFovDegrees * Math.PI) / 360)
  const rangeFactor = Math.sqrt(1 + rig.cameraElevationRatio * rig.cameraElevationRatio)
  const calibration: number[] = []
  const margin = EQUIPMENT_MARGIN * (radii[trace.archetypes[0]] + radii[trace.archetypes[1]])
  const band = { low: BAND_SEPARATION_LOW + margin, high: BAND_SEPARATION_HIGH + margin }

  const extents: number[] = []
  const bodyHeights: number[] = []
  const bodyHeightsInBand: number[] = []
  const fullWidths: number[] = []
  const fullHeights: number[] = []
  const pxPerUnit: number[] = []
  const attenuation: number[] = []
  let minInsetMargin = Infinity
  let inBandTicks = 0
  let flatRegionTicks = 0
  let safeViolationTicks = 0
  let floorDistanceCeiling = Infinity
  let safeDistanceFloor = 0
  let safeDistanceFloorFlatRegion = 0
  let safeDistanceFloorFlatRegionHorizontal = 0
  let safeDistanceFloorFlatRegionVertical = 0
  let safeDistanceFloorFlatRegionWithoutWeapon = 0
  let safeDistanceFloorFlatRegionWithoutPolearm = 0
  /** The kits whose weapon is a polearm; the murmillo's gladius is not one. */
  const POLEARM_ARCHETYPES: ReadonlySet<Archetype> = new Set<Archetype>(['fast', 'technical'])
  let minBodyHeightInBand = Infinity
  const floorCeilings: number[] = []
  let bindingFloorTick: PairingReport['bindingFloorTick']
  let bindingSafeTick: PairingReport['bindingSafeTick']

  trace.samples.forEach((sample, index) => {
    const inBand = sample.groupExtent >= band.low && sample.groupExtent <= band.high
    // A flat region across the band applies its distance to everything at or
    // below the band's upper edge, closer-than-band ticks included -- see
    // `safeDistanceFloorFlatRegion`.
    const inFlatRegion = sample.groupExtent <= band.high
    if (inFlatRegion) flatRegionTicks += 1
    extents.push(sample.groupExtent)
    bodyHeights.push(...sample.bodyHeightPx)
    if (inBand) {
      inBandTicks += 1
      bodyHeightsInBand.push(...sample.bodyHeightPx)
      const smallest = Math.min(...sample.bodyHeightPx)
      minBodyHeightInBand = Math.min(minBodyHeightInBand, smallest)
      // height_px scales as 1/distance, so the flat distance that would put
      // this tick exactly on the floor is `height * distance / floor`; the
      // smallest such value over the band is the ceiling for all of them.
      const ceiling = (smallest * sample.distance) / BODY_HEIGHT_FLOOR_PX
      floorCeilings.push(ceiling)
      if (ceiling < floorDistanceCeiling) {
        floorDistanceCeiling = ceiling
        bindingFloorTick = { tick: sample.tick, extent: sample.groupExtent, distance: sample.distance, bodyHeightPx: smallest }
      }
    }

    for (const box of sample.fullBoundsPx) {
      fullWidths.push(box.maxX - box.minX)
      fullHeights.push(box.maxY - box.minY)
    }
    const margin = insetMarginPx(sample.fullBoundsPx, trace.canvas)
    minInsetMargin = Math.min(minInsetMargin, margin)
    if (margin < 0) safeViolationTicks += 1
    const { headroom, horizontal, vertical, edge, fighter } = safeAreaHeadroom(sample.fullBoundsPx, trace.canvas)
    const required = sample.distance / headroom
    safeDistanceFloor = Math.max(safeDistanceFloor, required)
    if (inFlatRegion) {
      safeDistanceFloorFlatRegionHorizontal = Math.max(safeDistanceFloorFlatRegionHorizontal, sample.distance / horizontal)
      safeDistanceFloorFlatRegionVertical = Math.max(safeDistanceFloorFlatRegionVertical, sample.distance / vertical)
      safeDistanceFloorFlatRegionWithoutWeapon = Math.max(
        safeDistanceFloorFlatRegionWithoutWeapon,
        sample.distance / safeAreaHeadroom(sample.boundsPxWithoutWeapon, trace.canvas).headroom,
      )
      // Polearm carriers lose their weapon from the check; the murmillo keeps
      // his gladius inside the inset.
      const polearmBoxes = sample.fullBoundsPx.map((box, index) =>
        POLEARM_ARCHETYPES.has(trace.archetypes[index]) ? sample.boundsPxWithoutWeapon[index] : box,
      )
      safeDistanceFloorFlatRegionWithoutPolearm = Math.max(
        safeDistanceFloorFlatRegionWithoutPolearm,
        sample.distance / safeAreaHeadroom(polearmBoxes, trace.canvas).headroom,
      )
    }
    if (inFlatRegion && required > safeDistanceFloorFlatRegion) {
      safeDistanceFloorFlatRegion = required
      const box = sample.fullBoundsPx[fighter]
      bindingSafeTick = {
        tick: sample.tick,
        extent: sample.groupExtent,
        distance: sample.distance,
        edge,
        headroom,
        marginPx: margin,
        fighter: `${sample.ids[fighter]} (${TYPE_NAME[trace.archetypes[fighter]]})`,
        fullHeightPx: box.maxY - box.minY,
        bodyHeightPx: sample.bodyHeightPx[fighter],
      }
    }

    if (sample.worldSeparation > 1e-6) {
      const measuredPxPerUnit = sample.screenSeparationPx / sample.worldSeparation
      pxPerUnit.push(measuredPxPerUnit)
      calibration.push(measuredPxPerUnit / (focalPx / (sample.distance * rangeFactor)))
    }
    if (index > 0) {
      const previous = trace.samples[index - 1]
      const worldStep = Math.abs(sample.worldSeparation - previous.worldSeparation)
      if (worldStep > 1e-4) attenuation.push(Math.abs(sample.screenSeparationPx - previous.screenSeparationPx) / worldStep)
    }
  })

  return {
    label,
    viewport,
    canvas: trace.canvas,
    band,
    ticks: trace.samples.length,
    inBandTicks,
    extent: spread(extents),
    bodyHeight: spread(bodyHeights),
    bodyHeightInBand: spread(bodyHeightsInBand),
    safeViolationTicks,
    fullWidthPx: spread(fullWidths),
    fullHeightPx: spread(fullHeights),
    minInsetMarginPx: minInsetMargin,
    pxPerWorldUnit: spread(pxPerUnit),
    attenuation: spread(attenuation),
    projectionCalibration: spread(calibration),
    floorDistanceCeiling,
    floorDistanceCeilingMedian: spread(floorCeilings).median,
    floorCeilingSpread: spread(floorCeilings),
    floorCeilingValues: floorCeilings,
    floorCeilingP05: quantile([...floorCeilings].sort((a, b) => a - b), 0.05),
    floorCeilingP25: quantile([...floorCeilings].sort((a, b) => a - b), 0.25),
    safeDistanceFloor,
    safeDistanceFloorFlatRegion,
    safeDistanceFloorFlatRegionHorizontal,
    safeDistanceFloorFlatRegionVertical,
    safeDistanceFloorFlatRegionWithoutWeapon,
    safeDistanceFloorFlatRegionWithoutPolearm,
    flatRegionTicks,
    minBodyHeightInBand,
    bindingFloorTick,
    bindingSafeTick,
  }
}

function printPairingTable(reports: readonly PairingReport[]): void {
  const header = [
    'pairing'.padEnd(30),
    'ticks'.padStart(5),
    'band'.padStart(11),
    'extent min/med/p95/max'.padStart(28),
    'body min/med/max'.padStart(22),
    'in-band body min/med'.padStart(24),
    'full w/h med'.padStart(14),
    'inset'.padStart(7),
    'unsafe'.padStart(6),
    'px/unit'.padStart(8),
    'dScr/dWld'.padStart(10),
  ]
  console.log(header.join(' '))
  for (const report of reports) {
    console.log(
      [
        report.label.padEnd(30),
        String(report.ticks).padStart(5),
        `${fixed(report.band.low)}-${fixed(report.band.high)}`.padStart(11),
        `${fixed(report.extent.min)}/${fixed(report.extent.median)}/${fixed(report.extent.p95)}/${fixed(report.extent.max)}`.padStart(28),
        `${fixed(report.bodyHeight.min, 1)}/${fixed(report.bodyHeight.median, 1)}/${fixed(report.bodyHeight.max, 1)}`.padStart(22),
        `${fixed(report.minBodyHeightInBand, 1)}/${fixed(report.bodyHeightInBand.median, 1)} (${report.inBandTicks}t)`.padStart(24),
        `${fixed(report.fullWidthPx.median, 0)}/${fixed(report.fullHeightPx.median, 0)}`.padStart(14),
        fixed(report.minInsetMarginPx, 0).padStart(7),
        String(report.safeViolationTicks).padStart(6),
        fixed(report.pxPerWorldUnit.median, 1).padStart(8),
        fixed(report.attenuation.median, 1).padStart(10),
      ].join(' '),
    )
  }
}

function printOverall(reports: readonly PairingReport[], viewport: { width: number; height: number }): void {
  const extents = reports.flatMap((report) => [report.extent.min, report.extent.max])
  const allExtent = spread(extents)
  const bodyMin = Math.min(...reports.map((report) => report.bodyHeight.min))
  const bodyMax = Math.max(...reports.map((report) => report.bodyHeight.max))
  const inBandBodyMin = Math.min(...reports.map((report) => report.minBodyHeightInBand))
  const violations = reports.reduce((sum, report) => sum + report.safeViolationTicks, 0)
  const ticks = reports.reduce((sum, report) => sum + report.ticks, 0)
  const inBand = reports.reduce((sum, report) => sum + report.inBandTicks, 0)
  const flatRegion = reports.reduce((sum, report) => sum + report.flatRegionTicks, 0)
  const pxPerUnit = spread(reports.map((report) => report.pxPerWorldUnit.median))
  const attenuation = spread(reports.map((report) => report.attenuation.median))
  const calibration = spread(reports.map((report) => report.projectionCalibration.median))

  console.log(
    `  projection calibration (measured px/unit / predicted from fov+elevation+distance, 1.000 = exact): ` +
      `median ${fixed(calibration.median, 4)}, worst pairing ${fixed(calibration.min, 4)}..${fixed(calibration.max, 4)}`,
  )
  console.log(
    `\n  overall @ ${viewport.width}x${viewport.height}: ${ticks} ticks (${inBand} in band, ${flatRegion} in the flat region), ` +
      `extent ${fixed(allExtent.min)}..${fixed(allExtent.max)}, ` +
      `body ${fixed(bodyMin, 1)}..${fixed(bodyMax, 1)} px (in-band min ${fixed(inBandBodyMin, 1)}), ` +
      `safe-area violations ${violations}, ` +
      `px/world-unit median ${fixed(pxPerUnit.median, 1)}, ` +
      `d(screen)/d(world) median ${fixed(attenuation.median, 1)} px/unit`,
  )
}

/**
 * The whole point of the run: is there a single flat framing distance that
 * clears the body floor at 1280x820 inside the band while keeping every prop
 * inside the safe area at all three viewports?
 *
 * First-order, and labelled as such in the printed output too, because that
 * is the line a later task reads: on-screen size scales as `1/distance`, and
 * pulling the camera in magnifies screen offsets about the frame centre
 * (where the look target projects exactly). Neither is exact away from the
 * look point's own depth -- see `safeAreaHeadroom` for the algebra and for
 * the measured residual, ~0.6-1.2%. Task 6's sweep is what confirms a
 * specific candidate by replay.
 */
function printFeasibility(byViewport: ReadonlyMap<string, readonly PairingReport[]>, rig: RigConstants): void {
  const wide = byViewport.get('1280x820')
  if (!wide) {
    console.log('\n(no 1280x820 run -- the body floor is only stated there, so no feasibility verdict)')
    return
  }

  const floorCeiling = Math.min(...wide.map((report) => report.floorDistanceCeiling))
  const floorPairing = wide.find((report) => report.floorDistanceCeiling === floorCeiling)

  const bindingOver = (pick: (report: PairingReport) => number): { value: number; label: string } => {
    let value = 0
    let label = ''
    for (const [key, reports] of byViewport) {
      for (const report of reports) {
        if (pick(report) > value) {
          value = pick(report)
          label = `${key} ${report.label}`
        }
      }
    }
    return { value, label }
  }
  const safeFlat = bindingOver((report) => report.safeDistanceFloorFlatRegion)
  const safeEverywhere = bindingOver((report) => report.safeDistanceFloor)

  console.log('\n=== Is the 130 px body floor reachable? (first-order projection, measured residual ~0.6-1.2%) ===')
  console.log(`  largest flat distance that still clears ${BODY_HEIGHT_FLOOR_PX} px in band @1280x820: ${fixed(floorCeiling, 3)}  (binding: ${floorPairing?.label ?? '--'})`)
  if (floorPairing?.bindingFloorTick) {
    const at = floorPairing.bindingFloorTick
    console.log(`     at tick ${at.tick}: extent ${fixed(at.extent)}, distance ${fixed(at.distance)}, body ${fixed(at.bodyHeightPx, 1)} px -> ${fixed(at.bodyHeightPx, 1)} x ${fixed(at.distance)} / ${BODY_HEIGHT_FLOOR_PX} = ${fixed(floorCeiling, 3)}`)
  }
  const medianCeiling = Math.min(...wide.map((report) => report.floorDistanceCeilingMedian))
  console.log(`  ... the same read on each pairing's MEDIAN in-band tick instead of its worst: ${fixed(medianCeiling, 3)}`)
  console.log(
    `  smallest distance keeping every prop inside the 5% inset over the FLAT REGION (extent <= band high,` +
      ` which includes closer-than-band ticks): ${fixed(safeFlat.value, 3)}  (binding: ${safeFlat.label})`,
  )
  for (const [key, reports] of byViewport) {
    for (const report of reports) {
      if (`${key} ${report.label}` !== safeFlat.label || !report.bindingSafeTick) continue
      const at = report.bindingSafeTick
      console.log(
        `     at tick ${at.tick}: extent ${fixed(at.extent)}, distance ${fixed(at.distance)}, ${at.edge} edge, ` +
          `headroom x${fixed(at.headroom, 3)} (${fixed(at.marginPx, 0)} px of inset margin left) -> ${fixed(at.distance)} / ${fixed(at.headroom, 3)} = ${fixed(safeFlat.value, 3)}`,
      )
      console.log(
        `     bound by ${at.fighter}: full silhouette ${fixed(at.fullHeightPx, 0)} px tall against a ${fixed(at.bodyHeightPx, 0)} px body ` +
          `-- ${fixed(at.fullHeightPx - at.bodyHeightPx, 0)} px of that is what he is carrying`,
      )
    }
  }
  console.log(`  ... and over ALL ticks, i.e. if the flat distance were used out to the widest frame: ${fixed(safeEverywhere.value, 3)}  (binding: ${safeEverywhere.label})`)
  console.log('  (the FLAT REGION figure is the one Task 6 must read as its constraint on FLAT_DISTANCE;')
  console.log('   beyond the band the eased region rises toward the far clamp and is not governed by it.)')
  if (safeFlat.value <= floorCeiling) {
    console.log(`  => a flat distance exists. Search space for Task 6: [${fixed(safeFlat.value, 3)}, ${fixed(floorCeiling, 3)}]`)
  } else {
    console.log(`  => NO flat distance satisfies both. The safe area binds at ${fixed(safeFlat.value, 3)}, the floor needs <= ${fixed(floorCeiling, 3)}.`)
    console.log('     Report it as a design finding with these numbers. Do not lower the floor.')
  }
  console.log(`\n  What ${fixed(safeFlat.value, 3)} is, and is not:`)
  console.log(`   - it IS the first-order constraint that proves the floor unreachable, and it is CONSERVATIVE for that`)
  console.log('     purpose: the residual understates the gap rather than inventing it.')
  console.log(`   - it is NOT a usable flat distance. Placing the camera at exactly ${fixed(safeFlat.value, 3)} and re-measuring`)
  console.log('     re-derived 9.384 and left ONE safe-area violation tick. A shipped constant needs the margin a sweep')
  console.log('     against measured frames would give it, not this bound.')

  printOptionAnalyses(byViewport, wide, floorCeiling, safeFlat, rig)
}

/**
 * Prices four ways out of the finding above, without implementing any of
 * them and without changing a single camera constant. Every figure is a
 * consequence of the recorded traces plus the projection identity in
 * `safeAreaHeadroom`'s comment; none is a recommendation.
 */
function printOptionAnalyses(
  byViewport: ReadonlyMap<string, readonly PairingReport[]>,
  wide: readonly PairingReport[],
  floorCeiling: number,
  safeFlat: { value: number; label: string },
  rig: RigConstants,
): void {
  const bindingOver = (pick: (report: PairingReport) => number): { value: number; label: string } => {
    let value = 0
    let label = ''
    for (const [key, reports] of byViewport) {
      for (const report of reports) {
        if (pick(report) > value) {
          value = pick(report)
          label = `${key} ${report.label}`
        }
      }
    }
    return { value, label }
  }

  console.log('\n=== Options priced (numbers only -- no recommendation, nothing implemented) ===')

  // 1. Long props permitted to leave frame. Two variants, because the slot
  //    the snapshot can drop is coarser than the option as described.
  const safeNoPolearm = bindingOver((report) => report.safeDistanceFloorFlatRegionWithoutPolearm)
  const safeNoWeapon = bindingOver((report) => report.safeDistanceFloorFlatRegionWithoutWeapon)
  console.log('\n  [1] Long handheld props permitted to leave frame (everything else still inside the 5% inset):')
  console.log(`      (a) POLEARMS only -- trident and spear dropped, the murmillo's gladius still inside:`)
  console.log(`          constraint moves ${fixed(safeFlat.value, 3)} -> ${fixed(safeNoPolearm.value, 3)}  (binding: ${safeNoPolearm.label})`)
  console.log(`      (b) EVERY weapon dropped, gladius included -- the most permissive version, a bound not the option:`)
  console.log(`          constraint moves ${fixed(safeFlat.value, 3)} -> ${fixed(safeNoWeapon.value, 3)}  (binding: ${safeNoWeapon.label})`)
  for (const [name, value] of [
    ['polearms only', safeNoPolearm.value],
    ['every weapon', safeNoWeapon.value],
  ] as const) {
    if (value <= floorCeiling) {
      console.log(`      => ${name}: 130 px becomes REACHABLE. Room [${fixed(value, 3)}, ${fixed(floorCeiling, 3)}], ${fixed((floorCeiling / value - 1) * 100, 1)}% of slack.`)
    } else {
      console.log(
        `      => ${name}: still short. Floor needs <= ${fixed(floorCeiling, 3)}; safe area allows only >= ${fixed(value, 3)}, ` +
          `which is ${fixed((value / floorCeiling - 1) * 100, 1)}% further out than the floor's ceiling.`,
      )
      console.log(`         Best achievable WORST in-band body height there: ${fixed((BODY_HEIGHT_FLOOR_PX * floorCeiling) / value, 1)} px.`)
    }
  }

  // 2. A larger canvas.
  const safeVertical = bindingOver((report) => report.safeDistanceFloorFlatRegionVertical)
  const safeHorizontal = bindingOver((report) => report.safeDistanceFloorFlatRegionHorizontal)
  const canvasHeight = wide[0].canvas.height
  console.log('\n  [2] A larger canvas:')
  console.log(`      the flat-region safe constraint splits into vertical ${fixed(safeVertical.value, 3)} (${safeVertical.label})`)
  console.log(`      and horizontal ${fixed(safeHorizontal.value, 3)} (${safeHorizontal.label}).`)
  console.log('      Pixels per world unit is (canvasHeight/2)/tan(fov/2)/range on BOTH axes (the FOV is vertical), so')
  console.log('      growing canvas height scales the projected image and the 5% vertical inset together: the vertical')
  console.log('      bound is invariant to canvas height. The horizontal bound and the floor both scale linearly with it.')
  const neededHeight = (canvasHeight * safeVertical.value) / floorCeiling
  console.log(`      height needed for ${BODY_HEIGHT_FLOOR_PX} px at the vertical bound: ${canvasHeight} x ${fixed(safeVertical.value, 3)} / ${fixed(floorCeiling, 3)} = ${fixed(neededHeight, 0)} px`)
  console.log(`      = ${fixed((neededHeight / 820) * 100, 1)}% of the 820 px page (canvas is ${canvasHeight} px today, ${fixed((canvasHeight / 820) * 100, 1)}%).`)
  if (safeHorizontal.value > floorCeiling) {
    console.log(`      BUT the horizontal bound (${fixed(safeHorizontal.value, 3)}) also scales with height, exactly as the floor does,`)
    console.log(`      so it never relaxes: height alone cannot fix it while ${fixed(safeHorizontal.value, 3)} > ${fixed(floorCeiling, 3)}.`)
  } else {
    console.log(`      The horizontal bound (${fixed(safeHorizontal.value, 3)}) is inside the floor's ceiling, so height alone would do it.`)
  }

  // 3. A percentile floor.
  console.log('\n  [3] A percentile floor instead of a per-tick minimum (per pairing, @1280x820):')
  console.log(`      ${'pairing'.padEnd(30)} ${'p00(min)'.padStart(9)} ${'p05'.padStart(7)} ${'p25'.padStart(7)} ${'p50'.padStart(7)} ${'ticks'.padStart(6)}`)
  for (const report of wide) {
    console.log(
      `      ${report.label.padEnd(30)} ${fixed(report.floorCeilingSpread.min, 3).padStart(9)} ${fixed(report.floorCeilingP05, 3).padStart(7)} ` +
        `${fixed(report.floorCeilingP25, 3).padStart(7)} ${fixed(report.floorDistanceCeilingMedian, 3).padStart(7)} ${String(report.inBandTicks).padStart(6)}`,
    )
  }
  const p05 = Math.min(...wide.map((report) => report.floorCeilingP05))
  const p25 = Math.min(...wide.map((report) => report.floorCeilingP25))
  const p50 = Math.min(...wide.map((report) => report.floorDistanceCeilingMedian))
  const p00 = Math.min(...wide.map((report) => report.floorCeilingSpread.min))
  console.log(`      worst pairing's p05 ${fixed(p05, 3)}, p25 ${fixed(p25, 3)}, p50 ${fixed(p50, 3)} -- versus a safe-area limit of ${fixed(safeFlat.value, 3)}`)
  console.log('      Each percentile against the SAME reference (the safe-area limit is X% further out than it requires):')
  for (const [name, value] of [
    ['p00', p00],
    ['p05', p05],
    ['p25', p25],
    ['p50', p50],
  ] as const) {
    console.log(`        ${name} needs ${fixed(value, 3)} -- safe area is ${fixed((safeFlat.value / value - 1) * 100, 1)}% further out than that`)
  }
  console.log('      Removing pose variance up to a percentile closes this much of the total gap, and leaves the rest:')
  for (const [name, value] of [
    ['p05', p05],
    ['p25', p25],
    ['p50', p50],
  ] as const) {
    console.log(
      `        up to ${name}: closes ${fixed(((value - p00) / (safeFlat.value - p00)) * 100, 1)}% of ${fixed(safeFlat.value - p00, 3)} units, ` +
        `leaving ${fixed(safeFlat.value - value, 3)} units still unreachable`,
    )
  }
  console.log('      The split moves with the percentile chosen -- it is not a property of the system. And the remainder')
  console.log('      is a RESIDUAL, not a measured framing effect: it is what survives after pose variance is removed,')
  console.log('      and the rest of this run says it is not recoverable by moving the camera.')
  console.log(`      at the safe-area limit ${fixed(safeFlat.value, 3)}, the share of in-band ticks clearing ${BODY_HEIGHT_FLOOR_PX} px per pairing:`)
  for (const report of wide) {
    const clearing = report.floorCeilingSpread.count === 0 ? 0 : shareAtLeast(report, safeFlat.value)
    console.log(`      ${report.label.padEnd(30)} ${fixed(clearing * 100, 1).padStart(6)}%`)
  }

  // 4. Camera depression.
  const depression = Math.atan(rig.cameraElevationRatio)
  const cosine = Math.cos(depression)
  console.log('\n  [4] Camera depression:')
  console.log(
    `      CAMERA_ELEVATION_RATIO ${rig.cameraElevationRatio.toFixed(6)} -> depression atan(ratio) = ${fixed((depression * 180) / Math.PI, 2)} deg, ` +
      `cos = ${fixed(cosine, 4)}`,
  )
  console.log('      A world-vertical unit projects at cos(depression) of a ground-plane unit, so the whole body-height')
  console.log(`      measurement is already scaled by ${fixed(cosine, 4)}. Shallower pitches, as a multiplier on body height:`)
  console.log('      NB: this column is ONE-SIDED. Levelling the camera stretches every vertical on-screen extent, and the')
  console.log(`      ${fixed(safeFlat.value, 3)} tick binds on the TOP edge (a spear tip), so the safe-area limit would rise by roughly the`)
  console.log('      same factor. No individual row is a NET gain; only the conclusion is safe, and the bias is conservative.')
  for (const degrees of [30, 25, 20, 15, 10, 0]) {
    const factor = Math.cos((degrees * Math.PI) / 180) / cosine
    console.log(
      `        ${String(degrees).padStart(2)} deg (ratio ${fixed(Math.tan((degrees * Math.PI) / 180), 4)}): x${fixed(factor, 4)} ` +
        `-> floor ceiling ${fixed(floorCeiling * factor, 3)} vs an UNADJUSTED safe area ${fixed(safeFlat.value, 3)}` +
        `${floorCeiling * factor >= safeFlat.value ? '  <= would clear only if the safe area did not also move' : ''}`,
    )
  }
  console.log('      Interaction: CAMERA_ELEVATION_RATIO is exported and ProceduralFighter.test.ts derives the depression')
  console.log('      as atan(ratio) to check that no worn piece silhouettes above the head. Changing the pitch re-runs that')
  console.log('      gate against every rig, and the identity only holds while elevation stays proportional to distance.')
}

/** The share of a pairing's in-band ticks whose own floor ceiling is at least `distance`, i.e. that clear the floor when framed there. */
function shareAtLeast(report: PairingReport, distance: number): number {
  const values = report.floorCeilingValues
  if (values.length === 0) return 0
  return values.filter((value) => value >= distance).length / values.length
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface Args {
  seed: number
  only?: number
  width?: number
  maxTicks: number
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string): string | undefined => argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
  const only = get('only')
  const width = get('width')
  return {
    seed: Number(get('seed') ?? 20260815),
    only: only === undefined ? undefined : Number(only),
    width: width === undefined ? undefined : Number(width),
    maxTicks: Number(get('max-ticks') ?? MAX_BOUT_TICKS),
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const server = await createServer({
    root: resolve('.'),
    server: { host: '127.0.0.1', port: PORT, strictPort: true },
  })
  await server.listen()
  const browser = await chromium.launch()
  const startedAt = Date.now()

  try {
    const rig = await readRigConstants(browser)
    const radii = rig.radii
    console.log(`seed ${args.seed}, camera delta ${CAMERA_DELTA_SECONDS.toFixed(5)} s/tick, safe-area inset ${SAFE_AREA_INSET * 100}% of canvas`)
    console.log(
      `horizontalEquipmentRadius: ${(['heavy', 'fast', 'technical'] as const).map((archetype) => `${TYPE_NAME[archetype]} ${radii[archetype].toFixed(4)}`).join(', ')}`,
    )

    const byViewport = new Map<string, PairingReport[]>()
    for (const viewport of VIEWPORTS) {
      if (args.width !== undefined && args.width !== viewport.width) continue
      const key = `${viewport.width}x${viewport.height}`
      const reports: PairingReport[] = []
      console.log(`\n=== viewport ${key} ===`)

      for (const pairing of buildPairings()) {
        if (args.only !== undefined && args.only !== pairing.index) continue
        const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } })
        try {
          const page = await openSeries(context, args.seed, pairing.lineup)
          await skipToSlot(page, pairing.slot)
          const trace = await traceBout(page, CAMERA_DELTA_SECONDS, args.maxTicks)
          const label = `${String(pairing.index).padStart(2, '0')} ${TYPE_NAME[trace.archetypes[0]]} vs ${TYPE_NAME[trace.archetypes[1]]}`
          reports.push(analyse(label, viewport, trace, rig))
        } finally {
          await context.close()
        }
      }

      if (reports.length === 0) continue
      console.log(`canvas ${reports[0].canvas.width}x${reports[0].canvas.height} CSS px inside the ${key} page`)
      printPairingTable(reports)
      printOverall(reports, viewport)
      byViewport.set(key, reports)
    }

    printFeasibility(byViewport, rig)
    console.log(`\ndone in ${((Date.now() - startedAt) / 1000).toFixed(1)} s`)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
