/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'

// Every pattern `src/simulation/**` (excluding tests) must never match. The
// file list itself comes from `import.meta.glob`, so a new simulation module
// added by a later task is scanned automatically without editing this list.
// Each entry pairs the pattern with a source snippet it must match, so a
// typo that quietly stops matching anything (`Math\.exp` vs `Math\.exp\b`
// nesting, a dropped alternative, an unescaped dot) fails the table test
// below instead of silently green-lighting the very call it names.
const FORBIDDEN_PATTERNS: readonly { pattern: RegExp; sample: string }[] = [
  // Rendering/DOM/browser/audio.
  { pattern: /from ['"]three['"]/, sample: "import * as THREE from 'three'" },
  { pattern: /\bdocument\b/, sample: 'const el = document.body' },
  { pattern: /\bwindow\b/, sample: 'window.requestAnimationFrame(fn)' },
  { pattern: /\bHTMLElement\b/, sample: 'function mount(host: HTMLElement) {}' },
  { pattern: /\bAudioContext\b/, sample: 'const ctx = new AudioContext()' },
  // Content/presentation modules: simulation takes content as plain data
  // parameters, it never imports the content or presentation directories.
  { pattern: /from ['"][^'"]*\/content\//, sample: "import { COMBAT_STYLES } from '../content/combatStyles'" },
  { pattern: /from ['"][^'"]*\/presentation\//, sample: "import { ArenaView } from '../presentation/ArenaView'" },
  // Non-deterministic sources: Math.random, Web Crypto, and wall-clock time.
  { pattern: /Math\.random/, sample: 'const roll = Math.random()' },
  { pattern: /\bcrypto\b/, sample: 'crypto.getRandomValues(buffer)' },
  { pattern: /Date\.now/, sample: 'const started = Date.now()' },
  { pattern: /performance\.now/, sample: 'const started = performance.now()' },
  // Runtime trigonometry and every other transcendental: their results are
  // only implementation-*bounded*, not bit-exact across engines, so any of
  // them would break the "Node and Chromium fold the same trace hash"
  // guarantee. Simulation may use Math.sqrt (IEEE-754 exact) for
  // normalization, and authored sine/cosine literals stand in for the rest;
  // see movement.ts's turnFacing.
  { pattern: /Math\.(sin|cos|tan)\b/, sample: 'const y = Math.sin(theta)' },
  { pattern: /Math\.(asin|acos|atan|atan2)\b/, sample: 'const a = Math.atan2(z, x)' },
  { pattern: /Math\.(sinh|cosh|tanh|asinh|acosh|atanh)\b/, sample: 'const s = Math.tanh(x)' },
  { pattern: /Math\.(exp|expm1)\b/, sample: 'const decay = Math.exp(-dt / tau)' },
  { pattern: /Math\.(log|log2|log10|log1p)\b/, sample: 'const bits = Math.log2(n)' },
  { pattern: /Math\.(pow|hypot|cbrt)\b/, sample: 'const d = Math.hypot(dx, dz)' },
]

describe('simulation boundary', () => {
  it('scans every non-test simulation module -- a glob that stopped resolving would otherwise leave every check below vacuously green', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const scanned = Object.keys(sources).filter((path) => !path.endsWith('.test.ts'))

    // The kernel's own modules, spelled out: a glob that silently resolved to
    // an empty set (or to test files only) cannot satisfy this.
    expect(scanned).toEqual(expect.arrayContaining([...KERNEL_IDENTITY_FILES]))
    expect(scanned).toEqual(expect.arrayContaining(['./battle.ts', './series.ts', './random.ts', './fighters.ts']))
    for (const path of scanned) expect(sources[path].length).toBeGreaterThan(0)
  })

  it('every forbidden pattern still matches the call it is supposed to catch', () => {
    for (const { pattern, sample } of FORBIDDEN_PATTERNS) {
      expect(`${pattern} vs ${sample}: ${pattern.test(sample)}`).toBe(`${pattern} vs ${sample}: true`)
    }
  })

  it('does not import rendering, browser, content, or presentation modules, and calls no forbidden random/time/transcendental function', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const violations = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts'))
      .flatMap(([path, source]) => {
        const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        return FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(code)).map(({ pattern }) => `${path}: ${pattern}`)
      })
    expect(violations).toEqual([])
  })
})

// The collection-first encounter kernel never sees `home`/`away` duel
// identity: that's a series/presentation concept the two-ID adapter
// (`battle.ts`) maps onto sorted `CombatantId`s (see `encounter.ts`'s own
// header comment). This scan is deliberately narrower than the boundary scan
// above -- `battle.ts`, `series.ts`, and presentation legitimately use
// `FighterSide`/`'home'`/`'away'` as the duel-adapter/UI concept it is.
const KERNEL_IDENTITY_FILES: readonly string[] = ['./spatialHash.ts', './movement.ts', './combatActions.ts', './combatDecision.ts', './encounter.ts']
const KERNEL_IDENTITY_FORBIDDEN_PATTERNS: readonly RegExp[] = [/\bFighterSide\b/, /'home'/, /"home"/, /'away'/, /"away"/]

describe('kernel identity boundary', () => {
  it('spatialHash, movement, combatActions, combatDecision, and encounter never reference FighterSide or home/away identity', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const violations = KERNEL_IDENTITY_FILES.flatMap((path) => {
      const source = sources[path]
      if (source === undefined) throw new Error(`Kernel identity boundary check is missing expected file: ${path}`)
      const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
      return KERNEL_IDENTITY_FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(code)).map((pattern) => `${path}: ${pattern}`)
    })
    expect(violations).toEqual([])
  })
})