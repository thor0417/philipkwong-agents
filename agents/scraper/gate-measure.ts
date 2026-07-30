// THE INSTRUMENT: precision AND recall for the government gate, in one command.
//
//   npm run gate:measure
//
// Precision was measurable before this, because the records the gate admitted are
// in the database. Recall was not, because the records it rejected were dropped
// inside the adapters. That asymmetry is why precision was 92 percent and recall
// was 30 percent and only one of those numbers was known.
//
// HOW IT WORKS
//   1. A frozen candidate corpus (gate-harvest) holds every candidate every
//      gate-bearing source produced, with the exact text the gate judged.
//   2. This re-gates that corpus with the CURRENT gate code, so admitted and
//      rejected are recomputed rather than remembered.
//   3. Two independent samples are drawn from each side - admitted for precision,
//      rejected for recall - stratified across sources in proportion to the
//      corpus, deterministic without a seed (records ordered by key, split into
//      even and odd halves so the two samples can never overlap, then spread at a
//      fixed stride).
//   4. Each sampled record carries a cached relevance label (gate-labels).
//   5. The numbers:
//        precision = relevant / labelled, among ADMITTED
//        missed    = relevant / labelled, among REJECTED
//        recall    = (|admitted| x precision) / (|admitted| x precision + |rejected| x missed)
//      Recall is an estimate from two sample rates over the true population
//      counts, which is what the audit computed by hand and what this makes
//      repeatable. It is reported per sample AND per source, because a source can
//      be precise and nearly unread at the same time - CFTOD was.
//
// Flags (env):
//   GATE_HARVEST=1        re-fetch the corpus before measuring (default: reuse)
//   GATE_SAMPLE_SIZE=100  records per sample, per side
//   GATE_LABELS_READONLY=1  never call the judge; measure on cached labels only
//   GATE_SHOW_MISSES=25   how many rejected-but-relevant records to print

import { pathToFileURL } from 'node:url';
import { existsSync, statSync } from 'node:fs';
import {
  corpusPath,
  decide,
  readGateCorpus,
  candidateHash,
  type GateCandidate,
  type GateDecision,
} from './gate-decide';
import {
  labelCandidates,
  tierCandidates,
  RUBRIC_VERSION,
  type GateLabel,
  type RecordTier,
} from './gate-labels';
import { harvestGateCorpus } from './gate-harvest';
import { loadProbes, runProbes } from './gate-probes';
import { selectAllPaged } from './page-select';
import { loadKnownEntities } from './known-entities';

interface Scored {
  c: GateCandidate;
  d: GateDecision;
  hash: string;
}

// ---- Deterministic, disjoint, proportional sampling -------------------------

// Every `stride`th record, so a sample spreads across the pool instead of
// clustering at one end of it.
function spread<T>(items: T[], size: number): T[] {
  if (items.length <= size) return items.slice();
  const stride = items.length / size;
  const out: T[] = [];
  for (let i = 0; out.length < size && Math.floor(i * stride) < items.length; i++) {
    out.push(items[Math.floor(i * stride)]);
  }
  return out;
}

// Largest-remainder allocation of `size` slots across sources in proportion to
// their share of the pool, with at least one slot for any source that has any
// records at all. A source too small to earn a proportional slot is exactly the
// source most likely to be silently unread, so it gets one.
function quotas(counts: Map<string, number>, size: number): Map<string, number> {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return new Map();
  const exact = [...counts.entries()].map(([s, n]) => ({ s, want: (size * n) / total }));
  const out = new Map(exact.map((e) => [e.s, Math.max(1, Math.floor(e.want))]));
  let left = size - [...out.values()].reduce((a, b) => a + b, 0);
  const byRemainder = exact
    .map((e) => ({ s: e.s, rem: e.want - Math.floor(e.want) }))
    .sort((a, b) => b.rem - a.rem || a.s.localeCompare(b.s));
  for (let i = 0; left > 0 && byRemainder.length > 0; i++, left--) {
    const s = byRemainder[i % byRemainder.length].s;
    out.set(s, (out.get(s) ?? 0) + 1);
  }
  return out;
}

// Two samples that CANNOT overlap: each source's records are ordered by key,
// split into even-index and odd-index halves, and each half is spread separately.
function twoSamples(pool: Scored[], size: number): [Scored[], Scored[]] {
  const bySource = new Map<string, Scored[]>();
  for (const r of pool) {
    if (!bySource.has(r.c.source)) bySource.set(r.c.source, []);
    bySource.get(r.c.source)!.push(r);
  }
  const counts = new Map([...bySource].map(([s, arr]) => [s, arr.length]));
  const q = quotas(counts, size);
  const a: Scored[] = [];
  const b: Scored[] = [];
  for (const [s, arr] of [...bySource].sort((x, y) => x[0].localeCompare(y[0]))) {
    const sorted = arr.slice().sort((x, y) => x.c.key.localeCompare(y.c.key));
    const want = q.get(s) ?? 0;
    a.push(...spread(sorted.filter((_, i) => i % 2 === 0), want));
    b.push(...spread(sorted.filter((_, i) => i % 2 === 1), want));
  }
  return [a, b];
}

// ---- Rates ------------------------------------------------------------------

interface Rate {
  labelled: number;
  relevant: number;
  rate: number | null;
  // 95% Wilson score interval on the rate.
  lo: number;
  hi: number;
}

// WILSON SCORE INTERVAL, not a point estimate.
//
// The rate that drives recall is the share of REJECTED records that are actually
// relevant, and it is small: one or two per hundred. A point estimate off that
// base rate is close to meaningless - two samples of 100 that find 1 and 2
// relevant records produce recall numbers 16 points apart, and neither number is
// evidence of anything. Wilson is used rather than the normal approximation
// because it stays sane at p near zero and at small n, which is exactly the
// regime this measurement lives in.
function wilson(k: number, n: number): { lo: number; hi: number } {
  if (n === 0) return { lo: 0, hi: 1 };
  const z = 1.96;
  const p = k / n;
  const d = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const spread = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { lo: Math.max(0, (centre - spread) / d), hi: Math.min(1, (centre + spread) / d) };
}

function rateOf(sample: Scored[], labels: Map<string, GateLabel>): Rate {
  let labelled = 0;
  let relevant = 0;
  for (const r of sample) {
    const l = labels.get(r.hash);
    if (!l) continue;
    labelled++;
    if (l.relevant) relevant++;
  }
  const ci = wilson(relevant, labelled);
  return {
    labelled,
    relevant,
    rate: labelled ? relevant / labelled : null,
    lo: ci.lo,
    hi: ci.hi,
  };
}

const pct = (x: number | null): string => (x === null ? '   n/a' : `${(x * 100).toFixed(1)}%`);

function recallFrom(admitted: number, precision: number | null, rejected: number, missed: number | null): number | null {
  if (precision === null || missed === null) return null;
  const tp = admitted * precision;
  const fn = rejected * missed;
  return tp + fn === 0 ? null : tp / (tp + fn);
}

// The recall interval implied by the two sample rates' own intervals. Recall
// falls as the missed rate rises, so the bounds pair oppositely: the low end
// takes the most pessimistic missed rate with the most pessimistic precision.
function recallInterval(admitted: number, p: Rate, rejected: number, m: Rate): { lo: number | null; hi: number | null } {
  return {
    lo: recallFrom(admitted, p.lo, rejected, m.hi),
    hi: recallFrom(admitted, p.hi, rejected, m.lo),
  };
}

// ---- The other denominator ---------------------------------------------------
//
// TWO DIFFERENT PRECISIONS EXIST AND THE AUDIT ONLY REPORTED ONE.
//
// The harness above measures precision over what the gate ADMITS: raw output,
// before anyone looks at it. The audit's 92 percent was measured over the STORED
// government records with the dismissed ones filtered out (precision-sample.ts
// does exactly that), which is precision after Philip has curated it. Those are
// different populations and the second is necessarily kinder.
//
// Both are reported, because the gap between them is itself the finding: it is
// the volume of curation the gate currently offloads onto a person.
async function storedPrecision(labels: Map<string, GateLabel>, size: number): Promise<void> {
  interface Row {
    id: string;
    title: string | null;
    source: string | null;
    status: string | null;
    location: string | null;
  }
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,source,status,location',
    (q: unknown) => (q as { eq: (a: string, b: string) => unknown }).eq('stream', 'government'),
    'gate-measure stored'
  );
  if (!complete) {
    console.log('\nSTORED CORPUS: read was partial, so no number is reported.');
    return;
  }
  const live = rows
    .filter((r) => String(r.status) !== 'dismissed' && r.title)
    .sort((a, b) => a.id.localeCompare(b.id));
  const asCandidates: Scored[] = live.map((r) => {
    const c: GateCandidate = {
      source: String(r.source ?? 'unknown'),
      market: String(r.location ?? '(unknown)'),
      key: r.id,
      title: String(r.title),
      gate_text: String(r.title),
      bypass_mode: 'none',
    };
    return { c, d: decide(c), hash: candidateHash(c) };
  });
  const [sa, sb] = twoSamples(asCandidates, size);
  const fresh = await labelCandidates([...sa, ...sb].map((r) => r.c));
  for (const [k, v] of fresh) labels.set(k, v);
  const ra = rateOf(sa, labels);
  const rb = rateOf(sb, labels);
  console.log(
    `\nSTORED CORPUS (the audit's denominator): ${rows.length} government records, ${live.length} not dismissed.`
  );
  console.log(
    `  precision on the CURATED corpus: sample A ${pct(ra.rate)} (${ra.relevant}/${ra.labelled}), ` +
      `sample B ${pct(rb.rate)} (${rb.relevant}/${rb.labelled})`
  );
  console.log(
    '  This is the number comparable to the audit\'s 92 percent. It is measured after dismissals;'
  );
  console.log(
    '  the gate precision above is measured before them, over everything the gate admits.'
  );
}

export interface StageNumbers {
  label: string;
  admitted: number;
  rejected: number;
  precision: [Rate, Rate];
  missed: [Rate, Rate];
  recall: [number | null, number | null];
}

export async function measureGate(stageLabel: string = 'current'): Promise<StageNumbers> {
  const size = Number(process.env.GATE_SAMPLE_SIZE ?? '100');
  const file = corpusPath();

  if (process.env.GATE_HARVEST === '1' || !existsSync(file)) {
    if (!existsSync(file)) console.log(`No frozen corpus at ${file}; harvesting one.`);
    await harvestGateCorpus();
  }
  const corpus = readGateCorpus();
  if (corpus.length === 0) {
    throw new Error(`Gate corpus at ${file} is empty. Run npm run gate:harvest.`);
  }
  // The known-entity bypass is part of the gate, so re-gating the frozen corpus
  // has to load the register the live lane would have consulted. The index date
  // is reported with the numbers: unlike the corpus, the register is live, so a
  // recall figure is against the register as it stood when the measurement ran.
  const entities = await loadKnownEntities();
  console.log(
    `Known entities: ${entities.entities} parties across ${entities.anchors} anchor projects of ${entities.projects}.`
  );
  const harvested = statSync(file).mtime.toISOString().slice(0, 16).replace('T', ' ');

  const scored: Scored[] = corpus.map((c) => ({ c, d: decide(c), hash: candidateHash(c) }));
  const admitted = scored.filter((r) => r.d.admitted);
  const rejected = scored.filter((r) => !r.d.admitted);

  console.log('\n================ GOVERNMENT GATE: PRECISION AND RECALL ================');
  console.log(`Stage: ${stageLabel}`);
  console.log(`Corpus: ${corpus.length} candidates, frozen ${harvested} UTC (${file}).`);
  console.log(`Current gate: ${admitted.length} admitted, ${rejected.length} rejected.`);

  // The two sides are sized independently, because they are not the same
  // measurement problem. Precision is measured over a small admitted set at a
  // rate near 60 percent, where 100 records is plenty (in fact the two samples
  // together are a CENSUS of everything the gate admits). Recall depends on a
  // base rate near 1 percent in a set of thousands, where 100 records finds one
  // or two positives and settles nothing.
  const rejectSize = Number(process.env.GATE_REJECT_SAMPLE_SIZE ?? '400');
  const [pa, pb] = twoSamples(admitted, size);
  const [ra, rb] = twoSamples(rejected, rejectSize);
  // The probes are labelled in the same pass, so the judge that produced the
  // numbers is the judge whose accuracy is reported next to them.
  const labels = await labelCandidates([
    ...[...pa, ...pb, ...ra, ...rb].map((r) => r.c),
    ...loadProbes().map((p) => p.candidate),
  ]);
  console.log(`Labels: rubric ${RUBRIC_VERSION}.`);

  const precision: [Rate, Rate] = [rateOf(pa, labels), rateOf(pb, labels)];
  const missed: [Rate, Rate] = [rateOf(ra, labels), rateOf(rb, labels)];
  const recall: [number | null, number | null] = [
    recallFrom(admitted.length, precision[0].rate, rejected.length, missed[0].rate),
    recallFrom(admitted.length, precision[1].rate, rejected.length, missed[1].rate),
  ];

  const ciA = recallInterval(admitted.length, precision[0], rejected.length, missed[0]);
  const ciB = recallInterval(admitted.length, precision[1], rejected.length, missed[1]);

  console.log('\nTWO INDEPENDENT SAMPLES (disjoint by construction, stratified by source):');
  console.log('                     sample A                        sample B');
  console.log(
    `  precision      ${pct(precision[0].rate)}  (${precision[0].relevant}/${precision[0].labelled})`.padEnd(48) +
      `${pct(precision[1].rate)}  (${precision[1].relevant}/${precision[1].labelled})`
  );
  console.log(
    `                 95% CI ${pct(precision[0].lo)}-${pct(precision[0].hi)}`.padEnd(48) +
      `95% CI ${pct(precision[1].lo)}-${pct(precision[1].hi)}`
  );
  console.log(
    `  reject relevant${pct(missed[0].rate)}  (${missed[0].relevant}/${missed[0].labelled})`.padEnd(48) +
      `${pct(missed[1].rate)}  (${missed[1].relevant}/${missed[1].labelled})`
  );
  console.log(
    `                 95% CI ${pct(missed[0].lo)}-${pct(missed[0].hi)}`.padEnd(48) +
      `95% CI ${pct(missed[1].lo)}-${pct(missed[1].hi)}`
  );
  console.log(
    `  RECALL         ${pct(recall[0])}`.padEnd(48) + `${pct(recall[1])}`
  );
  console.log(
    `                 95% CI ${pct(ciA.lo)}-${pct(ciA.hi)}`.padEnd(48) +
      `95% CI ${pct(ciB.lo)}-${pct(ciB.hi)}`
  );
  // Whether the two samples actually agree, stated rather than left to the eye.
  if (recall[0] !== null && recall[1] !== null) {
    const gap = Math.abs(recall[0] - recall[1]) * 100;
    const overlap = ciA.lo !== null && ciB.hi !== null && ciA.hi !== null && ciB.lo !== null
      ? ciA.lo <= ciB.hi && ciB.lo <= ciA.hi
      : false;
    console.log(
      `\n  The two recall estimates differ by ${gap.toFixed(1)} points; their intervals ` +
        `${overlap ? 'OVERLAP, so the samples agree' : 'DO NOT overlap, so the samples disagree'}.`
    );
    console.log(
      `  Recall rests on ${missed[0].relevant + missed[1].relevant} relevant records found across ` +
        `${missed[0].labelled + missed[1].labelled} labelled rejects. Read the interval, not the point.`
    );
  }

  // Per source. The amendment's point: a source can be precise and nearly unread
  // at the same time, and only a per-source reading shows it.
  console.log('\nPER SOURCE (pooled over both samples; n is the labelled count):');
  console.log('  source          admitted  rejected   precision (n)      missed (n)       recall');
  const sources = [...new Set(corpus.map((c) => c.source))].sort();
  for (const s of sources) {
    const adm = admitted.filter((r) => r.c.source === s);
    const rej = rejected.filter((r) => r.c.source === s);
    const p = rateOf([...pa, ...pb].filter((r) => r.c.source === s), labels);
    const m = rateOf([...ra, ...rb].filter((r) => r.c.source === s), labels);
    const rec = recallFrom(adm.length, p.rate, rej.length, m.rate);
    console.log(
      `  ${s.padEnd(15)} ${String(adm.length).padStart(7)} ${String(rej.length).padStart(9)}   ` +
        `${pct(p.rate)} (${String(p.labelled).padStart(3)})     ${pct(m.rate)} (${String(m.labelled).padStart(3)})    ${pct(rec)}`
    );
  }
  console.log('  sfwmd / govdocs: no gate decision (server-side Disney query / hand-listed docs), so no gate recall.');

  // Drop reasons among the rejected records the labels call relevant. This is the
  // miss-class breakdown: it names WHICH rule is doing the discarding.
  const misses = [...ra, ...rb].filter((r) => labels.get(r.hash)?.relevant);
  const byReason: Record<string, number> = {};
  for (const r of misses) byReason[r.d.reason] = (byReason[r.d.reason] ?? 0) + 1;
  console.log(`\nMISS CLASSES among the ${misses.length} sampled rejects labelled relevant:`);
  for (const [reason, n] of Object.entries(byReason).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${reason}`);
  }

  const show = Number(process.env.GATE_SHOW_MISSES ?? '25');
  if (show > 0 && misses.length > 0) {
    console.log(`\nMISSED RECORDS (first ${Math.min(show, misses.length)} of ${misses.length}), with the terms the gate did see:`);
    for (const r of misses.slice(0, show)) {
      const v = r.d.verdict;
      const seen =
        v.weakHits.length || v.actionHits.length
          ? `weak: [${v.weakHits.join(', ') || '-'}] action: [${v.actionHits.join(', ') || '-'}]`
          : v.exclusionHits.length
            ? `excluded on: [${v.exclusionHits.join(', ')}]`
            : 'no vocabulary at all';
      console.log(`  - [${r.c.source}/${r.d.reason}] ${r.c.title.replace(/\s+/g, ' ').slice(0, 96)}`);
      console.log(`      ${seen}`);
    }
  }
  // ---- EXACT BENCHMARK, for attributing a change to the gate ----------------
  //
  // The sampled numbers above are the headline, but they cannot cleanly attribute
  // a STAGE-TO-STAGE delta. When the gate changes, the rejected set changes, so
  // the stratified reject sample draws different records and needs new labels -
  // and then part of the movement is better label coverage rather than the gate.
  //
  // This section removes that confound by measuring over every record that has a
  // label, whichever stage paid for it. The set only grows, and the gate is the
  // only thing that moves records between the two columns, so the delta between
  // stages is the gate's.
  //
  // It is NOT the headline, and it is biased upward on the reject side: the
  // labelled pool includes records deliberately chosen because a candidate term
  // fired on them (gate:terms). Read it for deltas, not for absolute level.
  const labelled = scored.filter((r) => labels.has(r.hash));
  const relevantLabelled = labelled.filter((r) => labels.get(r.hash)!.relevant);
  const admittedRelevant = relevantLabelled.filter((r) => r.d.admitted).length;
  const admittedLabelled = labelled.filter((r) => r.d.admitted).length;
  console.log(
    `\nEXACT BENCHMARK over all ${labelled.length} labelled records ` +
      `(${relevantLabelled.length} relevant). Use for stage-to-stage deltas, not absolute level:`
  );
  console.log(
    `  recall    ${pct(relevantLabelled.length ? admittedRelevant / relevantLabelled.length : null)} ` +
      `(${admittedRelevant}/${relevantLabelled.length} relevant records are admitted)`
  );
  console.log(
    `  precision ${pct(admittedLabelled ? admittedRelevant / admittedLabelled : null)} ` +
      `(${admittedRelevant}/${admittedLabelled} admitted records are relevant)`
  );
  const bySourceBench = [...new Set(labelled.map((r) => r.c.source))].sort();
  for (const s of bySourceBench) {
    const rel = relevantLabelled.filter((r) => r.c.source === s);
    const got = rel.filter((r) => r.d.admitted).length;
    console.log(
      `    ${s.padEnd(15)} recall ${pct(rel.length ? got / rel.length : null)} (${got}/${rel.length})`
    );
  }

  // ---- TIER BREAKDOWN -------------------------------------------------------
  //
  // What the binary cannot say. Tiered over everything the gate admits (the two
  // precision samples together are a census of it) plus the rejects the rubric
  // called relevant, so both halves of the decision are readable at tier level.
  //
  // The number to read first is the last line: among admitted records the binary
  // calls NOT relevant, how many are context rather than noise. If that split
  // leans context, the gate is admitting real evidence it has no way to label,
  // and the fix is a tier rather than a tightening.
  const tierPool = [...pa, ...pb, ...[...ra, ...rb].filter((r) => labels.get(r.hash)?.relevant)];
  const tiers = await tierCandidates(tierPool.map((r) => r.c));
  const tierOf = (r: Scored): RecordTier | null => tiers.get(r.hash)?.tier ?? null;
  const tally = (rows: Scored[]): Record<string, number> => {
    const t: Record<string, number> = { headline: 0, context: 0, noise: 0, untiered: 0 };
    for (const r of rows) t[tierOf(r) ?? 'untiered']++;
    return t;
  };
  const admittedTiers = tally([...pa, ...pb]);
  const admittedTiered = admittedTiers.headline + admittedTiers.context + admittedTiers.noise;
  const share = (n: number): string =>
    admittedTiered ? `${((n / admittedTiered) * 100).toFixed(1)}%`.padStart(6) : '   n/a';
  console.log(`\nTIER BREAKDOWN of the ${admittedTiered} tiered admitted records (headline = a lead, context = real but not a lead, noise = should not be here):`);
  console.log(`  headline ${String(admittedTiers.headline).padStart(4)}  ${share(admittedTiers.headline)}`);
  console.log(`  context  ${String(admittedTiers.context).padStart(4)}  ${share(admittedTiers.context)}`);
  console.log(`  noise    ${String(admittedTiers.noise).padStart(4)}  ${share(admittedTiers.noise)}`);
  if (admittedTiers.untiered) console.log(`  (untiered ${admittedTiers.untiered})`);

  const notRelevantAdmitted = [...pa, ...pb].filter((r) => labels.get(r.hash) && !labels.get(r.hash)!.relevant);
  const nr = tally(notRelevantAdmitted);
  const nrTiered = nr.headline + nr.context + nr.noise;
  console.log(
    `\n  Of the ${notRelevantAdmitted.length} admitted records the binary calls NOT relevant: ` +
      `${nr.context} are context, ${nr.noise} are noise, ${nr.headline} headline` +
      (nrTiered ? ` (context is ${((nr.context / nrTiered) * 100).toFixed(0)}% of them)` : '')
  );
  console.log(
    '  Context-heavy means the gate is admitting real evidence it cannot label as evidence,'
  );
  console.log(
    '  so the answer is a tier on the record, not a tighter gate.'
  );

  const missTiers = tally([...ra, ...rb].filter((r) => labels.get(r.hash)?.relevant));
  console.log(
    `\n  The ${missTiers.headline + missTiers.context + missTiers.noise} sampled relevant rejects by tier: ` +
      `${missTiers.headline} headline, ${missTiers.context} context, ${missTiers.noise} noise. ` +
      'A missed headline is a lost lead; a missed context record is lost evidence.'
  );

  if (process.env.GATE_SKIP_STORED !== '1') await storedPrecision(labels, size);
  await runProbes(labels);
  console.log('======================================================================\n');

  return {
    label: stageLabel,
    admitted: admitted.length,
    rejected: rejected.length,
    precision,
    missed,
    recall,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  measureGate(process.env.GATE_STAGE ?? 'current').catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
