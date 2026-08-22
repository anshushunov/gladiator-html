// src/simulation/condition.ts

/** A gladiator's accumulated wear. Decides starting HP and whether they can fight at all. */
export type FighterCondition = 'fresh' | 'bruised' | 'wounded' | 'broken'

export const CONDITION_LADDER = ['fresh', 'bruised', 'wounded', 'broken'] as const satisfies readonly FighterCondition[]

/** Fraction of `maxHp` a gladiator in this condition starts a bout with. `broken` never starts one. */
const STARTING_HP_RATIO: Record<FighterCondition, number> = {
  fresh: 1,
  bruised: 0.75,
  wounded: 0.5,
  broken: 0,
}

export interface BoutWear {
  remainingHpRatio: number
  won: boolean
}

export function conditionIndex(condition: FighterCondition): number {
  return CONDITION_LADDER.indexOf(condition)
}

export function conditionAtIndex(index: number): FighterCondition {
  if (!Number.isFinite(index)) throw new Error('Condition index must be finite')
  const clamped = Math.min(CONDITION_LADDER.length - 1, Math.max(0, Math.round(index)))
  return CONDITION_LADDER[clamped]
}

export function isFightable(condition: FighterCondition): boolean {
  return condition !== 'broken'
}

export function startingHpFor(condition: FighterCondition, maxHp: number): number {
  if (!isFightable(condition)) throw new Error('A broken gladiator cannot start a bout')
  if (!Number.isInteger(maxHp) || maxHp <= 0) throw new Error('maxHp must be a positive integer')
  return Math.max(1, Math.round(maxHp * STARTING_HP_RATIO[condition]))
}

/**
 * Wear is charged per bout, never zero: a free dominant matchup is exactly the
 * defect this meta-loop exists to remove (design.md, "Condition ladder").
 * A loss costs two steps at any ratio, because `time-limit` losses can end
 * with high HP and would otherwise be cheaper than a hard-won victory.
 */
export function conditionAfterBout(condition: FighterCondition, wear: Readonly<BoutWear>): FighterCondition {
  if (!Number.isFinite(wear.remainingHpRatio)) throw new Error('remainingHpRatio must be finite')
  const steps = !wear.won || wear.remainingHpRatio < 0.25 ? 2 : 1
  return conditionAtIndex(conditionIndex(condition) + steps)
}

export function conditionAfterRest(condition: FighterCondition): FighterCondition {
  return conditionAtIndex(conditionIndex(condition) - 1)
}
