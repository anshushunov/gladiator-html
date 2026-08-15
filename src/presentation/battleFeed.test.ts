import { describe, expect, it } from 'vitest'
import { formatBattleFeed } from './battleFeed'

describe('battle feed', () => {
  const names = { home: 'Brutus', away: 'Cassius' }

  it('combines a block with its reduced damage', () => {
    const entries = formatBattleFeed([
      { id: 0, tick: 60, type: 'attack-blocked', actorSide: 'home', targetSide: 'away' },
      { id: 1, tick: 60, type: 'damage-dealt', actorSide: 'home', targetSide: 'away', amount: 4, remainingHp: 96 },
    ], names)
    expect(entries).toEqual([{ eventId: 0, atSeconds: 1, message: 'Cassius blocks but takes 4.' }])
  })

  it('combines a critical event with its damage', () => {
    const entries = formatBattleFeed([
      { id: 0, tick: 120, type: 'critical-hit', actorSide: 'home', targetSide: 'away', multiplier: 1.5 },
      { id: 1, tick: 120, type: 'damage-dealt', actorSide: 'home', targetSide: 'away', amount: 18, remainingHp: 82 },
    ], names)
    expect(entries[0].message).toBe('Brutus lands a critical hit for 18.')
  })

  it.each([['defeat', 'wins by defeat'], ['time-limit', 'wins on the time limit']] as const)('formats %s finishes', (reason, copy) => {
    const entries = formatBattleFeed([{ id: 0, tick: 2700, type: 'bout-finished', winnerSide: 'home', reason, durationTicks: 2700 }], names)
    expect(entries[0].message).toContain(copy)
  })
})