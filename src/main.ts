import './style.css'
import { ArenaView } from './presentation/ArenaView'
import { createBattle, stepBattle, type BattleState } from './simulation/battle'

const canvas = required<HTMLCanvasElement>('canvas')
const toggleButton = required<HTMLButtonElement>('[data-testid="toggle-bout"]')
const resetButton = required<HTMLButtonElement>('[data-testid="reset-bout"]')
const status = required<HTMLElement>('[data-testid="battle-status"]')
const feed = required<HTMLOListElement>('[data-testid="battle-feed"]')
const snapshotMode = new URLSearchParams(window.location.search).has('snapshot')

const view = new ArenaView(canvas)
let battle = createBattle()
let running = !snapshotMode
let previousFrame = performance.now()
let accumulator = 0
const fixedStep = 1 / 60

function frame(now: number): void {
  const elapsed = Math.min((now - previousFrame) / 1000, 0.1)
  previousFrame = now

  if (running && battle.phase === 'running') {
    accumulator += elapsed
    while (accumulator >= fixedStep) {
      battle = stepBattle(battle, fixedStep)
      accumulator -= fixedStep
    }
  }

  renderUi()
  view.sync(battle)
  requestAnimationFrame(frame)
}

function renderUi(): void {
  for (const fighter of battle.fighters) {
    required<HTMLElement>(`[data-hp="${fighter.id}"]`).textContent = String(fighter.hp)
    required<HTMLElement>(`[data-health="${fighter.id}"]`).style.width = `${(fighter.hp / fighter.maxHp) * 100}%`
  }

  if (battle.phase === 'finished') {
    const winner = battle.fighters.find(({ id }) => id === battle.winnerId)
    status.textContent = winner ? `${winner.name} wins` : 'Draw'
    toggleButton.textContent = 'Bout finished'
    toggleButton.disabled = true
  } else {
    status.textContent = running ? 'FIGHT' : 'READY'
    toggleButton.textContent = running ? 'Pause bout' : 'Start bout'
    toggleButton.disabled = false
  }

  feed.replaceChildren(...battle.events.slice().reverse().map((event) => {
    const item = document.createElement('li')
    item.innerHTML = `<time>${event.at.toFixed(1)}s</time><span>${event.message}</span>`
    return item
  }))
}

toggleButton.addEventListener('click', () => {
  running = !running
  previousFrame = performance.now()
  renderUi()
})

resetButton.addEventListener('click', () => {
  battle = createBattle()
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
    for (let elapsed = 0; elapsed < seconds && battle.phase === 'running'; elapsed += fixedStep) {
      battle = stepBattle(battle, fixedStep)
    }
    renderUi()
    view.sync(battle)
  },
  reset: () => {
    battle = createBattle()
    running = false
    renderUi()
  },
}
