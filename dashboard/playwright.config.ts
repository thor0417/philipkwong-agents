// SCREENSHOT HARNESS. Not a test suite; a camera.
//
// This exists because "done means seen" is a rule on this project and there is
// no other way to see the product. Playwright is headless and logic-only: it
// ships no styling, no components and no theme, and it is a devDependency that
// application code never imports.
//
// Two projects, light and dark, both authenticated. Capturing only light would
// mean the dark palette shipped unlooked-at, which is exactly the retrofit the
// design system was written to avoid.

import { defineConfig, devices } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './e2e',
  // Sequential. These share one authenticated account and one dev server, and a
  // parallel run just produces torn screenshots.
  workers: 1,
  fullyParallel: false,
  // A cold Next dev compile of a route it has never served can genuinely take
  // 15s+, and the first route after `npm run clean` is compiling the whole app
  // from nothing. The per-locator waits below must stay UNDER this number: a
  // locator timeout longer than the test timeout never fires, and the failure
  // surfaces as an unexplained "test timeout" instead of the thing that was
  // actually missing.
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [['list']],

  use: {
    baseURL: BASE_URL,
    // 1440x900 is the demo machine, not a phone and not a 4K panel. The shell is
    // designed against this width.
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2, // hairlines are 0.5px; at 1x they round away entirely
    actionTimeout: 15_000,
  },

  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'light',
      dependencies: ['setup'],
      testMatch: /\.shots\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'light',
        storageState: 'e2e/.auth/state.json',
      },
    },
    {
      name: 'dark',
      dependencies: ['setup'],
      testMatch: /\.shots\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        colorScheme: 'dark',
        storageState: 'e2e/.auth/state.json',
      },
    },
  ],

  // Reuses a dev server if one is already up, so an interactive session and a
  // capture run do not fight over port 3000.
  webServer: {
    command: 'npm run dev',
    url: BASE_URL,
    reuseExistingServer: true,
    // `npm run verify` deletes .next immediately before this, so the dev server
    // is starting from nothing every time. 120s was not enough.
    timeout: 240_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
