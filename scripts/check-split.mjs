// NO FILE UNDER dashboard/ REACHES OUT OF THE DASHBOARD FOR A DEPENDENCY.
//
//     node scripts/check-split.mjs
//
// THE DEFECT THIS EXISTS FOR. A diagnostic was moved into dashboard/scripts/ so
// it could import dashboard/lib/report-model. It also imported
// lib/supabase-admin from the repo root. NOTHING imported the diagnostic - not a
// page, not a route, not middleware - but dashboard/tsconfig.json includes
// **/*.ts and `next build` typechecks the whole include set rather than the
// module graph, so the file entered the dashboard's program anyway.
//
// lib/supabase-admin.ts lives at the repo root and therefore resolves
// @supabase/supabase-js out of the ROOT node_modules. Locally that exists. On
// Vercel the root directory is dashboard/ and only dashboard/package.json is
// installed, so the root node_modules never exists:
//
//     ../lib/supabase-admin.ts:5:30
//     Cannot find module '@supabase/supabase-js'
//
// THE GATE COULD NOT EXPRESS IT. `cd dashboard && npm run build` reuses a root
// node_modules that Vercel will never create, so the gate was green on a tree
// that could not deploy. This is the cheap half of the answer: it does not
// reproduce Vercel's install, it forbids the one import shape that has ever
// caused the divergence. `npm run verify:deploy` is the thorough half and is a
// separate command on purpose.
//
// THE ASYMMETRY IT ENFORCES, from CLAUDE.md:
//
//   dashboard -> agents   SANCTIONED via next.config externalDir, and ONLY for
//                         files that import nothing themselves. An import-free
//                         file needs no resolution, so it cannot reach for a
//                         node_modules that is not there.
//   agents -> dashboard   NEVER reachable from a build. Command line only, run
//                         with tsx, excluded from the root tsconfig by name.
//
// IT RESOLVES THE PATH RATHER THAN MATCHING THE TEXT. A first cut grepped for
// '../../' and flagged 28 innocent lines: '../../clients/page.module.css' never
// leaves the dashboard, and deeper files legitimately write '../../../../'. The
// only correct test is whether the RESOLVED path is inside dashboard/.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = process.cwd();
const DASH = path.join(ROOT, 'dashboard');

// Import-free files, verified by inspection. Adding to this list means opening
// the file and confirming it imports nothing - not that it currently happens to
// build.
const SANCTIONED = new Set([
  'lib/dead-feeds.ts',
  'lib/coverage.ts',
  'lib/degraded-sources.ts',
  'lib/corpus-scope.ts',
  'agents/scraper/project-summary.ts',
  'agents/scraper/press-facts.ts',
  // The host rules. One list of "never capture" and one of "capture, never cite",
  // read by the capture lane AND by the referral brief. Two copies is how the
  // two halves come to disagree about what a client may be shown.
  'agents/scraper/junk-domains.ts',
  // WHAT COVERED MEANS. The four criteria, the markets declared to reach them,
  // and the two sentences a document prints about a market that does not. Read
  // by verify-market-standard in agents/ AND by the coverage note in
  // report-sections, which is the point: a second copy is how a document comes
  // to tell a client we do not read something the publisher never printed.
  // Verified import-free by inspection on 2026-08-25.
  'lib/market-standard.ts',
  // WHOSE PRODUCT THIS IS. One string, read by the composer that puts it on a
  // cover and by the diagnostic that audits what already went out. A second
  // copy is how the printed brand and the audited brand come to disagree.
  // Verified import-free by inspection on 2026-08-29.
  'lib/operator.ts',
  // WHAT THE LIVE PIPELINE IS CALLED. The dashboard used to declare its own
  // hardcoded 'gli' while the agent side derived it, so the two packages could
  // disagree about the name of the thing a client's register is scoped to - and
  // only one of them deploys. Verified import-free by inspection on 2026-08-29.
  'lib/pipeline-id.ts',
  // WHAT THE LAST RUN CAPTURED, PER MARKET. Read by the government lane that
  // writes it and by the coverage note that prints it. Verified import-free by
  // inspection on 2026-08-25.
  'lib/source-health.ts',
]);

// Build output and dependencies are not source.
const SKIP_DIR = new Set(['node_modules', '.next', 'test-results', 'playwright-report']);

function* walk(dir) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (SKIP_DIR.has(e.name)) continue;
      yield* walk(path.join(dir, e.name));
    } else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) {
      yield path.join(dir, e.name);
    }
  }
}

const IMPORT = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s+['"](\.[^'"]+)['"]/g;

const offences = [];
for (const file of walk(DASH)) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(IMPORT)) {
    const spec = m[1];
    const resolved = path.resolve(path.dirname(file), spec);
    if (resolved.startsWith(DASH + path.sep) || resolved === DASH) continue;
    // Outside the dashboard. Allowed only if it names a sanctioned import-free
    // file. Compared with the extension appended, since specifiers omit it.
    const rel = path.relative(ROOT, resolved).split(path.sep).join('/');
    if (SANCTIONED.has(`${rel}.ts`) || SANCTIONED.has(rel)) continue;
    offences.push({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      spec,
      resolved: rel,
    });
  }
}

if (offences.length) {
  console.log('');
  console.log('  ####################################################################');
  console.log('  #  A FILE UNDER dashboard/ IMPORTS OUT OF THE DASHBOARD.           #');
  console.log('  #                                                                  #');
  console.log('  #  Vercel installs only dashboard/package.json. A file at the repo #');
  console.log('  #  root resolves its dependencies from the ROOT node_modules,      #');
  console.log('  #  which does not exist there, so this builds locally and fails on #');
  console.log('  #  deploy. That has happened once and cost two red deploys.        #');
  console.log('  #                                                                  #');
  console.log('  #  Either it belongs INSIDE dashboard/ with its dependency in      #');
  console.log('  #  dashboard/package.json, or it belongs under agents/ and is run  #');
  console.log('  #  with tsx from the command line.                                 #');
  console.log('  ####################################################################');
  console.log('');
  for (const o of offences) console.log(`    ${o.file}\n        imports ${o.spec}  ->  ${o.resolved}`);
  console.log('');
  console.log('  Sanctioned crossings, import-free files only:');
  for (const s of SANCTIONED) console.log(`    ${s}`);
  process.exit(1);
}

console.log('  split check ok: no dashboard file reaches out of the dashboard');

// ---------------------------------------------------------------------------
// AND: NO TRACKED FILE IMPORTS AN UNTRACKED ONE.
//
// THE DEFECT THIS EXISTS FOR, 2026-08-29. lib/source-health.ts was written,
// imported by dashboard/lib/report-build.ts, report-sections.ts and
// verify-golden.ts, sanctioned in the list above - and never git added. Every
// local check passed, because every local check reads the WORKING TREE and the
// file is sitting in it:
//
//   tsc --noEmit          ok      reads the working tree
//   next build            ok      reads the working tree
//   the whole Playwright suite    ok, 74 tests, against a server built from it
//   npm run verify:deploy ok      it COPIES dashboard/ out of the working tree,
//                                 so the file it needs travels with the copy
//
// Vercel does a git clone. The file was not in the clone:
//
//   ./lib/report-build.ts
//   Module not found: Can't resolve '../../lib/source-health'
//   Error: Command "npm run build" exited with 1
//
// So the production deploy failed on a commit that had passed a green gate four
// times, and the register stayed empty for the length of it.
//
// verify:deploy is the thorough half of the split guard and it CANNOT catch
// this: it proves the dashboard builds from its own package.json, and it does
// that by copying the working tree. Only git can answer "would a fresh clone
// have this file", so only a check that asks git can see the gap.
const trackedList = execSync('git ls-files', { encoding: 'utf8', maxBuffer: 1 << 28 })
  .split('\n')
  .filter(Boolean);
const tracked = new Set(trackedList);

const untracked = [];
for (const file of trackedList) {
  if (!/\.(ts|tsx|mts|cts)$/.test(file)) continue;
  if (file.startsWith('node_modules')) continue;
  let src;
  try {
    src = readFileSync(path.join(ROOT, file), 'utf8');
  } catch {
    continue;
  }
  for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
    const spec = m[1];
    const abs = path.resolve(path.dirname(path.join(ROOT, file)), spec);
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const candidates = [`${rel}.ts`, `${rel}.tsx`, `${rel}.d.ts`, `${rel}/index.ts`, `${rel}/index.tsx`, rel];
    if (candidates.some((c) => tracked.has(c))) continue;
    const onDisk = candidates.find((c) => existsSync(path.join(ROOT, c)));
    untracked.push({ file, spec, resolved: onDisk ?? rel, exists: !!onDisk });
  }
}

if (untracked.length) {
  console.log('');
  console.log('  ####################################################################');
  console.log('  #  A COMMITTED FILE IMPORTS A FILE THAT IS NOT COMMITTED.          #');
  console.log('  #                                                                  #');
  console.log('  #  It builds here because the file is in your working tree. It     #');
  console.log('  #  will not build from a fresh clone, which is what Vercel does,    #');
  console.log('  #  so this is green locally and a red deploy. It has happened once  #');
  console.log('  #  and it took production down while every gate stayed green.       #');
  console.log('  #                                                                  #');
  console.log('  #  git add the file, or remove the import.                          #');
  console.log('  ####################################################################');
  console.log('');
  for (const u of [...new Map(untracked.map((u) => [`${u.file}|${u.spec}`, u])).values()]) {
    console.log(`    ${u.file}`);
    console.log(`        imports ${u.spec}  ->  ${u.resolved}`);
    console.log(`        ${u.exists ? 'EXISTS ON DISK, NOT IN GIT' : 'MISSING ENTIRELY'}`);
  }
  console.log('');
  process.exit(1);
}

console.log('  split check ok: every import a committed file makes is also committed');

