// READ-ONLY. WHICH STORED TITLES ARE NOT WHOLE, HOWEVER THEY WERE CUT?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/title-wholeness-measure.ts
//
// Nothing is written. THIS REPLACES A COUNT THAT WAS TRUE ABOUT THE WRONG SET.
// press-headline-measure asked "which titles END IN an ellipsis" and answered 43
// confidently, so 43 read as the whole problem. The question is "which stored
// titles are not whole", and three of the survivors on one brief answer it
// differently:
//
//   "Eli Applebaum Acquires 12-Acre Development Site On."   no ellipsis at all
//   "Heart-shaped resort approved by Clark County Zoning ... - KTNV."
//                                                          ellipsis MID-string
//   "New Las Vegas hotel-casino project approved for failed ..."
//
// The three tests below are structural and read no names. An ellipsis anywhere
// is the search engine's own truncation marker. A trailing separator is a cut
// through punctuation. A trailing function word is a cut through a sentence:
// the list is closed, it is written out, and no English headline ends on one.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

const TRAILING_ELLIPSIS = /(\s|…)(\.\.\.|…)\s*$/;
const ANY_ELLIPSIS = /(\.\.\.|…)/;
const TRAILING_SEPARATOR = /[,\-–—|:;]\.?\s*$/;
const TRAILING_FUNCTION_WORD =
  /\s(on|in|at|for|to|of|with|by|from|as|and|or|the|a|an|its|his|her|their|that|which|into|over|after|before|near|amid|about)\.?\s*$/i;

interface Lead {
  id: string;
  title: string | null;
  url: string | null;
  status: string | null;
  project_id: string | null;
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

async function main(): Promise<void> {
  const projects = await pageAll<{
    id: string;
    name: string;
    module: string | null;
    status: string | null;
    country: string | null;
    stage: string | null;
  }>('projects', 'id,name,module,status,country,stage');
  const live = new Map(
    projects
      .filter(
        (p) =>
          p.module === LIVE_PIPELINE_STORAGE_KEY &&
          p.status !== 'dismissed' &&
          inCorpusScope(p.country) &&
          p.stage !== 'dormant'
      )
      .map((p) => [p.id, p.name])
  );

  const leads = await pageAll<Lead>('leads', 'id,title,url,status,project_id');
  const scoped = leads.filter((l) => l.status !== 'dismissed' && l.project_id && live.has(l.project_id));

  const hits = { trailing: [] as Lead[], midEllipsis: [] as Lead[], separator: [] as Lead[], functionWord: [] as Lead[] };
  const notWhole = new Set<string>();

  for (const l of scoped) {
    const t = String(l.title ?? '').trim();
    if (!t) continue;
    if (TRAILING_ELLIPSIS.test(t)) {
      hits.trailing.push(l);
      notWhole.add(l.id);
      continue;
    }
    if (ANY_ELLIPSIS.test(t)) {
      hits.midEllipsis.push(l);
      notWhole.add(l.id);
      continue;
    }
    if (TRAILING_SEPARATOR.test(t)) {
      hits.separator.push(l);
      notWhole.add(l.id);
      continue;
    }
    if (TRAILING_FUNCTION_WORD.test(t)) {
      hits.functionWord.push(l);
      notWhole.add(l.id);
    }
  }

  console.log('='.repeat(96));
  console.log('STORED TITLES THAT ARE NOT WHOLE');
  console.log('='.repeat(96));
  console.log(`  records on live projects:                 ${scoped.length}`);
  console.log('');
  console.log(`  trailing ellipsis  (the old 43 test):     ${hits.trailing.length}`);
  console.log(`  ellipsis mid-string, suffix after it:     ${hits.midEllipsis.length}`);
  console.log(`  ends on a separator:                      ${hits.separator.length}`);
  console.log(`  ends on a function word:                  ${hits.functionWord.length}`);
  console.log(`  ----------------------------------------------`);
  console.log(`  NOT WHOLE, all causes:                    ${notWhole.size}`);
  console.log('');

  for (const [label, rows] of [
    ['MID-STRING ELLIPSIS', hits.midEllipsis],
    ['ENDS ON A SEPARATOR', hits.separator],
    ['ENDS ON A FUNCTION WORD', hits.functionWord],
  ] as [string, Lead[]][]) {
    if (!rows.length) continue;
    console.log(`  --- ${label} (${rows.length}) ---`);
    for (const l of rows.slice(0, 14)) {
      console.log(`    ${String(live.get(l.project_id!)).slice(0, 26).padEnd(27)} ${String(l.title).slice(0, 88)}`);
    }
    if (rows.length > 14) console.log(`    ... and ${rows.length - 14} more`);
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
