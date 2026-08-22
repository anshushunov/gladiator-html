import { describe, expect, it } from 'vitest'
import { conditionAfterBout, conditionAfterRest, type FighterCondition } from '../simulation/condition'
import { fightTelegraph, restTelegraph } from './conditionTelegraph'

describe('fight telegraph', () => {
  it('names both ends while they differ', () => {
    expect(fightTelegraph('fresh')).toBe('Fight: → bruised, or wounded on a loss or a win under 25% HP')
    expect(fightTelegraph('bruised')).toBe('Fight: → wounded, or broken on a loss or a win under 25% HP')
  })

  // `wounded` is one rung from `broken` on a clean win and two on a loss, and
  // the ladder clamps -- so both ends name the same rung. Spelled out in full
  // the sentence read "→ broken, or broken on a loss", which looks like a
  // rendering fault rather than the warning it is.
  it('collapses to one clause when the ladder clamps both ends onto the same rung', () => {
    expect(fightTelegraph('wounded')).toBe('Fight: → broken, whatever the outcome')
  })

  // The telegraph exists to promise the player what the simulation will
  // actually do; this pins the promise to the rule rather than to a string.
  it('agrees with conditionAfterBout for every fightable condition', () => {
    for (const condition of ['fresh', 'bruised', 'wounded'] as const satisfies readonly FighterCondition[]) {
      const best = conditionAfterBout(condition, { won: true, remainingHpRatio: 1 })
      const worst = conditionAfterBout(condition, { won: false, remainingHpRatio: 0 })
      expect(fightTelegraph(condition)).toContain(best)
      expect(fightTelegraph(condition)).toContain(worst)
    }
  })
})

describe('rest telegraph', () => {
  it('names the step a rested gladiator gains', () => {
    expect(restTelegraph('wounded')).toBe('Rest: wounded → bruised')
    expect(restTelegraph('bruised')).toBe('Rest: bruised → fresh')
    expect(restTelegraph('broken')).toBe('Rest: broken → wounded')
  })

  it('says nothing when resting cannot move the ladder', () => {
    expect(conditionAfterRest('fresh')).toBe('fresh')
    expect(restTelegraph('fresh')).toBeNull()
  })
})
