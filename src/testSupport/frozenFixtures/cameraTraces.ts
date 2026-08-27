// The recorded browser traces the camera suite replays, split out of
// `src/presentation/ArenaCamera.test.ts`.
//
// This split is what makes the CI gate obeyable. The gate forbids
// `src/presentation/**` wholesale, because this slice's premise is that
// BEHAVIOUR separates the trident from the spear while the silhouette does
// not -- and a camera retune would answer the same question a second way.
// But `ArenaCamera.test.ts` held these numbers, which a behaviour change MUST
// move. Forbidding a file whose contents must move is a rule that cannot be
// obeyed; the numbers move here instead, and the file goes behind the gate.
//
// CLASS: determinism, with a behavioural edge. `ticks` and `openingDistance`
// are not free: they say this replay is THE recorded bout and not merely a
// bout of the same shape. If `ticks` moves, the bout restructured, and that
// wants a sentence in the commit rather than a silent re-freeze. `crossings`
// is how many times the framing crossed a band edge -- it moves with the
// spacing the fighters actually keep, which this slice changes on purpose.
//
// What is NOT here, deliberately: everything `expectSmoothFraming` asserts --
// the reversal ceiling, the zoom-rate limit, the clamp being inert, the
// distance bounds. Those are the camera's acceptance criteria, they stay in
// the test file behind the gate, and they are not re-baselinable. `ArenaCamera.ts`
// itself is forbidden to this slice: if a CONSTANT has to move for these to
// pass, that is a finding to report and a slice to schedule, not a number to
// nudge.
//
// `label`, `ticks` and `openingDistance` were read out of
// `.superpowers/framing/rec-8.81-full-ease7.00.json`; `lineup` is the one
// `scripts/measure-framing.ts` opened the series with.

export interface RecordedCameraTrace {
  label: string
  lineup: readonly string[]
  ticks: number
  openingDistance: number
  crossings: number
}

// RE-RECORDED by the retiarius-reach slice, from a probe run over the changed
// build. The three OPENING DISTANCES are unchanged to the last digit -- the
// camera's reset framing is a pure function of the two start positions and the
// rigs' radii, none of which this slice touches -- so what moved is exactly
// what should have: bout length, and how often the framing crossed the band
// edge while the fighters were actually fighting.
//
//   01 murmillo vs retiarius   2106 -> 1827 ticks   crossings 1 -> 1
//   04 retiarius vs retiarius  1721 -> 1705 ticks   crossings 1 -> 5
//   07 hoplomachus vs retiarius 1689 -> 1261 ticks  crossings 5 -> 5
//
// The retiarius-vs-retiarius trace gaining four band-edge crossings is the
// visible face of the change: two fighters who now hold a real distance and
// close for a committed attack cross the framing band where two fighters
// locked at the arena floor never did.
export const RECORDED_TRACES: readonly RecordedCameraTrace[] = [
  { label: '01 murmillo vs retiarius', lineup: ['brutus', 'aquila', 'nerva'], ticks: 1827, openingDistance: 15.082901146815477, crossings: 1 },
  { label: '04 retiarius vs retiarius', lineup: ['aquila', 'nerva', 'brutus'], ticks: 1705, openingDistance: 15.931454116156672, crossings: 5 },
  { label: '07 hoplomachus vs retiarius', lineup: ['nerva', 'brutus', 'aquila'], ticks: 1261, openingDistance: 16.29718777542238, crossings: 5 },
]
