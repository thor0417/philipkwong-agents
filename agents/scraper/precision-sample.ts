// PRECISION SAMPLE for the government gate.
//
// The audit measured gate precision by hand, once. That is not a thing you can
// re-run after changing GOV_GATE_EXCLUSIONS, so this makes it repeatable: the
// same sample, in the same order, every time, so two runs can be diffed and a
// change in the exclusion list can be judged rather than guessed at.
//
// It does NOT claim to judge relevance automatically. There is no oracle for
// "is this a leisure development record"; that is Philip's call and a machine
// pretending otherwise would be the same kind of quiet wrongness this brief is
// about. What it does is put the evidence in one place: the distribution of gate
// verdicts over the whole live corpus, and a deterministic sample of records
// with the exact terms each was admitted on.
//
// The sample is deterministic without a random seed: rows are ordered by id
// (stable, server-side) and taken at a fixed stride, so it spreads across the
// corpus and does not move between runs unless the corpus does.
//
// Run: node --env-file=.env.local --import tsx agents/scraper/precision-sample.ts
//      SAMPLE_SIZE=40 to widen it.

import { pathToFileURL } from 'node:url';
import { governmentGate } from '../../lib/taxonomy';
import { bypassesGate, bypassHits } from './targets';
import { selectAllPaged } from './page-select';

interface Row {
  id: string;
  title: string | null;
  source: string | null;
  status: string | null;
  raw_content: string | null;
  project_id: string | null;
}

export async function precisionSample(size: number = 25): Promise<void> {
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,source,status,raw_content,project_id',
    (q: unknown) => (q as { eq: (a: string, b: string) => unknown }).eq('stream', 'government'),
    'precision-sample'
  );
  if (!complete) {
    console.error('Precision sample: read was partial; the numbers would be meaningless.');
    return;
  }
  const live = rows.filter((r) => String(r.status) !== 'dismissed').sort((a, b) => a.id.localeCompare(b.id));

  console.log('===== GOVERNMENT GATE PRECISION SAMPLE =====');
  console.log(`\nCorpus: ${rows.length} government records, ${live.length} live, ${rows.length - live.length} dismissed.`);

  // Distribution over the whole live corpus, re-gated on each record's own
  // subject as the write path does.
  const dist: Record<string, number> = {};
  const bySource: Record<string, Record<string, number>> = {};
  for (const r of live) {
    const v = governmentGate(String(r.title ?? ''));
    const bypass = bypassesGate(`${r.title ?? ''}\n${r.raw_content ?? ''}`);
    const key = v.matched ? v.reason : bypass ? 'bypass-only' : `would-not-capture:${v.reason}`;
    dist[key] = (dist[key] ?? 0) + 1;
    const s = String(r.source);
    bySource[s] ??= {};
    bySource[s][key] = (bySource[s][key] ?? 0) + 1;
  }
  console.log('\nGATE VERDICT over the live corpus (re-gated on each record\'s own subject):');
  for (const [k, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${(((n / live.length) * 100).toFixed(1) + '%').padStart(6)}  ${k}`);
  }
  console.log('\nBY SOURCE:');
  for (const [s, d] of Object.entries(bySource).sort()) {
    const total = Object.values(d).reduce((a, b) => a + b, 0);
    const strong = (d['strong'] ?? 0) + (d['bypass-only'] ?? 0);
    console.log(`  ${s.padEnd(15)} ${String(total).padStart(4)} records, ${String(strong).padStart(4)} on a strong term or a named target (${((strong / total) * 100).toFixed(0)}%)`);
  }

  // Deterministic spread across the corpus.
  const stride = Math.max(1, Math.floor(live.length / size));
  const sample = live.filter((_, i) => i % stride === 0).slice(0, size);
  console.log(`\nSAMPLE of ${sample.length}, every ${stride}th record by id. Judge each as relevant or not:`);
  for (const r of sample) {
    const v = governmentGate(String(r.title ?? ''));
    const hits = bypassHits(`${r.title ?? ''}\n${r.raw_content ?? ''}`);
    const evidence =
      v.strongHits.length ? `STRONG: ${v.strongHits.join(', ')}`
      : v.dealHits.length && v.reason === 'deal' ? `DEAL: ${v.dealHits.join(', ')}`
      : v.weakHits.length ? `weak: ${v.weakHits.join(', ')} + action: ${v.actionHits.join(', ') || 'none'}`
      : hits.length ? `target: ${[...new Set(hits.map((h) => h.term))].join(', ')}`
      : 'no gate evidence on the subject';
    console.log(`\n  ${String(r.source).padEnd(14)} ${v.reason.padEnd(20)} proj=${r.project_id ? 'Y' : '-'}`);
    console.log(`    ${evidence}`);
    console.log(`    "${String(r.title ?? '').replace(/\s+/g, ' ').slice(0, 108)}"`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  precisionSample(Number(process.env.SAMPLE_SIZE ?? '25')).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
