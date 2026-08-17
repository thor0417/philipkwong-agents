// READ-ONLY. WHAT THE PUBLISHERS ACTUALLY OFFER BEHIND EACH RECORD.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/doc-probe.ts
//   ... --limit 40        cap the matters probed
//   ... --fetch           also FETCH documents and measure pages and text yield
//
// Nothing is written. This asks the SOURCE, not our tables, because the question
// is what exists rather than what we captured. doc-inventory measures the second;
// this measures the first, and the gap between them is the answer to Part 1.
//
// SCOPE. Legistar jurisdictions, because they are the only publisher with a
// per-matter attachment list. The other adapters are handled by reading what they
// publish, which is stated in the report rather than probed: agenda-portal,
// clark-tab and cftod-pdf parse an agenda or minutes PDF and that PDF IS the
// document; nyc-zap, nyc-ceqr and nyc-city-record are JSON or HTML records with
// no attachment endpoint at all.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { fetchPdfPages } from '../sources/pdf-agenda';

const LIMIT = (() => {
  const i = process.argv.indexOf('--limit');
  return i > -1 ? Number(process.argv[i + 1]) : Infinity;
})();
const FETCH = process.argv.includes('--fetch');
const BASE = 'https://webapi.legistar.com/v1';
const UA = 'philipkwong-agents/1.0 (+scraper)';

interface Lead {
  id: string; url: string | null; title: string | null; source: string | null;
  status: string | null; location: string | null; project_id: string | null;
  primary_document_url: string | null;
}

// The stored public URL carries the API matter id, in one of two shapes.
function matterRef(url: string): { client: string; id: number } | null {
  try {
    const u = new URL(url);
    const client = u.hostname.split('.')[0];
    const q = u.searchParams.get('ID');
    if (q && /^\d+$/.test(q) && u.searchParams.get('M') === 'l') return { client, id: Number(q) };
    const h = /#matter-(\d+)/.exec(url);
    if (h) return { client, id: Number(h[1]) };
    return null;
  } catch {
    return null;
  }
}

// ---- WHAT KIND OF DOCUMENT IS THIS -----------------------------------------
//
// TOLD APART BY FILENAME, AND THAT IS A REAL LIMIT worth stating rather than
// hiding: a clerk names the file, so "11 26-0219-072226.pdf" is a staff report
// only because Clark County prefixes staff reports with the agenda item number.
// Where the name says nothing the class is 'unnamed', and that count is the
// honest measure of how far a filename can be trusted.
const DOC_CLASS: [string, RegExp][] = [
  ['conditions of approval', /condition/i],
  ['staff report', /staff\s*report|agenda\s*sheet|^\d+[\s_-]/i],
  ['application', /application|petition|justification|narrative/i],
  ['environmental', /\beir\b|\bceqa\b|\bnepa\b|environmental|mitigation|\bmnd\b|\beis\b/i],
  ['traffic', /traffic|circulation|\btia\b|parking\s*study/i],
  ['site plan', /site\s*plan|plot\s*plan|floor\s*plan|elevation|render|landscape|\bplat\b|survey|drawing/i],
  ['map or exhibit', /\bmaps?\b|exhibit|aerial|vicinity|legal\s*description/i],
  ['minutes', /minutes/i],
  ['agreement', /agreement|covenant|\bcc&r|deed|easement|lease/i],
  ['correspondence', /letter|memo|comment|protest|support|opposition|email/i],
  ['fiscal', /fiscal|budget|cost|financial|bond|\btif\b|appraisal/i],
  ['ordinance or resolution', /ordinance|resolution|\bbill\b/i],
  ['presentation', /presentation|slide|powerpoint|\bppt\b/i],
];

function classify(name: string): string {
  for (const [k, re] of DOC_CLASS) if (re.test(name)) return k;
  return name.trim() ? 'other named' : 'unnamed';
}

interface Attachment { MatterAttachmentName?: string; MatterAttachmentHyperlink?: string }

async function listAttachments(client: string, id: number): Promise<Attachment[] | null> {
  try {
    const res = await fetch(`${BASE}/${client}/Matters/${id}/Attachments`, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? (data as Attachment[]) : null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const rows: Lead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,url,title,source,status,location,project_id,primary_document_url')
      .eq('source', 'legistar')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Lead[]));
    if (data.length < 1000) break;
  }

  const targets = rows
    .filter((r) => r.status !== 'dismissed' && r.url && matterRef(r.url))
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log('===== LEGISTAR ATTACHMENTS, ASKED OF THE SOURCE =====\n');
  console.log(`legistar records undismissed : ${rows.filter((r) => r.status !== 'dismissed').length}`);
  console.log(`  carry a resolvable matter id: ${targets.length}\n`);

  const perJur = new Map<string, { matters: number; withAny: number; attachments: number; counts: number[] }>();
  const classCount = new Map<string, Map<string, number>>();
  const examples = new Map<string, string>();
  const fetched: { jur: string; name: string; url: string; pages: number; chars: number }[] = [];

  let done = 0;
  let next = 0;
  const CONCURRENCY = 4;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const r = targets[next++];
      const ref = matterRef(r.url!)!;
      const jur = r.location ?? ref.client;
      perJur.set(jur, perJur.get(jur) ?? { matters: 0, withAny: 0, attachments: 0, counts: [] });
      const s = perJur.get(jur)!;
      s.matters++;
      const list = await listAttachments(ref.client, ref.id);
      done++;
      if (done % 25 === 0) console.log(`  ...${done}/${targets.length}`);
      if (!list) continue;
      if (list.length) s.withAny++;
      s.attachments += list.length;
      s.counts.push(list.length);
      classCount.set(jur, classCount.get(jur) ?? new Map());
      for (const a of list) {
        const name = a.MatterAttachmentName ?? '';
        const c = classify(name);
        const m = classCount.get(jur)!;
        m.set(c, (m.get(c) ?? 0) + 1);
        if (!examples.has(`${jur}|${c}`)) examples.set(`${jur}|${c}`, name || '(no name)');
      }
      // TEXT YIELD. One document per matter, and the LAST one rather than the
      // first: the ranked-first document is the staff report the extractor
      // already reads, so measuring it tells us nothing new about what is
      // unexplored.
      if (FETCH && list.length) {
        const pick = list[list.length - 1];
        const url = pick.MatterAttachmentHyperlink;
        if (url) {
          const pages = await fetchPdfPages(url);
          if (pages) {
            fetched.push({
              jur, name: pick.MatterAttachmentName ?? '(unnamed)', url,
              pages: pages.length, chars: pages.join('').length,
            });
          }
        }
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  console.log('\n\n===== ATTACHMENTS PER MATTER =====\n');
  console.log('jurisdiction                 matters  with any   share   total   median  max');
  for (const [j, s] of [...perJur.entries()].sort((a, b) => b[1].matters - a[1].matters)) {
    const sorted = [...s.counts].sort((a, b) => a - b);
    const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
    const max = sorted.length ? sorted[sorted.length - 1] : 0;
    const share = s.matters ? ((s.withAny / s.matters) * 100).toFixed(0) + '%' : '-';
    console.log(
      `${j.slice(0, 26).padEnd(28)}${String(s.matters).padStart(6)}${String(s.withAny).padStart(10)}${share.padStart(8)}${String(s.attachments).padStart(8)}${String(median).padStart(9)}${String(max).padStart(5)}`
    );
  }

  console.log('\n\n===== WHAT THE DOCUMENTS ARE, BY FILENAME =====\n');
  for (const [j, m] of [...classCount.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    if (!total) continue;
    console.log(`--- ${j} (${total} attachments) ---`);
    for (const [c, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${c.padEnd(26)}${String(n).padStart(5)}   e.g. ${(examples.get(`${j}|${c}`) ?? '').slice(0, 70)}`);
    }
    console.log('');
  }

  if (FETCH && fetched.length) {
    console.log('\n===== PAGE COUNT AND TEXT YIELD =====\n');
    console.log('One document per matter, the LAST in the list rather than the first,');
    console.log('because the first is the one the contact extractor already reads.\n');
    const byJ = new Map<string, { pages: number[]; chars: number[] }>();
    for (const f of fetched) {
      byJ.set(f.jur, byJ.get(f.jur) ?? { pages: [], chars: [] });
      byJ.get(f.jur)!.pages.push(f.pages);
      byJ.get(f.jur)!.chars.push(f.chars);
    }
    console.log('jurisdiction                 docs   pages med/max   chars med/max   chars/page');
    for (const [j, s] of byJ) {
      const p = [...s.pages].sort((a, b) => a - b);
      const c = [...s.chars].sort((a, b) => a - b);
      const medP = p[Math.floor(p.length / 2)];
      const medC = c[Math.floor(c.length / 2)];
      console.log(
        `${j.slice(0, 26).padEnd(28)}${String(s.pages.length).padStart(5)}${String(medP).padStart(9)}/${String(p[p.length - 1]).padEnd(6)}${String(medC).padStart(9)}/${String(c[c.length - 1]).padEnd(8)}${String(medP ? Math.round(medC / medP) : 0).padStart(8)}`
      );
    }
    console.log('\n--- the ten largest, so a reader knows what it would be parsing ---');
    for (const f of [...fetched].sort((a, b) => b.chars - a.chars).slice(0, 10)) {
      console.log(`${String(f.pages).padStart(4)}p ${String(f.chars).padStart(8)}c  ${f.jur.slice(0, 18).padEnd(20)}${f.name.slice(0, 50)}`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
