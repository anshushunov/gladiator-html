import './style.css'
import { ArenaView } from './presentation/ArenaView'
import { SeriesView, type RuntimeViewState, type SeriesIntent } from './presentation/SeriesView'
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
import { TICKS_PER_SECOND } from './simulation/battle'

type TestCommandResult = { ok: true } | { ok: false; reason: SeriesCommandFailure }

interface GladiatorTestApi {
  getState(): SeriesState
  assign(homeFighterId: string, boutIndex: BoutIndex): TestCommandResult
  unassign(boutIndex: BoutIndex): TestCommandResult
  confirm(): TestCommandResult
  advanceTicks(ticks: number): void
  startNextBout(): TestCommandResult
  rematch(): TestCommandResult
}

const url = new URL(window.location.href)
const seed = resolveSeriesSeed(url)
const snapshotMode = new URLSearchParams(window.location.search).has('snapshot')

const shell = required<HTMLElement>('.game-shell')
const canvas = required<HTMLCanvasElement>('canvas')

const seriesView = new SeriesView(shell, applyIntent)
const arenaView = new ArenaView(canvas)

let series: SeriesState = createSeries({ homeRoster, opponents, seed })
const runtime: RuntimeViewState = { paused: snapshotMode, speed: 1 }
let previousFrame = performance.now()
let lastPhase = series.phase
let lastActiveBoutIndex: number | null = series.activeBoutIndex
let lastRenderedSeries: SeriesState = series
let accumulator = 0
const tickDuration = 1 / TICKS_PER_SECOND

function applyIntent(intent: SeriesIntent): void {
  switch (intent.type) {
    case 'assign': series = assignFighter(series, intent.fighterId, intent.boutIndex).state; break
    case 'unassign': series = unassignSlot(series, intent.boutIndex).state; break
    case 'confirm': series = confirmLineup(series).state; break
    case 'start-next': series = startNextBout(series).state; break
    case 'rematch': series = rematch(series).state; break
    case 'toggle-pause': runtime.paused = !runtime.paused; break
    case 'set-speed': runtime.speed = intent.speed; break
  }
  renderDom()
}

function applyCommand(result: SeriesCommandResult): TestCommandResult {
  series = result.state
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
      const { home, away } = series.activeBattle.fighters
      arenaView.startBout(series.activeBoutIndex, home.definition, away.definition)
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
        const next = advanceSeriesTicks(series, 1)
        if (next !== series) series = next
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
    series = advanceSeriesTicks(series, ticks)
    renderDom()
  },
  startNextBout: () => applyCommand(startNextBout(series)),
  rematch: () => applyCommand(rematch(series)),
}