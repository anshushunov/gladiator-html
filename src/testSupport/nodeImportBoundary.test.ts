/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest'

// `@types/node` is installed project-wide (`fighterModelContract.test.ts`'s
// GLB reader needs it), and a single `tsconfig.json` with no `types`
// restriction makes its ambient globals (`process`, `Buffer`) and `node:*`
// module declarations visible to every file under `src/`, not just test
// files. That used to be a compiler error -- `node:fs` and `process` were
// plain type errors anywhere under `src/` before @types/node existed -- so
// the compiler can no longer catch a browser module reaching for Node. This
// test restores the guarantee structurally instead: every non-test module
// under `src/` is scanned for a Node built-in import or a bare `process`
// reference, and none may have either.
const FORBIDDEN_PATTERNS: readonly { pattern: RegExp; sample: string }[] = [
  { pattern: /from ['"]node:[^'"]+['"]/, sample: "import { readFileSync } from 'node:fs'" },
  { pattern: /require\(['"]node:[^'"]+['"]\)/, sample: "const fs = require('node:fs')" },
  { pattern: /from ['"](fs|path|os|child_process|url)['"]/, sample: "import { readFileSync } from 'fs'" },
  { pattern: /require\(['"](fs|path|os|child_process|url)['"]\)/, sample: "const fs = require('fs')" },
  { pattern: /\bprocess\b/, sample: 'process.cwd()' },
]

describe('node import boundary', () => {
  it('scans every non-test src module -- a glob that stopped resolving would otherwise leave the check below vacuously green', () => {
    const sources = import.meta.glob('/src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const scanned = Object.keys(sources).filter((path) => !path.endsWith('.test.ts'))
    expect(scanned.length).toBeGreaterThan(30)
    for (const path of scanned) expect(sources[path].length).toBeGreaterThan(0)
  })

  it('every forbidden pattern still matches the call it is supposed to catch', () => {
    for (const { pattern, sample } of FORBIDDEN_PATTERNS) {
      expect(`${pattern} vs ${sample}: ${pattern.test(sample)}`).toBe(`${pattern} vs ${sample}: true`)
    }
  })

  it('no non-test module under src/ imports a Node built-in or reads the process global', () => {
    const sources = import.meta.glob('/src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    const violations = Object.entries(sources)
      .filter(([path]) => !path.endsWith('.test.ts'))
      .flatMap(([path, source]) => {
        const code = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '')
        return FORBIDDEN_PATTERNS.filter(({ pattern }) => pattern.test(code)).map(({ pattern }) => `${path}: ${pattern}`)
      })
    expect(violations).toEqual([])
  })
})
