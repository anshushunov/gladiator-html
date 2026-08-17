import './style.css'
import { ArenaView } from './presentation/ArenaView'
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
import { fighterBySide, TICKS_PER_SECOND, type BattleState } from './simulation/battle'
import type { CombatantId, EncounterEvent } from './simulation/encounter'
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
}

/**
 * The runtime's own render-frame bookkeeping: the previous and current
 * simulation tick's immutable `BattleState`, plus the event slice emitted by
 * that single-tick transition. `previous`/`current` are never cloned --
 * unchanged nested catalog/event structures keep structural sharing, and
 * presentation (Tasks 15-18) must never mutate either snapshot.
 *
 * `undefined` while no bout is active (planning/summary, or before the first
 * bout starts).
 */
interface BattleRenderFrame {
  previous: BattleState
  current: BattleState
  events: readonly EncounterEvent[]
}

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

/** `undefined` whenever no bout is active; see `BattleRenderFrame`'s doc comment. */
let renderFrame: BattleRenderFrame | undefined

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
 * `current`, and retaining only that transition's new event slice. A no-op
 * (series and renderFrame both untouched) whenever there is no active bout
 * to advance.
 */
function stepBattleTick(): void {
  const previousSeries = series
  const previousBattle = series.activeBattle
  const nextSeries = advanceSeriesTicks(series, 1)
  if (nextSeries === previousSeries) return
  series = nextSeries
  const currentBattle = series.activeBattle
  if (previousBattle && currentBattle && currentBattle !== previousBattle) {
    renderFrame = { previous: previousBattle, current: currentBattle, events: currentBattle.events.slice(previousBattle.events.length) }
  }
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
      const battle = series.activeBattle
      arenaView.startBout(series.activeBoutIndex, fighterBySide(battle, 'home').definition, fighterBySide(battle, 'away').definition)
    }
  } else if (series.phase === 'planning' || series.phase === 'summary') {
    arenaView.clearBout()
  }
  lastActiveBoutIndex = series.activeBoutIndex
}

function syncArena(): void {
  const battle = series.activeBattle
  if (battle && (series.phase === 'fighting' || series.phase === 'between-bouts')) arenaView.sync(battle)
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
    alpha: accumulator / tickDuration,
    paused: runtime.paused,
  }),
}
