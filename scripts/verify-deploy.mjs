// BUILD THE DASHBOARD THE WAY VERCEL BUILDS IT.
//
//     npm run verify:deploy
//
// NOT IN A HOOK, AND IT NEVER DELETES THE ROOT node_modules. It checks HEAD out
// into a scratch directory OUTSIDE the repo, where no parent
// node_modules exists to fall back on, then installs from dashboard/package.json
// alone and runs the real `next build`. Any import that reaches out of the
// dashboard for a dependency fails there exactly as it fails on Vercel.
//
// WHY THIS EXISTS. `cd dashboard && npm run build` in the gate resolves through
// the repo root's node_modules, which Vercel never creates when the project's
// root directory is dashboard/. The gate was therefore green on a tree that
// could not deploy, twice. check-split.mjs forbids the import shape in
// milliseconds and runs on every push; this reproduces the actual install and is
// run deliberately before a release, because it costs a full npm install.
//
// THE CHECKOUT CARRIES NO node_modules, and that is the point: carrying one
// would bring the root's resolution with it and prove nothing.
import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = process.cwd();
const DASH = path.join(ROOT, 'dashboard');
if (!existsSync(path.join(DASH, 'package.json'))) {
  console.error('run this from the repo root; dashboard/package.json not found');
  process.exit(1);
}

const scratch = mkdtempSync(path.join(tmpdir(), 'pk-deploy-'));
let target;

// ---- SEEDED FROM GIT, NOT FROM THE WORKING TREE ---------------------------
//
// THE DEFECT THIS CHANGE EXISTS FOR, 2026-08-29. This script used to cpSync
// dashboard/ and the root lib/ out of the WORKING TREE. lib/source-health.ts was
// written, imported by three committed files, and never git added - so the copy
// picked it up off disk, the scratch build passed, and this script reported
// "the dashboard builds from its own package.json alone" about a commit that
// could not be built from a clone at all. Vercel does a git clone:
//
//     ./lib/report-build.ts
//     Module not found: Can't resolve '../../lib/source-health'
//
// A check that copies the working tree can never see a missing file, because
// the thing it is looking for is exactly the thing the copy supplies. The only
// way to ask "would a fresh clone build" is to build a fresh clone, so the
// scratch tree now comes from `git archive HEAD` and contains committed content
// and nothing else. An uncommitted change is invisible to it BY DESIGN - that is
// the whole point, and it is why this is run before a release rather than
// during editing.
// git worktree rather than `git archive | tar`: tar on Windows reads a C:\ path
// as a remote host and dies with "Cannot connect to C: resolve failed". A
// worktree is git-native, needs no external tool, and checks out HEAD exactly.
console.log(`checking HEAD out to ${scratch} (committed content only, not the working tree)`);
const head = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
const repo = path.join(scratch, 'repo');
execFileSync('git', ['worktree', 'add', '--detach', repo, 'HEAD'], { cwd: ROOT, stdio: 'inherit' });
console.log(`  checked out ${head}`);

// A DIRTY TREE IS REPORTED, NOT REFUSED. What is being tested is HEAD, so an
// uncommitted change simply is not in it; saying so out loud stops this reading
// as a verdict on the working copy.
const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean);
if (dirty.length) {
  console.log(`  NOTE: ${dirty.length} uncommitted change(s) in the working tree are NOT in this build.`);
}

target = path.join(repo, 'dashboard');

// ---- ENVIRONMENT IS SUPPLIED, CODE IS NOT ---------------------------------
//
// .env.local is gitignored and must stay that way, so a checkout of HEAD has no
// Supabase keys and `next build` fails prerendering every page with "Missing
// NEXT_PUBLIC_SUPABASE_URL". That is a fact about this harness, not about the
// deploy: on Vercel the same values arrive as project environment variables.
//
// So the env file is copied in and NOTHING ELSE IS. The distinction is the whole
// point of the rewrite - code must come from git, because "is this file
// committed" is the question being asked; configuration must come from outside
// git, because it is never committed anywhere.
const envFile = path.join(DASH, '.env.local');
if (existsSync(envFile)) {
  copyFileSync(envFile, path.join(target, '.env.local'));
  console.log('  supplied dashboard/.env.local (configuration, never code)');
} else {
  console.log('  NOTE: no dashboard/.env.local; prerendering will fail on missing Supabase keys.');
}

if (!existsSync(path.join(target, 'package.json'))) {
  console.error('\ndashboard/package.json is not in HEAD. Nothing to build.');
  try { execFileSync('git', ['worktree', 'remove', '--force', repo], { cwd: ROOT }); } catch {}
  rmSync(scratch, { recursive: true, force: true });
  process.exit(1);
}

// THE SANCTIONED CROSSINGS COME WITH IT. next.config externalDir lets
// dashboard/lib import a handful of import-free files at the repo root, and a
// tree without them cannot build. git archive brings the whole repo, so they
// land at the SAME relative position and the ../../ paths resolve - and if one
// of them is not committed, the build fails here exactly as it would on Vercel.
// See scripts/check-split.mjs, which catches the same shape faster.

const run = (cmd, args) => {
  console.log(`\n> ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { cwd: target, stdio: 'inherit', shell: process.platform === 'win32' });
};

let code = 0;
try {
  // npm ci if there is a lockfile, npm install otherwise. Either way ONLY
  // dashboard/package.json is consulted, which is the whole point.
  run('npm', [existsSync(path.join(target, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund']);
  run('npx', ['next', 'build']);
  console.log('\nverify:deploy PASSED. The dashboard builds from its own package.json alone.');
} catch (e) {
  code = 1;
  console.error('\nverify:deploy FAILED. This is what Vercel will do.');
  console.error(String(e.message).slice(0, 300));
} finally {
  if (code === 0) {
    try { execFileSync('git', ['worktree', 'remove', '--force', repo], { cwd: ROOT }); } catch {}
    rmSync(scratch, { recursive: true, force: true });
  } else {
    // Left in place on failure so the tree can be inspected. It is a registered
    // worktree, so reclaim it afterwards with `git worktree prune`.
    console.error(`\nthe failing checkout is at ${target}`);
    console.error('when you have finished with it:  git worktree prune');
  }
}
process.exit(code);
