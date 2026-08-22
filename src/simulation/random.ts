export interface RandomState { value: number }
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

/**
 * Series 0 deliberately reuses the season seed: `combat-visuals.spec.ts`
 * freezes key poses at ticks derived from `deriveBoutSeed(20260815, 0)`, and
 * the season simply opens with the series the game already plays.
 */
export const deriveSeriesSeed = (seasonSeed: number, seriesIndex: number): number =>
  seriesIndex === 0 ? seasonSeed >>> 0 : deriveSeed(seasonSeed, `series:${seriesIndex}`)

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