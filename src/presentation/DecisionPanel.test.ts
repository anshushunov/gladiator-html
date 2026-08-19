import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DecisionRecord } from '../simulation/decisionDiagnostics'
import { DecisionPanel } from './DecisionPanel'

/**
 * `DecisionPanel` builds real nodes through `document.createElement`, and
 * this repo has neither a `jsdom`/`happy-dom` dependency nor a `vitest`
 * `environment` configured for one (`vite.config.ts`'s `test` block has no
 * `environment` key, so it runs Vitest's default plain-Node target). No
 * other presentation test touches `document` either -- `ProceduralFighter`
 * builds `THREE.Object3D` graphs, not DOM. There is no established pattern
 * to follow, and adding a DOM package plus a per-file environment override
 * for this one panel would be disproportionate to what it needs: `dataset`,
 * `className`, `textContent`, `append`, and `replaceChildren`.
 *
 * So this test stubs exactly that surface instead of pulling in a real DOM.
 * It is a hand-rolled test double, not a DOM environment, and it is scoped
 * to this file only via `beforeEach`/`afterEach`.
 */
class FakeElement {
  dataset: Record<string, string> = {}
  className = ''
  textContent = ''
  children: FakeElement[] = []

  append(...nodes: readonly FakeElement[]): void {
    this.children.push(...nodes)
  }

  replaceChildren(...nodes: readonly FakeElement[]): void {
    this.children = [...nodes]
  }
}

/** The panel's private fields, exposed for assertions without changing its public API. */
interface DecisionPanelInternals {
  list: FakeElement
  skippedSummary: FakeElement
}

function rowTexts(panel: DecisionPanel): string[] {
  const { list } = panel as unknown as DecisionPanelInternals
  return list.children.map((li) => li.textContent)
}

function skippedSummaryText(panel: DecisionPanel): string {
  const { skippedSummary } = panel as unknown as DecisionPanelInternals
  return skippedSummary.textContent
}

let originalDocument: unknown

beforeEach(() => {
  originalDocument = (globalThis as { document?: unknown }).document
  ;(globalThis as { document?: unknown }).document = {
    createElement: () => new FakeElement(),
  }
})

afterEach(() => {
  ;(globalThis as { document?: unknown }).document = originalDocument
})

function forced(tick: number, combatantId: string, behaviour: 'disengage' | 'parry-counter'): DecisionRecord {
  return { kind: 'forced', tick, combatantId, behaviour }
}

function skipped(tick: number, combatantId: string, reason: 'inactive' | 'mid-action' | 'staggered' | 'not-due' | 'no-target'): DecisionRecord {
  return { kind: 'skipped', tick, combatantId, reason }
}

describe('DecisionPanel', () => {
  it('collapses consecutive identical forced records for the same combatant into one row with a repeat count', () => {
    const panel = new DecisionPanel(new FakeElement() as unknown as HTMLElement)
    panel.record(forced(10, 'away.aquila', 'disengage'))
    panel.record(forced(11, 'away.aquila', 'disengage'))
    panel.record(forced(12, 'away.aquila', 'disengage'))
    panel.render()

    expect(rowTexts(panel)).toEqual(['t12 away.aquila: forced disengage (no roll) (x3)'])
  })

  it('breaks the collapsed run when a different combatant reports a forced record', () => {
    const panel = new DecisionPanel(new FakeElement() as unknown as HTMLElement)
    panel.record(forced(10, 'away.aquila', 'disengage'))
    panel.record(forced(10, 'home.brutus', 'parry-counter'))
    panel.record(forced(11, 'away.aquila', 'disengage'))
    panel.render()

    // The third record is the same combatant and behaviour as the first, but
    // it does not rejoin that earlier row: collapsing only ever looks at the
    // immediately preceding row, not at that combatant's history, so the
    // intervening `home.brutus` record splits the two `away.aquila` records
    // into separate rows.
    expect(rowTexts(panel)).toEqual([
      't10 away.aquila: forced disengage (no roll)',
      't10 home.brutus: forced parry-counter (no roll)',
      't11 away.aquila: forced disengage (no roll)',
    ])
  })

  it('never collapses two combatants forced on the same ticks, because their records interleave', () => {
    // This is a real limitation of the feature, not an edge case to hide:
    // two combatants forced at the same time are recorded in sorted-ID order
    // each tick (A, B, A, B, ...), so every row alternates combatant and the
    // "same as the previous row" collapse test never once succeeds, even
    // though each combatant's own behaviour is unchanged tick over tick.
    const panel = new DecisionPanel(new FakeElement() as unknown as HTMLElement)
    panel.record(forced(10, 'away.aquila', 'disengage'))
    panel.record(forced(10, 'home.brutus', 'disengage'))
    panel.record(forced(11, 'away.aquila', 'disengage'))
    panel.record(forced(11, 'home.brutus', 'disengage'))
    panel.render()

    expect(rowTexts(panel)).toEqual([
      't10 away.aquila: forced disengage (no roll)',
      't10 home.brutus: forced disengage (no roll)',
      't11 away.aquila: forced disengage (no roll)',
      't11 home.brutus: forced disengage (no roll)',
    ])
  })

  it('drops skipped records from the rendered rows while still counting them', () => {
    const panel = new DecisionPanel(new FakeElement() as unknown as HTMLElement)
    panel.record(skipped(5, 'away.aquila', 'not-due'))
    panel.record(forced(10, 'away.aquila', 'disengage'))
    panel.record(skipped(15, 'home.brutus', 'staggered'))
    panel.render()

    expect(rowTexts(panel)).toEqual(['t10 away.aquila: forced disengage (no roll)'])
    expect(skippedSummaryText(panel)).toBe('2 skipped (not shown)')
  })
})
