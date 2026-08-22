import { formatBattleFeed } from './battleFeed'
import { getAssignmentComparison, requiredAssignmentCount, type BoutIndex, type BoutOutcome, type PlanningSlot, type SeriesPhase, type SeriesState } from '../simulation/series'
import type { Archetype, FighterDefinition, FighterSide } from '../simulation/fighters'
import { fighterBySide, type BattleState } from '../simulation/battle'
import { isFightable, startingHpFor } from '../simulation/condition'
import type { RosterEntry } from '../simulation/season'
import type { DispositionId } from '../simulation/disposition'
import { CONDITION_LABELS, fightTelegraph, restTelegraph } from './conditionTelegraph'
import { ORDER_LABELS, ORDER_TELEGRAPHS, TEMPERAMENT_DESCRIPTIONS, TEMPERAMENT_LABELS } from './dispositionLabels'
import { formatPower } from './formatPower'

export type SeriesIntent =
  | { type: 'assign'; fighterId: string; boutIndex: BoutIndex }
  | { type: 'unassign'; boutIndex: BoutIndex }
  | { type: 'confirm' }
  | { type: 'start-next' }
  | { type: 'continue' }
  | { type: 'toggle-pause' }
  | { type: 'set-speed'; speed: 1 | 2 | 4 }
  | { type: 'toggle-sound' }
  | { type: 'set-order'; boutIndex: BoutIndex; order: DispositionId }

export interface RuntimeViewState { paused: boolean; speed: 1 | 2 | 4; soundEnabled: boolean }

const BOUT_NUMERALS = ['I', 'II', 'III'] as const
const RC = { enDash: '\u2013', middleDot: '\u00b7', times: '\u00d7', arrow: '\u2192', emDash: '\u2014' }
const ARCHETYPE_LABELS: Record<Archetype, string> = { heavy: 'Heavy', fast: 'Fast', technical: 'Technical' }

type PendingFocus = { mode: 'after-assign' } | { mode: 'after-unassign'; fighterId: string }

function assignedCount(state: SeriesState): number {
  return state.assignments.filter((slot) => slot !== null).length
}

/**
 * Whether the lineup can be confirmed -- measured against
 * `requiredAssignmentCount` (`min(3, fightable roster size)`, series.ts), the
 * exact predicate `confirmLineup` itself enforces, NOT "all three slots
 * filled". `assignFighter` moves a gladiator between slots rather than
 * cloning them, so a short-handed series (fewer than three fightable
 * gladiators, the forfeit case) can never fill all three: reading
 * completeness as "every slot occupied" left the confirm button permanently
 * disabled there and the season unfinishable in a production build, where
 * the dev command API does not exist.
 */
function isLineupReady(state: SeriesState): boolean {
  return assignedCount(state) === requiredAssignmentCount(state)
}

/** Task 3 turned `assignments` entries from a bare fighter id into a
 * `PlanningSlot`; this is the one place that unwraps it back to an id
 * (or `null` for an empty slot), so every read site below stays a plain
 * string comparison. */
function slotFighterId(slot: PlanningSlot): string | null {
  return slot?.fighterId ?? null
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
  /** The season's full roster (fightable and broken alike), as of the last
   * `render()` call -- `SeriesState.homeRoster` only ever carries fightable
   * gladiators (see its own doc comment in `series.ts`), so the planning
   * screen's condition badges/telegraphs and its disabled-broken row both
   * need this wider list, which only the season layer can supply. */
  private lastRoster: readonly RosterEntry[] = []
  private pendingFocus: PendingFocus | null = null
  private lastFeedEventId = -1

  constructor(shell: HTMLElement, onIntent: (intent: SeriesIntent) => void) {
    this.shell = shell
    this.onIntent = onIntent
    shell.addEventListener('click', (event) => this.handleClick(event))
    shell.addEventListener('keydown', (event) => this.handleKeyDown(event))
  }

  render(state: SeriesState, runtime: RuntimeViewState, roster: readonly RosterEntry[]): void {
    this.lastState = state
    this.lastRuntime = runtime
    this.lastRoster = roster
    const phaseChanged = this.lastRenderedPhase !== null && state.phase !== this.lastRenderedPhase
    if (phaseChanged) this.selectedFighterId = null
    this.shell.dataset.phase = state.phase
    const battleUi = this.shell.querySelector<HTMLElement>('#battle-ui')
    if (battleUi) battleUi.hidden = state.phase === 'planning' || state.phase === 'summary'
    // `.battle-feed` used to be a child of `#battle-ui` and inherited its
    // `hidden` state for free. It now lives in `.below-arena-row` instead (a
    // sibling of `#battle-ui`, style.css) so the dev-only decision panel
    // (`?debugDecisions=1`) can share that row with it without the panel
    // itself being forced to live -- and disappear -- inside `#battle-ui`,
    // where it would be invisible before a bout starts. Mirroring the same
    // condition here keeps the feed hidden/shown exactly when it always was.
    const battleFeed = this.shell.querySelector<HTMLElement>('.battle-feed')
    if (battleFeed) battleFeed.hidden = state.phase === 'planning' || state.phase === 'summary'
    if (phaseChanged || state.phase !== 'fighting') this.rebuildShell(state, runtime)
    else this.updateBattleUi(state, runtime)
    this.lastRenderedPhase = state.phase
    this.applyFocus(state, phaseChanged)
  }

  /** Empties the series screen while the season board/summary owns it
   * instead (`main.ts`, whenever `SeasonState.activeSeries` is `null`).
   * Deliberately does NOT reset `lastRenderedPhase`: the season board can sit
   * between two series for an arbitrary number of renders, and keeping it at
   * whatever `SeriesPhase` the last series ended on ('summary', ordinarily)
   * means the next series's first render is still correctly detected as a
   * phase change (`'summary' !== 'planning'`) -- so "Plan the series" keeps
   * getting auto-focused exactly like every other phase transition.
   * Resetting to `null` here would silently suppress that, since `null` is
   * reserved for "no real render has ever happened yet" (this class's own
   * initial value). */
  clear(): void {
    this.selectedFighterId = null
    this.pendingFocus = null
    const seriesUi = this.shell.querySelector<HTMLElement>('#series-ui')
    seriesUi?.replaceChildren()
    const battleUi = this.shell.querySelector<HTMLElement>('#battle-ui')
    if (battleUi) battleUi.hidden = true
    const battleFeed = this.shell.querySelector<HTMLElement>('.battle-feed')
    if (battleFeed) battleFeed.hidden = true
    this.clearBattleUi()
    const controls = this.shell.querySelector<HTMLElement>('[data-testid="runtime-controls"]')
    controls?.replaceChildren()
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
        // Clear the selection BEFORE dispatching: `onIntent` re-renders
        // synchronously, and the render reads `selectedFighterId`. Clearing
        // afterwards left the instruction line promising "choose a different
        // slot to move them, or press Escape to clear" against a selection
        // that was already gone -- and since the runtime re-renders only when
        // the season object changes, that stale sentence survived until the
        // player's next action, not merely one frame.
        const fighterId = this.selectedFighterId
        this.selectedFighterId = null
        this.pendingFocus = { mode: 'after-assign' }
        this.onIntent({ type: 'assign', fighterId, boutIndex })
        return
      }
      case 'remove-assignment': {
        const boutIndex = this.parseSlot(target)
        if (boutIndex === null) return
        const returned = slotFighterId(this.lastState?.assignments[boutIndex] ?? null)
        if (returned !== null) this.pendingFocus = { mode: 'after-unassign', fighterId: returned }
        this.onIntent({ type: 'unassign', boutIndex })
        return
      }
      case 'confirm':
        this.onIntent({ type: 'confirm' })
        return
      case 'start-next':
        this.onIntent({ type: 'start-next' })
        return
      case 'continue':
        this.onIntent({ type: 'continue' })
        return
      case 'toggle-pause':
        this.onIntent({ type: 'toggle-pause' })
        return
      case 'toggle-sound':
        this.onIntent({ type: 'toggle-sound' })
        return
      case 'set-speed': {
        const speed = Number(target.dataset.speed)
        if (speed === 1 || speed === 2 || speed === 4) this.onIntent({ type: 'set-speed', speed })
        return
      }
      case 'set-order': {
        const boutIndex = this.parseSlot(target)
        const order = target.dataset.order
        if (boutIndex === null || order === undefined || !['standard', 'press', 'guarded'].includes(order)) return
        this.onIntent({ type: 'set-order', boutIndex, order: order as DispositionId })
        this.shell.querySelector<HTMLElement>(`[data-testid="order-${boutIndex}-${order}"]`)?.focus()
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
      if (isLineupReady(state)) {
        this.shell.querySelector<HTMLElement>('[data-testid="confirm-lineup"]')?.focus()
      } else {
        const firstUnassigned = state.homeRoster.find(({ id }) => !state.assignments.some((slot) => slotFighterId(slot) === id))
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
    const sound = el('button', { class: 'button', type: 'button', 'data-action': 'toggle-sound', 'data-testid': 'toggle-sound', 'aria-pressed': String(runtime.soundEnabled) }, runtime.soundEnabled ? 'Sound on' : 'Sound off')
    const group = el('div', { class: 'speed-control', role: 'group', 'aria-label': 'Bout speed' })
    for (const speed of [1, 2, 4] as const) {
      group.append(el('button', { class: 'button speed-control__button', type: 'button', 'data-action': 'set-speed', 'data-speed': String(speed), 'data-testid': `speed-${speed}`, 'aria-pressed': String(runtime.speed === speed) }, `${RC.times}${speed}`))
    }
    container.replaceChildren(pause, sound, group)
  }

  private updateControls(runtime: RuntimeViewState): void {
    const container = this.shell.querySelector<HTMLElement>('[data-testid="runtime-controls"]')
    if (!container) return
    const pause = container.querySelector<HTMLElement>('[data-action="toggle-pause"]')
    if (pause) {
      pause.textContent = runtime.paused ? 'Resume' : 'Pause'
      pause.setAttribute('aria-pressed', String(runtime.paused))
    }
    const sound = container.querySelector<HTMLElement>('[data-action="toggle-sound"]')
    if (sound) {
      sound.textContent = runtime.soundEnabled ? 'Sound on' : 'Sound off'
      sound.setAttribute('aria-pressed', String(runtime.soundEnabled))
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
    // Every gladiator in the season roster gets a card, in roster order:
    // fightable ones as buttons, broken ones as disabled cards carrying the
    // rest forecast. The design doc's UI section calls for exactly that
    // ("`broken` cards are disabled and labelled"); dropping them from the
    // grid entirely hid one half of the decision the screen exists to
    // support -- what fielding costs versus what resting would restore.
    const roster = el('div', { class: 'roster-grid' })
    const fightableIds = new Set(state.homeRoster.map(({ id }) => id))
    for (const entry of this.lastRoster) {
      roster.append(fightableIds.has(entry.fighter.id)
        ? this.buildFighterOption(state, entry.fighter)
        : this.buildUnavailableFighterCard(entry))
    }
    const matchups = el('ol', { class: 'matchup-list', 'aria-label': 'Matchup slots' })
    for (let index = 0; index < state.opponents.length; index += 1) {
      matchups.append(this.buildMatchupSlot(state, index as BoutIndex))
    }
    const confirm = el('button', { class: 'button button--primary planning__confirm', type: 'button', 'data-action': 'confirm', 'data-testid': 'confirm-lineup' }, 'Confirm lineup')
    confirm.disabled = !isLineupReady(state)
    section.append(heading, instruction, counterRule, roster, matchups, confirm)
    // The season only ever hands the planning screen its fightable
    // gladiators (`SeriesState.homeRoster`) -- a broken one is simply absent
    // from the cards above, with no on-screen trace of them at all. This row
    // (present only while the wider season roster actually has one) makes
    // that absence explicit, and its reason, rather than silent.
    const disabled = this.buildDisabledRosterRow(state)
    if (disabled) section.append(disabled)
    // `requiredAssignmentCount` is `min(3, fightable)` -- below three, the
    // series will forfeit whichever slots the player cannot fill, and the
    // player should know that before confirming, not discover it in the
    // between-bouts screen.
    if (requiredAssignmentCount(state) < 3) section.append(this.buildForfeitNotice(state))
    return section
  }

  /** A broken gladiator's card: same shape as a fightable one, disabled, and
   * carrying the rest forecast — the only move available for them this series. */
  private buildUnavailableFighterCard(entry: RosterEntry): HTMLButtonElement {
    const card = el('button', {
      class: 'fighter-option fighter-option--unavailable',
      type: 'button',
      'data-fighter-id': entry.fighter.id,
      'data-testid': `fighter-${entry.fighter.id}`,
      'data-role': 'unavailable-fighter',
    })
    card.disabled = true
    const title = el('span', { class: 'fighter-option__title' })
    title.append(
      el('span', { class: 'fighter-option__name' }, entry.fighter.name),
      el('span', { class: 'fighter-option__archetype' }, ARCHETYPE_LABELS[entry.fighter.archetype]),
    )
    const conditionRow = el('span', { class: 'fighter-option__condition' })
    conditionRow.append(
      el('span', { class: 'condition-badge', 'data-testid': 'condition-badge', 'data-condition': entry.condition }, CONDITION_LABELS[entry.condition]),
      el('span', { class: 'fighter-option__hp' }, 'Cannot fight this series'),
    )
    card.append(title, conditionRow, el('span', { class: 'fighter-option__telegraph' }, restTelegraph(entry.condition)))
    return card
  }

  private buildDisabledRosterRow(state: SeriesState): HTMLElement | null {
    const broken = this.lastRoster.filter((entry) => !isFightable(entry.condition) && !state.homeRoster.some(({ id }) => id === entry.fighter.id))
    if (broken.length === 0) return null
    const wrap = el('div', { class: 'roster-disabled', 'data-testid': 'roster-disabled' })
    wrap.append(el('h3', { class: 'roster-disabled__heading' }, 'Unavailable this series'))
    const list = el('ul', { class: 'roster-disabled__list' })
    for (const entry of broken) {
      list.append(el('li', { class: 'roster-disabled__item' }, `${entry.fighter.name} ${RC.emDash} broken, cannot fight this series.`))
    }
    wrap.append(list)
    return wrap
  }

  private buildForfeitNotice(state: SeriesState): HTMLElement {
    const forfeitCount = 3 - requiredAssignmentCount(state)
    return el(
      'p',
      { class: 'planning__forfeit-notice', 'data-testid': 'forfeit-notice' },
      `Only ${state.homeRoster.length} gladiator${state.homeRoster.length === 1 ? ' is' : 's are'} fit to fight ${RC.emDash} ${forfeitCount} slot${forfeitCount === 1 ? '' : 's'} will be forfeited.`,
    )
  }

  private buildFighterOption(state: SeriesState, fighter: FighterDefinition): HTMLButtonElement {
    const assignedIndex = state.assignments.findIndex((slot) => slotFighterId(slot) === fighter.id)
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
      // `formatPower` here too, not the raw number: the opponent's power in
      // the matchup slot beside this card already goes through it, so a home
      // gladiator read `Power 22` next to `Power 19.0` for the same stat.
      el('span', { class: 'fighter-option__stats' }, `HP ${fighter.maxHp} ${RC.middleDot} Power ${formatPower(fighter.power)} ${RC.middleDot} Defense ${Math.round(fighter.defenseChance * 100)}% ${RC.middleDot} Accuracy ${Math.round(fighter.accuracy * 100)}% ${RC.middleDot} Critical ${Math.round(fighter.criticalChance * 100)}%`),
      el('span', { class: 'fighter-option__assignment' }, assignedIndex === -1 ? 'Unassigned' : `Bout ${BOUT_NUMERALS[assignedIndex]}`),
    )
    const entry = this.lastRoster.find((candidate) => candidate.fighter.id === fighter.id)
    if (entry) {
      const conditionRow = el('span', { class: 'fighter-option__condition' })
      conditionRow.append(
        el('span', { class: 'condition-badge', 'data-testid': 'condition-badge', 'data-condition': entry.condition }, CONDITION_LABELS[entry.condition]),
        el('span', { class: 'fighter-option__hp' }, `Starting HP ${startingHpFor(entry.condition, fighter.maxHp)}`),
      )
      button.append(
        conditionRow,
        el('span', { class: 'fighter-option__telegraph' }, fightTelegraph(entry.condition)),
        el('span', { class: 'fighter-option__telegraph' }, restTelegraph(entry.condition)),
      )
    }
    return button
  }

  private buildMatchupSlot(state: SeriesState, boutIndex: BoutIndex): HTMLLIElement {
    const opponent = state.opponents[boutIndex]
    const assignedId = slotFighterId(state.assignments[boutIndex])
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
      this.buildTemperamentBadge(state, boutIndex),
    )
    pick.append(
      el('span', { class: 'matchup-slot__numeral' }, BOUT_NUMERALS[boutIndex]),
      opponentBlock,
      // `formatPower`: see its own doc comment -- challenge scaling
      // (`content/season.ts`'s `scaleOpponent`) rounds `maxHp` but
      // deliberately leaves `power` a raw float (the balance tuning it feeds
      // needs the unrounded value); shared with `SeasonView.buildChallengeCard`
      // so the two screens never disagree on the same opponent's power.
      el('span', { class: 'matchup-slot__stats' }, `HP ${opponent.maxHp} ${RC.middleDot} Power ${formatPower(opponent.power)} ${RC.middleDot} Defense ${Math.round(opponent.defenseChance * 100)}% ${RC.middleDot} Accuracy ${Math.round(opponent.accuracy * 100)}% ${RC.middleDot} Critical ${Math.round(opponent.criticalChance * 100)}%`),
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
    item.append(this.buildOrderSelector(state, boutIndex))
    return item
  }

  /** Three-way order button group for one bout slot. `role="group"`, not
   * `radiogroup`: the options below are plain `<button aria-pressed>`
   * elements (the same shape `.speed-control`'s three speed buttons already
   * use, `buildControls` above), not `role="radio"`/`aria-checked` --
   * `radiogroup` requires radio-role children, and the project has no
   * roving-tabindex/arrow-key navigation anywhere to back that pattern up.
   * Not nested inside the slot's pick button (nested buttons are invalid
   * HTML); appended to the slot item / interstitial as a sibling. */
  private buildOrderSelector(state: SeriesState, boutIndex: BoutIndex): HTMLElement {
    const wrap = el('div', { class: 'order-selector', role: 'group', 'aria-label': `Bout ${BOUT_NUMERALS[boutIndex]} order` })
    for (const order of ['standard', 'press', 'guarded'] as const) {
      wrap.append(el('button', {
        class: 'button order-selector__button',
        type: 'button',
        'data-action': 'set-order',
        'data-slot-index': String(boutIndex),
        'data-order': order,
        'data-testid': `order-${boutIndex}-${order}`,
        'aria-pressed': String(state.orders[boutIndex] === order),
      }, ORDER_LABELS[order]))
    }
    wrap.append(el('span', { class: 'order-selector__telegraph' }, ORDER_TELEGRAPHS[state.orders[boutIndex]]))
    return wrap
  }

  private buildTemperamentBadge(state: SeriesState, boutIndex: BoutIndex): HTMLElement {
    const temperament = state.opponentDispositions[boutIndex]
    const badge = el('span', {
      class: 'temperament-badge',
      'data-testid': `temperament-${boutIndex}`,
      'data-temperament': temperament,
    }, `${TEMPERAMENT_LABELS[temperament]} ${RC.emDash} ${TEMPERAMENT_DESCRIPTIONS[temperament]}`)
    return badge
  }

  private instructionText(state: SeriesState): string {
    if (this.selectedFighterId !== null) {
      const name = fighterName(state.homeRoster, this.selectedFighterId)
      const assignedIndex = state.assignments.findIndex((slot) => slotFighterId(slot) === this.selectedFighterId)
      return assignedIndex === -1
        ? `${name} selected. Choose a bout slot, or press Escape to clear.`
        : `${name} is assigned to bout ${BOUT_NUMERALS[assignedIndex]}. Choose a different slot to move them, or press Escape to clear.`
    }
    const assigned = assignedCount(state)
    // `requiredAssignmentCount`, not a literal 3: a short-handed series needs
    // fewer assignments (the rest are forfeited), and "2 of 3" there would
    // describe a lineup the player is never allowed to reach.
    return assigned === 0
      ? 'Select a gladiator, then choose one of the three bout slots.'
      : `${assigned} of ${requiredAssignmentCount(state)} matchups assigned. Select a gladiator, then choose a bout slot.`
  }

  private buildInterstitial(state: SeriesState): HTMLElement {
    const result = state.results[state.results.length - 1]
    const section = el('section', { class: 'interstitial', 'aria-labelledby': 'interstitial-heading' })
    if (!result) return section
    const heading = el('h2', { id: 'interstitial-heading', tabindex: '-1' }, 'Between bouts')
    // A forfeit is only reachable here because the planning screen already
    // telegraphed it in advance (`buildForfeitNotice`, above) -- this line
    // just reports which slot it was, distinctly from a fought bout's result.
    const resultText = result.kind === 'forfeit'
      ? `Bout ${BOUT_NUMERALS[result.boutIndex]}: forfeited, no fighter available.`
      : (() => {
          const homeName = fighterName(state.homeRoster, result.homeFighterId)
          const awayName = fighterName(state.opponents, result.opponentId)
          const winnerName = result.winnerSide === 'home' ? homeName : awayName
          const endedText = result.endedBy === 'defeat' ? 'by defeat' : 'on the time limit'
          return `Bout ${BOUT_NUMERALS[result.boutIndex]}: ${winnerName} wins ${endedText}.`
        })()
    const resultLine = el('p', { class: 'interstitial__result', 'aria-live': 'polite', 'data-testid': 'bout-result-summary' }, resultText)
    const scoreLine = el('p', { class: 'interstitial__score' }, `Series ${state.score.home}${RC.enDash}${state.score.away}`)
    const nextLine = el('p', { class: 'interstitial__next', 'data-testid': 'next-matchup' })
    const nextBoutIndex = state.results.length as BoutIndex
    const nextOpponent = state.opponents[nextBoutIndex]
    const nextHomeId = slotFighterId(state.assignments[nextBoutIndex])
    section.append(heading, resultLine, scoreLine, nextLine)
    if (nextOpponent && nextHomeId) {
      const comparison = getAssignmentComparison(state, nextHomeId, nextBoutIndex)
      nextLine.textContent = `Next: ${fighterName(state.homeRoster, nextHomeId)} vs ${nextOpponent.name} ${RC.emDash} ${comparison}.`
      section.append(this.buildTemperamentBadge(state, nextBoutIndex), this.buildOrderSelector(state, nextBoutIndex))
    }
    const start = el('button', { class: 'button button--primary', type: 'button', 'data-action': 'start-next', 'data-testid': 'start-next-bout' }, 'Start next bout')
    section.append(start)
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
    // `Continue`, not `Rematch` (design.md, "Series summary"): `main.ts` runs
    // this button as the season-level `continueSeason` -- it charges the
    // roster's wear, appends the `SeriesRecord` and advances the season, none
    // of it undoable. Labelling that "Rematch" promised a replay and spent
    // three gladiators' condition instead.
    const advance = el('button', { class: 'button button--primary', type: 'button', 'data-action': 'continue', 'data-testid': 'continue-series' }, 'Continue')
    section.append(heading, scoreLine, verdict, list, advance)
    return section
  }

  private buildSummaryBout(state: SeriesState, result: BoutOutcome): HTMLLIElement {
    // Same forfeit reporting as `buildInterstitial`, for the series's own
    // summary screen (the season-wide summary across all three series is
    // `SeasonView.buildOutcomeRow`, a separate rendering of the same
    // `BoutOutcome` union at the season layer).
    if (result.kind === 'forfeit') {
      const awayName = fighterName(state.opponents, result.opponentId)
      return el('li', { class: 'summary__bout', 'data-testid': 'bout-result' },
        `Bout ${BOUT_NUMERALS[result.boutIndex]} ${RC.emDash} forfeited: no gladiator available to face ${awayName}.`)
    }
    const homeName = fighterName(state.homeRoster, result.homeFighterId)
    const awayName = fighterName(state.opponents, result.opponentId)
    const winnerName = result.winnerSide === 'home' ? homeName : awayName
    const homePercent = Math.round(result.remainingHpRatio.home * 100)
    const awayPercent = Math.round(result.remainingHpRatio.away * 100)
    const endedText = result.endedBy === 'defeat' ? 'by defeat' : 'on the time limit'
    return el('li', { class: 'summary__bout', 'data-testid': 'bout-result' },
      `Bout ${BOUT_NUMERALS[result.boutIndex]} ${RC.emDash} ${homeName} vs ${awayName}: ${winnerName} won ${endedText}. Home ${result.advantage}. Remaining: ${homeName} ${homePercent}%, ${awayName} ${awayPercent}%. Order: ${ORDER_LABELS[result.homeOrder]}.`)
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
    const order = state.orders[state.activeBoutIndex]
    const temperament = state.opponentDispositions[state.activeBoutIndex]
    status.textContent = `Bout ${BOUT_NUMERALS[state.activeBoutIndex]} ${RC.middleDot} ${fighterBySide(battle, 'home').definition.name} vs ${fighterBySide(battle, 'away').definition.name} ${RC.middleDot} Order: ${ORDER_LABELS[order]} ${RC.middleDot} Foe: ${TEMPERAMENT_LABELS[temperament]}`
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
