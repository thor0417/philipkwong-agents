// KNOWN-ENTITY BYPASS: the system already knows which applicants belong to
// tracked projects, and the gate was not using that knowledge.
//
// A vacate-and-abandon filed by Nevada Palace, whose other filings are already a
// tracked project, was rejected because the gate is text-only: the words "vacate
// and abandon a portion of a right-of-way being Harmon Avenue" carry no leisure
// vocabulary and no deal instrument. The applicant is the signal, and nothing was
// reading it.
//
// WHY THIS IS NOT SIMPLY "ANY PARTY OF ANY PROJECT".
//
// The projects register was built by clustering records the OLD, loose gate
// admitted, so it contains projects that are not leisure projects at all. Its
// primary_applicant column includes Toll South LV LLC (the single-family
// subdivision Part 2 deliberately vetoed), HORIZON WEST HOMES LLC, CHURCH
// SEARCHLIGHT COMMUNITY, SUSTAINABLE DEVELOPMENT FUND 1 LLC, and CITY OF LAS
// VEGAS. A bypass trusting every one of those parties would re-admit the exact
// class Part 2 just excluded, and it would do so invisibly, because a bypass
// reports itself as a bypass rather than as a vocabulary match.
//
// So a project must EARN the authority to lend its parties a bypass. It qualifies
// as an ANCHOR only when at least one of its own records carries leisure evidence
// that does not depend on this rule: a STRONG gate term, or a named-target hit.
// Nevada Palace qualifies - its zone change reclassifies land "from a CR
// (Commercial Resort) Zone", so 'resort' fires STRONG on a sibling record. Toll
// South LV does not qualify, and stays out.
//
// That is also what keeps the feedback loop honest. Capturing a project does make
// the system better at capturing that project's other filings - which is the
// point - but only projects with independent leisure evidence can widen the gate,
// so the loop cannot amplify its own mistakes.

import { governmentGate } from '../../lib/taxonomy';
import { strongBypassesGate } from './targets';
import { normalizeEntity, isGenericEntity } from './cluster';
import { selectAllPaged } from './page-select';
import { supabaseAdmin } from '../../lib/supabase-admin';

export interface KnownEntity {
  // Normalized name, as normalizeEntity produces it.
  entity: string;
  // Market key the entity is trusted in.
  market: string;
  projectName: string;
  // Where the name came from, for the report.
  role: 'applicant' | 'representative' | 'project';
}

// MARKET KEY. The projects table stores 'Clark County' where a Legistar record
// says 'Clark County, NV', so the two need folding to one key before they can be
// compared. State and country suffixes are dropped; nothing else is.
export function marketKey(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toLowerCase().replace(/[^a-z0-9, ]+/g, ' ');
  s = s.split(',')[0];
  return s.replace(/\s+/g, ' ').trim();
}

// A NAME LONG AND SPECIFIC ENOUGH TO MATCH ON. Two guards beyond the clustering
// stoplist, both because this name will be matched as a substring of arbitrary
// government prose:
//   - at least two tokens, so a single word can never carry a bypass. 'ruby',
//     'branches' and 'toll' are all real primary_applicant leading tokens in this
//     register, and any of them alone would fire on unrelated text.
//   - at least 10 characters, the same floor clustering uses before it trusts a
//     fuzzy entity match.
const MIN_ENTITY_LENGTH = 10;

export function isMatchableEntity(normalized: string): boolean {
  if (normalized.length < MIN_ENTITY_LENGTH) return false;
  if (normalized.split(' ').length < 2) return false;
  // THE CLUSTERING STOPLIST, reused rather than re-stated: a city, a county, a
  // department, a utility, a commission, a named director. isGenericEntity is the
  // same function project clustering uses to refuse to cluster on a generic
  // applicant, and the reason is identical - a city is the applicant on hundreds
  // of unrelated filings.
  if (isGenericEntity(normalized)) return false;
  return true;
}

interface ProjectRow {
  id: string;
  name: string;
  market: string | null;
  primary_applicant: string | null;
  primary_representative: string | null;
}

interface LeadRow {
  project_id: string | null;
  applicant: string | null;
  representative: string | null;
  location: string | null;
  title: string | null;
  raw_content: string | null;
}

export interface EntityIndexReport {
  projects: number;
  anchors: number;
  entities: number;
  // Names rejected by the guards, so the stoplist's effect is reportable.
  rejectedGeneric: string[];
  rejectedShort: string[];
  nonAnchorProjects: string[];
}

let index = new Map<string, KnownEntity[]>();
let lastReport: EntityIndexReport | null = null;

export function entityIndexSize(): number {
  return [...index.values()].reduce((a, b) => a + b.length, 0);
}

export function lastEntityReport(): EntityIndexReport | null {
  return lastReport;
}

// Build the index from the register. Called once per run, before the adapters,
// because the gate decision itself must stay synchronous and pure.
export async function loadKnownEntities(): Promise<EntityIndexReport> {
  const { data: projectData, error } = await supabaseAdmin
    .from('projects')
    .select('id,name,market,primary_applicant,primary_representative');
  if (error) {
    console.warn(`Known entities: project read failed (${error.message}); bypass disabled this run.`);
    index = new Map();
    lastReport = { projects: 0, anchors: 0, entities: 0, rejectedGeneric: [], rejectedShort: [], nonAnchorProjects: [] };
    return lastReport;
  }
  const projects = (projectData ?? []) as ProjectRow[];

  const { rows: leadRows, complete } = await selectAllPaged<LeadRow>(
    'leads',
    'project_id,applicant,representative,location,title,raw_content',
    (q: unknown) => (q as { not: (a: string, b: string, c: null) => unknown }).not('project_id', 'is', null),
    'known-entities'
  );
  if (!complete) {
    console.warn('Known entities: lead read was partial; bypass built from an incomplete register.');
  }

  const byProject = new Map<string, LeadRow[]>();
  for (const l of leadRows) {
    if (!l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  // ANCHOR TEST: does this project have leisure evidence independent of the
  // entity rule? The test is the gate's OWN leisure verdict on any of the
  // project's records - reason 'strong' or 'weak+action' - or a named-target hit.
  //
  // 'weak+action' is included after measuring the alternative. Requiring a STRONG
  // term alone left 82 anchors and excluded 29 projects that are plainly leisure:
  // the Aloft Airport Hotel plat, Denu Hotel & Spa, Disney West Motel, Disney's
  // Fort Wilderness Cabin Improvements, Southern Highlands Golf Club, Disney's
  // Magnolia Golf Course, Fire N Ice Hotel. They fail a STRONG test because
  // 'hotel', 'motel', 'spa' and 'golf' are WEAK terms by design, and the gate
  // already treats weak-plus-entitlement as a real leisure signal. Using the
  // gate's own verdict keeps one definition of leisure rather than inventing a
  // second, stricter one here.
  //
  // THE DEAL TIER IS DELIBERATELY EXCLUDED. A development agreement proves a
  // deal, not a leisure project, so letting reason 'deal' anchor would hand
  // bypass authority to every housing developer holding one - and would let
  // Part 2's new tier quietly widen Part 3 in a way neither was measured for.
  //
  // AND weak+action IS NOT ENOUGH ON ITS OWN. Measured: the first version of this
  // rule admitted 18 records at 33 percent precision, and the two worst offenders
  // were projects that anchored on weak=['mixed-use'] with an entitlement action -
  // "BOLOGNESE, JOSEPH & VIVI A" (a 26-lot single-family subdivision, 5 admits, 0
  // relevant) and "happy miner" (4 admits, 0 relevant). A residential mixed-use
  // project is the exact class isResidentialMixedUse exists to reject, so letting
  // it anchor re-admitted through the side door what the front door refuses.
  //
  // So the weak hit must be a LEISURE IDENTITY term. The five terms below are the
  // weak terms that describe a development PATTERN rather than a leisure use, and
  // a project whose only leisure evidence is one of them does not get to lend its
  // parties a bypass. 'hotel', 'motel', 'lodge', 'cabin', 'spa', 'golf',
  // 'gaming', 'tourism', 'hospitality', 'entertainment' and 'recreation' all
  // remain anchor-worthy, which is what keeps the Aloft Airport Hotel, Denu Hotel
  // & Spa and Southern Highlands Golf Club projects anchoring.
  const NON_LEISURE_WEAK = new Set(['redevelopment', 'master plan', 'masterplan', 'mixed use', 'mixed-use']);
  const isAnchor = (rows: LeadRow[]): boolean =>
    rows.some((l) => {
      const text = `${l.title ?? ''}\n${l.raw_content ?? ''}`;
      const v = governmentGate(text);
      if (v.reason === 'strong' || strongBypassesGate(text)) return true;
      return v.reason === 'weak+action' && v.weakHits.some((w) => !NON_LEISURE_WEAK.has(w));
    });

  const next = new Map<string, KnownEntity[]>();
  const rejectedGeneric: string[] = [];
  const rejectedShort: string[] = [];
  const nonAnchorProjects: string[] = [];
  let anchors = 0;

  const add = (raw: string | null | undefined, market: string, projectName: string, role: KnownEntity['role']): void => {
    const norm = normalizeEntity(raw);
    if (!norm) return;
    if (isGenericEntity(norm)) {
      if (!rejectedGeneric.includes(norm)) rejectedGeneric.push(norm);
      return;
    }
    if (!isMatchableEntity(norm)) {
      if (!rejectedShort.includes(norm)) rejectedShort.push(norm);
      return;
    }
    const key = marketKey(market);
    if (!key) return;
    const list = next.get(key) ?? [];
    if (!list.some((e) => e.entity === norm)) list.push({ entity: norm, market: key, projectName, role });
    next.set(key, list);
  };

  for (const p of projects) {
    const rows = byProject.get(p.id) ?? [];
    if (!isAnchor(rows)) {
      nonAnchorProjects.push(p.name.slice(0, 60));
      continue;
    }
    anchors++;
    // The project's own market, plus the markets its records actually sit in: a
    // project can hold records filed in more than one jurisdiction label.
    const markets = new Set<string>([p.market ?? '', ...rows.map((l) => l.location ?? '')].filter(Boolean));
    for (const m of markets) {
      add(p.primary_applicant, m, p.name, 'project');
      add(p.primary_representative, m, p.name, 'project');
    }
    for (const l of rows) {
      const m = l.location ?? p.market ?? '';
      // presented_by is deliberately absent, for the reason cluster.ts gives: it
      // names the staff member who read the item out, which is the city.
      add(l.applicant, m, p.name, 'applicant');
      add(l.representative, m, p.name, 'representative');
    }
  }

  index = next;
  lastReport = {
    projects: projects.length,
    anchors,
    entities: [...next.values()].reduce((a, b) => a + b.length, 0),
    rejectedGeneric,
    rejectedShort,
    nonAnchorProjects,
  };
  return lastReport;
}

// Clear the index (tests, and runs that must not consult the register).
export function resetKnownEntities(): void {
  index = new Map();
  lastReport = null;
}

function fold(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Does a known entity for THIS MARKET appear in the record's text?
//
// Matched on the punctuation-folded text, the same way targets.ts matches a
// multi-word bypass term, so "NEVADA PALACE, LLC" in a staff report matches the
// normalized 'nevada palace'. Market-scoped: an Anaheim project's applicant does
// not widen the gate in Phoenix.
export function knownEntityHit(text: string, market: string | null | undefined): KnownEntity | null {
  if (index.size === 0 || !text) return null;
  const list = index.get(marketKey(market));
  if (!list || list.length === 0) return null;
  const folded = fold(text);
  for (const e of list) {
    if (folded.includes(e.entity)) return e;
  }
  return null;
}
