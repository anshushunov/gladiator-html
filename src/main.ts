import './style.css'
import { ArenaView, type ArenaDebugSnapshot, type BattleRenderFrame } from './presentation/ArenaView'
import { SeriesView, type RuntimeViewState, type SeriesIntent } from './presentation/SeriesView'
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
import type { CombatantId } from './simulation/encounter'
import type { Vec2 } from './simulation/movement'
import { formatTraceHash } from './simulation/random'

type TestCommandResult = { ok: true } | { ok: false; reason: SeriesCommandFailure }

interface RenderDebugState {
  previousTick: number | null
  currentTick: number | null
  alpha: number
  paused: boolean
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
  /** Dev-only (`import.meta.env.DEV`); absent from production builds -- see `ArenaView.getDebugSnapshot`. */
  getArenaDebugSnapshot?(): ArenaDebugSnapshot | null
}

/**
 * The runtime's own render-frame bookkeeping: the previous and current
 * simulation tick's immutable `BattleState`, plus the event slice emitted by
 * that single-tick transition. `previous`/`current` are never cloned --
 * unchanged nested catalog/event structures keep structural sharing, and
 * presentation (Tasks 15-18) must never mutate either snapshot.
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
const snapshotMode = new URLSearchParams(window.location.search).has('snapshot')

const shell = required<HTMLElement>('.game-shell')
const canvas = required<HTMLCanvasElement>('canvas')

const seriesView = new SeriesView(shell, applyIntent)
const arenaView = new ArenaView(canvas)

let series: SeriesState = createSeries({ homeRoster, opponents, seed, combatStyles: COMBAT_STYLES })
const runtime: RuntimeViewState = { paused: snapshotMode, speed: 1 }
let previousFrame = performance.now()
let lastPhase = series.phase
let lastActiveBoutIndex: number | null = series.activeBoutIndex
let lastRenderedSeries: SeriesState = series
let accumulator = 0
const tickDuration = 1 / TICKS_PER_SECOND

/** `undefined` whenever no bout is active; see `RenderSnapshot`'s doc comment. */
let renderFrame: RenderSnapshot | undefined

/**
 * Bout lifecycle boundary: (re)initializes both render snapshots to the
 * given battle's current tick (tick 0 for a freshly created battle), with an
 * empty event batch -- or clears them entirely when no battle is active
 * (planning/summary). Called only from command paths (`applyIntent`/
 * `applyCommand`), never from tick-stepping, so an `activeBattle` reference
 * change reaching here always means a bout started or ended, never a tick
 * advanced.
 */
function resetRenderFrame(battle: BattleState | undefined): void {
  renderFrame = battle ? { previous: battle, current: battle, events: [] } : undefined
}

/**
 * Advances the active battle by exactly one fixed simulation tick, assigning
 * the pre-tick battle state to `previous` and the post-tick state to
 * `current`. `events` is `current.events` -- `BattleState`'s own complete,
 * append-only event log for the whole bout so far (`battle.ts`), not a
 * single-tick delta: at `x2`/`x4` speed (or a test-driven `advanceTicks`
 * burst), several ticks can run per `syncArena()` call, so a delta slice of
 * only the *latest* tick would silently drop every event from the ticks in
 * between. `ArenaView` already de-duplicates by its own monotonic event
 * cursor (brief resolution #5), so handing it the full log every call is
 * exactly what the previous side-keyed renderer did too -- safe, just
 * re-skipping already-seen IDs -- and is what actually makes every event
 * reach it at any render rate or speed multiplier.
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
    renderFrame = { previous: previousBattle, current: currentBattle, events: currentBattle.events }
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
    case 'confirm': series = confirmLineup(series).state; break
    case 'start-next': series = startNextBout(series).state; break
    case 'rematch': series = rematch(series).state; break
    case 'toggle-pause': runtime.paused = !runtime.paused; break
    case 'set-speed': runtime.speed = intent.speed; break
  }
  if (series.activeBattle !== previousBattle) resetRenderFrame(series.activeBattle)
  renderDom()
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
    accumulator = 0
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

function syncArena(): void {
  if (renderFrame && (series.phase === 'fighting' || series.phase === 'between-bouts')) {
    arenaView.sync({ ...renderFrame, alpha: currentAlpha() })
  }
}

function frame(now: number): void {
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

  if (series !== lastRenderedSeries) renderDom()

  syncArena()
  requestAnimationFrame(frame)
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
  }),
}

if (import.meta.env.DEV) {
  window.__GLADIATOR_TEST__.renderActiveBattleAtAlpha = (alpha) => arenaView.renderActiveBattleAtAlpha?.(alpha)
  window.__GLADIATOR_TEST__.getArenaDebugSnapshot = () => arenaView.getDebugSnapshot?.() ?? null
}
