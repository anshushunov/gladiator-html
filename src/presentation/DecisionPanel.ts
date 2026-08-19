// Dev-only decision inspector. Renders what the kernel's phase-4 collector
// reported. Contains no combat rules and never feeds anything back into the
// simulation.

import type { DecisionRecord, DecisionOutcome } from '../simulation/decisionDiagnostics'

/** Bounded so a long bout (thousands of `skipped` records alone) cannot grow
 * the DOM without limit -- see `decisionDiagnostics.ts`'s own note that
 * record volume is dominated by noise. */
const MAX_ROWS = 200

function describeOutcome(outcome: DecisionOutcome): string {
  return outcome.type === 'locomotion' ? outcome.locomotionIntent : outcome.actionId
}

function describeRecord(entry: DecisionRecord): string {
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
    case 'forced':
      return `t${entry.tick} ${entry.combatantId}: forced ${entry.behaviour} (no roll)`
    case 'skipped':
      return `t${entry.tick} ${entry.combatantId}: skipped (${entry.reason})`
  }
}

export class DecisionPanel {
  private readonly root: HTMLElement
  private readonly list: HTMLElement
  private records: DecisionRecord[] = []

  constructor(parent: HTMLElement) {
    this.root = document.createElement('section')
    this.root.dataset.testid = 'decision-panel'
    this.root.className = 'decision-panel'
    const heading = document.createElement('h2')
    heading.textContent = 'Decision trace'
    this.list = document.createElement('ol')
    this.root.append(heading, this.list)
    parent.append(this.root)
  }

  record(entry: DecisionRecord): void {
    this.records.push(entry)
    if (this.records.length > MAX_ROWS) this.records = this.records.slice(-MAX_ROWS)
  }

  /** Called at each new bout and on rematch: the trace describes one bout, not a session. */
  clear(): void {
    this.records = []
    this.list.replaceChildren()
  }

  render(): void {
    const rows = this.records.map((entry) => {
      const row = document.createElement('li')
      row.dataset.testid = 'decision-panel-row'
      row.textContent = describeRecord(entry)
      return row
    })
    this.list.replaceChildren(...rows)
  }
}
