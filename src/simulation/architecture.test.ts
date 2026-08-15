/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'

describe('simulation boundary', () => {
  it('does not import rendering or browser APIs', () => {
    const sources = import.meta.glob('./**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const violations = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts'))
      .flatMap(([path, source]) => {
        const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        return [/from ['"]three['"]/, /\bdocument\b/, /\bwindow\b/, /\bHTMLElement\b/, /\bcrypto\b/, /Math\.random/]
          .filter((pattern) => pattern.test(code))
          .map((pattern) => `${path}: ${pattern}`)
      })
    expect(violations).toEqual([])
  })
})