import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  // Baselines are per-OS. Font rasterization, antialiasing and the WebGL
  // backend all differ between a developer's Windows machine and the Linux
  // runner CI uses: the planning snapshot alone measured ~2.2% differing
  // pixels across the two, which is far past any tolerance that still catches
  // a real pose regression. One shared baseline can therefore only ever be
  // green on the machine that captured it -- `{platform}` gives each OS its
  // own, and `npm run test:e2e:update` on that OS is what authors it.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  // A test run must never author a baseline. Playwright's own default
  // (`missing`) still writes any absent snapshot straight into
  // `tests/__screenshots__/` on a plain `npm run test:e2e` -- the run reports
  // that first write as a failure, but the file is on disk from then on, so
  // the very next run is green against a baseline nobody ever looked at.
  // `none` turns that into a plain failure with nothing written. Updating a
  // baseline stays possible and stays explicit: the `-u` on
  // `npm run test:e2e:update` overrides this (CLI beats config), and `-u`
  // without a mode means `changed`, i.e. it rewrites exactly the mismatching
  // baselines -- so always review each rewritten PNG before committing it.
  updateSnapshots: 'none',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      // Playwright's own per-pixel default, kept deliberately: raising it
      // was measured to be the wrong knob. At `threshold: 0.4` a baseline
      // swapped for a completely different frame of the same bout still
      // passed -- the fighters are low-contrast against the arena floor, so
      // "how different is this pixel" stops discriminating long before "how
      // many pixels moved" does.
      threshold: 0.2,
      // Both bounds below were measured on this suite rather than guessed,
      // at the default `threshold` above:
      //
      //   - the widest same-bout frame swap available -- opening separation
      //     against a clinch (`heavy-cleave` standing in for
      //     `combat-safe-frame`): 9.0% of the frame differs (an independent
      //     re-measurement by a reviewer got 8.0% for the same pair);
      //   - the same frame captured on two different machines running the
      //     same OS and the same Chromium: up to 2.5%. Chromium's software
      //     rasterizer picks SIMD paths from the host CPU, so identical 3D
      //     content shades slightly differently on a developer box and on a
      //     CI runner. Per-OS baselines (see `snapshotPathTemplate`) remove
      //     the font/AA half of this, not the WebGL half, and no capture
      //     machine can be pinned for every future runner.
      //
      // 4% was picked to sit between those two on the theory that the 9.0%
      // pair was the smallest real regression the bar had to catch. That
      // theory was wrong, and counterexamples existed in the tree when it was
      // written: 9.0% is the WIDEST frame swap available in this suite, not
      // the tightest, so the bar was calibrated on it backwards. All figures
      // below are this same comparator at this same `threshold: 0.2`, as a
      // ratio of a 1280x820 frame:
      //
      //   - against the *old* baselines, same-bout frame swaps the 4% bar
      //     passed: `fast-burst` vs `heavy-cleave` 1.85%, `technical-parry`
      //     vs `heavy-cleave` 1.44% -- literally two ticks of one bout;
      //   - against the baselines committed 2026-08-23 it is worse:
      //     `technical-parry` vs `heavy-cleave` 1.64%, `fast-burst` vs
      //     `heavy-cleave` 2.80%, `technical-parry` vs `fast-burst` 3.60%,
      //     and even `heavy-cleave` vs `combat-safe-frame` -- the same wide
      //     opening-vs-clinch pairing as the 9.0% figure above -- has fallen
      //     to 4.71%, barely over;
      //   - and this was not hypothetical: four baselines that were stale by
      //     a full slice of behaviour change (new silhouettes, new
      //     equipment, a re-framed camera) measured only 2.06-3.48%
      //     new-vs-old and passed this gate untouched -- `heavy-cleave`
      //     3.48% (36,547 px), `technical-parry` 2.73%, `fast-burst` 2.56%,
      //     `combat-outcomes` 2.06%. See the README's baseline-review note
      //     and `task-10-report.md`.
      //
      // So no bar in the 2.5-4% band can separate an accidental regression
      // from an ordinary frame of the same bout for these arena captures --
      // a per-pixel ratio is not the right instrument here. The correct fix
      // is a structural comparison (the arena debug snapshot already exposes
      // projected per-fighter bounds for exactly this purpose), not a
      // re-tuned ratio, and building that is deliberately left as its own
      // slice: this comment records that as a known gap, not a missed one.
      //
      // The two DOM-only captures do override it, deliberately and much
      // tighter: `planning.png` (`smoke.spec.ts`) and `season-board.png`
      // (`season.spec.ts`) both pass `maxDiffPixelRatio: 0.002`. They contain
      // no 3D at all and match exactly across machines on the same OS, and
      // 4% of those frames (~41,900 px) was measured wide enough to swallow
      // two whole new roster cards -- which it did, silently, until a review
      // caught the stale baseline. Each override carries that reasoning at
      // its own call site.
      maxDiffPixelRatio: 0.04,
    },
  },
  // One worker, deliberately, and measured rather than assumed.
  //
  // `tests/legibility.spec.ts` (the slice's legibility acceptance harness)
  // drives 45 full bouts, each stepping and rendering 1200-2700 ticks through
  // Chromium's software rasterizer -- which is itself multi-threaded, so that
  // one worker saturates every core for 11-13 minutes. Run concurrently, the
  // other five spec files then blow Playwright's default 30 s per-test timeout
  // while nothing has regressed, and `npm run check` (a bare `playwright test`)
  // becomes a coin flip. Measured on a 16-core machine, same commit:
  //
  //   default workers  ->  3 deliberate failures + 7 spurious timeouts, 14.6 min
  //   default workers  ->  3 deliberate failures + 2 spurious timeouts, 13.4 min
  //   workers: 1       ->  3 deliberate failures, nothing else,         12.5 min
  //
  // So serialising is both cleaner AND faster on the gate path: the heavy file
  // dominates the wall clock either way, and the five fast files cost ~1 min of
  // it. The price is paid by single-file runs of the fast specs, which lose
  // their own parallelism (~1 min -> ~3 min); `--workers=8` on the command line
  // overrides this for that case, and cannot make the full run flaky because
  // the full run is what this setting is for.
  //
  // A two-project split (`legibility` with `dependencies: ['chromium']`) was
  // tried first and REJECTED on evidence: Playwright skips a dependent project
  // when its dependency has any failure, and this suite deliberately carries
  // three stale screenshot baselines until Task 10 regenerates them, so the
  // whole 47-test acceptance set reported `1 did not run` instead of running.
  // A harness that silently does not run is the exact defect it exists to
  // catch. (Dependency projects also ignore `--grep`, so every `-g` run of one
  // legibility test would first replay the entire fast suite.)
  workers: 1,
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
