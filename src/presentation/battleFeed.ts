import { TICKS_PER_SECOND, type BattleEvent } from '../simulation/battle'
import type { FighterSide } from '../simulation/fighters'

export interface BattleFeedEntry { eventId: number; atSeconds: number; message: string }

export function formatBattleFeed(events: readonly BattleEvent[], names: Record<FighterSide, string>): BattleFeedEntry[] {
  const entries: BattleFeedEntry[] = []
  const recent = events.slice(-20)
  for (let index = 0; index < recent.length; index += 1) {
    const event = recent[index]
    if (event.type === 'attack-started') continue
    const next = recent[index + 1]
    let message: string
    if (event.type === 'attack-blocked' && next?.type === 'damage-dealt') {
      message = `${names[event.targetSide]} blocks but takes ${next.amount}.`
      index += 1
    } else if (event.type === 'critical-hit' && next?.type === 'damage-dealt') {
      message = `${names[event.actorSide]} lands a critical hit for ${next.amount}.`
      index += 1
    } else {
      message = formatEventMessage(event, names)
    }
    entries.push({ eventId: event.id, atSeconds: event.tick / TICKS_PER_SECOND, message })
  }
  return entries.slice(-8)
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