// Dev-only decision inspector. Renders what the kernel's phase-4 collector
// reported. Contains no combat rules and never feeds anything back into the
// simulation.

import type { DecisionRecord, DecisionOutcome } from '../simulation/decisionDiagnostics'

/**
 * Bounded so a long bout cannot grow the DOM without limit. `skipped` is
 * dropped entirely before it ever reaches this bound (see `record()` below)
 * -- it fires once per non-ready combatant per tick (two per tick in a
 * duel), against a real weighted decision roughly every 20-42 ticks per
 * fighter, so counting it toward `MAX_ROWS` used to mean ~200 rows covered
 * about 1.7 seconds of combat, ~95% of it `skipped (not-due)`, with the
 * handful of real decisions buried in the noise. With `skipped` excluded and
 * consecutive identical `forced` runs collapsed (also below), 200 rows now
 * covers a much larger, much more legible span of actual decisions.
 */
const MAX_ROWS = 200

/** One rendered row: the most recent record of its kind, plus how many
 * consecutive identical `forced` records (below) it collapses. `1` for every
 * other kind. */
interface PanelRow {
  record: DecisionRecord
  repeatCount: number
}

function describeOutcome(outcome: DecisionOutcome): string {
  return outcome.type === 'locomotion' ? outcome.locomotionIntent : outcome.actionId
}

function describeRecord(entry: DecisionRecord, repeatCount: number): string {
  switch (entry.kind) {
    case 'weighted': {
      const total = entry.candidates.reduce((sum, candidate) => sum + candidate.weight, 0)
      const parts = entry.candidates
        .map((candidate) => `${describeOutcome(candidate.decision)} ${total > 0 ? Math.round((candidate.weight / total) * 100) : 0}%`)
        .join(', ')
      return `t${entry.tick} ${entry.combatantId}: roll ${entry.roll.toFixed(3)} -> ${describeOutcome(entry.chosen)} [${parts}]`
    }
    case 'fallback':
      return `t${entry.tick} ${entry.combatantId}: no candidates -> fallback ${describeOutcome(entry.chosen)}`
    case 'forced': {
      const suffix = repeatCount > 1 ? ` (x${repeatCount})` : ''
      return `t${entry.tick} ${entry.combatantId}: forced ${entry.behaviour} (no roll)${suffix}`
    }
    case 'skipped':
      // Never actually rendered -- `record()` below counts these rather than
      // storing them -- kept here only so this switch stays exhaustive.
      return `t${entry.tick} ${entry.combatantId}: skipped (${entry.reason})`
  }
}

export class DecisionPanel {
  private readonly root: HTMLElement
  private readonly skippedSummary: HTMLElement
  private readonly list: HTMLElement
  private rows: PanelRow[] = []
  private skippedCount = 0

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section')
    this.root.dataset.testid = 'decision-panel'
    this.root.className = 'decision-panel'
    const heading = document.createElement('h2')
    heading.textContent = 'Decision trace'
    this.skippedSummary = document.createElement('p')
    this.skippedSummary.dataset.testid = 'decision-panel-skipped-count'
    this.list = document.createElement('ol')
    this.root.append(heading, this.skippedSummary, this.list)
    parent.append(this.root)
  }

  record(entry: DecisionRecord): void {
    if (entry.kind === 'skipped') {
      // Dropped from the rendered list by default: the panel exists to
      // explain decisions, and `skipped` is not a decision. Kept only as a
      // count so the panel can still show that non-ready combatants existed,
      // without drowning the rows that actually explain something.
      this.skippedCount += 1
      return
    }

    if (entry.kind === 'forced') {
      const last = this.rows[this.rows.length - 1]
      if (last && last.record.kind === 'forced' && last.record.combatantId === entry.combatantId && last.record.behaviour === entry.behaviour) {
        // Same combatant, same forced behaviour, immediately following --
        // `forced` re-fires every tick for the duration of a disengage, so
        // without this a single disengage would repeat itself dozens of
        // times in a row. Collapse into the one row, advancing its tick to
        // the latest occurrence.
        last.record = entry
        last.repeatCount += 1
        return
      }
    }

    this.rows.push({ record: entry, repeatCount: 1 })
    if (this.rows.length > MAX_ROWS) this.rows = this.rows.slice(-MAX_ROWS)
  }

  /** Called at each new bout and on rematch: the trace describes one bout, not a session. */
  clear(): void {
    this.rows = []
    this.skippedCount = 0
    this.list.replaceChildren()
    this.skippedSummary.textContent = ''
  }

  render(): void {
    const rowElements = this.rows.map((row) => {
      const li = document.createElement('li')
      li.dataset.testid = 'decision-panel-row'
      li.textContent = describeRecord(row.record, row.repeatCount)
      return li
    })
    this.list.replaceChildren(...rowElements)
    this.skippedSummary.textContent = this.skippedCount > 0 ? `${this.skippedCount} skipped (not shown)` : ''
  }
}
