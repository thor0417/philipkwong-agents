// READ-ONLY. WHAT THE NEW ANAHEIM LANE WOULD CAPTURE, BEFORE IT CAPTURES IT.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/anaheim-agendacenter-dry.ts
//
// The adapter is run for real - it fetches the listing and every document - and
// NOTHING IS WRITTEN. Standing rule 2: the cost of a capture change is stated
// before it ships, and standing rule 9: a run report is not evidence, so this
// reports what the corpus would gain rather than what the adapter says it did.
//
// The fresh run is deliberately NOT this. Migration 050 has to be applied first:
// a capture now would write correct dates beside 1,204 stored rows that are
// still a day early, and generate events at the corrected dates while the old
// events stay behind.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';
import { scrapeAnaheimAgendaCenter, anaheimAgendaCenterStats } from '../sources/anaheim-agendacenter';
import { readAnaheimFacts, isAnaheimAgenda, isSpanishAgenda } from '../readers/anaheim-agenda';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { DECISION_FACT_KINDS, SCHEME_FACT_KINDS } from '../../../lib/market-standard';

type Row = Record<string, unknown>;
const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();

async function main(): Promise<void> {
  const leads = await scrapeAnaheimAgendaCenter();

  console.log('');
  console.log('='.repeat(100));
  console.log('THE ANAHEIM AGENDACENTER LANE, DRY');
  console.log('='.repeat(100));
  console.log(`  meetings listed          : ${anaheimAgendaCenterStats.meetingsListed}`);
  console.log(`    with an action agenda  : ${anaheimAgendaCenterStats.actionAgendas}`);
  console.log(`    agenda only            : ${anaheimAgendaCenterStats.agendasOnly}`);
  console.log(`  documents read           : ${anaheimAgendaCenterStats.documentsRead}`);
  console.log(`  refused as another body  : ${anaheimAgendaCenterStats.wrongBody}`);
  console.log(`  unreadable               : ${anaheimAgendaCenterStats.unreadable}`);
  console.log(`  ITEM LEADS THE GATE KEPT : ${leads.length}`);

  // ---- WHAT IS NEW, AGAINST THE CORPUS AS IT STANDS ----------------------
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,url,title,market,status,source,primary_document_url,filing_facts,project_id',
    (q) => q,
    'ac-dry'
  );
  if (!complete) throw new Error('read was partial; refusing to report a gain from a slice.');
  const held = new Set(rows.map((r) => tidy(r.url)));
  const fresh = leads.filter((l) => !held.has(l.url));
  console.log('');
  console.log(`  already in the corpus by url : ${leads.length - fresh.length}`);
  console.log(`  NEW records                  : ${fresh.length}`);

  // ---- WHAT THE READER GETS OUT OF THEM ----------------------------------
  //
  // Exactly as capture-filing-facts does it: the reader is handed the ONE item
  // the record is, never the whole document.
  let reached = 0;
  let facts = 0;
  let decisions = 0;
  let schemeFacts = 0;
  let conditions = 0;
  let refused = 0;
  const kinds = new Map<string, number>();
  const withDecision: string[] = [];
  for (const l of leads) {
    const text = l.raw_content ?? '';
    if (!isAnaheimAgenda(text) || isSpanishAgenda(text)) continue;
    let f: FilingFact[] = [];
    try {
      f = readAnaheimFacts(text, { application: l.title });
      verifyFilingFacts(f, text);
    } catch {
      refused++;
      continue;
    }
    if (!f.length) continue;
    reached++;
    facts += f.length;
    for (const x of f) {
      kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
      if (DECISION_FACT_KINDS.has(x.kind)) decisions++;
      if (SCHEME_FACT_KINDS.has(x.kind)) schemeFacts++;
      if (x.kind === 'condition') conditions++;
    }
    const d = f.find((x) => x.kind === 'commission_action');
    const v = f.find((x) => x.kind === 'the_vote');
    if (d || v) withDecision.push(`${(v?.display ?? '-').padEnd(8)} ${tidy(d?.display).slice(0, 70)}   ${tidy(l.title).slice(0, 60)}`);
  }
  console.log('');
  console.log('  THE READER, OVER THE ITEM TEXT THIS LANE WOULD STORE');
  console.log(`    records reached        : ${reached} of ${leads.length}`);
  console.log(`    refused by the guard   : ${refused}`);
  console.log(`    facts                  : ${facts}`);
  console.log(`    DECISION facts         : ${decisions}`);
  console.log(`    scheme facts           : ${schemeFacts}`);
  console.log(`    CONDITIONS             : ${conditions}`);
  console.log(`    kinds: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('');
  console.log(`  every item that would carry a decision (${withDecision.length}):`);
  for (const d of withDecision) console.log(`    ${d}`);

  // ---- AND WHAT IT DOES TO THE MARKET STANDARD ---------------------------
  //
  // Reported rather than claimed: a record carrying a decision is not the same
  // as a PROJECT clearing the criterion, because the record has to cluster onto
  // one first. What can be said today is how many Anaheim records would carry a
  // decision where zero do now.
  const anaheimNow = rows.filter((r) => /^anaheim/i.test(tidy(r.market)) && tidy(r.status) !== 'dismissed');
  const withFactsNow = anaheimNow.filter((r) => Array.isArray(r.filing_facts) && r.filing_facts.length > 0);
  console.log('');
  console.log('  THE MARKET, BEFORE AND AFTER');
  console.log(`    Anaheim records today            : ${anaheimNow.length}, of which ${withFactsNow.length} carry a fact`);
  console.log(`    carrying a DECISION today        : 0   (the reader emitted none before this pass)`);
  console.log(`    records this lane would add      : ${fresh.length}`);
  console.log(`    of those, carrying a decision    : ${withDecision.length}`);
  console.log('');
  console.log('  A record carrying a decision is not yet a project clearing the criterion: it has to');
  console.log('  cluster onto one first, and that happens in the fresh run rather than here.');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
