import { configDefaults, defineConfig } from 'vitest/config'
import { SLOW_UNIT_SUITES } from './src/testSupport/slowSuites'

// Which files Vitest owns, anchored at the project root.
//
// This used to be a bare `src` positional on the `npm test` command line,
// which is a *substring match on the test file's path*, not a directory.
// Anything nested under the repository with `src` somewhere in its path
// therefore matched too -- and a git worktree in `.worktrees/` is exactly
// that. Two stale worktrees meant `npm test` ran the whole suite three
// times over, balance cohorts included, which is minutes per redundant
// copy and reports pass counts nobody can reconcile with the file list.
//
// Anchoring `include` here fixes it at the root instead of at the call
// site: a nested checkout cannot satisfy `src/**` relative to this
// config, whatever it is called or wherever it is created.
const INCLUDE = ['src/**/*.test.ts']
// Kept as a second, independent guard, because `include` alone is only as
// good as the next person's edit to it: Vitest's own default `include`
// would pick up `tests/*.spec.ts` (Playwright's, which need a browser and
// a server) and every nested copy of everything.
const EXCLUDE = [...configDefaults.exclude, '.worktrees/**']

// The three balance cohorts are 96% of the unit suite's wall clock; see
// `slowSuites.ts` for the per-file measurement and for what was deliberately
// not done to them (their seed counts are untouched).
//
// The two sets are declared here rather than on the command line, and `fast` is
// defined by EXCLUSION rather than by listing its members: a new test file
// joins `fast` automatically, and only a deliberate edit to `slowSuites.ts` can
// move one out of it. `slowSuites.test.ts` then checks that against the
// filesystem, so a file can never fall out of both.
//
// Both `include` and `exclude` are set on each project rather than at the root.
// Measured, not assumed: with them at the root and only `include` overridden
// per project, `vitest list --project slow` reported all 41 files instead of 3
// -- the root's `include` won, and a "slow" job would have quietly been the
// whole suite again.
export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'fast',
          include: INCLUDE,
          exclude: [...EXCLUDE, ...SLOW_UNIT_SUITES],
        },
      },
      {
        extends: true,
        test: {
          name: 'slow',
          include: [...SLOW_UNIT_SUITES],
          exclude: EXCLUDE,
        },
      },
    ],
  },
})
