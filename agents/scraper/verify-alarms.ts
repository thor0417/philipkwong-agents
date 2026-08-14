// THE ALARMS STILL FIRE, DEMONSTRATED RATHER THAN ASSERTED.
//
//   npm run verify:alarms
//
// Sentry was removed because the trial lapsed and there is one operator, so an
// unseen error is not this system's failure mode. What IS its failure mode is a
// lane that reports success and writes nothing, and that alarm has been wrong
// once before - the guard was inverted, so a total death returned early and Las
// Vegas went dead unnoticed for weeks.
//
// Removing the transport under an alarm with that history, without showing the
// alarm still fires, would be the same mistake in a new place. So this file
// drives reportRunHealth with recorded runs that force each verdict, and reads
// what an operator would actually see.
//
// IT RUNS ITSELF IN A CHILD PROCESS, and that is not ceremony. pino writes
// through sonic-boom, which flushes asynchronously, so an in-process capture of
// process.stdout.write races the logger and reports failures that are the
// harness's rather than the code's - measured, five of them, all wrong. A child
// process with LOG_JSON=1 gives the complete stream after exit, which is
// exactly what a log collector would receive.
//
// IT WRITES NOTHING. loadBaselines reads source_health so the judgement is the
// real one, and HEALTH_NO_WRITE stops the invented counts being inserted as
// history - which they were, until this harness reported a baseline of "usually
// 3.7" that it had written itself on its previous run.

import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  alarmDeadSource,
  alarmSchemaDrift,
  alarmWriteFailure,
  __scrubForTest,
} from './alarm';
import { recordSourceRun, reportRunHealth, resetSourceRuns } from './health';

const PHASES = ['total-death', 'zero-write', 'empty-selection', 'healthy', 'others'] as const;
type Phase = (typeof PHASES)[number];

/** Emit one scenario. Run in the child, one phase per process, so the streams
 *  cannot interleave and a check cannot read another scenario's line. */
async function emit(phase: Phase): Promise<void> {
  resetSourceRuns();
  if (phase === 'total-death') {
    // Adapters ran and every one fetched nothing. The loudest case, and the one
    // the inverted guard missed.
    recordSourceRun({ unit: 'legistar', lane: 'verify', fetched: 0, kept: 0 });
    recordSourceRun({ unit: 'agenda-portal', lane: 'verify', fetched: 0, kept: 0 });
    await reportRunHealth('verify', { fetched: 0, written: 0 });
  } else if (phase === 'zero-write') {
    // Fetched, kept nothing: a filter that now rejects everything.
    recordSourceRun({ unit: 'legistar', lane: 'verify', fetched: 42, kept: 0 });
    await reportRunHealth('verify', { fetched: 42, written: 0 });
  } else if (phase === 'empty-selection') {
    // No adapter was in scope. Nothing to judge and nobody to wake - the false
    // alarm the New York onboarding run produced.
    await reportRunHealth('verify', { fetched: 0, written: 0 });
  } else if (phase === 'healthy') {
    recordSourceRun({ unit: 'legistar', lane: 'verify', fetched: 42, kept: 11 });
    await reportRunHealth('verify', { fetched: 42, written: 11 });
  } else {
    alarmDeadSource({
      unit: 'ceqanet',
      lane: 'verify',
      fetched: 300,
      kept: 0,
      baseline: 12.5,
      verdict: 'zero-kept',
    });
    alarmSchemaDrift('worldbank', '/notices', 10, 40, ['missing title', 'missing url']);
    alarmWriteFailure('https://example.gov/item/1', 'duplicate key value');
  }
}

let pass = 0;
let fail = 0;

function check(label: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${label}${detail ? `  ${detail}` : ''}`);
  if (ok) pass++;
  else fail++;
}

interface LogLine {
  level: number;
  kind?: string;
  msg?: string;
  [k: string]: unknown;
}

function run(phase: Phase): LogLine[] {
  const res = spawnSync(
    process.execPath,
    ['--env-file=.env.local', '--import', 'tsx', 'agents/scraper/verify-alarms.ts'],
    {
      encoding: 'utf8',
      // HEALTH_NO_WRITE stops the invented counts below becoming tomorrow's
      // baseline. See health.ts: without it this harness wrote 'legistar
      // fetched 0' into source_health and then read it back as history.
      env: { ...process.env, ALARM_PHASE: phase, LOG_JSON: '1', HEALTH_NO_WRITE: '1' },
    }
  );
  const out = `${res.stdout ?? ''}`;
  process.stdout.write(
    out
      .split('\n')
      .filter(Boolean)
      .map((l) => `    ${l}`)
      .join('\n') + '\n'
  );
  return out
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .flatMap((l) => {
      try {
        return [JSON.parse(l) as LogLine];
      } catch {
        return [];
      }
    });
}

// pino levels, named so an assertion reads as a severity rather than a number.
const FATAL = 60;
const ERROR = 50;

async function main(): Promise<void> {
  console.log('===== THE ZERO-WRITE ALARM =====\n');

  console.log('--- a lane whose every source fetched nothing ---');
  const death = run('total-death');
  const laneDeath = death.find((l) => l.kind === 'empty-lane');
  check('the zero-write alarm fires', !!laneDeath);
  check('  at fatal', laneDeath?.level === FATAL, `(got ${laneDeath?.level})`);
  check('  saying it is a total death', /total death/i.test(String(laneDeath?.msg)));
  check('  naming the lane', laneDeath?.lane === 'verify');
  check(
    '  and both dead sources alarm separately',
    death.filter((l) => l.kind === 'dead-source' && l.level === FATAL).length === 2
  );

  console.log('\n--- a lane that fetched 42 and wrote none of them ---');
  const zero = run('zero-write');
  const laneZero = zero.find((l) => l.kind === 'empty-lane');
  check('the zero-write alarm fires', !!laneZero);
  check('  at error rather than fatal', laneZero?.level === ERROR, `(got ${laneZero?.level})`);
  check('  reporting what was fetched', laneZero?.fetched === 42 && laneZero?.written === 0);

  console.log('\n--- a scoped run that selected no adapter at all ---');
  const empty = run('empty-selection');
  check(
    'an empty selection raises NO alarm',
    empty.filter((l) => l.kind === 'empty-lane' || l.kind === 'dead-source').length === 0
  );

  console.log('\n--- a lane that wrote records ---');
  const healthy = run('healthy');
  check(
    'a healthy lane raises nothing',
    healthy.filter((l) => l.level >= ERROR).length === 0
  );

  console.log('\n===== THE OTHER ALARMS =====\n');
  const others = run('others');
  const dead = others.find((l) => l.kind === 'dead-source');
  const drift = others.find((l) => l.kind === 'schema-drift');
  const write = others.find((l) => l.kind === 'write-failure');
  check('a dead source names its baseline', /usually keeps 12\.5/.test(String(dead?.msg)));
  check('schema drift reports its rate', /rejected 80% of \/notices/.test(String(drift?.msg)));
  check('a write failure names the record', write?.url === 'https://example.gov/item/1');
  check('and none of the three is silent', [dead, drift, write].every(Boolean));

  console.log('\n===== SCRUBBING =====\n');
  const scrubbed = __scrubForTest({
    SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.abcdefghijklmnop',
    url: 'https://api.example.com/v1?api_key=abcdef123456&page=2',
    raw_content: 'the whole agenda item text',
    fetched: 42,
  }) as Record<string, unknown>;
  console.log(`    ${JSON.stringify(scrubbed)}`);
  check('the service key never reaches a log line', scrubbed.SUPABASE_SERVICE_ROLE_KEY === '[redacted]');
  check('a key in a query string is stripped', String(scrubbed.url).includes('[redacted]'));
  check('captured content never reaches a log line', scrubbed.raw_content === '[redacted]');
  check('a diagnostic number survives', scrubbed.fetched === 42);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const phase = process.env.ALARM_PHASE as Phase | undefined;
  const work = phase ? emit(phase) : main();
  work.catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
