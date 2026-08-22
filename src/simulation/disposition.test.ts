// src/simulation/disposition.test.ts
import { describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import type { CombatDecision, CombatDecisionContext } from './combatDecision'
import { DISPOSITION_IDS, dispositionModifiers, isDispositionId, type DispositionId } from './disposition'

// Only `context.attacks` is read by the modifiers; a minimal cast keeps the
// test independent of the full decision-context construction.
const context = { attacks: COMBAT_STYLES.attacks } as unknown as CombatDecisionContext

const adjust = (id: DispositionId, decision: CombatDecision): number =>
  dispositionModifiers(id).reduce((sum, m) => sum + m.adjustCandidate({ context, decision, weight: 10 }), 0)

const action = (actionId: string): CombatDecision => ({ type: 'action', actionId } as CombatDecision)
const move = (locomotionIntent: string): CombatDecision => ({ type: 'locomotion', locomotionIntent } as CombatDecision)

describe('disposition ids', () => {
  it('validates the three ids and rejects everything else', () => {
    expect(DISPOSITION_IDS).toEqual(['standard', 'press', 'guarded'])
    for (const id of DISPOSITION_IDS) expect(isDispositionId(id)).toBe(true)
    expect(isDispositionId('aggressive')).toBe(false)
    expect(isDispositionId(undefined)).toBe(false)
    expect(isDispositionId(1)).toBe(false)
  })

  it('standard maps to the same frozen empty array on every call', () => {
    const first = dispositionModifiers('standard')
    expect(first).toHaveLength(0)
    expect(Object.isFrozen(first)).toBe(true)
    expect(dispositionModifiers('standard')).toBe(first)
    expect(dispositionModifiers('press')).toBe(dispositionModifiers('press'))
  })
})

describe('press', () => {
  it('raises committed attacks, leaves probes alone', () => {
    expect(adjust('press', action('heavy-cleave'))).toBe(6)       // tags include 'committed'
    expect(adjust('press', action('fast-burst-lunge'))).toBe(6)
    expect(adjust('press', action('heavy-shield-jab'))).toBe(0)   // probe
    expect(adjust('press', action('technical-thrust'))).toBe(0)   // probe
  })
  it('raises approach intents and lowers distance-keepers', () => {
    for (const intent of ['pressure', 'burst-in', 'advance']) expect(adjust('press', move(intent))).toBe(4)
    for (const intent of ['hold-range', 'backstep', 'retreat']) expect(adjust('press', move(intent))).toBe(-4)
    expect(adjust('press', move('circle-left'))).toBe(0)
  })
})

describe('guarded', () => {
  it('mirrors press', () => {
    expect(adjust('guarded', action('heavy-cleave'))).toBe(-6)
    expect(adjust('guarded', action('heavy-shield-jab'))).toBe(0)
    for (const intent of ['pressure', 'burst-in', 'advance']) expect(adjust('guarded', move(intent))).toBe(-4)
    for (const intent of ['hold-range', 'backstep', 'retreat']) expect(adjust('guarded', move(intent))).toBe(4)
    expect(adjust('guarded', move('circle-right'))).toBe(0)
  })
})
