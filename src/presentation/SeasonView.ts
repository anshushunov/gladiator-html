// The season board, between-series delta telegraph, and season summary.
// Pure presentation: every rule (condition ladder steps, starting HP,
// fightability, scaled opponent stats) is decided by `simulation/season.ts`
// and `simulation/condition.ts` -- this file only formats what `SeasonState`
// already hands it. The condition-ladder telegraph text itself lives in
// `conditionTelegraph.ts`, shared with `SeriesView`'s planning cards, so the
// wording never drifts between the two screens.

import type { BoutOutcome } from '../simulation/series'
import type { ChallengeDefinition, ConditionDelta, RosterEntry, SeasonState } from '../simulation/season'
import { isFightable, startingHpFor, type FighterCondition } from '../simulation/condition'
import type { Archetype } from '../simulation/fighters'
import { CONDITION_LABELS, fightTelegraph, restTelegraph } from './conditionTelegraph'
import { formatPower } from './formatPower'

const RC = { arrow: '→', middleDot: '·', enDash: '–', emDash: '—' }
const ARCHETYPE_LABELS: Record<Archetype, string> = { heavy: 'Heavy', fast: 'Fast', technical: 'Technical' }

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

function conditionBadge(condition: FighterCondition): HTMLElement {
  return el('span', { class: 'condition-badge', 'data-testid': 'condition-badge', 'data-condition': condition }, CONDITION_LABELS[condition])
}

function fighterNameFor(roster: readonly RosterEntry[], id: string): string {
  return roster.find((entry) => entry.fighter.id === id)?.fighter.name ?? id
}

export class SeasonView {
  private readonly host: HTMLElement
  /** The board/summary phase last given real keyboard focus -- mirrors
   * `SeriesView.lastRenderedPhase`'s own role for `applyFocus`, so every
   * fresh arrival at this screen (not just its very first render) moves
   * focus to that screen's own heading, exactly like every series-owned
   * phase transition already does (`SeriesView.applyFocus`). `null`
   * whenever this screen is not the one currently shown (`clear()` resets
   * it), so a later return to the SAME phase -- e.g. the board reappearing
   * after a series that started and ended without ever reaching the summary
   * -- is still detected as "just arrived" and re-focused, rather than
   * compared against a stale value from before `SeriesView` took over the
   * screen in between. */
  private lastFocusedPhase: SeasonState['phase'] | null = null

  constructor(host: HTMLElement) {
    this.host = host
  }

  render(state: SeasonState): void {
    if (state.phase === 'season-board') this.renderBoard(state)
    else if (state.phase === 'season-summary') this.renderSummary(state)
    else { this.clear(); return }
    if (state.phase !== this.lastFocusedPhase) {
      const headingId = state.phase === 'season-board' ? 'season-board-heading' : 'season-summary-heading'
      this.host.querySelector<HTMLElement>(`#${headingId}`)?.focus()
    }
    this.lastFocusedPhase = state.phase
  }

  /** Empties the board/summary while a series is in progress -- called by
   * `main.ts` whenever `SeriesView` owns the screen instead. Resets
   * `lastFocusedPhase` (see its own doc comment) so this screen's next
   * appearance is always treated as a fresh arrival, not a same-phase
   * no-op. */
  clear(): void {
    this.host.replaceChildren()
    this.lastFocusedPhase = null
  }

  private renderBoard(state: SeasonState): void {
    const section = el('section', { class: 'season-board', 'aria-labelledby': 'season-board-heading', 'data-testid': 'season-board' })
    const heading = el('h2', { id: 'season-board-heading', tabindex: '-1' }, `Season board ${RC.emDash} Series ${state.seriesIndex + 1} of ${state.challenges.length}`)
    const scoreLine = el('p', { class: 'season-board__score' }, `Season score ${state.score.home}${RC.enDash}${state.score.away}`)
    section.append(heading, scoreLine)

    const challengeGrid = el('div', { class: 'season-challenge-grid' })
    state.challenges.forEach((challenge, index) => challengeGrid.append(this.buildChallengeCard(challenge, index === state.seriesIndex)))
    section.append(challengeGrid)

    const rosterGrid = el('div', { class: 'season-roster-grid' })
    for (const entry of state.roster) rosterGrid.append(this.buildRosterCard(entry, state.lastDeltas))
    section.append(rosterGrid)

    const start = el(
      'button',
      { class: 'button button--primary season-board__start', type: 'button', 'data-action': 'start-series', 'data-testid': 'start-series' },
      `Start series ${state.seriesIndex + 1}`,
    )
    section.append(start)

    this.host.replaceChildren(section)
  }

  private buildChallengeCard(challenge: ChallengeDefinition, isCurrent: boolean): HTMLElement {
    const card = el('article', {
      class: isCurrent ? 'season-challenge-card season-challenge-card--current' : 'season-challenge-card',
      'data-testid': 'season-challenge-card',
      'data-current': String(isCurrent),
    })
    card.append(el('h3', { class: 'season-challenge-card__heading' }, `Challenge ${challenge.index + 1}`))
    if (challenge.featuredThreat) {
      card.append(el('p', { class: 'season-challenge-card__featured' }, `Featured threat: ${ARCHETYPE_LABELS[challenge.featuredThreat]}`))
    }
    const list = el('ul', { class: 'season-challenge-card__opponents' })
    for (const opponent of challenge.opponents) {
      const item = el('li', {})
      item.append(
        el('strong', {}, opponent.name),
        // `formatPower`: see its own doc comment -- `scaleOpponent` leaves
        // `power` a raw float, formatted here for display only, shared with
        // `SeriesView.buildMatchupSlot` so the two screens never disagree.
        el('span', { class: 'season-challenge-card__stats' }, `${ARCHETYPE_LABELS[opponent.archetype]} ${RC.middleDot} HP ${opponent.maxHp} ${RC.middleDot} Power ${formatPower(opponent.power)}`),
      )
      list.append(item)
    }
    card.append(list)
    return card
  }

  private buildRosterCard(entry: RosterEntry, deltas: readonly ConditionDelta[]): HTMLElement {
    const card = el('article', { class: 'season-roster-card', 'data-testid': 'season-roster-card' })
    const title = el('div', { class: 'season-roster-card__title' })
    title.append(el('strong', {}, entry.fighter.name), el('span', { class: 'season-roster-card__archetype' }, ARCHETYPE_LABELS[entry.fighter.archetype]))
    card.append(title)
    card.append(el('span', { class: 'season-roster-card__school' }, entry.fighter.school))
    card.append(conditionBadge(entry.condition))

    const delta = deltas.find((candidate) => candidate.fighterId === entry.fighter.id)
    if (delta) {
      const causeLabel = delta.cause === 'fought' ? 'fought' : 'rested'
      card.append(
        el(
          'p',
          { class: 'condition-delta', 'data-testid': 'condition-delta' },
          `${CONDITION_LABELS[delta.before]} ${RC.arrow} ${CONDITION_LABELS[delta.after]} (${causeLabel})`,
        ),
      )
    }

    if (isFightable(entry.condition)) {
      card.append(el('span', { class: 'season-roster-card__hp' }, `Starting HP ${startingHpFor(entry.condition, entry.fighter.maxHp)}`))
      card.append(el('p', { class: 'season-roster-card__telegraph' }, fightTelegraph(entry.condition)))
      const rest = restTelegraph(entry.condition)
      if (rest) card.append(el('p', { class: 'season-roster-card__telegraph' }, rest))
    } else {
      card.append(el('span', { class: 'season-roster-card__hp' }, 'Cannot fight this series'))
    }

    card.append(el('span', { class: 'season-roster-card__bouts' }, `Bouts fought: ${entry.boutsFought}`))
    return card
  }

  private renderSummary(state: SeasonState): void {
    const section = el('section', { class: 'season-summary', 'aria-labelledby': 'season-summary-heading', 'data-testid': 'season-summary' })
    const victory = state.score.home > state.score.away
    const heading = el('h2', { id: 'season-summary-heading', tabindex: '-1' }, victory ? 'Season victory' : 'Season defeat')
    const scoreLine = el('p', { class: 'season-summary__score' }, `${state.score.home}${RC.enDash}${state.score.away}`)
    section.append(heading, scoreLine)

    for (const record of state.records) {
      const challenge = state.challenges[record.challengeIndex]
      const block = el('div', { class: 'season-summary__series' })
      block.append(el('h3', { class: 'season-summary__series-heading' }, `Series ${record.seriesIndex + 1} ${RC.middleDot} ${record.score.home}${RC.enDash}${record.score.away}`))
      const list = el('ol', { class: 'season-summary__bouts' })
      for (const outcome of record.outcomes) list.append(this.buildOutcomeRow(state.roster, challenge, outcome))
      block.append(list)
      section.append(block)
    }

    const rosterSummary = el('div', { class: 'season-summary__roster' })
    for (const entry of state.roster) {
      const row = el('p', { class: 'season-summary__roster-row' })
      row.append(
        el('strong', {}, entry.fighter.name),
        el('span', {}, ` ${RC.middleDot} ${entry.boutsFought} bout${entry.boutsFought === 1 ? '' : 's'} fought ${RC.middleDot} finishes `),
        conditionBadge(entry.condition),
      )
      rosterSummary.append(row)
    }
    section.append(rosterSummary)

    const rematch = el('button', { class: 'button button--primary', type: 'button', 'data-action': 'rematch-season', 'data-testid': 'rematch-season' }, 'Rematch season')
    section.append(rematch)

    this.host.replaceChildren(section)
  }

  private buildOutcomeRow(roster: readonly RosterEntry[], challenge: ChallengeDefinition, outcome: BoutOutcome): HTMLLIElement {
    const opponent = challenge.opponents[outcome.boutIndex]
    if (outcome.kind === 'forfeit') {
      return el('li', { class: 'season-summary__bout', 'data-testid': 'season-summary-bout' }, `Bout ${outcome.boutIndex + 1} ${RC.emDash} forfeited: no gladiator available to face ${opponent.name}.`)
    }
    const homeName = fighterNameFor(roster, outcome.homeFighterId)
    const winnerName = outcome.winnerSide === 'home' ? homeName : opponent.name
    const endedText = outcome.endedBy === 'defeat' ? 'by defeat' : 'on the time limit'
    return el(
      'li',
      { class: 'season-summary__bout', 'data-testid': 'season-summary-bout' },
      `Bout ${outcome.boutIndex + 1} ${RC.emDash} ${homeName} vs ${opponent.name}: ${winnerName} won ${endedText}.`,
    )
  }
}
