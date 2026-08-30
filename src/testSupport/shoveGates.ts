// Gate W as code: `docs/superpowers/specs/2026-08-29-shield-shove-design.md`
// §4, "The shove must be a move, not the moveset -- and it must be risky."
//
// Written **before** part 3's sweep exists to be judged by it. That ordering
// is the whole point of the task: a gate assembled after seeing the sweep's
// numbers is not a gate, it is a description of whatever the sweep produced.
// The four checks below and their thresholds are frozen against the spec
// text, not against any run.
//
// ---------------------------------------------------------------------------
// WHY A CEILING ALONE IS NOT A GATE
// ---------------------------------------------------------------------------
//
// The first draft of gate W had only the frequency ceiling (point 2 below).
// A ceiling alone passes at zero shoves -- 0% is under any ceiling -- so a
// build where the shove exists in content but the murmillo never reaches for
// it would sail through untouched. Point 1's coverage floors close that: an
// empty or undersized population must make W **red**, never skipped, because
// "the murmillo never uses it" is exactly the failure mode a one-button
// combat design produces and exactly what this gate exists to catch.
//
// ---------------------------------------------------------------------------
// WHY PUNISHABILITY IS MEASURED AGAINST THE JAB, NOT ASSERTED FROM THE RECOVERY NUMBER
// ---------------------------------------------------------------------------
//
// The shove's claimed cost is its recovery window. A long recovery constant
// in `combatActions.ts` is not evidence that the cost is real: the push and
// stagger it just applied can themselves reduce how often the murmillo gets
// hit inside that window, which would make a long recovery cost him nothing.
// Point 3 checks the only thing that can show that: whether contacts land
// inside the shove's recovery window *at least as often* as they land inside
// `heavy-shield-jab`'s recovery window. A "cost" fully covered by the shove's
// own push and stagger is not a cost, and this is the check that would catch
// it.
//
// ---------------------------------------------------------------------------
// WHY POPULATION SIZE IS ITS OWN CHECK, SEPARATE FROM THE RATE IT GATES
// ---------------------------------------------------------------------------
//
// `recoveryWindowContactsPerShove` and `recoveryWindowContactsPerJab` arrive
// here already computed (`scripts/measure-distance.ts` divides contacts by
// counts and reports 0, not NaN, at zero contacts). A rate of 0 computed over
// zero jab contacts is numerically indistinguishable from a rate of 0
// computed over a thousand of them, and a shove that clears any positive
// recovery-window rate would pass point 3 against that phantom zero. Point 4
// checks the population directly -- `shoveContacts` and `jabContacts` must
// both be positive -- so a rate resting on an empty comparison population
// cannot pass by looking better than a baseline that was never measured.

/** Every counter gate W reads, for one run. Produced by `measure-distance.ts`'s counters (spec part 1). */
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

/** §4 W.1: at least this many shove starts across the run. */
export const W_MIN_SHOVE_STARTS = 150
/** §4 W.1: at least this many resolved shove contacts across the run. */
export const W_MIN_SHOVE_CONTACTS = 80
/** §4 W.1: at least this share of `heavy vs fast` bouts must contain a shove start. */
export const W_MIN_BOUT_SHARE = 0.25
/** §4 W.2: shoves are at most this share of the murmillo's chosen attack decisions. */
export const W_MAX_DECISION_SHARE = 0.20

const pct = (share: number) => (Number.isFinite(share) ? `${(share * 100).toFixed(1)}%` : 'NaN%')

/**
 * Gate W, all four points, checked independently and accumulated: a summary
 * that fails three of the four reports all three, not the first one found.
 * Each pushed message carries the measured numbers beside the verdict word
 * the caller's test matches on (`coverage`, `frequency`, `punishability`,
 * `population`), because a message that says only "failed" gives the next
 * reader nothing to act on.
 */
export function checkShoveGateW(summary: Readonly<ShoveRunSummary>): ShoveGateVerdict {
  const failures: string[] = []

  // W.1 -- coverage floor. Three independent clauses; any one under its floor
  // is a coverage failure, and an empty population fails every clause at
  // once rather than being skipped.
  if (summary.shoveStarts < W_MIN_SHOVE_STARTS) {
    failures.push(
      `coverage: ${summary.shoveStarts} shove starts is below the ${W_MIN_SHOVE_STARTS}-start floor (W.1)`,
    )
  }
  if (summary.shoveContacts < W_MIN_SHOVE_CONTACTS) {
    failures.push(
      `coverage: ${summary.shoveContacts} resolved shove contacts is below the ${W_MIN_SHOVE_CONTACTS}-contact floor (W.1)`,
    )
  }
  const boutShare = summary.bouts > 0 ? summary.boutsWithAShove / summary.bouts : Number.NaN
  if (!(boutShare >= W_MIN_BOUT_SHARE)) {
    failures.push(
      `coverage: ${pct(boutShare)} of bouts (${summary.boutsWithAShove}/${summary.bouts}) contain a shove start, below the ${pct(W_MIN_BOUT_SHARE)} floor (W.1)`,
    )
  }

  // W.2 -- frequency ceiling. The shove must not become the moveset.
  const decisionShare = summary.murmilloAttackDecisions > 0 ? summary.shoveDecisions / summary.murmilloAttackDecisions : Number.NaN
  if (!(decisionShare <= W_MAX_DECISION_SHARE)) {
    failures.push(
      `frequency: shove share ${pct(decisionShare)} (${summary.shoveDecisions}/${summary.murmilloAttackDecisions}) exceeds the ${pct(W_MAX_DECISION_SHARE)} ceiling (W.2)`,
    )
  }

  // W.3 -- punishability. The recovery window must cost at least as much as
  // the jab's does; a rate lower than the jab's means the push and stagger
  // covered the cost the recovery was supposed to impose.
  if (!(summary.recoveryWindowContactsPerShove >= summary.recoveryWindowContactsPerJab)) {
    failures.push(
      `punishability: ${summary.recoveryWindowContactsPerShove.toFixed(3)} recovery-window contacts per shove is below the jab's ${summary.recoveryWindowContactsPerJab.toFixed(3)} per jab; the recovery cost is not real (W.3)`,
    )
  }

  // W.4 -- both populations W.3 compares must be non-empty, checked
  // independently of what the rate itself reads. A rate resting on zero
  // contacts is not evidence either way, and must not be trusted to pass
  // point 3 for either shove or jab.
  if (summary.shoveContacts <= 0 || summary.jabContacts <= 0) {
    failures.push(
      `population: punishability compares ${summary.shoveContacts} shove contacts against ${summary.jabContacts} jab contacts; both populations must be non-empty (W.4)`,
    )
  }

  return failures.length === 0 ? { pass: true } : { pass: false, failures }
}
