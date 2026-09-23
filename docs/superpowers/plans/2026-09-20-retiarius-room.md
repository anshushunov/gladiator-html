# The retiarius' room — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the retiarius a net cast that buys measure in one beat, feet that read the arena wall, and a per-fighter skill number that decides how well he uses either — with the battle log finally naming the move.

**Architecture:** Five seams, each already present in the codebase. The net is a new entry in the authored attack catalogue (`src/content/combatStyles.ts`), modelled on `technical-driving-thrust`. The footwork is a weight term in `combatDecision.ts`'s scoring stage, built on the existing `projectedPosition` and `arenaBoundaryMargin` helpers — never a change to `intentDisplacement`, which must keep agreeing with the presentation's gait. Skill is one optional field on `FighterDefinition` turned into a `DecisionModifier` by a new `src/simulation/skill.ts`, an exact structural copy of `src/simulation/disposition.ts`. The log gains a phrase table. The instrument is a new `scripts/measure-boundary.ts` beside `measure-distance.ts`.

**Tech Stack:** TypeScript, Vitest (two projects: `fast` and `slow`), Three.js for presentation, `vite-node` for measurement scripts.

> **Replanned 2026-09-23.** The net cast (originally Task 3) was built, swept over 48 settings, and parked on `wip/retiarius-net-v1`: thrown from the retiarius' own measure it barely moved his time at the wall against the murmillo (51.5 % → 46–52 %) and broke balance in the matchups where it did fire. The owner chose: footwork first, then a net that is legal only when he is pinned. New order: 1 instrument · 2 log · 3 footwork · 4 skill at neutral · 5 last-resort net · 6 net on screen · 7 roster spread. Tasks 1–2 are done. Owner rulings that bind every task: pure snapshots (state hash, recorded traces, fixture episodes, series scores, action-id pins, the golden season) may be re-baselined when a task changes behaviour on purpose, each listed with its reason in the commit — the golden season only if challenges 2 and 3 still cannot field a fresh lineup; design and balance assertions are never re-baselined or widened.

## Global Constraints

- **Never run `npx`** — it is broken on this machine. Invoke binaries through node directly:
  - fast unit tests: `node node_modules/vitest/vitest.mjs run --project fast`
  - slow balance cohorts: `node node_modules/vitest/vitest.mjs run --project slow`
  - one file: `node node_modules/vitest/vitest.mjs run --project fast src/path/to/file.test.ts`
  - typecheck: `node node_modules/typescript/bin/tsc --noEmit`
  - scripts: `node node_modules/vite-node/vite-node.mjs scripts/<name>.ts`
- **Budget the slow suites.** `src/simulation/balance.test.ts` is ~192 s; `dispositionBalance.test.ts` and `seasonBalance.test.ts` are ~550 s each. `--project slow` runs all three. Allow 9–14 minutes and do not kill it early.
- **Simulation determinism is a hard rule.** No runtime trigonometry in `src/simulation/**` (authored sine/cosine literals only), no DOM/Three.js imports there. `src/simulation/architecture.test.ts` and `src/testSupport/nodeImportBoundary.test.ts` enforce both.
- **Acceptance bands are never widened to make a run pass.** `src/simulation/balance.test.ts`'s own header says so. If a band cannot be met by tuning, the outcome is a red test and a reported distribution — that is a finding, not a knob.
- **Arena constants stay put.** `DUEL_RADIUS` 7.5 and `DUEL_LATERAL_LIMIT` 3.3 (`src/simulation/battle.ts:79-80`) are out of scope for this slice.
- **Commit messages** follow the repository's style: a lowercase `type(scope): summary` line, a body explaining the *why* with measured numbers where they exist, and the trailer `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`.
- **Spec:** `docs/superpowers/specs/2026-09-20-retiarius-room-design.md`. **Source finding:** `docs/reviews/2026-09-20-presentation-slice-playtest.md`, Finding 1.

## File Structure

| file | status | responsibility |
|---|---|---|
| `scripts/measure-boundary.ts` | create | the instrument: ticks at the wall, backing issued at the wall, per pairing per side |
| `src/simulation/combatDecision.ts` | modify | export `arenaBoundaryMargin`; add `boundaryReadAdjustment` and wire it into `rawCandidateWeight` |
| `src/simulation/combatActions.ts` | modify | `'fast-net-cast'` joins the `AttackActionId` union and `ATTACK_ACTION_ID_SET` |
| `src/content/combatStyles.ts` | modify | the authored net cast; `fast`'s `attackActionIds` and `baseWeights` |
| `src/simulation/fighters.ts` | modify | optional `skill` field, `NEUTRAL_SKILL`, `fighterSkill()`, validation |
| `src/simulation/skill.ts` | create | the one place a skill number becomes behaviour (copy of `disposition.ts`'s shape) |
| `src/simulation/encounter.ts` | modify | one line: compose skill modifiers with disposition modifiers |
| `src/testSupport/combatFixtures.ts` | modify (Task 4) | `fighterState`/`makeContext` move here so a second test file can use them |
| `src/presentation/actionNames.ts` | create | verb/noun phrase per attack, exhaustive over `AttackActionId` |
| `src/presentation/battleFeed.ts` | modify | use the phrases |
| `src/presentation/netTangle.ts` | create | pure: who is currently tangled in a net, from events + encounter state |
| `src/presentation/fighterModelContract.ts` | modify | the net cast's clip; `fast`'s attack list |
| `src/presentation/ArenaView.ts` | modify | toggle the existing `slot: 'net'` mesh and its clone |
| `src/content/mvpSeries.ts` | modify (Task 7 only) | the authored skill spread |

---

### Task 1: The instrument

Nothing below this task is checkable without it. Its acceptance is that it **reproduces the numbers already printed in the playtest report** — if it does not, the instrument is wrong, not the report.

**Files:**
- Create: `scripts/measure-boundary.ts`
- Modify: `src/simulation/combatDecision.ts` (export `arenaBoundaryMargin`)
- Test: `src/simulation/combatDecision.test.ts` (add cases for the newly exported function)

**Interfaces:**
- Consumes: `createBattle`, `advanceBattleTick`, `MAX_BOUT_TICKS` from `src/simulation/battle`; `homeRoster`, `opponents`, `BASELINE_TEST_SEED` from `src/content/mvpSeries`; `COMBAT_STYLES` from `src/content/combatStyles`.
- Produces: `export function arenaBoundaryMargin(arena: Readonly<CombatArenaDefinition>, position: Readonly<Vec2>): number` from `src/simulation/combatDecision.ts` — Tasks 3 and 4 use it.

- [ ] **Step 1: Write the failing test for the exported margin**

Add to `src/simulation/combatDecision.test.ts`:

```ts
import { arenaBoundaryMargin } from './combatDecision'

// The duel's own dimensions (`battle.ts`'s DUEL_RADIUS / DUEL_LATERAL_LIMIT),
// spelled out rather than taken from `freeArena` — that fixture is deliberately
// roomy so unrelated tests never trip the wall, which is the one thing these
// cases are about.
const duelSized = { ...freeArena, radius: 7.5, lateralLimit: 3.3, minimumSeparation: 1.2 }

describe('arenaBoundaryMargin', () => {
  it('measures the radial boundary when the fighter is out along the long axis', () => {
    expect(arenaBoundaryMargin(duelSized, { x: 7.0, z: 0 })).toBeCloseTo(0.5, 10)
  })

  it('measures the lateral boundary when that one is nearer', () => {
    expect(arenaBoundaryMargin(duelSized, { x: 0, z: 3.0 })).toBeCloseTo(0.3, 10)
  })

  it('returns the smaller of the two in the corner where both bind', () => {
    // Chosen so the two margins differ and the radial one is smaller:
    // |position| = 7.35 gives a radial margin of 0.15, |z| = 3.1 a lateral 0.2.
    const corner = { x: Math.sqrt(7.35 * 7.35 - 3.1 * 3.1), z: 3.1 }
    expect(arenaBoundaryMargin(duelSized, corner)).toBeCloseTo(0.15, 10)
  })

  it('goes negative outside the arena', () => {
    expect(arenaBoundaryMargin(duelSized, { x: 8.0, z: 0 })).toBeCloseTo(-0.5, 10)
  })
})
```

`freeArena` is already imported at the top of that file (`from '../testSupport/combatFixtures'`).

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/combatDecision.test.ts`
Expected: FAIL — `arenaBoundaryMargin` is not exported from `./combatDecision`.

- [ ] **Step 3: Export it**

In `src/simulation/combatDecision.ts:787`, change `function arenaBoundaryMargin` to `export function arenaBoundaryMargin` and extend its doc comment:

```ts
/**
 * Distance from `position` to the nearer of the two arena boundaries (lateral
 * band or outer radius, matching `movement.ts`'s two-stage clamp). Negative
 * outside.
 *
 * Exported so `scripts/measure-boundary.ts` and `skill.ts` ask the same
 * question the policy asks. A second copy of "how close to the wall is this"
 * in the instrument would be free to drift from the one the decision uses,
 * and the instrument's whole job is to report on that decision.
 */
export function arenaBoundaryMargin(arena: Readonly<CombatArenaDefinition>, position: Readonly<Vec2>): number {
```

- [ ] **Step 4: Run the test again**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/combatDecision.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the instrument**

Create `scripts/measure-boundary.ts`:

```ts
// Where the fighters stand RELATIVE TO THE ARENA WALL, every tick, and how
// much of their backing away is issued when there is no room left behind them.
//
// The 2026-09-20 playtest's Finding 1 -- "the retiarius fights with his back to
// the wall" -- was measured once, by hand, and the code was thrown away. It is
// the axis this slice changes, so it needs a standing instrument: `measure-
// distance.ts` samples the separation BETWEEN the fighters and cannot see the
// arena at all, and `contactDiagnostics.ts` samples only contact ticks.
//
// Two columns, because the finding needs both. The first says where he stands.
// The second says whether his own decisions are doing anything: a backing
// intent issued while already at the wall executes into the clamp and buys
// nothing, and the report measured half to two thirds of his backing that way.
//
// Recording only. Nothing here asserts a threshold; the acceptance bands live
// in `src/simulation/*.test.ts`.
//
// Usage:
//   node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts
//   node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts -- --seeds=20 --json=docs/superpowers/plans/2026-09-20-boundary-before.json

import { writeFileSync } from 'node:fs'
import { BASELINE_TEST_SEED, homeRoster, opponents } from '../src/content/mvpSeries'
import { COMBAT_STYLES } from '../src/content/combatStyles'
import { advanceBattleTick, createBattle, MAX_BOUT_TICKS } from '../src/simulation/battle'
import { arenaBoundaryMargin } from '../src/simulation/combatDecision'
import type { FighterDefinition } from '../src/simulation/fighters'
import type { LocomotionIntent } from '../src/simulation/movement'

/**
 * "At the edge" is within this much of either boundary. 0.35 verbatim from the
 * playtest report, so a post-change run is directly comparable to the table
 * printed there. It is a little over one tick of the fastest backward walk
 * (Fast retreats 2.7 u/s = 0.045 u/tick), i.e. "close enough that backing away
 * is about to stop working".
 */
const EDGE_MARGIN = 0.35

/** The intents that mean "I am trying to make room", per the report's definition. */
const BACKING_INTENTS: ReadonlySet<LocomotionIntent> = new Set(['retreat', 'backstep', 'disengage'])

interface SideSample {
  fighterId: string
  archetype: string
  edgeTicks: number
  backingTicks: number
  backingAtEdgeTicks: number
  totalTicks: number
}

interface PairingSample {
  label: string
  home: SideSample
  away: SideSample
}

function emptySide(fighter: FighterDefinition): SideSample {
  return { fighterId: fighter.id, archetype: fighter.archetype, edgeTicks: 0, backingTicks: 0, backingAtEdgeTicks: 0, totalTicks: 0 }
}

function samplePairing(home: FighterDefinition, away: FighterDefinition, seedCount: number): PairingSample {
  const sample: PairingSample = {
    label: `${home.id} (${home.archetype}) vs ${away.id} (${away.archetype})`,
    home: emptySide(home),
    away: emptySide(away),
  }

  for (let index = 0; index < seedCount; index += 1) {
    let battle = createBattle({ home, away, seed: BASELINE_TEST_SEED + index, combatStyles: COMBAT_STYLES })
    const sides = [
      { id: battle.descriptor.homeId, into: sample.home },
      { id: battle.descriptor.awayId, into: sample.away },
    ]

    while (battle.phase === 'running' && battle.encounter.tick < MAX_BOUT_TICKS) {
      battle = advanceBattleTick(battle)
      const arena = battle.encounter.arena
      for (const side of sides) {
        const combatant = battle.encounter.combatants[side.id]
        if (combatant.status !== 'active') continue
        const atEdge = arenaBoundaryMargin(arena, combatant.position) < EDGE_MARGIN
        const backing = BACKING_INTENTS.has(combatant.locomotionIntent)
        side.into.totalTicks += 1
        if (atEdge) side.into.edgeTicks += 1
        if (backing) side.into.backingTicks += 1
        if (backing && atEdge) side.into.backingAtEdgeTicks += 1
      }
    }
  }

  return sample
}

function parseArgs(argv: readonly string[]): { seeds: number; json?: string } {
  let seeds = 20
  let json: string | undefined
  for (const arg of argv) {
    const seedMatch = /^--seeds=(\d+)$/.exec(arg)
    if (seedMatch) seeds = Number(seedMatch[1])
    const jsonMatch = /^--json=(.+)$/.exec(arg)
    if (jsonMatch) json = jsonMatch[1]
  }
  return { seeds, json }
}

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)))
  return rows.map((row) => row.map((cell, column) => (column === 0 ? cell.padEnd(widths[column]) : cell.padStart(widths[column]))).join('  ')).join('\n')
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`
const share = (numerator: number, denominator: number) => (denominator === 0 ? 0 : numerator / denominator)

function main(): void {
  const { seeds, json } = parseArgs(process.argv.slice(2))
  const samples: PairingSample[] = []
  for (const home of homeRoster) {
    for (const away of opponents) {
      samples.push(samplePairing(home, away, seeds))
    }
  }

  const rows: string[][] = [['pairing', 'side', 'who', 'at edge', 'backing', 'backing AT edge']]
  for (const pairing of samples) {
    for (const [label, side] of [['home', pairing.home], ['away', pairing.away]] as const) {
      rows.push([
        pairing.label,
        label,
        `${side.fighterId} (${side.archetype})`,
        pct(share(side.edgeTicks, side.totalTicks)),
        pct(share(side.backingTicks, side.totalTicks)),
        pct(share(side.backingAtEdgeTicks, side.backingTicks)),
      ])
    }
  }

  console.log(`\ntime at the arena wall -- ${seeds} seeds per pairing, every tick of every bout, edge margin ${EDGE_MARGIN}\n`)
  console.log(table(rows))

  // The headline the finding is actually about, restated so a reader does not
  // have to pick it out of eighteen rows. Each SIDE is one observation.
  const byArchetype = (archetype: string, pick: (side: SideSample) => number): number[] =>
    samples.flatMap((pairing) => [pairing.home, pairing.away].filter((side) => side.archetype === archetype).map(pick))
  const mean = (values: readonly number[]): number => values.reduce((sum, value) => sum + value, 0) / (values.length || 1)

  for (const archetype of ['fast', 'technical', 'heavy']) {
    const edge = byArchetype(archetype, (side) => share(side.edgeTicks, side.totalTicks))
    const wasted = byArchetype(archetype, (side) => share(side.backingAtEdgeTicks, side.backingTicks))
    console.log(`\n${archetype}: at the edge ${pct(mean(edge))}, backing issued at the edge ${pct(mean(wasted))} (${edge.length} observations)`)
  }
  console.log('')

  if (json) {
    writeFileSync(json, `${JSON.stringify({ seeds, edgeMargin: EDGE_MARGIN, samples }, null, 2)}\n`)
    console.log(`wrote ${json}\n`)
  }
}

main()
```

- [ ] **Step 6: Add the npm script**

In `package.json`'s `scripts`, after `"measure:pairings"`:

```json
"measure:boundary": "vite-node scripts/measure-boundary.ts",
```

- [ ] **Step 7: Run it and capture the baseline**

Run:
```bash
node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts -- --seeds=20 --json=docs/superpowers/plans/2026-09-20-boundary-before.json
```

Expected: the `brutus vs drusus` and `aquila vs magnus` rows show the retiarius **at the edge ~51.5 % and ~58.4 %**, with backing-at-edge **~50.9 % and ~62.7 %**, and the murmillo at **~0.6–1.2 %**. These are the numbers in `docs/reviews/2026-09-20-presentation-slice-playtest.md:147-150`.

**If they do not match within about a point, stop and investigate the instrument** — the definitions above are what the report used, and a disagreement means one of the two is measuring something else. Do not proceed to Task 2 until this reproduces.

- [ ] **Step 8: Run the full fast suite**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: PASS, all files.

- [ ] **Step 9: Commit**

```bash
git add scripts/measure-boundary.ts package.json src/simulation/combatDecision.ts src/simulation/combatDecision.test.ts docs/superpowers/plans/2026-09-20-boundary-before.json
git commit -F - <<'EOF'
feat(measure): a standing instrument for time spent at the arena wall

Finding 1 of the 2026-09-20 playtest was measured once by hand and the code
thrown away. It is the axis this slice changes, so it needs an instrument
that outlives the session.

Two columns, because the finding needs both: where he stands, and whether
his own backing decisions are doing anything. Reproduces the report's table
(retiarius vs murmillo 51.5 / 50.9 and 58.4 / 62.7, murmillo 0.6-1.2).

`arenaBoundaryMargin` is exported rather than copied into the script: the
instrument's whole job is to report on the decision, so it must ask the
question the decision asks.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: The log names the move

Independent of every other task, and it makes all the later playtests readable. The events already carry what is needed: all five attack events (`AttackMissedEvent`, `AttackEvadedEvent`, `AttackBlockedEvent`, `AttackParriedEvent`, `CriticalHitEvent`, `DamageDealtEvent`) have an `actionId: AttackActionId` field. `battleFeed.ts` currently ignores it.

**Files:**
- Create: `src/presentation/actionNames.ts`
- Create: `src/presentation/actionNames.test.ts`
- Modify: `src/presentation/battleFeed.ts:44-59` (and the two combined-pair branches at `:26-38`)
- Test: `src/presentation/battleFeed.test.ts`

**Interfaces:**
- Consumes: `AttackActionId` from `src/simulation/combatActions`.
- Produces: `export interface AttackPhrase { verb: string; noun: string }` and `export const ATTACK_PHRASES: Readonly<Record<AttackActionId, AttackPhrase>>` from `src/presentation/actionNames.ts`. Task 5 adds the `'fast-net-cast'` entry to it.

- [ ] **Step 1: Write the failing test for the phrase table**

Create `src/presentation/actionNames.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ATTACK_PHRASES } from './actionNames'
import { COMBAT_STYLES } from '../content/combatStyles'

describe('ATTACK_PHRASES', () => {
  it('names every attack in the authored catalogue', () => {
    const missing = Object.keys(COMBAT_STYLES.attacks).filter((id) => !(id in ATTACK_PHRASES))
    expect(missing).toEqual([])
  })

  it('names nothing that is not an attack', () => {
    const extra = Object.keys(ATTACK_PHRASES).filter((id) => !(id in COMBAT_STYLES.attacks))
    expect(extra).toEqual([])
  })

  it('gives a third-person verb phrase and a bare noun for each', () => {
    for (const [id, phrase] of Object.entries(ATTACK_PHRASES)) {
      expect(phrase.verb.length, `${id}.verb`).toBeGreaterThan(0)
      expect(phrase.noun.length, `${id}.noun`).toBeGreaterThan(0)
      expect(phrase.verb, `${id}.verb must not end in punctuation`).not.toMatch(/[.,;]$/)
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/actionNames.test.ts`
Expected: FAIL — cannot resolve `./actionNames`.

- [ ] **Step 3: Write the phrase table**

Create `src/presentation/actionNames.ts`:

```ts
// What the battle feed calls each attack.
//
// The feed used to render "Brutus deals 12" and "Drusus evades" -- it never
// said what was DONE, for any action in the game, which the 2026-09-20
// playtest caught. Every attack event already carries `actionId`
// (`encounter.ts`'s `AttackMissedEvent` through `DamageDealtEvent`); only the
// words were missing.
//
// `Record<AttackActionId, ...>` is a compile-time proof of exhaustiveness: a
// new attack cannot be added to the union without being named here.

import type { AttackActionId } from '../simulation/combatActions'

/** `verb` is third-person present and completes "<name> ___" ("Brutus cleaves"). `noun` is bare and completes "the ___" ("blocks the cleave"). */
export interface AttackPhrase { verb: string; noun: string }

export const ATTACK_PHRASES: Readonly<Record<AttackActionId, AttackPhrase>> = {
  'heavy-shield-jab': { verb: 'jabs with the shield', noun: 'shield jab' },
  'heavy-cleave': { verb: 'cleaves', noun: 'cleave' },
  'fast-slash': { verb: 'slashes', noun: 'slash' },
  'fast-burst-lunge': { verb: 'lunges', noun: 'lunge' },
  'technical-thrust': { verb: 'thrusts', noun: 'thrust' },
  'technical-driving-thrust': { verb: 'drives the spear in', noun: 'driving thrust' },
  'technical-parry-counter': { verb: 'counters', noun: 'counter' },
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/actionNames.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing feed tests**

Add to `src/presentation/battleFeed.test.ts` (follow the existing file's helpers for building events; if it constructs event literals inline, do the same):

```ts
it('names the attack on a hit', () => {
  const events = [
    { id: 1, tick: 60, type: 'damage-dealt', actorId: 'home.brutus', targetId: 'away.drusus', actionInstanceId: 'a1', actionId: 'heavy-cleave', amount: 12, remainingHp: 400, contactZone: 'body', contactPoint: { x: 0, z: 0 } },
  ] as unknown as EncounterEvent[]
  const [entry] = formatBattleFeed(events, { 'home.brutus': 'Brutus', 'away.drusus': 'Drusus' })
  expect(entry.message).toBe('Brutus cleaves for 12.')
})

it('names the attack on a miss', () => {
  const events = [
    { id: 1, tick: 60, type: 'attack-missed', actorId: 'home.brutus', targetId: 'away.drusus', actionInstanceId: 'a1', actionId: 'heavy-shield-jab', reason: 'accuracy' },
  ] as unknown as EncounterEvent[]
  const [entry] = formatBattleFeed(events, { 'home.brutus': 'Brutus', 'away.drusus': 'Drusus' })
  expect(entry.message).toBe('Brutus jabs with the shield and misses.')
})

it('names the attack the defender answered', () => {
  const events = [
    { id: 1, tick: 60, type: 'attack-evaded', actorId: 'home.brutus', targetId: 'away.drusus', actionInstanceId: 'a1', actionId: 'heavy-cleave', evadeIntent: 'backstep' },
  ] as unknown as EncounterEvent[]
  const [entry] = formatBattleFeed(events, { 'home.brutus': 'Brutus', 'away.drusus': 'Drusus' })
  expect(entry.message).toBe('Drusus evades the cleave.')
})
```

- [ ] **Step 6: Run them and watch them fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/battleFeed.test.ts`
Expected: FAIL — messages read `Brutus deals 12.`, `Brutus misses.`, `Drusus evades.`

- [ ] **Step 7: Use the phrases in the feed**

In `src/presentation/battleFeed.ts`, import the table and rewrite `formatEventMessage` plus the two combined branches:

```ts
import { ATTACK_PHRASES } from './actionNames'
```

```ts
function formatEventMessage(event: EncounterEvent, names: Record<CombatantId, string>): string {
  switch (event.type) {
    case 'encounter-started': return 'The gates open.'
    case 'attack-missed': return `${names[event.actorId]} ${ATTACK_PHRASES[event.actionId].verb} and misses.`
    case 'attack-evaded': return `${names[event.targetId]} evades the ${ATTACK_PHRASES[event.actionId].noun}.`
    case 'attack-blocked': return `${names[event.targetId]} blocks the ${ATTACK_PHRASES[event.actionId].noun}.`
    case 'attack-parried': return `${names[event.defenderId]} parries the ${ATTACK_PHRASES[event.actionId].noun}.`
    case 'critical-hit': return `${names[event.actorId]} lands a critical hit.`
    case 'damage-dealt': return `${names[event.actorId]} ${ATTACK_PHRASES[event.actionId].verb} for ${event.amount}.`
    case 'fighter-defeated': return `${names[event.defeatedId]} falls.`
    case 'encounter-finished': return event.reason === 'no-hostile-pairs'
      ? `${names[event.winnerIds[0]]} wins by defeat.`
      : `${names[event.winnerIds[0]]} wins on the time limit.`
    default: return ''
  }
}
```

And in `formatBattleFeed`, the two combined-pair branches (lines 28-37) become:

```ts
      if (previous?.type === 'attack-blocked' && previous.actionInstanceId === event.actionInstanceId) {
        entries.push({ eventId: previous.id, atSeconds: previous.tick / TICKS_PER_SECOND, message: `${names[previous.targetId]} blocks the ${ATTACK_PHRASES[previous.actionId].noun} but takes ${event.amount}.` })
        index -= 1
        continue
      }
      if (previous?.type === 'critical-hit' && previous.actionInstanceId === event.actionInstanceId) {
        entries.push({ eventId: previous.id, atSeconds: previous.tick / TICKS_PER_SECOND, message: `${names[previous.actorId]} ${ATTACK_PHRASES[previous.actionId].verb} for ${event.amount} — a critical hit.` })
        index -= 1
        continue
      }
```

- [ ] **Step 8: Run the feed tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/battleFeed.test.ts`
Expected: PASS. Existing assertions that expected the old wording will fail — **update them to the new wording**, do not revert the change; the old strings are what the playtest reported as a defect.

- [ ] **Step 9: Run the full fast suite and the e2e fast project**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Then: `node node_modules/@playwright/test/cli.js test --project fast`
Expected: PASS. E2E specs asserting on feed text need their expectations updated the same way.

- [ ] **Step 10: Commit**

```bash
git add src/presentation/actionNames.ts src/presentation/actionNames.test.ts src/presentation/battleFeed.ts src/presentation/battleFeed.test.ts tests
git commit -F - <<'EOF'
feat(feed): the battle log says which attack it was

"Brutus deals 12" never said what he did, for any action in the game -- the
2026-09-20 playtest caught it. Every attack event already carried `actionId`
and the feed threw it away; only the words were missing.

The table is `Record<AttackActionId, AttackPhrase>`, so an attack cannot
enter the union without being named. That matters immediately: the net cast
lands next, and a move that buys distance rather than damage is invisible in
a log that only reports damage.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Feet that read the wall

`intentDisplacement` is not touched — rotating a displacement away from the intent that named it would put the simulation and `clipMapping.ts`'s gait into quiet disagreement. The judgement is made where judgements live.

This is also deliberately a *weight* rather than a legality rule: `hasArenaPath` already deletes movement that cannot execute; this addresses movement that executes and accomplishes nothing, which is exactly the kind of thing skill should be able to sharpen or dull (Task 4).

**Files:**
- Modify: `src/simulation/combatDecision.ts` (new `boundaryReadAdjustment`, wired into `rawCandidateWeight`'s locomotion branch at `:815-821`)
- Test: `src/simulation/combatDecision.test.ts`

**Interfaces:**
- Consumes: `arenaBoundaryMargin` (exported in Task 1), `projectedPosition`, `DECISION_INTERVAL_RANGES`, `LOCOMOTION_DIRECTION_GROUP` — all already in the file.
- Produces:
  ```ts
  export function boundaryReadAdjustment(
    context: CombatDecisionContext,
    style: CombatStyleDefinition,
    intent: LocomotionIntent,
  ): number
  ```
  Task 4's skill modifier scales exactly this number.

- [ ] **Step 1: Write the failing tests**

Add to `src/simulation/combatDecision.test.ts`, following the file's existing context-building helper:

```ts
describe('boundaryReadAdjustment', () => {
  const fast = COMBAT_STYLES.styles.fast
  const duelSized = { ...freeArena, radius: 7.5, lateralLimit: 3.3, minimumSeparation: 1.2 }

  /** Both fighters on the duel floor, self facing +x at the target three units away. */
  const at = (self: Vec2, target: Vec2) => makeContext({
    self: fighterState('self', 'fast', { position: self, facing: { x: 1, z: 0 }, targetId: 'target' }),
    target: fighterState('target', 'heavy', { factionId: 'other', position: target }),
    arena: duelSized,
  })

  it('is zero for a fighter with open floor behind him', () => {
    expect(boundaryReadAdjustment(at({ x: 0, z: 0 }, { x: 3, z: 0 }), fast, 'retreat')).toBe(0)
  })

  it('penalises backing away when the wall is right behind him', () => {
    // Facing +x (toward the target), so `retreat` goes -x, into the far wall.
    expect(boundaryReadAdjustment(at({ x: -7.3, z: 0 }, { x: -4.3, z: 0 }), fast, 'retreat')).toBeLessThan(0)
  })

  it('is zero for forward intents wherever he stands', () => {
    expect(boundaryReadAdjustment(at({ x: -7.3, z: 0 }, { x: -4.3, z: 0 }), fast, 'burst-in')).toBe(0)
  })

  it('rewards exactly one circling direction at the wall, the one that opens room', () => {
    const context = at({ x: -7.3, z: 2.0 }, { x: -4.3, z: 2.0 })
    const left = boundaryReadAdjustment(context, fast, 'circle-left')
    const right = boundaryReadAdjustment(context, fast, 'circle-right')
    expect(Math.max(left, right)).toBeGreaterThan(0)
    expect(Math.min(left, right)).toBe(0)
  })

  it('does not pick a circling direction for a fighter in open floor', () => {
    const context = at({ x: 0, z: 0 }, { x: 3, z: 0 })
    expect(boundaryReadAdjustment(context, fast, 'circle-left')).toBe(0)
    expect(boundaryReadAdjustment(context, fast, 'circle-right')).toBe(0)
  })
})
```

`fighterState(id, archetype, overrides)` and `makeContext({ self, target, ... })` are the file's own existing fixtures (`combatDecision.test.ts:40` and `:73`); `freeArena` comes from `../testSupport/combatFixtures`.

- [ ] **Step 2: Run them and watch them fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/combatDecision.test.ts`
Expected: FAIL — `boundaryReadAdjustment` is not exported.

- [ ] **Step 3: Implement it**

In `src/simulation/combatDecision.ts`, below `arenaBoundaryMargin`:

```ts
/**
 * The room a backing intent must leave behind it to be worth choosing.
 *
 * 0.6 is a little over a third of a second of Fast's backward walk (2.7 u/s =
 * 0.045 u/tick, so 0.6 is 13 ticks) and about one whole decision interval's
 * worth of ground for the slower archetypes. Below it the intent is executing
 * into the clamp for most of the time it is committed to.
 */
const BACKING_ROOM = 0.6

/**
 * How much weight the boundary read moves. Sized against the terms already in
 * `rawCandidateWeight`: the distance adjustment is +/-12 and the near-boundary
 * ACTION penalty is -20, so 10 is enough to change which candidate wins without
 * being able to delete one on its own (weights clamp at zero but never invert).
 */
const BOUNDARY_ADJUST = 10

/**
 * What the arena wall is worth to this locomotion intent, before skill scales
 * it (`skill.ts`).
 *
 * Two halves of one judgement:
 *
 * - **Backing into a wall loses weight.** The 2026-09-20 playtest measured
 *   50.9-62.7% of the retiarius' backing intents issued while he was already
 *   within 0.35 of the boundary, where the movement executes into
 *   `clampToArena` and buys nothing.
 * - **At the wall, one circling direction gains it** -- whichever opens more
 *   room over the commitment horizon. `fast` authors `circle-left` and
 *   `circle-right` at 12 apiece, so today that choice is a coin flip, and half
 *   the flips slide him further along the perimeter he is trying to leave.
 *
 * Deliberately a weight, not a legality gate. `hasArenaPath` already deletes
 * movement that CANNOT execute; this is about movement that executes and
 * accomplishes nothing, which is a judgement — and a judgement is the thing a
 * fighter's skill is allowed to sharpen or dull.
 *
 * The horizon is `DECISION_INTERVAL_RANGES[...].max`, matching
 * `movementRestoresAction`: it is how long the combatant is committed to what
 * it picks now. `hasArenaPath`'s one-tick probe is the right horizon for "can
 * this move at all" and the wrong one for "will this still be moving me in half
 * a second".
 */
export function boundaryReadAdjustment(
  context: CombatDecisionContext,
  style: CombatStyleDefinition,
  intent: LocomotionIntent,
): number {
  const group = LOCOMOTION_DIRECTION_GROUP[intent]
  if (group === undefined || group === 'forward') return 0

  const horizon = DECISION_INTERVAL_RANGES[style.archetype].max

  if (group === 'backward') {
    const projected = projectedPosition(context, style, intent, horizon)
    return arenaBoundaryMargin(context.arena, projected) < BACKING_ROOM ? -BOUNDARY_ADJUST : 0
  }

  // Lateral. Only a fighter who is actually in trouble gets steered; elsewhere
  // circling stays the free tactical choice the style authored it as.
  if (arenaBoundaryMargin(context.arena, context.self.position) >= BACKING_ROOM) return 0

  const other: LocomotionIntent = intent === 'circle-left' ? 'circle-right' : 'circle-left'
  const mine = arenaBoundaryMargin(context.arena, projectedPosition(context, style, intent, horizon))
  const theirs = arenaBoundaryMargin(context.arena, projectedPosition(context, style, other, horizon))
  return mine > theirs ? BOUNDARY_ADJUST : 0
}
```

`DECISION_INTERVAL_RANGES` is declared at `:982`, below this point in the file. `const` declarations are hoisted into the module's temporal dead zone but this function only reads it at call time, which is after module evaluation — the same pattern `movementRestoresAction` (`:625`) already relies on.

- [ ] **Step 4: Run the new tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/combatDecision.test.ts`
Expected: PASS for the five new cases. `boundaryReadAdjustment` is not yet wired into scoring, so nothing else changes.

- [ ] **Step 5: Wire it into scoring**

In `rawCandidateWeight` (`:815-821`):

```ts
  if (decision.type === 'locomotion') {
    const intent = decision.locomotionIntent
    let weight = style.baseWeights[intent] ?? 0
    weight += locomotionDistanceAdjustment(intent, currentDistance, style.preferredRange)
    weight += boundaryReadAdjustment(context, style, intent)
    if (intent === 'advance' || intent === 'pressure' || intent === 'burst-in') weight += 8 * context.pressureLevel
    if (intent === 'retreat' || intent === 'disengage') weight -= 8 * context.pressureLevel
    return weight
  }
```

- [ ] **Step 6: Run the fast suite**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: PASS. Frozen decision fixtures asserting a specific candidate order or weight near a boundary will move — **read each one before updating it** and confirm the new number is the boundary term and not a second, unintended change.

- [ ] **Step 7: Measure**

Run:
```bash
node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts -- --seeds=20 --json=docs/superpowers/plans/2026-09-20-boundary-after-footwork.json
```

Target from the spec: the retiarius' "backing issued at the edge" falls materially below 50.9–62.7 %, and his time at the edge moves toward the hoplomachus' 23 %. Record both against Task 1's baseline (`2026-09-20-boundary-before.json`).

Also run the distance instrument, because this touches every archetype's locomotion:
```bash
node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts -- --seeds=20
```
Watch the pinned-at-the-floor share; it must not grow.

- [ ] **Step 8: Run the balance cohorts**

Run: `node node_modules/vitest/vitest.mjs run --project slow`
Expected: ~9–14 min, all bands pass. If red, the knobs are `BACKING_ROOM` (0.6 → 0.5 → 0.4) and `BOUNDARY_ADJUST` (10 → 8 → 6), in that order, with the sweep table pasted into the constants' comments.

- [ ] **Step 9: Commit**

```bash
git add src/simulation/combatDecision.ts src/simulation/combatDecision.test.ts docs/superpowers/plans/2026-09-20-boundary-after-footwork.json
git commit -F - <<'EOF'
feat(decision): fighters read the wall before backing into it

Half to two thirds of the retiarius' backing intents were issued while he
was already within 0.35 of the boundary, where the movement executes into
clampToArena and buys nothing. And `fast` authors circle-left and
circle-right at 12 apiece, so at the wall the direction was a coin flip --
half of them sliding him further along the perimeter he was trying to leave.

A weight, not a legality gate: hasArenaPath already deletes movement that
cannot execute. This is about movement that executes and accomplishes
nothing, which is a judgement -- and a judgement is what a fighter's skill
gets to sharpen or dull, next task.

intentDisplacement is untouched. Rotating a displacement away from the
intent that named it would put the simulation and clipMapping's gait into
quiet disagreement.

Backing issued at the edge: <before> -> <after>.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: Skill, at the neutral point

The gate for this task is that **nothing changes**. With every fighter at the neutral value the cohort numbers must be identical to Task 3's, which is what makes "the seam is inert until someone authors a spread" a checked claim rather than a hope.

`skill` is **optional** on `FighterDefinition` with a neutral default. The spec wrote it as required; optional is strictly better here, because `mvpSeries.ts`, `season.ts` and `balanceCohorts.ts` all build fighters through `as const satisfies readonly FighterDefinition[]`, and a required field would force a value into every cohort fixture — which is exactly the churn this task's gate exists to rule out.

**Files:**
- Modify: `src/simulation/fighters.ts:5-15` (the field), and `validateFighterDefinition` at `:38`
- Create: `src/simulation/skill.ts`
- Create: `src/simulation/skill.test.ts`
- Modify: `src/simulation/encounter.ts:1424`
- Test: `src/simulation/fighters.test.ts`

**Interfaces:**
- Consumes: `boundaryReadAdjustment` and `DecisionModifier` from `src/simulation/combatDecision`; `CombatStyleDefinition` from `src/simulation/combatActions`.
- Produces:
  ```ts
  // fighters.ts
  export const NEUTRAL_SKILL = 0.5
  export function fighterSkill(definition: Readonly<FighterDefinition>): number
  // skill.ts
  export function skillModifiers(
    definition: Readonly<FighterDefinition>,
    style: Readonly<CombatStyleDefinition>,
  ): readonly DecisionModifier[]
  ```

- [ ] **Step 1: Write the failing tests for the field**

Add to `src/simulation/fighters.test.ts`:

```ts
describe('skill', () => {
  const base = { id: 'x', name: 'X', school: 'S', archetype: 'fast' as const, maxHp: 400, power: 20, accuracy: 0.9, defenseChance: 0.3, criticalChance: 0.1 }

  it('defaults to the neutral value when the fighter does not author one', () => {
    expect(fighterSkill(base)).toBe(NEUTRAL_SKILL)
  })

  it('reads an authored value', () => {
    expect(fighterSkill({ ...base, skill: 0.8 })).toBe(0.8)
  })

  it('rejects a value outside 0..1', () => {
    expect(() => validateFighterDefinition({ ...base, skill: 1.4 })).toThrow(/skill/)
    expect(() => validateFighterDefinition({ ...base, skill: -0.1 })).toThrow(/skill/)
  })

  it('accepts both endpoints', () => {
    expect(() => validateFighterDefinition({ ...base, skill: 0 })).not.toThrow()
    expect(() => validateFighterDefinition({ ...base, skill: 1 })).not.toThrow()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/fighters.test.ts`
Expected: FAIL — `fighterSkill` and `NEUTRAL_SKILL` do not exist.

- [ ] **Step 3: Add the field**

In `src/simulation/fighters.ts`:

```ts
export interface FighterDefinition {
  id: string
  name: string
  school: string
  archetype: Archetype
  maxHp: number
  power: number
  accuracy: number
  defenseChance: number
  criticalChance: number
  /**
   * How well this man fights, as opposed to how hard he hits: 0 is a novice,
   * 1 a veteran, `NEUTRAL_SKILL` the fighter the rest of the game was
   * calibrated on. Optional, and absent means neutral -- so every cohort
   * fixture and every roster row that predates this field keeps its exact
   * behaviour.
   *
   * `src/simulation/skill.ts` is the only place it becomes behaviour.
   */
  skill?: number
}

/** The competence everything in this repository was tuned at. A fighter authored here behaves exactly as fighters did before `skill` existed. */
export const NEUTRAL_SKILL = 0.5

export function fighterSkill(definition: Readonly<FighterDefinition>): number {
  return definition.skill ?? NEUTRAL_SKILL
}
```

And in `validateFighterDefinition`, after the `criticalChance` check:

```ts
  if (definition.skill !== undefined) requireProbability(definition.skill, 'skill')
```

- [ ] **Step 4: Run the field tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/fighters.test.ts`
Expected: PASS.

- [ ] **Step 5a: Move the decision-context fixtures where a second test file can reach them**

`skill.test.ts` needs the same `fighterState` / `makeContext` helpers, and they are currently file-local to `src/simulation/combatDecision.test.ts` (`:40` and `:73`). One test file cannot import from another, and a second hand-rolled copy would drift.

Move both functions verbatim into `src/testSupport/combatFixtures.ts` (which already exports `freeArena`), export them, and replace their definitions in `combatDecision.test.ts` with an import. Nothing about their bodies changes.

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/combatDecision.test.ts`
Expected: PASS, unchanged — this step is a pure move.

- [ ] **Step 5b: Write the failing tests for the modifier**

Create `src/simulation/skill.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { skillModifiers } from './skill'
import { COMBAT_STYLES } from '../content/combatStyles'
import { fighterState, freeArena, makeContext } from '../testSupport/combatFixtures'
import type { Vec2 } from './movement'

const base = { id: 'x', name: 'X', school: 'S', archetype: 'fast' as const, maxHp: 400, power: 20, accuracy: 0.9, defenseChance: 0.3, criticalChance: 0.1 }
const fast = COMBAT_STYLES.styles.fast
const duelSized = { ...freeArena, radius: 7.5, lateralLimit: 3.3, minimumSeparation: 1.2 }

const at = (self: Vec2, target: Vec2) => makeContext({
  self: fighterState('self', 'fast', { position: self, facing: { x: 1, z: 0 }, targetId: 'target' }),
  target: fighterState('target', 'heavy', { factionId: 'other', position: target }),
  arena: duelSized,
})

describe('skillModifiers', () => {
  it('is empty for a fighter with no authored skill', () => {
    expect(skillModifiers(base, fast)).toEqual([])
  })

  it('is empty at the neutral value, so the seam allocates nothing', () => {
    expect(skillModifiers({ ...base, skill: 0.5 }, fast)).toEqual([])
  })

  it('is present away from neutral', () => {
    expect(skillModifiers({ ...base, skill: 0.9 }, fast)).toHaveLength(1)
    expect(skillModifiers({ ...base, skill: 0.1 }, fast)).toHaveLength(1)
  })

  it('leaves actions alone', () => {
    const [modifier] = skillModifiers({ ...base, skill: 1 }, fast)
    const context = at({ x: -7.3, z: 0 }, { x: -4.3, z: 0 })
    expect(modifier.adjustCandidate({ context, decision: { type: 'action', actionId: 'fast-slash' }, weight: 10 })).toBe(0)
  })

  it('sharpens the boundary read for a veteran and dulls it for a novice', () => {
    const context = at({ x: -7.3, z: 0 }, { x: -4.3, z: 0 })
    const decision = { type: 'locomotion' as const, locomotionIntent: 'retreat' as const }
    const [veteran] = skillModifiers({ ...base, skill: 1 }, fast)
    const [novice] = skillModifiers({ ...base, skill: 0 }, fast)
    // The base read is negative here (backing into the wall), so a veteran
    // pushes it further down and a novice pulls it back toward zero.
    expect(veteran.adjustCandidate({ context, decision, weight: 10 })).toBeLessThan(0)
    expect(novice.adjustCandidate({ context, decision, weight: 10 })).toBeGreaterThan(0)
  })

  it('does nothing where the wall does nothing', () => {
    const context = at({ x: 0, z: 0 }, { x: 3, z: 0 })
    const [veteran] = skillModifiers({ ...base, skill: 1 }, fast)
    expect(veteran.adjustCandidate({ context, decision: { type: 'locomotion', locomotionIntent: 'retreat' }, weight: 10 })).toBe(0)
  })
})
```

- [ ] **Step 6: Run and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/skill.test.ts`
Expected: FAIL — cannot resolve `./skill`.

- [ ] **Step 7: Write the modifier**

Create `src/simulation/skill.ts`:

```ts
// The one place a fighter's `skill` becomes behaviour. Deliberately shaped like
// `disposition.ts`: the number lives on the fighter definition as plain data,
// and the `DecisionModifier` it maps to lives only here, so `EncounterState`
// stays structurally clonable and `combatDecision.ts` does not grow a second
// policy.
//
// WHAT IT DOES TODAY, AND WHY ONLY THAT
//
// One mechanic: the boundary read (`boundaryReadAdjustment`). That is the
// judgement the 2026-09-20 playtest was about -- "неопытный дольше будет стоять
// у стены и принимать удары, а опытный быстрее отходить" -- and it is the only
// one this slice measured. The others attach here as they are built, each with
// its own cohort run; a seam that quietly gained four untested terms at once
// would be the same mistake `disposition.ts`'s header warns about.
//
// THE NEUTRAL POINT IS INERT BY CONSTRUCTION
//
// `skillModifiers` returns the frozen empty array at `NEUTRAL_SKILL`, so a
// roster that authors no skill allocates nothing and scores exactly the
// candidates it scored before this file existed. That is checked rather than
// asserted: `balance.test.ts`'s cohorts were run on both sides of this commit.

import type { CombatStyleDefinition } from './combatActions'
import { boundaryReadAdjustment, type DecisionModifier } from './combatDecision'
import { fighterSkill, NEUTRAL_SKILL, type FighterDefinition } from './fighters'

/**
 * How much of the boundary read a fighter at the extremes gains or loses.
 *
 * 1.0 means a veteran reads the wall twice as strongly as an average fighter
 * and a novice does not read it at all -- the full span of the mechanic, which
 * is what makes two retiarii visibly different men rather than the same man
 * with a rounding difference. The span is bounded by the base term either way:
 * `combatDecision.ts` clamps every weight at zero, so no skill value can invert
 * a candidate, only suppress or promote it.
 */
const BOUNDARY_GAIN = 1.0

const NO_MODIFIERS: readonly DecisionModifier[] = Object.freeze([])

function boundaryModifier(style: Readonly<CombatStyleDefinition>, skill: number): DecisionModifier {
  // -1 at skill 0, 0 at neutral, +1 at skill 1.
  const gain = ((skill - NEUTRAL_SKILL) / NEUTRAL_SKILL) * BOUNDARY_GAIN
  return {
    id: 'skill:boundary',
    adjustCandidate({ context, decision }) {
      if (decision.type !== 'locomotion') return 0
      return boundaryReadAdjustment(context, style, decision.locomotionIntent) * gain
    },
  }
}

export function skillModifiers(
  definition: Readonly<FighterDefinition>,
  style: Readonly<CombatStyleDefinition>,
): readonly DecisionModifier[] {
  const skill = fighterSkill(definition)
  if (skill === NEUTRAL_SKILL) return NO_MODIFIERS
  return [boundaryModifier(style, skill)]
}
```

- [ ] **Step 8: Run the modifier tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/skill.test.ts`
Expected: PASS.

- [ ] **Step 9: Wire it into the encounter**

In `src/simulation/encounter.ts:1424`, replace the single line with:

```ts
    const disposition = dispositionModifiers(self.disposition ?? 'standard')
    // Allocates nothing at the neutral skill -- see `skill.ts`'s header for why
    // that property is load-bearing rather than an optimisation.
    const skill = skillModifiers(self.definition, style)
    const modifiers = skill.length === 0 ? disposition : [...disposition, ...skill]
```

Add the import: `import { skillModifiers } from './skill'`.

- [ ] **Step 10: Typecheck, fast suite, architecture boundary**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Then: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: PASS, including `src/simulation/architecture.test.ts` and `src/testSupport/nodeImportBoundary.test.ts` — `skill.ts` imports nothing outside `src/simulation/`.

- [ ] **Step 11: The gate — prove it changed nothing**

Run: `node node_modules/vitest/vitest.mjs run --project slow`
Expected: ~9–14 min, all bands pass, and **the printed cohort numbers are identical to Task 3's run**. Compare them row by row.

If any number moved, the seam is not inert: find out why before authoring any spread. The likely cause is a modifier reaching a code path where `skillModifiers` returned a non-empty array for a neutral fighter.

Also confirm the instrument is unmoved:
```bash
node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts -- --seeds=20
```
Expected: the same table as Task 3's after-footwork run.

- [ ] **Step 12: Commit**

```bash
git add src/simulation/fighters.ts src/simulation/fighters.test.ts src/simulation/skill.ts src/simulation/skill.test.ts src/simulation/encounter.ts
git commit -F - <<'EOF'
feat(simulation): one skill number, at the seam built for it

`DecisionModifier` has carried the comment "the future skill/perk seam"
since it was written and never had a second user. This is it: an optional
`skill` on FighterDefinition, and a `skill.ts` shaped exactly like
`disposition.ts` -- data on the fighter, behaviour in one file, EncounterState
still structurally clonable.

It scales one thing, the boundary read from the previous commit, because
that is the only judgement this slice measured. The others attach here as
they are built, each with its own cohort run.

The neutral point is inert by construction: `skillModifiers` returns the
frozen empty array at 0.5 and the encounter does not even build a new array,
so a roster that authors no skill scores exactly what it scored before this
file existed. Checked, not assumed -- the slow cohorts print the same
numbers on both sides of this commit.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: The net, for when he is in trouble

**Replanned 2026-09-23.** The first version of this task (parked on branch `wip/retiarius-net-v1`, commit `7ca6f7f`) threw the net from the retiarius' own measure, 2.4–3.6. That was the wrong place: the murmillo fights at 1.5–2.0, so the net was thrown ~1.4 times per murmillo bout and moved his time at the wall only 51.5 % → 46–52 %, while firing 5–10 times per bout in the mirror and against the hoplomachus and breaking the balance there. Lowering the floor to 1.5 cut wall time to ~41 % but collapsed nerva/drusus to 8–14 %. Full sweep: `.superpowers/sdd/2026-09-20-retiarius-room/net-v1-report.md` (git-ignored SDD workspace).

So the net becomes a **last resort**: it can be thrown from close range, but it is a legal candidate only while the retiarius is actually in trouble — near the wall *and* with his opponent inside his measure. That puts it exactly where the finding is, and almost nowhere else.

**Files:**
- Bring over from `7ca6f7f` (`git cherry-pick -n 7ca6f7f`, then edit): `src/simulation/combatActions.ts` (union + `ATTACK_ACTION_ID_SET`), `src/content/combatStyles.ts`, `src/content/combatStyles.test.ts`, `src/presentation/actionNames.ts`, `src/presentation/fighterModelContract.ts`. Drop the parked `docs/superpowers/plans/2026-09-20-boundary-after-net.json` — it measures the old design.
- Modify: `src/simulation/combatDecision.ts` (`legalActionCandidates` at `:697`, plus a new predicate)
- Test: `src/simulation/combatDecision.test.ts`

**Interfaces:**
- Consumes: `arenaBoundaryMargin` (Task 1), `ATTACK_PHRASES` (Task 2), `BACKING_ROOM` and the post-footwork baseline `docs/superpowers/plans/2026-09-20-boundary-after-footwork.json` (Task 3).
- Produces: the `'fast-net-cast'` member of `AttackActionId` and the `net` tag, used by Task 6; `export const NET_TAG = 'net'` and `export function isPressedAtWall(context: CombatDecisionContext, style: CombatStyleDefinition): boolean` from `combatDecision.ts`.

**Values.** Change these from the parked commit; every other field stays as parked (push 0.90, stagger 45, damage 0.35, accuracy −0.05, windup 14, impact 2, recovery 16, rootTravel 0, priority 35, tags `attack probe net unparryable`):

| field | parked | now | why |
|---|---|---|---|
| `contactRange` | 2.4 – 3.6 | **1.2 – 3.3** | reaches the murmillo's 1.5–2.0; max 3.3 is the parked sweep's fix for the resolution gap (a hit at 3.6 left two retiarii ~4.4 apart, past `burst-in`'s 4.3 start range, and they circled ~300 ticks) |
| `baseWeights['fast-net-cast']` | 10 | 10 | unchanged start; first sweep knob |

The gate's wall margin is **`BACKING_ROOM`** from Task 3 (0.6, "nowhere left to back into"). Reuse that constant; do not create a second 0.6 with its own name.

- [ ] **Step 1: Bring over the parked scaffolding**

```bash
git cherry-pick -n 7ca6f7f
git restore --staged docs/superpowers/plans/2026-09-20-boundary-after-net.json
rm docs/superpowers/plans/2026-09-20-boundary-after-net.json
```

Set `contactRange: { min: 1.2, max: 3.3 }` and rewrite the action's comment in the file's house style: it is now a last-resort net, and the comment says why, with the table above. Remove the claim that it is "the longest contact range in the game" — 3.3 is below `technical-driving-thrust`'s max.

In `combatStyles.test.ts`, replace the parked test `is thrown from his own measure, not from inside it` with:

```ts
  it('reaches the murmillo where the murmillo actually fights', () => {
    expect(net.contactRange.min).toBeLessThanOrEqual(COMBAT_STYLES.styles.heavy.preferredRange.min)
  })

  it('stops short of the range where a hit strands both fighters out of reach', () => {
    // A hit pushes 0.90; from 3.3 that leaves ~4.2, inside burst-in's 4.3
    // start range. From 3.6 it left ~4.4 and two retiarii circled ~300 ticks.
    expect(net.contactRange.max + net.pushDistance).toBeLessThanOrEqual(COMBAT_STYLES.attacks['fast-burst-lunge'].startMaxRange ?? Infinity)
  })
```

- [ ] **Step 2: Write the failing gate tests**

Add to `src/simulation/combatDecision.test.ts`, using the fixtures `fighterState` / `makeContext` / `freeArena` (from `src/testSupport/combatFixtures.ts` — Task 4 moved them there):

```ts
describe('the net is a last resort', () => {
  const fast = COMBAT_STYLES.styles.fast
  const duelSized = { ...freeArena, radius: 7.5, lateralLimit: 3.3, minimumSeparation: 1.2 }
  const at = (self: Vec2, target: Vec2) => makeContext({
    self: fighterState('self', 'fast', { position: self, facing: { x: 1, z: 0 }, targetId: 'target' }),
    target: fighterState('target', 'heavy', { factionId: 'other', position: target }),
    arena: duelSized,
  })
  const offersNet = (context: CombatDecisionContext) =>
    scoreCombatCandidates(context, fast).some((c) => c.decision.type === 'action' && c.decision.actionId === 'fast-net-cast')

  it('is offered with his back to the wall and the murmillo on top of him', () => {
    expect(offersNet(at({ x: -7.2, z: 0 }, { x: -5.4, z: 0 }))).toBe(true)
  })

  it('is not offered in open floor, however close the murmillo is', () => {
    expect(offersNet(at({ x: 0, z: 0 }, { x: 1.8, z: 0 }))).toBe(false)
  })

  it('is not offered at the wall when he still has his measure', () => {
    expect(offersNet(at({ x: -7.2, z: 0 }, { x: -4.2, z: 0 }))).toBe(false)
  })
})
```

Also add direct cases for `isPressedAtWall` covering each half of the condition failing alone.

- [ ] **Step 3: Run them and watch them fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/combatDecision.test.ts`
Expected: FAIL — the open-floor and still-has-his-measure cases offer the net, and `isPressedAtWall` does not exist.

- [ ] **Step 4: Implement the gate**

In `src/simulation/combatDecision.ts`:

```ts
/** Actions carrying this tag are last resorts: legal only while the actor `isPressedAtWall`. */
export const NET_TAG = 'net'

/**
 * In trouble: backed near the arena wall AND with the opponent inside this
 * style's preferred range -- the exact situation the 2026-09-20 playtest
 * reported, and the only one the net is for.
 *
 * Both halves are required. The wall alone is not trouble (a retiarius
 * circling along it at his own measure is fine); an opponent inside his
 * measure in open floor is not trouble either (he can still walk). The parked
 * first version of the net had no gate and was thrown 5-10 times per bout in
 * the mirror and against the hoplomachus -- where it broke the balance --
 * and ~1.4 times against the murmillo, where it was needed.
 */
export function isPressedAtWall(context: CombatDecisionContext, style: CombatStyleDefinition): boolean {
  const distance = distanceBetween(context.self.position, context.target.position)
  return arenaBoundaryMargin(context.arena, context.self.position) < BACKING_ROOM && distance < style.preferredRange.min
}
```

and in `legalActionCandidates`, after the `FORCED_ACTION_TAG` check:

```ts
    if (action.tags.includes(NET_TAG) && !isPressedAtWall(context, style)) continue
```

Because the gate sits in legality, the anti-stall exemption (`viableActionCandidates` / `movementRestoresAction`) sees it too — a fighter cannot unlock the net by walking, which is correct.

- [ ] **Step 5: Run the tests**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Then: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: gate tests PASS. Snapshot tests (state hash, recorded traces, disengage episodes, series scores, action-id pins) may move. Per the owner's 2026-09-23 ruling, re-baseline a pure snapshot **only** after confirming the change comes from this task, and list each one with its reason in the commit body. Design and balance assertions — e.g. "the all-counter lineup must not sweep" — are **not** snapshots: if one fails, stop and report NEEDS_CONTEXT.

- [ ] **Step 6: Measure against the post-footwork baseline**

```bash
node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts -- --seeds=20 --json=docs/superpowers/plans/2026-09-20-boundary-after-net.json
```

Compare with Task 3's `2026-09-20-boundary-after-footwork.json`. Also report, from a scratch script in the SDD workspace (not committed), **nets thrown per bout per pairing** — the parked version's failure was nets in the wrong matchups, so this number is the check that the gate does its job. Target: materially lower wall time for the retiarius against the murmillo, and few nets in the mirror and against the hoplomachus.

- [ ] **Step 7: Run the balance cohorts; sweep only on evidence**

Run the full slow project in the background (9–14 min, outruns the 10-min Bash timeout), logging to the SDD workspace.

If a band goes red, diagnose first (which pairing, how many nets there, why), then pick the knob from this list with the evidence written down: `baseWeights['fast-net-cast']` 10 → 8 → 6; `unparryable` → `parryable` (if nerva/drusus is the red row — a parry is the hoplomachus' own answer); `pushDistance` 0.90 → 0.80; `staggerTicks` 45 → 35. The parked sweep showed stagger is the weakest lever, so it goes last. Do not move `BACKING_ROOM` here — Task 3 tuned it for footwork.

The golden season may be re-baselined per the owner's ruling (only if challenges 2 and 3 still cannot field a fresh lineup). **Never widen a band.** If no setting clears the bands, stop and report BLOCKED with the distribution.

- [ ] **Step 8: Commit**

Stage the files listed above plus `docs/superpowers/plans/2026-09-20-boundary-after-net.json`, and commit as `feat(combat): the retiarius casts a net when he is pinned`. The body carries: the parked first version and what it measured; the gate; before/after wall numbers against the post-footwork baseline; nets per bout by pairing; the sweep table if one ran; every re-baselined snapshot with its reason; trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

---

### Task 6: The net is visible on the man it caught

The retiarius' model **already carries a net**: `public/models/fast.glb` has a mesh node named `net` with `extras.slot = 'net'`, bone-parented to his off hand, and `ArenaView.ts` already knows about the slot (`HELD_EQUIPMENT_SLOTS` at `:292`, `SAFE_AREA_EXEMPT_SLOTS` at `:306`). No new geometry is needed — the net moves from his hand onto his opponent and back.

The tangle is driven by simulation state, not by a timer, so it is immune to the effect-life problem Finding 2 describes: at ×4 speed a wall-clock effect is compressed, but "this combatant is staggered" is true for exactly as many ticks either way.

**Files:**
- Create: `src/presentation/netTangle.ts`
- Create: `src/presentation/netTangle.test.ts`
- Modify: `src/presentation/ArenaView.ts` (rig construction; the event scan near `:1240-1280`; the per-frame update near `:1139`)

**Interfaces:**
- Consumes: `'fast-net-cast'` from Task 5; `EncounterEvent`, `EncounterState` from `src/simulation/encounter`.
- Produces:
  ```ts
  export interface NetTangle { casterId: CombatantId; targetId: CombatantId }
  export function updateNetTangles(
    previous: readonly NetTangle[],
    events: readonly EncounterEvent[],
    encounter: Readonly<EncounterState>,
  ): NetTangle[]
  ```

- [ ] **Step 1: Write the failing test**

Create `src/presentation/netTangle.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { updateNetTangles, type NetTangle } from './netTangle'
import type { EncounterEvent, EncounterState } from '../simulation/encounter'

const encounterAt = (tick: number, staggerUntilTick: number): EncounterState =>
  ({ tick, combatants: { 'away.brutus': { staggerUntilTick } } }) as unknown as EncounterState

const netHit = (tick: number): EncounterEvent =>
  ({ id: 1, tick, type: 'damage-dealt', actorId: 'home.drusus', targetId: 'away.brutus', actionInstanceId: 'a1', actionId: 'fast-net-cast', amount: 3, remainingHp: 400, contactZone: 'body', contactPoint: { x: 0, z: 0 } }) as unknown as EncounterEvent

const slashHit = (tick: number): EncounterEvent =>
  ({ ...(netHit(tick) as object), actionId: 'fast-slash' }) as unknown as EncounterEvent

describe('updateNetTangles', () => {
  it('starts a tangle when a net lands', () => {
    expect(updateNetTangles([], [netHit(100)], encounterAt(100, 145))).toEqual([
      { casterId: 'home.drusus', targetId: 'away.brutus' },
    ])
  })

  it('ignores an attack that is not a net', () => {
    expect(updateNetTangles([], [slashHit(100)], encounterAt(100, 108))).toEqual([])
  })

  it('keeps the tangle while the stagger runs', () => {
    const existing: NetTangle[] = [{ casterId: 'home.drusus', targetId: 'away.brutus' }]
    expect(updateNetTangles(existing, [], encounterAt(140, 145))).toEqual(existing)
  })

  it('drops the tangle once the stagger has expired', () => {
    const existing: NetTangle[] = [{ casterId: 'home.drusus', targetId: 'away.brutus' }]
    expect(updateNetTangles(existing, [], encounterAt(145, 145))).toEqual([])
  })

  it('never records the same target twice', () => {
    const existing: NetTangle[] = [{ casterId: 'home.drusus', targetId: 'away.brutus' }]
    expect(updateNetTangles(existing, [netHit(120)], encounterAt(120, 165))).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/netTangle.test.ts`
Expected: FAIL — cannot resolve `./netTangle`.

- [ ] **Step 3: Write the resolver**

Create `src/presentation/netTangle.ts`:

```ts
// Who is currently tangled in a net, and who put him there.
//
// Pure, and a function of SIMULATION state rather than wall-clock time. That is
// deliberate: the 2026-09-20 playtest's Finding 2 is that effects driven off
// `presentationMs` get their life divided by the speed multiplier, so a 420 ms
// spray is three frames at x4. A tangle that lasts exactly as long as the
// target's `staggerUntilTick` cannot have that problem -- the stagger is the
// same number of ticks at every speed, which is the whole reason the net is
// worth anything in the first place.

import type { CombatantId, EncounterEvent, EncounterState } from '../simulation/encounter'

const NET_ACTION_ID = 'fast-net-cast'

export interface NetTangle { casterId: CombatantId; targetId: CombatantId }

/**
 * `previous` with expired tangles dropped and any net landed in `events` added.
 *
 * A tangle starts on `damage-dealt` or `attack-blocked` -- the two contact
 * outcomes that carry a `targetId` and mean the net reached him. It ends when
 * the target's own `staggerUntilTick` is reached, so the visual and the
 * mechanical effect are the same fact rather than two clocks that can disagree.
 */
export function updateNetTangles(
  previous: readonly NetTangle[],
  events: readonly EncounterEvent[],
  encounter: Readonly<EncounterState>,
): NetTangle[] {
  const next: NetTangle[] = []
  const seen = new Set<CombatantId>()

  const keep = (tangle: NetTangle): void => {
    if (seen.has(tangle.targetId)) return
    if (encounter.combatants[tangle.targetId]?.staggerUntilTick <= encounter.tick) return
    seen.add(tangle.targetId)
    next.push(tangle)
  }

  for (const event of events) {
    if (event.type !== 'damage-dealt' && event.type !== 'attack-blocked') continue
    if (event.actionId !== NET_ACTION_ID) continue
    keep({ casterId: event.actorId, targetId: event.targetId })
  }
  for (const tangle of previous) keep(tangle)

  return next
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/netTangle.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the view**

In `src/presentation/ArenaView.ts`:

1. When a rig is built from a loaded model, find and remember the net, and build a hidden clone parented to that rig's `hitCenter` anchor:

```ts
// The retiarius is the only archetype whose file carries a `slot: 'net'` mesh
// (bone-parented to his off hand by the build script). The clone is the same
// geometry draped on whoever he catches: built once at load, hidden, never
// allocated during play.
const heldNet = findMeshBySlot(root, 'net')
const tangleNet = heldNet ? (heldNet.clone() as THREE.Mesh) : undefined
if (tangleNet) {
  tangleNet.visible = false
  anchors.hitCenter.add(tangleNet)
}
```

2. Keep the tangle list on the view: `private netTangles: NetTangle[] = []`.

3. In the per-frame update (beside the existing `presentationMs` computation near `:1139`), after the event scan for this frame:

```ts
this.netTangles = updateNetTangles(this.netTangles, eventsThisFrame, current.encounter)
const tangledTargets = new Set(this.netTangles.map((tangle) => tangle.targetId))
const castersWithNetOut = new Set(this.netTangles.map((tangle) => tangle.casterId))
for (const [id, rig] of this.rigs) {
  if (rig.tangleNet) rig.tangleNet.visible = tangledTargets.has(id)
  // While his net is on someone else, his hand is empty.
  if (rig.heldNet) rig.heldNet.visible = !castersWithNetOut.has(id)
}
```

- [ ] **Step 6: Typecheck and run the fast suites**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Then: `node node_modules/vitest/vitest.mjs run --project fast`
Then: `node node_modules/@playwright/test/cli.js test --project fast`
Expected: PASS. If a safe-area e2e baseline shifts because the net is now sometimes on the other fighter, check `SAFE_AREA_EXEMPT_SLOTS` (`ArenaView.ts:306`) still exempts `'net'` — it does, and the clone carries the same `userData.slot`, which is the reason the clone is used rather than a fresh mesh.

- [ ] **Step 7: Look at it**

Run the app (`node node_modules/vite/bin/vite.js`), watch a retiarius-versus-murmillo bout at speed ×1, and confirm: the net leaves his hand on a cast, is visible on the murmillo while he is staggered, and returns.

- [ ] **Step 8: Commit**

```bash
git add src/presentation/netTangle.ts src/presentation/netTangle.test.ts src/presentation/ArenaView.ts
git commit -F - <<'EOF'
feat(arena): the net is visible on the man it caught

The retiarius' model already ships a `slot: 'net'` mesh in his off hand and
ArenaView already knew the slot, so the cast needs no new geometry: the net
leaves his hand, appears on the target for as long as the stagger runs, and
comes back.

Driven off `staggerUntilTick` rather than a presentation timer on purpose.
Finding 2 of the same playtest is that effect life is simulation time, so a
wall-clock effect is compressed to three frames at x4; a tangle tied to the
stagger is the same length at every speed, which is also the only honest
thing for it to be -- it is showing a mechanical state, not a flourish.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: The roster spread

**Conditional.** Run this task only if Task 4's gate was clean — identical cohort numbers. If it was not, stop and report; the spread would be tuning on top of an unexplained change.

**Files:**
- Modify: `src/content/mvpSeries.ts:115-128`
- Test: `src/content/mvpSeries.test.ts`

**Interfaces:**
- Consumes: `skill` on `FighterDefinition` from Task 4.
- Produces: nothing new; this is authored content.

- [ ] **Step 1: Write the failing test**

Add to `src/content/mvpSeries.test.ts`:

```ts
it('gives the two retiarii different competence, so they read as different men', () => {
  const aquila = homeRoster.find((f) => f.id === 'aquila')
  const drusus = opponents.find((f) => f.id === 'drusus')
  expect(aquila?.skill).toBeDefined()
  expect(drusus?.skill).toBeDefined()
  expect(Math.abs((aquila?.skill ?? 0) - (drusus?.skill ?? 0))).toBeGreaterThanOrEqual(0.3)
})

it('keeps every authored skill inside the valid range', () => {
  for (const fighter of [...homeRoster, ...opponents]) {
    if (fighter.skill === undefined) continue
    expect(fighter.skill).toBeGreaterThanOrEqual(0)
    expect(fighter.skill).toBeLessThanOrEqual(1)
  }
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/content/mvpSeries.test.ts`
Expected: FAIL — no roster row authors `skill`.

- [ ] **Step 3: Author the spread**

In `src/content/mvpSeries.ts`, add `skill` to the rows and a comment block above `homeRoster` explaining it:

```ts
// `skill` (2026-09-20). One number per man, 0.5 = the competence every other
// number in this file was tuned at, so any row left without it is unchanged.
//
// The spread is authored on the two RETIARII first because the mechanic it
// currently drives -- the boundary read -- is the one the 2026-09-20 playtest
// was about, and they are the pair it was measured on. Drusus is the veteran
// who works the wall and leaves it; Aquila is the one who gets caught there.
// The other rows stay neutral until a mechanic exists that would show the
// difference; authoring numbers that nothing reads is how a stat sheet becomes
// decoration.
export const homeRoster = [
  { id: 'brutus', ..., criticalChance: 0.10 },
  { id: 'aquila', ..., criticalChance: 0.157, skill: 0.25 },
  { id: 'nerva', ..., criticalChance: 0.1595 },
] as const satisfies readonly FighterDefinition[]

export const opponents = [
  { id: 'drusus', ..., criticalChance: 0.1585, skill: 0.80 },
  { id: 'cassius', ..., criticalChance: 0.12 },
  { id: 'magnus', ..., criticalChance: 0.099 },
] as const satisfies readonly FighterDefinition[]
```

(Keep every existing field value exactly as it is; only the `skill` key is added.)

- [ ] **Step 4: Run the fast suite**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: PASS.

- [ ] **Step 5: Measure what the spread costs**

Run:
```bash
node node_modules/vite-node/vite-node.mjs scripts/measure-boundary.ts -- --seeds=20 --json=docs/superpowers/plans/2026-09-20-boundary-after-spread.json
```
Expected and required: **Aquila and Drusus now differ** in both columns, in the direction their skills predict. If they do not, the mechanic is too weak to read and `BOUNDARY_GAIN` in `skill.ts` is the knob — not the roster numbers.

- [ ] **Step 6: Run the balance cohorts**

Run: `node node_modules/vitest/vitest.mjs run --project slow`
Expected: ~9–14 min. **Numbers will move here** — that is the point of this task, unlike Task 4. Every band must still pass.

If a pairing leaves the 15–85 % band, narrow the spread (0.25/0.80 → 0.35/0.70 → 0.40/0.65) and re-run, recording the table. If even a narrow spread cannot hold the band, that is a finding about the mechanic's strength, not a reason to widen the band — report it and leave the roster neutral.

- [ ] **Step 7: Record the clips for the playtest**

Run: `node node_modules/vite-node/vite-node.mjs scripts/record-review-clips.ts`

**Immediately afterwards**, restore the two tracked PNGs the script wipes:
```bash
git checkout -- docs/reviews/clips/playtest-both-committed.png docs/reviews/clips/playtest-lunge-at-reach.png
```

Clips the playtest needs: a retiarius-versus-murmillo bout at the wall, a net cast at ×1, and Aquila versus Drusus so the skill difference is watchable.

- [ ] **Step 8: Commit**

```bash
git add src/content/mvpSeries.ts src/content/mvpSeries.test.ts docs/superpowers/plans/2026-09-20-boundary-after-spread.json
git commit -F - <<'EOF'
feat(roster): the two retiarii are not the same man

Drusus 0.80, Aquila 0.25, everyone else neutral. The spread goes on the pair
the boundary read was measured on, because that is the only mechanic skill
currently drives -- authoring numbers that nothing reads is how a stat sheet
becomes decoration.

At the wall: Aquila <x>%, Drusus <y>%, against <z>% for both before.
Cohort bands after the spread: <table>.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
EOF
```

---

## After the plan

Open one PR per logical group (the instrument + log; the net + its presentation; the footwork + skill + spread), or one for the slice — follow whatever the last four slices did. Then write the playtest checklist under `docs/reviews/` in the 2026-09-20 report's style, with the before/after tables from the four JSON files this plan produces, and the open questions the sweeps could not settle.
