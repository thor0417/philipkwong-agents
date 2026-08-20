// READ-ONLY. HOW MANY STORED VALUES ARE A FORM'S PLACEHOLDER RATHER THAN A FACT?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/placeholder-census.ts
//
// Nothing is written and nothing is proposed. "Address Not Listed In The
// Dropdown" was captured from a City Record notice and printed as an address on
// two live projects, one of them in the portfolio. That is its own shape - a UI
// affordance stored as data - and a shape that appears once appears elsewhere.
//
// ---------------------------------------------------------------------------
// IT MATCHES PHRASES, NOT PATTERNS, AND THE LIST IS DELIBERATELY SHORT.
// ---------------------------------------------------------------------------
//
// Every entry below is a string a FORM produces when a human made no choice:
// a dropdown's default option, a required field's escape hatch, a template's
// unfilled slot. None of them is a judgement about whether a value is useful -
// "Unknown" is excluded on purpose, because a source stating that a thing is
// unknown is a fact about the source and is different from a dropdown that was
// never opened.
//
// THE WHOLE VALUE MUST BE THE PLACEHOLDER, except for the dropdown phrasings,
// which appear inside a longer string ("Address Not Listed In The Dropdown").
// A substring rule on the rest would catch "None Street" and "NA Partners LLC",
// and this file exists because a string was read as the thing it names.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';

// Matched against the WHOLE trimmed value, case-insensitively.
const WHOLE_VALUE = new Set(
  [
    'n/a', 'na', 'none', 'null', 'nil', 'tbd', 'tba', 'to be determined',
    'not applicable', 'not provided', 'not specified', 'not stated', 'not available',
    'select one', 'select', 'choose one', 'choose', 'please select', '--', '---', '...',
    'see above', 'same as above', 'as above', 'no response', 'no answer',
    'enter text', 'type here', 'lorem ipsum', 'xxx', 'xxxx', 'test', 'sample',
  ].map((s) => s.toLowerCase())
);

// Matched ANYWHERE in the value. These are unmistakably a control describing
// itself, and cannot occur inside a real name or address.
const CONTAINS = [
  'not listed in the dropdown',
  'not in the dropdown',
  'select from the dropdown',
  'choose from the list',
  'no selection made',
  'default value',
];

interface Row {
  table: string;
  column: string;
  value: string;
  id: string;
  context: string;
  live: boolean;
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

function isPlaceholder(v: string): boolean {
  const t = v.trim().toLowerCase().replace(/[.\s]+$/, '');
  if (!t) return false;
  if (WHOLE_VALUE.has(t)) return true;
  return CONTAINS.some((c) => t.includes(c));
}

async function main(): Promise<void> {
  const projects = await pageAll<Record<string, unknown>>(
    'projects',
    'id,name,market,module,status,stage,primary_applicant,primary_representative,summary,venue_type,development_category,region_state,country'
  );
  const liveIds = new Set(
    projects
      .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY && p.status !== 'dismissed' && p.stage !== 'dormant')
      .map((p) => String(p.id))
  );
  const leads = await pageAll<Record<string, unknown>>(
    'leads',
    'id,title,project_id,status,source,stream,market,region_state,country,applicant,representative,' +
      'presented_by,contact_name,contact_email,contact_phone,action_sought,location,venue_type,' +
      // WITHOUT THESE THE CENSUS ANSWERS THE WRONG QUESTION. The value that
      // started this - "Address Not Listed In The Dropdown" - is not in a scalar
      // column at all: adapters write a `Label: value` line into raw_content and
      // a reader lifts it into filing_facts. A first pass scanned scalars only
      // and returned ZERO, which is a false negative from looking in the wrong
      // place - the exact shape this file exists to find.
      'raw_content,filing_facts'
  );
  const companies = await pageAll<Record<string, unknown>>('companies', 'id,name');

  const hits: Row[] = [];

  const scan = (
    table: string,
    rows: Record<string, unknown>[],
    columns: string[],
    context: (r: Record<string, unknown>) => string,
    isLive: (r: Record<string, unknown>) => boolean
  ) => {
    for (const r of rows) {
      for (const c of columns) {
        const v = r[c];
        if (typeof v !== 'string') continue;
        if (!isPlaceholder(v)) continue;
        hits.push({
          table,
          column: c,
          value: v.trim(),
          id: String(r.id),
          context: context(r),
          live: isLive(r),
        });
      }
    }
  };

  scan(
    'projects',
    projects,
    ['name', 'market', 'primary_applicant', 'primary_representative', 'summary', 'venue_type', 'development_category', 'region_state', 'country'],
    (r) => String(r.name ?? ''),
    (r) => liveIds.has(String(r.id))
  );
  scan(
    'leads',
    leads,
    ['title', 'applicant', 'representative', 'presented_by', 'contact_name', 'contact_email', 'contact_phone', 'action_sought', 'location', 'market', 'region_state', 'country', 'venue_type'],
    (r) => `${String(r.source ?? '?')} / ${String(r.title ?? '').slice(0, 34)}`,
    (r) => r.status !== 'dismissed' && !!r.project_id && liveIds.has(String(r.project_id))
  );
  scan('companies', companies, ['name'], (r) => String(r.name ?? ''), () => true);

  // ---- AND THE TWO PLACES A CAPTURED VALUE ACTUALLY LIVES -------------------
  //
  // raw_content is written as `Label: value` lines by every government adapter,
  // and filing_facts is what a reader lifted out of them. A placeholder reaches
  // a document through both, and through neither of the scalar columns above.
  for (const r of leads) {
    const live = r.status !== 'dismissed' && !!r.project_id && liveIds.has(String(r.project_id));
    const context = `${String(r.source ?? '?')} / ${String(r.title ?? '').slice(0, 34)}`;
    for (const line of String(r.raw_content ?? '').split(/\r?\n/)) {
      const m = /^([A-Z][^:]{1,44}):\s*(.+)$/.exec(line.trim());
      if (!m) continue;
      if (!isPlaceholder(m[2])) continue;
      hits.push({ table: 'leads', column: `raw_content[${m[1].trim()}]`, value: m[2].trim(), id: String(r.id), context, live });
    }
    const facts = Array.isArray(r.filing_facts) ? (r.filing_facts as { label?: string; display?: string }[]) : [];
    for (const f of facts) {
      const v = String(f?.display ?? '');
      if (!isPlaceholder(v)) continue;
      hits.push({ table: 'leads', column: `filing_facts[${String(f?.label ?? '?')}]`, value: v, id: String(r.id), context, live });
    }
  }

  console.log('='.repeat(100));
  console.log('A FORM PLACEHOLDER STORED AS A FACT');
  console.log(`  scanned ${projects.length} projects, ${leads.length} records, ${companies.length} companies`);
  console.log('='.repeat(100));
  console.log(`  values matched: ${hits.length}   on live projects: ${hits.filter((h) => h.live).length}`);
  console.log('');

  if (hits.length === 0) {
    console.log('  none');
    return;
  }

  const byColumn = new Map<string, Row[]>();
  for (const h of hits) {
    const k = `${h.table}.${h.column}`;
    if (!byColumn.has(k)) byColumn.set(k, []);
    byColumn.get(k)!.push(h);
  }
  console.log('-'.repeat(100));
  console.log('BY COLUMN');
  console.log('-'.repeat(100));
  for (const [k, rs] of [...byColumn.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const values = [...new Set(rs.map((r) => r.value))];
    console.log(`  ${String(rs.length).padStart(4)}  (${rs.filter((r) => r.live).length} live)  ${k.padEnd(28)} ${values.slice(0, 3).map((v) => JSON.stringify(v)).join(', ').slice(0, 52)}`);
  }

  console.log('');
  console.log('-'.repeat(100));
  console.log('EVERY HIT ON A LIVE PROJECT');
  console.log('-'.repeat(100));
  for (const h of hits.filter((x) => x.live)) {
    console.log(`  ${`${h.table}.${h.column}`.padEnd(26)} ${JSON.stringify(h.value).slice(0, 40).padEnd(41)} ${h.context.slice(0, 44)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
