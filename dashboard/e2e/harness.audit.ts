// THE HARNESS DOES NOT SABOTAGE THE SERVER IT TESTS.
//
// `npm run verify` used to run: typecheck -> build -> clean -> shots, where
// `clean` DELETES .next. Playwright reuses an existing server, and that server
// serves out of the .next that had just been removed. Whatever it had already
// loaded kept working and anything it needed afterwards did not, so the suite
// failed one or two tests at a time, on a different test each run, with errors
// that read exactly like product defects: a page with no <header>, a register
// with no rows, a button that would not toggle back.
//
// It cost two full push cycles and a wrong diagnosis - the W double-press was
// blamed on a stale-read race in the mutation, which is a real narrow window and
// was NOT what broke that run.
//
// So the order is asserted rather than remembered. This is a unit check on the
// package script; it needs no server and no database.

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';

test('verify never deletes .next before running the suite', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    scripts: Record<string, string>;
  };
  const verify = pkg.scripts.verify ?? '';
  expect(verify, 'package.json has no verify script').not.toBe('');

  const steps = verify.split('&&').map((s) => s.trim());
  const clean = steps.findIndex((s) => s.includes('clean'));
  const shots = steps.findIndex((s) => s.includes('shots'));

  expect(shots, 'verify does not run the Playwright suite at all').toBeGreaterThan(-1);
  if (clean === -1) return; // no clean step is fine; deleting it early is not.

  expect(
    clean,
    'verify deletes .next BEFORE running the suite, so every test runs against a ' +
      'server whose build has been removed from disk. Move clean after shots.'
  ).toBeGreaterThan(shots);
});
