import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
  test: {
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
    include: ['src/**/*.test.ts'],
    // Kept as a second, independent guard, because `include` alone is only as
    // good as the next person's edit to it: Vitest's own default `include`
    // would pick up `tests/*.spec.ts` (Playwright's, which need a browser and
    // a server) and every nested copy of everything.
    exclude: [...configDefaults.exclude, '.worktrees/**'],
  },
})
