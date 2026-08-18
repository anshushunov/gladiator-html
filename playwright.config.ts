import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
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
      // 0.005 of the 1280x820 capture is ~2,624 pixels. The previous 0.05
      // (~52,480 pixels, a 229x229 block -- wider than a fighter silhouette)
      // was loose enough to be no baseline at all: swapping
      // `combat-safe-frame.png`'s baseline for the completely different
      // `heavy-cleave.png` frame still passed. Every screenshot here is
      // captured paused, at a fixed tick and a fixed alpha, so there is no
      // animation jitter for a wide tolerance to absorb.
      maxDiffPixelRatio: 0.005,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
