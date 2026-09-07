// WHO IS DUE, AND WHAT THE WEEK LOOKED LIKE. Brief U item 5, steps 6 and 12.
//
//   npm run cadence:due        who is due today, and the health verdict
//   npm run cadence:record     advance next_delivery for what was delivered
//
// THE SMALLEST VERSION THAT COULD RUN NEXT MONDAY. Not the complete one.
// BRIEF-S-ITEM-5-CADENCE.md lists twelve steps from capture to a file in an
// inbox and names the three that did not exist: nothing decided who was due,
// nothing put a file where a recipient could reach it, and nothing told them.
// This is the first of the three. The other two are .github/workflows/weekly.yml
// - a workflow artefact and a GitHub Issue - because GitHub mails you when an
// issue opens on a repository you watch, and that is a document arriving without
// anyone generating it, which is the whole test.
//
// ---- THE RULE FOR "DUE", AND THE FAILURE MODE IT REFUSES -------------------
//
// A client is due when status = 'active' AND next_delivery <= today.
//
// A NULL next_delivery MEANS NEVER DUE, not always due. The other reading mails
// every client every week from a single missing value, and the first time that
// happens it happens to a real person. So the null is reported by name and by
// count and nothing is generated for it.
//
// ---- IT WRITES NOTHING IN `due` MODE ---------------------------------------
//
// The advance is a separate mode run AFTER the documents exist, because a
// next_delivery advanced before the generation is a week silently skipped when
// the generation fails. Same shape as standing rule 11: the thing that stands in
// for the work must not be what gets recorded.

import { pathToFileURL } from 'node:url';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { supabaseAdmin } from '../../lib/supabase-admin';
import {
  captureByMarket,
  captureGapNote,
  newestRun,
  notInRunNote,
  type HealthRow,
} from '../../lib/source-health';
import { COVERED_MARKETS } from '../../lib/coverage';

const OUT_DIR = 'cadence';
const DUE_FILE = `${OUT_DIR}/due.json`;
const DELIVERED_FILE = `${OUT_DIR}/delivered.json`;
const VERDICT_FILE = `${OUT_DIR}/verdict.json`;

export interface DueClient {
  id: string;
  name: string;
  cadence: string | null;
  next_delivery: string | null;
  /** Projects this client may be shown at all. Zero is a real answer. */
  included: number;
}

interface Verdict {
  runAt: string;
  today: string;
  due: DueClient[];
  notDue: { name: string; why: string }[];
  markets: { market: string; state: string; lastCapture: string | null; keptThen: number }[];
  newestRun: string | null;
  captureGap: string;
  /** True when something needs a person. The workflow exits non-zero on it. */
  red: boolean;
  redReasons: string[];
}

const today = (): string => new Date().toISOString().slice(0, 10);

/** next_delivery, advanced by the cadence the client is on. */
export function advanceFrom(from: string, cadence: string | null): string {
  const d = new Date(`${from}T00:00:00Z`);
  const c = (cadence ?? 'weekly').toLowerCase();
  if (c === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else if (c === 'fortnightly' || c === 'biweekly') d.setUTCDate(d.getUTCDate() + 14);
  else d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

/**
 * A DUE DATE IN THE PAST DOES NOT BECOME A BACKLOG. Advancing from a
 * next_delivery three weeks old would set the next one two weeks in the past and
 * the client would be due again immediately, every run, forever. The advance is
 * from TODAY where the stored date has already gone by.
 */
export function nextAfterDelivery(stored: string | null, cadence: string | null, now: string): string {
  const base = stored && stored > now ? stored : now;
  return advanceFrom(base, cadence);
}

async function healthRows(): Promise<HealthRow[]> {
  const { data, error } = await supabaseAdmin
    .from('source_health')
    .select('market,run_at,kept')
    .order('run_at', { ascending: false })
    .limit(5000);
  // MIGRATION 044 ADDS source_health.market. Where it is missing the answer is
  // "we cannot say", not "every market is silent", so the caller is told which
  // of the two it is rather than being handed a false negative.
  if (error) throw new Error(`source_health read failed: ${error.message}`);
  return (data ?? []) as HealthRow[];
}

async function due(): Promise<Verdict> {
  const now = today();
  const { data: clients, error } = await supabaseAdmin
    .from('clients')
    .select('id,name,status,cadence,next_delivery');
  if (error) throw new Error(`clients read failed: ${error.message}`);

  const { data: membership, error: mErr } = await supabaseAdmin
    .from('client_projects')
    .select('client_id,status')
    .eq('status', 'included')
    .limit(20000);
  if (mErr) throw new Error(`client_projects read failed: ${mErr.message}`);
  const includedBy = new Map<string, number>();
  for (const m of (membership ?? []) as { client_id: string }[]) {
    includedBy.set(m.client_id, (includedBy.get(m.client_id) ?? 0) + 1);
  }

  const dueList: DueClient[] = [];
  const notDue: { name: string; why: string }[] = [];
  for (const c of (clients ?? []) as Record<string, unknown>[]) {
    const name = String(c.name);
    const status = String(c.status ?? '');
    const nd = c.next_delivery ? String(c.next_delivery).slice(0, 10) : null;
    if (status !== 'active') {
      notDue.push({ name, why: `status is '${status || '(none)'}', not active` });
      continue;
    }
    if (nd === null) {
      notDue.push({
        name,
        why: 'next_delivery is not set. A null means NEVER due, never always due, so nothing is generated.',
      });
      continue;
    }
    if (nd > now) {
      notDue.push({ name, why: `next due ${nd}` });
      continue;
    }
    dueList.push({
      id: String(c.id),
      name,
      cadence: c.cadence ? String(c.cadence) : null,
      next_delivery: nd,
      included: includedBy.get(String(c.id)) ?? 0,
    });
  }

  const rows = await healthRows();
  const caps = captureByMarket(rows, COVERED_MARKETS.map((m) => m.market));
  const newest = newestRun(rows);

  // ---- WHAT MAKES THE WEEK RED ---------------------------------------------
  //
  // NOT A CRASH. BRIEF-S-ITEM-5-CADENCE section 5: a run that captures nothing
  // still exits 0, and HEALTH_NO_WRITE=1 is one environment variable away from a
  // run that looks completely normal and records nothing. An alarm attached only
  // to a crash never fires for the failure this system actually has. So the
  // verdict is about the CORPUS, and the workflow fails the job on it, which is
  // what makes GitHub's own failure mail arrive with no transport built for it.
  const redReasons: string[] = [];
  if (rows.length === 0) {
    redReasons.push('source_health is empty: nothing recorded what this run captured, in any market.');
  }
  // SILENT ONLY. A market the newest run did not READ is not a failure, and
  // treating it as one is how the first version of this verdict came back RED on
  // a capture that had just kept 282 Clark County records: it was reading a
  // scoped Anaheim re-run as the whole week. See lib/source-health.
  const silent = caps.filter((c) => c.state === 'silent');
  const notRead = caps.filter((c) => c.state === 'not-in-run');
  const never = caps.filter((c) => c.state === 'never-recorded');
  if (silent.length > 0) {
    redReasons.push(
      `${silent.length} covered market${silent.length === 1 ? '' : 's'} was read by the newest run and kept nothing: ` +
        silent.map((c) => c.market).join(', ')
    );
  }
  void notRead;
  if (never.length === caps.length && caps.length > 0) {
    redReasons.push(
      'every covered market reads never-recorded, which is what a run with HEALTH_NO_WRITE=1 looks like.'
    );
  }
  if (dueList.length > 0 && dueList.every((d) => d.included === 0)) {
    redReasons.push(
      'every due client has zero included projects, so a correct run would generate a document about nothing.'
    );
  }

  return {
    runAt: new Date().toISOString(),
    today: now,
    due: dueList,
    notDue,
    markets: caps.map((c) => ({ market: c.market, state: c.state, lastCapture: c.lastCapture, keptThen: c.keptThen })),
    newestRun: newest,
    captureGap: [captureGapNote(caps, newest), notInRunNote(caps, newest)].filter(Boolean).join(' '),
    red: redReasons.length > 0,
    redReasons,
  };
}

function printVerdict(v: Verdict): void {
  console.log('='.repeat(88));
  console.log(`THE WEEKLY CADENCE, ${v.today}`);
  console.log('='.repeat(88));
  console.log(`DUE (${v.due.length}):`);
  for (const d of v.due) {
    console.log(`  ${d.name.padEnd(24)} cadence ${String(d.cadence).padEnd(12)} due ${d.next_delivery}   ${d.included} included projects`);
  }
  if (v.due.length === 0) console.log('  nobody');
  console.log('');
  console.log(`NOT DUE (${v.notDue.length}), and why, because a silent skip is indistinguishable from a broken run:`);
  for (const n of v.notDue) console.log(`  ${n.name.padEnd(24)} ${n.why}`);
  console.log('');
  console.log(`CAPTURE, PER COVERED MARKET (newest run ${v.newestRun ?? 'never'}):`);
  for (const m of v.markets) {
    console.log(`  ${m.market.padEnd(28)} ${m.state.padEnd(15)} ${m.lastCapture ? m.lastCapture.slice(0, 10) : '-'}   ${m.keptThen}`);
  }
  if (v.captureGap) {
    console.log('');
    console.log(`  ${v.captureGap}`);
  }
  console.log('');
  console.log(v.red ? 'VERDICT: RED' : 'VERDICT: green');
  for (const r of v.redReasons) console.log(`  - ${r}`);
}

async function record(): Promise<void> {
  if (!existsSync(DELIVERED_FILE)) {
    throw new Error(
      `${DELIVERED_FILE} does not exist. Nothing was delivered, so nothing is advanced. ` +
        'That is the correct outcome of a failed generation and not an error to work around.'
    );
  }
  const delivered = JSON.parse(readFileSync(DELIVERED_FILE, 'utf8')) as {
    clientId: string;
    name: string;
    file: string;
    bytes: number;
  }[];
  const now = today();
  console.log(`RECORDING ${delivered.length} deliveries and advancing next_delivery.`);

  for (const d of delivered) {
    const { data: c, error } = await supabaseAdmin
      .from('clients')
      .select('id,name,cadence,next_delivery')
      .eq('id', d.clientId)
      .single();
    if (error || !c) {
      console.error(`  ${d.name}: client read failed (${error?.message ?? 'no row'})`);
      continue;
    }
    const next = nextAfterDelivery(
      c.next_delivery ? String(c.next_delivery).slice(0, 10) : null,
      c.cadence ? String(c.cadence) : null,
      now
    );
    const { error: uErr } = await supabaseAdmin
      .from('clients')
      .update({ next_delivery: next })
      .eq('id', d.clientId);
    if (uErr) {
      console.error(`  ${d.name}: advance failed (${uErr.message})`);
      continue;
    }
    console.log(`  ${d.name.padEnd(24)} ${d.file} (${d.bytes} b)  next_delivery -> ${next}`);
  }

  // READ IT BACK. Standing rule 11.
  const { data: after } = await supabaseAdmin.from('clients').select('name,next_delivery');
  console.log('');
  console.log('READ BACK FROM THE TABLE:');
  for (const c of (after ?? []) as { name: string; next_delivery: string | null }[]) {
    console.log(`  ${c.name.padEnd(24)} next_delivery ${c.next_delivery ?? '(null)'}`);
  }
}

async function main(): Promise<void> {
  const mode = (process.argv.find((a) => a.startsWith('--mode=')) ?? '--mode=due').split('=')[1];
  mkdirSync(dirname(DUE_FILE), { recursive: true });

  if (mode === 'record') {
    await record();
    return;
  }

  const v = await due();
  printVerdict(v);
  writeFileSync(DUE_FILE, JSON.stringify(v.due, null, 1));
  writeFileSync(VERDICT_FILE, JSON.stringify(v, null, 1));
  console.log('');
  console.log(`wrote ${DUE_FILE} and ${VERDICT_FILE}`);

  // The job does NOT fail here. The document still has to be generated and the
  // issue still has to be written, and a red verdict is exactly the week those
  // matter most: a quiet week is the week where "we found nothing" and "we
  // looked at nothing" are the two possible meanings. The workflow reads
  // verdict.json at the END and fails the job then.
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
