import './style.css'
import { ArenaView, type ArenaDebugSnapshot, type BattleRenderFrame } from './presentation/ArenaView'
import { SeriesView, type RuntimeViewState, type SeriesIntent } from './presentation/SeriesView'
import {
  ALL_COMBAT_CUES,
  createBrowserAudioBackend,
  CombatAudio,
  type CombatCue,
  type FootstepThreshold,
} from './presentation/CombatAudio'
import { collectFootstepThresholds, type PlantedFootByCombatant } from './presentation/footstepThresholds'
import { COMBAT_STYLES } from './content/combatStyles'
import { homeRoster, opponents } from './content/mvpSeries'
import {
  advanceSeriesTicks,
  assignFighter,
  confirmLineup,
  createSeries,
  rematch,
  startNextBout,
  unassignSlot,
  type BoutIndex,
  type SeriesCommandFailure,
  type SeriesCommandResult,
  type SeriesState,
} from './simulation/series'
import { TICKS_PER_SECOND, type BattleState } from './simulation/battle'
import type { CombatantId, EncounterEvent } from './simulation/encounter'
import type { Vec2 } from './simulation/movement'
import { formatTraceHash } from './simulation/random'

type TestCommandResult = { ok: true } | { ok: false; reason: SeriesCommandFailure }

interface RenderDebugState {
  previousTick: number | null
  currentTick: number | null
  alpha: number
  paused: boolean
  /** `true` once `frame()` has latched a presentation/audio failure (final-review fix #1) -- the simulation keeps ticking regardless, this only reports whether rendering itself has stopped. */
  presentationDisabled: boolean
}

interface GladiatorTestApi {
  getState(): SeriesState
  assign(homeFighterId: string, boutIndex: BoutIndex): TestCommandResult
  unassign(boutIndex: BoutIndex): TestCommandResult
  confirm(): TestCommandResult
  advanceTicks(ticks: number): void
  startNextBout(): TestCommandResult
  rematch(): TestCommandResult
  getActiveBattleTraceHash(): string | null
  getActiveCombatantPositions(): Readonly<Record<CombatantId, Vec2>>
  getRenderDebugState(): Readonly<RenderDebugState>
  /** Dev-only (`import.meta.env.DEV`); absent from production builds -- see `ArenaView.renderActiveBattleAtAlpha`. */
  renderActiveBattleAtAlpha?(alpha: number): void
  /** Dev-only (`import.meta.env.DEV`); absent from production builds -- final-review fix #1's fault-injection test hook, see `forcePresentationThrowOnce`'s own doc comment in the module body. */
  forcePresentationThrowOnce?(): void
  /** Dev-only (`import.meta.env.DEV`); absent from production builds -- see `ArenaView.getDebugSnapshot`. */
  getArenaDebugSnapshot?(): ArenaDebugSnapshot | null
  /** Dev-only (`import.meta.env.DEV`), and only when `?audioDebug=1` is present -- triggers one cue through the real backend without starting a bout; see `CombatAudio.debugPlayCue`. */
  triggerAudioCue?(cue: CombatCue): void
  /** Dev-only (`import.meta.env.DEV`), and only when `?audioDebug=1` is present -- the cues `triggerAudioCue` has fired so far, for Playwright assertions with no real audio hardware. */
  getAudioDebugLog?(): readonly CombatCue[]
  /** Dev-only (`import.meta.env.DEV`); absent from production builds. Unlike `triggerAudioCue`/`getAudioDebugLog`, available regardless of `?audioDebug=1` -- this reads the real `CombatAudio` instance's own event cursor (Task 19 addition) so a reset fixture can prove it actually clears across a real bout/rematch boundary, not just in `CombatAudio.test.ts`'s unit-level isolation; see `CombatAudio.getDebugEventCursor`. */
  getAudioEventCursor?(): number | null
}

/**
 * The runtime's own render-frame bookkeeping: the previous and current
 * simulation tick's immutable `BattleState`, plus the *accumulated* event
 * batch for every tick since `ArenaView` last actually consumed one.
 * `previous`/`current` are never cloned -- unchanged nested catalog/event
 * structures keep structural sharing, and presentation (Tasks 15-18) must
 * never mutate either snapshot. `previous`/`current` are always exactly the
 * last two *consecutive* ticks (never further apart), matching design.md's
 * "interpolation remains between the last two actual states" even when
 * several ticks run before the next render; `events` is the one field that
 * intentionally spans however many ticks that was -- see `pendingEvents`
 * and `stepBattleTick` below.
 *
 * `undefined` while no bout is active (planning/summary, or before the first
 * bout starts). `alpha` is deliberately not stored here -- it is a
 * presentation clock value, recomputed fresh every `syncArena()` call and
 * merged in only when actually building the `BattleRenderFrame` `ArenaView`
 * consumes (see `syncArena` below), so a tick boundary (which replaces this
 * snapshot) is never confused with an alpha update (which does not).
 */
type RenderSnapshot = Omit<BattleRenderFrame, 'alpha'>

const url = new URL(window.location.href)
const seed = resolveSeriesSeed(url)

// Dev/test-only (final-review fix #4): `?snapshot` pauses the app on load so
// Playwright fixtures get a stable first frame -- reading it unconditionally
// made it a production-reachable URL param that could silently start a real
// player's session paused. Gated the same way as the rest of the dev-only
// test surface below (`import.meta.env.DEV`, statically eliminated from a
// production bundle), so `snapshotMode` is always `false` in production
// regardless of the URL.
let snapshotMode = false
if (import.meta.env.DEV) {
  snapshotMode = new URLSearchParams(window.location.search).has('snapshot')
}

const shell = required<HTMLElement>('.game-shell')
const canvas = required<HTMLCanvasElement>('canvas')

const seriesView = new SeriesView(shell, applyIntent)
const arenaView = new ArenaView(canvas)
const combatAudio = new CombatAudio(createBrowserAudioBackend())

let series: SeriesState = createSeries({ homeRoster, opponents, seed, combatStyles: COMBAT_STYLES })
const runtime: RuntimeViewState = { paused: snapshotMode, speed: 1, soundEnabled: false }
let previousFrame = performance.now()
let lastPhase = series.phase
let lastActiveBoutIndex: number | null = series.activeBoutIndex
let lastRenderedSeries: SeriesState = series
let accumulator = 0
const tickDuration = 1 / TICKS_PER_SECOND

/**
 * Latched by `frame()`'s own catch (final-review fix #1) the first time a
 * presentation/audio call throws -- `renderDom()`/`syncArena()` are skipped
 * on every subsequent frame once this is `true`, but the simulation-stepping
 * loop above them is not: design.md is explicit that "a presentation or
 * audio failure cannot mutate or stop simulation", and this branch's
 * `syncArena()` -> `ArenaView.sync()` -> pose sampling/two-bone IK/
 * `renderer.render`/`combatAudio.consume` path is exactly the unguarded
 * throw surface that grew large enough to make a single bad frame end the
 * whole session (`requestAnimationFrame(frame)` was `frame()`'s last
 * statement, so a throw skipped it and no further frame was ever scheduled).
 * Never reset back to `false` -- once presentation has demonstrably failed
 * this session, `contextLost`-style permanence (brief resolution #10) is the
 * same call `ArenaView` already makes for a lost WebGL context.
 */
let presentationDisabled = false

/** Dev-only test hook (final-review fix #1): makes the very next `frame()`
 * call's presentation step throw once, so a Playwright fixture can prove a
 * real render failure latches `presentationDisabled` and never re-throws or
 * stops tick advancement, without needing to actually break WebGL/audio to
 * do it. Consumed (reset to `false`) the instant it fires. Assigned only
 * under `import.meta.env.DEV`, below. */
let forcePresentationThrowOnce = false

/** `undefined` whenever no bout is active; see `RenderSnapshot`'s doc comment. */
let renderFrame: RenderSnapshot | undefined

/**
 * Every event emitted by `stepBattleTick` since `syncArena` last actually
 * handed a batch to `ArenaView` -- appended to there, consumed-and-reset
 * here. At `x1` this is always exactly one tick's worth (`syncArena` runs
 * every animation frame, and normally only one tick elapses per frame), but
 * at `x2`/`x4` speed -- or a test-driven `advanceTicks` burst -- several
 * `stepBattleTick` calls can happen before the next `syncArena` call, so
 * this accumulates across all of them rather than only keeping the latest.
 * This is what keeps `RenderSnapshot.events` a *bounded per-render batch*
 * (design.md: "a future mass renderer consumes event batches and chooses
 * its own bounded presentation window") rather than `BattleState`'s own
 * unboundedly-growing whole-bout log -- handing `ArenaView` that full log
 * every call would also be technically safe (its own event cursor
 * de-duplicates regardless of how much redundant history it's handed), but
 * abandons that bounded-batch shape for an ever-larger rescan on every
 * rendered frame for the rest of the bout, which is the wrong shape for
 * exactly the mass-caller future `ArenaCamera`'s target-array signature
 * already anticipates.
 */
let pendingEvents: EncounterEvent[] = []

/**
 * `CombatAudio`'s own per-render batch, accumulated and reset in lockstep
 * with `pendingEvents` (same reasoning, same lifecycle) but kept as a
 * separate array/type: footstep thresholds are presentation-only pseudo-
 * events `PoseController.ts`/`ArenaView.ts` never see and `EncounterEvent`'s
 * union does not include, minted per tick by `collectFootstepThresholds`
 * (`presentation/footstepThresholds.ts`) from each combatant's own
 * `travelledDistance` via `classifyPlantedFoot` -- the same gait math
 * `PoseController` samples for cosmetic leg poses, mirrored rather than
 * imported since neither `PoseController.ts` nor `ArenaView.ts` is one of
 * this task's owned files (see `CombatAudio.ts`'s own header comment).
 * Gated to `status === 'active' && tick >= staggerUntilTick` (final-review
 * fix #5) so a staggered/defeated fighter's phase-10 pushback travel never
 * mints a footstep for feet `PoseController.applyGroundingLayer` isn't even
 * grounding that tick.
 */
let pendingFootsteps: FootstepThreshold[] = []

/** One entry per combatant, the last `classifyPlantedFoot` result computed
 * for them this bout -- lets `collectFootstepThresholds` detect a *change*
 * (design.md: "fire when the planted foot changes") without re-deriving
 * `PoseController`'s own per-frame state. Reset (cleared) at every bout
 * boundary alongside `pendingFootsteps`; an absent entry is treated as
 * `'both'`, matching every fresh combatant's own `travelledDistance: 0`
 * baseline (`buildFighterCombatState`), so the very first tick of a bout
 * never spuriously fires a footstep. */
const lastPlantedFoot: PlantedFootByCombatant = new Map()

/** Monotonic id source for `FootstepThreshold`s, distinct from (and never
 * compared against) `EncounterEvent.id` -- `CombatAudio` dedupes the two
 * kinds with separate cursors. Reset to `0` at every bout boundary. */
let nextFootstepId = 0

/**
 * Bout lifecycle boundary: (re)initializes both render snapshots to the
 * given battle's current tick (tick 0 for a freshly created battle), with an
 * empty event batch -- or clears them entirely when no battle is active
 * (planning/summary). Called only from command paths (`applyIntent`/
 * `applyCommand`), never from tick-stepping, so an `activeBattle` reference
 * change reaching here always means a bout started or ended, never a tick
 * advanced. Also the one place that resets `CombatAudio`'s own event/
 * footstep cursors and stops its voices (design.md: "Arena reset clears
 * pose, trails, flashes, audio voices, event cursors... at each new bout and
 * on rematch") -- every path that reaches here is exactly a bout change or a
 * rematch, never an ordinary tick.
 */
function resetRenderFrame(battle: BattleState | undefined): void {
  renderFrame = battle ? { previous: battle, current: battle, events: [] } : undefined
  pendingEvents = []
  pendingFootsteps = []
  lastPlantedFoot.clear()
  nextFootstepId = 0
  combatAudio.resetBout()
}

/**
 * Advances the active battle by exactly one fixed simulation tick, assigning
 * the pre-tick battle state to `previous` and the post-tick state to
 * `current`, and appending that single tick's own new-event slice onto
 * `pendingEvents` (never replacing it) -- see `pendingEvents`'s own doc
 * comment for why accumulating, not overwriting, is what actually gets
 * every tick's events to `ArenaView` regardless of how many ticks run
 * before the next render.
 *
 * A no-op (series and renderFrame both untouched) whenever there is no
 * active bout to advance.
 */
function stepBattleTick(): void {
  const previousSeries = series
  const previousBattle = series.activeBattle
  const nextSeries = advanceSeriesTicks(series, 1)
  if (nextSeries === previousSeries) return
  series = nextSeries
  const currentBattle = series.activeBattle
  if (previousBattle && currentBattle && currentBattle !== previousBattle) {
    pendingEvents.push(...currentBattle.events.slice(previousBattle.events.length))
    const footsteps = collectFootstepThresholds(currentBattle.encounter, lastPlantedFoot, nextFootstepId)
    pendingFootsteps.push(...footsteps.thresholds)
    nextFootstepId = footsteps.nextFootstepId
    renderFrame = { previous: previousBattle, current: currentBattle, events: pendingEvents }
  }
}

function currentAlpha(): number {
  const raw = accumulator / tickDuration
  if (raw < 0) return 0
  if (raw > 1) return 1
  return raw
}

function applyIntent(intent: SeriesIntent): void {
  const previousBattle = series.activeBattle
  switch (intent.type) {
    case 'assign': series = assignFighter(series, intent.fighterId, intent.boutIndex).state; break
    case 'unassign': series = unassignSlot(series, intent.boutIndex).state; break
    case 'confirm': {
      // Gesture lifecycle (brief resolution #5): `enableAfterGesture` is
      // fired synchronously, without `await`, as the very first statement
      // reached from the click -- `SeriesView.handleClick`'s 'confirm' case
      // calls `this.onIntent({ type: 'confirm' })` synchronously from the
      // native click handler, and nothing between that call and this line
      // is asynchronous, so `AudioContext.resume()` still begins inside the
      // browser gesture's own call stack even though this promise only
      // settles later. `.then`/`.catch` both just refresh the visible
      // Sound on/off control; the synchronous series command below runs
      // immediately regardless of whether audio ends up enabled.
      void combatAudio.enableAfterGesture().then(refreshAudioUi).catch(refreshAudioUi)
      series = confirmLineup(series).state
      break
    }
    case 'start-next': series = startNextBout(series).state; break
    case 'rematch': series = rematch(series).state; break
    case 'toggle-pause': runtime.paused = !runtime.paused; break
    case 'set-speed': runtime.speed = intent.speed; break
    case 'toggle-sound': {
      // Also a gesture-eligible click (design.md: "an explicit `Sound on`
      // click"), and reached synchronously from `SeriesView`'s click
      // handler the same way 'confirm' is -- so this preserves the same
      // synchronous-first `enable`/`resume` window when sound has never yet
      // been turned on.
      void combatAudio.setSoundEnabled(!combatAudio.isSoundEnabled()).then(refreshAudioUi).catch(refreshAudioUi)
      break
    }
  }
  if (series.activeBattle !== previousBattle) resetRenderFrame(series.activeBattle)
  renderDom()
}

/** Refreshes only the visible Sound on/off control after an async audio
 * gesture settles -- deliberately not `renderDom()` (which also drives
 * phase-change bookkeeping/focus), since an audio settlement is never a
 * `series`-changing event. */
function refreshAudioUi(): void {
  runtime.soundEnabled = combatAudio.isSoundEnabled()
  seriesView.render(series, runtime)
}

function applyCommand(result: SeriesCommandResult): TestCommandResult {
  const previousBattle = series.activeBattle
  series = result.state
  if (series.activeBattle !== previousBattle) resetRenderFrame(series.activeBattle)
  renderDom()
  return result.ok ? { ok: true } : { ok: false, reason: result.reason }
}

function renderDom(): void {
  lastRenderedSeries = series
  if (series.phase !== lastPhase) {
    // Final-review fix #3: `series.ts` can flip `phase` straight from
    // `fighting` to `summary` on the very tick the series-ending (third)
    // bout resolves -- unlike bouts 1/2, which always land in
    // `between-bouts` first. `syncArena`'s own gate (below) only forwards
    // batches while `fighting`/`between-bouts`, and `handleArenaPhaseChange`
    // (also below) clears the arena outright on `summary` -- so without this,
    // the third bout's final `damage-dealt`/`fighter-staggered`/
    // `fighter-defeated`/`encounter-finished` batch (and its defeat cue)
    // would never reach `ArenaView`/`CombatAudio` at all. Flush it here,
    // before the arena clears, using the same accumulator-reset-then-alpha
    // sequence `syncArena` uses for the between-bouts case, so bout 3 is
    // presented exactly like bouts 1 and 2.
    const needsFinalFlush = (lastPhase === 'fighting' || lastPhase === 'between-bouts') && series.phase !== 'fighting' && series.phase !== 'between-bouts'
    accumulator = 0
    if (needsFinalFlush) flushRenderBatch(currentAlpha())
    handleArenaPhaseChange()
    lastPhase = series.phase
  }
  seriesView.render(series, runtime)
  syncArena()
}

function handleArenaPhaseChange(): void {
  if (series.phase === 'fighting') {
    if (series.activeBoutIndex !== null && series.activeBoutIndex !== lastActiveBoutIndex && series.activeBattle) {
      arenaView.startBout(series.activeBoutIndex, series.activeBattle)
    }
  } else if (series.phase === 'planning' || series.phase === 'summary') {
    arenaView.clearBout()
  }
  lastActiveBoutIndex = series.activeBoutIndex
}

/**
 * Hands the current `renderFrame`/`pendingEvents`/`pendingFootsteps` batch to
 * `ArenaView`/`CombatAudio` and resets the accumulation window. Factored out
 * of `syncArena` (final-review fix #3) so `renderDom`'s series-ending-bout
 * flush can reuse the exact same forwarding logic instead of duplicating it
 * with a broadened phase gate.
 */
function flushRenderBatch(alpha: number): void {
  if (!renderFrame) return
  arenaView.sync({ ...renderFrame, alpha })
  combatAudio.consume({
    events: pendingEvents,
    footsteps: pendingFootsteps,
    boutIndex: series.activeBoutIndex ?? 0,
    speed: runtime.speed,
    paused: runtime.paused,
  })
  // Consumed: the next accumulation window (`pendingEvents`/
  // `pendingFootsteps`) starts empty, keeping every batch handed to
  // `ArenaView`/`CombatAudio` bounded to "since last render" rather than
  // growing across the whole bout.
  pendingEvents = []
  pendingFootsteps = []
}

function syncArena(): void {
  if (series.phase === 'fighting' || series.phase === 'between-bouts') flushRenderBatch(currentAlpha())
}

function frame(now: number): void {
  try {
    const elapsed = Math.min((now - previousFrame) / 1000, 0.1)
    previousFrame = now

    if (series.phase === 'fighting' && !runtime.paused) {
      accumulator += elapsed
      while (accumulator >= tickDuration) {
        accumulator -= tickDuration
        for (let step = 0; step < runtime.speed; step += 1) {
          stepBattleTick()
        }
      }
    }

    // Presentation only, from here down -- gated off entirely once a prior
    // frame has already latched a failure (see `presentationDisabled`'s own
    // doc comment). The simulation-stepping loop above always runs
    // regardless of this flag.
    if (!presentationDisabled) {
      if (forcePresentationThrowOnce) {
        forcePresentationThrowOnce = false
        throw new Error('Forced presentation failure (dev-only test hook)')
      }
      if (series !== lastRenderedSeries) renderDom()
      syncArena()
    }
  } catch (error) {
    // Final-review fix #1: a presentation or audio throw must never
    // permanently kill the loop -- latch the failure instead of letting it
    // propagate past this frame (which would skip the
    // `requestAnimationFrame(frame)` call below and stop every future
    // frame, and therefore every future simulation tick, forever).
    presentationDisabled = true
    if (import.meta.env.DEV) console.error('[gladiator] presentation disabled after an unrecoverable render error', error)
  } finally {
    requestAnimationFrame(frame)
  }
}

function resolveSeriesSeed(target: URL): number {
  const raw = target.searchParams.get('seed')
  const parsed = raw !== null && /^\d+$/.test(raw) ? Number(raw) : Number.NaN
  if (Number.isInteger(parsed) && parsed >= 0 && parsed <= 0xffff_ffff) return parsed >>> 0
  const value = crypto.getRandomValues(new Uint32Array(1))[0]
  target.searchParams.set('seed', String(value))
  history.replaceState(null, '', target)
  return value
}

window.addEventListener('pagehide', () => arenaView.dispose())

renderDom()
requestAnimationFrame(frame)

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing required element: ${selector}`)
  return element
}

declare global {
  interface Window {
    __GLADIATOR_TEST__: GladiatorTestApi
  }
}

// Final-review fix #4: the entire `window.__GLADIATOR_TEST__` surface --
// including this base command/inspection API, previously assigned
// unconditionally above this point -- is dev/test-only. `tests/global-
// setup.ts` always starts a Vite *dev* server (`import.meta.env.DEV` true),
// so nothing under `tests/` needs any of this from a production build, and
// leaving it unconditional made it a production-reachable surface next to
// every other test-only addition this file gates on `import.meta.env.DEV`.
// `vite build` statically replaces `import.meta.env.DEV` with `false`, so
// this whole block -- base API included, not just the debug extras below --
// is eliminated from a production bundle; verified by building and grepping
// the emitted bundle for these names (see the task report).
if (import.meta.env.DEV) {
  window.__GLADIATOR_TEST__ = {
    getState: () => structuredClone(series),
    assign: (homeFighterId, boutIndex) => applyCommand(assignFighter(series, homeFighterId, boutIndex)),
    unassign: (boutIndex) => applyCommand(unassignSlot(series, boutIndex)),
    confirm: () => applyCommand(confirmLineup(series)),
    advanceTicks: (ticks) => {
      if (!Number.isInteger(ticks) || ticks < 0) throw new Error('Tick count must be a non-negative integer')
      for (let step = 0; step < ticks; step += 1) stepBattleTick()
      renderDom()
    },
    startNextBout: () => applyCommand(startNextBout(series)),
    rematch: () => applyCommand(rematch(series)),
    getActiveBattleTraceHash: () => (renderFrame ? formatTraceHash(renderFrame.current.traceHash) : null),
    getActiveCombatantPositions: () => {
      if (!renderFrame) return {}
      const { descriptor, encounter } = renderFrame.current
      const positions: Record<CombatantId, Vec2> = {}
      for (const id of [descriptor.homeId, descriptor.awayId]) {
        const { x, z } = encounter.combatants[id].position
        positions[id] = { x, z }
      }
      return positions
    },
    getRenderDebugState: () => ({
      previousTick: renderFrame ? renderFrame.previous.encounter.tick : null,
      currentTick: renderFrame ? renderFrame.current.encounter.tick : null,
      alpha: currentAlpha(),
      paused: runtime.paused,
      presentationDisabled,
    }),
  }

  window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha = (alpha) => arenaView.renderActiveBattleAtAlpha?.(alpha)
  window.__GLADIATOR_TEST__.getArenaDebugSnapshot = () => arenaView.getDebugSnapshot?.() ?? null
  window.__GLADIATOR_TEST__.getAudioEventCursor = () => combatAudio.getDebugEventCursor?.() ?? null
  // Final-review fix #1's own test hook -- see `forcePresentationThrowOnce`'s doc comment above.
  window.__GLADIATOR_TEST__.forcePresentationThrowOnce = () => {
    forcePresentationThrowOnce = true
  }

  // Dev/test-only audio debug surface (brief resolution #9, design.md: "In
  // Vite dev/test only, `?audioDebug=1` exposes a test API that can trigger
  // every cue without starting a bout. Production builds ignore the
  // parameter and render no debug UI.").
  if (new URLSearchParams(window.location.search).has('audioDebug')) {
    buildAudioDebugPanel()
    window.__GLADIATOR_TEST__.triggerAudioCue = (cue) => combatAudio.debugPlayCue?.(cue)
    window.__GLADIATOR_TEST__.getAudioDebugLog = () => combatAudio.getDebugPlayedCues?.() ?? []
  }
}

/** Renders one visible trigger button per `CombatCue`, each firing that cue
 * through the real backend (bypassing `consume`'s event mapping/voice-cap/
 * speed policy entirely) so a reviewer -- or a Playwright fixture using an
 * instrumented/fake backend -- can hear or assert every cue in isolation
 * without ever starting a bout. */
function buildAudioDebugPanel(): void {
  const panel = document.createElement('div')
  panel.className = 'audio-debug'
  panel.dataset.testid = 'audio-debug'
  for (const cue of ALL_COMBAT_CUES) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'button audio-debug__button'
    button.dataset.testid = `audio-debug-${cue}`
    button.textContent = cue
    button.addEventListener('click', () => window.__GLADIATOR_TEST__.triggerAudioCue?.(cue))
    panel.append(button)
  }
  document.body.append(panel)
}
