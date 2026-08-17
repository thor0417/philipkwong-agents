// READ-ONLY. WHAT THE JURISDICTIONS WITH NO ATTACHMENT PUBLISH INSTEAD.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/doc-elsewhere.ts
//
// Part 1 question 4. "No attachment" is not the same as "nothing published", and
// the difference decides whether a jurisdiction is a parsing problem or a
// coverage problem. Nothing is written.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const UA = 'philipkwong-agents/1.0 (+scraper)';

interface Lead {
  id: string; url: string | null; title: string | null; source: string | null;
  status: string | null; location: string | null; market: string | null;
  raw_content: string | null; primary_document_url: string | null;
  has_primary_document: boolean | null;
}

async function head(url: string): Promise<string> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    const ct = res.headers.get('content-type') ?? '';
    const body = ct.includes('html') || ct.includes('text') ? await res.text() : '';
    return `HTTP ${res.status} ${ct.split(';')[0]}${body ? ` ${body.length} bytes` : ''}`;
  } catch (e) {
    return `unreachable (${String(e).slice(0, 60)})`;
  }
}

async function main(): Promise<void> {
  const rows: Lead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,url,title,source,status,location,market,raw_content,primary_document_url,has_primary_document')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Lead[]));
    if (data.length < 1000) break;
  }
  const live = rows.filter((r) => r.status !== 'dismissed');

  // ---- NEW YORK, THE FIVE THAT CLAIM A DOCUMENT -----------------------------
  console.log('===== NEW YORK: THE FIVE RECORDS THAT CLAIM A DOCUMENT =====\n');
  const nyDocs = live.filter((r) => r.source === 'nyc-city-record' && r.has_primary_document === true);
  for (const r of nyDocs) {
    console.log(`\n${(r.title ?? '').slice(0, 80)}`);
    console.log(`  document: ${r.primary_document_url}`);
    console.log(`  ${await head(r.primary_document_url!)}`);
  }

  // ---- WHAT EACH ADAPTER PUTS IN raw_content INSTEAD -------------------------
  console.log('\n\n===== WHAT EACH ADAPTER CAPTURES INSTEAD OF A DOCUMENT =====\n');
  console.log('The record text itself, which is what a jurisdiction with no readable');
  console.log('attachment actually gives us. Length is the measure of how much a');
  console.log('reader would have to work with if documents never improve.\n');
  const bySource = new Map<string, Lead[]>();
  for (const l of live) {
    if (!(l.source ?? '').match(/legistar|agenda-portal|nyc-|clark-tab|cftod|ceqanet|sfwmd|govdoc/)) continue;
    bySource.set(l.source!, [...(bySource.get(l.source!) ?? []), l]);
  }
  console.log('adapter            records   raw_content chars min/med/max');
  for (const [s, list] of [...bySource.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const lens = list.map((l) => (l.raw_content ?? '').length).sort((a, b) => a - b);
    console.log(
      `${s.padEnd(18)}${String(list.length).padStart(6)}   ${String(lens[0]).padStart(6)} / ${String(lens[Math.floor(lens.length / 2)]).padStart(6)} / ${String(lens[lens.length - 1]).padStart(7)}`
    );
  }

  console.log('\n--- one record text per adapter, verbatim, first 400 characters ---');
  for (const [s, list] of bySource) {
    const withText = list.find((l) => (l.raw_content ?? '').length > 200) ?? list[0];
    console.log(`\n[${s}] ${(withText.title ?? '').slice(0, 70)}`);
    console.log(`  ${(withText.raw_content ?? '').replace(/\s+/g, ' ').slice(0, 400)}`);
  }

  // ---- DOES AN ANAHEIM AGENDA POINT AT A STAFF REPORT? ----------------------
  console.log('\n\n===== DOES THE ANAHEIM AGENDA POINT AT ANYTHING DEEPER? =====\n');
  const anaheim = live.filter((r) => r.source === 'agenda-portal' && (r.location ?? '').includes('Anaheim'));
  const refWords = /(staff report|attachment|exhibit|available for (public )?(review|inspection)|on file|planning\.anaheim|link)/gi;
  let withRef = 0;
  const examples: string[] = [];
  for (const r of anaheim) {
    const t = r.raw_content ?? '';
    const m = t.match(refWords);
    if (m && m.length) {
      withRef++;
      if (examples.length < 4) {
        const at = t.search(refWords);
        examples.push(t.replace(/\s+/g, ' ').slice(Math.max(0, at - 60), at + 160));
      }
    }
  }
  console.log(`Anaheim agenda-portal records          : ${anaheim.length}`);
  console.log(`  whose text names a deeper document   : ${withRef}`);
  for (const e of examples) console.log(`    "${e}"`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
