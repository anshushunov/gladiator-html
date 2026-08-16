/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'

// Every pattern `src/simulation/**` (excluding tests) must never match. The
// file list itself comes from `import.meta.glob`, so a new simulation module
// added by a later task is scanned automatically without editing this list.
const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  // Rendering/DOM/browser/audio.
  /from ['"]three['"]/,
  /\bdocument\b/,
  /\bwindow\b/,
  /\bHTMLElement\b/,
  /\bAudioContext\b/,
  // Content/presentation modules: simulation takes content as plain data
  // parameters, it never imports the content or presentation directories.
  /from ['"][^'"]*\/content\//,
  /from ['"][^'"]*\/presentation\//,
  // Non-deterministic sources: Math.random, Web Crypto, and wall-clock time.
  /Math\.random/,
  /\bcrypto\b/,
  /Date\.now/,
  /performance\.now/,
  // Runtime trigonometry/transcendentals. Simulation may use Math.sqrt for
  // normalization but authored sine/cosine literals stand in for everything
  // else; see movement.ts's turnFacing.
  /Math\.(sin|cos|tan|asin|acos|atan2?|pow|hypot)\b/,
]

describe('simulation boundary', () => {
  it('does not import rendering, browser, content, or presentation modules, and calls no forbidden random/time/trigonometric function', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const violations = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts'))
      .flatMap(([path, source]) => {
        const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        return FORBIDDEN_PATTERNS.filter((pattern) => pattern.test(code)).map((pattern) => `${path}: ${pattern}`)
      })
    expect(violations).toEqual([])
  })
})