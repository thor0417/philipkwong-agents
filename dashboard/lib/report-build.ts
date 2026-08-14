// ASSEMBLING A DOCUMENT. Fetch once, build every section from the same data.
//
// The sections do not fetch. Nine sections each running their own query would
// mean nine chances for two of them to disagree about what is in scope - the
// appendix listing a record the by-market section never saw - and a document
// that contradicts itself is worse than one that is thin.

import { supabase } from './supabase';
import {
  applyPostFilters,
  hasRecordFacets,
  projectsHoldingStreams,
  projectsMatchingRecordFacets,
  resolveScope,
  type ClientScope,
} from './clients';
import { applyProjectFilters, PROJECT_COLUMNS, type Project, type TimelineRecord } from './projects';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import type { ResolvedPeriod } from './period';
import { DEFAULT_SECTION_IDS, sectionById, type SectionContext } from './report-sections';
import { estimatePages, type Entry, type ReportDocument } from './report-model';
import { isProvisionalName } from './taxonomy';
import { buildEntry } from './report-entry';
import { streamLabel } from './streams';
import { normaliseParty, type PartyHistory } from './people';

const RECORD_COLUMNS =
  'id,title,url,source,source_type,published_date,deadline,first_seen,date_source,' +
  'cluster_reason,status,applicant,representative,presented_by,action_sought,' +
  'contact_name,contact_email,contact_phone,primary_document_url,project_id,market,stream';

// A PostgREST `in` list of 2,000 uuids overflows the URL, so every id-keyed read
// below walks the list in chunks of this size.
const ID_CHUNK = 150;

// Bounded, and the bound is stated in the coverage note when it bites. A report
// is a document a person reads; one citing 5,000 records is not a report.
export const RECORD_CAP = 1500;
export const PROJECT_CAP = 2000;

// HOW MANY PROJECTS A DOCUMENT DESCRIBES IN FULL.
//
// The generated report that started this rewrite listed 229 projects at one
// line each, which is not a document anyone reads: it is the register, printed.
// The fix is not a smaller list, it is SELECTION - the most significant N
// described properly, and the rest counted so the reader knows they exist.
//
// 15 IS A DEFAULT, NOT A LIMIT, and it is configurable from the composer for a
// reason: the July report ran 26 pages and detailed considerably more than 15.
// What the right number is depends on what an entry costs in page space, which
// could not be judged until entries existed. So the composer offers it and the
// document states it.
export const DETAIL_CAP_DEFAULT = 15;

export interface BuildRequest {
  scope: ClientScope;
  period: ResolvedPeriod;
  sectionIds: string[];
  commentary: Record<string, string>;
  title: string;
  brandName: string;
  addressee: string;
  clientName: string | null;
  watchlistOnly: boolean;
  includeDormant: boolean;
  includeContext: boolean;
  // OFF BY DEFAULT, and the default is the point. A document may only name a
  // project whose name something published. See the block in buildReport.
  // Exposed at all so an INTERNAL document can be generated with them, which is
  // a different question from what a client is sent.
  includeProvisionalNames?: boolean;
  geographyLabel: string;
  // HOW MANY PROJECTS THE DOCUMENT DESCRIBES IN FULL. The rest are counted.
  // See DETAIL_CAP_DEFAULT for why this is a number a person chooses.
  detailCap: number;
  // A REFERRAL BRIEF IS ONE PROJECT. Not a narrower market - a single matter,
  // written to be forwarded to someone who will act on that matter alone. The
  // scope model is geography-and-stage shaped and cannot express it, so this is
  // its own field rather than a market filter pretending to be one.
  projectId?: string | null;
}

export interface BuiltReport {
  doc: ReportDocument;
  pages: number;
  capped: { projects: boolean; records: boolean };
  // THE PROJECTS THE DOCUMENT WAS BUILT FROM. Returned so a document can be
  // audited against its own contents rather than against a separately-derived
  // set: re-running the scope query to check a report is checking the query,
  // not the report, and the two can differ for exactly the reasons an audit
  // exists to catch.
  projects: Project[];
  // WHAT THE SELECTION DID, in numbers, so the composer and the audit harness
  // can assert on it without re-deriving it. Reported on the cover as well:
  // every project in scope is in exactly one of detailed, counted or silent,
  // and excludedHollow is the set that never reached scope at all.
  selection: {
    inScope: number;
    detailed: number;
    counted: number;
    silent: number;
    unplaced: number;
    excludedHollow: number;
    // Excluded because their name is a cleaned agenda line rather than a name.
    provisionalNames: number;
  };
}

export async function buildReport(req: BuildRequest): Promise<BuiltReport> {
  const { query, postFilters, streams, recordFacets } = resolveScope(req.scope);

  const { data: pdata, error: perr } = await applyProjectFilters(
    supabase.from('projects').select(PROJECT_COLUMNS),
    { ...query, module: query.module ?? LIVE_PIPELINE_STORAGE_KEY }
  )
    .order('last_activity', { ascending: false, nullsFirst: false })
    .limit(PROJECT_CAP);
  if (perr) throw new Error(`report projects query failed: ${perr.message}`);

  let projects = applyPostFilters(
    (pdata ?? []) as unknown as Record<string, unknown>[],
    postFilters
  ) as unknown as Project[];

  if (req.projectId) projects = projects.filter((p) => p.id === req.projectId);
  if (req.watchlistOnly) projects = projects.filter((p) => p.watch);

  // A dormant project has had no heartbeat for the liveness window. Its stage is
  // written 'dormant' by the clusterer, so excluding it is a filter on the value
  // the clusterer already computed rather than a second definition of dormancy.
  if (!req.includeDormant) projects = projects.filter((p) => p.stage !== 'dormant');

  // HOLLOW PROJECTS ARE EXCLUDED ENTIRELY, not merely left undetailed.
  //
  // A project whose every record has been dismissed has nothing to tell a
  // client. It has no filing to cite, no date, no party and no link, so it can
  // only ever appear as a name - which is the by-market line this rewrite
  // deleted. When this was specified, 91 projects were in that state, and 3 of
  // them were the whole of Simtec's "hearing scheduled" tier: a reader looking
  // for forward motion would have found the tier hollow and drawn the obvious
  // conclusion about the rest of the document.
  //
  // record_count is maintained as the count of LIVE rows by the clusterer's
  // recount pass (agents/scraper/project-recount.ts skips dismissed), so this
  // is a filter on a number the pipeline already computes rather than a second
  // definition of the same thing. verify-curation reports drift on it.
  const hollow = projects.filter((p) => (p.record_count ?? 0) <= 0);
  projects = projects.filter((p) => (p.record_count ?? 0) > 0);

  // COUNTED FOR THIS GEOGRAPHY, NOT FOR THE REGISTER.
  //
  // The count was `before - after` at this point, which is every hollow project
  // in the pipeline: a Nashville report stated "2 projects whose every record
  // has been dismissed are excluded", and both were in Yonkers and Oakland.
  //
  // It cannot be fixed by moving this filter below the market match, because
  // the market match runs against a project's RECORDS and a hollow project has
  // none - it would be dropped there and the count would silently read zero,
  // which is the same failure wearing the opposite sign.
  //
  // So the count is narrowed using the hollow project's OWN stored geography.
  // That is the only evidence left about where it was: its records are gone.
  const geo = [
    ...(req.scope.markets ?? []),
    ...(req.scope.regions ?? []),
    ...(req.scope.countries ?? []),
  ].map((v) => v.toLowerCase());
  const excludedHollow = geo.length
    ? hollow.filter((p) =>
        geo.includes(String(p.market ?? '').toLowerCase()) ||
        geo.includes(String(p.region_state ?? '').toLowerCase()) ||
        geo.includes(String(p.country ?? '').toLowerCase())
      ).length
    : hollow.length;

  // THE STREAM AXIS, APPLIED TO PROJECTS AS WELL AS TO RECORDS.
  //
  // `stream` names the capture lane and lives on leads, so filtering only the
  // records would leave the project list untouched: a cover reading "stream:
  // opportunity" above a By-market list of projects whose every record came
  // from the government lane, each printed as "no filing in this period". That
  // is the silent-omission failure inverted - a document claiming a narrower
  // scope than it has.
  //
  // So a project is in scope only if it holds a record in one of the named
  // lanes. Deliberately asked WITHOUT the period: the streams a client buys are
  // what they are covered for, while the period governs what is shown. A
  // project whose opportunity filings all predate the month is still theirs.
  //
  // Last of the project filters, because it is the only one that costs a round
  // trip and this is the smallest the set will get.
  if (streams && projects.length) {
    const keep = await projectsHoldingStreams(projects.map((p) => p.id), streams);
    projects = projects.filter((p) => keep.has(p.id));
  }

  // MARKET, VENUE AND CATEGORY, MATCHED AGAINST THE RECORDS. Each is a mode over
  // a project's records, so filtering the stored column asks whether the
  // project's most common value matches rather than whether the project has any
  // record that does. A client scoped to Casino/Gaming was not shown Top Gun Las
  // Vegas, which is filed as a Family Entertainment Center and whose records
  // name both Integrated Resort and Casino/Gaming.
  if (hasRecordFacets(recordFacets) && projects.length) {
    const keep = await projectsMatchingRecordFacets(projects.map((p) => p.id), recordFacets);
    projects = projects.filter((p) => keep.has(p.id));
  }

  // A PROVISIONAL NAME DOES NOT REACH A CLIENT DOCUMENT, AND IS NOT HEDGED
  // EITHER.
  //
  // name_source 'title' means the name was assembled from an agenda line: it is
  // the instrument the council was handed, not what the thing is called. There
  // are three ways to handle that and only one of them is honest.
  //
  //   PRINT IT PLAINLY   the client reads "possible action to approve the Third
  //                      Amendment to Lease and Operating Agreement" as the name
  //                      of a project, which is false.
  //   PRINT IT HEDGED    the client reads "Provisional: ..." and learns that our
  //                      system was unsure. That is a fact about us, not about
  //                      the project, and it belongs in no document we send.
  //   LEAVE IT OUT       and say how many were left out, and why.
  //
  // The third. The register still shows every one of them and marks the source,
  // because internally the question "which of these do we not have a name for"
  // is exactly the question worth asking.
  //
  // LAST OF THE PROJECT FILTERS, AFTER THE MARKET AND CATEGORY MATCH, AND THAT
  // ORDER IS THE WHOLE CORRECTNESS OF THE COUNT.
  //
  // It ran before them, so the number the document printed was the number
  // excluded from the WHOLE REGISTER: a Clark County report stated 32 when 3 of
  // its own projects were affected, and a Nashville report stated 32 over a
  // scope of 9. A document stating a count that is not about itself is the
  // exact failure this rule was added to prevent, one level up. Found by
  // dashboard/scripts/exclusion-audit, which is why that harness exists.
  //
  // COUNTED PER MARKET, because the coverage note names the markets it thinned.
  // Nothing is silently absent: every project removed here is in the sentence
  // the coverage note prints.
  const provisionalExcluded: Project[] = [];
  if (!req.includeProvisionalNames) {
    const keep: Project[] = [];
    for (const p of projects) {
      if (isProvisionalName(p.name_source)) provisionalExcluded.push(p);
      else keep.push(p);
    }
    projects = keep;
  }


  const ids = projects.map((p) => p.id);
  let records: (TimelineRecord & { project_id?: string | null; market?: string | null })[] = [];
  if (ids.length) {
    for (let i = 0; i < ids.length && records.length < RECORD_CAP; i += ID_CHUNK) {
      let q = supabase
        .from('leads')
        .select(RECORD_COLUMNS)
        .in('project_id', ids.slice(i, i + ID_CHUNK))
        .neq('status', 'dismissed')
        .order('published_date', { ascending: false, nullsFirst: false })
        .limit(RECORD_CAP);
      // The same lanes, now on the records themselves: an out-of-scope filing
      // must not be cited in a document that says it does not cover that lane.
      if (streams) q = q.in('stream', streams);
      if (req.period.since) q = q.gte('first_seen', req.period.since);
      if (req.period.until) q = q.lt('first_seen', req.period.until);
      const { data, error } = await q;
      if (error) throw new Error(`report records query failed: ${error.message}`);
      records.push(...((data ?? []) as unknown as typeof records));
    }
  }
  records = records.slice(0, RECORD_CAP);

  // Events in the period, for What moved. Scoped to the projects in hand.
  let events: SectionContext['events'] = [];
  if (ids.length) {
    let eq = supabase
      .from('project_events')
      .select(
        'id,event_type,occurred_at,actor,from_value,to_value,detail,' +
          'project:projects!project_events_project_id_fkey(id,name,market,stage,watch),' +
          'lead:leads!project_events_lead_id_fkey(id,title,url,source)'
      )
      .eq('module', LIVE_PIPELINE_STORAGE_KEY)
      .in('project_id', ids.slice(0, ID_CHUNK))
      .order('occurred_at', { ascending: false })
      .limit(500);
    if (req.period.since) eq = eq.gte('occurred_at', req.period.since);
    if (req.period.until) eq = eq.lt('occurred_at', req.period.until);
    const { data, error } = await eq;
    if (error) throw new Error(`report events query failed: ${error.message}`);
    events = (data ?? []) as unknown as SectionContext['events'];
  }

  // CROSS-MARKET HISTORY FOR THE PARTIES THE DOCUMENT WILL NAME.
  //
  // "Also representative on three Clark County entitlements" is the sentence
  // that turns a name into a lead, and it can only come from the companies
  // layer. Fetched once for the whole document rather than per entry, and only
  // for projects that will actually be described.
  const partyHistory = await fetchPartyHistoryFor(projects.map((p) => p.id));

  const chosen = (req.sectionIds.length ? req.sectionIds : DEFAULT_SECTION_IDS)
    .map(sectionById)
    .filter((s): s is NonNullable<typeof s> => !!s);

  // ---- SELECTION, DECIDED ONCE ------------------------------------------
  //
  // WHICH projects the document describes is a property of the document, not of
  // a section. Deciding it inside by-market would mean the cover could not
  // state it without recomputing it, and two computations of the same thing
  // eventually disagree - which is how a cover reading "229 projects" ended up
  // over a list of 122.
  //
  // ELIGIBILITY COMES BEFORE RANK. A project with no filing inside the period
  // cannot produce an entry, so ranking first and taking the top 15 would spend
  // the budget on projects that then print nothing. The silent ones are counted
  // separately, because "in your scope and quiet this month" and "in your scope
  // and less significant" are different facts and a client should not have them
  // merged.
  // A PROJECT WITH NO RESOLVED PLACE IS NEVER A MARKET SECTION.
  //
  // The by-market grouping used to fall back to the string 'Unassigned', which
  // turned "we do not know where this is" into a heading that reads like a
  // region. A hospitality market report went out with an "Unassigned" section
  // carrying World Bank consultancy tenders - Senior Credit Officer, Savusavu
  // Participatory Sanitation Master Plan, Marketing Telecommunications
  // opportunities in Kiribati - presented to the client as a market they are
  // covered for.
  //
  // 18 of the 171 live projects are in this state today, all of them
  // development-bank tenders that arrived through the opportunity lane with a
  // country and nothing finer.
  //
  // They are NOT dropped from the report. A client scoped by country may
  // legitimately hold them, and deleting them from the counts would understate
  // what is in scope. They are counted as their own bucket and named in the
  // coverage note, in the same way silent projects are: the document says the
  // thing it knows, which is that these exist and could not be placed.
  //
  // region_state counts as a place. A state is somewhere; only a project with
  // neither a market nor a region is unplaced.
  const placed = (p: Project) => !!(p.market ?? p.region_state);
  const unplaced = projects.filter((p) => !placed(p));

  const withPeriodRecords = new Set(records.map((r) => r.project_id ?? '').filter(Boolean));
  const eligible = projects.filter((p) => placed(p) && withPeriodRecords.has(p.id));
  const silent = projects.filter((p) => placed(p) && !withPeriodRecords.has(p.id));
  const ranked = [...eligible].sort(
    (a, b) =>
      (b.significance ?? -1) - (a.significance ?? -1) ||
      (b.record_count ?? 0) - (a.record_count ?? 0) ||
      a.name.localeCompare(b.name)
  );
  const detailCap = Math.max(1, Math.floor(req.detailCap || DETAIL_CAP_DEFAULT));
  const detailedProjects = ranked.slice(0, detailCap);
  const undetailedProjects = ranked.slice(detailCap);

  // ---- THE ENTRIES, BUILT ONCE ------------------------------------------
  //
  // Ordered by MARKET and then by significance inside it, so that the category
  // sections can print a market subheading whenever `group` changes and never
  // print the same market twice. Markets ordered by how much of the document
  // they hold, which is a consequence of significance rather than of how many
  // rows a clerk happened to file.
  //
  // Built here rather than in a section because two sections now need the
  // result: the category sections print the entries, and the coverage note
  // counts the filings they held back. See SectionContext.entries.
  const recordsByProject = new Map<string, typeof records>();
  for (const r of records) {
    const id = r.project_id ?? '';
    if (!id) continue;
    if (!recordsByProject.has(id)) recordsByProject.set(id, []);
    recordsByProject.get(id)!.push(r);
  }
  const placeOf = (p: Project) => p.market ?? p.region_state ?? '';
  const marketWeight = new Map<string, number>();
  for (const p of detailedProjects) {
    marketWeight.set(placeOf(p), (marketWeight.get(placeOf(p)) ?? 0) + 1);
  }
  const grouped = [...detailedProjects].sort(
    (a, b) =>
      (marketWeight.get(placeOf(b)) ?? 0) - (marketWeight.get(placeOf(a)) ?? 0) ||
      placeOf(a).localeCompare(placeOf(b)) ||
      (b.significance ?? -1) - (a.significance ?? -1) ||
      a.name.localeCompare(b.name)
  );
  // A REFERRAL BRIEF SHOWS EVERY FILING IT HAS.
  //
  // The per-entry cap exists so that one busy project cannot consume a market
  // report; a referral brief IS one project, so the cap is the wrong rule
  // applied to the right code. Measured on Heart Hotel: 23 records in scope, 8
  // printed, and the 15 the cap dropped included TM-26-500056 - one of the two
  // entitlement filings the July brief cites by name. A brief whose cover says
  // 23 records and whose record provenance shows one filing is a document that
  // contradicts itself on its own first page.
  const entryCap = req.projectId ? RECORD_CAP : undefined;

  const entries: Entry[] = [];
  let heldRecords = 0;
  let mergedRecords = 0;
  for (const p of grouped) {
    const built = buildEntry(p, recordsByProject.get(p.id) ?? [], {
      history: partyHistory,
      cap: entryCap,
    });
    // Eligibility was settled before selection, so every detailed project has a
    // filing in the period and this cannot normally fire. It stays because
    // "cannot normally" is not "cannot", and an entry with nothing to cite must
    // never be printed.
    if (!built) continue;
    heldRecords += built.held;
    mergedRecords += built.merged;
    entries.push({ ...built.entry, group: placeOf(p) || null });
  }

  const ctx: SectionContext = {
    projects,
    detailedProjects,
    undetailedProjects,
    silentProjects: silent,
    unplacedProjects: unplaced,
    excludedHollow,
    provisionalExcluded,
    detailCap,
    entries,
    heldRecords,
    mergedRecords,
    pipelineId: req.scope.pipeline_id,
    records,
    partyHistory,
    events,
    sectionIds: chosen.map((s) => s.id),
    periodLabel: req.period.label,
    periodSince: req.period.since ?? null,
    periodUntil: req.period.until ?? null,
    geographyLabel: req.geographyLabel,
    commentary: req.commentary,
    includeDormant: req.includeDormant,
    includeContext: req.includeContext,
    watchlistOnly: req.watchlistOnly,
  };

  const doc: ReportDocument = {
    title: req.title,
    brandName: req.brandName,
    addressee: req.addressee,
    clientName: req.clientName,
    generatedAt: new Date().toISOString(),
    scope: {
      geography: req.geographyLabel,
      period: req.period.label,
      pipeline: req.scope.pipeline_id,
      filters: [
        req.watchlistOnly ? 'watch list only' : '',
        req.includeDormant ? 'dormant included' : 'dormant excluded',
        req.includeContext ? 'context records included' : 'context records excluded',
        // EVERY AXIS THE SCOPE CONSTRAINS, on the cover. The list is built from
        // the same arrays resolveScope filters on, so a filter that is applied
        // and a filter that is printed cannot come apart.
        ...(req.scope.stages ?? []).map((s) => `stage: ${s}`),
        ...(req.scope.venue_types ?? []).map((s) => `venue: ${s}`),
        ...(req.scope.development_categories ?? []).map((s) => `category: ${s}`),
        // The cover names the stream the way the product does, not the way the
        // column stores it. See lib/streams.
        ...(req.scope.streams ?? []).map((s) => `stream: ${streamLabel(s)}`),
      ].filter(Boolean),
      periodOpen: !req.period.closed,
    },
    // A registry entry may produce several sections - the category block is one
    // entry and N headings - so the result is flattened in document order.
    sections: chosen.flatMap((s) => {
      const built = s.build(ctx);
      return Array.isArray(built) ? built : [built];
    }),
    projectCount: projects.length,
    recordCount: records.length,
  };

  return {
    doc,
    pages: estimatePages(doc),
    capped: { projects: (pdata ?? []).length >= PROJECT_CAP, records: records.length >= RECORD_CAP },
    projects,
    selection: {
      inScope: projects.length,
      detailed: detailedProjects.length,
      counted: undetailedProjects.length,
      silent: silent.length,
      unplaced: unplaced.length,
      excludedHollow,
      provisionalNames: provisionalExcluded.length,
    },
  };
}

/**
 * Where each party of these projects appears elsewhere, keyed by normalised
 * name. Two queries for the whole document: the companies on these projects,
 * then the OTHER projects those companies are attached to.
 *
 * Returns an empty map on any failure rather than throwing. A missing history
 * costs a sentence; a report that will not generate because the companies table
 * hiccuped costs the delivery.
 */
async function fetchPartyHistoryFor(projectIds: string[]): Promise<Map<string, PartyHistory>> {
  const out = new Map<string, PartyHistory>();
  if (projectIds.length === 0) return out;
  try {
    const links: { company_id: string; project_id: string; company: { name: string } }[] = [];
    for (let i = 0; i < projectIds.length; i += ID_CHUNK) {
      const { data } = await supabase
        .from('company_projects')
        .select('company_id,project_id,company:companies!inner(name)')
        .in('project_id', projectIds.slice(i, i + ID_CHUNK));
      links.push(...((data ?? []) as unknown as typeof links));
    }
    if (links.length === 0) return out;
    const nameById = new Map(links.map((l) => [l.company_id, l.company?.name ?? '']));
    const mine = new Set(projectIds);
    const ids = [...nameById.keys()];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const { data } = await supabase
        .from('company_projects')
        .select('company_id,project_id,role,project:projects!inner(market)')
        .in('company_id', ids.slice(i, i + ID_CHUNK));
      for (const r of (data ?? []) as unknown as {
        company_id: string;
        project_id: string;
        role: string | null;
        project: { market: string | null };
      }[]) {
        if (mine.has(r.project_id) || !r.project) continue;
        const key = normaliseParty(nameById.get(r.company_id) ?? '');
        if (!key) continue;
        if (!out.has(key)) out.set(key, { projects: [] });
        out.get(key)!.projects.push({ market: r.project.market, role: r.role });
      }
    }
  } catch {
    return new Map();
  }
  return out;
}

/** The geography a scope covers, as a printable sentence for the cover. */
/**
 * The geography a document covers, stated in full.
 *
 * EVERY CONSTRAINED LEVEL IS NAMED. This used to be an else-if chain: markets
 * won, and if any were set the region and country were never printed. A report
 * scoped to Nevada AND Las Vegas said only "Las Vegas", which understates the
 * filter that was actually applied - the axes are ANDed, so both are load
 * bearing and a reader who sees one has been told half the rule.
 *
 * The levels are named outermost first, the way a person says where something
 * is, and joined with a separator that reads as narrowing rather than as a
 * list of alternatives.
 *
 * "all covered markets" is only ever returned when NOTHING constrains the
 * geography. A document that covers three markets must never imply national
 * coverage, and the only honest way to guarantee that is for the label to be
 * built from the same object the generator filters on.
 */
export function geographyLabel(scope: ClientScope): string {
  const levels: string[] = [];
  if (scope.countries?.length) levels.push(scope.countries.join(', '));
  if (scope.regions?.length) levels.push(scope.regions.join(', '));
  if (scope.markets?.length) levels.push(scope.markets.join(', '));
  return levels.length ? levels.join(' > ') : 'all covered markets';
}

/**
 * The projects a scope covers, id and name only, for the referral picker.
 *
 * A separate small query rather than a byproduct of buildReport: the picker must
 * be populated before a project is chosen, and buildReport's cost is in fetching
 * every record behind every project, which the picker does not need.
 */
export async function listScopeProjects(
  scope: ClientScope
): Promise<{ id: string; name: string; market: string | null }[]> {
  const { query, postFilters, streams, recordFacets } = resolveScope(scope);
  const { data, error } = await applyProjectFilters(
    supabase.from('projects').select('id,name,market,venue_type,development_category,stage'),
    { ...query, module: query.module ?? LIVE_PIPELINE_STORAGE_KEY }
  )
    .order('last_activity', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(`scope project list failed: ${error.message}`);
  let rows = applyPostFilters((data ?? []) as unknown as Record<string, unknown>[], postFilters);
  // The picker offers what the report would cover, stream axis included. A
  // picker listing a project the generator then drops is a control that lies.
  if (streams && rows.length) {
    const keep = await projectsHoldingStreams(rows.map((r) => String(r.id)), streams);
    rows = rows.filter((r) => keep.has(String(r.id)));
  }
  // Same record-based match as buildReport, for the same reason: a picker that
  // offers a different set from the one the generator covers is a control that
  // lies.
  if (hasRecordFacets(recordFacets) && rows.length) {
    const keep = await projectsMatchingRecordFacets(rows.map((r) => String(r.id)), recordFacets);
    rows = rows.filter((r) => keep.has(String(r.id)));
  }
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    market: (r.market as string | null) ?? null,
  }));
}
