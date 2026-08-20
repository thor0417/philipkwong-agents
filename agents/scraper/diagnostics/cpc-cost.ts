// READ-ONLY. WHAT DOES READING A CPC REPORT COST, AGAINST A CLARK STAFF REPORT?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/cpc-cost.ts
//
// Nothing is written and no reader is built. A CPC report is 163 pages where a
// Clark County staff report is a handful, and "we could read New York the way we
// read Clark County" is only true if the per-document cost is in the same order.
// This times fetch and parse separately, because they are different problems: a
// slow fetch is a scheduling question and a slow parse is a runtime one.
//
// IT USES THE SAME pdf-parse THE CAPTURE LANE USES, so the number is the number
// rather than an estimate from page count.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const UA = 'philipkwong-agents/1.0 (+development intelligence)';
const CPC = (n: string) => `https://www.nyc.gov/assets/planning/download/pdf/about/cpc/${n}.pdf`;

// The numbers measured as reachable by nyc-cpc-reach. Hardcoded HERE and only
// here, because this file is a stopwatch rather than a lane.
const CPC_NUMBERS = ['240092', '250108', '250224', '250326', '230070', '240353', '250046'];

interface Timing {
  label: string;
  bytes: number;
  pages: number;
  chars: number;
  fetchMs: number;
  parseMs: number;
}

async function timeOne(label: string, url: string): Promise<Timing | string> {
  const t0 = Date.now();
  let buf: Buffer;
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return `${label}: HTTP ${res.status}`;
    buf = Buffer.from(await res.arrayBuffer());
  } catch (e) {
    return `${label}: ${String(e).slice(0, 50)}`;
  }
  const fetchMs = Date.now() - t0;
  if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return `${label}: not a pdf (${buf.length}b)`;
  const t1 = Date.now();
  const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
  const data = await pdf(buf);
  const parseMs = Date.now() - t1;
  return {
    label,
    bytes: buf.length,
    pages: data.numpages,
    chars: String(data.text ?? '').length,
    fetchMs,
    parseMs,
  };
}

async function main(): Promise<void> {
  const rows: Timing[] = [];
  const failures: string[] = [];

  console.log('='.repeat(100));
  console.log('COST OF READING A CPC REPORT');
  console.log('='.repeat(100));
  for (const n of CPC_NUMBERS) {
    const r = await timeOne(`cpc ${n}`, CPC(n));
    if (typeof r === 'string') failures.push(r);
    else rows.push(r);
    await new Promise((x) => setTimeout(x, 400));
  }

  // ---- THE COMPARISON, AND IT HAS TO BE A REAL CLARK DOCUMENT ---------------
  //
  // Taken from the corpus rather than invented: the primary_document_url on a
  // Clark County record is the staff report the 51 conditions were read out of.
  const { data: clark } = await supabaseAdmin
    .from('leads')
    .select('primary_document_url,title')
    .eq('source', 'legistar')
    .not('primary_document_url', 'is', null)
    .limit(6);
  for (const c of clark ?? []) {
    const r = await timeOne(`clark ${String(c.title ?? '').slice(0, 22)}`, String(c.primary_document_url));
    if (typeof r === 'string') failures.push(r);
    else rows.push(r);
    await new Promise((x) => setTimeout(x, 400));
  }

  console.log('');
  console.log('  label                          pages   chars     MB   fetch ms   parse ms   total');
  console.log('  ' + '-'.repeat(88));
  for (const r of rows) {
    console.log(
      `  ${r.label.slice(0, 28).padEnd(29)} ${String(r.pages).padStart(5)} ${String(r.chars).padStart(8)} ` +
        `${(r.bytes / 1e6).toFixed(2).padStart(6)} ${String(r.fetchMs).padStart(10)} ${String(r.parseMs).padStart(10)} ` +
        `${String(r.fetchMs + r.parseMs).padStart(7)}`
    );
  }
  for (const f of failures) console.log(`  ${f}`);

  const group = (pre: string) => rows.filter((r) => r.label.startsWith(pre));
  const stat = (rs: Timing[], pick: (r: Timing) => number) => {
    if (rs.length === 0) return { median: 0, max: 0 };
    const v = rs.map(pick).sort((a, b) => a - b);
    return { median: v[Math.floor(v.length / 2)], max: v[v.length - 1] };
  };
  console.log('');
  console.log('-'.repeat(100));
  for (const [name, rs] of [['CPC', group('cpc')], ['Clark', group('clark')]] as [string, Timing[]][]) {
    if (rs.length === 0) {
      console.log(`  ${name}: no document read`);
      continue;
    }
    const f = stat(rs, (r) => r.fetchMs);
    const p = stat(rs, (r) => r.parseMs);
    const t = stat(rs, (r) => r.fetchMs + r.parseMs);
    const pg = stat(rs, (r) => r.pages);
    console.log(
      `  ${name.padEnd(6)} n=${String(rs.length).padStart(2)}  pages median ${String(pg.median).padStart(4)} max ${String(pg.max).padStart(4)}  ` +
        `fetch median ${String(f.median).padStart(6)}ms  parse median ${String(p.median).padStart(6)}ms  ` +
        `TOTAL median ${String(t.median).padStart(6)}ms max ${String(t.max).padStart(6)}ms`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
