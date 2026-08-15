export type FighterId = 'red' | 'blue'

export interface FighterState {
  id: FighterId
  name: string
  x: number
  hp: number
  maxHp: number
  nextAttackAt: number
}

export interface BattleEvent {
  at: number
  message: string
}

export interface BattleState {
  time: number
  phase: 'running' | 'finished'
  winnerId?: FighterId
  fighters: [FighterState, FighterState]
  events: BattleEvent[]
}

const MOVE_SPEED = 2.2
const ATTACK_RANGE = 1.45
const ATTACK_COOLDOWN = 0.72
const DAMAGE = 10

export function createBattle(): BattleState {
  return {
    time: 0,
    phase: 'running',
    fighters: [
      { id: 'red', name: 'Brutus', x: -5, hp: 100, maxHp: 100, nextAttackAt: 0 },
      { id: 'blue', name: 'Cassius', x: 5, hp: 100, maxHp: 100, nextAttackAt: 0 },
    ],
    events: [{ at: 0, message: 'The gates open.' }],
  }
}

export function stepBattle(previous: BattleState, deltaSeconds: number): BattleState {
  if (previous.phase === 'finished' || deltaSeconds <= 0) return previous

  const time = previous.time + deltaSeconds
  const fighters = previous.fighters.map((fighter) => ({ ...fighter })) as [FighterState, FighterState]
  const events = [...previous.events]
  const [red, blue] = fighters
  const gap = blue.x - red.x

  if (gap > ATTACK_RANGE) {
    const movement = Math.min(MOVE_SPEED * deltaSeconds, (gap - ATTACK_RANGE) / 2)
    red.x += movement
    blue.x -= movement
  } else {
    const redAttacks = red.hp > 0 && time >= red.nextAttackAt
    const blueAttacks = blue.hp > 0 && time >= blue.nextAttackAt

    if (redAttacks) {
      blue.hp = Math.max(0, blue.hp - DAMAGE)
      red.nextAttackAt = time + ATTACK_COOLDOWN
      events.push({ at: time, message: `${red.name} strikes for ${DAMAGE}.` })
    }
    if (blueAttacks) {
      red.hp = Math.max(0, red.hp - DAMAGE)
      blue.nextAttackAt = time + ATTACK_COOLDOWN
      events.push({ at: time, message: `${blue.name} answers for ${DAMAGE}.` })
    }
  }

  const defeated = fighters.filter((fighter) => fighter.hp === 0)
  if (defeated.length > 0) {
    const winner = fighters.find((fighter) => fighter.hp > 0)
    if (winner) events.push({ at: time, message: `${winner.name} wins the bout.` })
    else events.push({ at: time, message: 'Both gladiators fall.' })

    return {
      time,
      phase: 'finished',
      winnerId: winner?.id,
      fighters,
      events: events.slice(-8),
    }
  }

  return { ...previous, time, fighters, events: events.slice(-8) }
}
