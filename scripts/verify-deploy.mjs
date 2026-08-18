// BUILD THE DASHBOARD THE WAY VERCEL BUILDS IT.
//
//     npm run verify:deploy
//
// NOT IN A HOOK, AND IT NEVER DELETES THE ROOT node_modules. It copies the
// dashboard into a scratch directory OUTSIDE the repo, where no parent
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
// THE COPY EXCLUDES node_modules, .next AND test-results. Copying node_modules
// would defeat the entire point by carrying the root's resolution with it.
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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
const target = path.join(scratch, 'dashboard');
console.log(`copying dashboard/ to ${target}`);

const SKIP = new Set(['node_modules', '.next', 'test-results', 'playwright-report']);
cpSync(DASH, target, {
  recursive: true,
  filter: (src) => !SKIP.has(path.basename(src)),
});

// THE SANCTIONED CROSSINGS STILL HAVE TO BE THERE. next.config externalDir lets
// dashboard/lib import a handful of import-free files at the repo root, and a
// copy without them cannot build. They are copied to the SAME relative position
// so the ../../ paths resolve, and because they import nothing they drag no
// dependency with them - which is exactly why only import-free files may be
// sanctioned. See scripts/check-split.mjs.
for (const rel of ['lib', 'agents/scraper']) {
  const from = path.join(ROOT, rel);
  if (!existsSync(from)) continue;
  const to = path.join(scratch, rel);
  cpSync(from, to, { recursive: true, filter: (src) => !SKIP.has(path.basename(src)) });
}

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
  // The scratch copy is left on failure so the tree can be inspected.
  if (code === 0) rmSync(scratch, { recursive: true, force: true });
  else console.error(`\nthe failing copy is at ${target}`);
}
process.exit(code);
