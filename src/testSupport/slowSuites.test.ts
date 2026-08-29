import { describe, expect, it } from 'vitest'
import { SLOW_E2E_SUITES, SLOW_UNIT_SUITES } from './slowSuites'

// The guard the split exists under, and the reason it reads the FILESYSTEM
// rather than a second list.
//
// `playwright.config.ts` records rejecting a two-project split on evidence: a
// dependent project is skipped when its dependency fails, and a 47-test
// acceptance set reported "1 did not run" instead of running. "A harness that
// silently does not run is the exact defect it exists to catch" is this
// repository's own sentence, and splitting a suite in two is the easiest way to
// reintroduce it — not by skipping this time, but by a file drifting out of
// both sets and being run by neither.
//
// A list checked against another list cannot catch that. A list checked against
// what is actually on disk can.
//
// `import.meta.glob` rather than `node:fs`: `src/` is compiled by the same
// tsconfig as the app and has no `@types/node`, so `readdirSync` and
// `__dirname` do not typecheck here. Vite resolves these patterns at transform
// time against the real tree, which is the same evidence for this purpose and
// costs nothing at runtime because nothing is imported — only the keys are read.

const unitFilesOnDisk = Object.keys(import.meta.glob('/src/**/*.test.ts')).map((path) => path.replace(/^\//, ''))
const e2eFilesOnDisk = Object.keys(import.meta.glob('/tests/**/*.spec.ts')).map((path) => path.replace(/^\//, ''))

describe('the fast/slow split covers every test file', () => {
  // Both halves of the same property, asserted separately so a failure says
  // which one broke: a file in neither set is never run at all, and a file in
  // both is run twice and pays its cost on the push path anyway.
  it.each([
    { kind: 'unit', onDisk: unitFilesOnDisk, slow: SLOW_UNIT_SUITES },
    { kind: 'e2e', onDisk: e2eFilesOnDisk, slow: SLOW_E2E_SUITES },
  ])('leaves no $kind file out of both sets', ({ onDisk, slow }) => {
    expect(onDisk.length).toBeGreaterThan(0)

    // Every named slow file must exist. A stale entry is how a set quietly
    // empties: the runner is asked for a file that is not there, matches
    // nothing, and reports a cheerful zero.
    for (const file of slow) expect(onDisk).toContain(file)

    // And the fast set is everything else, by construction rather than by a
    // list — which is what makes a newly added file run by default.
    const fast = onDisk.filter((file) => !slow.includes(file))
    expect([...fast, ...slow].sort()).toEqual([...onDisk].sort())
    expect(fast.filter((file) => slow.includes(file))).toEqual([])
  })

  // The list is the point. If it empties, the split has become "run everything
  // on the push path" and the hour is back without anything failing to say so.
  it('still names something slow in each runner', () => {
    expect(SLOW_UNIT_SUITES.length).toBeGreaterThan(0)
    expect(SLOW_E2E_SUITES.length).toBeGreaterThan(0)
  })

  // This file is fast, and must stay fast: a guard that only runs in the job it
  // is guarding against cannot report that the job was misconfigured.
  it('does not put itself in the slow set', () => {
    expect(SLOW_UNIT_SUITES).not.toContain('src/testSupport/slowSuites.test.ts')
  })
})
