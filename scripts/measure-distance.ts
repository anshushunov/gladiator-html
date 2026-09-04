// Where the fight takes place -- the separation on every tick, per ordered
// matchup. The murmillo-pin slice's primary instrument.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS AS A SECOND INSTRUMENT
// ---------------------------------------------------------------------------
//
// `measure-reach.ts` asks, of every gate it owns, one shape of question: when a
// blow landed, how far apart were the fighters? The retiarius-reach playtest
// (`docs/reviews/2026-08-27-retiarius-reach-playtest.md`) found that this
// question and the question a viewer asks can answer in opposite directions.
// Against the murmillo every reach gate went green while the pair did not
// separate at all: the blows that used to land at 0.90 became geometry misses,
// which improves a contact-conditional statistic without moving a single fighter.
//
// The playtest measured the other thing by hand and then threw the code away, so
// its central numbers -- 45.8% -> 37.7% of ticks inside 1.7 pooled, and -0.5
// points in the murmillo matchup against -14.5 in the retiarius mirror -- have
// not been reproducible by anything in this repository since the day they were
// written. That is the gap this file closes.
//
// ---------------------------------------------------------------------------
// WHAT IT MEASURES, AND THE THREE PROTOCOL DECISIONS THAT SHAPE THE ANSWER
// ---------------------------------------------------------------------------
//
//  * PER TICK, NOT PER CONTACT. One sample per tick of every bout, taken at the
//    OPENING of the tick -- before that tick's movement -- which is the same
//    convention `measure-reach.ts` uses for its `start` separation. Two
//    instruments that disagree about what "the separation at tick t" means
//    cannot be read against each other, and being read against each other is the
//    entire point of having both.
//
//  * PER ORDERED MATCHUP, ALWAYS. The pooled figure is reported and is not the
//    headline. The playtest's finding was invisible in the pooled number: the
//    fight moved out by 8.1 points on average and by 0.5 points against the
//    murmillo, and the average is the one that looked like success. Every share
//    below is printed per matchup first.
//
//  * AFTER THE OPENING APPROACH. A duel starts at ~8.4 units and the fighters
//    walk in. Counting that walk makes the metric partly a measurement of
//    approach speed -- and unevenly, since pairings close at different rates,
//    which is precisely the per-pair distortion this instrument exists to
//    remove. The window therefore opens at the first local resolution, using
//    `hasEngaged` in `src/testSupport/distanceHarness.ts`, which is
//    character-for-character the predicate `balanceCohorts.runBout` already uses
//    to read design.md's "at most 300 ticks after initial approach". Both
//    windows are reported; the engaged one is the one to freeze gates against.
//
// The band edges -- the retiarius' committed floor, his committed ceiling, and
// the murmillo's `preferredRange.max` -- are all read from the PATCHED catalog
// by `distanceBands`, never from literals and never from the unpatched global.
// `measure-reach.ts` carries the scar that explains why: reading a yardstick
// from the global meant an overlay that moved the murmillo was judged against
// the murmillo it had replaced.
//
// ---------------------------------------------------------------------------
// `--gate` ARRIVED IN PR-3, WHICH IS WHY IT WAS NOT HERE BEFORE
// ---------------------------------------------------------------------------
//
// An earlier revision of this header said there was no `--gate` here yet,
// deliberately: the slice's gates are frozen in its spec, before
// implementation, against baselines this instrument had not produced. Shipping
// a `--gate` in the same change that first measured the numbers would have been
// choosing the bars after seeing the results.
//
// The bars are now frozen in the spec and the instrument is unchanged since it
// produced them, so the gate lands here in a diff that measures nothing new:
//
//   * **Gate V**, the commitment-frequency floor. `fast-burst-lunge`
//     `action-started` events per 1000 engaged ticks per Fast fighter, at least
//     **3.55** in `fast vs heavy` and in `heavy vs fast` separately. The bar is
//     95% of the shipped 3.76, measured in both orientations. It is a
//     non-regression, not a target: it does not ask a candidate to improve
//     commitment, only to not buy the escape with it. Without V, every other
//     gate in the slice can go green while the retiarius commits even less
//     often than he does today.
//
//   * **Gate U**, the stopping criterion, via `--baseline`. Exactly two fields
//     govern it -- `pinnedShare` and `insideEnvelopeShare`, engaged window, in
//     each of the five ordered matchups containing a Fast fighter. An absolute
//     move of more than **5 percentage points** in either field, in any of the
//     five, stops the work and goes back to the design owner. Everything else
//     this script prints is context and is explicitly excluded, because leaving
//     the binding field unnamed lets a reader pick whichever one suited.
//
//     U is not a threshold on the quantity itself, deliberately: the spec's §1
//     shows that share ranks the counter above the thing it counters, so a
//     threshold on it would be a threshold on the wrong quantity. It is here
//     because a large movement means the candidate changed the matchup rather
//     than the mechanic, and that is a different slice.
//
// ---------------------------------------------------------------------------
// SHIELD SHOVE ATTRIBUTION -- the shove doesn't exist yet, and that's the point
// ---------------------------------------------------------------------------
//
// The murmillo-pin slice's inherited gates P and Q read ground opened from a
// disengage episode's raw endpoints, which does not distinguish the retiarius'
// own locomotion from a push he received. A murmillo shield shove (coming in a
// later PR, id `heavy-shield-shove`) would let P and Q go green on ground the
// *pursuer* opened -- so this instrument reports `voluntaryGroundShare`, the
// share of `groundOpened` that survives `voluntaryGroundOpened`
// (`src/testSupport/disengageGates.ts`), per matchup, over the disengage
// episodes this run already collects.
//
// The five counters beside it -- `shoveStarts`, `shoveContacts`, `shoveMisses`
// and the two `recoveryWindowContactsPer*` ratios -- are gate W's inputs. They
// key off the action id `heavy-shield-shove` as a plain string, not as a member
// of `AttackActionId` (see `SHOVE_ACTION_ID`), because the id is not in that
// union yet -- a later PR adds it, not this one. Comparing as a string rather
// than a typed literal is what lets this file compile today and start counting
// the moment the id exists, with no further change here. Today every shove
// counter reads zero, and a run recorded at this point in the codebase's
// history is committed as the "before" precisely so that claim is falsifiable
// later rather than asserted.
//
// `recoveryWindowContactsPerJab` is NOT expected to read zero: `heavy-shield-jab`
// already ships, so its punishment rate is a real, populated comparator today
// (gate W.3 compares the shove's future rate against it). Only the four counters
// that key off `heavy-shield-shove` itself -- `shoveStarts`, `shoveContacts`,
// `shoveMisses`, `recoveryWindowContactsPerShove` -- are the ones this run
// proves read zero.
//
// FINDING, ACCEPTED BY THE DESIGN OWNER (2026-08-29): the first `voluntaryGroundShare`
// run at 200 seeds came back at 0.84-0.94 in every matchup with a Fast fighter,
// not the ~1 "pushes only from ordinary attacks" implied -- i.e. ordinary attack
// pushes and collision resolution already supply 6-16% of the ground the
// inherited gates P and Q count as an escape, BEFORE any shield shove exists.
// This was invisible until this attribution existed: P and Q read raw
// `groundOpened`, which cannot distinguish that 6-16% from the retiarius' own
// locomotion. The ruling was to proceed without retuning anything --
// `DISENGAGE_SUCCESS_GROUND` (`src/testSupport/disengageGates.ts`) stays at
// `0.75`, nobody recalibrates a threshold mid-slice against the very
// measurement it exists to judge -- and to treat these numbers, recorded in
// `docs/superpowers/plans/2026-08-29-shove-before.json`, as the honest
// "before". The previous slice's P and Q figures, measured on raw ground with
// no attribution, are stale and are not comparators; every later comparison in
// this slice reads against the attributed baseline committed alongside this
// file.
//
// WHAT THE SHOVE SLICE TAUGHT THIS FILE, kept after the shove itself was
// parked (2026-09-04). The two paragraphs above are kept as written because
// they describe the run recorded in `2026-08-29-shove-before.json`, and that
// record's claims must stay falsifiable against the text that made them.
//
// `heavy-shield-shove` DOES NOT EXIST on this branch. `SHOVE_ACTION_ID`'s
// string comparison therefore resolves against nothing and every shove counter
// reads exactly zero -- which is the designed behaviour of a string-keyed probe
// and is what makes this instrument shippable ahead of the mechanic it was
// built to measure. The voluntary-ground attribution beside it reads real
// numbers today.
//
// One correction from that slice is kept because it is a DEFECT FIX, not a
// shove feature:
//
//   * `shoveContacts`, `jabContacts` and the recovery-window ledger no longer
//     read events at all. They read `ContactRecord`s from a `ContactCollector`,
//     because the event-shaped predicate `damage-dealt || attack-blocked`
//     cannot see an unblocked `no-damage` contact -- measured on the parked
//     branch at 46 counted against 1177 real shove contacts, all of them
//     blocked, which would have passed gate W.1's coverage floor on that 4%
//     sample. See `MatchupResult.shoveContacts`.
//
//     THE SWITCH IS VISIBLE TODAY, on a catalogue with no no-damage action in
//     it, and this is worth reading rather than skipping. Measured at 5 seeds
//     over the nine matchups, `jabContacts` is byte-identical either way but
//     `recoveryWindowContactsPerJab` moves 0.0357 -> 0.0222. The old ledger was
//     over-counting: a BLOCKED contact emits `attack-blocked` AND
//     `damage-dealt` (see `classifyContactOutcome` in `encounter.ts`, whose
//     header says so), so the disjunction pushed the same tick onto
//     `contactsAgainst` twice. `ContactRecord` is emitted exactly once per
//     contact intent and cannot. So this correction is not a shove feature and
//     never was -- it is a double count that was present in the punishment
//     ledger for as long as the ledger read events, which the shove merely made
//     loud enough to find. Nothing but this script reads the number.
//
//     WHOSE DEFECT IT WAS, said precisely, because the paragraph above reads on
//     `main` as if `main` had it. **It did not.** There is no event-derived
//     punishment ledger on `main` (`aec7a0a`) at all -- no `ContactCollector`,
//     no `jabContacts`, no `contactsAgainst`, no recovery window. The whole
//     ledger is new work introduced by THIS branch at `44f20ff`, and the double
//     count above lived in the parked shield-shove branch's lineage, between
//     that commit and its fix at `36d8781`. It never reached `main` and never
//     will: what this branch lands is the ledger already corrected. The defect
//     is documented rather than quietly dropped because the 0.0357 -> 0.0222
//     figure below is the evidence that `ContactRecord` and the event
//     disjunction are not interchangeable, and that evidence is worth keeping
//     whichever branch paid for it.
//   * `shoveStarts` and `shoveMisses` still read events; both are correct as
//     written, since `action-started` and the three miss events fire for a
//     no-damage action exactly as they do for any other.
//
// Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds 200
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds 200 --gate
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds 200 --gate --baseline docs/superpowers/plans/2026-08-29-distance-baseline.json
//   node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds 50 --overlay /tmp/candidate.json --json /tmp/out.json

import { readFileSync, writeFileSync } from 'node:fs'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { BASELINE_TEST_SEED } from '../src/content/mvpSeries'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { assembleDisengageEpisodes } from '../src/simulation/disengageDiagnostics'
import type { ContactCollector, ContactOutcome, ContactRecord } from '../src/simulation/contactDiagnostics'
import type { DisengageCollector, DisengageEpisode, DisengageSample } from '../src/simulation/disengageDiagnostics'
import { groundOpened, voluntaryGroundOpened } from '../src/testSupport/disengageGates'
import { percentile } from '../src/testSupport/balanceCohorts'
import {
  accumulate,
  distanceBands,
  emptyAccumulator,
  hasEngaged,
  summarise,
  type DistanceAccumulator,
  type DistanceSummary,
} from '../src/testSupport/distanceHarness'
import { applyOverlay, independentComparatorMatchups, matchupLabel } from '../src/testSupport/reachHarness'
import type { CombatStyleCatalog } from '../src/simulation/combatActions'
import type { Archetype, FighterDefinition } from '../src/simulation/fighters'

const STYLES: readonly Archetype[] = ['heavy', 'fast', 'technical']

/**
 * Not (yet) a member of `AttackActionId` -- Task 5 adds it. Typed `string`
 * rather than left as a literal so `event.actionId === SHOVE_ACTION_ID`
 * compiles against today's `AttackActionId` union instead of tripping
 * TypeScript's no-overlap check on a literal comparison. See the header.
 */
const SHOVE_ACTION_ID: string = 'heavy-shield-shove'

/**
 * The `ContactOutcome`s that mean "the weapon (or the shield) reached the
 * target and the contact resolved against it": a landed hit and a guarded one.
 * Everything else in the union is a non-contact -- `parried`, `evaded`,
 * `missed-geometry`, `missed-accuracy`, `target-unavailable`, `actor-defeated`.
 *
 * This is the ONE definition every resolved-contact count in this file reads,
 * and it is deliberately expressed over outcomes rather than over event types.
 * The event-shaped version (`damage-dealt || attack-blocked`) was a correct
 * paraphrase only while every action dealt damage; it silently stopped being
 * one the moment a `no-damage` action existed, and nothing failed to say so.
 * An outcome cannot go stale that way -- a new outcome kind would not compile
 * into this set without being looked at.
 */
const RESOLVED_OUTCOMES: ReadonlySet<ContactOutcome> = new Set<ContactOutcome>(['hit', 'blocked'])

interface Args { seeds: number; overlay?: string; json?: string; gate: boolean; baseline?: string }

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { seeds: 200, gate: false }
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    const value = argv[i + 1]
    if (flag === '--seeds') { args.seeds = Number(value); i += 1 }
    else if (flag === '--overlay') { args.overlay = value; i += 1 }
    else if (flag === '--json') { args.json = value; i += 1 }
    else if (flag === '--baseline') { args.baseline = value; i += 1 }
    else if (flag === '--gate') { args.gate = true }
    else if (flag.startsWith('--')) throw new Error(`unknown flag ${flag}`)
  }
  if (!Number.isInteger(args.seeds) || args.seeds < 1) throw new Error(`--seeds must be a positive integer, got ${String(args.seeds)}`)
  return args
}

/**
 * The equal-stat cohort, so fighter tuning cannot move a distance measurement
 * any more than it may move a reach one.
 *
 * A DEBT, stated where it will be read: `scripts/measure-reach.ts:146-151` holds
 * an identical private copy of this function, and the two instruments' numbers
 * are comparable only while the copies agree. Unifying them means editing
 * `measure-reach.ts` in the change that is currently producing this slice's
 * baselines from it, which is the move the previous slice's spec forbids
 * outright ("an instrument may not be adjusted in the diff whose numbers it
 * produces"). So the duplication is left standing and owed to whoever next opens
 * that file with a reason to.
 */
function equalStatFighter(id: string, archetype: Archetype): FighterDefinition {
  return { id, name: id, school: 'Style Cohort', archetype, maxHp: 160, power: 20, accuracy: 0.88, defenseChance: 0.35, criticalChance: 0.12 }
}

function catalogFor(overlayPath: string | undefined): CombatStyleCatalog {
  const catalog = structuredClone(COMBAT_STYLES) as unknown as CombatStyleCatalog
  const overlay = overlayPath
    ? (JSON.parse(readFileSync(overlayPath, 'utf8')) as { attacks?: Record<string, unknown>; styles?: Record<string, unknown> })
    : {}
  return applyOverlay(catalog, overlay)
}

interface MatchupResult {
  label: string
  home: Archetype
  away: Archetype
  /** Every tick of every bout, including the opening walk. */
  all: DistanceAccumulator
  /** Only ticks after the bout's first local resolution. The window to freeze against. */
  engaged: DistanceAccumulator
  /**
   * Home wins, reported beside the distance shares and not separately.
   *
   * Added after the first run of this instrument, because its first result
   * invited exactly one misreading and printing the two numbers apart would
   * have let it stand: the hoplomachus spends MORE of his bout inside the
   * murmillo's envelope than the retiarius does, and the counter triangle
   * (`fighters.ts:17-21`) says the hoplomachus BEATS the murmillo. A share of
   * time at close quarters is therefore not evidence of being pinned; the type
   * that wins this matchup is the one that closes hardest. Anyone reading a
   * distance share as a proxy for an outcome should have the outcome on the
   * same line.
   */
  homeWins: number
  bouts: number
  /**
   * `fast-burst-lunge` `action-started` events inside the engaged window,
   * summed over every Fast fighter in the matchup.
   *
   * Reported per fighter, never raw: the mirror has TWO retiarii and the kernel
   * emits one event per actor, so a raw count makes the mirror look twice as
   * committed as it is. That exact error turned a real 22% frequency gap into a
   * reported 61% before it was caught, so the division happens here rather than
   * in whoever reads the number.
   */
  lungeStarts: number
  fastFighters: number
  /** Every forced-disengage episode collected across this matchup's bouts. Powers `voluntaryGroundShare`; nothing else in this file reads it. */
  disengages: DisengageEpisode[]
  /**
   * `action-started` events with `actionId === 'heavy-shield-shove'`. The
   * action does not exist yet (Task 5 adds it), so this and the next four
   * fields read exactly zero until it lands -- see `SHOVE_ACTION_ID`.
   */
  shoveStarts: number
  /**
   * Resolved shove contacts: `ContactRecord`s for the shove id whose `outcome`
   * is `'hit'` or `'blocked'`.
   *
   * DEFECT AND FIX, 2026-08-29. This used to count `damage-dealt`/
   * `attack-blocked` events, which was correct for every action that existed
   * when it was written and silently wrong the moment the shove landed: a
   * `no-damage` action emits NEITHER of those unless the target guards, so an
   * UNBLOCKED shove -- the overwhelming majority, and the only kind that
   * delivers the full 0.90 push and 16-tick stagger -- was invisible. Measured
   * at 46 counted against 1177 real, a 4% sample.
   *
   * The failure mode is the one gate W.1 exists to catch, wearing a disguise:
   * roughly 230 blocked shoves at 200 seeds clears W.1's >=80 floor, so the
   * coverage gate would have gone GREEN on a population consisting entirely of
   * guard-attenuated shoves (push x0.30, stagger 6 instead of 16) -- a gate
   * passing on evidence about a different event than the one it names.
   *
   * `ContactCollector` is the fix rather than a patched event disjunction:
   * `ContactRecord` is emitted exactly once per contact intent, carries
   * `actionId`/`actorId`/`targetId`/`tick` directly, and its `outcome` IS the
   * resolved-contact predicate. Adding `fighter-staggered` to the old
   * disjunction would have double-counted every blocked shove, which emits
   * both.
   */
  shoveContacts: number
  /** `attack-missed`/`attack-evaded`/`attack-parried` for the shove id. */
  shoveMisses: number
  /**
   * Sum, over every resolved shove in this matchup, of resolved contacts taken
   * by the shover -- any action id -- with a tick inside
   * `[contactTick, contactTick + recoveryTicks]`. Divided by `shoveContacts` at
   * report time; gate W.3's punishability numerator.
   *
   * Read from the same `ContactRecord` stream as `shoveContacts`, and for the
   * same reason: the old event-derived ledger had the identical blind spot, so
   * a murmillo punished by a counter-shove inside his own recovery window was
   * not counted -- understating exactly the cost W.3 exists to prove is real.
   */
  shoveRecoveryContacts: number
  /**
   * Resolved `heavy-shield-jab` contacts -- gate W.3's comparator denominator.
   * Not gated on the shove existing, so this is populated today, unlike the
   * shove counters above.
   */
  jabContacts: number
  /** Same accumulation as `shoveRecoveryContacts`, for `heavy-shield-jab`. */
  jabRecoveryContacts: number
}

const args = parseArgs(process.argv.slice(2))
const catalog = catalogFor(args.overlay)
const BANDS = distanceBands(catalog)

/**
 * `catalog.attacks` is indexed by the frozen `AttackActionId` union, which
 * does not include `heavy-shield-shove` yet. Read generically by string so
 * this resolves to `undefined` for the shove today -- correctly, since there
 * is no resolved shove to look a recovery window up for -- and to the
 * authored constant the moment Task 5 adds the id to the catalog, with no
 * further change here.
 */
const attacksById = catalog.attacks as Readonly<Record<string, { recoveryTicks: number } | undefined>>
function recoveryTicksOf(actionId: string): number | undefined {
  return attacksById[actionId]?.recoveryTicks
}

function runMatchup(home: Archetype, away: Archetype, seeds: number): MatchupResult {
  const result: MatchupResult = { label: matchupLabel(home, away), home, away, all: emptyAccumulator(), engaged: emptyAccumulator(), homeWins: 0, bouts: 0,
    lungeStarts: 0, fastFighters: [home, away].filter((a) => a === 'fast').length,
    disengages: [], shoveStarts: 0, shoveContacts: 0, shoveMisses: 0, shoveRecoveryContacts: 0, jabContacts: 0, jabRecoveryContacts: 0 }

  for (let index = 0; index < seeds; index += 1) {
    let battle = createBattle({
      home: equalStatFighter('home', home),
      away: equalStatFighter('away', away),
      seed: BASELINE_TEST_SEED + index,
      combatStyles: catalog,
    })
    const ids = [battle.descriptor.homeId, battle.descriptor.awayId]
    const separationOf = (state: typeof battle): number => {
      const [a, b] = ids.map((id) => state.encounter.combatants[id])
      const dx = a.position.x - b.position.x
      const dz = a.position.z - b.position.z
      return Math.sqrt(dx * dx + dz * dz)
    }

    result.all.bouts += 1
    result.engaged.bouts += 1
    let everEngaged = false

    // Closes over its own accumulator and nothing else, per the constraint
    // `disengageDiagnostics.ts`'s header places on a collector: `record` runs
    // synchronously inside the tick, so reaching into `battle` from in here
    // could perturb the tick it is observing.
    const disengageSamples: DisengageSample[] = []
    const disengageCollector: DisengageCollector = { record: (sample) => disengageSamples.push(sample) }
    /**
     * Every contact intent this bout resolved, straight from the kernel's own
     * phase-9 diagnostics. Same closes-over-nothing-else discipline as
     * `disengageCollector` above: `record` runs synchronously inside the tick.
     *
     * This is the single source for all three resolved-contact populations
     * below -- shoves, jabs, and the punishment ledger -- so they cannot
     * disagree about what "a contact landed" means, which is exactly how the
     * event-derived version came apart when a no-damage action arrived.
     */
    const contactRecords: ContactRecord[] = []
    const contactCollector: ContactCollector = { record: (entry) => contactRecords.push(entry) }

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      // The opening of this tick, before phase 7-8 movement -- the same instant
      // `measure-reach.ts` reads its `start` separation from.
      const separation = separationOf(battle)
      accumulate(result.all, separation, BANDS)
      // `hasEngaged` is monotone: `lastResolutionTick` never returns to 0, so
      // this latches on and the engaged window is a suffix of the bout.
      const engaged = hasEngaged(battle.encounter.combatants, ids)
      if (engaged) {
        everEngaged = true
        accumulate(result.engaged, separation, BANDS)
      }

      const previousTick = battle.encounter.tick
      battle = advanceBattleTick(battle, undefined, contactCollector, disengageCollector)

      for (const event of battle.events) {
        if (event.tick !== previousTick + 1) continue

        // Commitment frequency, counted here rather than inferred from contacts.
        //
        // The numerator is `action-started`, not a contact record, and that is the
        // whole point: `measure-reach.ts` files a contact under `reached` only when
        // the outcome is in `REACHED`, geometry misses in their own bucket, and an
        // action interrupted before phase 9 leaves no record at all. Deriving
        // "attempts" from those buckets counts how many commitments *survived*, not
        // how many were made -- so a candidate that commits less often but more
        // cleanly reads as unchanged. External review caught that on a first draft
        // of this metric and it is the reason this loop counts starts.
        //
        // Gated on `engaged`, the same flag that decided whether this tick entered
        // the denominator, so numerator and denominator describe one tick
        // population. The earlier figure joined contact counts spanning the WHOLE
        // bout to a denominator of engaged ticks only, across two JSON files by
        // hand, and the mismatch survived precisely because nothing computed both
        // halves in one place.
        if (engaged && event.type === 'action-started' && event.actionId === 'fast-burst-lunge') {
          result.lungeStarts += 1
        }

        // Shove/jab attribution, gate W's inputs. Counted over the WHOLE bout,
        // not gated on `engaged`: gate W's coverage and punishability clauses
        // (design spec §4 "W") are whole-run counts with no engaged-window
        // restriction of their own, and inventing one here would disagree with
        // the spec these counters exist to feed.
        if (event.type === 'action-started' && event.actionId === SHOVE_ACTION_ID) {
          result.shoveStarts += 1
        }

        if (
          (event.type === 'attack-missed' || event.type === 'attack-evaded' || event.type === 'attack-parried') &&
          event.actionId === SHOVE_ACTION_ID
        ) {
          result.shoveMisses += 1
        }
      }
    }

    // Ground attribution and the recovery-window punishment counts both need
    // the WHOLE bout's records, so both are assembled once here rather than
    // incrementally inside the tick loop above.
    const assembly = assembleDisengageEpisodes(disengageSamples)
    result.disengages.push(...assembly.episodes)

    // One pass over this bout's contact records builds all three populations.
    // `RESOLVED_OUTCOMES` is the whole definition of "the contact landed", in
    // one place, so the shove population and the punishment ledger cannot drift
    // apart from each other the way the event-derived versions did.
    const resolved = contactRecords.filter((record) => RESOLVED_OUTCOMES.has(record.outcome))
    /** Every tick a fighter took a resolved contact (any action id), keyed by who took it. */
    const contactsAgainst = new Map<string, number[]>()
    for (const record of resolved) {
      const hits = contactsAgainst.get(record.targetId)
      if (hits) hits.push(record.tick)
      else contactsAgainst.set(record.targetId, [record.tick])
    }
    const resolvedShoves = resolved.filter((record) => record.actionId === SHOVE_ACTION_ID)
    const resolvedJabs = resolved.filter((record) => record.actionId === 'heavy-shield-jab')
    result.shoveContacts += resolvedShoves.length
    result.jabContacts += resolvedJabs.length

    const shoveRecoveryTicks = recoveryTicksOf(SHOVE_ACTION_ID)
    if (shoveRecoveryTicks !== undefined) {
      for (const shove of resolvedShoves) {
        const hits = contactsAgainst.get(shove.actorId) ?? []
        result.shoveRecoveryContacts += hits.filter((tick) => tick >= shove.tick && tick <= shove.tick + shoveRecoveryTicks).length
      }
    }

    const jabRecoveryTicks = recoveryTicksOf('heavy-shield-jab')
    if (jabRecoveryTicks !== undefined) {
      for (const jab of resolvedJabs) {
        const hits = contactsAgainst.get(jab.actorId) ?? []
        result.jabRecoveryContacts += hits.filter((tick) => tick >= jab.tick && tick <= jab.tick + jabRecoveryTicks).length
      }
    }

    if (!everEngaged) {
      result.all.unengagedBouts += 1
      result.engaged.unengagedBouts += 1
    }
    result.bouts += 1
    if (battle.winnerSide === 'home') result.homeWins += 1
  }

  return result
}

const matchups: MatchupResult[] = []
for (const home of STYLES) for (const away of STYLES) matchups.push(runMatchup(home, away, args.seeds))

const byLabel = new Map(matchups.map((m) => [m.label, m]))

const fixed = (v: number, p = 2) => v.toFixed(p)
const pct = (v: number) => `${(v * 100).toFixed(1)}%`

function pool(results: readonly MatchupResult[], window: 'all' | 'engaged'): DistanceAccumulator {
  const out = emptyAccumulator()
  for (const m of results) {
    const a = m[window]
    // A loop, not `push(...a.separations)`: a matchup holds hundreds of
    // thousands of samples and spreading that into an argument list overflows
    // the call stack. Found by reading, not by the crash.
    for (const s of a.separations) out.separations.push(s)
    out.pinned += a.pinned
    out.lungeBand += a.lungeBand
    out.beyond += a.beyond
    out.insideEnvelope += a.insideEnvelope
    out.bouts += a.bouts
    out.unengagedBouts += a.unengagedBouts
  }
  return out
}

/**
 * P/Q's addendum, applied here rather than in `disengageGates.ts`: the share
 * of raw ground (`groundOpened`) that survives `voluntaryGroundOpened` --
 * i.e. the share NOT explained by external displacement (shove, attack push,
 * collision resolution) -- over every disengage episode this matchup
 * collected, censored included. `null`, not `NaN`, when `totalGround` is
 * exactly `0` -- which is also what a matchup with zero episodes reports,
 * since summing an empty array is `0`, so the two "nothing to divide" cases
 * share one guard.
 */
function voluntaryGroundShare(m: MatchupResult): number | null {
  const totalGround = m.disengages.reduce((sum, episode) => sum + groundOpened(episode), 0)
  if (totalGround === 0) return null
  const totalVoluntaryGround = m.disengages.reduce((sum, episode) => sum + voluntaryGroundOpened(episode), 0)
  return totalVoluntaryGround / totalGround
}

/**
 * Gate W.3's punishability quantity: recovery-window contacts taken by the
 * shover, per resolved shove. `0`, not `null`, with no resolved shoves --
 * these are counters keyed off an action that does not exist yet, not shares
 * of a population that might be legitimately absent.
 */
function recoveryWindowContactsPerShove(m: MatchupResult): number {
  return m.shoveContacts > 0 ? m.shoveRecoveryContacts / m.shoveContacts : 0
}

/** Same quantity, for `heavy-shield-jab` -- gate W.3's comparator. */
function recoveryWindowContactsPerJab(m: MatchupResult): number {
  return m.jabContacts > 0 ? m.jabRecoveryContacts / m.jabContacts : 0
}

console.log(`\nequal-stat cohorts, ${args.seeds} seeds x 9 ordered matchups${args.overlay ? `, overlay ${args.overlay}` : ''}`)
console.log(`bands from the patched catalog: pinned < ${BANDS.pinFloor} <= lunge band <= ${BANDS.lungeCeiling} < beyond`)
console.log(`murmillo envelope (heavy preferredRange.max), reported as an overlapping share: <= ${BANDS.murmilloEnvelope}\n`)

const header = `${'matchup'.padEnd(24)} ${'ticks'.padStart(8)} ${'med'.padStart(6)} ${'p10'.padStart(6)} ${'p90'.padStart(6)} ${'pinned'.padStart(7)} ${'lunge'.padStart(7)} ${'beyond'.padStart(7)} ${'<=env'.padStart(7)} ${'homeWin'.padStart(8)}`

function printRow(label: string, summary: DistanceSummary | undefined, homeWinRate?: number): void {
  if (!summary) { console.log(`${label.padEnd(24)} ${'0'.padStart(8)}`); return }
  console.log(
    `${label.padEnd(24)} ${String(summary.ticks).padStart(8)} ${fixed(summary.median).padStart(6)} ${fixed(summary.p10).padStart(6)} ` +
    `${fixed(summary.p90).padStart(6)} ${pct(summary.pinnedShare).padStart(7)} ${pct(summary.lungeBandShare).padStart(7)} ` +
    `${pct(summary.beyondShare).padStart(7)} ${pct(summary.insideEnvelopeShare).padStart(7)} ` +
    `${(homeWinRate === undefined ? '--' : pct(homeWinRate)).padStart(8)}`,
  )
}

for (const window of ['engaged', 'all'] as const) {
  console.log(window === 'engaged'
    ? 'AFTER THE OPENING APPROACH (the window to freeze gates against)'
    : '\nEVERY TICK, opening walk included (reported so the choice of window is visible, not gated)')
  console.log(header)
  for (const m of matchups) printRow(m.label, summarise(m[window], percentile), m.bouts > 0 ? m.homeWins / m.bouts : undefined)
  const fastMatchups = matchups.filter((m) => m.home === 'fast' || m.away === 'fast')
  printRow('-- pooled, all nine', summarise(pool(matchups, window), percentile))
  printRow('-- pooled, fast bouts', summarise(pool(fastMatchups, window), percentile))
}

// ---------------------------------------------------------------------------
// The comparison the slice is actually about
// ---------------------------------------------------------------------------
//
// Gate C's shape, applied to time instead of contacts: the retiarius against the
// murmillo, held against the hoplomachus against the murmillo. The comparator
// matchup is taken from `independentComparatorMatchups` and asserted to be a
// member of it rather than written as a literal -- prose stated that rule and
// four separate comparators broke it over the previous slice, three caught in
// review of the spec and one only after it shipped.
const SUBJECT: Archetype = 'fast'
const COMPARATOR: Archetype = 'technical'
const COMPARATOR_MATCHUPS = independentComparatorMatchups(COMPARATOR, SUBJECT, STYLES)
const comparatorLabel = matchupLabel(COMPARATOR, 'heavy')
if (!COMPARATOR_MATCHUPS.includes(comparatorLabel)) {
  throw new Error(`comparator matchup '${comparatorLabel}' is not in the ${SUBJECT}-free set (${COMPARATOR_MATCHUPS.join(', ')})`)
}

const subjectLabel = matchupLabel(SUBJECT, 'heavy')
const subject = summarise((byLabel.get(subjectLabel) as MatchupResult).engaged, percentile)
const comparator = summarise((byLabel.get(comparatorLabel) as MatchupResult).engaged, percentile)

const subjectResult = byLabel.get(subjectLabel) as MatchupResult
const comparatorResult = byLabel.get(comparatorLabel) as MatchupResult
const winRate = (m: MatchupResult) => (m.bouts > 0 ? pct(m.homeWins / m.bouts) : '--')
const line = (label: string, s: DistanceSummary | undefined, m: MatchupResult) =>
  `  ${label.padEnd(22)} pinned ${pct(s?.pinnedShare ?? Number.NaN).padStart(6)}   inside the murmillo ${pct(s?.insideEnvelopeShare ?? Number.NaN).padStart(6)}` +
  `   median ${fixed(s?.median ?? Number.NaN)}   home wins ${winRate(m).padStart(6)}`

console.log('\nTHE PIN, HELD AGAINST THE INDEPENDENT COMPARATOR (engaged window)')
console.log(line(subjectLabel, subject, subjectResult))
console.log(line(comparatorLabel, comparator, comparatorResult))
console.log(`  comparator is ${SUBJECT}-free by construction: ${COMPARATOR_MATCHUPS.join(', ')}`)
console.log('  READ THE WIN RATE BEFORE THE SHARES. The counter triangle in `fighters.ts:17-21` is')
console.log('  heavy -> fast -> technical -> heavy, so TECHNICAL BEATS HEAVY. A larger in-envelope')
console.log('  share for the comparator is the winner of that matchup closing, not the loser being')
console.log('  pinned -- which means this comparison cannot, on its own, tell a pin from a counter.')

// The comparison the playtest actually made, and the one this instrument was
// built for: the same subject against every opponent. It needs no comparator at
// all, because both sides of it are the subject -- so nothing in it can move
// with the thing it judges, which is the defect class this slice's whole gate
// history is made of.
console.log('\nCOMMITMENT FREQUENCY (lunge starts per 1000 engaged ticks, PER FAST FIGHTER)')
console.log('  both halves from this one run; the numerator is action-started, not surviving contacts')
for (const m of matchups) {
  if (m.fastFighters === 0) continue
  const ticks = m.engaged.separations.length
  const rate = ticks > 0 ? (m.lungeStarts / m.fastFighters / ticks) * 1000 : Number.NaN
  console.log(`  ${m.label.padEnd(22)} starts ${String(m.lungeStarts).padStart(5)} / ${m.fastFighters}   engaged ticks ${String(ticks).padStart(7)}   ${fixed(rate).padStart(6)} per 1000`)
}

console.log('\nTHE SAME SUBJECT AGAINST EVERY OPPONENT (what the playtest claimed, and the criterion that needs no yardstick)')
for (const away of STYLES) {
  const m = byLabel.get(matchupLabel(SUBJECT, away)) as MatchupResult
  console.log(line(m.label, summarise(m.engaged, percentile), m))
}

// The shield-shove slice's own inputs: ground attribution (P/Q's addendum) and
// gate W's coverage/punishability counters. Every shove counter reads zero at
// this point in the codebase's history, because `heavy-shield-shove` does not
// exist yet -- see the header. `recoveryWindowContactsPerJab` is the one
// exception, by design: it is gate W.3's comparator and `heavy-shield-jab`
// already ships, so it is populated today.
console.log('\nSHIELD SHOVE ATTRIBUTION (ground attribution for P/Q; gate W\'s coverage and punishability inputs)')
console.log(
  `${'matchup'.padEnd(24)} ${'volGrndShr'.padStart(10)} ${'shvStart'.padStart(8)} ${'shvHit'.padStart(6)} ${'shvMiss'.padStart(7)} ` +
  `${'recov/shv'.padStart(9)} ${'recov/jab'.padStart(9)}`,
)
for (const m of matchups) {
  const share = voluntaryGroundShare(m)
  console.log(
    `${m.label.padEnd(24)} ${(share === null ? '--' : pct(share)).padStart(10)} ${String(m.shoveStarts).padStart(8)} ` +
    `${String(m.shoveContacts).padStart(6)} ${String(m.shoveMisses).padStart(7)} ` +
    `${fixed(recoveryWindowContactsPerShove(m)).padStart(9)} ${fixed(recoveryWindowContactsPerJab(m)).padStart(9)}`,
  )
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

/** Spec §5 V: 95% of the shipped 3.76, measured in both orientations on the corrected definition. */
const LUNGE_RATE_FLOOR = 3.55
/** Spec §5 U: an absolute move of more than this many points in either governed field stops the work. */
const U_TOLERANCE_POINTS = 5

const lungeRate = (m: MatchupResult): number => {
  const ticks = m.engaged.separations.length
  return m.fastFighters > 0 && ticks > 0 ? (m.lungeStarts / m.fastFighters / ticks) * 1000 : Number.NaN
}

const FAST_MATCHUPS = matchups.filter((m) => m.home === SUBJECT || m.away === SUBJECT)

if (args.gate) {
  const failures: string[] = []
  const check = (ok: boolean, description: string) => { if (!ok) failures.push(description) }

  // GATE V -- the retiarius must not stop committing. Asserted per orientation
  // rather than pooled, and per Fast fighter rather than per bout: the mirror
  // contains TWO retiarii and aggregating by action id across actors reported
  // its rate at twice the truth, which is how a 22% reduction was first
  // published as 61%.
  //
  // Both halves come from this one run. The figure this replaces joined attempt
  // counts from `measure-reach.ts` to engaged ticks from here by hand, across
  // two JSON files, which is how a whole-bout numerator over an engaged-window
  // denominator survived being noticed.
  for (const m of [byLabel.get(matchupLabel(SUBJECT, 'heavy')), byLabel.get(matchupLabel('heavy', SUBJECT))]) {
    if (!m) continue
    const rate = lungeRate(m)
    check(rate >= LUNGE_RATE_FLOOR, `V: ${m.label} lunge starts ${fixed(rate)} per 1000 engaged ticks per fighter, below ${LUNGE_RATE_FLOOR}`)
  }

  // GATE U -- reported always, gated only against a recorded baseline. Without
  // `--baseline` there is nothing to compare to, and saying so out loud beats
  // silently passing a clause that never ran.
  if (args.baseline === undefined) {
    console.log('\nU: no --baseline given, so the stopping criterion did not run (it compares two runs, not one)')
  } else {
    const recorded = JSON.parse(readFileSync(args.baseline, 'utf8')) as {
      perMatchup: { label: string; engaged: { pinnedShare: number; insideEnvelopeShare: number } | null }[]
    }
    const before = new Map(recorded.perMatchup.map((row) => [row.label, row.engaged]))
    for (const m of FAST_MATCHUPS) {
      const now = summarise(m.engaged, percentile)
      const then = before.get(m.label)
      if (!now || !then) {
        check(false, `U: ${m.label} is missing from one side of the comparison, so the stopping criterion cannot be evaluated`)
        continue
      }
      // The two governed fields, named here and nowhere else. `median`, `p10`,
      // `p90`, `lungeBandShare`, `beyondShare`, the `all` window and the win
      // rates are reported above and excluded on purpose.
      for (const field of ['pinnedShare', 'insideEnvelopeShare'] as const) {
        const movement = Math.abs(now[field] - then[field]) * 100
        check(movement <= U_TOLERANCE_POINTS,
          `U: ${m.label} ${field} moved ${movement.toFixed(1)} points (${pct(then[field])} -> ${pct(now[field])}), above ${U_TOLERANCE_POINTS} -- STOP and take this to the design owner`)
      }
    }
  }

  console.log('\nGATE')
  if (failures.length === 0) {
    console.log('all distance gates pass')
  } else {
    for (const failure of failures) console.error(`FAIL ${failure}`)
    process.exit(1)
  }
}

if (args.json) {
  writeFileSync(args.json, `${JSON.stringify({
    seeds: args.seeds,
    overlay: args.overlay ?? null,
    bands: BANDS,
    perMatchup: matchups.map((m) => ({
      label: m.label,
      engaged: summarise(m.engaged, percentile) ?? null,
      all: summarise(m.all, percentile) ?? null,
      bouts: m.bouts,
      homeWins: m.homeWins,
      lungeStarts: m.lungeStarts,
      fastFighters: m.fastFighters,
      lungeStartsPer1000EngagedTicksPerFighter:
        m.fastFighters > 0 && m.engaged.separations.length > 0
          ? (m.lungeStarts / m.fastFighters / m.engaged.separations.length) * 1000
          : null,
      // Shield-shove attribution: P/Q's ground addendum, and gate W's coverage
      // and punishability counters. See the header for why every shove counter
      // below reads zero at this point in the codebase's history, and why
      // `recoveryWindowContactsPerJab` does not.
      //
      // `2026-08-29-shove-before.json` was recorded by the EVENT-derived
      // ledger, so its `recoveryWindowContactsPerJab` carries the double count
      // the header describes and is NOT comparable to a run of this file. It is
      // still a valid gate-U baseline: gate U reads `pinnedShare` and
      // `insideEnvelopeShare` and nothing else, and neither comes from the
      // contact ledger.
      voluntaryGroundShare: voluntaryGroundShare(m),
      shoveStarts: m.shoveStarts,
      shoveContacts: m.shoveContacts,
      shoveMisses: m.shoveMisses,
      recoveryWindowContactsPerShove: recoveryWindowContactsPerShove(m),
      recoveryWindowContactsPerJab: recoveryWindowContactsPerJab(m),
    })),
    comparison: { subject: subjectLabel, comparator: comparatorLabel, comparatorMatchups: COMPARATOR_MATCHUPS },
  }, null, 2)}\n`, 'utf8')
  console.log(`\nwrote ${args.json}`)
}
