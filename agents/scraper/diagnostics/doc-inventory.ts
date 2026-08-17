// READ-ONLY. WHAT THE CORPUS HOLDS BY WAY OF DOCUMENTS.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/doc-inventory.ts
//
// Nothing is written. No column is added. This answers Part 1 question 1 and the
// first of the two additions: per jurisdiction, what share of LIVE PROJECTS carry
// a record with a readable document behind it, because that share is the ceiling
// on everything a document reader could ever produce.
//
// THE DISTINCTION THAT MATTERS HERE. Three different things get called "we have
// the document":
//   url                    the page the record was captured from. Always present.
//   primary_document_url   set ONLY when legistar-attachments found a contact
//                          block in it. A matter with five attachments and no
//                          labeled party has none, so this UNDERCOUNTS what is
//                          reachable and is not the answer to "can it be read".
//   contacts block         the provenance note appended to raw_content, which is
//                          proof a document was fetched, parsed and read.
// The gap between the second and what the source actually publishes is what
// doc-probe measures against the live API.

import { supabaseAdmin } from '../../../lib/supabase-admin';

interface Lead {
  id: string; url: string | null; source: string | null; source_type: string | null;
  stream: string | null; status: string | null; market: string | null;
  location: string | null; project_id: string | null;
  primary_document_url: string | null; has_primary_document: boolean | null;
  raw_content: string | null;
  applicant: string | null; representative: string | null; presented_by: string | null;
}
interface Proj { id: string; name: string; status: string | null; market: string | null; region_state: string | null }

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

const CONTACT_BLOCK = '--- contacts from the matter documents ---';

async function main(): Promise<void> {
  const projects = await pageAll<Proj>('projects', 'id,name,status,market,region_state');
  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted');
  const liveById = new Map(live.map((p) => [p.id, p]));

  const leads = await pageAll<Lead>(
    'leads',
    'id,url,source,source_type,stream,status,market,location,project_id,primary_document_url,has_primary_document,raw_content,applicant,representative,presented_by'
  );
  // Filings only. A press URL is not a document in the sense this brief means.
  const filings = leads.filter(
    (l) => l.status !== 'dismissed' && (l.stream === 'government' || l.stream === 'opportunity')
  );

  console.log('===== WHAT THE CORPUS HOLDS =====\n');
  console.log(`live projects                 : ${live.length}`);
  console.log(`undismissed records           : ${leads.filter((l) => l.status !== 'dismissed').length}`);
  console.log(`  government or opportunity   : ${filings.length}`);
  console.log(`  attached to a live project  : ${filings.filter((l) => l.project_id && liveById.has(l.project_id)).length}`);

  // ---- BY SOURCE ADAPTER ----------------------------------------------------
  console.log('\n\n===== BY ADAPTER: IS A DOCUMENT READ AT ALL =====\n');
  console.log('An adapter is the unit here rather than a market, because whether a');
  console.log('document can be read is a property of the publisher, not of the place.\n');
  console.log('adapter          records  REAL doc  contacts read   applicant   rep    presenter');
  const bySource = new Map<string, Lead[]>();
  for (const l of filings) {
    const k = l.source ?? '(none)';
    bySource.set(k, [...(bySource.get(k) ?? []), l]);
  }
  for (const [s, rows] of [...bySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const doc = rows.filter((r) => r.has_primary_document === true).length;
    const read = rows.filter((r) => (r.raw_content ?? '').includes(CONTACT_BLOCK)).length;
    console.log(
      `${s.slice(0, 16).padEnd(17)}${String(rows.length).padStart(6)}${String(doc).padStart(9)}${String(read).padStart(14)}` +
        `${String(rows.filter((r) => r.applicant).length).padStart(12)}${String(rows.filter((r) => r.representative).length).padStart(7)}` +
        `${String(rows.filter((r) => r.presented_by).length).padStart(12)}`
    );
  }

  // ---- THE CEILING: LIVE PROJECTS WITH A READABLE DOCUMENT ------------------
  console.log('\n\n===== THE CEILING, PER MARKET =====\n');
  console.log('What share of live projects carries a filing at all, and of those, what');
  console.log('share carries a filing whose own document we have fetched and parsed.');
  console.log('The second column is the ceiling on any document reader.\n');

  const marketOf = (p: Proj) => p.market ?? p.region_state ?? '(no market)';
  const rows = new Map<string, { live: number; filed: number; doc: number; read: number }>();
  for (const p of live) {
    const m = marketOf(p);
    rows.set(m, rows.get(m) ?? { live: 0, filed: 0, doc: 0, read: 0 });
    rows.get(m)!.live++;
  }
  const filedProjects = new Set<string>();
  const docProjects = new Set<string>();
  const readProjects = new Set<string>();
  for (const l of filings) {
    if (!l.project_id || !liveById.has(l.project_id)) continue;
    filedProjects.add(l.project_id);
    if (l.has_primary_document === true) docProjects.add(l.project_id);
    if ((l.raw_content ?? '').includes(CONTACT_BLOCK)) readProjects.add(l.project_id);
  }
  for (const pid of filedProjects) rows.get(marketOf(liveById.get(pid)!))!.filed++;
  for (const pid of docProjects) rows.get(marketOf(liveById.get(pid)!))!.doc++;
  for (const pid of readProjects) rows.get(marketOf(liveById.get(pid)!))!.read++;

  console.log('market                          live   w/filing   w/REALdoc  share   contacts read');
  for (const [m, s] of [...rows.entries()].sort((a, b) => b[1].live - a[1].live)) {
    console.log(
      `${m.slice(0, 30).padEnd(32)}${String(s.live).padStart(4)}${String(s.filed).padStart(11)}${String(s.doc).padStart(11)}${pct(s.doc, s.live).padStart(8)}${String(s.read).padStart(15)}`
    );
  }
  console.log(
    `\nWHOLE CORPUS                    ${String(live.length).padStart(4)}${String(filedProjects.size).padStart(11)}${String(docProjects.size).padStart(11)}${pct(docProjects.size, live.length).padStart(8)}${String(readProjects.size).padStart(15)}`
  );

  // ---- NEW YORK, ASKED FOR BY NAME -----------------------------------------
  console.log('\n\n===== NEW YORK, SPECIFICALLY =====\n');
  const nyAdapters = ['nyc-zap', 'nyc-ceqr', 'nyc-city-record'];
  for (const a of nyAdapters) {
    const rowsA = filings.filter((l) => l.source === a);
    if (!rowsA.length) { console.log(`${a}: no records`); continue; }
    const doc = rowsA.filter((r) => r.has_primary_document === true).length;
    const read = rowsA.filter((r) => (r.raw_content ?? '').includes(CONTACT_BLOCK)).length;
    console.log(`${a.padEnd(18)} ${String(rowsA.length).padStart(4)} records, ${doc} carry a REAL document, ${read} had contacts read out of one`);
    const sample = rowsA[0];
    console.log(`   example url : ${sample.url}`);
    console.log(`   raw_content : ${(sample.raw_content ?? '').replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
