// READ-ONLY. WHICH RECORDS DOES THE REPORT TAG AS SPANISH, AND ON WHAT WORDS?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/spanish-flag-measure.ts
//
// Nothing is written. OCVibe prints an English council item - "Adoption of
// resolutions dedicating municipal property for public streets..." - with the
// tag "[Spanish-language record; no English capture of this item]" under it.
// Either the detector is firing on English, or the record really is the Spanish
// twin and the text shown is not the text tested. This says which.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

const SPANISH_MARKERS = new RegExp(
  '\\b(que|del|para|sobre|por|una|sus|este|esta|mediante|conforme|propiedad|' +
    'condiciones|propietario|presentada|cumplido|determinar|aprobar|ordenanza|' +
    'resoluci[oó]n|t[eé]rminos|acuerdo|ciudad|desarrollo|reuni[oó]n|sesi[oó]n)\\b',
  'gi'
);
const THRESHOLD = 3;

interface Lead {
  id: string;
  title: string | null;
  action_sought: string | null;
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
  const projects = await pageAll<{ id: string; name: string; module: string | null; status: string | null; country: string | null; stage: string | null }>(
    'projects',
    'id,name,module,status,country,stage'
  );
  const live = new Map(
    projects
      .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY && p.status !== 'dismissed' && inCorpusScope(p.country) && p.stage !== 'dormant')
      .map((p) => [p.id, p.name])
  );

  const leads = await pageAll<Lead>('leads', 'id,title,action_sought,url,status,project_id');
  const scoped = leads.filter((l) => l.status !== 'dismissed' && l.project_id && live.has(l.project_id));

  let flagged = 0;
  const rows: { project: string; hits: string[]; text: string; url: string }[] = [];
  for (const l of scoped) {
    const text = `${l.action_sought ?? ''} ${l.title ?? ''}`.replace(/\s+/g, ' ').trim();
    const hits = [...new Set((text.match(SPANISH_MARKERS) ?? []).map((m) => m.toLowerCase()))];
    if (hits.length < THRESHOLD) continue;
    flagged++;
    rows.push({ project: live.get(l.project_id!)!, hits, text, url: String(l.url ?? '') });
  }

  console.log('='.repeat(100));
  console.log(`RECORDS TAGGED SPANISH   ${flagged} of ${scoped.length} records on live projects`);
  console.log('='.repeat(100));
  for (const r of rows) {
    // Is the text actually Spanish? A crude but decisive counter-test: does it
    // open with an English verb phrase the Spanish twin would never carry.
    console.log('');
    console.log(`  ${r.project}`);
    console.log(`  markers: ${r.hits.join(', ')}`);
    console.log(`  ${r.text.slice(0, 300)}`);
    console.log(`  ${r.url.slice(0, 120)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
