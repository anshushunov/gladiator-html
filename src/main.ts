import './style.css'
import { ArenaView } from './presentation/ArenaView'
import { formatBattleFeed } from './presentation/battleFeed'
import { advanceBattleTick, advanceBattleTicks, createBattle, TICKS_PER_SECOND, type BattleState } from './simulation/battle'
import type { FighterDefinition, FighterSide } from './simulation/fighters'

// Temporary migration fixtures matching the previous single-bout page exactly.
// Task 5 replaces these local fixtures with the shared MVP series content.
const brutus: FighterDefinition = { id: 'brutus', name: 'Brutus', school: 'House of Mars', archetype: 'heavy', maxHp: 100, damage: 10, attackIntervalTicks: 43, accuracy: 1, blockChance: 0, criticalChance: 0 }
const cassius: FighterDefinition = { id: 'cassius', name: 'Cassius', school: 'House of Neptune', archetype: 'technical', maxHp: 100, damage: 10, attackIntervalTicks: 43, accuracy: 1, blockChance: 0, criticalChance: 0 }
const MIGRATION_SEED = 20260815
const HP_SELECTOR: Record<FighterSide, string> = { home: 'red', away: 'blue' }
const FEED_NAMES = { home: 'Brutus', away: 'Cassius' }

const canvas = required<HTMLCanvasElement>('canvas')
const toggleButton = required<HTMLButtonElement>('[data-testid="toggle-bout"]')
const resetButton = required<HTMLButtonElement>('[data-testid="reset-bout"]')
const status = required<HTMLElement>('[data-testid="battle-status"]')
const feed = required<HTMLOListElement>('[data-testid="battle-feed"]')
const snapshotMode = new URLSearchParams(window.location.search).has('snapshot')

const view = new ArenaView(canvas)
let battle = createBattle({ home: brutus, away: cassius, seed: MIGRATION_SEED })
let running = !snapshotMode
let previousFrame = performance.now()
let accumulator = 0
const tickDuration = 1 / TICKS_PER_SECOND

function frame(now: number): void {
  const elapsed = Math.min((now - previousFrame) / 1000, 0.1)
  previousFrame = now

  if (running && battle.phase === 'running') {
    accumulator += elapsed
    while (accumulator >= tickDuration) {
      battle = advanceBattleTick(battle)
      accumulator -= tickDuration
    }
  }

  renderUi()
  view.sync(battle)
  requestAnimationFrame(frame)
}

function renderUi(): void {
  for (const side of ['home', 'away'] as const) {
    const fighter = battle.fighters[side]
    required<HTMLElement>(`[data-hp="${HP_SELECTOR[side]}"]`).textContent = String(fighter.hp)
    required<HTMLElement>(`[data-health="${HP_SELECTOR[side]}"]`).style.width = `${(fighter.hp / fighter.definition.maxHp) * 100}%`
  }

  if (battle.phase === 'finished') {
    const winner = battle.fighters[battle.winnerSide as FighterSide]
    status.textContent = winner ? `${winner.definition.name} wins` : ''
    toggleButton.textContent = 'Bout finished'
    toggleButton.disabled = true
  } else {
    status.textContent = running ? 'FIGHT' : 'READY'
    toggleButton.textContent = running ? 'Pause bout' : 'Start bout'
    toggleButton.disabled = false
  }

  feed.replaceChildren(...formatBattleFeed(battle.events, FEED_NAMES).slice().reverse().map((entry) => {
    const item = document.createElement('li')
    item.innerHTML = `<time>${entry.atSeconds.toFixed(1)}s</time><span>${entry.message}</span>`
    return item
  }))
}

toggleButton.addEventListener('click', () => {
  running = !running
  previousFrame = performance.now()
  renderUi()
})

resetButton.addEventListener('click', () => {
  battle = createBattle({ home: brutus, away: cassius, seed: MIGRATION_SEED })
  running = false
  accumulator = 0
  renderUi()
})

window.addEventListener('pagehide', () => view.dispose())

renderUi()
view.sync(battle)
requestAnimationFrame(frame)

function required<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector)
  if (!element) throw new Error(`Missing required element: ${selector}`)
  return element
}

declare global {
  interface Window {
    __GLADIATOR_TEST__: {
      getState: () => BattleState
      advance: (seconds: number) => void
      reset: () => void
    }
  }
}

window.__GLADIATOR_TEST__ = {
  getState: () => structuredClone(battle),
  advance: (seconds: number) => {
    battle = advanceBattleTicks(battle, Math.round(seconds * TICKS_PER_SECOND))
    renderUi()
    view.sync(battle)
  },
  reset: () => {
    battle = createBattle({ home: brutus, away: cassius, seed: MIGRATION_SEED })
    running = false
    renderUi()
  },
}