import { compareArchetypes, comparisonDamageMultiplier, type FighterDefinition, type FighterSide, type MatchupComparison } from './fighters'
import { createRandom, deriveSeed, deriveSideSeed, drawAttackRolls, nextRandom, type RandomState } from './random'

export const TICKS_PER_SECOND = 60
export const MAX_BOUT_TICKS = 2700

const MOVE_PER_TICK = 2.2 / TICKS_PER_SECOND
const ATTACK_RANGE = 1.45
const CRITICAL_MULTIPLIER = 1.5

export type BattleFinishReason = 'defeat' | 'time-limit'
export type BattlePhase = 'running' | 'finished'

export interface BattleConfig { home: FighterDefinition; away: FighterDefinition; seed: number }
export interface FighterCombatState {
  side: FighterSide
  definition: FighterDefinition
  x: number
  hp: number
  nextAttackTick: number | null
  status: 'active' | 'defeated'
}

export interface BattleState {
  tick: number
  phase: BattlePhase
  approachStarted: boolean
  comparison: MatchupComparison
  fighters: Record<FighterSide, FighterCombatState>
  random: Record<FighterSide, RandomState>
  initiativeTieRandom: RandomState
  timeLimitTieWinner: FighterSide
  winnerSide?: FighterSide
  finishReason?: BattleFinishReason
  events: BattleEvent[]
  nextEventId: number
}

type EventBase = { id: number; tick: number }
export type BattleEvent =
  | (EventBase & { type: 'bout-started'; homeFighterId: string; awayFighterId: string })
  | (EventBase & { type: 'approach-started' })
  | (EventBase & { type: 'attack-started'; actorSide: FighterSide; targetSide: FighterSide })
  | (EventBase & { type: 'attack-missed'; actorSide: FighterSide; targetSide: FighterSide })
  | (EventBase & { type: 'attack-blocked'; actorSide: FighterSide; targetSide: FighterSide })
  | (EventBase & { type: 'critical-hit'; actorSide: FighterSide; targetSide: FighterSide; multiplier: number })
  | (EventBase & { type: 'damage-dealt'; actorSide: FighterSide; targetSide: FighterSide; amount: number; remainingHp: number })
  | (EventBase & { type: 'fighter-defeated'; defeatedSide: FighterSide; winnerSide: FighterSide })
  | (EventBase & { type: 'bout-finished'; winnerSide: FighterSide; reason: BattleFinishReason; durationTicks: number })

export function createBattle(config: BattleConfig): BattleState {
  const comparison = compareArchetypes(config.home.archetype, config.away.archetype)
  const [timeLimitTieRoll] = nextRandom(createRandom(deriveSeed(config.seed, 'time-limit-tie')))
  return {
    tick: 0,
    phase: 'running',
    approachStarted: false,
    comparison,
    fighters: {
      home: createFighter('home', config.home, -5),
      away: createFighter('away', config.away, 5),
    },
    random: {
      home: createRandom(deriveSideSeed(config.seed, 'home')),
      away: createRandom(deriveSideSeed(config.seed, 'away')),
    },
    initiativeTieRandom: createRandom(deriveSeed(config.seed, 'initiative-tie')),
    timeLimitTieWinner: timeLimitTieRoll < 0.5 ? 'home' : 'away',
    events: [{ id: 0, tick: 0, type: 'bout-started', homeFighterId: config.home.id, awayFighterId: config.away.id }],
    nextEventId: 1,
  }
}

export function calculateDamage(input: { baseDamage: number; comparison: MatchupComparison; blocked: boolean; critical: boolean }): number {
  const blockMultiplier = input.blocked ? 0.5 : 1
  const criticalMultiplier = input.critical ? CRITICAL_MULTIPLIER : 1
  return Math.max(1, Math.round(input.baseDamage * comparisonDamageMultiplier(input.comparison) * blockMultiplier * criticalMultiplier))
}

export function advanceBattleTick(previous: BattleState): BattleState {
  if (previous.phase === 'finished') return previous

  const tick = previous.tick + 1
  const fighters: Record<FighterSide, FighterCombatState> = {
    home: { ...previous.fighters.home },
    away: { ...previous.fighters.away },
  }
  const random = { ...previous.random }
  let initiativeTieRandom = previous.initiativeTieRandom
  let events: BattleEvent[] = previous.events
  let nextEventId = previous.nextEventId
  let approachStarted = previous.approachStarted
  let phase: BattlePhase = 'running'
  let winnerSide: FighterSide | undefined
  let finishReason: BattleFinishReason | undefined
  const pending: BattleEvent[] = []

  type EventPayload = { [E in BattleEvent as E['type']]: Omit<E, 'id' | 'tick'> }[BattleEvent['type']]
  const emit = (payload: EventPayload): void => {
    pending.push({ id: nextEventId, tick, ...payload } as BattleEvent)
    nextEventId += 1
  }

  const home = fighters.home
  const away = fighters.away
  const gap = away.x - home.x

  if (gap > ATTACK_RANGE) {
    const movement = Math.min(MOVE_PER_TICK, (gap - ATTACK_RANGE) / 2)
    home.x += movement
    away.x -= movement
    if (!approachStarted) {
      approachStarted = true
      emit({ type: 'approach-started' })
    }
  }

  if (away.x - home.x <= ATTACK_RANGE) {
    if (home.nextAttackTick === null) home.nextAttackTick = tick + home.definition.attackIntervalTicks
    if (away.nextAttackTick === null) away.nextAttackTick = tick + away.definition.attackIntervalTicks

    const ready: FighterSide[] = []
    for (const side of ['home', 'away'] as const) {
      const fighter = fighters[side]
      if (fighter.status === 'active' && fighter.nextAttackTick !== null && fighter.nextAttackTick <= tick) ready.push(side)
    }
    ready.sort((a, b) => fighters[a].definition.attackIntervalTicks - fighters[b].definition.attackIntervalTicks)
    if (ready.length === 2 && fighters[ready[0]].definition.attackIntervalTicks === fighters[ready[1]].definition.attackIntervalTicks) {
      const [roll, next] = nextRandom(initiativeTieRandom)
      initiativeTieRandom = next
      if (roll >= 0.5) ready.reverse()
    }

    for (const actorSide of ready) {
      const targetSide: FighterSide = actorSide === 'home' ? 'away' : 'home'
      const actor = fighters[actorSide]
      const target = fighters[targetSide]
      emit({ type: 'attack-started', actorSide, targetSide })

      const { rolls, next } = drawAttackRolls(random[actorSide])
      random[actorSide] = next

      if (rolls.accuracy >= actor.definition.accuracy) {
        emit({ type: 'attack-missed', actorSide, targetSide })
      } else {
        const blocked = rolls.block < target.definition.blockChance
        if (blocked) emit({ type: 'attack-blocked', actorSide, targetSide })
        const critical = !blocked && rolls.critical < actor.definition.criticalChance
        if (critical) emit({ type: 'critical-hit', actorSide, targetSide, multiplier: CRITICAL_MULTIPLIER })

        const comparison = actorSide === 'home' ? previous.comparison : invertComparison(previous.comparison)
        const damage = calculateDamage({ baseDamage: actor.definition.damage, comparison, blocked, critical })
        target.hp = Math.max(0, target.hp - damage)
        emit({ type: 'damage-dealt', actorSide, targetSide, amount: damage, remainingHp: target.hp })

        if (target.hp === 0) {
          target.status = 'defeated'
          emit({ type: 'fighter-defeated', defeatedSide: targetSide, winnerSide: actorSide })
          winnerSide = actorSide
          finishReason = 'defeat'
          emit({ type: 'bout-finished', winnerSide, reason: finishReason, durationTicks: tick })
          phase = 'finished'
          break
        }
      }
      actor.nextAttackTick = tick + actor.definition.attackIntervalTicks
    }
  }

  if (phase === 'running' && tick === MAX_BOUT_TICKS) {
    const homeRatio = home.hp / home.definition.maxHp
    const awayRatio = away.hp / away.definition.maxHp
    if (homeRatio === awayRatio) winnerSide = previous.timeLimitTieWinner
    else winnerSide = homeRatio > awayRatio ? 'home' : 'away'
    finishReason = 'time-limit'
    emit({ type: 'bout-finished', winnerSide, reason: finishReason, durationTicks: tick })
    phase = 'finished'
  }

  if (pending.length > 0) events = [...events, ...pending]
  return {
    tick,
    phase,
    approachStarted,
    comparison: previous.comparison,
    fighters,
    random,
    initiativeTieRandom,
    timeLimitTieWinner: previous.timeLimitTieWinner,
    winnerSide,
    finishReason,
    events,
    nextEventId,
  }
}

export function advanceBattleTicks(initial: BattleState, ticks: number): BattleState {
  let state = initial
  for (let index = 0; index < ticks && state.phase === 'running'; index += 1) {
    state = advanceBattleTick(state)
  }
  return state
}

function createFighter(side: FighterSide, definition: FighterDefinition, x: number): FighterCombatState {
  return { side, definition, x, hp: definition.maxHp, nextAttackTick: null, status: 'active' }
}

function invertComparison(comparison: MatchupComparison): MatchupComparison {
  if (comparison === 'neutral') return 'neutral'
  return comparison === 'advantage' ? 'disadvantage' : 'advantage'
}