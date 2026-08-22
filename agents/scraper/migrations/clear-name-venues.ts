// CLEAR VENUES THAT CAME ONLY FROM A LAND USE CATEGORY OR A CODE DEFINITION.
//
//   npm run venues:names          list them, write nothing
//   APPLY=1 npm run venues:names  write
//
// The same correction clear-plan-name-venues made for "<Name> Redevelopment
// Plan", for the three constructs added to VENUE_ONLY_NAMES on 2026-08-22:
//
//   land use category   "redesignate the land use category from Corridor
//                        Mixed-Use (CM)" names a designation on a map
//   code definition     "definitions for Inflatable Amusement Device"
//
// A THIRD RULE, blanking street names, was proposed and dropped before shipping:
// over full record text it cleared 82 records across nine markets and took real
// venues with it, because a place names its streets after its landmarks. See the
// note on VENUE_ONLY_NAMES. "1555 S Casino Center Drive" is still wrong.
//
// classifyVenueType now blanks both before reading, which fixes what is
// scraped NEXT and cannot fix what is stored - reclassify-venues passes each
// record's existing venue_type as a HINT, so when the text goes quiet the hint
// speaks and the row re-asserts the value being corrected. That hint exists for
// a good reason (passing null wiped Integrated Resort 14 -> 0), so it is not the
// thing to change.
//
// THE NARROW CORRECTION, three conditions, all of which must hold:
//   1. the record stores a venue_type,
//   2. classifying it WITHOUT the hint now yields null,
//   3. it yielded something BEFORE the three constructs were added, asked
//      through venueTypeWithoutNameRules rather than by matching a regex.
//
// Condition 3 is what makes this specific to this change rather than a general
// cleanup: a record that has always classified as null is not this migration's
// business. Condition 2 is what keeps it from touching anything real - a record
// whose own subject names a venue still classifies from that subject.
//
// A HAND-SET VENUE IS NEVER TOUCHED, whatever the text says. Same rule as the
// plan-name pass.
//
// Measured before writing, over FULL record text: 46 records, 18 projects, and
// CLARK COUNTY ALONE - every other market is untouched. No record is
// reclassified into a DIFFERENT venue; every change is to null.
import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyVenueType, categoryForVenue, venueTypeWithoutNameRules } from '../../../lib/taxonomy';

const APPLY = process.env.APPLY === '1';

/**
 * CONDITION 3, ASKED HONESTLY. venueTypeWithoutNameRules is the reader as it was
 * before the three constructs were added, so "did the stored value depend on
 * them" is a real question rather than "does a regex match anywhere in this
 * document". The first draft asked the weak version and proposed clearing 101
 * records across nine markets - Anaheim Theme Park applications among them -
 * when the reach of the change is Clark County alone. The difference was
 * pre-existing staleness it had no business touching.
 */
interface Row {
  id: string;
  title: string | null;
  raw_content: string | null;
  venue_type: string | null;
  development_category: string | null;
  project_id: string | null;
  market: string | null;
  manual_overrides: unknown;
}

async function main(): Promise<void> {
  console.log(APPLY ? 'CLEAR NAME VENUES: APPLYING' : 'CLEAR NAME VENUES: DRY RUN (APPLY=1 to write)');

  const rows: Row[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,raw_content,venue_type,development_category,project_id,market,manual_overrides')
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
  const clearedIds = new Set<string>();
  const perMarket = new Map<string, number>();

  for (const r of rows) {
    const text = `${r.title ?? ''} ${r.raw_content ?? ''}`;
    // 3. it named a venue before the three constructs were added...
    const before = venueTypeWithoutNameRules(text);
    if (before === null) continue;
    // 2. ...and names none now, on its own text, without the hint.
    if (classifyVenueType(text) !== null) continue;

    const mo = r.manual_overrides;
    if (mo && typeof mo === 'object' && 'venue_type' in (mo as Record<string, unknown>)) {
      curated++;
      console.log(`  HAND-SET, left alone: ${String(r.title).slice(0, 60)}`);
      continue;
    }

    console.log(
      `  ${String(r.venue_type).padEnd(24)} -> null   [${String(r.market ?? '-').slice(0, 14).padEnd(14)}] ${String(r.title).replace(/\s+/g, ' ').slice(0, 58)}`
    );
    cleared++;
    clearedIds.add(r.id);
    perMarket.set(r.market ?? '(none)', (perMarket.get(r.market ?? '(none)') ?? 0) + 1);
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
  let projectsLosing = 0;
  for (const pid of projects) {
    // THE DRY RUN MUST NOT READ BACK WHAT IT HAS NOT WRITTEN. Under APPLY the
    // clears above have landed and this reads the truth; without it they have
    // not, so the cleared ids are subtracted here. The first draft skipped this
    // and reported "projects left with no venue: 0" on every dry run, which is
    // the run report standing in for the work again.
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,venue_type')
      .eq('project_id', pid)
      .neq('status', 'dismissed');
    if (error) throw new Error(error.message);
    const counts = new Map<string, number>();
    for (const l of (data ?? []) as { id: string; venue_type: string | null }[]) {
      if (!l.venue_type || clearedIds.has(l.id)) continue;
      counts.set(l.venue_type, (counts.get(l.venue_type) ?? 0) + 1);
    }
    let mode: string | null = null;
    let best = 0;
    for (const [k, v] of counts) if (v > best) [mode, best] = [k, v];
    if (mode === null) projectsLosing++;
    console.log(`  project ${pid.slice(0, 8)} venue -> ${mode ?? 'null'}`);
    if (APPLY) {
      const { error: uerr } = await supabaseAdmin
        .from('projects')
        .update({ venue_type: mode, development_category: categoryForVenue(mode) })
        .eq('id', pid);
      if (uerr) throw new Error(`project venue failed for ${pid}: ${uerr.message}`);
    }
  }

  console.log('\nPER MARKET:');
  for (const [m, n] of [...perMarket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${m}`);
  }
  console.log(
    `\n${APPLY ? 'cleared' : 'would clear'}: ${cleared} record(s)   projects touched: ${projects.size}   ` +
      `projects left with no venue: ${projectsLosing}   hand-set, protected: ${curated}`
  );
  if (!APPLY) console.log('Nothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
