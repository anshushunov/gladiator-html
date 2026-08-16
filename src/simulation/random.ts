import type { FighterSide } from './fighters'

export interface RandomState { value: number }
export interface AttackRolls { accuracy: number; block: number; critical: number }
export interface CombatantRandomState {
  decision: RandomState
  defense: RandomState
  contact: RandomState
}

const NON_ZERO_SEED = 0x6d2b79f5

export function createRandom(seed: number): RandomState {
  const value = seed >>> 0
  return { value: value === 0 ? NON_ZERO_SEED : value }
}

export function nextRandom(state: RandomState): [number, RandomState] {
  let value = state.value >>> 0
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  value >>>= 0
  return [value / 0x1_0000_0000, { value }]
}

export function deriveSeed(seed: number, label: string): number {
  let value = (seed ^ 0x811c9dc5) >>> 0
  for (let index = 0; index < label.length; index += 1) {
    value ^= label.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return createRandom(value).value
}

export const deriveBoutSeed = (seriesSeed: number, boutIndex: number): number => deriveSeed(seriesSeed, `bout:${boutIndex}`)
export const deriveSideSeed = (boutSeed: number, side: FighterSide): number => deriveSeed(boutSeed, `side:${side}`)

export function drawAttackRolls(state: RandomState): { rolls: AttackRolls; next: RandomState } {
  const [accuracy, afterAccuracy] = nextRandom(state)
  const [block, afterBlock] = nextRandom(afterAccuracy)
  const [critical, next] = nextRandom(afterBlock)
  return { rolls: { accuracy, block, critical }, next }
}

export function createCombatantRandomState(seed: number, combatantId: string): CombatantRandomState {
  return {
    decision: createRandom(deriveSeed(seed, `${combatantId}:decision`)),
    defense: createRandom(deriveSeed(seed, `${combatantId}:defense`)),
    contact: createRandom(deriveSeed(seed, `${combatantId}:contact`)),
  }
}

export function drawPair(state: RandomState): readonly [
  { first: number; second: number },
  RandomState,
] {
  const [first, afterFirst] = nextRandom(state)
  const [second, afterSecond] = nextRandom(afterFirst)
  return [{ first, second }, afterSecond]
}

export function derivedUnitValue(seed: number, label: string): number {
  return nextRandom(createRandom(deriveSeed(seed, label)))[0]
}

export function foldTraceHash(hash: number, canonicalPart: string): number {
  let value = hash >>> 0
  for (let index = 0; index < canonicalPart.length; index += 1) {
    value ^= canonicalPart.charCodeAt(index)
    value = Math.imul(value, 0x01000193) >>> 0
  }
  return value
}

export function formatTraceHash(hash: number): string {
  return (hash >>> 0).toString(16).padStart(8, '0')
}