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
import { fetchIncludedProjectIds } from './client-projects';
// ONE COPY, READ ACROSS THE PACKAGE SPLIT. See the header of lib/dead-feeds for
// why this is not mirrored into dashboard/lib the way taxonomy.ts is.
import { deadFeedForMarket, type DeadFeed } from '../../lib/dead-feeds';
import { OPERATOR } from '../../lib/operator';
import { buildEntry } from './report-entry';
import { streamLabel } from './streams';
import { normaliseParty, type PartyHistory } from './people';
import { captureByMarket, newestRun, type HealthRow, type MarketCapture } from '../../lib/source-health';

const RECORD_COLUMNS =
  'id,title,url,source,source_type,published_date,deadline,first_seen,date_source,' +
  'cluster_reason,status,applicant,representative,presented_by,action_sought,' +
  'contact_name,contact_email,contact_phone,primary_document_url,project_id,market,stream,' +
  // The applicant's type as the SOURCE states it. Selected because the entry has
  // to decide whether to NAME the applicant, and raw_content - where the adapter
  // used to put it - is never selected here. See migration 037.
  'applicant_type,' +
  // The figures read out of the article behind a press URL. Selected here and NOT
  // in the timeline columns: an entry prints them, the register's timeline does
  // not, and article_body is deliberately never selected anywhere - it runs to
  // 20,000 characters and no document prints it.
  'press_facts,' +
  // What the filing states about itself. Selected beside press_facts and for the
  // same reason: an entry prints both and the register's timeline prints neither.
  'filing_facts';

// A PostgREST `in` list of 2,000 uuids overflows the URL, so every id-keyed read
// below walks the list in chunks of this size.
const ID_CHUNK = 150;

// Bounded, and the bound is stated in the coverage note when it bites. A report
// is a document a person reads; one citing 5,000 records is not a report.
export const RECORD_CAP = 1500;
export const PROJECT_CAP = 2000;
// Events read per chunk of projects. A RUNAWAY GUARD, NOT A PRODUCT DECISION,
// and at 500 it was neither: measured after the chunk-loop fix, the default
// whole-register document read 500 of the 1,054 events its projects hold, so
// the coverage note printed "What moved is not a complete list" on every
// document generated. A limit that binds on the ordinary case is a limit set
// wrong.
//
// 2,000 is above everything this corpus holds and still bounds a pathological
// read. It is stated in the coverage note if it ever binds, like the other two.
export const EVENT_CAP = 2000;

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
  // OFF BY DEFAULT, for the same reason and with the same escape hatch. A market
  // whose source has stopped publishing does not enter a client document. An
  // INTERNAL document may legitimately ask what we still hold there, which is a
  // different question from what a client is sent. See the block in buildReport.
  includeFrozenMarkets?: boolean;
  geographyLabel: string;
  // HOW MANY PROJECTS THE DOCUMENT DESCRIBES IN FULL. The rest are counted.
  // See DETAIL_CAP_DEFAULT for why this is a number a person chooses.
  detailCap: number;
  // A REFERRAL BRIEF IS ONE PROJECT. Not a narrower market - a single matter,
  // written to be forwarded to someone who will act on that matter alone. The
  // scope model is geography-and-stage shaped and cannot express it, so this is
  // its own field rather than a market filter pretending to be one.
  projectId?: string | null;
  // WHICH CLIENT THIS IS FOR, so confirmed membership can be enforced.
  //
  // The scope PROPOSES; only what Philip has confirmed may be printed. Without
  // an id there is nobody whose confirmations to read, and the gate cannot run -
  // which is correct for an internal or unassigned document and is reported as
  // such rather than treated as approval. See migration 033.
  clientId?: string | null;
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
  // THE EVENTS THE DOCUMENT WAS BUILT FROM, returned for the same reason
  // `projects` is: so an audit can check the document against its own inputs
  // rather than against a separately-derived set. The event read is the one
  // place in this file that silently lost data - a single chunk with no loop -
  // and a bug that cannot be observed from outside cannot be regression-tested.
  events: SectionContext['events'];
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
    excludedDormant: number;
    // Excluded because their name is a cleaned agenda line rather than a name.
    provisionalNames: number;
    // Excluded because the source we read for their market has stopped
    // publishing. See lib/dead-feeds.
    frozenMarkets: number;
    // Excluded because the client has not confirmed them. Null when the gate did
    // not run, which is a different statement from zero: zero means every
    // proposed project was confirmed, null means confirmation is not switched
    // on. See membershipGate below.
    unconfirmed: number | null;
  };
  // HOW THE MEMBERSHIP GATE BEHAVED, so a document can state it rather than
  // leaving the reader to infer it from a count.
  //
  //   'enforced'    only confirmed projects reached the document
  //   'no-client'   no client id, so there is nobody whose confirmations to read
  //   'not-applied' migration 033 has not been run and the table does not exist
  membershipGate: 'enforced' | 'no-client' | 'not-applied';
}

/**
 * WHAT THE CLIENT'S SCOPE AXES DID, ON A DOCUMENT ABOUT ONE MATTER.
 *
 * A referral brief is selected by project id, not by the scope. The stage and
 * venue arrays still RAN - they are why this matter was offered in the picker at
 * all - and they narrowed nothing in the document a recipient is holding. So the
 * cover states their existence, their size and their effect in one sentence
 * instead of listing nineteen of them as though each one shaped this brief.
 *
 * Nothing is hidden: the counts are here, and the client scope itself is on the
 * Clients screen. Standing rule 3 asks for the count and the reason, which is
 * exactly what this is.
 */
function scopeAxisSentence(scope: ClientScope): string {
  const parts: string[] = [];
  const n = (a: unknown[] | null | undefined) => (a ?? []).length;
  if (n(scope.stages)) parts.push(`${n(scope.stages)} stages`);
  if (n(scope.venue_types)) parts.push(`${n(scope.venue_types)} venue types`);
  if (n(scope.development_categories)) parts.push(`${n(scope.development_categories)} categories`);
  if (n(scope.streams)) parts.push(`${n(scope.streams)} streams`);
  if (parts.length === 0) {
    return 'this brief is restricted to one matter, and the client scope constrains no other axis';
  }
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return (
    `this brief is restricted to one matter; the client scope (${list}) is what made it eligible ` +
    `and did not narrow this document further`
  );
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

  // ONE PROJECT MEANS A REFERRAL BRIEF, and a brief is not period-scoped. See
  // the record read below and the cover line.
  const singleProject = !!req.projectId;

  // ---- THE MATTER IS READ OFF THE MATTER --------------------------------------
  //
  // THE PLACEHOLDER MOVED RATHER THAN WENT AWAY, WHICH IS WHY THIS IS HERE AND
  // NOT DOWN THERE. The geography race was closed by reading the place off the
  // project row, and `matter` was then fed from req.geographyLabel - the very
  // label that races. The composer computes it as
  //
  //     projectChoices.find((p) => p.id === projectId)?.name ?? 'one project'
  //
  // and projectChoices is loaded asynchronously, so a build that starts before
  // the picker's list arrives gets the literal string "one project". It stopped
  // appearing under GEOGRAPHY and started appearing under MATTER, where the PDF
  // footer reads it: "JKR & Associates | one project | Every record held", on
  // every page of the brief.
  //
  // The comment I left on the old line said req.geographyLabel "is the project's
  // NAME when one project is selected - the composer and generate.ts both pass
  // it that way, and correctly". That was an assumption about a caller written
  // as a statement of fact and never checked, and generate.ts DOES pass it
  // correctly, which is why every text read-back was clean while the composer's
  // PDF was not. Same shape as the golden case
  // a-read-back-tool-builds-the-clients-document.
  //
  // So the name comes off the row this document is about, fetched by id where
  // the scope page does not carry it, and the caller's label is not consulted at
  // all. It is taken BEFORE the narrowing filters, because a brief whose project
  // the membership gate withholds must still be able to say which matter it is
  // about - that is the whole content of such a document.
  let selectedRow: Project | null = null;
  if (req.projectId) {
    selectedRow = projects.find((p) => p.id === req.projectId) ?? null;
    if (!selectedRow) {
      const { data: one, error: oneErr } = await supabase
        .from('projects')
        .select(PROJECT_COLUMNS)
        .eq('id', req.projectId)
        .maybeSingle();
      if (oneErr) throw new Error(`report project lookup failed: ${oneErr.message}`);
      selectedRow = (one ?? null) as unknown as Project | null;
    }
    // AND THE FALLBACK IS IMPOSSIBLE RATHER THAN PLAUSIBLE. A document that
    // cannot name its own matter refuses to build. The alternative is a
    // placeholder, and a placeholder is what put "one project" on six pages of a
    // client brief.
    if (!String(selectedRow?.name ?? '').trim()) {
      throw new Error(
        `report cannot name its matter: no project row with a name for id ${req.projectId}`
      );
    }
  }

  if (req.projectId) projects = projects.filter((p) => p.id === req.projectId);
  if (req.watchlistOnly) projects = projects.filter((p) => p.watch);

  // THE GEOGRAPHY THE SCOPE ASKED FOR, computed once and used by every rule that
  // has to narrow a count to this document. Lower-cased here so no rule has to
  // remember to.
  const geo = [
    ...(req.scope.markets ?? []),
    ...(req.scope.regions ?? []),
    ...(req.scope.countries ?? []),
  ].map((v) => v.toLowerCase());
  const inGeo = (p: Project) =>
    geo.length === 0 ||
    geo.includes(String(p.market ?? '').toLowerCase()) ||
    geo.includes(String(p.region_state ?? '').toLowerCase()) ||
    geo.includes(String(p.country ?? '').toLowerCase());

  // A MARKET WHOSE SOURCE HAS STOPPED PUBLISHING DOES NOT ENTER A CLIENT
  // DOCUMENT.
  //
  // Miami-Dade's Legistar feed carries nothing newer than June 2018 and San
  // Antonio's nothing newer than September 2021. Both are on the covered-markets
  // table, both captured cleanly, and both produce projects that generate
  // perfectly: every statement true, every link resolving, every date five or
  // eight years old. The period filter does not save this, because first_seen is
  // 2026 - the date OUR SCRAPER found the filing - so a "this month" report can
  // surface an eight-year-old plat as though it had just arrived.
  //
  // The worst case is not the quiet one. Five of the six projects in these two
  // markets are already dormant and would have been dropped by the dormant rule.
  // The sixth is Weston Urban: stage 'approved', 8 records, a master economic
  // incentive agreement with the City of San Antonio, and last touched in
  // September 2021. A client document would have described it in the present
  // tense, under a stage that reads as forward motion.
  //
  // FIRST OF THE PROJECT RULES, AND DELIBERATELY BEFORE THE DORMANT ONE. Whether
  // a project is dormant is a fact about that project; whether its market is
  // readable at all is a fact about the market, and it is the larger of the two.
  // A reader is owed "San Antonio is frozen" rather than five separate dormancy
  // notices and one live-looking entry.
  //
  // COUNTED ON THE PROJECT'S OWN STORED GEOGRAPHY, not on the record-keyed market
  // match that runs further down. That is safe here in a way it was not for the
  // provisional rule: this filter IS a geography filter, so the column it counts
  // on is the column it filters on, and there is nothing for the two to disagree
  // about. What it must still respect is the scope - a Nashville report must not
  // report a San Antonio exclusion - which is what inGeo does.
  let frozenExcluded: { project: Project; feed: DeadFeed }[] = [];
  if (!req.includeFrozenMarkets) {
    const keep: Project[] = [];
    for (const p of projects) {
      const feed = deadFeedForMarket(p.market, p.region_state);
      if (!feed) {
        keep.push(p);
        continue;
      }
      if (inGeo(p)) frozenExcluded.push({ project: p, feed });
    }
    projects = keep;
  }

  // A dormant project has had no heartbeat for the liveness window. Its stage is
  // written 'dormant' by the clusterer, so excluding it is a filter on the value
  // the clusterer already computed rather than a second definition of dormancy.
  //
  // COUNTED, NOT ONLY NAMED. The coverage note has always said dormant projects
  // are excluded and never said how many, which is half of the rule: a reader
  // told the reason but not the count cannot tell a document that dropped one
  // project from a document that dropped forty. Narrowed on the project's own
  // stored geography for the same reason the hollow count is - see below.
  let dormantExcluded: Project[] = [];
  // A BRIEF YOU ASKED FOR BY NAME IS NOT DROPPED BY A DOCUMENT-LEVEL FILTER.
  //
  // Dormancy selects WHICH projects a market report is worth spending pages on.
  // A referral brief has already been pointed at one, by a person, from that
  // project's own page - so applying the selection rule to it produces a
  // document about nothing: The Coney is dormant, and its brief read "No
  // project in this scope has a filing in the period, so there is nothing to
  // describe" over a project holding five records.
  if (!req.includeDormant && !singleProject) {
    const keep: Project[] = [];
    for (const p of projects) {
      if (p.stage === 'dormant') {
        if (inGeo(p)) dormantExcluded.push(p);
      } else keep.push(p);
    }
    projects = keep;
  }

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
  const excludedHollow = hollow.filter(inGeo).length;

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

  // ---- THE MEMBERSHIP GATE ------------------------------------------------
  //
  // ONLY A CONFIRMED PROJECT MAY BE PRINTED.
  //
  // Everything above this line is the scope resolving, and a resolved scope is a
  // PROPOSAL: it says "these look like Simtec's", and it is right most of the
  // time and wrong in a way nobody can see - a market spelled differently, a
  // venue type that means something else in this jurisdiction, a project that
  // matches on paper and would embarrass everyone in a document. Until now the
  // proposal WAS the document, with no step between the query and the client.
  //
  // THE THREE OUTCOMES ARE DISTINCT AND THE DOCUMENT SAYS WHICH ONE HAPPENED.
  // The dangerous failure is treating "confirmation is not switched on" as
  // "everything is confirmed", which is what an empty Set would do: it is the
  // same shape as "nothing is confirmed" and the opposite meaning, and one of
  // those empties every document while the other prints everything. So
  // fetchIncludedProjectIds returns null for an absent table and this branches
  // on it explicitly.
  //
  // It runs LAST, after every scope axis, because it is a decision about the
  // proposal rather than part of making it - and because that keeps the count
  // below meaningful: it is projects the scope proposed and Philip has not
  // confirmed, not projects that were never in scope.
  let unconfirmed: number | null = null;
  let membershipGate: BuiltReport['membershipGate'] = 'no-client';
  if (req.clientId) {
    const included = await fetchIncludedProjectIds(req.clientId);
    if (included === null) {
      membershipGate = 'not-applied';
    } else {
      membershipGate = 'enforced';
      const before = projects.length;
      projects = projects.filter((p) => included.has(p.id));
      unconfirmed = before - projects.length;
    }
  }

  // A COUNT MUST BE ABOUT THIS DOCUMENT, ON EVERY AXIS THE SCOPE NARROWS.
  //
  // The frozen-market and dormancy rules run above, before the stream and
  // record-facet matches, because both are properties of the project rather than
  // of its filings. That ordering is right for the FILTER and wrong for the
  // COUNT: a scope narrowed by category rather than by geography passes inGeo
  // trivially, so the number that reached the page was the whole register's.
  // Measured by the exclusion audit: a Hospitality/Tourism document stated 6
  // frozen and 86 dormant when its own scope held 1 and 25.
  //
  // This is the identical failure the provisional rule had - a document stating
  // a count that is not about itself - and it is worth the two round trips it
  // costs, which are only paid when something was actually excluded.
  //
  // The hollow count is deliberately NOT narrowed here: a hollow project has no
  // live record for either filter to match on, so passing it through would
  // silently zero it. Its geography-only narrowing is the best evidence that
  // exists about it, and the comment above it says so.
  const narrowToScope = async (rows: Project[]): Promise<Project[]> => {
    if (rows.length === 0) return rows;
    let out = rows;
    if (streams) {
      const keep = await projectsHoldingStreams(out.map((p) => p.id), streams);
      out = out.filter((p) => keep.has(p.id));
    }
    if (hasRecordFacets(recordFacets)) {
      const keep = await projectsMatchingRecordFacets(out.map((p) => p.id), recordFacets);
      out = out.filter((p) => keep.has(p.id));
    }
    return out;
  };
  if (streams || hasRecordFacets(recordFacets)) {
    const keptFrozen = await narrowToScope(frozenExcluded.map((f) => f.project));
    const keptIds = new Set(keptFrozen.map((p) => p.id));
    frozenExcluded = frozenExcluded.filter((f) => keptIds.has(f.project.id));
    dormantExcluded = await narrowToScope(dormantExcluded);
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
      // A SINGLE-PROJECT BRIEF IS NOT PERIOD-SCOPED.
      //
      // Period is a market-report concept: it answers "what happened in your
      // markets this month". A referral brief is a document about ONE project's
      // whole history, written to be forwarded to somebody who will act on it,
      // and the question it answers is "what is this". Applying a month to it
      // produced The Coney's brief reading "No project in this scope has a
      // filing in the period, so there is nothing to describe", and Heart
      // Hotel's showing 13 records where the project holds 23.
      if (!singleProject && req.period.since) q = q.gte('first_seen', req.period.since);
      if (!singleProject && req.period.until) q = q.lt('first_seen', req.period.until);
      const { data, error } = await q;
      if (error) throw new Error(`report records query failed: ${error.message}`);
      records.push(...((data ?? []) as unknown as typeof records));
    }
  }
  records = records.slice(0, RECORD_CAP);

  // ---- THE PARTIES ARE A PROPERTY OF THE PROJECT, NOT OF THE PERIOD. --------
  //
  // The read above is period-scoped, because record LINES are what happened in
  // the window. Building the PEOPLE section from the same set made a project
  // anonymous whenever its only filings inside the period were press: the
  // August report said of OCVibe "No party is named in any of the 5 records
  // captured for this project" while the register held Anaheim Real Estate
  // Partners, LLC, two named contacts and their email addresses, and the
  // referral brief printed all of them.
  //
  // That is the opposite of the product. A reader concluded we do not know who
  // is behind one of the largest entertainment developments in California.
  //
  // So a second read, unfiltered by period, used ONLY for parties. Same
  // projects, same lanes, same dismissal rule - the period is the only thing
  // dropped. Each party still carries the date of the record that named it, so
  // a current representative and one on a 2024 filing are distinguishable.
  const partyRecords: typeof records = [];
  if (ids.length) {
    for (let i = 0; i < ids.length && partyRecords.length < RECORD_CAP; i += ID_CHUNK) {
      let q = supabase
        .from('leads')
        .select(RECORD_COLUMNS)
        .in('project_id', ids.slice(i, i + ID_CHUNK))
        .neq('status', 'dismissed')
        .order('published_date', { ascending: false, nullsFirst: false })
        .limit(RECORD_CAP);
      if (streams) q = q.in('stream', streams);
      const { data, error } = await q;
      if (error) throw new Error(`report party records query failed: ${error.message}`);
      partyRecords.push(...((data ?? []) as unknown as typeof records));
    }
  }
  const partyRecordsByProject = new Map<string, typeof records>();
  for (const r of partyRecords.slice(0, RECORD_CAP)) {
    const id = r.project_id ?? '';
    if (!id) continue;
    if (!partyRecordsByProject.has(id)) partyRecordsByProject.set(id, []);
    partyRecordsByProject.get(id)!.push(r);
  }

  // Events in the period, for What moved.
  //
  // EVERY PROJECT, NOT THE FIRST 150. This read was `.in('project_id',
  // ids.slice(0, ID_CHUNK))` - one chunk, never a loop - so a scope holding
  // more projects than the chunk size silently lost the stage changes of all
  // the rest. It has not bitten yet only because the register is 142 projects
  // and the chunk is 150; at 151 a client would have been shown a "What moved"
  // section missing a market, with nothing on the page to suggest it.
  let events: SectionContext['events'] = [];
  let eventsCapped = false;
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    let eq = supabase
      .from('project_events')
      .select(
        'id,event_type,occurred_at,actor,from_value,to_value,detail,' +
          'project:projects!project_events_project_id_fkey(id,name,market,stage,watch),' +
          'lead:leads!project_events_lead_id_fkey(id,title,url,source)'
      )
      .eq('module', LIVE_PIPELINE_STORAGE_KEY)
      .in('project_id', ids.slice(i, i + ID_CHUNK))
      .order('occurred_at', { ascending: false })
      .limit(EVENT_CAP);
    if (req.period.since) eq = eq.gte('occurred_at', req.period.since);
    if (req.period.until) eq = eq.lt('occurred_at', req.period.until);
    const { data, error } = await eq;
    if (error) throw new Error(`report events query failed: ${error.message}`);
    const rows = (data ?? []) as unknown as SectionContext['events'];
    if (rows.length >= EVENT_CAP) eventsCapped = true;
    events.push(...rows);
  }

  // CROSS-MARKET HISTORY FOR THE PARTIES THE DOCUMENT WILL NAME.
  //
  // "Also representative on three Clark County entitlements" is the sentence
  // that turns a name into a lead, and it can only come from the companies
  // layer. Fetched once for the whole document rather than per entry, and only
  // for projects that will actually be described.
  const { history: partyHistory, failed: partyHistoryFailed } = await fetchPartyHistoryFor(
    projects.map((p) => p.id)
  );

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
  // TOTAL, because it is called on projects[0] where the array may be empty.
  // See the note on scope.geography below: a selected project can be filtered
  // away by nine rules and the document must still build.
  const placeOf = (p: Project | undefined) => p?.market ?? p?.region_state ?? '';
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
  // A WITHHELD SENTENCE IS ABSENCE TOO.
  //
  // A project carrying a GENERATED summary - a model's reading of several
  // filings, quoted by no document - has that sentence withheld from its entry,
  // because it cannot be RECORD (nothing says it), cannot be PRESS (nobody
  // published it) and would be a machine's paraphrase under Philip's name if it
  // were ASSESSMENT. That reasoning is unchanged. What was wrong was saying
  // nothing: the reader saw an entry with no description and no way to tell
  // "we have nothing" from "we have something we may not print".
  let withheldSummaries = 0;
  for (const p of grouped) {
    const built = buildEntry(p, recordsByProject.get(p.id) ?? [], {
      history: partyHistory,
      cap: entryCap,
      // Every record the project holds, whenever filed. See the note above.
      partyRecords: partyRecordsByProject.get(p.id) ?? [],
    });
    // Eligibility was settled before selection, so every detailed project has a
    // filing in the period and this cannot normally fire. It stays because
    // "cannot normally" is not "cannot", and an entry with nothing to cite must
    // never be printed.
    if (!built) continue;
    heldRecords += built.held;
    mergedRecords += built.merged;
    if (!built.entry.summary && p.summary && p.summary_source !== 'derived') withheldSummaries++;
    entries.push({ ...built.entry, group: placeOf(p) || null });
  }

  // ---- WHAT THE LAST RUN CAPTURED, FOR THE MARKETS THIS DOCUMENT COVERS -----
  //
  // The document path has always read lib/dead-feeds, a hand-maintained
  // DECLARATION of publishers that have stopped. It has never read what the
  // machine actually did. So a market whose capture broke this week read
  // exactly like a market with a quiet week.
  //
  // FAILS OPEN, AND THAT IS DELIBERATE. If source_health cannot be read - the
  // table is absent, migration 044 is unapplied, the request errors - the
  // document is built and says nothing about capture, rather than refusing or
  // guessing. A stated gap is the product; a refusal is an outage. See
  // lib/source-health for the three states and why they are three sentences.
  let healthRows: HealthRow[] = [];
  try {
    const { data: hr } = await supabase
      .from('source_health')
      .select('market,run_at,kept')
      .order('run_at', { ascending: false })
      .limit(2000);
    healthRows = (hr ?? []) as HealthRow[];
  } catch {
    healthRows = [];
  }
  const marketsInScope = [...new Set(projects.map((p) => p.market ?? '').filter(Boolean))];
  const captureGaps: MarketCapture[] = captureByMarket(healthRows, marketsInScope);
  const newestRunAt: string | null = newestRun(healthRows);

  const ctx: SectionContext = {
    // THE CAPS, ON THE CONTEXT, SO A SECTION CAN SAY THEY BOUND.
    //
    // `capped` was computed and returned to the CALLER, where the composer and
    // the audit script printed it - and the document did not. A report that
    // cites 1,500 of 2,300 records and says nothing is the failure this whole
    // provenance layer exists to prevent, and it was one query away from
    // happening. See the coverage note.
    caps: {
      projects: (pdata ?? []).length >= PROJECT_CAP,
      projectCap: PROJECT_CAP,
      records: records.length >= RECORD_CAP,
      recordCap: RECORD_CAP,
      events: eventsCapped,
      eventCap: EVENT_CAP,
      partyHistoryFailed,
    },
    projects,
    detailedProjects,
    undetailedProjects,
    silentProjects: silent,
    unplacedProjects: unplaced,
    excludedHollow,
    excludedDormant: dormantExcluded.length,
    // THE MEMBERSHIP GATE REACHES THE PAGE. It was computed here and returned to
    // the caller and went no further, so the one exclusion rule that can empty a
    // document entirely was the one rule the document never mentioned. Both
    // values are passed rather than a single count, because null and zero mean
    // different things and only the sections can say which one applies.
    unconfirmedMembers: unconfirmed,
    membershipGate,
    clientName: req.clientName,
    provisionalExcluded,
    frozenExcluded,
    captureGaps,
    newestRunAt,
    detailCap,
    entries,
    heldRecords,
    mergedRecords,
    withheldSummaries,
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

  // The first and last dated record, as the cover line for a brief.
  function recordSpan(rs: { published_date?: string | null; deadline?: string | null }[]): string {
    const dates = rs
      .map((r) => r.deadline ?? r.published_date ?? null)
      .filter((d): d is string => !!d)
      .map((d) => d.slice(0, 10))
      .sort();
    if (dates.length === 0) return 'Every record held; none carries a date';
    return dates[0] === dates[dates.length - 1]
      ? `Every record held, filed ${dates[0]}`
      : `Every record held, ${dates[0]} to ${dates[dates.length - 1]}`;
  }

  // ---- THE PUBLISHER IS NOT THE RECIPIENT --------------------------------
  //
  // A CLIENT IS A RECIPIENT AND NEVER A PUBLISHER. Nothing asserted that, and
  // twenty-two delivered documents carry a client's name as their brand: the
  // composer resolved `brandOverride || client.brand_name || 'Philip Kwong'`,
  // so the operator's own name won only when the first two were empty, and
  // JKR's market report was published by JKR, to JKR.
  //
  // The mechanism is fixed upstream - there is one value now and no chain to
  // get the order of - but the SHAPE is what this guards, and the shape had
  // THREE separate routes into it, found by sweeping for it before fixing the
  // first: the composer's precedence chain, generate.ts's --brand flag, and
  // client-reports.ts reading the same column. A fourth would be caught here,
  // at the one place every document is assembled, rather than at each of them.
  //
  // IT THROWS RATHER THAN WARNS. A document that misattributes its own
  // authorship must not be generated, previewed, downloaded or recorded as
  // delivered, because every one of those is a way for it to reach someone.
  //
  // A self-addressed internal read is not a misattribution and is not caught:
  // brandName equal to OPERATOR always passes, whoever it is addressed to.
  if (req.brandName.trim() !== OPERATOR) {
    const recipients = [req.clientName, req.addressee]
      .filter((n): n is string => !!n && n.trim().length > 0)
      .map((n) => n.trim().toLowerCase());
    const derived = recipients.includes(req.brandName.trim().toLowerCase());
    throw new Error(
      derived
        ? `A document's publisher must never be derived from its recipient. brandName is ` +
          `"${req.brandName}", which is who this document is FOR (client ` +
          `"${req.clientName ?? '-'}", addressee "${req.addressee}"). The publisher is the ` +
          `operator, from lib/operator.ts, and it is not per-client and not overridable.`
        : `A document's publisher is the operator and nothing else. brandName is ` +
          `"${req.brandName}" and the only permitted value is "${OPERATOR}", from ` +
          `lib/operator.ts. It is not a setting.`
    );
  }

  const doc: ReportDocument = {
    title: req.title,
    brandName: req.brandName,
    addressee: req.addressee,
    clientName: req.clientName,
    generatedAt: new Date().toISOString(),
    scope: {
      // ---- A PLACE IN THE PLACE ROW, AND THE MATTER IN ITS OWN --------------
      //
      // req.geographyLabel is the project's NAME when one project is selected -
      // the composer and generate.ts both pass it that way, and correctly, since
      // it is what the footer and the delivery record want. It is not a place,
      // and it was printed under the heading GEOGRAPHY three lines above a cover
      // sentence naming Clark County.
      //
      // So the place row is now read off the project itself, and the label the
      // caller passed moves to `matter`, where the footer reads it. Neither
      // answer is invented: both are stored columns on the row this document is
      // about.
      // A SELECTED PROJECT CAN BE FILTERED AWAY, AND THE DOCUMENT MUST STILL
      // BUILD.
      //
      // This read `placeOf(projects[0])`, which assumed that a projectId being
      // set meant a project survived to this line. It does not: `projects` is
      // narrowed by nine filters between the id match and here - dormancy,
      // hollowness, frozen markets, provisional names, streams, record facets
      // and, last, the MEMBERSHIP GATE. When the gate drops the selected
      // project the array is empty, projects[0] is undefined, and placeOf threw
      // TypeError: Cannot read properties of undefined (reading 'market') -
      // taking the whole preview down rather than rendering the state the
      // composer already has a message for.
      //
      // MEASURED, and it is not about the client: the same project throws under
      // Simtec and under JKR and builds fine with no client selected, because
      // the gate only runs when a clientId is given. JKR merely reaches it more
      // often - 127 of its rows are not `included`, 119 of them live with
      // records - so nearly every project its picker offers detonates.
      //
      // An empty set is a real and renderable state: membershipEmpty already
      // says "confirmed membership is switched on and nothing has been confirmed
      // for this client", and the coverage note states the withheld count. So
      // the place row falls back to the label the caller passed, exactly as a
      // market report does, and the document goes on to say what it withheld.
      // Both read off the selected row, which survives every filter below it
      // because it is taken before them. See THE MATTER IS READ OFF THE MATTER.
      // Where the row states no place, the honest negative is the answer: the
      // old fallback to the caller's label is what printed a project name, and
      // then a placeholder, under the heading GEOGRAPHY.
      geography: singleProject
        ? placeOf(selectedRow ?? undefined) || 'No market or state recorded on this project'
        : req.geographyLabel,
      matter: singleProject ? String(selectedRow!.name).trim() : null,
      // THE COVER STATES THE SPAN OF WHAT IT HOLDS, NOT A FILTER IT DID NOT
      // APPLY. A referral brief covers the project's whole history, so printing
      // "August 2026" on it would describe a filter that is not there and would
      // make a reader think the thirteen records below are all of them.
      period: singleProject ? recordSpan(records) : req.period.label,
      pipeline: req.scope.pipeline_id,
      filters: [
        req.watchlistOnly ? 'watch list only' : '',
        req.includeDormant ? 'dormant included' : 'dormant excluded',
        req.includeContext ? 'context records included' : 'context records excluded',
        // ---- THE SCOPE AXES, COUNTED ON A BRIEF AND LISTED ON A REPORT -------
        //
        // EVERY AXIS THE SCOPE CONSTRAINS, on the cover. The list is built from
        // the same arrays resolveScope filters on, so a filter that is applied
        // and a filter that is printed cannot come apart.
        //
        // On a ONE-MATTER BRIEF that list is nineteen entries of stage and venue
        // wrapping across four lines, and not one of them narrowed the document:
        // the project id did. They describe the population this matter was drawn
        // FROM, which is a fact about the client's scope and not about this
        // brief - and printing them as this brief's filters tells a recipient
        // the document was narrowed in ways it was not.
        //
        // Counted rather than dropped, because standing rule 3 has no exemption
        // for a list that reads badly: the reader is told the axes exist, how
        // many there are, and what they did.
        ...(singleProject
          ? [scopeAxisSentence(req.scope)]
          : [
              ...(req.scope.stages ?? []).map((s) => `stage: ${s}`),
              ...(req.scope.venue_types ?? []).map((s) => `venue: ${s}`),
              ...(req.scope.development_categories ?? []).map((s) => `category: ${s}`),
              // The cover names the stream the way the product does, not the way
              // the column stores it. See lib/streams.
              ...(req.scope.streams ?? []).map((s) => `stream: ${streamLabel(s)}`),
            ]),
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
    events,
    selection: {
      inScope: projects.length,
      detailed: detailedProjects.length,
      counted: undetailedProjects.length,
      silent: silent.length,
      unplaced: unplaced.length,
      excludedHollow,
      excludedDormant: dormantExcluded.length,
      provisionalNames: provisionalExcluded.length,
      // Excluded because the source we read for their market has stopped
      // publishing, so everything we hold for them is old.
      frozenMarkets: frozenExcluded.length,
      // Proposed by the scope and not confirmed by the client. Null when the
      // gate did not run at all - see membershipGate.
      unconfirmed,
    },
    membershipGate,
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
async function fetchPartyHistoryFor(
  projectIds: string[]
): Promise<{ history: Map<string, PartyHistory>; failed: boolean }> {
  const out = new Map<string, PartyHistory>();
  if (projectIds.length === 0) return { history: out, failed: false };
  try {
    const links: { company_id: string; project_id: string; company: { name: string } }[] = [];
    for (let i = 0; i < projectIds.length; i += ID_CHUNK) {
      const { data } = await supabase
        .from('company_projects')
        .select('company_id,project_id,company:companies!inner(name)')
        .in('project_id', projectIds.slice(i, i + ID_CHUNK));
      links.push(...((data ?? []) as unknown as typeof links));
    }
    if (links.length === 0) return { history: out, failed: false };
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
    // SWALLOWED, BUT NO LONGER SILENT. A missing history costs a sentence and a
    // report that will not generate costs the delivery, so the catch stays -
    // but the document now says the cross-market history was unavailable rather
    // than printing entries that simply never mention it.
    return { history: new Map(), failed: true };
  }
  return { history: out, failed: false };
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
    supabase.from('projects').select('id,name,market,region_state,venue_type,development_category,stage'),
    { ...query, module: query.module ?? LIVE_PIPELINE_STORAGE_KEY }
  )
    .order('last_activity', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error) throw new Error(`scope project list failed: ${error.message}`);
  let rows = applyPostFilters((data ?? []) as unknown as Record<string, unknown>[], postFilters);
  // A FROZEN MARKET IS NOT OFFERED FOR A REFERRAL BRIEF. A referral brief is the
  // most client-facing document this system produces - it is written to be
  // forwarded to someone who will act on it - so a project whose market stopped
  // publishing in 2021 must not be pickable. The generator would drop it anyway
  // and the brief would come out empty, which is the failure mode this list
  // exists to prevent: a control that offers something the generator refuses.
  rows = rows.filter((r) => !deadFeedForMarket(r.market as string | null, r.region_state as string | null));
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
