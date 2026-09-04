// The recorded browser traces the camera suite replays, split out of
// `src/presentation/ArenaCamera.test.ts`.
//
// HISTORICAL (retiarius-reach slice, superseded by Task 7 below): this split
// is what made that slice's CI gate obeyable. The gate forbade
// `src/presentation/**` wholesale, because that slice's premise was that
// BEHAVIOUR separates the trident from the spear while the silhouette does
// not -- and a camera retune would answer the same question a second way.
// But `ArenaCamera.test.ts` held these numbers, which a behaviour change MUST
// move. Forbidding a file whose contents must move is a rule that cannot be
// obeyed; the numbers move here instead, and the file goes behind the gate.
// Task 7 is not that slice and was not bound by its gate, but changed the
// same numbers for an unrelated reason (see below) and this split still
// documents the CLASS distinction that matters either way:
//
// CLASS: determinism, with a behavioural edge. `ticks` and `openingDistance`
// are not free: they say this replay is THE recorded bout and not merely a
// bout of the same shape. If `ticks` moves, the bout restructured, and that
// wants a sentence in the commit rather than a silent re-freeze. `crossings`
// is how many times the framing crossed a band edge -- it moves with the
// spacing the fighters actually keep, which a behaviour change moves on
// purpose.
//
// What is NOT here, deliberately: everything `expectSmoothFraming` asserts --
// the reversal ceiling, the zoom-rate limit, the clamp being inert, the
// distance bounds. Those are the camera's acceptance criteria, they stay in
// the test file, and they are not re-baselinable regardless of which slice is
// touching this file. `ArenaCamera.ts` constants split into two kinds: a
// MEASURED one (`WIDEST_EQUIPMENT_RADIUS`) is refreshed whenever the rig it
// quotes changes -- that is a data fix, not a re-baseline, and Task 7 did
// exactly that. The SWEPT pair (`FLAT_DISTANCE`, `EASE_WIDTH_EXTENT`) is
// chosen by sweeping candidates against recorded ticks and is never refreshed
// just because a rig changed; moving either is a finding to report and a
// slice to schedule, not a number to nudge.
//
// `label` and `ticks` were read out of the original browser recording,
// `.superpowers/framing/rec-8.81-full-ease7.00.json` (captured against the
// old procedural rig, before Task 6's skinned models). `openingDistance` and
// `crossings` below are NOT from that recording -- Task 6 changed the rig's
// equipment radii, which the recording can't reflect, so these two are read
// from the vitest replay in `ArenaCamera.test.ts` itself, run under the
// measured radii current at commit time (see that file's
// `RIG_EQUIPMENT_RADIUS`). `lineup` is the one `scripts/measure-framing.ts`
// opened the series with, same as always.

export interface RecordedCameraTrace {
  label: string
  lineup: readonly string[]
  ticks: number
  openingDistance: number
  crossings: number
}

// RE-RECORDED by Task 7 (skinned gladiators): Task 6 replaced the procedural
// rig with skinned models, which changed each archetype's
// `horizontalEquipmentRadius` -- the camera's framing input -- so OPENING
// DISTANCE and CROSSINGS both move here. `ticks` must NOT move: the
// simulation is untouched by this slice, only the camera's framing radii are,
// so an unchanged bout length is exactly what confirms this is a re-recording
// and not a re-baseline of something that actually broke. All three traces
// below kept their original tick counts.
//
// First pass (radii refreshed, `ArenaCamera.ts`'s `WIDEST_EQUIPMENT_RADIUS`
// still stale) produced a real regression: crossings spiked to 5/25/15 and two
// pairings broke the reversal ceiling in `expectSmoothFraming` -- the tactical
// band's flat region no longer covered the `technical` archetype's real
// footwork. Per the coordinator's decision, `WIDEST_EQUIPMENT_RADIUS` is a
// measured constant (not a swept one) and was refreshed to the technical
// archetype's new radius, which restored the band. The final numbers below,
// after that fix, land close to the PRE-Task-7 values (crossings back to
// 1/5/5) because a correctly-sized band absorbs the wider equipment the same
// way it always did:
//
//   01 murmillo vs retiarius    1827 -> 1827 ticks   opening 15.0829 -> 15.5660   crossings 1 -> 1
//   04 retiarius vs retiarius   1705 -> 1705 ticks   opening 15.9315 -> 15.8849   crossings 5 -> 5
//   07 hoplomachus vs retiarius 1261 -> 1261 ticks   opening 16.2972 -> 16.2754   crossings 5 -> 5
//
// See the task-7 report for the full before/after (including the intermediate,
// regressed pass) and the `ArenaCamera.ts` diff that refreshed
// `WIDEST_EQUIPMENT_RADIUS`.
export const RECORDED_TRACES: readonly RecordedCameraTrace[] = [
  { label: '01 murmillo vs retiarius', lineup: ['brutus', 'aquila', 'nerva'], ticks: 1827, openingDistance: 15.565956748047434, crossings: 1 },
  { label: '04 retiarius vs retiarius', lineup: ['aquila', 'nerva', 'brutus'], ticks: 1705, openingDistance: 15.884910243078675, crossings: 5 },
  { label: '07 hoplomachus vs retiarius', lineup: ['nerva', 'brutus', 'aquila'], ticks: 1261, openingDistance: 16.275379050367395, crossings: 5 },
]
