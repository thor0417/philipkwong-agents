// CLEAR VENUES THAT CAME ONLY FROM A PLAN'S NAME.
//
//   npm run venues:plan-names          list them, write nothing
//   APPLY=1 npm run venues:plan-names  write
//
// classifyVenueType now blanks "<Name> Redevelopment Plan" before reading, so a
// resolution financing the Arts Center Redevelopment Plan no longer classifies
// as a Museum. That fixes what is scraped NEXT and cannot fix what is stored,
// because reclassify-venues passes each record's existing venue_type as a HINT:
// when the text goes quiet the hint speaks, and the row re-asserts the value
// being corrected. That hint exists for a good reason - passing null wiped
// Integrated Resort 14 -> 0 - so it is not the thing to change.
//
// This is the narrow correction instead. A record qualifies only when ALL of:
//   1. it stores a venue_type,
//   2. its text names a "<Name> Redevelopment Plan",
//   3. classifying it WITHOUT the hint now yields null.
//
// Condition 3 is what keeps this from touching anything real: a record whose
// own subject names a venue still classifies from that subject and is left
// alone. Measured before writing: 3 records, all one Nashville project.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyVenueType, categoryForVenue } from '../../../lib/taxonomy';

const APPLY = process.env.APPLY === '1';
const PLAN_NAME = new RegExp("\\b[A-Z][\\w'&.-]*(?:\\s+[A-Z][\\w'&.-]*)*\\s+Redevelopment Plan\\b");

interface Row {
  id: string;
  title: string | null;
  raw_content: string | null;
  venue_type: string | null;
  development_category: string | null;
  project_id: string | null;
  manual_overrides: unknown;
}

async function main(): Promise<void> {
  console.log(APPLY ? 'CLEAR PLAN-NAME VENUES: APPLYING' : 'CLEAR PLAN-NAME VENUES: DRY RUN (APPLY=1 to write)');

  const rows: Row[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,raw_content,venue_type,development_category,project_id,manual_overrides')
      .not('venue_type', 'is', null)
      .range(i, i + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }

  let cleared = 0;
  let curated = 0;
  const projects = new Set<string>();

  for (const r of rows) {
    const text = `${r.title ?? ''} ${r.raw_content ?? ''}`;
    if (!PLAN_NAME.test(text)) continue;
    // Without the hint: does the text still name a venue on its own?
    if (classifyVenueType(text) !== null) continue;

    const mo = r.manual_overrides;
    if (mo && typeof mo === 'object' && 'venue_type' in (mo as Record<string, unknown>)) {
      curated++;
      console.log(`  HAND-SET, left alone: ${String(r.title).slice(0, 60)}`);
      continue;
    }

    console.log(`  ${String(r.venue_type).padEnd(24)} -> null   ${String(r.title).replace(/\s+/g, ' ').slice(0, 58)}`);
    cleared++;
    if (r.project_id) projects.add(r.project_id);
    if (APPLY) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update({ venue_type: null, development_category: null })
        .eq('id', r.id);
      if (error) throw new Error(`clear failed for ${r.id}: ${error.message}`);
    }
  }

  // The project takes the MODE of its records, same rule the clusterer applies.
  for (const pid of projects) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('venue_type')
      .eq('project_id', pid)
      .neq('status', 'dismissed');
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const l of data ?? []) if (l.venue_type) counts.set(l.venue_type, (counts.get(l.venue_type) ?? 0) + 1);
    let mode: string | null = null;
    let best = 0;
    for (const [k, v] of counts) if (v > best) [mode, best] = [k, v];
    console.log(`  project ${pid.slice(0, 8)} venue -> ${mode ?? 'null'}`);
    if (APPLY) {
      const { error: uerr } = await supabaseAdmin
        .from('projects')
        .update({ venue_type: mode, development_category: categoryForVenue(mode) })
        .eq('id', pid);
      if (uerr) throw new Error(`project venue failed for ${pid}: ${uerr.message}`);
    }
  }

  console.log(`\n${APPLY ? 'cleared' : 'would clear'}: ${cleared} record(s)   projects touched: ${projects.size}   hand-set, protected: ${curated}`);
  if (!APPLY) console.log('Nothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
