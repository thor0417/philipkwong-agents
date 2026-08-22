// WHAT THE THREE PROPOSED VENUE NEUTRALISERS WOULD COST, PER MARKET.
//
//   npm run diag:venue-neutraliser-cost
//
// DRY. Reads and reports. Writes one file to snapshots/ and nothing to the
// database. Nothing here changes lib/taxonomy: the proposed rules are applied to
// a COPY of each record's text and the real classifyVenueType is asked about
// both versions, so the measurement cannot drift from the classifier and cannot
// leak into it either.
//
// THE PROPOSAL, from snapshots/venue-name-reach.json: three constructs where a
// venue noun sits inside a name rather than naming a subject. venueReadableText
// already blanks a "<Name> Redevelopment Plan" and zoning boilerplate for this
// exact reason; these would be three more entries in the same list.
//
// PER MARKET, because a corpus average hides a market-specific harm - the
// mixed-use gate change that helped New York and strictly harmed Anaheim. Twelve
// markets with a column of zeroes is a useful answer.
import { writeFileSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyVenueType, venueReadableText } from '../../../lib/taxonomy';

const OUT = 'snapshots/venue-neutraliser-cost.json';
// CHARS OF raw_content CONSIDERED, AND THE REASON THIS LINE IS COMMENTED.
// The first run of this file reported 65 records across 3 markets against this
// window. Over FULL record text the same rules cleared 130 across nine, because
// long documents carry more street names - and the difference was the street
// rule, which was dropped as a result. A cap that is not printed beside the
// number is a number that reads as a corpus answer. Standing rule 13.
const CAP = 2500;

// ---- THE PROPOSED RULES, EXACTLY AS THEY WOULD BE ADDED ---------------------

// 1. A LAND USE CATEGORY NAMES A DESIGNATION, NOT A BUILDING.
//    "redesignate the existing land use category from Corridor Mixed-Use (CM)
//    to Mid-Intensity Suburban Neighborhood (MN)" describes a change of label on
//    a map. It is not a statement that a mixed-use development exists.
const LAND_USE_CATEGORY = [
  /\b[A-Z][\w-]*(?:[ \t]+[A-Z][\w-]*)*[ \t]*\((?:CM|EM|MN|CN|UN|LN|BE|OL|RN|NC)\)/g,
  /\bland use category (?:from|to)\b[^.;]{0,90}/gi,
];

// 2. A STREET IS NOT A VENUE. "Casino Center Drive", "Convention Center Drive",
//    "Hotel Plaza Boulevard". Bounded to the capitalised run immediately before
//    the suffix, so "a resort at 123 Main Street" loses "Main Street" and keeps
//    "resort".
const STREET_NAME = [
  /\b[A-Z][\w'-]*(?:[ \t]+[A-Z][\w'-]*){0,2}[ \t]+(?:Drive|Street|Avenue|Boulevard|Road|Lane|Way|Place|Court|Parkway|Highway|Blvd|Ave|Rd|Dr)\b/g,
];

// 3. A DEFINITION IN A CODE IS THE CODE TALKING ABOUT ITSELF.
//    "definitions for Inflatable Amusement Device, Community Facility and
//    Recreational Vehicle" is a fee-schedule ordinance, not an amusement park.
const CODE_DEFINITION = [/\bdefinitions?\s+for\b[^.;]{0,90}/gi];

const RULES: { name: string; res: RegExp[] }[] = [
  { name: 'land use category', res: LAND_USE_CATEGORY },
  { name: 'street name', res: STREET_NAME },
  { name: 'code definition', res: CODE_DEFINITION },
];

/** The text the classifier WOULD read, if the three rules were in place. */
function proposedText(raw: string): string {
  let out = venueReadableText(raw);
  for (const r of RULES) for (const re of r.res) out = out.replace(re, ' ');
  return out;
}

/** Which single rule is responsible for a change, where one is. */
function attribute(raw: string): string {
  const base = classifyVenueType(venueReadableText(raw));
  for (const r of RULES) {
    let t = venueReadableText(raw);
    for (const re of r.res) t = t.replace(re, ' ');
    if (classifyVenueType(t) !== base) return r.name;
  }
  return 'combination';
}

interface Row {
  id: string;
  title: string | null;
  raw_content: string | null;
  venue_type: string | null;
  project_id: string | null;
  market: string | null;
}

interface Cell {
  recordsWithVenueBefore: number;
  recordsWithVenueAfter: number;
  lostVenue: number;
  changedVenue: number;
  projectsTouched: Set<string>;
  projectsLosingVenueEntirely: Set<string>;
}

async function main() {
  const rows: Row[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, title, raw_content, venue_type, project_id, market')
      .neq('status', 'dismissed')
      .neq('lifecycle', 'retired')
      .range(f, f + 999);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const cells = new Map<string, Cell>();
  const cell = (m: string): Cell => {
    if (!cells.has(m))
      cells.set(m, {
        recordsWithVenueBefore: 0,
        recordsWithVenueAfter: 0,
        lostVenue: 0,
        changedVenue: 0,
        projectsTouched: new Set(),
        projectsLosingVenueEntirely: new Set(),
      });
    return cells.get(m)!;
  };

  // A project keeps a venue if ANY of its records still supplies one.
  const supplyBefore = new Map<string, number>();
  const supplyAfter = new Map<string, number>();
  const changes: {
    market: string | null;
    before: string;
    after: string | null;
    rule: string;
    title: string;
    project_id: string | null;
  }[] = [];

  for (const r of rows) {
    const raw = `${r.title ?? ''} ${(r.raw_content ?? '').slice(0, CAP)}`;
    const before = classifyVenueType(venueReadableText(raw));
    const after = classifyVenueType(proposedText(raw));
    const m = r.market ?? '(no market)';
    const c = cell(m);
    if (before) c.recordsWithVenueBefore++;
    if (after) c.recordsWithVenueAfter++;
    if (r.project_id) {
      if (before) supplyBefore.set(r.project_id, (supplyBefore.get(r.project_id) ?? 0) + 1);
      if (after) supplyAfter.set(r.project_id, (supplyAfter.get(r.project_id) ?? 0) + 1);
    }
    if (before === after) continue;
    if (before && !after) c.lostVenue++;
    else if (before && after) c.changedVenue++;
    if (r.project_id) c.projectsTouched.add(r.project_id);
    changes.push({
      market: r.market,
      before: before ?? '(none)',
      after,
      rule: attribute(raw),
      title: (r.title ?? '').replace(/\s+/g, ' ').slice(0, 130),
      project_id: r.project_id,
    });
  }

  for (const [pid, n] of supplyBefore) {
    if (n > 0 && !(supplyAfter.get(pid) ?? 0)) {
      const row = rows.find((r) => r.project_id === pid);
      cell(row?.market ?? '(no market)').projectsLosingVenueEntirely.add(pid);
    }
  }

  // Name the projects that would lose their venue outright.
  const losingIds = [...new Set([...cells.values()].flatMap((c) => [...c.projectsLosingVenueEntirely]))];
  const losing: Record<string, unknown>[] = [];
  for (let i = 0; i < losingIds.length; i += 40) {
    const { data } = await supabaseAdmin
      .from('projects')
      .select('id,name,market,venue_type,stage,status,significance')
      .in('id', losingIds.slice(i, i + 40));
    losing.push(...((data ?? []) as Record<string, unknown>[]));
  }

  const table = [...cells.entries()]
    .map(([market, c]) => ({
      market,
      recordsWithVenueBefore: c.recordsWithVenueBefore,
      recordsWithVenueAfter: c.recordsWithVenueAfter,
      lostVenue: c.lostVenue,
      changedVenue: c.changedVenue,
      projectsTouched: c.projectsTouched.size,
      projectsLosingVenueEntirely: c.projectsLosingVenueEntirely.size,
    }))
    .sort((a, b) => b.recordsWithVenueBefore - a.recordsWithVenueBefore);

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        inputCap: `title + the first ${CAP} characters of raw_content. Full text finds materially more; see the note on CAP.`,
        about:
          'Dry cost of three proposed venue neutralisers, per market. The proposed rules are applied to a COPY of each record text and the real classifyVenueType is asked about both versions. Nothing is written to the database and lib/taxonomy is unchanged.',
        rules: RULES.map((r) => ({ name: r.name, patterns: r.res.map((x) => x.source) })),
        liveRecords: rows.length,
        table,
        projectsLosingVenueEntirely: losing,
        changes,
      },
      null,
      1
    )
  );

  console.log('===== VENUE NEUTRALISER, DRY COST =====');
  console.log(`live records ${rows.length}\n`);
  console.log(
    'market'.padEnd(38) + 'venue before'.padStart(13) + 'after'.padStart(8) + 'lost'.padStart(6) + 'changed'.padStart(9) + 'proj hit'.padStart(10) + 'proj lose'.padStart(11)
  );
  for (const t of table) {
    console.log(
      t.market.slice(0, 36).padEnd(38) +
        String(t.recordsWithVenueBefore).padStart(13) +
        String(t.recordsWithVenueAfter).padStart(8) +
        String(t.lostVenue).padStart(6) +
        String(t.changedVenue).padStart(9) +
        String(t.projectsTouched).padStart(10) +
        String(t.projectsLosingVenueEntirely).padStart(11)
    );
  }
  const sum = (k: keyof (typeof table)[0]) => table.reduce((a, t) => a + (t[k] as number), 0);
  console.log(
    'TOTAL'.padEnd(38) +
      String(sum('recordsWithVenueBefore')).padStart(13) +
      String(sum('recordsWithVenueAfter')).padStart(8) +
      String(sum('lostVenue')).padStart(6) +
      String(sum('changedVenue')).padStart(9) +
      String(sum('projectsTouched')).padStart(10) +
      String(sum('projectsLosingVenueEntirely')).padStart(11)
  );
  console.log(`\nwrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
