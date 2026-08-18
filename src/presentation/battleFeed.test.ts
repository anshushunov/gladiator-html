import { describe, expect, it } from 'vitest'
import type { EncounterEvent } from '../simulation/encounter'
import { formatBattleFeed } from './battleFeed'

describe('battle feed', () => {
  const names = { 'home.brutus': 'Brutus', 'away.cassius': 'Cassius' }

  it('combines a block with its reduced damage', () => {
    const entries = formatBattleFeed([
      { id: 0, tick: 60, type: 'attack-blocked', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:0', actionId: 'heavy-shield-jab', contactZone: 'shield', contactPoint: { x: 0, z: 0 } },
      { id: 1, tick: 60, type: 'damage-dealt', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:0', actionId: 'heavy-shield-jab', amount: 4, remainingHp: 96, contactZone: 'shield', contactPoint: { x: 0, z: 0 } },
    ], names)
    expect(entries).toEqual([{ eventId: 0, atSeconds: 1, message: 'Cassius blocks but takes 4.' }])
  })

  it('combines a critical event with its damage', () => {
    const entries = formatBattleFeed([
      { id: 0, tick: 120, type: 'critical-hit', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:0', actionId: 'heavy-cleave', multiplier: 1.5 },
      { id: 1, tick: 120, type: 'damage-dealt', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:0', actionId: 'heavy-cleave', amount: 18, remainingHp: 82, contactZone: 'body', contactPoint: { x: 0, z: 0 } },
    ], names)
    expect(entries[0].message).toBe('Brutus lands a critical hit for 18.')
  })

  it('does not combine a block/critical with a damage event from a different action instance', () => {
    const entries = formatBattleFeed([
      { id: 0, tick: 60, type: 'attack-blocked', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:0', actionId: 'heavy-shield-jab', contactZone: 'shield', contactPoint: { x: 0, z: 0 } },
      { id: 1, tick: 90, type: 'damage-dealt', actorId: 'away.cassius', targetId: 'home.brutus', actionInstanceId: 'away.cassius:0', actionId: 'fast-slash', amount: 4, remainingHp: 96, contactZone: 'body', contactPoint: { x: 0, z: 0 } },
    ], names)
    expect(entries).toEqual([
      { eventId: 0, atSeconds: 1, message: 'Cassius blocks.' },
      { eventId: 1, atSeconds: 1.5, message: 'Cassius deals 4.' },
    ])
  })

  it.each([
    ['no-hostile-pairs', 'wins by defeat'],
    ['time-limit', 'wins on the time limit'],
  ] as const)('formats %s finishes', (reason, copy) => {
    const entries = formatBattleFeed([
      { id: 0, tick: 3600, type: 'encounter-finished', reason, durationTicks: 3600, survivorIds: ['home.brutus'], winnerIds: ['home.brutus'], winningFactionIds: ['home'] },
    ], names)
    expect(entries[0].message).toContain(copy)
  })

  it('formats the opening, miss, evade, parry, and defeat lines', () => {
    const events: EncounterEvent[] = [
      { id: 0, tick: 0, type: 'encounter-started', combatantIds: ['away.cassius', 'home.brutus'], factionIds: ['away', 'home'], hostilityMode: 'different-factions' },
      { id: 1, tick: 10, type: 'attack-missed', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:0', actionId: 'heavy-shield-jab', reason: 'accuracy' },
      { id: 2, tick: 20, type: 'attack-evaded', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:1', actionId: 'heavy-shield-jab', evadeIntent: 'backstep' },
      { id: 3, tick: 30, type: 'attack-parried', actorId: 'home.brutus', defenderId: 'away.cassius', actionInstanceId: 'home.brutus:2', actionId: 'heavy-cleave', contactZone: 'weapon', contactPoint: { x: 0, z: 0 } },
      { id: 4, tick: 40, type: 'fighter-defeated', defeatedId: 'away.cassius', sourceId: 'home.brutus' },
    ]
    const entries = formatBattleFeed(events, names)
    expect(entries.map((entry) => entry.message)).toEqual([
      'The gates open.',
      'Brutus misses.',
      'Cassius evades.',
      'Cassius parries.',
      'Cassius falls.',
    ])
  })

  it('skips events with no feed presentation', () => {
    const events: EncounterEvent[] = [
      { id: 0, tick: 5, type: 'movement-intent-changed', combatantId: 'home.brutus', from: 'hold-range', to: 'advance' },
      { id: 1, tick: 10, type: 'action-started', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId: 'home.brutus:0', actionId: 'heavy-shield-jab', expectedContactTick: 24 },
      { id: 2, tick: 24, type: 'action-interrupted', actorId: 'home.brutus', actionInstanceId: 'home.brutus:0', actionId: 'heavy-shield-jab', reason: 'stagger' },
      { id: 3, tick: 24, type: 'defense-started', defenderId: 'away.cassius', attackerId: 'home.brutus', incomingActionId: 'home.brutus:0', defenseActionId: 'fast-evade', expectedContactTick: 30 },
      { id: 4, tick: 24, type: 'defense-declined', defenderId: 'away.cassius', attackerId: 'home.brutus', incomingActionId: 'home.brutus:0', defenseActionId: 'fast-evade', expectedContactTick: 30 },
      { id: 5, tick: 24, type: 'defense-failed', defenderId: 'away.cassius', attackerId: 'home.brutus', incomingActionId: 'home.brutus:0', defenseActionId: 'fast-evade', reason: 'geometry' },
      { id: 6, tick: 24, type: 'fighter-staggered', combatantId: 'away.cassius', sourceId: 'home.brutus', actionInstanceId: 'home.brutus:0', durationTicks: 12, direction: { x: 1, z: 0 } },
    ]
    expect(formatBattleFeed(events, names)).toEqual([])
  })

  it('keeps the latest eight display entries when the tail is dense with combined blocks, dropping everything older', () => {
    const events: EncounterEvent[] = []
    // Twelve attacks, i.e. twelve display entries' worth of events: the feed
    // has to actually *drop* four of them. Building exactly eight would pass
    // against a feed with no cap at all.
    for (let attack = 0; attack < 12; attack += 1) {
      const id = attack * 3
      const tick = 60 + attack
      const actionInstanceId = `home.brutus:${attack}`
      events.push(
        { id, tick, type: 'action-started', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId, actionId: 'heavy-shield-jab', expectedContactTick: tick },
        { id: id + 1, tick, type: 'attack-blocked', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId, actionId: 'heavy-shield-jab', contactZone: 'shield', contactPoint: { x: 0, z: 0 } },
        { id: id + 2, tick, type: 'damage-dealt', actorId: 'home.brutus', targetId: 'away.cassius', actionInstanceId, actionId: 'heavy-shield-jab', amount: 4, remainingHp: 100 - attack * 4, contactZone: 'shield', contactPoint: { x: 0, z: 0 } },
      )
    }
    const entries = formatBattleFeed(events, names)
    expect(entries).toHaveLength(8)
    // The kept window is the newest eight (attacks 4..11), oldest-first, each
    // keyed by its block event (the combined entry's own anchor).
    expect(entries[0]).toMatchObject({ eventId: 4 * 3 + 1, message: 'Cassius blocks but takes 4.' })
    expect(entries.at(-1)).toMatchObject({ eventId: 11 * 3 + 1, message: 'Cassius blocks but takes 4.' })
    expect(entries.map((entry) => entry.eventId)).toEqual([13, 16, 19, 22, 25, 28, 31, 34])
  })
})
