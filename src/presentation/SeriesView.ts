import { formatBattleFeed } from './battleFeed'
import { getAssignmentComparison, type BoutIndex, type SeriesPhase, type SeriesState } from '../simulation/series'
import type { Archetype, FighterDefinition, FighterSide } from '../simulation/fighters'
import { fighterBySide, type BattleState } from '../simulation/battle'

export type SeriesIntent =
  | { type: 'assign'; fighterId: string; boutIndex: BoutIndex }
  | { type: 'unassign'; boutIndex: BoutIndex }
  | { type: 'confirm' }
  | { type: 'start-next' }
  | { type: 'rematch' }
  | { type: 'toggle-pause' }
  | { type: 'set-speed'; speed: 1 | 2 | 4 }

export interface RuntimeViewState { paused: boolean; speed: 1 | 2 | 4 }

const BOUT_NUMERALS = ['I', 'II', 'III'] as const
const RC = { enDash: '\u2013', middleDot: '\u00b7', times: '\u00d7', arrow: '\u2192', emDash: '\u2014' }
const ARCHETYPE_LABELS: Record<Archetype, string> = { heavy: 'Heavy', fast: 'Fast', technical: 'Technical' }

type PendingFocus = { mode: 'after-assign' } | { mode: 'after-unassign'; fighterId: string }

function isLineupComplete(state: SeriesState): boolean {
  return state.assignments.every((id) => id !== null)
}

function fighterName(roster: readonly FighterDefinition[], id: string): string {
  return roster.find(({ id: fighterId }) => fighterId === id)?.name ?? id
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Readonly<Record<string, string>> = {},
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value
    else node.setAttribute(key, value)
  }
  if (text !== undefined) node.textContent = text
  return node
}

export class SeriesView {
  private readonly shell: HTMLElement
  private readonly onIntent: (intent: SeriesIntent) => void
  private selectedFighterId: string | null = null
  private lastRenderedPhase: SeriesPhase | null = null
  private lastState: SeriesState | null = null
  private lastRuntime: RuntimeViewState | null = null
  private pendingFocus: PendingFocus | null = null
  private lastFeedEventId = -1

  constructor(shell: HTMLElement, onIntent: (intent: SeriesIntent) => void) {
    this.shell = shell
    this.onIntent = onIntent
    shell.addEventListener('click', (event) => this.handleClick(event))
    shell.addEventListener('keydown', (event) => this.handleKeyDown(event))
  }

  render(state: SeriesState, runtime: RuntimeViewState): void {
    this.lastState = state
    this.lastRuntime = runtime
    const phaseChanged = this.lastRenderedPhase !== null && state.phase !== this.lastRenderedPhase
    if (phaseChanged) this.selectedFighterId = null
    this.shell.dataset.phase = state.phase
    const battleUi = this.shell.querySelector<HTMLElement>('#battle-ui')
    if (battleUi) battleUi.hidden = state.phase === 'planning' || state.phase === 'summary'
    if (phaseChanged || state.phase !== 'fighting') this.rebuildShell(state, runtime)
    else this.updateBattleUi(state, runtime)
    this.lastRenderedPhase = state.phase
    this.applyFocus(state, phaseChanged)
  }

  private rebuildShell(state: SeriesState, runtime: RuntimeViewState): void {
    this.buildControls(state, runtime)
    const seriesUi = this.shell.querySelector<HTMLElement>('#series-ui')
    if (seriesUi) {
      if (state.phase === 'planning') seriesUi.replaceChildren(this.buildPlanning(state))
      else if (state.phase === 'between-bouts') seriesUi.replaceChildren(this.buildInterstitial(state))
      else if (state.phase === 'summary') seriesUi.replaceChildren(this.buildSummary(state))
      else seriesUi.replaceChildren()
    }
    if (state.phase === 'fighting') this.buildBattleUi(state)
    else this.clearBattleUi()
  }

  private updateBattleUi(state: SeriesState, runtime: RuntimeViewState): void {
    this.updateControls(runtime)
    const homeCard = this.shell.querySelector<HTMLElement>('[data-testid="active-home"]')
    if (!homeCard?.firstChild) {
      this.buildBattleUi(state)
      return
    }
    const awayCard = this.shell.querySelector<HTMLElement>('[data-testid="active-away"]')
    const status = this.shell.querySelector<HTMLElement>('[data-testid="battle-status"]')
    const feed = this.shell.querySelector<HTMLElement>('[data-testid="battle-feed"]')
    this.updateHp(homeCard, 'home', state.activeBattle)
    if (awayCard) this.updateHp(awayCard, 'away', state.activeBattle)
    if (status) this.updateStatus(status, state)
    if (feed) this.updateFeed(feed, state)
  }

  private renderFromLast(): void {
    if (!this.lastState || !this.lastRuntime) return
    this.rebuildShell(this.lastState, this.lastRuntime)
  }

  private handleClick(event: MouseEvent): void {
    const target = (event.target as Element | null)?.closest<HTMLElement>('[data-action]')
    if (!target) return
    const action = target.dataset.action
    switch (action) {
      case 'select-fighter': {
        const fighterId = target.dataset.fighterId
        if (!fighterId) return
        this.selectedFighterId = this.selectedFighterId === fighterId ? null : fighterId
        this.renderFromLast()
        this.shell.querySelector<HTMLElement>(`[data-testid="fighter-${fighterId}"]`)?.focus()
        return
      }
      case 'pick-slot': {
        const boutIndex = this.parseSlot(target)
        if (boutIndex === null || this.selectedFighterId === null) return
        this.pendingFocus = { mode: 'after-assign' }
        this.onIntent({ type: 'assign', fighterId: this.selectedFighterId, boutIndex })
        this.selectedFighterId = null
        return
      }
      case 'remove-assignment': {
        const boutIndex = this.parseSlot(target)
        if (boutIndex === null) return
        const returned = this.lastState?.assignments[boutIndex]
        if (returned !== null && returned !== undefined) this.pendingFocus = { mode: 'after-unassign', fighterId: returned }
        this.onIntent({ type: 'unassign', boutIndex })
        return
      }
      case 'confirm':
        this.onIntent({ type: 'confirm' })
        return
      case 'start-next':
        this.onIntent({ type: 'start-next' })
        return
      case 'rematch':
        this.onIntent({ type: 'rematch' })
        return
      case 'toggle-pause':
        this.onIntent({ type: 'toggle-pause' })
        return
      case 'set-speed': {
        const speed = Number(target.dataset.speed)
        if (speed === 1 || speed === 2 || speed === 4) this.onIntent({ type: 'set-speed', speed })
        return
      }
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || this.selectedFighterId === null) return
    const cleared = this.selectedFighterId
    this.selectedFighterId = null
    this.renderFromLast()
    this.shell.querySelector<HTMLElement>(`[data-testid="fighter-${cleared}"]`)?.focus()
  }

  private parseSlot(target: HTMLElement): BoutIndex | null {
    const raw = target.dataset.slotIndex
    const value = raw === undefined ? Number.NaN : Number(raw)
    return value === 0 || value === 1 || value === 2 ? (value as BoutIndex) : null
  }

  private applyFocus(state: SeriesState, phaseChanged: boolean): void {
    if (phaseChanged) {
      const selector =
        state.phase === 'planning' ? '#planning-heading'
          : state.phase === 'fighting' ? '[data-testid="battle-status"]'
            : state.phase === 'between-bouts' ? '#interstitial-heading'
              : '#summary-heading'
      this.shell.querySelector<HTMLElement>(selector)?.focus()
      this.pendingFocus = null
      return
    }
    if (state.phase !== 'planning' || this.pendingFocus === null) return
    if (this.pendingFocus.mode === 'after-assign') {
      if (isLineupComplete(state)) {
        this.shell.querySelector<HTMLElement>('[data-testid="confirm-lineup"]')?.focus()
      } else {
        const firstUnassigned = state.homeRoster.find(({ id }) => !state.assignments.includes(id))
        if (firstUnassigned) this.shell.querySelector<HTMLElement>(`[data-testid="fighter-${firstUnassigned.id}"]`)?.focus()
      }
    } else {
      this.shell.querySelector<HTMLElement>(`[data-testid="fighter-${this.pendingFocus.fighterId}"]`)?.focus()
    }
    this.pendingFocus = null
  }

  private buildControls(state: SeriesState, runtime: RuntimeViewState): void {
    const container = this.shell.querySelector<HTMLElement>('[data-testid="runtime-controls"]')
    if (!container) return
    if (state.phase !== 'fighting') {
      container.replaceChildren()
      return
    }
    if (container.childElementCount > 0) {
      this.updateControls(runtime)
      return
    }
    const pause = el('button', { class: 'button', type: 'button', 'data-action': 'toggle-pause', 'data-testid': 'toggle-pause', 'aria-pressed': String(runtime.paused) }, runtime.paused ? 'Resume' : 'Pause')
    const group = el('div', { class: 'speed-control', role: 'group', 'aria-label': 'Bout speed' })
    for (const speed of [1, 2, 4] as const) {
      group.append(el('button', { class: 'button speed-control__button', type: 'button', 'data-action': 'set-speed', 'data-speed': String(speed), 'data-testid': `speed-${speed}`, 'aria-pressed': String(runtime.speed === speed) }, `${RC.times}${speed}`))
    }
    container.replaceChildren(pause, group)
  }

  private updateControls(runtime: RuntimeViewState): void {
    const container = this.shell.querySelector<HTMLElement>('[data-testid="runtime-controls"]')
    if (!container) return
    const pause = container.querySelector<HTMLElement>('[data-action="toggle-pause"]')
    if (pause) {
      pause.textContent = runtime.paused ? 'Resume' : 'Pause'
      pause.setAttribute('aria-pressed', String(runtime.paused))
    }
    for (const speed of [1, 2, 4] as const) {
      const button = container.querySelector<HTMLElement>(`[data-action="set-speed"][data-speed="${speed}"]`)
      button?.setAttribute('aria-pressed', String(runtime.speed === speed))
    }
  }

  private buildPlanning(state: SeriesState): HTMLElement {
    const section = el('section', { class: 'planning', 'aria-labelledby': 'planning-heading' })
    const heading = el('h2', { id: 'planning-heading', tabindex: '-1' }, 'Plan the series')
    const instruction = el('p', { id: 'assignment-instruction', class: 'planning__instruction' }, this.instructionText(state))
    const counterRule = el('p', { class: 'planning__counter-rule' }, `Heavy ${RC.arrow} Fast ${RC.arrow} Technical ${RC.arrow} Heavy`)
    const roster = el('div', { class: 'roster-grid' })
    for (const fighter of state.homeRoster) roster.append(this.buildFighterOption(state, fighter))
    const matchups = el('ol', { class: 'matchup-list', 'aria-label': 'Matchup slots' })
    for (let index = 0; index < state.opponents.length; index += 1) {
      matchups.append(this.buildMatchupSlot(state, index as BoutIndex))
    }
    const confirm = el('button', { class: 'button button--primary planning__confirm', type: 'button', 'data-action': 'confirm', 'data-testid': 'confirm-lineup' }, 'Confirm lineup')
    confirm.disabled = !isLineupComplete(state)
    section.append(heading, instruction, counterRule, roster, matchups, confirm)
    return section
  }

  private buildFighterOption(state: SeriesState, fighter: FighterDefinition): HTMLButtonElement {
    const assignedIndex = state.assignments.indexOf(fighter.id)
    const selected = this.selectedFighterId === fighter.id
    const button = el('button', {
      class: 'fighter-option',
      type: 'button',
      'data-action': 'select-fighter',
      'data-fighter-id': fighter.id,
      'data-testid': `fighter-${fighter.id}`,
      'data-role': 'home-fighter',
      'aria-pressed': String(selected),
      'aria-describedby': 'assignment-instruction',
    })
    const title = el('span', { class: 'fighter-option__title' })
    title.append(
      el('span', { class: 'fighter-option__name' }, fighter.name),
      el('span', { class: 'fighter-option__archetype' }, ARCHETYPE_LABELS[fighter.archetype]),
    )
    button.append(
      title,
      el('span', { class: 'fighter-option__school' }, fighter.school),
      el('span', { class: 'fighter-option__stats' }, `HP ${fighter.maxHp} ${RC.middleDot} Power ${fighter.power} ${RC.middleDot} Defense ${Math.round(fighter.defenseChance * 100)}% ${RC.middleDot} Accuracy ${Math.round(fighter.accuracy * 100)}% ${RC.middleDot} Critical ${Math.round(fighter.criticalChance * 100)}%`),
      el('span', { class: 'fighter-option__assignment' }, assignedIndex === -1 ? 'Unassigned' : `Bout ${BOUT_NUMERALS[assignedIndex]}`),
    )
    return button
  }

  private buildMatchupSlot(state: SeriesState, boutIndex: BoutIndex): HTMLLIElement {
    const opponent = state.opponents[boutIndex]
    const assignedId = state.assignments[boutIndex]
    const item = el('li', { class: 'matchup-slot' })
    if (assignedId !== null) item.classList.add('matchup-slot--occupied')

    const pick = el('button', {
      class: 'matchup-slot__pick',
      type: 'button',
      'data-action': 'pick-slot',
      'data-slot-index': String(boutIndex),
      'data-testid': `slot-${boutIndex}`,
      'data-role': 'opponent-slot',
      'aria-describedby': 'assignment-instruction',
    })
    const opponentBlock = el('span', { class: 'matchup-slot__fighter' })
    opponentBlock.append(
      el('strong', {}, opponent.name),
      el('small', {}, opponent.school),
      el('em', {}, ARCHETYPE_LABELS[opponent.archetype]),
    )
    pick.append(
      el('span', { class: 'matchup-slot__numeral' }, BOUT_NUMERALS[boutIndex]),
      opponentBlock,
      el('span', { class: 'matchup-slot__stats' }, `HP ${opponent.maxHp} ${RC.middleDot} Power ${opponent.power} ${RC.middleDot} Defense ${Math.round(opponent.defenseChance * 100)}% ${RC.middleDot} Accuracy ${Math.round(opponent.accuracy * 100)}% ${RC.middleDot} Critical ${Math.round(opponent.criticalChance * 100)}%`),
    )

    if (assignedId !== null) {
      const homeName = fighterName(state.homeRoster, assignedId)
      const comparison = getAssignmentComparison(state, assignedId, boutIndex)
      pick.append(
        el('span', { class: 'matchup-slot__assigned' }, homeName),
        el('span', { class: 'comparison-badge', 'data-comparison': comparison }, comparison),
      )
      const remove = el('button', {
        class: 'matchup-slot__remove',
        type: 'button',
        'data-action': 'remove-assignment',
        'data-slot-index': String(boutIndex),
        'aria-label': `Remove ${homeName} from bout ${BOUT_NUMERALS[boutIndex]}`,
      }, 'Remove')
      item.append(pick, remove)
    } else {
      item.append(pick)
    }
    return item
  }

  private instructionText(state: SeriesState): string {
    if (this.selectedFighterId !== null) {
      const name = fighterName(state.homeRoster, this.selectedFighterId)
      const assignedIndex = state.assignments.indexOf(this.selectedFighterId)
      return assignedIndex === -1
        ? `${name} selected. Choose a bout slot, or press Escape to clear.`
        : `${name} is assigned to bout ${BOUT_NUMERALS[assignedIndex]}. Choose a different slot to move them, or press Escape to clear.`
    }
    const assignedCount = state.assignments.filter((id) => id !== null).length
    return assignedCount === 0
      ? 'Select a gladiator, then choose one of the three bout slots.'
      : `${assignedCount} of 3 matchups assigned. Select a gladiator, then choose a bout slot.`
  }

  private buildInterstitial(state: SeriesState): HTMLElement {
    const result = state.results[state.results.length - 1]
    const section = el('section', { class: 'interstitial', 'aria-labelledby': 'interstitial-heading' })
    if (!result) return section
    const heading = el('h2', { id: 'interstitial-heading', tabindex: '-1' }, 'Between bouts')
    const homeName = fighterName(state.homeRoster, result.homeFighterId)
    const awayName = fighterName(state.opponents, result.opponentId)
    const winnerName = result.winnerSide === 'home' ? homeName : awayName
    const endedText = result.endedBy === 'defeat' ? 'by defeat' : 'on the time limit'
    const resultLine = el('p', { class: 'interstitial__result', 'aria-live': 'polite', 'data-testid': 'bout-result-summary' }, `Bout ${BOUT_NUMERALS[result.boutIndex]}: ${winnerName} wins ${endedText}.`)
    const scoreLine = el('p', { class: 'interstitial__score' }, `Series ${state.score.home}${RC.enDash}${state.score.away}`)
    const nextLine = el('p', { class: 'interstitial__next', 'data-testid': 'next-matchup' })
    const nextBoutIndex = state.results.length as BoutIndex
    const nextOpponent = state.opponents[nextBoutIndex]
    const nextHomeId = state.assignments[nextBoutIndex]
    if (nextOpponent && nextHomeId) {
      const comparison = getAssignmentComparison(state, nextHomeId, nextBoutIndex)
      nextLine.textContent = `Next: ${fighterName(state.homeRoster, nextHomeId)} vs ${nextOpponent.name} ${RC.emDash} ${comparison}.`
    }
    const start = el('button', { class: 'button button--primary', type: 'button', 'data-action': 'start-next', 'data-testid': 'start-next-bout' }, 'Start next bout')
    section.append(heading, resultLine, scoreLine, nextLine, start)
    return section
  }

  private buildSummary(state: SeriesState): HTMLElement {
    const section = el('section', { class: 'summary', 'aria-labelledby': 'summary-heading' })
    const victory = state.score.home > state.score.away
    const heading = el('h2', { id: 'summary-heading', tabindex: '-1' }, victory ? 'School victory' : 'School defeat')
    const scoreLine = el('p', { class: 'summary__score', 'aria-live': 'polite', 'data-testid': 'series-score' }, `${state.score.home}${RC.enDash}${state.score.away}`)
    const verdict = el('p', { class: 'summary__verdict', 'aria-live': 'polite' }, victory ? 'Victory for the House of Mars!' : 'Defeat for the House of Mars.')
    const list = el('ol', { class: 'summary__bouts' })
    for (const result of state.results) list.append(this.buildSummaryBout(state, result))
    const rematch = el('button', { class: 'button button--primary', type: 'button', 'data-action': 'rematch', 'data-testid': 'rematch' }, 'Rematch')
    section.append(heading, scoreLine, verdict, list, rematch)
    return section
  }

  private buildSummaryBout(state: SeriesState, result: NonNullable<SeriesState['results'][number]>): HTMLLIElement {
    const homeName = fighterName(state.homeRoster, result.homeFighterId)
    const awayName = fighterName(state.opponents, result.opponentId)
    const winnerName = result.winnerSide === 'home' ? homeName : awayName
    const homePercent = Math.round(result.remainingHpRatio.home * 100)
    const awayPercent = Math.round(result.remainingHpRatio.away * 100)
    const endedText = result.endedBy === 'defeat' ? 'by defeat' : 'on the time limit'
    return el('li', { class: 'summary__bout', 'data-testid': 'bout-result' },
      `Bout ${BOUT_NUMERALS[result.boutIndex]} ${RC.emDash} ${homeName} vs ${awayName}: ${winnerName} won ${endedText}. Home ${result.advantage}. Remaining: ${homeName} ${homePercent}%, ${awayName} ${awayPercent}%.`)
  }

  private buildBattleUi(state: SeriesState): void {
    this.lastFeedEventId = -1
    const homeCard = this.shell.querySelector<HTMLElement>('[data-testid="active-home"]')
    const awayCard = this.shell.querySelector<HTMLElement>('[data-testid="active-away"]')
    const status = this.shell.querySelector<HTMLElement>('[data-testid="battle-status"]')
    const feed = this.shell.querySelector<HTMLElement>('[data-testid="battle-feed"]')
    if (homeCard) this.buildFighterCard(homeCard, 'home', state.activeBattle)
    if (awayCard) this.buildFighterCard(awayCard, 'away', state.activeBattle)
    if (status) this.updateStatus(status, state)
    if (feed) this.updateFeed(feed, state)
  }

  private clearBattleUi(): void {
    for (const testId of ['active-home', 'active-away']) {
      const card = this.shell.querySelector<HTMLElement>(`[data-testid="${testId}"]`)
      if (card?.firstChild) card?.replaceChildren()
    }
  }

  private buildFighterCard(container: HTMLElement, side: FighterSide, battle: BattleState | undefined): void {
    const fighter = battle ? fighterBySide(battle, side) : undefined
    if (!fighter) {
      container.replaceChildren()
      return
    }
    container.className = side === 'home' ? 'fighter-card fighter-card--home' : 'fighter-card fighter-card--away'
    const definition = fighter.definition
    const title = el('div', { class: 'fighter-card__title' })
    const label = el('div', {})
    label.append(el('small', {}, definition.school), el('h2', {}, definition.name))
    title.append(el('span', { class: 'sigil' }, side === 'home' ? 'I' : 'II'), label, el('strong', { 'data-hp': side }, String(fighter.hp)))
    const health = el('div', { class: 'health' })
    const bar = el('i', { 'data-health': side })
    bar.style.width = `${(fighter.hp / definition.maxHp) * 100}%`
    health.append(bar)
    container.replaceChildren(title, health)
  }

  private updateHp(container: HTMLElement | null, side: FighterSide, battle: BattleState | undefined): void {
    const fighter = battle ? fighterBySide(battle, side) : undefined
    if (!fighter || !container?.firstChild) return
    const hp = container.querySelector<HTMLElement>(`[data-hp="${side}"]`)
    const bar = container.querySelector<HTMLElement>(`[data-health="${side}"]`)
    if (hp) hp.textContent = String(fighter.hp)
    if (bar) bar.style.width = `${(fighter.hp / fighter.definition.maxHp) * 100}%`
  }

  private updateStatus(status: HTMLElement, state: SeriesState): void {
    const battle = state.activeBattle
    if (!battle || state.activeBoutIndex === null) {
      status.textContent = ''
      return
    }
    status.textContent = `Bout ${BOUT_NUMERALS[state.activeBoutIndex]} ${RC.middleDot} ${fighterBySide(battle, 'home').definition.name} vs ${fighterBySide(battle, 'away').definition.name}`
  }

  private updateFeed(feed: HTMLElement, state: SeriesState): void {
    const battle = state.activeBattle
    if (!battle) {
      feed.replaceChildren()
      this.lastFeedEventId = -1
      return
    }
    const latestEventId = battle.events.at(-1)?.id ?? -1
    if (latestEventId === this.lastFeedEventId) return
    this.lastFeedEventId = latestEventId
    const entries = formatBattleFeed(battle.events, {
      [battle.descriptor.homeId]: fighterBySide(battle, 'home').definition.name,
      [battle.descriptor.awayId]: fighterBySide(battle, 'away').definition.name,
    })
    feed.replaceChildren(...entries.slice().reverse().map((entry) => {
      const item = document.createElement('li')
      item.append(el('time', {}, `${entry.atSeconds.toFixed(1)}s`), el('span', {}, entry.message))
      return item
    }))
  }
}
