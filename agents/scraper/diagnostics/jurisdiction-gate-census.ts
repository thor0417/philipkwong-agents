// WHAT DOES THE GATE REFUSE FROM ONE JURISDICTION, AND WHY.
//
//   npm run diag:gate-census                 Yonkers, the case this was written for
//   npm run diag:gate-census -- --client clark --label "Clark County, NV"
//
// THE QUESTION IT ANSWERS. Yonkers sits on the covered-markets table, its
// Legistar feed is live - 274 matters in twelve months, newest 2026-06-12, and
// the newest three are inter-municipal DEVELOPER agreements - and our corpus
// holds ZERO records from it. Zero admitted out of a live feed is one of two
// things and they need opposite fixes:
//
//   an ADAPTER not actually reading it   the lane never asks, or asks wrongly
//   a GATE too narrow for the vocabulary  the lane asks and refuses everything
//
// Nothing in the system distinguished them, because the lane's own telemetry
// (lastStats) is printed during a run and kept nowhere. This asks the source
// directly and applies the REAL gate - gateDecide, the same function the lane
// calls, with the same candidate shape - so the answer cannot drift from what
// the lane actually does.
//
// IT READS THE SOURCE AND NOTHING OF OURS. No database, no key. That is
// deliberate: the question is what the gate would do with what the feed
// publishes, which is answerable without knowing what we happen to have stored.
//
// READ THE BODY, NOT THE STATUS CODE. Every matter counted here was parsed out
// of the response, not inferred from a 200.

import { writeFileSync, mkdirSync } from 'node:fs';
import { gateDecide, bypassModeFor } from '../gate-decide';
import { DEFAULT_JURISDICTIONS } from '../sources/legistar-jurisdictions';

const BASE = 'https://webapi.legistar.com/v1';
const UA = 'Mozilla/5.0 (compatible; philipkwong-agents/1.0 +scraper)';
const OUT_DIR = 'snapshots';

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};

interface Matter {
  MatterId?: number;
  MatterTitle?: string;
  MatterName?: string;
  MatterFile?: string;
  MatterTypeName?: string;
  MatterIntroDate?: string;
}

async function fetchJson(url: string, timeoutMs = 90_000): Promise<{ status: number; rows: unknown[] | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: ctrl.signal });
    if (!res.ok) return { status: res.status, rows: null };
    const body = await res.text();
    try {
      const parsed = JSON.parse(body);
      return { status: res.status, rows: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { status: res.status, rows: null };
    }
  } catch {
    return { status: 0, rows: null };
  } finally {
    clearTimeout(timer);
  }
}

function monthsAgo(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return d.toISOString().slice(0, 10);
}

async function main(): Promise<void> {
  const client = arg('client') ?? 'yonkersny';
  const configured = DEFAULT_JURISDICTIONS.find((j) => j.client === client);
  const label = arg('label') ?? configured?.jurisdictionLabel ?? client;

  console.log('===== WHAT THE GATE REFUSES =====');
  console.log(`jurisdiction : ${label}  (client "${client}")`);
  console.log(`configured   : ${configured ? 'YES, the lane reads it every government run' : 'NO, not in DEFAULT_JURISDICTIONS'}`);
  console.log(`bypassGate   : ${configured?.bypassGate ? 'yes, single-purpose district' : 'no'}`);

  const since = monthsAgo(12);
  const url = `${BASE}/${client}/Matters?$filter=MatterIntroDate%20gt%20datetime%27${since}%27&$top=1000&$orderby=MatterIntroDate%20desc`;
  const { status, rows } = await fetchJson(url);
  if (!rows) {
    console.log(`\nUNREADABLE: HTTP ${status}. This is not proof of anything; re-run before acting on it.`);
    process.exit(1);
  }

  const matters = rows as Matter[];
  console.log(`\nfetched      : ${matters.length} matters introduced since ${since}  (HTTP ${status})`);

  const reasons = new Map<string, { n: number; samples: string[] }>();
  let admitted = 0;
  const admittedSamples: string[] = [];

  for (const m of matters) {
    const title = m.MatterTitle || m.MatterName || m.MatterFile || '';
    if (!title) continue;
    // EXACTLY the gate text the lane builds. A different string here would
    // measure a gate nobody runs.
    const text = `${title}\n${m.MatterName ?? ''}\n${m.MatterFile ?? ''}\n${m.MatterTypeName ?? ''}`;
    const d = gateDecide({
      source: 'legistar',
      market: label,
      key: String(m.MatterId ?? title),
      title,
      gate_text: text,
      bypass_mode: bypassModeFor('legistar'),
      single_purpose: !!configured?.bypassGate,
    });
    if (d.admitted) {
      admitted++;
      if (admittedSamples.length < 12) admittedSamples.push(`${String(m.MatterIntroDate).slice(0, 10)}  ${title.slice(0, 96)}`);
      continue;
    }
    const key = d.reason ?? 'unknown';
    if (!reasons.has(key)) reasons.set(key, { n: 0, samples: [] });
    const e = reasons.get(key)!;
    e.n++;
    if (e.samples.length < 6) e.samples.push(`${String(m.MatterIntroDate).slice(0, 10)}  ${title.slice(0, 96)}`);
  }

  console.log(`admitted     : ${admitted}`);
  console.log(`refused      : ${matters.length - admitted}\n`);
  console.log('REFUSED BY REASON');
  for (const [reason, e] of [...reasons].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${String(e.n).padStart(4)}  ${reason}`);
  }

  console.log('\nSAMPLES, BY REASON');
  for (const [reason, e] of [...reasons].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`\n  --- ${reason} (${e.n}) ---`);
    for (const s of e.samples) console.log(`    ${s}`);
  }

  if (admittedSamples.length) {
    console.log('\n  --- ADMITTED ---');
    for (const s of admittedSamples) console.log(`    ${s}`);
  }

  // THE VERDICT, STATED RATHER THAN LEFT TO THE READER. The two causes need
  // opposite fixes and the whole point of this file is telling them apart.
  console.log('\nVERDICT');
  if (!configured) {
    console.log('  ADAPTER: this client is not in DEFAULT_JURISDICTIONS, so the lane never asks.');
  } else if (admitted === 0 && matters.length > 0) {
    console.log(
      `  GATE: the lane reads ${label} on every run and the gate refuses all ${matters.length} of its ` +
        'matters. The adapter is working; the vocabulary is not reaching this jurisdiction.'
    );
  } else if (admitted > 0) {
    console.log(
      `  The gate admits ${admitted} of ${matters.length} here. If the corpus holds none of them, the ` +
        'break is downstream of the gate: the fetch window, the write, or the clusterer.'
    );
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = `${OUT_DIR}/gate-census-${client}-${stamp}.json`;
  writeFileSync(
    path,
    JSON.stringify(
      {
        about: 'What the government gate refuses from one jurisdiction, applied with the same gateDecide the lane calls.',
        jurisdiction: label,
        client,
        configured: !!configured,
        predicate: `Legistar Matters WHERE MatterIntroDate > ${since}, top 1000`,
        fetched: matters.length,
        admitted,
        refused: matters.length - admitted,
        byReason: Object.fromEntries([...reasons].map(([k, v]) => [k, v.n])),
        samples: Object.fromEntries([...reasons].map(([k, v]) => [k, v.samples])),
        admittedSamples,
      },
      null,
      2
    )
  );
  console.log(`\nwritten: ${path}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
