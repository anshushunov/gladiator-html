// Produces the BLINDED silhouette material the readable-gladiator-types human
// review gate is scored on -- the confusion matrix behind design spec
// acceptance #2, "each type is identifiable from its silhouette alone at the
// shipped framing", which that spec says must be *measured, not asserted*.
//
//   npm run review:stills                          # the whole set (`everything`)
//   npm run review:stills -- --config=camera-only  # the one comparison stills can make
//   npm run review:stills -- --seed=99             # a different series seed
//
// ONLY TWO OF THE FIVE REVIEW CONFIGURATIONS ARE WORTH RECORDING AS STILLS,
// and it is worth knowing why before reaching for the other three.
//
//   - `labels-only` vs `baseline`: byte-identical images. These stills carry no
//     text at all -- the HUD is hidden and the crop is canvas-only -- so the
//     naming change is invisible here by construction. Measure it with clips.
//   - `camera-only`/`everything` vs the two `camera: false` configurations:
//     not recordable. The superseded mapping frames from 11 world units instead
//     of `FLAT_DISTANCE`'s 8.81, so everything on screen is ~20% smaller and the
//     two fighters sit closer together IN PIXELS -- and `cropIsClean` below needs
//     the opponent entirely outside a fixed 280x320 pixel window. Measured: at
//     the superseded camera the sweep yields 12 usable stills out of 48 for
//     `baseline` and 23 for `silhouettes-only`, with whole (type, side) groups
//     at zero. Widening the window makes it worse, and scaling the window with
//     the framing distance would normalise away the very difference the
//     comparison is supposed to show. Measure the camera with clips too.
//
// So the stills exercise measures the SILHOUETTE change, cleanly, by comparing
// `camera-only` (superseded kits, shipped camera) against `everything` (final
// kits, shipped camera) -- the same camera in both, so the only difference is
// the one being attributed. Both fill all 48.
//
// WHAT IT PRODUCES
//
//   docs/reviews/clips/blinded-stills/<config>/README.md          reviewer instructions + scoring sheet
//   docs/reviews/clips/blinded-stills/<config>/scoring-sheet.csv  one blank row per still
//   docs/reviews/clips/blinded-stills/<config>/monochrome/*.png   THE SCORED SET
//   docs/reviews/clips/blinded-stills/<config>/greyscale/*.png    value check
//   docs/reviews/clips/blinded-stills/<config>/protanopia/*.png   colour-vision checks
//   docs/reviews/clips/blinded-stills/<config>/deuteranopia/*.png
//   docs/reviews/clips/blinded-stills/<config>/tritanopia/*.png
//
//   docs/reviews/clips/blinded-stills-answer-key/<config>/answer-key.{csv,json}
//
// The answer key is written to a SEPARATE TOP-LEVEL DIRECTORY, not into the
// stills tree. That is deliberate and is the whole point of the word
// "blinded": a reviewer is given the stills directory, opens it, and there is
// nothing in it -- no file, no filename, no sibling -- that tells them what
// they are looking at. Every still is `still-NN.png`, `NN` runs in a seeded
// shuffle of the whole set, and the shuffle is what randomises the sides as
// well as the types. Coding the answers is somebody else's job, per the design
// spec ("answers are coded by someone other than the implementer").
//
// THE SET: 8 stills per type per side at 4 yaw angles = 3 x 2 x 8 = 48 stills,
// two per yaw bin, each rendered in five variants -> 240 PNGs.
//
// PASS BAR, SET NOW AND NOT LATER: **>= 80% correct overall and >= 70% per
// type.** Written into `README.md` beside the stills at recording time so it
// cannot be adjusted after the counts are in. If the material misses the bar,
// the design spec already names the next step -- for the known worst case, the
// trident-versus-spear pair, "the net and the missing helmet are the levers,
// and the fallback is to re-open the type choice rather than to weaken the
// test".
//
// DETERMINISM. Fixed seed, fixed lineups, fixed sampling stride, fixed
// selection PRNG: re-running this writes the same 48 stills from the same 48
// ticks, so two reviewers judge identical images and a re-run after a rig
// change is a real before/after.
//
// It drives a Vite *dev* server (like `scripts/record-review-clips.ts` and
// `tests/global-setup.ts`) because the `window.__GLADIATOR_TEST__` surface it
// needs is stripped from production builds by design.

import { mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chromium, type Browser, type Page } from '@playwright/test'
import { createServer } from 'vite'

const PORT = 4175 // not 4173 (`npm run test:e2e`) and not 4174 (`review:clips`)
const VIEWPORT = { width: 1280, height: 820 } as const

/** Mirrored from `src/presentation/legibilityMode.ts`; checked against the
 * running app in `openSeries` (see `record-review-clips.ts` for why both). */
const CONFIG_NAMES = ['baseline', 'labels-only', 'camera-only', 'silhouettes-only', 'everything'] as const
type ConfigName = (typeof CONFIG_NAMES)[number]
const EXPECTED_MODES: Readonly<Record<ConfigName, { labels: boolean; camera: boolean; silhouettes: boolean }>> = {
  baseline: { labels: false, camera: false, silhouettes: false },
  'labels-only': { labels: true, camera: false, silhouettes: false },
  'camera-only': { labels: false, camera: true, silhouettes: false },
  'silhouettes-only': { labels: false, camera: false, silhouettes: true },
  everything: { labels: true, camera: true, silhouettes: true },
}

type Archetype = 'heavy' | 'fast' | 'technical'
type Side = 'home' | 'away'

/** Same three rotations `record-review-clips.ts` uses: together they put every
 * home fighter opposite every opponent exactly once. */
const LINEUPS: readonly (readonly [string, string, string])[] = [
  ['brutus', 'aquila', 'nerva'],
  ['aquila', 'nerva', 'brutus'],
  ['nerva', 'brutus', 'aquila'],
]
const HOME_STYLE: Readonly<Record<string, Archetype>> = { brutus: 'heavy', aquila: 'fast', nerva: 'technical' }
const OPPONENT_BY_SLOT: readonly { id: string; style: Archetype }[] = [
  { id: 'drusus', style: 'fast' },
  { id: 'cassius', style: 'technical' },
  { id: 'magnus', style: 'heavy' },
]

const ARCHETYPES: readonly Archetype[] = ['heavy', 'fast', 'technical']
const SIDES: readonly Side[] = ['home', 'away']

/**
 * The four yaw angles, measured as the fighter's own facing RELATIVE TO THE
 * CAMERA -- not as an absolute world heading and not as the camera's yaw. That
 * is the quantity the question is about: "can you tell the type from the
 * silhouette" depends on which way the man is turned ON SCREEN.
 *
 * THE FOUR ANGLES ARE NOT front/side/back/side, AND THAT IS A FINDING, NOT A
 * CONVENIENCE -- but state the finding at the width the evidence supports, not
 * wider. The defensible claim is: **a front or back view is unreachable in a
 * SINGLE-FIGHTER still at the shipped framing.** Two things make it so, and
 * only the first is a property of the game:
 *
 *   1. The arena camera yaws to keep the pair's own axis across the frame (the
 *      2026-08-19 legibility slice), and a gladiator always faces his opponent
 *      -- a disengaging fighter never turns his back, by the design spec's own
 *      constraint. Facing your opponent while your opponent is across the frame
 *      means being seen from the side. So profile is the overwhelming majority
 *      case by construction.
 *   2. `cropIsClean` below then removes what is left. A fighter presents his
 *      front or back exactly when the pair axis points at the camera -- which
 *      is when the two fighters overlap on screen. At roughly 80 px per world
 *      unit and ~145 px of body height, separating them by a clear 320 px band
 *      needs about 5 world units of depth between them, which a pair fighting
 *      2.5 apart never reaches. Those frames exist; they are simply not usable
 *      for a one-fighter still.
 *
 * The sweep's own numbers cannot tell the two apart, and it would be wrong to
 * read them as if they could: the 918 clean candidates measured across all nine
 * pairings at seed 20260815 fell in 60-120 degrees for every home fighter and
 * 240-300 for every away fighter, with nothing outside -- but that population is
 * post-filter, so it is equally consistent with "the game never produces those
 * facings" and with "the filter removed them". `ArenaCamera.ts`'s own header
 * (1.5% of ticks beyond 30 degrees of framing error) says the second is at
 * least partly true. The practical conclusion is unchanged either way, which is
 * why this is a note about how far the result generalises rather than a reason
 * to change the material.
 *
 * So the four angles are four QUARTILES of the deviation from pure profile,
 * cut from the sweep's own measured distribution rather than from fixed
 * degree boundaries. Fixed boundaries were tried first and are the wrong tool
 * here: quarters of +/-45 degrees left the two outer bins with 0-3 frames each
 * (the deviation is heavily concentrated near zero), and quarters of +/-25
 * still left three bins short of their quota. Quartiles are self-balancing --
 * each bin holds a quarter of everything the game produced, so the four are
 * four genuinely different views AND all four are fillable, and the edges are
 * reported in the answer key so the set is self-describing. They are real,
 * they come from real bouts at the shipped framing, and they are the only yaw
 * variation a player will ever see -- but they are tens of degrees apart, not
 * ninety. The gate document records this: a reviewer judging the confusion
 * matrix needs to know that "identifiable from its silhouette" is, in this
 * game, a claim about a PROFILE silhouette.
 *
 * The deviation is signed so that negative means "turned toward the camera"
 * for both sides: the away fighter's is mirrored, since he faces the other
 * way, and without the mirror the same bin name would mean opposite turns on
 * the two sides.
 */
const YAW_BINS = ['front-oblique', 'front-profile', 'back-profile', 'back-oblique'] as const
type YawBin = (typeof YAW_BINS)[number]

/** Two per bin x four bins = the eight stills each (type, side) contributes. */
const STILLS_PER_BIN = 2
const STILLS_PER_TYPE_PER_SIDE = YAW_BINS.length * STILLS_PER_BIN

/**
 * How many ticks pass between candidate samples. 6 is 0.1 s of fight.
 *
 * Started at 12 and halved: the fixed-window crop test rejects roughly two
 * frames in three (the pair are usually within 280 px of each other), which
 * left the thinnest group -- the away murmillo -- with 14 candidates across
 * three lineups and one of its four yaw bins holding a single frame, one short
 * of its quota. Halving the stride doubles the pool for the cost of a few
 * minutes of sweep, and the sweep is the cheap pass: it takes no screenshots.
 */
const SAMPLE_STRIDE_TICKS = 6
/** A bout runs 1200-2700 ticks; this is the ceiling before the sweep gives up. */
const MAX_BOUT_TICKS = 3600

/**
 * A candidate is only usable if the crop really contains ONE fighter. Two
 * conditions, both necessary:
 *
 *   - the fighter's own projected bounds sit fully inside the canvas with this
 *     much margin (a cropped silhouette is a different question than the one
 *     being asked), and
 *   - the other fighter's projected bounds do not intersect this fighter's
 *     CROP RECTANGLE -- disjoint in 2-D, not merely side by side.
 *
 * The 2-D part is load-bearing and was got wrong first time round. Rejecting
 * only pairs that overlap *horizontally* silently throws away every tick where
 * the pair axis points toward the camera -- which is exactly the set of ticks
 * where a fighter is seen from the front or the back. The arena camera yaws to
 * put the pair axis across the frame, so on the ticks that survive a
 * horizontal-only test both fighters are, by construction, in profile: a
 * measured sweep with that filter produced facings in 60-120 degrees for every
 * home fighter and 240-300 for every away fighter, and nothing else at all, in
 * 918 candidates. Two of the four yaw bins were structurally unreachable and
 * the filter, not the game, was the reason. Checking both axes recovers them:
 * with the camera elevated ~34 degrees, an axis-toward-camera pair separates
 * VERTICALLY on screen (the far fighter sits higher and smaller), so their
 * boxes are disjoint even though they share a column.
 */
const EDGE_MARGIN_PX = 6
/** Below this the silhouette is too small to judge at all; the shipped framing
 * holds body height around 130-160 px, and full bounds add the weapon. */
const MIN_BOUNDS_HEIGHT_PX = 90
/**
 * Every still is cropped to the SAME rectangle, centred on the fighter --
 * never shrink-wrapped to his own projected bounds.
 *
 * A per-fighter crop leaks the answer without showing it. The murmillo's
 * scutum makes him half again as wide as the retiarius, so a tight crop hands
 * a reviewer the kit's width and height as image metadata, and a careful
 * reviewer could score well from the file dimensions alone without ever
 * looking at the picture. A fixed window removes that channel completely and
 * costs nothing: the fighter is still drawn at the shipped framing's true
 * scale, so relative size is preserved as something to *see* rather than
 * something to measure.
 *
 * Sized to contain the widest kit (the hoplomachus' 1.35-unit reach, spear
 * included) at the closest framing, with room to spare.
 */
const CROP_WIDTH_PX = 280
const CROP_HEIGHT_PX = 320
/** How much clear space the fighter's own bounds must leave inside that
 * window, so nothing is clipped by the fixed size. */
const CROP_INNER_MARGIN_PX = 10

/**
 * The five renderings of every still.
 *
 * `monochrome` is the SCORED one: hue removed entirely and contrast pushed, so
 * what survives is shape and value and nothing else -- which is exactly what
 * acceptance #2 claims ("identifiable from its silhouette alone"). `greyscale`
 * is the ordinary desaturated check the design spec lists separately. The
 * three colour-vision variants are the *colour* render passed through a
 * standard dichromat simulation matrix, so they answer a different question
 * from the first two: whether the house values that separate the three types
 * survive for a colour-blind player.
 *
 * All five are produced by CSS/SVG filters over the live canvas rather than by
 * post-processing the PNGs: this repository has no image library, and doing it
 * in the compositor means the reviewer sees exactly what a player with that
 * filter in front of them would see.
 */
const VARIANTS = ['monochrome', 'greyscale', 'protanopia', 'deuteranopia', 'tritanopia'] as const
type Variant = (typeof VARIANTS)[number]

const VARIANT_CSS: Readonly<Record<Variant, string>> = {
  // Brightness before contrast, and both well above 1: the arena is a dark
  // scene (background `0x16131a`, fogged) and two of the three house colours
  // are dark, so a straight `grayscale(1) contrast(2.2)` crushed the murmillo
  // and the hoplomachus into near-black shapes on near-black ground -- shown
  // to be unreadable by looking at the first recorded set. Lifting exposure
  // first and then pushing contrast keeps the figure clear of the floor.
  monochrome: 'grayscale(1) brightness(1.9) contrast(1.5)',
  greyscale: 'grayscale(1)',
  protanopia: 'url(#cvd-protanopia)',
  deuteranopia: 'url(#cvd-deuteranopia)',
  tritanopia: 'url(#cvd-tritanopia)',
}

/** Brettel/Viénot-style dichromat simulation matrices, as `feColorMatrix`
 * rows. Standard published values; they are a simulation, not a diagnosis. */
const CVD_MATRICES: Readonly<Record<string, readonly number[]>> = {
  'cvd-protanopia': [0.567, 0.433, 0, 0.558, 0.442, 0, 0, 0.242, 0.758],
  'cvd-deuteranopia': [0.625, 0.375, 0, 0.7, 0.3, 0, 0, 0.3, 0.7],
  'cvd-tritanopia': [0.95, 0.05, 0, 0, 0.433, 0.567, 0, 0.475, 0.525],
}

function cvdFilterSvg(): string {
  const filters = Object.entries(CVD_MATRICES)
    .map(([id, m]) => {
      const values = [m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0].join(' ')
      return `<filter id="${id}" color-interpolation-filters="linearRGB"><feColorMatrix type="matrix" values="${values}"/></filter>`
    })
    .join('')
  return `<svg id="cvd-filters" xmlns="http://www.w3.org/2000/svg" width="0" height="0" style="position:absolute">${filters}</svg>`
}

/** The HUD, the battle feed and every other DOM surface: hidden throughout.
 * The crop is canvas-only, so none of it could appear anyway -- this is belt
 * and braces against a future overlay drifting over the arena, because a
 * single visible type label would invalidate the whole set.
 *
 * NOT `#battle-ui`, which is the arena's own ancestor (`index.html`): hiding it
 * hides the canvas, and the first run of this script produced 240 uniformly
 * black PNGs for exactly that reason. Each HUD card is named individually
 * instead. `.arena__status` is in the list because it is the one text node that
 * lives INSIDE the arena box and could therefore land inside a crop. */
const HIDE_EVERYTHING_BUT_ARENA_CSS = `
  .masthead, #season-ui, #series-ui, .below-arena-row, .battle-feed,
  .arena__status,
  [data-testid="active-home"], [data-testid="active-away"], [data-testid="battle-feed"] {
    visibility: hidden !important;
  }
`

// ---------------------------------------------------------------------------
// Deterministic selection
// ---------------------------------------------------------------------------

/** mulberry32: a small, fully deterministic PRNG. Used ONLY to choose among
 * equally-valid candidates and to shuffle the presentation order -- nothing it
 * returns reaches the simulation, which has its own seeded generator. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

// ---------------------------------------------------------------------------
// Browser plumbing
// ---------------------------------------------------------------------------

interface BoundsPx {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

interface ArenaSnapshot {
  rootYaw: Record<string, number>
  camera: { yaw: number }
  fullBoundsPx: Record<string, BoundsPx>
  canvasPx: { width: number; height: number }
}

interface TestApi {
  getLegibilityMode: () => { labels: boolean; camera: boolean; silhouettes: boolean }
  getActiveSeriesState: () => { phase: string } | null
  startNextSeries: () => { ok: boolean; reason?: string }
  assign: (fighterId: string, slot: number) => void
  confirm: () => void
  advanceTicks: (ticks: number) => void
  stepBattleAndCamera: (ticks: number, dtSeconds: number) => void
  startNextBout: () => void
  settleCameraSeconds: (seconds: number) => void
  getArenaDebugSnapshot: () => ArenaSnapshot | null
}

// NOTE: every `page.evaluate` below reaches for `window.__GLADIATOR_TEST__`
// inline rather than through a shared helper. Playwright serialises the
// callback and runs it in the page, so a helper defined here in Node is simply
// not in scope there -- a shared accessor fails at runtime with a
// `ReferenceError`, not at compile time.

/**
 * Blocks until the canvas has held the same non-zero CSS size for three
 * consecutive animation frames.
 *
 * Every measurement this script filters and crops on is in CANVAS pixels, and
 * `ArenaView` sizes itself from a `ResizeObserver` -- so a sample taken while
 * the canvas is still settling is measured against a different size and lands
 * on a different side of the edge-margin and crop-cleanliness tests. That is a
 * determinism leak, and determinism is the whole basis for "two reviewers judge
 * identical images".
 *
 * It has to be called after EVERY screen transition, not just after page load.
 * Confirming a lineup swaps the planning screen for the battle UI, and
 * `startNextBout` swaps the between-bouts screen back again; both relayout the
 * shell. Found the hard way, one transition at a time: waiting only after
 * `goto` left two runs of the same seed differing by 7 candidates, all in
 * lineup 1; adding the wait after `confirm()` moved the discrepancy to lineup
 * 2's later bouts. Capped at 300 frames (~5 s) so a throttled `rAF` cannot hang
 * the recorder.
 */
async function waitForStableCanvas(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((settled) => {
        let previous = ''
        let stableFrames = 0
        let frames = 0
        const check = (): void => {
          const canvas = document.querySelector('canvas')
          const current = canvas ? `${canvas.clientWidth}x${canvas.clientHeight}` : ''
          const usable = current !== '' && !current.startsWith('0x') && !current.endsWith('x0')
          stableFrames = usable && current === previous ? stableFrames + 1 : 0
          previous = current
          frames += 1
          if (stableFrames >= 3 || frames > 300) settled()
          else requestAnimationFrame(check)
        }
        requestAnimationFrame(check)
      }),
  )
}

async function openSeries(
  browser: Browser,
  seed: number,
  config: ConfigName,
  lineup: readonly [string, string, string],
): Promise<Page> {
  const context = await browser.newContext({ viewport: VIEWPORT })
  // Generous, and deliberately so: this script opens and closes six browser
  // contexts against one Vite dev server, and the default 30 s `load` timeout
  // is not reliably enough for the later ones on a loaded machine (observed:
  // lineup 1 swept fine, lineup 2's `goto` timed out at 30 s).
  context.setDefaultTimeout(120_000)
  context.setDefaultNavigationTimeout(120_000)
  const page = await context.newPage()
  // `?snapshot` holds the runtime paused, so every tick is stepped explicitly
  // and the still for tick N is the frame at tick N, not "whatever the camera
  // reached in however long setup happened to take".
  await page.goto(`http://127.0.0.1:${PORT}/?seed=${seed}&snapshot&legibility=${config}`)
  await page.waitForFunction(() => Boolean((window as unknown as { __GLADIATOR_TEST__?: unknown }).__GLADIATOR_TEST__))

  const resolved = await page.evaluate(() => (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__.getLegibilityMode())
  const expected = EXPECTED_MODES[config]
  if (resolved.labels !== expected.labels || resolved.camera !== expected.camera || resolved.silhouettes !== expected.silhouettes) {
    throw new Error(
      `The app resolved ${JSON.stringify(resolved)} for --config=${config}, expected ${JSON.stringify(expected)}. ` +
        'The configuration table here has drifted from src/presentation/legibilityMode.ts.',
    )
  }

  await page.addStyleTag({ content: HIDE_EVERYTHING_BUT_ARENA_CSS })

  await page.evaluate((markup) => document.body.insertAdjacentHTML('beforeend', markup), cvdFilterSvg())
  await page.evaluate((assignments) => {
    const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
    test.startNextSeries()
    assignments.forEach((fighterId, slot) => test.assign(fighterId, slot))
    test.confirm()
  }, [...lineup])
  await waitForStableCanvas(page)
  return page
}

// ---------------------------------------------------------------------------
// Pass 1: candidates
// ---------------------------------------------------------------------------

interface Candidate {
  lineupIndex: number
  slot: number
  tick: number
  combatantId: string
  archetype: Archetype
  side: Side
  yawBin: YawBin
  yawDegrees: number
  /** Signed deviation from pure profile; see `profileDeviation`. */
  profileDeviationDegrees: number
  bounds: BoundsPx
}

/** Signed deviation from pure profile, in degrees, mirrored for the away side
 * so negative always means "turned toward the camera". */
function profileDeviation(relativeDegrees: number, side: Side): number {
  const centre = side === 'home' ? 90 : 270
  const wrapped = ((relativeDegrees - centre + 540) % 360) - 180
  return side === 'home' ? wrapped : -wrapped
}

/**
 * The three interior quartile edges of a deviation distribution -- the
 * boundaries between the four yaw bins.
 *
 * Computed PER (type, side), not once over the whole sweep. The six groups do
 * not share a distribution: measured over 207 clean candidates, the murmillo's
 * presented facing ran -10..+4 degrees off profile while the retiarius' ran
 * -15..+12, so a single global set of edges put both murmillo groups' top bin
 * entirely above their own maximum and left it empty on both sides. Per-group
 * quartiles are self-balancing by construction: each of a fighter's four bins
 * holds a quarter of the frames that fighter was actually seen in. The bin
 * NAMES are therefore relative to that fighter's own range and are bookkeeping
 * only -- what the answer key records, and what a later analysis should use, is
 * `profile_deviation_degrees`.
 */
function yawBinEdges(candidates: readonly Candidate[]): [number, number, number] {
  const sorted = candidates.map((c) => c.profileDeviationDegrees).sort((x, y) => x - y)
  const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
  return [at(0.25), at(0.5), at(0.75)]
}

function groupKey(candidate: Pick<Candidate, 'archetype' | 'side'>): string {
  return `${candidate.archetype}/${candidate.side}`
}

/** Per-group edges, and every candidate binned against its own group's. */
function binByGroup(candidates: readonly Candidate[]): { binned: Candidate[]; edges: Record<string, [number, number, number]> } {
  const groups = new Map<string, Candidate[]>()
  for (const candidate of candidates) {
    const key = groupKey(candidate)
    groups.set(key, [...(groups.get(key) ?? []), candidate])
  }
  const edges: Record<string, [number, number, number]> = {}
  const binned: Candidate[] = []
  for (const [key, group] of groups) {
    edges[key] = yawBinEdges(group)
    for (const candidate of group) binned.push({ ...candidate, yawBin: yawBinFor(candidate.profileDeviationDegrees, edges[key]) })
  }
  return { binned, edges }
}

function yawBinFor(deviationDegrees: number, edges: readonly [number, number, number]): YawBin {
  if (deviationDegrees < edges[0]) return YAW_BINS[0]
  if (deviationDegrees < edges[1]) return YAW_BINS[1]
  if (deviationDegrees < edges[2]) return YAW_BINS[2]
  return YAW_BINS[3]
}

function boundsOk(bounds: BoundsPx, canvas: { width: number; height: number }): boolean {
  if (![bounds.minX, bounds.maxX, bounds.minY, bounds.maxY].every(Number.isFinite)) return false
  if (bounds.minX < EDGE_MARGIN_PX || bounds.minY < EDGE_MARGIN_PX) return false
  if (bounds.maxX > canvas.width - EDGE_MARGIN_PX || bounds.maxY > canvas.height - EDGE_MARGIN_PX) return false
  return bounds.maxY - bounds.minY >= MIN_BOUNDS_HEIGHT_PX
}

/** The fixed-size window centred on `target`, in canvas pixels. */
function cropRect(target: BoundsPx): { x: number; y: number; width: number; height: number } {
  const centreX = (target.minX + target.maxX) / 2
  const centreY = (target.minY + target.maxY) / 2
  return { x: centreX - CROP_WIDTH_PX / 2, y: centreY - CROP_HEIGHT_PX / 2, width: CROP_WIDTH_PX, height: CROP_HEIGHT_PX }
}

/** The fixed window contains all of `target` with margin, sits inside the
 * canvas, and contains no part of `other`. Disjointness on either axis is
 * enough -- two boxes miss each other if they miss on X OR on Y. */
function cropIsClean(target: BoundsPx, other: BoundsPx, canvas: { width: number; height: number }): boolean {
  const rect = cropRect(target)
  if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > canvas.width || rect.y + rect.height > canvas.height) return false
  if (target.minX - rect.x < CROP_INNER_MARGIN_PX || rect.x + rect.width - target.maxX < CROP_INNER_MARGIN_PX) return false
  if (target.minY - rect.y < CROP_INNER_MARGIN_PX || rect.y + rect.height - target.maxY < CROP_INNER_MARGIN_PX) return false
  return other.maxX < rect.x || other.minX > rect.x + rect.width || other.maxY < rect.y || other.minY > rect.y + rect.height
}

function archetypeOf(combatantId: string, lineup: readonly [string, string, string], slot: number): Archetype {
  const [side, fighterId] = combatantId.split('.') as [Side, string]
  if (side === 'home') {
    const style = HOME_STYLE[fighterId]
    if (!style) throw new Error(`Unknown home fighter ${fighterId} (lineup ${lineup.join(',')})`)
    return style
  }
  const opponent = OPPONENT_BY_SLOT[slot]
  if (opponent.id !== fighterId) throw new Error(`Slot ${slot} opponent is ${opponent.id}, saw ${fighterId}`)
  return opponent.style
}

async function collectCandidates(browser: Browser, seed: number, config: ConfigName): Promise<Candidate[]> {
  const candidates: Candidate[] = []

  for (const [lineupIndex, lineup] of LINEUPS.entries()) {
    const page = await openSeries(browser, seed, config, lineup)
    try {
      for (let slot = 0; slot < 3; slot += 1) {
        // THE WHOLE BOUT IN ONE `evaluate`, and that is not an optimisation.
        //
        // The app's own `requestAnimationFrame` loop keeps running while
        // `?snapshot` holds the runtime paused: it does not step the
        // simulation, but it does call `syncArena()`, which damps the camera by
        // REAL elapsed time. So every await between two `stepBattleAndCamera`
        // calls hands the camera an unrepeatable amount of wall clock, and the
        // sampled framing -- hence which frames pass the crop tests -- depends
        // on how long a Playwright round trip happened to take. Measured: two
        // runs of the same seed collected 510 and 517 candidates, and moved the
        // yaw quartile edges with them.
        //
        // A single synchronous `evaluate` blocks the page's JS thread for its
        // whole duration, so no animation frame can fire inside it and the
        // sweep is charged exactly `1/60 s` of camera time per tick. Everything
        // this pass needs is collected in there and returned in one payload.
        const samples = await page.evaluate(
          ({ stride, maxTicks }) => {
            const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
            const collected: { tick: number; rootYaw: Record<string, number>; cameraYaw: number; bounds: Record<string, BoundsPx>; canvas: { width: number; height: number } }[] = []
            for (let tick = 0; tick < maxTicks; tick += stride) {
              if (test.getActiveSeriesState()?.phase !== 'fighting') break
              test.stepBattleAndCamera(stride, 1 / 60)
              const snapshot = test.getArenaDebugSnapshot()
              if (!snapshot) break
              collected.push({
                tick: tick + stride,
                rootYaw: snapshot.rootYaw,
                cameraYaw: snapshot.camera.yaw,
                bounds: snapshot.fullBoundsPx,
                canvas: snapshot.canvasPx,
              })
            }
            return collected
          },
          { stride: SAMPLE_STRIDE_TICKS, maxTicks: MAX_BOUT_TICKS },
        )

        for (const sample of samples) {
          const ids = Object.keys(sample.bounds)
          if (ids.length !== 2) continue
          for (const combatantId of ids) {
            const bounds = sample.bounds[combatantId]
            const other = sample.bounds[ids.find((id) => id !== combatantId)!]
            if (!boundsOk(bounds, sample.canvas)) continue
            if (!cropIsClean(bounds, other, sample.canvas)) continue
            const side = combatantId.split('.')[0] as Side
            const relative = ((sample.rootYaw[combatantId] - sample.cameraYaw) * 180) / Math.PI
            candidates.push({
              lineupIndex,
              slot,
              tick: sample.tick,
              combatantId,
              archetype: archetypeOf(combatantId, lineup, slot),
              side,
              // Filled in once the whole sweep is in hand: the bin edges are
              // quartiles of the distribution, so no single frame can be binned
              // before every frame has been seen.
              yawBin: YAW_BINS[0],
              yawDegrees: Number(relative.toFixed(2)),
              profileDeviationDegrees: Number(profileDeviation(relative, side).toFixed(2)),
              bounds,
            })
          }
        }

        if (slot < 2) {
          await page.evaluate(() => {
            const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
            while (test.getActiveSeriesState()?.phase === 'fighting') test.advanceTicks(240)
            test.startNextBout()
          })
          await waitForStableCanvas(page)
        }
      }
    } finally {
      await page.context().close()
    }
    console.log(`swept lineup ${lineupIndex + 1}/${LINEUPS.length} (${lineup.join(', ')}) -- ${candidates.length} candidates so far`)
  }

  return candidates
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

interface Selection extends Candidate {
  /** Assigned after the seeded shuffle -- the reviewer sees only this. */
  stillId: string
}

function selectStills(
  rawCandidates: readonly Candidate[],
  seed: number,
): { selections: Selection[]; shortfalls: string[]; edges: Record<string, [number, number, number]> } {
  const { binned: candidates, edges } = binByGroup(rawCandidates)
  const random = mulberry32(seed ^ 0x5f3759df)
  const chosen: Candidate[] = []
  const shortfalls: string[] = []

  for (const archetype of ARCHETYPES) {
    for (const side of SIDES) {
      const groupPool = candidates.filter((c) => c.archetype === archetype && c.side === side)
      const picked: Candidate[] = []

      for (const yawBin of YAW_BINS) {
        const pool = groupPool.filter((c) => c.yawBin === yawBin)
        // Spread the two picks across the pool rather than taking neighbours:
        // two ticks a few frames apart are nearly the same pose, and eight
        // near-identical stills would flatter the confusion matrix.
        const spread = shuffled(pool, random)
        const fromThisBin: Candidate[] = []
        for (const candidate of spread) {
          if (fromThisBin.length >= STILLS_PER_BIN) break
          const tooClose = fromThisBin.some((other) => other.lineupIndex === candidate.lineupIndex && other.slot === candidate.slot && Math.abs(other.tick - candidate.tick) < 180)
          if (tooClose) continue
          fromThisBin.push(candidate)
        }
        // Second pass without the spacing rule, if the bin is thin.
        for (const candidate of spread) {
          if (fromThisBin.length >= STILLS_PER_BIN) break
          if (!fromThisBin.includes(candidate)) fromThisBin.push(candidate)
        }
        if (fromThisBin.length < STILLS_PER_BIN) {
          shortfalls.push(`${archetype}/${side}/${yawBin}: ${fromThisBin.length} of ${STILLS_PER_BIN} (pool ${pool.length})`)
        }
        picked.push(...fromThisBin)
      }

      // BALANCE BEATS BIN COVERAGE. If a yaw bin came up thin, top the group
      // back up to its full eight from anywhere else in the same (type, side)
      // pool rather than shipping a short group.
      //
      // The per-type bar is `>= 70% correct for each of the three types`, and
      // that is only comparable across types if each type contributes the same
      // number of stills; a 15/16/16 split makes one row's percentage rest on a
      // different denominator from the others, and the reviewer README's claim
      // that the set is evenly divided stops being true. The yaw bins are a
      // device for spreading the eight stills out, not a quantity anything is
      // scored against -- the answer key records each still's actual
      // `profile_deviation_degrees`, which is the column an analysis should use.
      // So when the two cannot both be satisfied, balance wins.
      if (picked.length < STILLS_PER_TYPE_PER_SIDE) {
        for (const candidate of shuffled(groupPool, random)) {
          if (picked.length >= STILLS_PER_TYPE_PER_SIDE) break
          if (!picked.includes(candidate)) picked.push(candidate)
        }
        shortfalls.push(
          picked.length < STILLS_PER_TYPE_PER_SIDE
            ? `${archetype}/${side}: ONLY ${picked.length} of ${STILLS_PER_TYPE_PER_SIDE} -- the set is NOT balanced (pool ${groupPool.length})`
            : `${archetype}/${side}: topped up to ${STILLS_PER_TYPE_PER_SIDE} from neighbouring yaw bins (pool ${groupPool.length})`,
        )
      }

      chosen.push(...picked)
    }
  }

  // The blinding: one seeded shuffle over the whole set, so still numbers carry
  // no information about type, side or yaw -- and, since home/away are shuffled
  // together, none about the side either.
  const order = shuffled(chosen, mulberry32(seed ^ 0x9e3779b9))
  const selections = order.map((candidate, index) => ({ ...candidate, stillId: `still-${String(index + 1).padStart(2, '0')}` }))
  return { selections, shortfalls, edges }
}

// ---------------------------------------------------------------------------
// Pass 2: capture
// ---------------------------------------------------------------------------

/** How long the camera is damped to convergence before each still is measured
 * and photographed. Two seconds is comfortably past the slowest of the three
 * damping time constants (1.25 s for distance). */
const CAMERA_SETTLE_SECONDS = 2

interface CapturedYaw {
  yawDegrees: number
  profileDeviationDegrees: number
}

async function captureStills(
  browser: Browser,
  seed: number,
  config: ConfigName,
  outDir: string,
  selections: readonly Selection[],
): Promise<Map<string, CapturedYaw>> {
  const captured = new Map<string, CapturedYaw>()
  for (const variant of VARIANTS) await mkdir(resolve(outDir, variant), { recursive: true })

  // Grouped by the bout that produced them, and stepped in ascending tick
  // order: one replay per bout instead of one replay per still.
  const byBout = new Map<string, Selection[]>()
  for (const selection of selections) {
    const key = `${selection.lineupIndex}:${selection.slot}`
    const group = byBout.get(key) ?? []
    group.push(selection)
    byBout.set(key, group)
  }

  let done = 0
  for (const [key, group] of byBout) {
    const [lineupIndex, slot] = key.split(':').map(Number)
    const page = await openSeries(browser, seed, config, LINEUPS[lineupIndex])
    try {
      for (let index = 0; index < slot; index += 1) {
        await page.evaluate(() => {
          const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
          while (test.getActiveSeriesState()?.phase === 'fighting') test.advanceTicks(240)
          test.startNextBout()
        })
        await waitForStableCanvas(page)
      }
      const canvasBox = await page.locator('canvas').boundingBox()
      if (!canvasBox) throw new Error('No canvas bounding box')

      let tick = 0
      for (const selection of [...group].sort((a, b) => a.tick - b.tick)) {
        const step = selection.tick - tick
        if (step < 0) throw new Error(`Ticks out of order in ${key}`)
        // Step and re-measure in ONE evaluate. The swept bounds picked this
        // frame; they are not what it is cropped to. Between two awaits the
        // app's own animation-frame loop damps the camera by real elapsed time
        // (see the sweep's own comment), so bounds measured in an earlier round
        // trip describe a framing a few pixels away from the one about to be
        // photographed. Measuring inside the same blocking call means the crop
        // always matches the frame on screen.
        const live = await page.evaluate(
          ({ ticks, settleSeconds }) => {
            const test = (window as unknown as { __GLADIATOR_TEST__: TestApi }).__GLADIATOR_TEST__
            if (ticks > 0) test.stepBattleAndCamera(ticks, 1 / 60)
            // Settle the camera to convergence before measuring OR
            // photographing. Without it the camera is mid-damping when the
            // evaluate returns, and the app's own animation-frame loop then
            // keeps damping it by real elapsed time while Playwright takes the
            // screenshot -- so the figure lands tens of pixels from where it
            // was measured, visibly off-centre in the fixed crop window (seen
            // in the first recorded set). Once converged, further wall-clock
            // damping moves nothing, so the measurement and the photograph
            // describe the same frame and the frame is reproducible.
            test.settleCameraSeconds(settleSeconds)
            return test.getArenaDebugSnapshot()
          },
          { ticks: step, settleSeconds: CAMERA_SETTLE_SECONDS },
        )
        tick = selection.tick
        const bounds = live?.fullBoundsPx[selection.combatantId] ?? selection.bounds
        // The settled camera is a slightly different shot from the one the
        // sweep binned on, so the yaw actually photographed is re-derived here
        // and it is this pair of numbers, not the sweep's, that the answer key
        // reports.
        const capturedRelative =
          live === null
            ? selection.yawDegrees
            : ((live.rootYaw[selection.combatantId] - live.camera.yaw) * 180) / Math.PI
        captured.set(selection.stillId, {
          yawDegrees: Number(capturedRelative.toFixed(2)),
          profileDeviationDegrees: Number(profileDeviation(capturedRelative, selection.side).toFixed(2)),
        })

        const rect = cropRect(bounds)
        const clip = {
          x: canvasBox.x + Math.min(Math.max(0, rect.x), canvasBox.width - CROP_WIDTH_PX),
          y: canvasBox.y + Math.min(Math.max(0, rect.y), canvasBox.height - CROP_HEIGHT_PX),
          width: CROP_WIDTH_PX,
          height: CROP_HEIGHT_PX,
        }

        for (const variant of VARIANTS) {
          await page.evaluate((css) => {
            const canvas = document.querySelector('canvas')
            if (canvas) canvas.style.filter = css
          }, VARIANT_CSS[variant])
          // Two frames: one for the style to take effect, one for the
          // compositor to have drawn with it.
          await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
          await page.screenshot({ path: resolve(outDir, variant, `${selection.stillId}.png`), clip })
        }
        done += 1
        console.log(`captured ${selection.stillId} (${done}/${selections.length})`)
      }
    } finally {
      await page.context().close()
    }
  }
  return captured
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * The ONE document the reviewer reads. It opens by telling them not to read
 * anything else, so anything it gets wrong cannot be corrected elsewhere --
 * which is why it states the profile-only limitation itself rather than
 * deferring to the gate document, and why it gives no per-type counts.
 *
 * It deliberately does NOT say how many stills each type contributes. The set
 * is balanced (16/16/16), and a reviewer who knows that can balance their own
 * answers and gain accuracy without seeing anything -- which would inflate the
 * confusion matrix the whole exercise exists to measure. Nor does it use the
 * internal archetype ids: `heavy`/`fast`/`technical` are the vocabulary this
 * slice removed from every player-facing surface, and a reviewer is a player
 * for this purpose.
 */
function renderReviewerReadme(config: ConfigName, seed: number, selections: readonly Selection[]): string {
  return `# Blinded silhouette stills -- \`${config}\` (seed ${seed})

**Do not read anything else in \`docs/reviews/\` before you finish this.** The
answer key is deliberately NOT in this directory; it lives under
\`docs/reviews/clips/blinded-stills-answer-key/${config}/\`. Somebody other than
you scores your sheet against it.

## What to do

1. Open \`monochrome/\` and look at the stills **in file order**,
   \`still-01.png\` first. That is the scored set.
2. For each one, write down which of the three gladiator types you think it is
   -- **Murmillo**, **Retiarius** or **Hoplomachus** -- in
   \`scoring-sheet.csv\`. Guess if you have to; leave nothing blank.
3. Do not go back and change an earlier answer after seeing a later still.
4. Then, separately and not scored, page through \`greyscale/\`,
   \`protanopia/\`, \`deuteranopia/\` and \`tritanopia/\` and note anywhere a type
   became harder or easier to pick out than it was in monochrome.

Each still shows **one** fighter, cropped from a real bout at the shipped
framing distance. No HUD, no labels, no names. The types appear in a shuffled
order and the two sides are shuffled together with them, so neither the file
number nor the run of answers tells you anything.

## The set, and what it can and cannot show you

${selections.length} stills, evenly divided between the three types and between the two
sides. (No per-type count is given on purpose: knowing it would let you balance
your answers and score better than you can actually see.)

**Every still is a side-on view.** Not one of them shows a fighter from the
front or from the back. That is not an oversight in how these were chosen: the
arena camera turns to keep the two fighters across the frame, and a gladiator
always faces his opponent -- so on screen he is nearly always in profile, and on
the rare frames where he is not, the two fighters overlap too much to crop one
of them out on his own.

So the yaw dimension in this set is narrow. Each type is shown at four slightly
different turns -- quartiles of how far off pure profile that fighter was ever
seen, a spread of tens of degrees, not a quarter turn. The intent is only that
you are not judging eight identical poses; it is **not** a test of whether the
types read from every angle, because at the shipped camera there is no every
angle. Read your result as: *can these three be told apart in profile, at the
distance the game actually plays at.*

Pose varies much more than yaw does -- the fighters are caught mid-attack,
guarding, giving ground -- and that is the real variety in the set.

## The pass bar (set before anyone looked at these)

- **>= 80% correct overall**, and
- **>= 70% correct for each of the three types.**

Both bars were fixed when this material was recorded, and are written here so
they cannot move afterwards. If the result misses either bar, that is a finding
about the fighters, not about the bar: the design spec's response to a failure
is to change the fighters or to re-open the type choice, and explicitly **not**
to weaken this test.

(What the design spec expects to be hardest, and what to do about it, is
deliberately **not** written here -- naming it would tell you what to look for
and inflate your score. It is in the gate document, which the person scoring
your sheet reads and you do not.)
`
}

function renderScoringSheet(selections: readonly Selection[]): string {
  const rows = selections.map((s) => `${s.stillId},`).join('\n')
  return `still,your answer (Murmillo | Retiarius | Hoplomachus)\n${rows}\n`
}

function renderAnswerKey(config: ConfigName, seed: number, selections: readonly Selection[]): string {
  const rows = selections
    .map((s) => [s.stillId, s.archetype, s.side, s.yawBin, s.yawDegrees, s.profileDeviationDegrees, s.combatantId, s.lineupIndex, s.slot, s.tick].join(','))
    .join('\n')
  return `# blinded silhouette answer key -- ${config}, seed ${seed}
# KEEP THIS AWAY FROM THE REVIEWER until their sheet is complete.
# archetype is the internal id; the reviewer answers in type names:
#   heavy = Murmillo, fast = Retiarius, technical = Hoplomachus
still,archetype,side,yaw_bin,yaw_degrees,profile_deviation_degrees,combatant,lineup_index,bout_slot,tick
${rows}
`
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

interface Args {
  seed: number
  config: ConfigName
  root: string
}

function parseArgs(argv: readonly string[]): Args {
  const get = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
  const requested = get('config') ?? 'everything'
  if (!(CONFIG_NAMES as readonly string[]).includes(requested)) {
    throw new Error(`--config must be one of ${CONFIG_NAMES.join(', ')} (got ${requested})`)
  }
  return { seed: Number(get('seed') ?? 20260815), config: requested as ConfigName, root: resolve(get('out') ?? 'docs/reviews/clips') }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  const stillsDir = resolve(args.root, 'blinded-stills', args.config)
  const keyDir = resolve(args.root, 'blinded-stills-answer-key', args.config)
  await rm(stillsDir, { recursive: true, force: true })
  await rm(keyDir, { recursive: true, force: true })
  await mkdir(stillsDir, { recursive: true })
  await mkdir(keyDir, { recursive: true })

  const server = await createServer({ server: { host: '127.0.0.1', port: PORT, strictPort: true } })
  await server.listen()
  const browser = await chromium.launch()

  try {
    const candidates = await collectCandidates(browser, args.seed, args.config)
    if (process.argv.includes('--dry-run')) {
      const buckets = new Map<string, Candidate[]>()
      for (const c of candidates) {
        const key = `${c.archetype}/${c.side}`
        buckets.set(key, [...(buckets.get(key) ?? []), c])
      }
      const { edges } = binByGroup(candidates)
      for (const [key, group] of [...buckets].sort()) {
        const perBin = YAW_BINS.map(
          (bin) => `${bin}:${group.filter((c) => yawBinFor(c.profileDeviationDegrees, edges[groupKey(c)]) === bin).length}`,
        ).join(' ')
        const deviations = group.map((c) => c.profileDeviationDegrees)
        const range = `${Math.min(...deviations).toFixed(0)}..${Math.max(...deviations).toFixed(0)}`
        console.log(`${key.padEnd(20)} n=${String(group.length).padStart(4)}  dev ${range.padStart(9)}  ${perBin}`)
      }
      return
    }
    const { selections, shortfalls, edges } = selectStills(candidates, args.seed)
    for (const [key, group] of Object.entries(edges)) {
      console.log(`yaw bin edges ${key.padEnd(18)} (degrees off profile): ${group.map((e) => e.toFixed(2)).join(', ')}`)
    }
    if (shortfalls.length > 0) {
      // Loud, and not fatal: a thin bin is a real finding about the fight (some
      // facings are rare), and half a set is still worth looking at -- but it
      // must never be mistaken for a complete one.
      console.warn(`\nWARNING: ${shortfalls.length} yaw bin(s) short of ${STILLS_PER_BIN} stills:`)
      for (const line of shortfalls) console.warn(`  ${line}`)
    }

    const captured = await captureStills(browser, args.seed, args.config, stillsDir, selections)
    // The recorded stills carry the yaw the settled camera actually
    // photographed, not the sweep's pre-settle estimate.
    const finalSelections = selections.map((selection) => ({ ...selection, ...(captured.get(selection.stillId) ?? {}) }))

    await writeFile(resolve(stillsDir, 'README.md'), renderReviewerReadme(args.config, args.seed, finalSelections), 'utf8')
    await writeFile(resolve(stillsDir, 'scoring-sheet.csv'), renderScoringSheet(finalSelections), 'utf8')
    await writeFile(resolve(keyDir, 'answer-key.csv'), renderAnswerKey(args.config, args.seed, finalSelections), 'utf8')
    await writeFile(
      resolve(keyDir, 'answer-key.json'),
      JSON.stringify(
        {
          configuration: args.config,
          seed: args.seed,
          stillsPerTypePerSide: STILLS_PER_TYPE_PER_SIDE,
          yawBins: YAW_BINS,
          yawBinEdgesDegreesOffProfileByGroup: edges,
          variants: VARIANTS,
          shortfalls,
          stills: finalSelections,
        },
        null,
        2,
      ),
      'utf8',
    )

    console.log(`\n${selections.length} stills x ${VARIANTS.length} variants in ${stillsDir}`)
    console.log(`answer key (keep away from the reviewer): ${keyDir}`)
  } finally {
    await browser.close()
    await server.close()
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
  process.exit(1)
})
