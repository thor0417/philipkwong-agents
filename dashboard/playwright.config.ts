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

// ---- THE FOUR AUDITS THAT SHARE ONE CLIENT'S STORED STATE -------------------
//
// membership.audit CONFIRMS and EXCLUDES rows in client_projects through the
// register, client-scope.audit UPSERTS one and reads client_scopes back to
// prove the composer did not write to it, scope-match.audit REWRITES that
// client's markets four times, and report-scope.audit asserts that the
// composer's count EQUALS what those two tables say. All four are Simtec
// Attractions: the rail orders clients by name and membership.audit takes the
// last one.
//
// Every one of them restores what it changed, which is enough when they run one
// after another and worth nothing when they run at the same time. Run
// concurrently, report-scope reads a membership row mid-toggle or a scope
// mid-override and fails an equality that is true of the product, and
// client-scope's "a narrowing that does not write back" reads back the markets
// scope-match is holding.
//
// SERIALISING THE SUITE WOULD FIX THAT BY SLOWING EVERY RUN. Playwright orders
// PROJECTS through `dependencies`, so each of these four gets a project of its
// own and depends on the one before it. The four never overlap; nothing else in
// the suite is ordered at all, and the ordering holds at any worker count.
//
// THE COST, STATED: a failure in one skips the rest of the chain. Skipped is
// reported as skipped and not as passed, so it cannot make a run falsely green,
// but a red membership.audit stops telling you anything about the other three.
const CLIENT_STATE_CHAIN = [
  'membership.audit.ts',
  'client-scope.audit.ts',
  'scope-match.audit.ts',
  'report-scope.audit.ts',
];

// One capture setting, now read by five projects instead of one.
const WALKTHROUGH_USE = {
  ...devices['Desktop Chrome'],
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: 'light' as const,
  storageState: 'e2e/.auth/state.json',
};

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
    // Documentation captures and the filter audit. 1920x1080 light, one pass:
    // these are for a person to read, not a regression baseline, so they are
    // deliberately not duplicated into dark.
    {
      name: 'walkthrough',
      dependencies: ['setup'],
      testMatch: /\.(walk|audit)\.ts/,
      // Held out of this project and given one each of their own below.
      testIgnore: CLIENT_STATE_CHAIN.map((f) => `**/${f}`),
      use: WALKTHROUGH_USE,
    },
    // ONE PROJECT PER CONTENDING FILE, CHAINED. A project does not start until
    // every project it depends on has finished, so this says "these four never
    // overlap" and says nothing wider: every other audit, walk and shot still
    // runs in parallel beside them.
    //
    // ONE GOTCHA: `--project=report-scope` now runs the three projects it
    // depends on as well, because that is what a dependency means. A file
    // filter - `npx playwright test e2e/report-scope.audit.ts` - does not,
    // since the filter empties the dependency projects too.
    ...CLIENT_STATE_CHAIN.map((file, i) => ({
      name: file.replace('.audit.ts', ''),
      dependencies: [i === 0 ? 'setup' : CLIENT_STATE_CHAIN[i - 1].replace('.audit.ts', '')],
      testMatch: `**/${file}`,
      use: WALKTHROUGH_USE,
    })),
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
