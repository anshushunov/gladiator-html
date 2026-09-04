# Shield Shove Implementation Plan

> **Outcome, 2026-09-04. THIS PLAN WAS EXECUTED AND ITS MECHANICS WERE PARKED.**
> All thirteen tasks were built on `feature/shield-shove`. Four candidate builds
> were measured on the full slow suite and all four failed, where `main` passes.
> The design owner ruled the shove and the pursuit-relative forced-disengage
> exit parked on that branch, and the slice's instruments merged to `main` on
> `chore/shove-instruments`.
>
> What merged: Tasks 2–4 (ground attribution and the `measure-distance.ts`
> counters), Task 9 (gate W), Task 10's refactor commit (`fastForcedDisengageExit`
> over an explicit rule, shipped default unmoved), the batch-seed rewrite of the
> retarget corroboration, the `ContactRecord` ledger fix, the `ContactOutcome`
> doc, and the camera yaw re-expression. What did not: Tasks 5–8 (the shove
> itself), Task 11's constants and its determinism re-baseline, the sweep script,
> and the camera trace re-recording. Every frozen digest on `main` is unmoved.
>
> Read the task list below as a record of work done, not as work outstanding.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the murmillo a close-range shield shove — an authored, no-damage attack action that opens ground instantly and is paid for with a long recovery — and fit its push distance to the retiarius' forced-disengage exit rule in one two-dimensional sweep.

**Architecture:** The shove is **not** a new kind of thing. It is one entry in the existing attack catalogue (`src/content/combatStyles.ts`), one id in the `AttackActionId` union, and one id in the heavy style's `attackActionIds`/`baseWeights`. No new module, no new `CombatDecision` variant, no new per-fighter state. Exactly one behaviour change to existing simulation code: the contact path skips damage for an action tagged `no-damage`. Everything else — availability, scoring, miss, contact ordering, RNG, stagger, push — is the already-frozen action lifecycle.

**Tech Stack:** TypeScript, Vitest (`fast`/`slow` projects), Playwright (`fast`/`slow` projects), Three.js in `src/presentation/` only, `vite-node` for measurement scripts.

**Spec:** `docs/superpowers/specs/2026-08-29-shield-shove-design.md`. Read §2.2 before Task 4 — it freezes every authored constant.

## Global Constraints

- `src/simulation/` is deterministic TypeScript and must not import DOM or Three.js code (`AGENTS.md`).
- `src/presentation/` renders simulation state; game rules must not move into it (`AGENTS.md`).
- `src/content/combatStyles.ts` is **plain data only** — no functions, ever. The sweep harnesses `structuredClone(COMBAT_STYLES)` (`src/testSupport/reachHarness.test.ts:38`), which a function in the catalogue would break.
- Every authored constant in spec §2.2 is frozen before code. **Only `pushDistance` is swept.** Wanting to move any other value is a recorded design finding brought to the design owner, not a quiet extra axis.
- Determinism baselines are re-recorded **exactly once**, in Task 11, after the swept constant is chosen — never earlier, never twice.
- `npx` is broken on this machine. Call binaries through `node` directly:
  - fast unit tests: `node node_modules/vitest/vitest.mjs run --project fast`
  - one file: `node node_modules/vitest/vitest.mjs run --project fast <path>`
  - slow unit tests: `node node_modules/vitest/vitest.mjs run --project slow`
  - e2e: `node node_modules/@playwright/test/cli.js test --project fast`
  - scripts: `node node_modules/vite-node/vite-node.mjs scripts/<name>.ts`
  - The `slow` unit project takes 9–14 minutes. Budget for it; do not assume it hung.
- Commit messages: Conventional Commits, no LLM attribution (`Co-Authored-By`, emoji) anywhere.
- One hypothesis per PR; attach the Playwright screenshot for UI changes (`AGENTS.md`).

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `scripts/sweep-shove.ts` | The 30-cell sweep: push × gain grid plus the control row, writing one JSON result per cell |
| `src/testSupport/shoveGates.ts` | Gate W's four pure predicates over a run summary — coverage floors, frequency ceiling, punishability, population sizes |
| `src/testSupport/shoveGates.test.ts` | Unit tests for the above |
| `docs/superpowers/plans/2026-08-29-shove-before.json` | The "before" numbers, committed in Task 3 |
| `docs/superpowers/plans/2026-08-29-shove-sweep.json` | The sweep's 30 cells, committed in Task 10 |

**Modified:**

| File | Change |
|---|---|
| `scripts/check-allowlist.sh` | Re-scoped for this slice, committed before the work it judges |
| `src/simulation/disengageDiagnostics.ts` | Samples carry the external (push) component of separation change; episodes carry its sum |
| `src/simulation/encounter.ts` | Writes that component into the sample; skips damage for `no-damage` actions |
| `src/simulation/combatActions.ts` | `AttackActionId` gains `'heavy-shield-shove'`; `ATTACK_ACTION_ID_SET` gains its key |
| `src/content/combatStyles.ts` | The authored shove entry, plus the heavy style's `attackActionIds` and `baseWeights` |
| `src/testSupport/disengageGates.ts` | `voluntaryGroundOpened`, and `isSuccess` reading it |
| `scripts/measure-distance.ts` | Reports ground attribution and the shove counters |
| `src/presentation/poses/combatPoses.ts` | `ATTACK_POSES['heavy-shield-shove']` |
| `src/presentation/CombatAudio.ts` | The shove's commitment tier and cue |
| `src/presentation/battleFeed.ts` | The shove's feed wording |
| `src/simulation/combatDecision.ts` | The chosen `FAST_FORCED_DISENGAGE_MIN_GAIN` and exit predicate (Task 11 only) |

---

### Task 1: Re-scope the allowlist boundary

The project's convention: the boundary is rebuilt from scratch each slice and committed **before** the work it judges, so a reviewer can see what the slice promised not to touch. Read the current file first — its shape follows the claim, and yours is a different claim.

**Files:**
- Modify: `scripts/check-allowlist.sh`

**Interfaces:**
- Consumes: nothing
- Produces: `npm run check:allowlist` passes on an empty diff against `main`

- [ ] **Step 1: Read the current boundary**

Read `scripts/check-allowlist.sh` end to end. Note the header format: the claim, the measurement that prompted it, the exemption list, the load-bearing entry.

- [ ] **Step 2: Rewrite the header and the lists for this slice**

The claim: *this slice adds one authored attack action and the one branch that lets it deal no damage; it changes no balance band, no seed count, and no test's assertion except where a new action id makes an exhaustive record incomplete.*

Exemptions, and no others:

- `src/content/combatStyles.ts` — the authored entry itself.
- `src/simulation/combatActions.ts` — the `AttackActionId` union and its key set.
- `src/simulation/encounter.ts` — the `no-damage` branch and the attribution write.
- `src/simulation/disengageDiagnostics.ts`, `src/testSupport/disengageGates.ts`, `scripts/measure-distance.ts` — the instrument.
- `src/presentation/poses/combatPoses.ts`, `src/presentation/CombatAudio.ts`, `src/presentation/battleFeed.ts` — the three exhaustive records a new action id makes incomplete, plus the feed wording.
- `src/testSupport/shoveGates.ts`, `scripts/sweep-shove.ts` — new files.
- `src/simulation/combatDecision.ts` — **only** the forced-disengage constants and predicate.
- this file.

The load-bearing entry: **no balance band and no seed count may change.** `balance.test.ts`, `seasonBalance.test.ts`, `dispositionBalance.test.ts` and `encounterCapacity.test.ts` are closed to edits of their thresholds. Gate T is expected to be the gate that stops this slice; widening a band instead of reporting the distribution is the specific shortcut this list forbids.

- [ ] **Step 3: Verify the boundary passes on the current tree**

Run: `npm run check:allowlist`
Expected: exit 0, no violations (nothing has changed yet).

- [ ] **Step 4: Commit**

```bash
git add scripts/check-allowlist.sh
git commit -m "chore(shove): re-scope the boundary, before the work it judges"
```

---

### Task 2: Attribute separation change to its source, in the seam

Gate P/Q's addendum (spec §3, §4) needs to know how much of an episode's ground was opened by the retiarius' own retreat and how much by something pushing him. Today `DisengageEpisode` has only two endpoints and cannot tell the difference.

The kernel already computes every push as a vector (`resolveOneIntent` returns `pushVector`, `encounter.ts:2080`). The seam gains one number per sample: the component of that tick's external push along the actor→target axis.

**Files:**
- Modify: `src/simulation/disengageDiagnostics.ts`
- Test: `src/simulation/disengageDiagnostics.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `DisengageSample` gains `externalSeparationDelta: number` on the `held` and `cleared` variants (the `stamped` variant is the episode's origin and carries none)
  - `DisengageEpisode` gains `externalGround: number` — the sum of those deltas across the episode
  - `assembleDisengageEpisodes` populates it

- [ ] **Step 1: Write the failing test**

Add to `src/simulation/disengageDiagnostics.test.ts`:

```ts
it('sums the external component of every tick into the episode', () => {
  const assembly = assembleDisengageEpisodes([
    { kind: 'stamped', tick: 10, actorId: 'a', targetId: 'b', separation: 1.0 },
    { kind: 'held', tick: 11, actorId: 'a', targetId: 'b', separation: 1.4, externalSeparationDelta: 0.3 },
    { kind: 'held', tick: 12, actorId: 'a', targetId: 'b', separation: 1.7, externalSeparationDelta: 0 },
    { kind: 'cleared', tick: 13, actorId: 'a', targetId: 'b', separation: 2.1, externalSeparationDelta: 0.2, reason: 'progress' },
  ])

  expect(assembly.episodes).toHaveLength(1)
  expect(assembly.episodes[0].externalGround).toBeCloseTo(0.5, 10)
})

it('reports zero external ground when nothing pushed anyone', () => {
  const assembly = assembleDisengageEpisodes([
    { kind: 'stamped', tick: 10, actorId: 'a', targetId: 'b', separation: 1.0 },
    { kind: 'cleared', tick: 11, actorId: 'a', targetId: 'b', separation: 2.0, externalSeparationDelta: 0, reason: 'progress' },
  ])

  expect(assembly.episodes[0].externalGround).toBe(0)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/disengageDiagnostics.test.ts`
Expected: FAIL — TypeScript rejects `externalSeparationDelta` as an unknown property, and `externalGround` does not exist on `DisengageEpisode`.

- [ ] **Step 3: Add the field to the sample and the episode**

In `src/simulation/disengageDiagnostics.ts`:

```ts
export type DisengageSample =
  | { kind: 'stamped'; tick: number; actorId: CombatantId; targetId: CombatantId | undefined; separation: number }
  | { kind: 'held'; tick: number; actorId: CombatantId; targetId: CombatantId | undefined; separation: number; externalSeparationDelta: number }
  | { kind: 'cleared'; tick: number; actorId: CombatantId; targetId: CombatantId | undefined; separation: number; externalSeparationDelta: number; reason: DisengagePredicateExit }
```

On `DisengageEpisode`, beside `endSeparation`:

```ts
  /**
   * The part of `endSeparation - startSeparation` contributed by external
   * displacement -- any push applied to either fighter during the episode,
   * projected onto the actor->target axis. The remainder is the actor's own
   * locomotion. An approximation in exactly one direction: the arena clamp and
   * collision resolution can shorten a push after it is recorded, so this
   * OVERSTATES the external share rather than flattering the fighter.
   */
  externalGround: number
```

- [ ] **Step 4: Sum it in the assembler**

Inside `assembleDisengageEpisodes`, accumulate across the samples of one episode and write the sum into the emitted episode:

```ts
externalGround: samplesOfEpisode.reduce((sum, s) => (s.kind === 'stamped' ? sum : sum + s.externalSeparationDelta), 0),
```

- [ ] **Step 5: Run the file's tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/disengageDiagnostics.test.ts`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 6: Fix every caller the type change breaks**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: errors listing every place a `held`/`cleared` sample is constructed. Add `externalSeparationDelta: 0` at each — Task 3 makes `encounter.ts` write the real value; the harnesses' literals stay zero.

- [ ] **Step 7: Run the fast suite and commit**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: 838 passed, as on `main` at `aec7a0a`.

```bash
git add src/simulation/disengageDiagnostics.ts src/simulation/disengageDiagnostics.test.ts src/testSupport src/simulation
git commit -m "feat(measure): carry the external component of an episode's ground"
```

---

### Task 3: Write the real external component from the kernel, and split the success rule

**Files:**
- Modify: `src/simulation/encounter.ts`
- Modify: `src/testSupport/disengageGates.ts`
- Test: `src/simulation/disengageDiagnostics.test.ts`, `src/testSupport/disengageGates.test.ts`

**Interfaces:**
- Consumes: `DisengageSample.externalSeparationDelta`, `DisengageEpisode.externalGround` (Task 2)
- Produces:
  - `voluntaryGroundOpened(episode): number` in `src/testSupport/disengageGates.ts`
  - `isSuccess` reading it instead of `groundOpened`

- [ ] **Step 1: Write the failing gate test**

Add to `src/testSupport/disengageGates.test.ts`:

```ts
it('does not count an escape the pursuer created', () => {
  const episode = {
    actorId: 'a', targetId: 'b', startTick: 0, endTick: 20, ticks: 20,
    startSeparation: 1.2, endSeparation: 2.2, externalGround: 0.9,
    reason: 'progress' as const,
  }

  expect(groundOpened(episode)).toBeCloseTo(1.0, 10)      // the raw endpoints still say 1.0
  expect(voluntaryGroundOpened(episode)).toBeCloseTo(0.1, 10)
  expect(isSuccess(episode)).toBe(false)                   // 0.1 < DISENGAGE_SUCCESS_GROUND
})

it('still counts an escape the fighter made himself', () => {
  const episode = {
    actorId: 'a', targetId: 'b', startTick: 0, endTick: 20, ticks: 20,
    startSeparation: 1.2, endSeparation: 2.2, externalGround: 0,
    reason: 'progress' as const,
  }

  expect(voluntaryGroundOpened(episode)).toBeCloseTo(1.0, 10)
  expect(isSuccess(episode)).toBe(true)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/testSupport/disengageGates.test.ts`
Expected: FAIL — `voluntaryGroundOpened` is not exported.

- [ ] **Step 3: Implement it**

In `src/testSupport/disengageGates.ts`, beside `groundOpened`:

```ts
/**
 * Ground the fighter opened by his own locomotion: the endpoints' difference
 * less the external displacement recorded alongside them. This -- not
 * `groundOpened` -- is what P and Q count, because a murmillo shove moves the
 * retiarius and would otherwise register as an escape he did not make.
 */
export function voluntaryGroundOpened(episode: Readonly<DisengageEpisode>): number {
  return groundOpened(episode) - episode.externalGround
}
```

and change `isSuccess`:

```ts
export function isSuccess(episode: Readonly<DisengageEpisode>): boolean {
  return voluntaryGroundOpened(episode) >= DISENGAGE_SUCCESS_GROUND && SUCCESS_EXIT_REASONS.has(episode.reason)
}
```

Leave `groundOpened` exported and unchanged: `corroborate` checks a self-reported reason against the raw endpoints, which is a different question and must stay raw.

- [ ] **Step 4: Run it and watch it pass**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/testSupport/disengageGates.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the real value from the kernel**

In `src/simulation/encounter.ts`, the contact-resolution phase already produces `pushByTarget` (`ContactResolutionResult`). Where the disengage `held`/`cleared` samples are recorded, project the tick's push for the actor and for its target onto the actor→target unit axis and record the difference:

```ts
// Positive when this tick's external pushes moved the pair apart. The actor's
// own push moves him along the axis; a push on his target moves the other end.
const axis = unitVectorFrom(actorPosition, targetPosition)
const externalSeparationDelta =
  dot(pushByTarget[targetId] ?? ZERO_VEC, axis) - dot(pushByTarget[actorId] ?? ZERO_VEC, axis)
```

Use the module's existing vector helpers; do not add a second implementation of `dot` or of unit-vector construction.

- [ ] **Step 6: Assert the kernel writes it, end to end**

Add to `src/simulation/disengageDiagnostics.test.ts` a test that runs a short encounter in which a contact with a non-zero `pushDistance` lands during a forced disengage, and asserts the resulting episode has `externalGround > 0`. Use the existing encounter test helpers in that file rather than building a new fixture.

- [ ] **Step 7: Run the fast suite**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: 838 + the new tests, all green. **If any pre-existing test moved, stop** — no shove exists yet, so nothing about the fight should have changed. A moved test here means the attribution write is not inert.

- [ ] **Step 8: Commit**

```bash
git add src/simulation/encounter.ts src/testSupport/disengageGates.ts src/testSupport/disengageGates.test.ts src/simulation/disengageDiagnostics.test.ts
git commit -m "feat(measure): attribute an episode's ground to locomotion or to a push"
```

---

### Task 4: Report attribution and shove counters from the instrument, and record the "before"

**Files:**
- Modify: `scripts/measure-distance.ts`
- Create: `docs/superpowers/plans/2026-08-29-shove-before.json`

**Interfaces:**
- Consumes: `voluntaryGroundOpened`, `DisengageEpisode.externalGround`
- Produces: the script's JSON gains, per ordered matchup: `voluntaryGroundShare`, `shoveStarts`, `shoveContacts`, `shoveMisses`, `recoveryWindowContactsPerShove`, `recoveryWindowContactsPerJab`

- [ ] **Step 1: Read the script's existing report shape**

Read `scripts/measure-distance.ts` — particularly how it accumulates per ordered matchup and what it prints. Follow that shape exactly; do not introduce a second reporting convention.

- [ ] **Step 2: Add the attribution fields**

Per ordered matchup, over the episodes already collected:

```ts
voluntaryGroundShare: totalVoluntaryGround / totalGround,   // NaN-guarded: report null when totalGround is 0
```

- [ ] **Step 3: Add the shove counters**

Count from the event stream, per ordered matchup:

- `shoveStarts` — `action-started` events with `actionId === 'heavy-shield-shove'`
- `shoveContacts` — `damage-dealt`/`attack-blocked` for that id (a resolved contact)
- `shoveMisses` — `attack-missed`/`attack-evaded`/`attack-parried` for that id
- `recoveryWindowContactsPerShove` — contacts taken **by the shover** with a tick inside `[contactTick, contactTick + recoveryTicks]` of a resolved shove, divided by `shoveContacts`
- `recoveryWindowContactsPerJab` — the same for `heavy-shield-jab`, which is gate W.3's comparator

The action id does not exist yet, so all five are zero today. That is the point of Step 5.

- [ ] **Step 4: Run the instrument at 200 seeds**

Run: `node node_modules/vite-node/vite-node.mjs scripts/measure-distance.ts --seeds 200 --json docs/superpowers/plans/2026-08-29-shove-before.json`

(Match the script's actual flag names, read in Step 1.)

- [ ] **Step 5: Verify the "before" says what it must**

Open the JSON and confirm, for every ordered matchup:

- all five shove counters are exactly `0` — there is no shove yet;
- `voluntaryGroundShare` is `1` (or `null` where no episodes exist) — with no shove and pushes only from ordinary attacks, external ground should be small; **if it is materially below 1, stop and report it.** That would mean ordinary attack pushes already contribute a large share of what P and Q count, which is a finding about the inherited gates, not about this slice.

- [ ] **Step 6: Commit the instrument and the baseline together**

```bash
git add scripts/measure-distance.ts docs/superpowers/plans/2026-08-29-shove-before.json
git commit -m "feat(measure): report ground attribution and shove counters, and record the before"
```

---

### Task 5: The action id, and the compile errors that enumerate the work

Adding a member to `AttackActionId` makes three exhaustive `Record<AttackActionId, …>` incomplete. That is deliberate: the type system, not this plan, is the checklist of places the shove must appear.

**Files:**
- Modify: `src/simulation/combatActions.ts:24` (the union), `:558` (`ATTACK_ACTION_ID_SET`)

**Interfaces:**
- Consumes: nothing
- Produces: `AttackActionId` includes `'heavy-shield-shove'`

- [ ] **Step 1: Add the id to the union and the key set**

In `src/simulation/combatActions.ts`, add `| 'heavy-shield-shove'` to `AttackActionId` and `'heavy-shield-shove': true,` to `ATTACK_ACTION_ID_SET`.

- [ ] **Step 2: Run the compiler and record the list**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: FAIL, naming at least `src/content/combatStyles.ts` (`attacks` is missing a key), `src/presentation/poses/combatPoses.ts:362` (`ATTACK_POSES`), and `src/presentation/CombatAudio.ts:162` (`ATTACK_ACTION_COMMITMENT`).

Write that list down — Tasks 6, 7 and 8 close it. Do not commit a red tree; this step ends inside Task 6.

---

### Task 6: The authored shove

Every value here comes from spec §2.2 and is frozen. Do not adjust one because a test is inconvenient.

**Files:**
- Modify: `src/content/combatStyles.ts`
- Test: `src/content/combatStyles.test.ts`

**Interfaces:**
- Consumes: `AttackActionId` (Task 5)
- Produces: `COMBAT_STYLES.attacks['heavy-shield-shove']`; the heavy style lists it in `attackActionIds` and weights it at `10`

- [ ] **Step 1: Write the failing test**

Add to `src/content/combatStyles.test.ts`, matching the file's existing value-by-value pinning style:

```ts
it('pins the shield shove', () => {
  expect(COMBAT_STYLES.attacks['heavy-shield-shove']).toEqual({
    id: 'heavy-shield-shove',
    tags: ['attack', 'shove', 'shield', 'unparryable', 'no-damage'],
    contactRange: { min: 0.9, max: 1.6 },
    minimumFacingDot: 0.5736,
    windupTicks: 20,
    impactTicks: 4,
    recoveryTicks: 46,
    damageMultiplier: 0,
    accuracyModifier: 0,
    rootTravel: 0.20,
    pushDistance: 0.90,
    staggerTicks: 16,
    contactPriority: 20,
  })
})

it('gives the murmillo the shove, weighted below his jab and above his cleave', () => {
  expect(COMBAT_STYLES.styles.heavy.attackActionIds).toEqual(['heavy-shield-jab', 'heavy-cleave', 'heavy-shield-shove'])
  expect(COMBAT_STYLES.styles.heavy.baseWeights['heavy-shield-shove']).toBe(10)
})
```

`pushDistance: 0.90` is the **provisional** value — the centre of the sweep grid. Task 11 replaces it with the swept choice and updates this test with it.

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/content/combatStyles.test.ts`
Expected: FAIL — the key does not exist.

- [ ] **Step 3: Author the entry**

In `src/content/combatStyles.ts`, add the definition above to the `attacks` record, and add `'heavy-shield-shove'` to `styles.heavy.attackActionIds` and `baseWeights`. Write a comment beside `pushDistance` saying it is the sweep's axis and that its value is provisional until the sweep chooses.

The tags carry no `committed` and no `probe` — spec §2.4. That is a decision, not an omission; say so in the comment.

- [ ] **Step 4: Run the catalogue's validation and its tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/content/combatStyles.test.ts src/simulation/combatActions.test.ts`
Expected: PASS. `validateAttackActionDefinition` accepts `damageMultiplier: 0` (`requireFiniteNonNegative`) and imposes no parry-lead floor, since the action is not `parryable`.

- [ ] **Step 5: Do not commit yet**

The tree is still red — `ATTACK_POSES` and `ATTACK_ACTION_COMMITMENT` are incomplete. Tasks 7 and 8 close them; commit at the end of Task 9.

---

### Task 7: No damage, and the branch that makes it true

`calculateContactDamage` floors at `Math.max(1, …)` (`src/simulation/combatActions.ts:334`), so `damageMultiplier: 0` still deals 1. The floor is right for attacks and stays; the shove skips damage instead.

**Files:**
- Modify: `src/simulation/encounter.ts` (`resolveOneIntent`, around `:2015-2065`)
- Test: `src/simulation/encounter.test.ts`

**Interfaces:**
- Consumes: the `no-damage` tag (Task 6)
- Produces: a resolved `no-damage` contact emits no `damage-dealt` event, leaves HP untouched, and still applies stagger and push

- [ ] **Step 1: Write the failing test**

Add to `src/simulation/encounter.test.ts`:

```ts
it('a no-damage contact moves and staggers the target without costing it a point of HP', () => {
  // Build a two-fighter encounter, run a heavy-shield-shove to contact.
  // Use the file's existing encounter fixture helpers.
  const before = state.combatants['away.cassius'].hp

  expect(events.filter(e => e.type === 'damage-dealt')).toHaveLength(0)
  expect(after.combatants['away.cassius'].hp).toBe(before)
  expect(after.combatants['away.cassius'].staggerUntilTick).toBeGreaterThan(contactTick)
  expect(separationAfter).toBeGreaterThan(separationBefore)
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/encounter.test.ts`
Expected: FAIL — one `damage-dealt` event with `amount: 1`, and HP down by 1.

- [ ] **Step 3: Add the branch**

In `resolveOneIntent`, after `blocked` is resolved and before damage is computed:

```ts
// A `no-damage` action (the shield shove) resolves as a contact in every
// other respect -- it can be blocked, it staggers, it pushes -- but it never
// reaches `calculateContactDamage`, whose `Math.max(1, ...)` floor is correct
// for attacks and would turn "no damage" into chip damage.
const dealsDamage = !actionDef.tags.includes('no-damage')
```

Guard the HP write, the `damage-dealt` event, the critical roll and the defeat check with `dealsDamage`. Leave the stagger and push code below untouched — it must run either way.

- [ ] **Step 4: Run it and watch it pass**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/simulation/encounter.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm nothing else moved yet**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: everything green **except** any test that enumerates attack ids or renders the heavy style — those belong to Tasks 8 and 9. Determinism hashes **will** move, because the murmillo now has a third action to choose from. Do not re-baseline them here; Task 11 does that once.

---

### Task 8: The shove must be seen — pose, telegraph, audio, feed

Gate X is an acceptance condition, not decoration. The windup is the whole content of a shove: a shield-led step the viewer can react to.

**Files:**
- Modify: `src/presentation/poses/combatPoses.ts:362`
- Modify: `src/presentation/CombatAudio.ts:162`
- Modify: `src/presentation/battleFeed.ts`
- Test: `src/presentation/poses/combatPoses.test.ts`, `src/presentation/CombatAudio.test.ts`, `src/presentation/battleFeed.test.ts`

**Interfaces:**
- Consumes: `'heavy-shield-shove'`
- Produces: `ATTACK_POSES['heavy-shield-shove']`; `ATTACK_ACTION_COMMITMENT['heavy-shield-shove'] = 'heavy'`; a feed line distinct from every attack's

- [ ] **Step 1: Write the failing pose test**

Add to `src/presentation/poses/combatPoses.test.ts`, following how the file tests `heavy-cleave`'s set: assert the shove's windup pose differs visibly from the jab's — the shield arm leads and the torso turns into it — and that the set is built from `HEAVY_GUARD` like the murmillo's other two.

- [ ] **Step 2: Run it and watch it fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation/poses/combatPoses.test.ts`
Expected: FAIL — `ATTACK_POSES` has no such key (this is also the compile error from Task 5).

- [ ] **Step 3: Author the pose set**

Add `'heavy-shield-shove': buildAttackPoseSet(HEAVY_GUARD, { … })` beside the jab's and cleave's. A 20-tick windup is longer than the jab's 14; the pose must use that time — the shield comes up and forward, the weapon drops out of line.

- [ ] **Step 4: Add the audio cue**

`ATTACK_ACTION_COMMITMENT` classifies each action `'light' | 'heavy'`. The shove is `'heavy'`: a 20-tick windup with a large displacement is exactly what an audible windup exists for. Add a test in `CombatAudio.test.ts` asserting the shove's `action-started` produces the heavy cue, mirroring the existing `heavy-cleave` test.

- [ ] **Step 5: Add the feed wording**

`battleFeed.ts` renders events into lines. A shove produces `action-started` and then a resolved contact with **no** `damage-dealt` — so the feed must not fall through to "no damage" or drop the line entirely. Add a test asserting the shove's resolved contact renders a line naming the shove and its effect, and implement the wording.

- [ ] **Step 6: Run the three files' tests**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/presentation`
Expected: PASS.

- [ ] **Step 7: Confirm the tree compiles**

Run: `node node_modules/typescript/bin/tsc --noEmit`
Expected: clean. Every record the new id broke is now complete.

- [ ] **Step 8: Commit Tasks 5–8 together**

They are one deliverable — an action that exists, resolves and can be seen. Splitting the commit leaves a red tree in history.

```bash
git add src/simulation/combatActions.ts src/content/combatStyles.ts src/simulation/encounter.ts src/presentation
git commit -m "feat(shove): the murmillo's shield shove, authored and visible"
```

---

### Task 9: Gate W as code

Four predicates, pure, over a run summary. Written now so the sweep is judged by something that existed before its results did.

**Files:**
- Create: `src/testSupport/shoveGates.ts`, `src/testSupport/shoveGates.test.ts`

**Interfaces:**
- Consumes: the counters `measure-distance.ts` reports (Task 4)
- Produces:

```ts
export interface ShoveRunSummary {
  shoveStarts: number
  shoveContacts: number
  boutsWithAShove: number
  bouts: number
  murmilloAttackDecisions: number
  shoveDecisions: number
  recoveryWindowContactsPerShove: number
  recoveryWindowContactsPerJab: number
  jabContacts: number
}
export type ShoveGateVerdict = { pass: true } | { pass: false; failures: readonly string[] }
export function checkShoveGateW(summary: Readonly<ShoveRunSummary>): ShoveGateVerdict
```

- [ ] **Step 1: Write the failing tests**

```ts
const green: ShoveRunSummary = {
  shoveStarts: 400, shoveContacts: 220, boutsWithAShove: 90, bouts: 200,
  murmilloAttackDecisions: 3000, shoveDecisions: 400,
  recoveryWindowContactsPerShove: 0.31, recoveryWindowContactsPerJab: 0.22, jabContacts: 900,
}

it('passes a run where the shove is used, is not the moveset, and is punished', () => {
  expect(checkShoveGateW(green)).toEqual({ pass: true })
})

it('FAILS a run with no shoves at all, rather than passing the ceiling vacuously', () => {
  const verdict = checkShoveGateW({ ...green, shoveStarts: 0, shoveContacts: 0, boutsWithAShove: 0, shoveDecisions: 0 })
  expect(verdict.pass).toBe(false)
  expect(verdict.failures.join(' ')).toMatch(/coverage/i)
})

it('fails a run where the shove is more than a fifth of the murmillo\'s attacks', () => {
  const verdict = checkShoveGateW({ ...green, shoveDecisions: 700 })   // 700/3000 = 23.3%
  expect(verdict.pass).toBe(false)
  expect(verdict.failures.join(' ')).toMatch(/frequency/i)
})

it('fails a run where the long recovery costs the murmillo nothing', () => {
  const verdict = checkShoveGateW({ ...green, recoveryWindowContactsPerShove: 0.10 })
  expect(verdict.pass).toBe(false)
  expect(verdict.failures.join(' ')).toMatch(/punish/i)
})

it('fails when a compared population is empty, instead of dividing by zero', () => {
  const verdict = checkShoveGateW({ ...green, jabContacts: 0 })
  expect(verdict.pass).toBe(false)
  expect(verdict.failures.join(' ')).toMatch(/population/i)
})
```

- [ ] **Step 2: Run them and watch them fail**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/testSupport/shoveGates.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the four checks**

Thresholds are spec §4's, named as constants with the spec section beside each:

```ts
export const W_MIN_SHOVE_STARTS = 150
export const W_MIN_SHOVE_CONTACTS = 80
export const W_MIN_BOUT_SHARE = 0.25
export const W_MAX_DECISION_SHARE = 0.20
```

Each failure pushes a string containing the word the test matches (`coverage`, `frequency`, `punishability`, `population`) **and the measured numbers** — a verdict that says only "failed" is one the next reader cannot act on.

- [ ] **Step 4: Run them and watch them pass**

Run: `node node_modules/vitest/vitest.mjs run --project fast src/testSupport/shoveGates.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/testSupport/shoveGates.ts src/testSupport/shoveGates.test.ts
git commit -m "test(shove): gate W, with the coverage floors a ceiling alone would not give"
```

---

### Task 10: The sweep

Two axes inside the gain rule, plus a control row on the shipped rule. 30 cells at 200 seeds, in the `slow` project.

**Files:**
- Create: `scripts/sweep-shove.ts`
- Create: `docs/superpowers/plans/2026-08-29-shove-sweep.json`

**Interfaces:**
- Consumes: `structuredClone(COMBAT_STYLES)` overlays (see `src/testSupport/reachHarness.test.ts:38` for the established pattern), `checkShoveGateW`, `measure-distance`'s per-matchup summariser
- Produces: one JSON array of 30 cells, each `{ rule, push, gain, maxTicks, perMatchup, gateW, gatesPQ, winRates }`

- [ ] **Step 1: Read the existing sweep pattern**

Read how `scripts/measure-reach.ts` and `src/testSupport/reachHarness.ts` apply a catalogue overlay and run a cohort. Reuse that machinery; do not write a second cohort runner.

- [ ] **Step 2: Define the grid, verbatim from spec §5**

```ts
const PUSH_GRID = [0.5, 0.7, 0.9, 1.1, 1.3] as const
const GAIN_GRID = [0.55, 0.70, 0.85, 1.00, 1.15] as const
// The gain rule is swept at the parked branch's cap of 40; the control row runs
// the shipped absolute rule at its own 37. Both are printed in every cell --
// the first draft of the spec did not mention the cap moved at all.
const GAIN_RULE_MAX_TICKS = 40
const SHIPPED_RULE_MAX_TICKS = 37
```

- [ ] **Step 3: Make the exit rule selectable without editing the kernel per cell**

The gain-based predicate lives on `experiment/murmillo-pursuit-exit` (`combatDecision.ts:1071`, `FAST_FORCED_DISENGAGE_MIN_GAIN = 0.85`). Bring `hasFastForcedDisengageEnded` over in a form that takes its thresholds as parameters, so both rules are reachable from the sweep without a rebuild per cell. Keep the shipped default byte-identical for every existing caller — no test outside the sweep may change behaviour in this step.

- [ ] **Step 4: Run one cell and check the plumbing before spending an hour**

Run: `node node_modules/vite-node/vite-node.mjs scripts/sweep-shove.ts --only push=0.9,gain=0.85 --seeds 20`
Expected: one cell, all nine ordered matchups present, gate W's numbers non-zero. **Twenty seeds proves nothing about the fight** — this step is plumbing only.

- [ ] **Step 5: Run the full sweep**

Run: `node node_modules/vite-node/vite-node.mjs scripts/sweep-shove.ts --seeds 200 --json docs/superpowers/plans/2026-08-29-shove-sweep.json`

Expect this to take a long time. Run it in the background and poll it.

- [ ] **Step 6: Print the population, do not trust the green**

For each cell print: P, Q, Q2, R, V, T (all nine matchups) and W, plus `voluntaryGroundShare`. Three findings reversed in the previous slice and two were caught by printing the distribution rather than reading a pass/fail.

Specifically check that the gain axis actually changes the outcome across its five values. A previous sweep in this project *did not run at all* and reported eight identical results across a two-fold threshold change. Identical cells across a swept axis mean the sweep is broken, not that the axis does not matter.

- [ ] **Step 7: Commit the sweep and its results**

```bash
git add scripts/sweep-shove.ts docs/superpowers/plans/2026-08-29-shove-sweep.json
git commit -m "feat(sweep): fit the shove's push and the disengage threshold in one grid"
```

---

### Task 11: Choose the constants, re-baseline determinism once, run every gate

**Files:**
- Modify: `src/content/combatStyles.ts` (the chosen `pushDistance`), `src/content/combatStyles.test.ts`
- Modify: `src/simulation/combatDecision.ts` (the chosen exit rule and threshold)
- Modify: the frozen-hash fixtures the suite pins

**Interfaces:**
- Consumes: the sweep JSON
- Produces: one build, one set of baselines, one verdict against all eight inherited gates plus W

- [ ] **Step 1: Pick the finalist, in writing, before touching code**

From the sweep JSON choose the cell that passes P, Q, Q2, R, V, W and keeps T inside `55–75%` in **all nine** matchups. Write the choice and the runner-up into the journal with their numbers. If no cell passes, **stop** — that is the slice's answer, and §7 of the spec says it is reported, not engineered around.

- [ ] **Step 2: Write the chosen values in**

Update `pushDistance` in `src/content/combatStyles.ts` and its pinned value in `combatStyles.test.ts`. Update the exit rule and threshold in `combatDecision.ts`. Nothing else moves.

- [ ] **Step 3: Run the fast suite and read every failure**

Run: `node node_modules/vitest/vitest.mjs run --project fast`
Expected: failures **only** in frozen-hash and canonical-trace assertions. Any other failure is a real regression, not a baseline that needs refreshing.

- [ ] **Step 4: Re-baseline the determinism fixtures, in their own commit**

Update the frozen hashes. Commit them alone, with a message stating which build produced them and that this is the slice's single re-baseline.

```bash
git commit -m "chore(shove): the slice's one determinism re-baseline, at the chosen constants"
```

- [ ] **Step 5: Run the slow suite — the eight inherited gates**

Run: `node node_modules/vitest/vitest.mjs run --project slow`
Expected: 9–14 minutes. `balance.test.ts`, `seasonBalance.test.ts` and `dispositionBalance.test.ts` are gate T. If T fails, present the failing distributions to the design owner — **do not widen a band.**

- [ ] **Step 6: Run the e2e suites**

Run: `node node_modules/@playwright/test/cli.js test --project fast`
Then, only for an intentional UI change, refresh baselines with `-u` and look at every regenerated PNG before committing it. CI runs Linux; refresh that set in the container per `AGENTS.md`.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shove): the swept push distance and the exit rule it was fitted to"
```

---

### Task 12: Gate X — the blinded clips and the two humans

This is a human gate. It cannot be run by a model, and it has never run in this project.

**Files:**
- Modify: `scripts/record-review-clips.ts` (add the shove seeds)
- Create: `docs/reviews/2026-08-29-shield-shove-playtest.md`

**Interfaces:**
- Consumes: the merged build from Task 11
- Produces: clips in the gitignored `docs/reviews/clips/`, and a filled report

- [ ] **Step 1: Choose the seeds before recording**

Pick 10 seeds containing at least 6 resolved shoves and 4 shove misses, plus 6 `committed`-exchange controls. Write the seed list into the report **first**, so the sample cannot be chosen after seeing which clips read well.

- [ ] **Step 2: Record HUD-on and HUD-off**

Run: `node node_modules/vite-node/vite-node.mjs scripts/record-review-clips.ts`
Follow the existing clip conventions in `docs/reviews/clips/baseline/README.md`.

- [ ] **Step 3: Run the gate with two people who did not implement the combat**

Threshold: ≥75% correct identification on shoves, and not below the same reviewers' rate on the committed controls. Use `docs/reviews/2026-08-16-readable-deep-combat-human-review.md` as the report template.

- [ ] **Step 4: Commit the report**

```bash
git add docs/reviews/2026-08-29-shield-shove-playtest.md scripts/record-review-clips.ts
git commit -m "docs(shove): the blinded clip protocol and its result"
```

---

### Task 13: Close the parked candidate, and write the journal

**Files:**
- Create or extend: `docs/superpowers/plans/2026-08-29-shove-journal.md`
- Possibly delete: the branch `experiment/murmillo-pursuit-exit`

**Interfaces:**
- Consumes: everything above
- Produces: a stated decision on the gain-based exit rule

- [ ] **Step 1: State the decision the sweep forced**

Either the gain rule is in `main` (and `experiment/murmillo-pursuit-exit` is deleted as superseded), or the control row won and the branch is buried with the measurement that buried it. §9.1 has been open across two slices; it closes here, in writing, either way.

- [ ] **Step 2: Write the journal entry**

Follow `docs/superpowers/plans/2026-08-28-murmillo-journal.md`'s structure: what was built, the evidence as commands rather than reasoning, where I was wrong and what told me, the numbers at 200 seeds, where I stopped.

Include a count of the times an instrument or a claim was wrong in your favour. The previous slice's count was nine. That number is the point of keeping it.

- [ ] **Step 3: Open the PR**

One PR to `main`, with the player hypothesis, the sweep's table, the Playwright screenshot, and gate X's result.

```bash
git add docs/superpowers/plans/2026-08-29-shove-journal.md
git commit -m "docs(journal): the shove slice, its sweep, and the candidate it closed"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §1.1 no framework, no net | the plan adds no module and no state — Tasks 5–8 |
| §2.1 authored action, catalogue stays data | Tasks 5, 6 |
| §2.2 frozen constants | Task 6, pinned value by value |
| §2.3 the `no-damage` branch | Task 7 |
| §2.4 neither `committed` nor `probe` | Task 6, Step 3 |
| §2.5 one re-baseline | Task 11, Step 4 |
| §3 + §4 P/Q attribution | Tasks 2, 3, 4 |
| §4 all eight gates bind | Task 11, Step 5 |
| §4 gate W | Task 9, measured in Task 10 |
| §4 gate X | Task 12 |
| §5 the sweep, cap frozen and printed | Task 10 |
| §6 work order | Tasks 1–13 |
| §9 deferred net | out of scope by construction |

**Placeholders:** none. Two steps deliberately defer a value rather than inventing it — Task 6's provisional `pushDistance: 0.90` (replaced in Task 11, and named as provisional in both places) and Task 11's chosen constants (they are the sweep's output; no plan can know them in advance).

**Type consistency:** `externalSeparationDelta` (sample) and `externalGround` (episode) are used with those names in Tasks 2, 3 and 4. `voluntaryGroundOpened` is defined in Task 3 and consumed in Task 4. `checkShoveGateW`/`ShoveRunSummary` are defined in Task 9 and consumed in Task 10. `'heavy-shield-shove'` is spelled identically in Tasks 5–12.
