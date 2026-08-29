// Which test files are slow enough to keep off the push path, in one list that
// both runners and the guard test read.
//
// ---------------------------------------------------------------------------
// WHY THIS EXISTS, IN NUMBERS
// ---------------------------------------------------------------------------
//
// Measured on the murmillo-pin merge commit, per file, on a 16-core machine:
//
//   src/simulation/dispositionBalance.test.ts    550 s
//   src/simulation/seasonBalance.test.ts         540 s
//   src/simulation/balance.test.ts               192 s
//   the other 38 unit-test files, TOGETHER        48 s
//
//   tests/legibility.spec.ts                    12.1 min
//   the other 5 e2e spec files, TOGETHER         ~1.1 min
//
// Four files are roughly 95% of a CI run that took over an hour. Nothing about
// them is wrong: three are Monte-Carlo balance cohorts at 200 and 500 seeds,
// and the fourth drives nine full bouts through a software rasterizer measuring
// on-screen fighter height every tick. They are simply not what a push should
// wait for.
//
// ---------------------------------------------------------------------------
// WHAT WAS DELIBERATELY NOT DONE
// ---------------------------------------------------------------------------
//
// The seed counts are untouched. Cutting 200 and 500 down to 50 and 100 is four
// times faster and is the wrong lever: those cohorts are how a balance
// regression is caught at all, and this repository has already had a threshold
// sitting 0.22 sigma above its baseline flip on a re-run with no code change.
// A band measured on a quarter of the sample is a band that reports noise. The
// files keep their power; only their schedule changes.
//
// ---------------------------------------------------------------------------
// THE FAILURE MODE THIS IS BUILT AGAINST
// ---------------------------------------------------------------------------
//
// A harness that silently does not run. `playwright.config.ts` records
// rejecting a two-project split for exactly that: a dependent project is
// SKIPPED when its dependency fails, and a 47-test acceptance set reported
// "1 did not run" instead of running.
//
// So the split here is two independent invocations rather than a dependency,
// and `slowSuites.test.ts` asserts against the FILESYSTEM that fast plus slow
// equals every test file that exists, with no overlap. A file added later
// cannot quietly belong to neither set: it lands in fast by default, and if
// someone means it to be slow they have to say so here.

/** Unit-test files (Vitest) kept off the push path. Paths are relative to the repository root, POSIX-separated. */
export const SLOW_UNIT_SUITES: readonly string[] = [
  'src/simulation/balance.test.ts',
  'src/simulation/dispositionBalance.test.ts',
  'src/simulation/seasonBalance.test.ts',
]

/** End-to-end spec files (Playwright) kept off the push path. */
export const SLOW_E2E_SUITES: readonly string[] = ['tests/legibility.spec.ts']

/**
 * Vitest and Playwright both want glob-ish patterns rather than plain paths,
 * and both configs must derive them from the lists above rather than restating
 * them — a second copy of a list is a second thing to forget to update.
 */
export const slowUnitPatterns = (): string[] => SLOW_UNIT_SUITES.map((file) => `**/${file.split('/').pop() ?? file}`)
