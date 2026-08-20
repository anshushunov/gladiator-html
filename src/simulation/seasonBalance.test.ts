// ===========================================================================
// The season content's FIXED balance cohorts (school-season-meta-design.md,
// "Balance acceptance"). Same discipline as `balance.test.ts`: these are
// acceptance bands, not regression snapshots. The seed range and the metric
// formulas are test data that may not be edited to make a run pass -- if the
// content cannot satisfy a band, the correct outcome is a red test and a
// printed distribution, never a widened band.
//
// They live in their own file, separate from `balance.test.ts`, so a failure
// names the NEW content (the two bench specialists and the three scaled
// challenges) rather than the six calibrated definitions those cohorts pin.
// The cohort method itself is shared, not re-implemented: `runBout`/`cohort`
// come from `src/testSupport/balanceCohorts.ts`, which is the same code
// `balance.test.ts` runs, over the same 200 consecutive seeds beginning at
// 20260815.
//
// Every cohort is measured ONCE in the first suite's `beforeAll` and read by
// all four statistical blocks in it, because the five criteria overlap heavily:
// the challenge-1 fresh cohort alone is the input to criteria 1, 2, 3 and 4.
// Re-measuring per block would quadruple a 9000-bout run for nothing.
//
//   fresh   x challenge 1  -- 5 gladiators x 3 opponents x 200 seeds
//   fresh   x challenge 3  -- 5 gladiators x 3 opponents x 200 seeds
//   wounded x challenge 1  -- 5 gladiators x 3 opponents x 200 seeds
//
// The fifth criterion, the golden season, runs no cohort at all: it is one
// seeded season played through three named lineups, nine bouts in total. That
// is why the `beforeAll` is scoped to the cohort suite rather than to the file
// -- `vitest -t 'golden season'` then costs a second rather than nine minutes.
// ===========================================================================

import { beforeAll, describe, expect, it } from 'vitest'
import { COMBAT_STYLES } from '../content/combatStyles'
import { BASELINE_TEST_SEED } from '../content/mvpSeries'
import { SEASON_CHALLENGES, SEASON_ROSTER } from '../content/season'
import { cohort, measure, pct, reportTable } from '../testSupport/balanceCohorts'
import { isFightable, startingHpFor, type FighterCondition } from './condition'
import type { Archetype, FighterDefinition } from './fighters'
import {
  advanceSeasonTicks, assignFighter, confirmLineup, continueSeason, createSeason,
  startNextBout, startNextSeries,
  type ConditionDelta, type SeasonCommandResult, type SeasonState,
} from './season'
import type { BoutOutcome } from './series'

const SEED_COUNT = 200
/** Generous on purpose: 9000 full-fidelity bouts, and a slow CI machine must not turn a balance statement into a flake. */
const COHORT_TIMEOUT_MS = 1_800_000

/** The three veterans, in roster order, and the two appended bench specialists. */
const VETERANS = SEASON_ROSTER.slice(0, 3)
const BENCH = SEASON_ROSTER.slice(3)

/** Challenge 1's opponents are the unscaled six; challenge 3's are the hardest. */
const CHALLENGE_1 = 0
const CHALLENGE_3 = 2

// ---------------------------------------------------------------------------
// Cohorts, measured once
// ---------------------------------------------------------------------------

type CohortCondition = Extract<FighterCondition, 'fresh' | 'wounded'>
interface CohortSpec { condition: CohortCondition; challengeIndex: number }

const COHORTS: readonly CohortSpec[] = [
  { condition: 'fresh', challengeIndex: CHALLENGE_1 },
  { condition: 'fresh', challengeIndex: CHALLENGE_3 },
  { condition: 'wounded', challengeIndex: CHALLENGE_1 },
]

const cohortKey = (condition: CohortCondition, challengeIndex: number, fighterId: string, opponentId: string) =>
  `${condition}:${challengeIndex}:${fighterId}:${opponentId}`

const winRates = new Map<string, number>()

/** Reads a measured win rate, throwing rather than silently returning `undefined` if a block asks for a cohort that was never run. */
function rate(condition: CohortCondition, challengeIndex: number, fighterId: string, opponentId: string): number {
  const key = cohortKey(condition, challengeIndex, fighterId, opponentId)
  const value = winRates.get(key)
  if (value === undefined) throw new Error(`No cohort measured for ${key}`)
  return value
}

/** Mean win rate across a challenge's three opponents -- the "on aggregate" figure the design speaks in. */
const aggregate = (condition: CohortCondition, challengeIndex: number, fighterId: string): number =>
  SEASON_CHALLENGES[challengeIndex].opponents.reduce((sum, opponent) => sum + rate(condition, challengeIndex, fighterId, opponent.id), 0) /
  SEASON_CHALLENGES[challengeIndex].opponents.length

/** Probability of taking a three-bout series given each bout's own independent win rate: at least two of the three. */
function seriesWinRate([a, b, c]: readonly number[]): number {
  return a * b * c + a * b * (1 - c) + a * (1 - b) * c + (1 - a) * b * c
}

/**
 * The best three-slot lineup a full `fresh` roster can field against a
 * challenge: the injective assignment of three distinct gladiators to the
 * three slots (60 of them, for five gladiators) with the highest probability
 * of winning the series. Pure arithmetic over the already-measured cohort --
 * it simulates nothing.
 */
function bestLineup(challengeIndex: number): { fighterIds: string[]; seriesWinRate: number } {
  const opponents = SEASON_CHALLENGES[challengeIndex].opponents
  let best: { fighterIds: string[]; seriesWinRate: number } | null = null
  for (const first of SEASON_ROSTER) {
    for (const second of SEASON_ROSTER) {
      for (const third of SEASON_ROSTER) {
        const fighterIds = [first.id, second.id, third.id]
        if (new Set(fighterIds).size !== 3) continue
        const value = seriesWinRate(fighterIds.map((id, slot) => rate('fresh', challengeIndex, id, opponents[slot].id)))
        if (!best || value > best.seriesWinRate) best = { fighterIds, seriesWinRate: value }
      }
    }
  }
  if (!best) throw new Error('No three-slot lineup exists')
  return best
}

/** One row per gladiator for a given cohort, used only on a failure path. */
function cohortTable(condition: CohortCondition, challengeIndex: number): string[][] {
  const opponents = SEASON_CHALLENGES[challengeIndex].opponents
  return [
    ['gladiator', ...opponents.map((opponent) => opponent.id), 'mean'],
    ...SEASON_ROSTER.map((fighter) => [
      fighter.id,
      ...opponents.map((opponent) => pct(rate(condition, challengeIndex, fighter.id, opponent.id))),
      pct(aggregate(condition, challengeIndex, fighter.id)),
    ]),
  ]
}

// ---------------------------------------------------------------------------
// 1. New gladiators are legitimate
// ---------------------------------------------------------------------------

describe('season roster balance cohorts (five gladiators x three challenges x 200 consecutive seeds from 20260815)', () => {
  // Scoped to this suite rather than the file, so the golden season below --
  // which needs no cohort at all -- can be run on its own in under a second.
  beforeAll(async () => {
    for (const { condition, challengeIndex } of COHORTS) {
      for (const fighter of SEASON_ROSTER) {
        // `fresh` deliberately passes no override at all rather than
        // `startingHpFor('fresh', maxHp)`: that is the same number, and leaving
        // the key absent keeps this cohort bit-identical to the one
        // `balance.test.ts` runs for the same pairing.
        const startingHp = condition === 'wounded' ? { home: startingHpFor('wounded', fighter.maxHp) } : undefined
        for (const opponent of SEASON_CHALLENGES[challengeIndex].opponents) {
          const outcomes = await cohort(fighter, opponent, SEED_COUNT, startingHp)
          winRates.set(cohortKey(condition, challengeIndex, fighter.id, opponent.id), measure(outcomes).homeWinRate)
        }
      }
    }
  }, COHORT_TIMEOUT_MS)

  it('keeps every bench specialist inside the same 15..85% band against the three unscaled opponents', () => {
    const failures: string[] = []
    for (const specialist of BENCH) {
      for (const opponent of SEASON_CHALLENGES[CHALLENGE_1].opponents) {
        const value = rate('fresh', CHALLENGE_1, specialist.id, opponent.id)
        if (value < 0.15 || value > 0.85) failures.push(`${specialist.id}/${opponent.id} win rate ${pct(value)} outside 15..85%`)
      }
    }
    if (failures.length > 0) reportTable('season cohorts -- fresh vs challenge 1', cohortTable('fresh', CHALLENGE_1))
    expect(failures).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 2. Neither same-style gladiator is a strict upgrade
  // -------------------------------------------------------------------------

  it('makes neither same-style gladiator a strict upgrade over the other', () => {
    const failures: string[] = []
    const duplicated = duplicatedStyles()
    expect(duplicated.map(({ style }) => style)).toEqual(['heavy', 'fast'])

    for (const { style, veteran, specialist } of duplicated) {
      const comparisons = SEASON_CHALLENGES[CHALLENGE_1].opponents.map((opponent) => ({
        opponentId: opponent.id,
        veteranRate: rate('fresh', CHALLENGE_1, veteran.id, opponent.id),
        specialistRate: rate('fresh', CHALLENGE_1, specialist.id, opponent.id),
      }))
      const veteranWins = comparisons.filter((c) => c.veteranRate > c.specialistRate)
      const specialistWins = comparisons.filter((c) => c.specialistRate > c.veteranRate)

      // The design's actual criterion: a bench member who loses all three is a
      // strict downgrade and rotating to them is never a real choice; a bench
      // member who wins all three makes the veteran dead weight.
      if (veteranWins.length === 0) failures.push(`${style}: ${veteran.id} beats ${specialist.id} against none of the three opponents`)
      if (specialistWins.length === 0) failures.push(`${style}: ${specialist.id} beats ${veteran.id} against none of the three opponents`)

      // ...and the design's accompanying intent, which the criterion alone does
      // not pin: "weaker on aggregate than the veteran of their own style, but
      // each the better answer to one specific opponent style". Without this a
      // bench that wins two of three comparisons would pass, and benching the
      // veteran would stop costing anything.
      const veteranMean = aggregate('fresh', CHALLENGE_1, veteran.id)
      const specialistMean = aggregate('fresh', CHALLENGE_1, specialist.id)
      if (specialistMean >= veteranMean) {
        failures.push(`${style}: ${specialist.id} mean ${pct(specialistMean)} is not below ${veteran.id}'s ${pct(veteranMean)}`)
      }
    }

    if (failures.length > 0) reportTable('season cohorts -- fresh vs challenge 1', cohortTable('fresh', CHALLENGE_1))
    expect(failures).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 3. Escalation is monotone and survivable
  // -------------------------------------------------------------------------

  it('escalates against every veteran while keeping challenge 3 survivable for the whole roster', () => {
    const failures: string[] = []

    for (const veteran of VETERANS) {
      const first = aggregate('fresh', CHALLENGE_1, veteran.id)
      const third = aggregate('fresh', CHALLENGE_3, veteran.id)
      if (!(third < first)) failures.push(`${veteran.id} mean win rate against challenge 3 ${pct(third)} is not below challenge 1's ${pct(first)}`)
    }

    for (const fighter of SEASON_ROSTER) {
      for (const opponent of SEASON_CHALLENGES[CHALLENGE_3].opponents) {
        const value = rate('fresh', CHALLENGE_3, fighter.id, opponent.id)
        if (value < 0.05 || value > 0.95) failures.push(`${fighter.id}/${opponent.id} in challenge 3 wins ${pct(value)}, outside 5..95%`)
      }
    }

    // The criterion's third part: "the best available three-slot lineup
    // against challenge 3 stays winnable on the majority of the cohort"
    // (design.md, criterion 3). It is the only assertion in this file that
    // measures the "wear may be too harsh" risk at the level of a LINEUP
    // rather than a pairing -- the 5..95% band above passes happily on a
    // roster where every single gladiator is a coin-flip loser, which is
    // exactly the season this slice must not ship.
    //
    // Read off the already-measured `fresh x challenge 3` cohort, no extra
    // bouts: the best lineup is the injective assignment of three of the five
    // gladiators to the three slots that maximizes the probability of taking
    // the series (two bouts of three). The three bouts are combined as
    // independent draws because they are: `deriveBoutSeed` gives each slot
    // its own stream, so within one series the three pairings share no
    // randomness. Measured at 58.3% for `vitus/nerva/brutus`, the best of
    // the sixty.
    const best = bestLineup(CHALLENGE_3)
    if (best.seriesWinRate <= 0.5) {
      failures.push(`best challenge-3 lineup ${best.fighterIds.join('/')} takes the series only ${pct(best.seriesWinRate)} of the time, not a majority`)
    }

    if (failures.length > 0) {
      reportTable('season cohorts -- fresh vs challenge 1', cohortTable('fresh', CHALLENGE_1))
      reportTable('season cohorts -- fresh vs challenge 3', cohortTable('fresh', CHALLENGE_3))
    }
    expect(failures).toEqual([])
  })

  // -------------------------------------------------------------------------
  // 4. Condition bites
  // -------------------------------------------------------------------------

  it('costs a wounded gladiator at least ten points of win rate against every opponent', () => {
    const MINIMUM_DROP = 0.10
    const failures: string[] = []

    for (const fighter of SEASON_ROSTER) {
      for (const opponent of SEASON_CHALLENGES[CHALLENGE_1].opponents) {
        const fresh = rate('fresh', CHALLENGE_1, fighter.id, opponent.id)
        const wounded = rate('wounded', CHALLENGE_1, fighter.id, opponent.id)
        if (fresh - wounded < MINIMUM_DROP) {
          failures.push(`${fighter.id}/${opponent.id} wounded ${pct(wounded)} is only ${pct(fresh - wounded)} below fresh ${pct(fresh)}`)
        }
      }
    }

    if (failures.length > 0) {
      reportTable('season cohorts -- fresh vs challenge 1', cohortTable('fresh', CHALLENGE_1))
      reportTable('season cohorts -- wounded vs challenge 1', cohortTable('wounded', CHALLENGE_1))
    }
    expect(failures).toEqual([])
  })
})

/** Styles fielded by more than one gladiator, pairing the earlier roster entry (the calibrated veteran) with the later one (the bench specialist). */
function duplicatedStyles(): { style: Archetype; veteran: FighterDefinition; specialist: FighterDefinition }[] {
  const byStyle = new Map<Archetype, FighterDefinition[]>()
  for (const fighter of SEASON_ROSTER) byStyle.set(fighter.archetype, [...(byStyle.get(fighter.archetype) ?? []), fighter])
  return [...byStyle.entries()]
    .filter(([, fighters]) => fighters.length === 2)
    .map(([style, [veteran, specialist]]) => ({ style, veteran, specialist }))
}

// ---------------------------------------------------------------------------
// 5. Golden season
// ---------------------------------------------------------------------------

const GOLDEN_LINEUPS = [
  ['brutus', 'aquila', 'nerva'],
  ['vitus', 'sura', 'brutus'],
  ['aquila', 'nerva', 'vitus'],
] as const satisfies readonly (readonly [string, string, string])[]

/** Compact `id:before>after(cause)` so a diff on failure reads as a sequence rather than a wall of objects. */
const formatDeltas = (deltas: readonly ConditionDelta[]): string[] =>
  deltas.map((delta) => `${delta.fighterId}:${delta.before}>${delta.after}(${delta.cause})`)

const formatOutcomes = (outcomes: readonly BoutOutcome[]): string[] =>
  outcomes.map((outcome) => outcome.kind === 'fought'
    ? `${outcome.homeFighterId} vs ${outcome.opponentId}: ${outcome.winnerSide}`
    : `forfeit vs ${outcome.opponentId}`)

/**
 * The bouts themselves, asserted alongside the deltas because the delta
 * sequence ALONE does not discriminate: `conditionAfterBout` charges two rungs
 * both for a loss and for a win that ends under 25% HP, so a series in which a
 * gladiator narrowly wins and one in which he loses can produce byte-identical
 * deltas. Measured -- running this file against the pre-calibration content
 * flipped `vitus vs drusus` from a win to a loss and the delta rows did not
 * move. The season score is the same statement at the season's scale.
 */
const GOLDEN_OUTCOMES: readonly (readonly string[])[] = [
  ['brutus vs drusus: away', 'aquila vs cassius: away', 'nerva vs magnus: home'],
  ['vitus vs drusus: home', 'sura vs cassius: away', 'brutus vs magnus: away'],
  ['aquila vs drusus: away', 'nerva vs cassius: away', 'vitus vs magnus: away'],
]
const GOLDEN_SCORE = { home: 2, away: 7 }

/**
 * The measured sequence, in roster order, one row per series. It is asserted
 * whole rather than sampled because the interesting content is the SHAPE, not
 * any single step: three fighters are charged and two rested every series, a
 * loss costs two rungs and a win one, resting while already `fresh` restores
 * nothing, and `broken` absorbs everything above it. Series 2 charges Brutus
 * from `wounded` straight to `broken`, which is what makes the third challenge
 * a short-handed one.
 */
const GOLDEN_DELTAS: readonly (readonly string[])[] = [
  ['brutus:fresh>wounded(fought)', 'aquila:fresh>wounded(fought)', 'nerva:fresh>bruised(fought)', 'vitus:fresh>fresh(rested)', 'sura:fresh>fresh(rested)'],
  ['brutus:wounded>broken(fought)', 'aquila:wounded>bruised(rested)', 'nerva:bruised>fresh(rested)', 'vitus:fresh>wounded(fought)', 'sura:fresh>wounded(fought)'],
  ['brutus:broken>wounded(rested)', 'aquila:bruised>broken(fought)', 'nerva:fresh>wounded(fought)', 'vitus:wounded>broken(fought)', 'sura:wounded>bruised(rested)'],
]

function expectOk(result: SeasonCommandResult): SeasonState {
  expect(result.reason).toBeUndefined()
  return result.state
}

/** Plays one whole series with three named gladiators in slot order, asserting every command succeeded. */
function playSeries(start: SeasonState, lineup: readonly [string, string, string]): SeasonState {
  let state = expectOk(startNextSeries(start))
  lineup.forEach((fighterId, index) => { state = expectOk(assignFighter(state, fighterId, index)) })
  state = expectOk(confirmLineup(state))
  state = expectOk(advanceSeasonTicks(state, 20_000))
  while (state.activeSeries?.phase === 'between-bouts') {
    state = expectOk(advanceSeasonTicks(expectOk(startNextBout(state)), 20_000))
  }
  return state
}

/** Nine bouts, no cohort: generous only so a slow CI machine cannot flake it. */
const GOLDEN_TIMEOUT_MS = 120_000

describe('golden season (seed 20260815, three named lineups)', () => {
  it('produces the asserted trace and reaches challenges 2 and 3 unable to field a fresh lineup', () => {
    let state = createSeason({ seed: BASELINE_TEST_SEED, roster: SEASON_ROSTER, challenges: SEASON_CHALLENGES, combatStyles: COMBAT_STYLES })
    const boards: SeasonState[] = []

    for (const lineup of GOLDEN_LINEUPS) {
      boards.push(state)
      state = expectOk(continueSeason(playSeries(state, lineup)))
    }

    expect(state.phase).toBe('season-summary')
    expect(state.records.map((record) => formatOutcomes(record.outcomes))).toEqual(GOLDEN_OUTCOMES.map((outcomes) => [...outcomes]))
    expect(state.score).toEqual(GOLDEN_SCORE)
    expect(state.records.map((record) => formatDeltas(record.deltas))).toEqual(GOLDEN_DELTAS.map((deltas) => [...deltas]))

    // The tension quality, asserted rather than hoped for: a series is three
    // slots, so a board with fewer than three `fresh` gladiators cannot field an
    // all-fresh lineup at all -- not the best one, not any one. Both later
    // boards are checked.
    //
    // An earlier version also searched the measured cohorts for the optimal
    // all-fresh lineup and asserted that it contained a worn gladiator. That
    // was tautological: once fewer than three are fresh, EVERY set of three
    // distinct gladiators contains a worn one, so the search could not fail. It
    // is gone, and with it this block's only reason to wait on the cohorts.
    for (const seriesIndex of [1, 2]) {
      const board = boards[seriesIndex]
      expect(board.phase).toBe('season-board')
      expect(board.roster.filter((entry) => entry.condition === 'fresh').length).toBeLessThan(3)
    }

    // Strictly more than the above, and not implied by it: by challenge 3 the
    // school is short-handed, not merely worn -- a gladiator is `broken` and
    // cannot be fielded at any HP. `startNextSeries` drops him from the series
    // roster entirely, so the player picks three from four.
    const unfightable = boards[2].roster.filter((entry) => !isFightable(entry.condition))
    expect(unfightable.map((entry) => entry.fighter.id)).toEqual(['brutus'])
  }, GOLDEN_TIMEOUT_MS)
})
