// VOCABULARY TESTER: does a candidate term earn its place?
//
// A term added to the gate on the strength of the phrase sounding right is a
// guess. This measures each candidate individually against the frozen corpus
// before anything is committed, and reports the three facts that decide it:
//
//   HIT COUNT   - how many currently-rejected records the term would admit. A
//                 term that fires on nothing is dead weight.
//   ITS OWN     - of those admits, how many are actually relevant. This is the
//   PRECISION     term's own precision, and it is the number that matters: a
//                 term whose precision is below the gate's current precision
//                 drags the whole gate down, whatever it does for recall.
//   PROJECTION  - the resulting overall precision and recall, so the trade is
//                 visible per term rather than only in aggregate afterwards.
//
// Labels come from the same cached, committed, hand-overridable store as the
// measurement harness, so a term's precision is judged by the same rubric as
// everything else.
//
// Run: npm run gate:terms
//      GATE_TERM_SAMPLE=20   labelled records per variant (default 20)
//      GATE_TERMS="a,b,c"    test specific terms instead of the built-in list

import { pathToFileURL } from 'node:url';
// isDetachedResidential comes from the taxonomy, not from a copy here: a tester
// with its own version of the guard would measure a rule the gate never applies.
import { hasWord, isDetachedResidential, governmentGate } from '../../lib/taxonomy';
import { readGateCorpus, decide, candidateHash, type GateCandidate } from './gate-decide';
import { labelCandidates, tierCandidates, type GateLabel, type GateTierLabel } from './gate-labels';

// The Part 2 candidate list, as briefed. Order is the brief's order; the results
// table below decides which survive.
export const DEAL_CANDIDATES = [
  'development agreement',
  'disposition and development agreement',
  'disposition and redevelopment solicitation',
  'master economic incentive agreement',
  'economic incentive agreement',
  'funding agreement',
  'ground lease',
  'exclusive negotiation agreement',
  'tax increment financing agreement',
  'redevelopment agreement',
  'participation agreement',
  'cooperative agreement',
] as const;

// A NAMED PRIVATE PARTY. The corroboration that separates "Development Agreement
// with Encore Multifamily, LLC" from a development agreement mentioned in the
// abstract. Legal suffixes only: a public body ("City of Phoenix", "Housing
// Authority") carries none, which is exactly the discrimination wanted. Bare 'co'
// is deliberately absent - it fires inside addresses and county references.
const PRIVATE_PARTY =
  /\b(l\.?l\.?c|l\.?l\.?p|l\.?p|inc|incorporated|ltd|limited|corp|corporation|company|plc|pllc|holdings|partners|ventures|properties)\b/i;

export function hasPrivateParty(text: string): boolean {
  return PRIVATE_PARTY.test(text);
}

interface Variant {
  label: string;
  matches: (c: GateCandidate) => boolean;
}

function spread<T>(items: T[], size: number): T[] {
  if (items.length <= size) return items.slice();
  const stride = items.length / size;
  const out: T[] = [];
  for (let i = 0; out.length < size && Math.floor(i * stride) < items.length; i++) {
    out.push(items[Math.floor(i * stride)]);
  }
  return out;
}

const pct = (x: number | null): string => (x === null ? '  n/a' : `${(x * 100).toFixed(1)}%`);

export async function testTerms(): Promise<void> {
  const perTerm = Number(process.env.GATE_TERM_SAMPLE ?? '20');
  const corpus = readGateCorpus();
  if (corpus.length === 0) throw new Error('No frozen corpus. Run npm run gate:harvest.');

  const scored = corpus.map((c) => ({ c, d: decide(c), hash: candidateHash(c) }));
  const admitted = scored.filter((r) => r.d.admitted);
  const rejected = scored.filter((r) => !r.d.admitted);

  // BASELINE RATES, pooled over every labelled record rather than per sample:
  // the projections need the best point estimate available, and the two-sample
  // split exists to test agreement, not to be averaged.
  const labels = await labelCandidates([]);
  const rateOver = (rows: typeof scored): { n: number; k: number; rate: number | null } => {
    let n = 0;
    let k = 0;
    for (const r of rows) {
      const l = labels.get(r.hash);
      if (!l) continue;
      n++;
      if (l.relevant) k++;
    }
    return { n, k, rate: n ? k / n : null };
  };
  const baseP = rateOver(admitted);
  const baseM = rateOver(rejected);
  if (baseP.rate === null || baseM.rate === null) {
    throw new Error('No baseline labels. Run npm run gate:measure first.');
  }
  // The estimated relevant population, which is what recall is a share of. It
  // does not change when the gate changes - only which side of the gate the
  // relevant records land on does.
  const relevantTotal = admitted.length * baseP.rate + rejected.length * baseM.rate;
  const baseRecall = (admitted.length * baseP.rate) / relevantTotal;

  console.log('\n===== PART 2: DEAL VOCABULARY, TERM BY TERM =====');
  console.log(`Corpus: ${corpus.length} candidates, ${admitted.length} admitted, ${rejected.length} rejected.`);
  console.log(
    `Baseline (pooled): precision ${pct(baseP.rate)} (${baseP.k}/${baseP.n}), ` +
      `reject-relevant ${pct(baseM.rate)} (${baseM.k}/${baseM.n}), recall ${pct(baseRecall)}.`
  );
  console.log(
    `Each term is measured over the ${rejected.length} records the gate currently REJECTS. ` +
      `Up to ${perTerm} of each term's hits are labelled.`
  );
  // ENRICHMENT BIAS, stated where the numbers are read. This tool labels records
  // chosen BECAUSE a candidate term fires on them, which is a positive-enriched
  // sample by construction. That inflates the pooled reject-relevant rate above,
  // and so deflates the pooled recall - the more terms tested, the lower this
  // baseline drifts. The per-term columns are the point of this tool and are
  // unaffected; the HEADLINE recall comes from gate:measure, whose samples are
  // drawn without reference to any term.
  console.log(
    '  NOTE: the pooled baseline above is positive-enriched by this tool\'s own targeted labelling.'
  );
  console.log(
    '  Headline precision and recall come from npm run gate:measure, not from this line.'
  );

  const terms = process.env.GATE_TERMS
    ? process.env.GATE_TERMS.split(',').map((t) => t.trim()).filter(Boolean)
    : [...DEAL_CANDIDATES];

  // Label every variant's sample in ONE pass, so the judging is a single batch
  // rather than a serial trickle per term.
  const plan: { term: string; variant: Variant; hits: typeof scored; sample: typeof scored }[] = [];
  for (const term of terms) {
    const variants: Variant[] = [
      { label: 'alone', matches: (c) => hasWord(c.gate_text, term) },
      {
        // The variant the first run was missing, and the one the design actually
        // needs: match alone, but never on a detached-residential filing. The
        // Toll South LV single-family development agreement must stay rejected
        // whatever the aggregate numbers say.
        label: 'alone, minus detached residential',
        matches: (c) => hasWord(c.gate_text, term) && !isDetachedResidential(c.gate_text),
      },
      {
        // The variant that matters for a VENUE noun: is the term safe alone
        // (STRONG), or does it only behave when an entitlement action corroborates
        // it (WEAK)? 'theater' is the case - a meeting held AT a theater is not a
        // theater project.
        label: 'with an entitlement action',
        matches: (c) =>
          hasWord(c.gate_text, term) && governmentGate(c.gate_text).actionHits.length > 0,
      },
      {
        label: 'with named private party',
        matches: (c) => hasWord(c.gate_text, term) && hasPrivateParty(c.gate_text),
      },
      {
        label: 'party, minus detached residential',
        matches: (c) =>
          hasWord(c.gate_text, term) &&
          hasPrivateParty(c.gate_text) &&
          !isDetachedResidential(c.gate_text),
      },
    ];
    for (const variant of variants) {
      const hits = rejected.filter((r) => variant.matches(r.c));
      const ordered = hits.slice().sort((a, b) => a.c.key.localeCompare(b.c.key));
      plan.push({ term, variant, hits, sample: spread(ordered, perTerm) });
    }
  }
  const toLabel = new Map<string, GateCandidate>();
  for (const p of plan) for (const r of p.sample) toLabel.set(r.hash, r.c);
  const allLabels = await labelCandidates([...toLabel.values()]);
  const tiers = await tierCandidates([...toLabel.values()]);

  const rateOf = (
    rows: typeof scored,
    ls: Map<string, GateLabel>
  ): { n: number; k: number; rate: number | null } => {
    let n = 0;
    let k = 0;
    for (const r of rows) {
      const l = ls.get(r.hash);
      if (!l) continue;
      n++;
      if (l.relevant) k++;
    }
    return { n, k, rate: n ? k / n : null };
  };
  const tierTally = (rows: typeof scored, ts: Map<string, GateTierLabel>): string => {
    const t = { headline: 0, context: 0, noise: 0 };
    for (const r of rows) {
      const x = ts.get(r.hash)?.tier;
      if (x) t[x]++;
    }
    return `${t.headline}H/${t.context}C/${t.noise}N`;
  };

  console.log(
    '\nterm                                          variant                              hits  lbl  rel   own prec  tiers        prec ->        recall ->'
  );
  for (const p of plan) {
    const r = rateOf(p.sample, allLabels);
    // Projection: admit this variant's hits at the term's own measured precision.
    const newTp = admitted.length * baseP.rate + p.hits.length * (r.rate ?? 0);
    const newPrecision =
      admitted.length + p.hits.length > 0 ? newTp / (admitted.length + p.hits.length) : null;
    const newRecall = relevantTotal > 0 ? newTp / relevantTotal : null;
    const dP = newPrecision === null ? 0 : (newPrecision - baseP.rate) * 100;
    const dR = newRecall === null ? 0 : (newRecall - baseRecall) * 100;
    console.log(
      `  ${p.term.padEnd(42)} ${p.variant.label.padEnd(34)} ` +
        `${String(p.hits.length).padStart(4)} ${String(r.n).padStart(4)} ${String(r.k).padStart(4)}  ` +
        `${pct(r.rate).padStart(7)}  ${tierTally(p.sample, tiers).padEnd(10)} ` +
        `${pct(newPrecision)} (${dP >= 0 ? '+' : ''}${dP.toFixed(1)})  ` +
        `${pct(newRecall)} (${dR >= 0 ? '+' : ''}${dR.toFixed(1)})`
    );
  }

  // What each term actually fires on, because a hit count is not evidence.
  console.log('\nWHAT EACH TERM FIRES ON (alone), up to 4 examples each:');
  for (const p of plan.filter((x) => x.variant.label === 'alone')) {
    console.log(`\n  ${p.term} -> ${p.hits.length} hits`);
    if (p.hits.length === 0) {
      console.log('      (fires on nothing in this corpus)');
      continue;
    }
    for (const r of spread(p.sample, 4)) {
      const l = allLabels.get(r.hash);
      const t = tiers.get(r.hash);
      console.log(
        `      [${l ? (l.relevant ? 'RELEVANT' : 'not rel.') : 'unlabelled'}${t ? '/' + t.tier : ''}] ` +
          `${r.c.title.replace(/\s+/g, ' ').slice(0, 92)}`
      );
    }
  }
  console.log('\n================================================\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  testTerms().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
