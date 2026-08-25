/// <reference types="vite/client" />

// Review-only runtime toggles for the 2026-08-23 readable-gladiator-types
// slice, and nothing else.
//
// WHY THIS EXISTS. The slice changed three things at once -- the names on
// screen, the camera's extent->distance mapping, and the fighters' props --
// and every one of them is a presentation change aimed at the same question
// ("can a human tell the three types apart?"). A single pass or a single
// failure at the human review gate would therefore say nothing about *which*
// of the three did the work. So one frozen trace is recorded five ways behind
// these toggles, and the gate's confusion matrix is attributable.
//
// The first draft of the design spec proposed recording clips from two
// COMMITS instead. That does not work, and the reason is the one trap this
// module is shaped around: `horizontalEquipmentRadius` is derived from the
// fighters' equipment and is the camera's own framing input, so an
// "old props" commit runs a *different camera* than the one that ships. The
// camera-only configuration would then be comparing two cameras, not one
// camera against one mapping. Hence the rule enforced in
// `ProceduralFighter.createProceduralFighter`: **the framing radius always
// comes from the final props, regardless of `silhouettes`** -- only the
// DISPLAYED geometry follows the flag. `legibilityMode.test.ts` asserts that
// per configuration; it is the assertion that makes `camera-only` honest.
//
// DEV-ONLY, TWICE OVER. `main.ts` reads the `?legibility=` query parameter
// inside `if (import.meta.env.DEV)` and nowhere else, exactly like `?snapshot`
// and `?audioDebug` -- so a player cannot reach any of these configurations
// from a URL. And every one of the three owners funnels its mode through
// `effectiveLegibilityMode` below, which is `import.meta.env.DEV`-gated in
// turn, so no production code path can select a superseded configuration.
//
// ABSENCE, not merely unreachability, needs one thing more, and it was missing
// until the final whole-branch review found it. `effectiveLegibilityMode`
// returns a value; a `mode.labels ? shipped : superseded` ternary downstream is
// therefore a branch on a runtime-derived boolean, which no bundler can fold --
// so the superseded label map really did ship, as inert strings, in the
// player's download (`Heavy` x3, `Fast` x2, `Technical` x2 in
// `dist/assets/index-*.js`). Each of the three owners now names
// `import.meta.env.DEV` at its own branch, which `vite build` replaces with the
// literal `false` so the conditional collapses and the superseded side is
// tree-shaken away. `legibilityMode.test.ts`'s "the superseded branches are
// gated so the bundler can fold them" test pins that shape in source; the
// bundle itself is checked by `npm run build` followed by grepping
// `dist/assets/index-*.js` for `Heavy`/`Fast`/`Technical`, which is a manual
// step, not an automated one -- see that test's own comment.
//
// This module is deliberately free of every other concern: the label copy
// lives in `gladiatorTypes.ts`, the mapping in `ArenaCamera.ts`, the prop
// specs in `ProceduralFighter.ts`. `main.ts` only resolves the mode and hands
// it to the three owners -- a toggle implemented in `main.ts` alone could not
// reach any of them.

/**
 * Which of the slice's three changes are live.
 *
 * - `labels` -- the type vocabulary (`Murmillo`/`Retiarius`/`Hoplomachus`,
 *   their one-line descriptions, and the counter triangle stated in type
 *   names). `false` restores the superseded `Heavy`/`Fast`/`Technical` map.
 *   Owned by `gladiatorTypes.ts`, consumed by `SeriesView`/`SeasonView`.
 * - `camera` -- the flat-across-the-band extent->distance mapping and its
 *   `FLAT_DISTANCE` lower clamp. `false` restores the superseded
 *   `clamp(8.5 + 0.8 * extent, 11, 18)` line. Owned by `ArenaCamera.ts`.
 * - `silhouettes` -- the murmillo/retiarius/hoplomachus kits (scutum, net,
 *   trident, spear, galerus, greaves, crest, house values). `false` restores
 *   the superseded round-shield/box-weapon rig. Owned by
 *   `ProceduralFighter.ts` -- **displayed geometry only**, see the module
 *   header.
 */
export interface LegibilityMode {
  labels: boolean
  camera: boolean
  silhouettes: boolean
}

/** What a player gets: everything the slice shipped. The default everywhere. */
export const SHIPPED_LEGIBILITY_MODE: LegibilityMode = Object.freeze({ labels: true, camera: true, silhouettes: true })

export type LegibilityConfigurationName =
  | 'baseline'
  | 'labels-only'
  | 'camera-only'
  | 'silhouettes-only'
  | 'everything'

/**
 * The five configurations the review material is recorded in, and the
 * question each one answers on its own:
 *
 * | configuration      | question it answers                                            |
 * |--------------------|----------------------------------------------------------------|
 * | `baseline`         | what the failed 2026-08-23 gate actually saw                    |
 * | `labels-only`      | how much of any gain is just having a name to check against     |
 * | `camera-only`      | how much is just seeing the fighters bigger                     |
 * | `silhouettes-only` | how much is the kits, with no name and no extra pixels          |
 * | `everything`       | what ships                                                      |
 *
 * `everything` is `SHIPPED_LEGIBILITY_MODE` by value, so the shipped build and
 * the fifth configuration cannot drift apart.
 */
export const LEGIBILITY_CONFIGURATIONS: Readonly<Record<LegibilityConfigurationName, LegibilityMode>> = Object.freeze({
  baseline: Object.freeze({ labels: false, camera: false, silhouettes: false }),
  'labels-only': Object.freeze({ labels: true, camera: false, silhouettes: false }),
  'camera-only': Object.freeze({ labels: false, camera: true, silhouettes: false }),
  'silhouettes-only': Object.freeze({ labels: false, camera: false, silhouettes: true }),
  everything: SHIPPED_LEGIBILITY_MODE,
})

/** Recording order, and the order the review document tabulates them in. */
export const LEGIBILITY_CONFIGURATION_NAMES: readonly LegibilityConfigurationName[] = Object.freeze([
  'baseline',
  'labels-only',
  'camera-only',
  'silhouettes-only',
  'everything',
] as const)

export function isLegibilityConfigurationName(value: string): value is LegibilityConfigurationName {
  return Object.prototype.hasOwnProperty.call(LEGIBILITY_CONFIGURATIONS, value)
}

/**
 * The mode an owner should actually run: whatever it was handed in a dev
 * build, and the shipped mode unconditionally in a production one.
 *
 * Every one of the three owners funnels through this, and that is what makes
 * "dev-only" structural rather than a convention: there is one place that
 * decides, not three.
 *
 * It is NOT, on its own, what removes the superseded data from the bundle. A
 * call to this function is opaque to the bundler, so a `mode.labels ? ... :
 * ...` written against its result stays in the emitted code with both sides
 * intact. Elimination needs `import.meta.env.DEV` named at each branch as well,
 * which is what `typeVocabularyFor`, `ArenaCamera`'s constructor /
 * `arenaCameraOptionsFor` and `ProceduralFighter.buildRig` now do -- see the
 * module header. This function's job is that a production build cannot SELECT a
 * superseded configuration; theirs is that a production build does not CARRY
 * one.
 */
export function effectiveLegibilityMode(mode: LegibilityMode | undefined): LegibilityMode {
  if (!import.meta.env.DEV) return SHIPPED_LEGIBILITY_MODE
  return mode ?? SHIPPED_LEGIBILITY_MODE
}

/**
 * The mode a `?legibility=<name>` query string asks for, or the shipped mode
 * when the parameter is absent or names nothing.
 *
 * Pure, and takes the query string rather than reading `window`: that is what
 * lets `legibilityMode.test.ts` exercise it, and it keeps the one
 * `import.meta.env.DEV` guard at the single call site in `main.ts` instead of
 * hiding a second, ungated `window.location` read in here. An unrecognised
 * value falls back to the shipped mode silently rather than throwing -- a
 * mistyped review URL should show the reviewer the game, not a blank page.
 */
export function resolveLegibilityMode(search: string): LegibilityMode {
  const requested = new URLSearchParams(search).get('legibility')
  if (requested === null) return SHIPPED_LEGIBILITY_MODE
  return isLegibilityConfigurationName(requested) ? LEGIBILITY_CONFIGURATIONS[requested] : SHIPPED_LEGIBILITY_MODE
}
