// READ-ONLY. FETCH THE FULL TEXT OF REAL DOCUMENTS AND PUT IT ON DISK.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/doc-corpus.ts <outdir>
//
// Nothing is written to the database. The text lands in a scratch directory so
// the vocabulary and content passes can read the SAME documents twice without
// re-fetching, which matters because re-fetching would let two measurements
// disagree about what a document says.
//
// EVERY ATTACHMENT, INCLUDING THE ONES THE EXTRACTOR SKIPS. rankAttachments
// drops anything whose filename reads as a drawing - site plans, elevations,
// exhibit sets, surveys - and stops at the first document carrying a contact
// block. That is the right economy for the contact lane and the wrong sample for
// this brief: a title block, a preparer statement and a certification page are
// exactly the places a design team is named, and all three live in the documents
// currently skipped unread.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { fetchPdfPages } from '../sources/pdf-agenda';

const OUT = process.argv[2];
if (!OUT) { console.error('usage: doc-corpus.ts <outdir>'); process.exit(1); }
mkdirSync(OUT, { recursive: true });

const BASE = 'https://webapi.legistar.com/v1';
const UA = 'philipkwong-agents/1.0 (+scraper)';
const CONCURRENCY = 4;

interface Lead {
  id: string; url: string | null; title: string | null; source: string | null;
  status: string | null; location: string | null; market: string | null;
  project_id: string | null; primary_document_url: string | null;
  has_primary_document: boolean | null;
}

interface Doc {
  file: string; jurisdiction: string; adapter: string; docName: string;
  url: string; leadId: string; leadTitle: string; pages: number; chars: number;
}

function matterRef(url: string): { client: string; id: number } | null {
  try {
    const u = new URL(url);
    const client = u.hostname.split('.')[0];
    const q = u.searchParams.get('ID');
    if (q && /^\d+$/.test(q) && u.searchParams.get('M') === 'l') return { client, id: Number(q) };
    const h = /#matter-(\d+)/.exec(url);
    if (h) return { client, id: Number(h[1]) };
    return null;
  } catch { return null; }
}

async function listAttachments(client: string, id: number): Promise<{ name: string; url: string }[]> {
  try {
    const res = await fetch(`${BASE}/${client}/Matters/${id}/Attachments`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((a: any) => a?.MatterAttachmentHyperlink)
      .map((a: any) => ({ name: String(a.MatterAttachmentName ?? '(unnamed)'), url: String(a.MatterAttachmentHyperlink) }));
  } catch { return []; }
}

async function main(): Promise<void> {
  const rows: Lead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,url,title,source,status,location,market,project_id,primary_document_url,has_primary_document')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Lead[]));
    if (data.length < 1000) break;
  }
  const live = rows.filter((r) => r.status !== 'dismissed');

  // ---- the work list --------------------------------------------------------
  const work: { jurisdiction: string; adapter: string; docName: string; url: string; lead: Lead }[] = [];

  // 1. Every attachment on every Legistar matter.
  for (const r of live.filter((x) => x.source === 'legistar' && x.url && matterRef(x.url))) {
    const ref = matterRef(r.url!)!;
    for (const a of await listAttachments(ref.client, ref.id)) {
      work.push({ jurisdiction: r.location ?? ref.client, adapter: 'legistar', docName: a.name, url: a.url, lead: r });
    }
  }
  console.log(`legistar attachments listed: ${work.length}`);

  // 2. The document each non-Legistar adapter already points at, where it is a
  //    real document rather than the record's own page.
  const seen = new Set(work.map((w) => w.url));
  for (const r of live) {
    if (r.source === 'legistar') continue;
    if (r.has_primary_document !== true || !r.primary_document_url) continue;
    if (seen.has(r.primary_document_url)) continue;
    seen.add(r.primary_document_url);
    work.push({
      jurisdiction: r.location ?? r.market ?? '(unknown)',
      adapter: r.source ?? '(none)',
      docName: r.title ?? '(untitled)',
      url: r.primary_document_url,
      lead: r,
    });
  }
  console.log(`plus adapter primary documents: ${work.length} total\n`);

  const docs: Doc[] = [];
  let next = 0;
  let done = 0;
  async function worker(): Promise<void> {
    while (next < work.length) {
      const i = next++;
      const w = work[i];
      const pages = await fetchPdfPages(w.url);
      done++;
      if (done % 20 === 0) console.log(`  ...${done}/${work.length}`);
      if (!pages || pages.length === 0) continue;
      const text = pages.join('\n\n----PAGE----\n\n');
      const file = `${String(i).padStart(4, '0')}.txt`;
      writeFileSync(join(OUT, file), text, 'utf8');
      docs.push({
        file, jurisdiction: w.jurisdiction, adapter: w.adapter, docName: w.docName,
        url: w.url, leadId: w.lead.id, leadTitle: w.lead.title ?? '', pages: pages.length, chars: text.length,
      });
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, work.length) }, worker));

  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(docs, null, 1), 'utf8');
  console.log(`\nfetched and parsed: ${docs.length} of ${work.length}`);
  const byJ = new Map<string, number>();
  for (const d of docs) byJ.set(d.jurisdiction, (byJ.get(d.jurisdiction) ?? 0) + 1);
  for (const [j, n] of [...byJ.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${j.padEnd(30)}${n}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
