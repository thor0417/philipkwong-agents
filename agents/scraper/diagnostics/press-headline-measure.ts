// READ-ONLY. HOW MANY PRESS HEADLINES DO WE PRINT WITH THE END MISSING?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/press-headline-measure.ts
//
// Nothing is written. A client brief prints "Southern California gets $4B mega
// music venue in giant ..." as a record line. The ellipsis is not ours: it is
// what a search result carries, because a SERP title is cut to fit a column of
// pixels. We stored the cut string as the record's title and printed it.
//
// The question this answers is whether the full headline is recoverable from
// what we already hold - capture:press-bodies stores the article text - or
// whether recovering it means a fetch per record.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isHospitalityModule } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

const CUT = /(\s|…)(\.\.\.|…)\s*$/;

interface Lead {
  id: string;
  title: string | null;
  url: string | null;
  status: string | null;
  stream: string | null;
  source: string | null;
  source_type: string | null;
  project_id: string | null;
  raw_content: string | null;
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
  const projects = await pageAll<{ id: string; name: string; module: string | null; status: string | null; country: string | null; stage: string | null }>(
    'projects',
    'id,name,module,status,country,stage'
  );
  const live = new Map(
    projects
      .filter(
        (p) =>
          isHospitalityModule(p.module) &&
          p.status !== 'dismissed' &&
          inCorpusScope(p.country) &&
          p.stage !== 'dormant'
      )
      .map((p) => [p.id, p.name])
  );

  const leads = await pageAll<Lead>(
    'leads',
    'id,title,url,status,stream,source,source_type,project_id,raw_content'
  );
  const scoped = leads.filter((l) => l.status !== 'dismissed' && l.project_id && live.has(l.project_id));

  const cut = scoped.filter((l) => CUT.test(String(l.title ?? '')));
  let recoverable = 0;
  let bodyless = 0;
  const examples: string[] = [];

  for (const l of cut) {
    const body = String(l.raw_content ?? '');
    if (!body.trim()) {
      bodyless++;
      continue;
    }
    // The head of the stored title, up to the cut, should appear in the body if
    // the body holds the article. The full headline is then the line it sits on.
    const head = String(l.title ?? '').replace(CUT, '').trim();
    const probe = head.slice(0, Math.min(head.length, 40));
    const at = body.indexOf(probe);
    if (at === -1) continue;
    recoverable++;
    if (examples.length < 8) {
      const lineEnd = body.indexOf('\n', at);
      const full = body.slice(at, lineEnd === -1 ? at + 160 : lineEnd).trim();
      examples.push(`  cut:  ${l.title}\n  full: ${full.slice(0, 150)}`);
    }
  }

  console.log('='.repeat(96));
  console.log('PRESS HEADLINES PRINTED WITH THE END MISSING');
  console.log('='.repeat(96));
  console.log(`  records on live projects:            ${scoped.length}`);
  console.log(`  titles ending in an ellipsis:        ${cut.length}`);
  console.log(`  of those, with no stored body:       ${bodyless}`);
  console.log(`  of those, head found in the body:    ${recoverable}`);
  console.log('');
  const byProject = new Map<string, number>();
  for (const l of cut) {
    const n = live.get(l.project_id!)!;
    byProject.set(n, (byProject.get(n) ?? 0) + 1);
  }
  console.log('  by project:');
  for (const [n, c] of [...byProject.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    console.log(`    ${String(c).padStart(3)}  ${n}`);
  }
  console.log('');
  for (const e of examples) console.log(e + '\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
