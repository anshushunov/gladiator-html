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
      //   - a baseline swapped for a different frame of the same bout
      //     (`heavy-cleave` standing in for `combat-safe-frame`): 9.0% of
      //     the frame differs -- this is the smallest real regression the
      //     bar has to catch, since two ticks of one bout look far more
      //     alike than any accidental change would;
      //   - the same frame captured on two different machines running the
      //     same OS and the same Chromium: up to 2.5%. Chromium's software
      //     rasterizer picks SIMD paths from the host CPU, so identical 3D
      //     content shades slightly differently on a developer box and on a
      //     CI runner. Per-OS baselines (see `snapshotPathTemplate`) remove
      //     the font/AA half of this, not the WebGL half, and no capture
      //     machine can be pinned for every future runner.
      //
      // 4% sits between them with room on both sides. The DOM-only planning
      // snapshot has no 3D in it and matches exactly across machines; it is
      // held to the same number only because a shared config is simpler than
      // a per-test override that would drift.
      maxDiffPixelRatio: 0.04,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
