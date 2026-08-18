import { TICKS_PER_SECOND } from '../simulation/battle'
import type { CombatantId, EncounterEvent } from '../simulation/encounter'

export interface BattleFeedEntry { eventId: number; atSeconds: number; message: string }

const DISPLAYABLE_TYPES: ReadonlySet<EncounterEvent['type']> = new Set([
  'encounter-started',
  'attack-missed',
  'attack-evaded',
  'attack-blocked',
  'attack-parried',
  'critical-hit',
  'damage-dealt',
  'fighter-defeated',
  'encounter-finished',
])

export function formatBattleFeed(events: readonly EncounterEvent[], names: Record<CombatantId, string>): BattleFeedEntry[] {
  const entries: BattleFeedEntry[] = []
  // Scan backwards from the newest event and combine canonical block/critical
  // pairs with their damage, so the returned tail holds exactly the latest
  // eight display entries even when truncated raw events would drop a pair.
  for (let index = events.length - 1; index >= 0 && entries.length < 8; index -= 1) {
    const event = events[index]
    if (!DISPLAYABLE_TYPES.has(event.type)) continue
    if (event.type === 'damage-dealt') {
      const previous = events[index - 1]
      if (previous?.type === 'attack-blocked' && previous.actionInstanceId === event.actionInstanceId) {
        entries.push({ eventId: previous.id, atSeconds: previous.tick / TICKS_PER_SECOND, message: `${names[previous.targetId]} blocks but takes ${event.amount}.` })
        index -= 1
        continue
      }
      if (previous?.type === 'critical-hit' && previous.actionInstanceId === event.actionInstanceId) {
        entries.push({ eventId: previous.id, atSeconds: previous.tick / TICKS_PER_SECOND, message: `${names[previous.actorId]} lands a critical hit for ${event.amount}.` })
        index -= 1
        continue
      }
    }
    entries.push({ eventId: event.id, atSeconds: event.tick / TICKS_PER_SECOND, message: formatEventMessage(event, names) })
  }
  return entries.reverse()
}

function formatEventMessage(event: EncounterEvent, names: Record<CombatantId, string>): string {
  switch (event.type) {
    case 'encounter-started': return 'The gates open.'
    case 'attack-missed': return `${names[event.actorId]} misses.`
    case 'attack-evaded': return `${names[event.targetId]} evades.`
    case 'attack-blocked': return `${names[event.targetId]} blocks.`
    case 'attack-parried': return `${names[event.defenderId]} parries.`
    case 'critical-hit': return `${names[event.actorId]} lands a critical hit.`
    case 'damage-dealt': return `${names[event.actorId]} deals ${event.amount}.`
    case 'fighter-defeated': return `${names[event.defeatedId]} falls.`
    case 'encounter-finished': return event.reason === 'no-hostile-pairs'
      ? `${names[event.winnerIds[0]]} wins by defeat.`
      : `${names[event.winnerIds[0]]} wins on the time limit.`
    default: return ''
  }
}
