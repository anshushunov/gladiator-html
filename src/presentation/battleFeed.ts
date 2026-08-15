import { TICKS_PER_SECOND, type BattleEvent } from '../simulation/battle'
import type { FighterSide } from '../simulation/fighters'

export interface BattleFeedEntry { eventId: number; atSeconds: number; message: string }

export function formatBattleFeed(events: readonly BattleEvent[], names: Record<FighterSide, string>): BattleFeedEntry[] {
  const entries: BattleFeedEntry[] = []
  // Scan backwards from the newest event and combine canonical block/critical
  // pairs with their damage, so the returned tail holds exactly the latest
  // eight display entries even when truncated raw events would drop a pair.
  for (let index = events.length - 1; index >= 0 && entries.length < 8; index -= 1) {
    const event = events[index]
    if (event.type === 'attack-started') continue
    if (event.type === 'damage-dealt') {
      const previous = events[index - 1]
      if (previous?.type === 'attack-blocked') {
        entries.push({ eventId: previous.id, atSeconds: previous.tick / TICKS_PER_SECOND, message: `${names[previous.targetSide]} blocks but takes ${event.amount}.` })
        index -= 1
        continue
      }
      if (previous?.type === 'critical-hit') {
        entries.push({ eventId: previous.id, atSeconds: previous.tick / TICKS_PER_SECOND, message: `${names[previous.actorSide]} lands a critical hit for ${event.amount}.` })
        index -= 1
        continue
      }
    }
    entries.push({ eventId: event.id, atSeconds: event.tick / TICKS_PER_SECOND, message: formatEventMessage(event, names) })
  }
  return entries.reverse()
}

function formatEventMessage(event: BattleEvent, names: Record<FighterSide, string>): string {
  switch (event.type) {
    case 'bout-started': return 'The gates open.'
    case 'approach-started': return 'The fighters close the distance.'
    case 'attack-started': return ''
    case 'attack-missed': return `${names[event.actorSide]} misses.`
    case 'attack-blocked': return `${names[event.targetSide]} blocks.`
    case 'critical-hit': return `${names[event.actorSide]} lands a critical hit.`
    case 'damage-dealt': return `${names[event.actorSide]} deals ${event.amount}.`
    case 'fighter-defeated': return `${names[event.defeatedSide]} falls.`
    case 'bout-finished': return event.reason === 'defeat'
      ? `${names[event.winnerSide]} wins by defeat.`
      : `${names[event.winnerSide]} wins on the time limit.`
  }
}