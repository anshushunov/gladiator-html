import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    colorScheme: 'dark',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      maxDiffPixelRatio: 0.05,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
