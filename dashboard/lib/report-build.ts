// ASSEMBLING A DOCUMENT. Fetch once, build every section from the same data.
//
// The sections do not fetch. Nine sections each running their own query would
// mean nine chances for two of them to disagree about what is in scope - the
// appendix listing a record the by-market section never saw - and a document
// that contradicts itself is worse than one that is thin.

import { supabase } from './supabase';
import {
  applyPostFilters,
  projectsHoldingStreams,
  resolveScope,
  type ClientScope,
} from './clients';
import { applyProjectFilters, PROJECT_COLUMNS, type Project, type TimelineRecord } from './projects';
import { LIVE_PIPELINE_STORAGE_KEY } from './pipelines';
import type { ResolvedPeriod } from './period';
import { DEFAULT_SECTION_IDS, sectionById, type SectionContext } from './report-sections';
import { estimatePages, type ReportDocument } from './report-model';
import { streamLabel } from './streams';

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
  geographyLabel: string;
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
}

export async function buildReport(req: BuildRequest): Promise<BuiltReport> {
  const { query, postFilters, streams } = resolveScope(req.scope);

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

  const chosen = (req.sectionIds.length ? req.sectionIds : DEFAULT_SECTION_IDS)
    .map(sectionById)
    .filter((s): s is NonNullable<typeof s> => !!s);

  const ctx: SectionContext = {
    projects,
    records,
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
    sections: chosen.map((s) => s.build(ctx)),
    projectCount: projects.length,
    recordCount: records.length,
  };

  return {
    doc,
    pages: estimatePages(doc),
    capped: { projects: (pdata ?? []).length >= PROJECT_CAP, records: records.length >= RECORD_CAP },
  };
}

/** The geography a scope covers, as a printable sentence for the cover. */
export function geographyLabel(scope: ClientScope): string {
  const parts: string[] = [];
  if (scope.markets?.length) parts.push(scope.markets.join(', '));
  else if (scope.regions?.length) parts.push(scope.regions.join(', '));
  else if (scope.countries?.length) parts.push(scope.countries.join(', '));
  return parts.length ? parts.join('; ') : 'all covered markets';
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
  const { query, postFilters, streams } = resolveScope(scope);
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
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    market: (r.market as string | null) ?? null,
  }));
}
