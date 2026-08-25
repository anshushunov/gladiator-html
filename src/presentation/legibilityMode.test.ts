/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'
import type { Archetype } from '../simulation/fighters'
import {
  ArenaCamera,
  arenaCameraOptionsFor,
  FLAT_DISTANCE,
  SUPERSEDED_MIN_DISTANCE,
  type ArenaCameraMappingName,
  type HorizontalFramingTarget,
} from './ArenaCamera'
import { typeVocabularyFor } from './gladiatorTypes'
import {
  LEGIBILITY_CONFIGURATIONS,
  LEGIBILITY_CONFIGURATION_NAMES,
  resolveLegibilityMode,
  SHIPPED_LEGIBILITY_MODE,
  type LegibilityConfigurationName,
  type LegibilityMode,
} from './legibilityMode'
import { createProceduralFighter, measureSilhouetteExtent } from './ProceduralFighter'

// ---------------------------------------------------------------------------
// The five review configurations
//
// These tests exist for the human review gate's ATTRIBUTION, not for its
// verdict: the slice changed names, camera and props at once, so one frozen
// trace is recorded five ways and each configuration has to actually BE what
// it claims. Three claims per configuration are asserted below --
//
//   1. the displayed label set,
//   2. the active extent->distance mapping,
//   3. the framing radius the camera consumes,
//
// -- and the third is the one that makes `camera-only` honest. See
// `legibilityMode.ts`'s header, and `createProceduralFighter`'s comment at the
// point the radius is chosen.
// ---------------------------------------------------------------------------

const ARCHETYPES: readonly Archetype[] = ['heavy', 'fast', 'technical']

/**
 * The framing radii of the FINAL props, measured off the built rigs by
 * `computeHorizontalEquipmentRadius`. Written out here as the numbers the
 * slice actually shipped (they are quoted in `ArenaCamera`'s own
 * `WIDEST_EQUIPMENT_RADIUS` and in the framing sweep that chose
 * `FLAT_DISTANCE`), so that "the framing radius is unchanged" is checked
 * against a fixed expectation rather than against whatever the rig happens to
 * produce today.
 */
const FINAL_FRAMING_RADII: Readonly<Record<Archetype, number>> = {
  heavy: 0.7102,
  fast: 1.1465,
  technical: 1.3511,
}

interface ConfigurationExpectation {
  mode: LegibilityMode
  labels: Record<Archetype, string>
  counterRuleText: string
  /** `true` when the planning screen shows the "school's own scheme" note. */
  showsCounterRuleNote: boolean
  mapping: ArenaCameraMappingName
  minDistance: number
}

const SHIPPED_LABELS: Record<Archetype, string> = { heavy: 'Murmillo', fast: 'Retiarius', technical: 'Hoplomachus' }
const SUPERSEDED_LABELS: Record<Archetype, string> = { heavy: 'Heavy', fast: 'Fast', technical: 'Technical' }
const SHIPPED_COUNTER_RULE = 'Murmillo beats Retiarius beats Hoplomachus beats Murmillo'
const SUPERSEDED_COUNTER_RULE = 'Heavy → Fast → Technical → Heavy'

const EXPECTATIONS: Readonly<Record<LegibilityConfigurationName, ConfigurationExpectation>> = {
  baseline: {
    mode: { labels: false, camera: false, silhouettes: false },
    labels: SUPERSEDED_LABELS,
    counterRuleText: SUPERSEDED_COUNTER_RULE,
    showsCounterRuleNote: false,
    mapping: 'superseded',
    minDistance: SUPERSEDED_MIN_DISTANCE,
  },
  'labels-only': {
    mode: { labels: true, camera: false, silhouettes: false },
    labels: SHIPPED_LABELS,
    counterRuleText: SHIPPED_COUNTER_RULE,
    showsCounterRuleNote: true,
    mapping: 'superseded',
    minDistance: SUPERSEDED_MIN_DISTANCE,
  },
  'camera-only': {
    mode: { labels: false, camera: true, silhouettes: false },
    labels: SUPERSEDED_LABELS,
    counterRuleText: SUPERSEDED_COUNTER_RULE,
    showsCounterRuleNote: false,
    mapping: 'shipped',
    minDistance: FLAT_DISTANCE,
  },
  'silhouettes-only': {
    mode: { labels: false, camera: false, silhouettes: true },
    labels: SUPERSEDED_LABELS,
    counterRuleText: SUPERSEDED_COUNTER_RULE,
    showsCounterRuleNote: false,
    mapping: 'superseded',
    minDistance: SUPERSEDED_MIN_DISTANCE,
  },
  everything: {
    mode: { labels: true, camera: true, silhouettes: true },
    labels: SHIPPED_LABELS,
    counterRuleText: SHIPPED_COUNTER_RULE,
    showsCounterRuleNote: true,
    mapping: 'shipped',
    minDistance: FLAT_DISTANCE,
  },
}

const CAMERA_MAX_DISTANCE = 18

/** A pair sitting well inside the tactical band, i.e. squarely in the shipped
 * mapping's flat region and squarely in the superseded mapping's sloped one. */
function inBandPair(radius: number): HorizontalFramingTarget[] {
  return [
    { id: 'home', centerX: -1.25, centerZ: 0, radius },
    { id: 'away', centerX: 1.25, centerZ: 0, radius },
  ]
}

describe('the five review configurations', () => {
  it('names exactly five, and `everything` is the shipped mode by value', () => {
    expect([...LEGIBILITY_CONFIGURATION_NAMES]).toEqual([
      'baseline',
      'labels-only',
      'camera-only',
      'silhouettes-only',
      'everything',
    ])
    expect(Object.keys(LEGIBILITY_CONFIGURATIONS).sort()).toEqual([...LEGIBILITY_CONFIGURATION_NAMES].sort())
    expect(LEGIBILITY_CONFIGURATIONS.everything).toBe(SHIPPED_LEGIBILITY_MODE)
    // Every single-change configuration turns on exactly one of the three, and
    // `baseline` none: without that, "which change did the work" is unanswerable
    // however good the confusion matrix is.
    const enabledCount = (mode: LegibilityMode): number => [mode.labels, mode.camera, mode.silhouettes].filter(Boolean).length
    expect(enabledCount(LEGIBILITY_CONFIGURATIONS.baseline)).toBe(0)
    expect(enabledCount(LEGIBILITY_CONFIGURATIONS['labels-only'])).toBe(1)
    expect(enabledCount(LEGIBILITY_CONFIGURATIONS['camera-only'])).toBe(1)
    expect(enabledCount(LEGIBILITY_CONFIGURATIONS['silhouettes-only'])).toBe(1)
    expect(enabledCount(LEGIBILITY_CONFIGURATIONS.everything)).toBe(3)
  })

  it('resolves `?legibility=` only for a name it knows, and defaults to the shipped mode', () => {
    expect(resolveLegibilityMode('')).toBe(SHIPPED_LEGIBILITY_MODE)
    expect(resolveLegibilityMode('?seed=20260815')).toBe(SHIPPED_LEGIBILITY_MODE)
    expect(resolveLegibilityMode('?legibility=not-a-configuration')).toBe(SHIPPED_LEGIBILITY_MODE)
    for (const name of LEGIBILITY_CONFIGURATION_NAMES) {
      expect(resolveLegibilityMode(`?seed=1&legibility=${name}&snapshot`)).toBe(LEGIBILITY_CONFIGURATIONS[name])
    }
  })

  for (const name of LEGIBILITY_CONFIGURATION_NAMES) {
    const expected = EXPECTATIONS[name]

    describe(name, () => {
      const mode = LEGIBILITY_CONFIGURATIONS[name]

      it('is the mode the table says it is', () => {
        expect({ ...mode }).toEqual(expected.mode)
      })

      // -- 1. the displayed label set -------------------------------------
      it('displays the expected label set', () => {
        const vocabulary = typeVocabularyFor(mode)
        expect({ ...vocabulary.names }).toEqual(expected.labels)
        expect(vocabulary.counterRuleText).toBe(expected.counterRuleText)
        expect(vocabulary.counterRuleNote !== '').toBe(expected.showsCounterRuleNote)
        // The tooltip is part of the naming change, so it comes and goes with
        // it -- an empty description means the views render no `title` at all.
        for (const archetype of ARCHETYPES) {
          expect(vocabulary.descriptions[archetype] !== '', `${archetype} description present`).toBe(expected.mode.labels)
        }
      })

      // -- 2. the active mapping ------------------------------------------
      it('runs the expected extent->distance mapping', () => {
        const options = arenaCameraOptionsFor(mode, FLAT_DISTANCE, CAMERA_MAX_DISTANCE)
        expect(options.minDistance).toBe(expected.minDistance)
        expect(options.maxDistance).toBe(CAMERA_MAX_DISTANCE)

        const camera = new ArenaCamera(options)
        expect(camera.activeMapping).toBe(expected.mapping)

        // Not just the name: the number. A pair 2.5 apart with the murmillo's
        // radius produces a group extent of 2.5 + 2 * 0.7102 * 1.1 = 4.0624,
        // which is inside the tactical band -- so the shipped mapping frames it
        // flat at `FLAT_DISTANCE` (8.81), and the superseded line frames it at
        // `clamp(8.5 + 0.8 * 4.0624, 11, 18)` = 11.749952. Those two are 2.94
        // world units apart, i.e. the reviewer is looking at a visibly
        // different shot: this assertion cannot pass for a configuration that
        // silently fell back to the other mapping.
        const targets = inBandPair(FINAL_FRAMING_RADII.heavy)
        const extent = 2.5 + 2 * FINAL_FRAMING_RADII.heavy * 1.1
        const distance = camera.reset(targets).distance
        expect(extent).toBeCloseTo(4.0624, 4)
        const supersededDistance = Math.min(Math.max(8.5 + 0.8 * extent, SUPERSEDED_MIN_DISTANCE), CAMERA_MAX_DISTANCE)
        expect(supersededDistance).toBeCloseTo(11.749952, 6)
        expect(distance).toBeCloseTo(expected.mapping === 'shipped' ? FLAT_DISTANCE : supersededDistance, 6)
        expect(Math.abs(FLAT_DISTANCE - supersededDistance)).toBeGreaterThan(2.9)
      })

      // -- 3. the framing radius -------------------------------------------
      //
      // THE ONE THAT MAKES `camera-only` HONEST. `horizontalEquipmentRadius` is
      // the camera's own framing input, so if it followed the `silhouettes`
      // flag then `camera-only` would run the shipped mapping over the OLD
      // radii -- a camera that has never shipped -- and the confusion matrix
      // could attribute nothing to the camera change. This assertion fails the
      // instant that happens, in three of the five configurations at once.
      it('frames off the FINAL equipment radii, whatever the silhouette flag says', () => {
        for (const archetype of ARCHETYPES) {
          const fighter = createProceduralFighter({ archetype, legibility: mode })
          try {
            expect(fighter.horizontalEquipmentRadius, `${name}/${archetype} framing radius`).toBeCloseTo(
              FINAL_FRAMING_RADII[archetype],
              4,
            )
          } finally {
            fighter.dispose()
          }
        }
      })

      it('draws the expected kit -- and, when it draws the superseded one, still frames off the final props', () => {
        for (const archetype of ARCHETYPES) {
          const fighter = createProceduralFighter({ archetype, legibility: mode })
          try {
            const slots = new Set<string>()
            fighter.root.traverse((object) => {
              const slot = object.userData.slot
              if (typeof slot === 'string') slots.add(slot)
            })
            // `net`, `shoulderGuard` (the galerus) and `greave` exist only in
            // the shipped kits; the superseded rig has a cylinder `shield` for
            // everyone and nothing else new. Checking a slot the old builder
            // could not produce is what makes this fail if `silhouettes: false`
            // silently drew the shipped kit anyway.
            const shippedOnlySlots = ['net', 'shoulderGuard', 'greave']
            const drawsShippedOnlySlot = shippedOnlySlots.some((slot) => slots.has(slot))
            if (archetype === 'heavy') {
              // The murmillo has no galerus and no net, and its single low
              // greave is a shipped-kit addition.
              expect(slots.has('greave'), `${name}/heavy greave`).toBe(mode.silhouettes)
            } else if (archetype === 'fast') {
              expect(slots.has('net'), `${name}/fast net`).toBe(mode.silhouettes)
              expect(slots.has('shoulderGuard'), `${name}/fast galerus`).toBe(mode.silhouettes)
              // The retiarius has no shield in the shipped kit and a small
              // round one in the superseded kit.
              expect(slots.has('shield'), `${name}/fast shield`).toBe(!mode.silhouettes)
            } else {
              expect(slots.has('greave'), `${name}/technical greave`).toBe(mode.silhouettes)
            }
            expect(drawsShippedOnlySlot || !mode.silhouettes).toBe(true)

            // The drawn thing and the framed thing are allowed to disagree, and
            // under `silhouettes: false` they must: the retiarius' shipped
            // trident-and-net kit is over half a world unit wider than the
            // superseded box-sword-and-buckler one, yet the camera still frames
            // for the wide one.
            const drawn = measureSilhouetteExtent(fighter)
            expect(drawn.horizontalEquipmentRadius).toBeCloseTo(FINAL_FRAMING_RADII[archetype], 4)
            if (!mode.silhouettes && archetype === 'fast') {
              expect(drawn.width).toBeLessThan(FINAL_FRAMING_RADII.fast * 2)
            }
          } finally {
            fighter.dispose()
          }
        }
      })
    })
  }

  it('the superseded kits really are narrower than the radii the camera keeps framing for', () => {
    // A guard on the guard: if the two kits happened to measure the same, the
    // "framing radius is pinned to the final props" assertion above would be
    // vacuously true, and `silhouettes: false` could quietly revert the radius
    // without any test noticing. This proves the two disagree, per archetype,
    // by more than rounding.
    for (const archetype of ARCHETYPES) {
      const superseded = createProceduralFighter({ archetype, legibility: LEGIBILITY_CONFIGURATIONS.baseline })
      const shipped = createProceduralFighter({ archetype, legibility: SHIPPED_LEGIBILITY_MODE })
      try {
        const supersededDrawn = measureSilhouetteExtent(superseded)
        const shippedDrawn = measureSilhouetteExtent(shipped)
        const differs =
          Math.abs(supersededDrawn.width - shippedDrawn.width) > 0.01 ||
          Math.abs(supersededDrawn.height - shippedDrawn.height) > 0.01 ||
          Math.abs(supersededDrawn.depth - shippedDrawn.depth) > 0.01
        expect(differs, `${archetype}: superseded and shipped kits must differ in drawn extent`).toBe(true)
        // ...and both still report the final props' radius.
        expect(superseded.horizontalEquipmentRadius).toBeCloseTo(shipped.horizontalEquipmentRadius, 10)
      } finally {
        superseded.dispose()
        shipped.dispose()
      }
    }
  })
})

// ---------------------------------------------------------------------------
// The mode reaches the three owners, not just `main.ts`
//
// Same technique, and the same reason, as `simulation/architecture.test.ts`:
// some invariants are about where code lives rather than about what a function
// returns, and a source scan is the only thing that can check them. The
// invariant here is the whole shape of the task -- labels live in the views,
// the mapping in `ArenaCamera`, the specs in `ProceduralFighter`, and `main.ts`
// only constructs those three. A `LegibilityMode` that reached `main.ts` and
// stopped would change nothing on screen while every value-level test above
// still passed, because those tests call the three owners directly.
// ---------------------------------------------------------------------------

function presentationSources(): Record<string, string> {
  return import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
}

function mainSource(): string {
  const sources = import.meta.glob('../main.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
  const source = sources['../main.ts']
  if (source === undefined) throw new Error('main.ts did not resolve -- the glob below would be vacuously green')
  return source
}

/** Source with comments stripped, so a doc comment naming a constant is not
 * mistaken for a use of it (the same treatment `architecture.test.ts` applies). */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
}

describe('the legibility mode reaches all three owners', () => {
  it('scans the modules it claims to -- an unresolved glob would leave every check below vacuously green', () => {
    const sources = presentationSources()
    for (const path of ['./SeriesView.ts', './SeasonView.ts', './ArenaView.ts', './ArenaCamera.ts', './ProceduralFighter.ts']) {
      expect(Object.keys(sources)).toContain(path)
      expect(sources[path].length).toBeGreaterThan(1000)
    }
    expect(mainSource().length).toBeGreaterThan(1000)
  })

  it('the views read every type label from the injected vocabulary, never from a module constant', () => {
    const sources = presentationSources()
    for (const path of ['./SeriesView.ts', './SeasonView.ts']) {
      const body = code(sources[path])
      // The whole point of `TypeVocabulary` being a constructor argument: a
      // view that kept reaching for `TYPE_NAMES` would render the shipped
      // labels under `labels: false` and no value-level test would see it.
      expect(body, `${path} must not read TYPE_NAMES directly`).not.toMatch(/\bTYPE_NAMES\b/)
      expect(body, `${path} must not read TYPE_DESCRIPTIONS directly`).not.toMatch(/\bTYPE_DESCRIPTIONS\b/)
      expect(body, `${path} must not read COUNTER_RULE_TEXT directly`).not.toMatch(/\bCOUNTER_RULE_TEXT\b/)
      expect(body, `${path} must resolve a vocabulary from the mode`).toMatch(/typeVocabularyFor\(\s*legibility\s*\)/)
      expect(body, `${path} must take the mode at construction`).toMatch(/legibility:\s*LegibilityMode/)
    }
  })

  it('ArenaView hands the mode to the camera and to every rig it builds', () => {
    const body = code(presentationSources()['./ArenaView.ts'])
    expect(body, 'ArenaView must take the mode at construction').toMatch(/legibility:\s*LegibilityMode/)
    // The camera: built through `arenaCameraOptionsFor`, which is what carries
    // both the mapping choice and the near clamp that shipped with it.
    expect(body, 'ArenaView must build its camera from the mode').toMatch(
      /new ArenaCamera\(\s*arenaCameraOptionsFor\(\s*legibility\s*,/,
    )
    // The rig: every `createProceduralFighter` call site must pass it. A
    // second, un-threaded call site is exactly how a "toggle in main.ts"
    // regression would look.
    const rigCalls = body.match(/createProceduralFighter\(\{[^}]*\}\)/g) ?? []
    expect(rigCalls.length, 'ArenaView should build rigs somewhere').toBeGreaterThan(0)
    for (const call of rigCalls) expect(call).toMatch(/legibility:\s*this\.legibility/)
  })

  it('main.ts resolves the mode dev-only and passes it to all three owners', () => {
    const body = code(mainSource())
    // Dev-only, gated the same way `?snapshot` is.
    expect(body).toMatch(/import\.meta\.env\.DEV[\s\S]{0,200}resolveLegibilityMode\(/)
    // `resolveLegibilityMode` is called exactly once, and only inside that guard.
    expect((body.match(/resolveLegibilityMode\(/g) ?? []).length).toBe(1)
    for (const owner of ['new SeriesView(', 'new SeasonView(', 'new ArenaView(']) {
      const index = body.indexOf(owner)
      expect(index, `${owner} should be constructed in main.ts`).toBeGreaterThan(-1)
      // To the end of the statement, not to the first `)` -- `new SeasonView(
      // required<HTMLElement>('#season-ui'), legibilityMode)` has a nested call
      // in its first argument.
      const call = body.slice(index, body.indexOf('\n', index))
      expect(call, `${owner} must be handed the legibility mode`).toContain('legibilityMode')
    }
  })

  it('the review-only fallbacks are marked as such and live beside what they replace', () => {
    const sources = presentationSources()
    expect(code(sources['./gladiatorTypes.ts'])).toMatch(/SUPERSEDED_TYPE_VOCABULARY/)
    expect(code(sources['./ArenaCamera.ts'])).toMatch(/supersededExtentToDistance/)
    expect(code(sources['./ProceduralFighter.ts'])).toMatch(/SUPERSEDED_STYLE_SPECS/)
    // Each carries the "review-only" marking a reader needs in order not to
    // mistake it for live code.
    for (const path of ['./gladiatorTypes.ts', './ArenaCamera.ts', './ProceduralFighter.ts']) {
      expect(sources[path], `${path} must mark its superseded block review-only`).toMatch(/[Rr]eview-only/)
    }
  })

  // Final-review fix #2. What this test can and cannot do, stated plainly
  // because the comments it replaces overstated exactly this:
  //
  //   IT CHECKS a source SHAPE -- that each of the three owners names
  //   `import.meta.env.DEV` itself at the branch that selects between shipped
  //   and superseded. That is the property `vite build` needs in order to fold
  //   the branch (it replaces the identifier with the literal `false`) and
  //   tree-shake the superseded side away.
  //
  //   IT DOES NOT CHECK THE EMITTED BUNDLE. Nothing in `npm test` does. The
  //   bundle check is `npm run build` followed by grepping
  //   `dist/assets/index-*.js` for `Heavy`, `Fast` and `Technical`, and it is a
  //   manual step. Before this fix that grep returned 3/2/2 hits while two
  //   tracked comments asserted the bundle had been checked and was clean.
  //
  // A source scan is used rather than a value assertion because there is no
  // value to assert: both spellings behave identically at runtime in a dev
  // build, and in a production build the superseded branch is unreachable
  // either way. The difference is only visible to the bundler.
  it('gates every superseded branch on import.meta.env.DEV so the bundler can fold it', () => {
    const sources = presentationSources()
    const gated = [
      ['./gladiatorTypes.ts', /import\.meta\.env\.DEV[\s\S]{0,200}SUPERSEDED_TYPE_VOCABULARY/],
      ['./ArenaCamera.ts', /import\.meta\.env\.DEV[\s\S]{0,200}supersededExtentToDistance/],
      ['./ProceduralFighter.ts', /import\.meta\.env\.DEV[\s\S]{0,200}SUPERSEDED_STYLE_SPECS/],
    ] as const
    for (const [path, pattern] of gated) {
      expect(
        code(sources[path]),
        `${path} must name import.meta.env.DEV at the branch that selects the superseded side, `
          + 'otherwise the branch survives minification and the superseded data ships',
      ).toMatch(pattern)
    }
    // And the superseded data must never be READ outside such a branch.
    // `buildRig` used to do exactly that -- `const superseded =
    // SUPERSEDED_STYLE_SPECS[archetype]` hoisted above its own conditional,
    // with only the *use* of it gated -- which pins the whole table into the
    // bundle however the branch below is written. Every subscript of it must
    // now sit on the folded side of `drawSuperseded`.
    const rig = code(sources['./ProceduralFighter.ts'])
    for (const line of rig.split('\n')) {
      if (!/SUPERSEDED_STYLE_SPECS\s*\[/.test(line)) continue
      expect(
        line,
        'a SUPERSEDED_STYLE_SPECS lookup outside a `drawSuperseded` branch keeps the table in the production bundle',
      ).toMatch(/drawSuperseded/)
    }
  })
})
