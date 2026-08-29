// READ-ONLY. WHICH PARTY LABELS DO CLARK COUNTY AND ANAHEIM ACTUALLY PUBLISH?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/contact-label-census.ts [--market=Anaheim]
//
// Nothing is written and nothing is proposed. This is the source-fact question
// that settled presented_by, asked of the other column: presented_by was decided
// by what the column IS, and contact_name cannot be, so the next place to look
// is what the documents themselves print.
//
// IT COUNTS LABELS IN THE CAPTURED TEXT, not names. Every label is a literal
// string the document printed, matched at a line start followed by a colon,
// which is the same shape sources/contact-labels matches on. No name is read and
// nothing is classified.
//
// THE LABEL SETS ARE THE READER'S OWN, so this reports coverage rather than an
// opinion: which labels the reader already routes, and which it would not
// recognise at all.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isHospitalityModule } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

const arg = (k: string) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? '').split('=')[1] ?? '';
const ONLY = arg('market');

// The three sets sources/contact-labels routes on, copied here ONLY to report
// coverage. This file decides nothing; if these drift the census says so by
// showing an unrouted label with a count.
const OWNER_LABELS = ['OWNER', 'PROPERTY OWNER', 'APPLICANT', 'DEVELOPER', 'SUBDIVIDER'];
const REP_LABELS = ['CONTACT', 'REPRESENTATIVE', 'AGENT', 'ATTORNEY', 'APPLICANT REPRESENTATIVE', 'AUTHORIZED AGENT'];
const PRESENTER_LABELS = ['PRESENTED BY', 'PREPARED BY', 'REQUESTED BY', 'SPONSOR', 'SUBMITTED BY', 'STAFF CONTACT', 'PETITIONER'];

const ROUTED = new Map<string, string>();
for (const l of OWNER_LABELS) ROUTED.set(l, 'applicant');
for (const l of REP_LABELS) ROUTED.set(l, 'representative');
for (const l of PRESENTER_LABELS) ROUTED.set(l, 'presented_by');

interface Lead {
  id: string;
  project_id: string | null;
  status: string | null;
  stream: string | null;
  source: string | null;
  market: string | null;
  raw_content: string | null;
  contact_name: string | null;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return out;
}

// A LABEL IS A LINE THAT INTRODUCES A VALUE. Matched at a line start, in capitals
// or title case, up to four words, followed by a colon - the same shape the
// reader matches. Deliberately broad: the point is to find labels the reader
// does NOT know, so a narrow pattern would hide the answer.
const LABEL_RE = /^[ \t]*([A-Z][A-Za-z][A-Za-z/&' .-]{1,38}?)[ \t]*:/gm;

async function main(): Promise<void> {
  const projects = await pageAll<{ id: string; module: string | null; status: string | null; country: string | null; stage: string | null; market: string | null }>(
    'projects',
    'id,module,status,country,stage,market'
  );
  const live = new Set(
    projects
      .filter((p) => isHospitalityModule(p.module) && p.status !== 'dismissed' && inCorpusScope(p.country) && p.stage !== 'dormant')
      .map((p) => p.id)
  );
  const marketOf = new Map(projects.map((p) => [p.id, p.market]));

  const leads = await pageAll<Lead>(
    'leads',
    'id,project_id,status,stream,source,market,raw_content,contact_name'
  );

  const wanted = leads.filter((l) => {
    if (l.status === 'dismissed' || (l.stream ?? '') !== 'government') return false;
    if (!l.project_id || !live.has(l.project_id)) return false;
    const m = marketOf.get(l.project_id) ?? l.market ?? '';
    if (ONLY) return String(m).toLowerCase().includes(ONLY.toLowerCase());
    return /clark county|anaheim|las vegas/i.test(String(m));
  });

  console.log('='.repeat(100));
  console.log(`PARTY LABELS IN THE CAPTURED TEXT   ${wanted.length} government records on live projects`);
  console.log(ONLY ? `  market filter: ${ONLY}` : '  markets: Clark County, Anaheim, Las Vegas');
  console.log('='.repeat(100));
  const withText = wanted.filter((l) => (l.raw_content ?? '').trim().length > 0);
  console.log(`  records carrying raw_content at all: ${withText.length} of ${wanted.length}`);
  console.log('');

  // marketed label counts
  const counts = new Map<string, { n: number; markets: Set<string>; sources: Set<string> }>();
  for (const l of withText) {
    const m = String(marketOf.get(l.project_id!) ?? l.market ?? '(none)');
    const text = String(l.raw_content ?? '');
    const seen = new Set<string>();
    LABEL_RE.lastIndex = 0;
    let hit: RegExpExecArray | null;
    while ((hit = LABEL_RE.exec(text))) {
      const label = hit[1].trim().toUpperCase();
      if (label.length < 3) continue;
      if (seen.has(label)) continue;
      seen.add(label);
      if (!counts.has(label)) counts.set(label, { n: 0, markets: new Set(), sources: new Set() });
      const c = counts.get(label)!;
      c.n++;
      c.markets.add(m);
      c.sources.add(l.source ?? '?');
    }
  }

  const rows = [...counts.entries()].sort((a, b) => b[1].n - a[1].n);
  const routed = rows.filter(([l]) => ROUTED.has(l));
  const unrouted = rows.filter(([l]) => !ROUTED.has(l));

  console.log('-'.repeat(100));
  console.log('LABELS THE READER ALREADY ROUTES');
  console.log('-'.repeat(100));
  console.log('    n  routes to        markets                        label');
  for (const [label, c] of routed) {
    console.log(
      `  ${String(c.n).padStart(3)}  ${String(ROUTED.get(label)).padEnd(16)} ${[...c.markets].join(',').slice(0, 30).padEnd(31)} ${label}`
    );
  }

  console.log('');
  console.log('-'.repeat(100));
  console.log(`LABELS THE READER DOES NOT ROUTE (top 40 of ${unrouted.length})`);
  console.log('-'.repeat(100));
  console.log('    n  markets                        sources              label');
  for (const [label, c] of unrouted.slice(0, 40)) {
    console.log(
      `  ${String(c.n).padStart(3)}  ${[...c.markets].join(',').slice(0, 30).padEnd(31)} ${[...c.sources].join(',').slice(0, 20).padEnd(21)} ${label}`
    );
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
