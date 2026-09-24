import { describe, expect, it } from 'vitest'
import { ATTACK_PHRASES } from './actionNames'
import { COMBAT_STYLES } from '../content/combatStyles'

describe('ATTACK_PHRASES', () => {
  it('names every attack in the authored catalogue', () => {
    const missing = Object.keys(COMBAT_STYLES.attacks).filter((id) => !(id in ATTACK_PHRASES))
    expect(missing).toEqual([])
  })

  it('names nothing that is not an attack', () => {
    const extra = Object.keys(ATTACK_PHRASES).filter((id) => !(id in COMBAT_STYLES.attacks))
    expect(extra).toEqual([])
  })

  it('gives a third-person verb phrase and a bare noun for each', () => {
    for (const [id, phrase] of Object.entries(ATTACK_PHRASES)) {
      expect(phrase.verb.length, `${id}.verb`).toBeGreaterThan(0)
      expect(phrase.noun.length, `${id}.noun`).toBeGreaterThan(0)
      expect(phrase.verb, `${id}.verb must not end in punctuation`).not.toMatch(/[.,;]$/)
    }
  })
})
