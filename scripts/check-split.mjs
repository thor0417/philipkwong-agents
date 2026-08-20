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
import { readdirSync, readFileSync, statSync } from 'node:fs';
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
