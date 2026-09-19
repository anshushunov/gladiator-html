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
//
// RE-RECORDED AGAIN by Task 7b (2.0-unit gladiators). The slow legibility
// harness measured on-screen body height at 117-124 px against the
// pre-committed 130 px floor in eight of the nine pairings, so the models were
// scaled from a 1.8- to a 2.0-unit standing height -- the fix design.md's
// section 7 names, rather than a wider camera or a lowered bar. That scales
// every archetype's `horizontalEquipmentRadius` by 10/9, and
// `WIDEST_EQUIPMENT_RADIUS` (MEASURED, per the class distinction above) was
// refreshed with it, so the band edge moved 7.0881 -> 7.5312 in the same
// commit. OPENING DISTANCE and CROSSINGS move; `ticks` again does not
// (`src/simulation/**` is untouched by this slice too):
//
//   01 murmillo vs retiarius    1827 -> 1827 ticks   opening 15.5660 -> 15.4353   crossings 1 -> 1
//   04 retiarius vs retiarius   1705 -> 1705 ticks   opening 15.8849 -> 15.7947   crossings 5 -> 3
//   07 hoplomachus vs retiarius 1261 -> 1261 ticks   opening 16.2754 -> 16.2333   crossings 5 -> 1
//
// Crossings FELL because the band edge moved out further than the fighters'
// own extents did: the retiarius/hoplomachus pairings spend more of the bout
// wholly inside the flat region now, so the framing crosses its edge less
// often. Every `expectSmoothFraming` bound was re-checked unmodified after the
// move and passes with the same margin as before (0 direction reversals in all
// three traces and all nine standalone pairings).
//
// RE-RECORDED A THIRD TIME by the murmillo kit
// (`docs/superpowers/specs/2026-09-17-kit-design.md`, PR-1). `heavy.glb` is
// now the Barbarian body at rig scale 0.9148 instead of the Knight's at 0.8641,
// with the Knight's sword and shield transplanted, so the murmillo's
// `horizontalEquipmentRadius` grew 1.5861850532796753 -> 1.679186605264372
// (read in the browser; `fast` and `technical` re-read in the same pass and
// bit-identical). `WIDEST_EQUIPMENT_RADIUS` did NOT move -- the hoplomachus'
// spear is still the widest rig -- so the band edge stays at 7.5312 and only
// the one trace that fields a murmillo has a new opening shot. `ticks` again
// does not move (`src/simulation/**` is untouched):
//
//   01 murmillo vs retiarius    1827 -> 1827 ticks   opening 15.4353 -> 15.6163   crossings 1 -> 1
//   04 retiarius vs retiarius   1705 -> 1705 ticks   opening 15.7947 (unchanged)  crossings 3 -> 3
//   07 hoplomachus vs retiarius 1261 -> 1261 ticks   opening 16.2333 (unchanged)  crossings 1 -> 1
//
// Traces 04 and 07 field no murmillo, so their inputs are byte-identical and
// they were predicted not to move; they did not. The opening distance on 01
// rose because the reset shot's group extent is 0.093 x 1.1 wider: the
// murmillo's outer edge sits that much further out, the retiarius' is where it
// was. `expectSmoothFraming` was re-run unmodified over the three traces and
// the nine standalone pairings and holds.
//
// RE-FROZEN 2026-09-05 (fighting room), AND THIS IS THE FIRST TIME `ticks`
// LEGITIMATELY MOVES. Every previous entry above turns on the rule that an
// unchanged bout length is what separates a re-recording from a re-baseline of
// something that actually broke -- and that rule holds precisely because those
// slices touched only the camera's framing inputs. This one changes
// `src/simulation/**` and `src/content/**` on purpose: the body-width
// translation (+0.30 on every separation), the duel arena that grew with it
// (6.5 x 2.5 -> 7.5 x 3.3, start +/-4.2 -> +/-4.7), the spear's `pushDistance`,
// and Aquila's `power`. Different bouts, therefore different lengths.
//
//   01 murmillo vs retiarius    1827 -> 3480 ticks   opening 15.4353 -> 16.5843   crossings 1 -> 1
//   04 retiarius vs retiarius   1705 -> 1632 ticks   opening 15.7947 -> 16.8736   crossings 3 -> 1
//   07 hoplomachus vs retiarius 1261 -> 1496 ticks   opening 16.2333 -> 17.2076   crossings 1 -> 3
//
// Opening distance rose in all three because the fighters now start 9.4 units
// apart instead of 8.4. Trace 01 is the one to look at twice: 3480 ticks is
// close to the 3600 cap, and it is a real tail rather than a stall -- the bout
// still ends by defeat, and `balance.test.ts` measures this pairing at a 2132
// median with a p95 under 3200 and no timeouts across 200 seeds.
//
// Everything `expectSmoothFraming` asserts was re-checked unmodified and
// passes: 0 direction reversals in traces 01 and 04 and 2 in trace 07 (against
// a ceiling of 2, the worst previously measured anywhere), peak zoom rates
// 3.09 / 4.68 / 3.27 against the limit of 5, clamped and unclamped series
// byte-identical, and every distance inside 8.81..18.
//
// RE-RECORDED A FIFTH TIME by the MERGE of the two slices above, which is the
// only entry here produced by neither slice alone. They move different factors
// and both factors are inputs to the opening shot, so neither side's numbers
// survive: the fighting-room slice moved the bouts (`ticks`, and the 9.4-unit
// start that lifts every opening distance) and the murmillo kit moved the
// murmillo's `horizontalEquipmentRadius` (1.5861850532796753 ->
// 1.679186605264372), which widens the reset shot's group extent in the one
// trace that fields a murmillo.
//
// `ticks` is taken from the fighting-room recording UNCHANGED, and that is the
// check that this is a merge and not a behaviour change: the kit touches
// `src/simulation/**` and `src/content/**` not at all, so a bout length that
// moved here would mean something else did.
//
//   01 murmillo vs retiarius    3480 ticks (held)   opening 16.5843 -> 16.7316   crossings 1 -> 1
//   04 retiarius vs retiarius   1632 ticks (held)   opening 16.8736 (unchanged)  crossings 1 -> 1
//   07 hoplomachus vs retiarius 1496 ticks (held)   opening 17.2076 (unchanged)  crossings 3 -> 3
//
// Traces 04 and 07 field no murmillo, so their inputs are byte-identical to the
// fighting-room recording and were predicted not to move; they did not. Trace
// 01's rise is +0.1473, NOT the +0.1810 the kit-only recording showed for the
// same radius change: the reset shot frames a pair that now starts a unit
// further apart, and the framing distance is not linear in one fighter's
// radius. Predicted by hand at 16.7666 and measured at 16.7316 -- the measured
// value is the one frozen.
export const RECORDED_TRACES: readonly RecordedCameraTrace[] = [
  { label: '01 murmillo vs retiarius', lineup: ['brutus', 'aquila', 'nerva'], ticks: 3480, openingDistance: 16.731582009986504, crossings: 1 },
  { label: '04 retiarius vs retiarius', lineup: ['aquila', 'nerva', 'brutus'], ticks: 1632, openingDistance: 16.87359929174532, crossings: 1 },
  { label: '07 hoplomachus vs retiarius', lineup: ['nerva', 'brutus', 'aquila'], ticks: 1496, openingDistance: 17.207578048058593, crossings: 3 },
]
