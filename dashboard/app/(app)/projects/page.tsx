'use client';

// PROJECTS. The master view: rail, list, detail.
//
// WHY THIS IS THE PROJECT SURFACE AND NOT THE RECORD TABLE. The brief specifies
// the columns as project / applicant / market / stage / last activity, and the
// detail pane as record count, people with provenance, and a timeline of every
// record. Those are project properties; a single record has no timeline of
// records. The record table still exists, unchanged, at /records.
//
// EVERY FILTER AND THE SELECTION LIVE IN THE URL. A filtered Projects is a link
// you can send, the back button steps through the filters you applied, and a
// reload puts you back exactly where you were, mid-triage, on the same row.
//
// TRIAGE IS A KEYBOARD JOB. J and K to move, Enter to open, E to dismiss, W to
// watch, Escape to close. A tool that needs the mouse to clear a backlog does
// not get used to clear a backlog.

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryState, parseAsString, parseAsInteger } from 'nuqs';
import { PROJECT_STAGES, isProvisionalName } from '@/lib/taxonomy';
import { LIVE_PIPELINE_STORAGE_KEY } from '@/lib/pipelines';
import {
  DEFAULT_PROJECT_PAGE_SIZE,
  type LooseField,
  type Project,
  type ProjectQuery,
} from '@/lib/projects';
import {
  useProjectPage,
  useProjectCount,
  useProjectFacet,
  useMarketFacetFromRecords,
  useProjectMutations,
} from '@/lib/use-projects';
import PeriodSelector from '@/components/PeriodSelector';
import { BUCKETS, PERIOD_AXES, bucketOf, type BucketMode } from '@/lib/period';
import {
  usePeriodState,
  useArrivedProjectIds,
  useMovedProjectIds,
  useProjectIdsMatchingRecords,
} from '@/lib/use-period';
// The one copy, read across the package split. See lib/dead-feeds.
import { deadFeedForMarket } from '../../../../lib/dead-feeds';
import { useCoverage } from '@/lib/use-coverage';
import ProjectsRail from './ProjectsRail';
import ProjectsDetail from './ProjectsDetail';
import styles from './page.module.css';

// The views from Brief A, on the project axis. 'all' is the working set:
// everything except dismissed, because a working set that includes the bin is
// not a working set.
//
// INBOX IS DELIBERATELY ABSENT. The brief lists it, but Inbox means records not
// yet attached to any project, and this is the PROJECT register: as a project
// filter it can only resolve to "every project", which is what All already is.
// It shipped that way for one build and read as 184 next to All's 184, which is
// a control that lies about doing something. It belongs on the Records screen,
// where an unattached record is a real thing.
const VIEWS = [
  { key: 'new', label: 'New' },
  { key: 'watchlist', label: 'Watchlist' },
  { key: 'client_ready', label: 'Client ready' },
  { key: 'all', label: 'All' },
  { key: 'trash', label: 'Trash' },
] as const;
type ViewKey = (typeof VIEWS)[number]['key'];
const VIEW_KEYS = VIEWS.map((v) => v.key) as [ViewKey, ...ViewKey[]];

// Saved views are filter combinations worth one click. Deliberately a constant
// rather than a stored list: a saved view nobody named is a bookmark, and the
// URL already does bookmarks.
// Saved views are filter COMBINATIONS worth one click, and every one of them
// must actually change the result set. Two earlier entries did not and were
// removed rather than documented:
//
//   "No stage yet"    set stage to null, which is what All already does.
//                     applyProjectFilters has no "stage IS NULL" case, so an
//                     unstaged filter is not expressible against this schema.
//   "Watched, moving" only filtered on watch, so the label promised a
//                     movement filter the query never applied.
const SAVED = [
  { key: 'none', label: 'None' },
  { key: 'anaheim', label: 'Anaheim' },
  { key: 'approved', label: 'Approved, anywhere' },
  { key: 'hearing', label: 'Hearing scheduled' },
] as const;

// PROJECTS OPENS ON THE UNITED STATES.
//
// All ten covered markets are US. The other 22 projects are global intelligence
// captures - a Jeddah headline, a Queensland trade item - which are worth having
// and are not what Philip triages. Mixed into the default list they pad the
// count and put a row with no market between two Clark County filings.
//
// CLEARING IT MUST STILL BE POSSIBLE, and that is why this is not simply a
// nuqs default. With `withDefault('United States')`, clearing writes null, null
// reads back as the default, and the filter cannot be removed at all - a
// control that silently refuses. So the parameter carries three states:
//
//   absent   the default, United States
//   'any'    explicitly cleared, every country
//   a value  that country
//
// The sentinel is a real URL value, so a cleared Projects is still a link that
// survives being sent and reloaded.
const DEFAULT_COUNTRY = 'United States';
const GEO_ANY = 'any';

// THE ROUTE TO THE PROJECTS AN "ALL" CHIP DOES NOT REACH.
//
// "All venues" read 203 while "All stages" read 267. Sixty-four live projects
// carry no venue type - and, measured, not one of them holds a record naming one
// either, so this is a real absence rather than a labelling gap - and the venue
// row offered no way to any of them. Same 64 on the category axis.
//
// An "All" that is not all is a silent gap: nothing on the screen said a quarter
// of the register was missing from that axis, and nothing offered to show it.
//
// A URL value rather than a null, for the same reason the geography sentinel is:
// ?venue=__none__ is a link that survives being sent and reloaded, where "the
// parameter is absent" already means "every venue".
const NO_VALUE = '__none__';

function effectiveCountry(param: string | null): string | undefined {
  if (param === null) return DEFAULT_COUNTRY;
  if (param === GEO_ANY) return undefined;
  return param;
}

function statusFilter(view: ViewKey): Pick<ProjectQuery, 'status' | 'excludeStatus' | 'watch'> {
  if (view === 'trash') return { status: 'dismissed' };
  if (view === 'watchlist') return { excludeStatus: 'dismissed', watch: true };
  if (view === 'all') return { excludeStatus: 'dismissed' };
  return { status: view };
}

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

// Two optional id constraints, ANDed. `undefined` is "unconstrained" and an
// empty array is "constrained to nothing", and the difference is load-bearing on
// both axes - see the notes on idFilter below.
function intersectIds(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const inB = new Set(b);
  return a.filter((id) => inB.has(id));
}

// The score's own breakdown, on hover. Explainable at the point of use: a
// ranking nobody can interrogate is a ranking nobody can trust.
function significanceTitle(p: Project): string {
  if (p.significance == null) return 'not scored yet';
  const d = p.significance_detail ?? {};
  const parts = Object.entries(d)
    .filter(([, v]) => v && v.points !== 0)
    .sort((a, b) => b[1].points - a[1].points)
    .map(([k, v]) => `${k} ${v.points}/${v.of}  ${v.why}`);
  const pinned = (p.manual_overrides ?? {}) as Record<string, unknown>;
  const head = 'significance' in pinned ? `${p.significance} (pinned by you)` : `${p.significance} of 100`;
  return [head, ...parts].join('\n');
}

const COLUMNS: { key: string; label: string; sort?: string; numeric?: boolean; help?: string }[] = [
  { key: 'name', label: 'Project', sort: 'name' },
  { key: 'significance', label: 'Sig', sort: 'significance' },
  { key: 'applicant', label: 'Applicant', sort: 'primary_applicant' },
  { key: 'market', label: 'Market', sort: 'market' },
  { key: 'stage', label: 'Stage', sort: 'stage' },
  // "LAST ACTIVITY" NAMED A DATE IT DOES NOT SHOW, beside a control that filters
  // on a different one.
  //
  // projects.last_activity is the newest DOCUMENT date across the project's
  // records - a deadline, else a publication date, and explicitly never a
  // capture time (see bestDate in agents/scraper/cluster). The period control
  // beside it defaults to the Arrived axis, which filters on when WE captured a
  // record. So "this month" legitimately lists a project whose newest filing is
  // dated 2024, and the row reads as a bug in a screen that is working.
  //
  // Renamed rather than given a companion column, because the honest companion
  // is the project's NEWEST capture date and no such column exists: first_seen
  // is written once as the OLDEST capture among its records, so printing it here
  // would produce the same contradiction one column to the left. Adding the real
  // one is a migration, and it is reported rather than smuggled in.
  {
    key: 'last',
    label: 'Last filed',
    sort: 'last_activity',
    numeric: true,
    help:
      'The date on the newest document we hold for this project - a deadline, ' +
      'else a publication date. It is not when we captured it, which is what ' +
      'the Arrived period filters on.',
  },
];

export default function ProjectsPage() {
  const router = useRouter();

  // ---- URL state.
  const [view, setView] = useQueryState('view', parseAsString.withDefault('all'));
  const [stage, setStage] = useQueryState('stage', parseAsString);
  // VENUE AND CATEGORY ON THIS SCREEN. Records has had both since it was
  // built; the register, which is the working surface, could not answer
  // "New York, then Casino/Gaming" at all - so the question had to be asked on
  // the screen that cannot act on the answer.
  // The filter bar shows one row per group. Everything past the cap goes
  // behind this rather than down the page.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [venue, setVenue] = useQueryState('venue', parseAsString);
  const [category, setCategory] = useQueryState('category', parseAsString);
  const [countryParam, setCountryParam] = useQueryState('country', parseAsString);
  const [region, setRegion] = useQueryState('region', parseAsString);
  const [market, setMarket] = useQueryState('market', parseAsString);
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [selected, setSelected] = useQueryState('selected', parseAsString);
  const [saved, setSaved] = useQueryState('saved', parseAsString.withDefault('none'));
  // DEFAULT SORT IS SIGNIFICANCE. Last activity stays available, because "what
  // moved most recently" is a real question; it is simply not the first one.
  const [sortField, setSortField] = useQueryState(
    'sort',
    parseAsString.withDefault('significance')
  );
  const [sortDir, setSortDir] = useQueryState('dir', parseAsString.withDefault('desc'));
  const [bucket, setBucket] = useQueryState('bucket', parseAsString.withDefault('none'));

  // THE PERIOD. Default 'all', not a rolling window: this is the whole corpus.
  // Today is the screen that answers "recently"; opening Projects
  // on the last 30 days would hide 'projects' rather than filter them, and the
  // operator would have no way of knowing what was missing.
  const { period, setToken: setPeriod, axis, setAxis } = usePeriodState('all');
  const periodNow = useMemo(() => new Date(), []);

  // Both axes resolve through a child table, so each is a second query, and
  // each is only issued when its axis is selected and a period is set.
  const moved = useMovedProjectIds(period, axis === 'moved' && period.key !== 'all');
  const arrived = useArrivedProjectIds(period, axis === 'arrived' && period.key !== 'all');

  // MARKET, VENUE AND CATEGORY MATCH ON ANY RECORD, NOT ON THE PROJECT'S LABEL.
  // Each of those project columns is a mode over the project's records, so
  // filtering the column asked whether the project's most common value matched.
  // Measured: 21 projects hold a record naming a venue their own label does not,
  // 17 a category, 3 a market. Top Gun Las Vegas is filed as a Family
  // Entertainment Center and its records also name Casino/Gaming.
  // "No venue type" is the absence of a value, so it is not a record match at
  // all: it is a constraint on the project row, and the record resolution has to
  // be told to ignore that axis rather than search the records for the literal
  // string. Sent to the records as a value it would match nothing and the two
  // constraints would AND to the empty set.
  const venueValue = venue === NO_VALUE ? null : venue;
  const categoryValue = category === NO_VALUE ? null : category;
  const nullFields = useMemo(() => {
    const f: LooseField[] = [];
    if (venue === NO_VALUE) f.push('venue_type');
    if (category === NO_VALUE) f.push('development_category');
    return f;
  }, [venue, category]);

  const recordFacetFilter = {
    market,
    venue_type: venueValue,
    development_category: categoryValue,
  };
  const facetConstrained = !!(market || venueValue || categoryValue);
  const facetIds = useProjectIdsMatchingRecords(recordFacetFilter, facetConstrained);

  // THE SAME RESOLUTION WITHOUT THE MARKET AXIS, which is what the market facet
  // has to be counted against. A facet never filters itself, and on this axis
  // "itself" is a record match rather than a column.
  const marketFacetConstrained = !!(venueValue || categoryValue);
  const marketFacetIds = useProjectIdsMatchingRecords(
    { venue_type: venueValue, development_category: categoryValue },
    marketFacetConstrained
  );

  // A CONSTRAINED FACET THAT HAS NOT ANSWERED IS NOT AN ABSENT ONE, and every
  // query on this screen waits for it rather than running unfiltered.
  //
  // The period axes may contribute nothing while they resolve, because their
  // failure mode is showing MORE than the period holds and the register is
  // still the register. A facet's failure mode is the opposite and is worse: a
  // list narrowed to Anaheim that renders every project in California is a
  // control that shows the operator projects they excluded, and it is the same
  // set a client scope would have shipped. So the list, the counts and the
  // chips are held until the ids exist.
  //
  // isPending, not `!isSuccess`: an ERRORED facet query is not pending, it has
  // answered with nothing, and `?? []` below turns that into the empty set.
  // Holding on error instead would freeze the register on whatever was last on
  // screen with no number and no explanation.
  const facetsPending = facetConstrained && facetIds.isPending;
  const facetsReady = !facetsPending;
  const facetError =
    facetConstrained && facetIds.error
      ? `The venue, category or market filter could not be resolved (${
          (facetIds.error as Error).message
        }). Showing no projects rather than all of them.`
      : null;

  const [error, setError] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState(search);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLDivElement>(null);

  const viewKey = (VIEW_KEYS as readonly string[]).includes(view) ? (view as ViewKey) : 'all';

  // Debounced search: every keystroke is a URL write and a query, and neither
  // should happen per character.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchDraft !== search) {
        void setSearch(searchDraft || null);
        void setPage(1);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [searchDraft, search, setSearch, setPage]);

  const country = effectiveCountry(countryParam);

  // market is NOT here: it is a mode over the project's records and is resolved
  // against them, alongside venue and category. country and region_state stay on
  // the project row - region_state showed no disagreement anywhere in the
  // corpus, and country is coarser still.
  const geo = useMemo(
    () => ({
      country,
      region_state: region ?? undefined,
    }),
    [country, region]
  );

  // Clearing the country writes the sentinel rather than removing the parameter,
  // because removing it is what brings the default back.
  const setCountry = useCallback(
    (next: string | null) => setCountryParam(next ?? GEO_ANY),
    [setCountryParam]
  );

  // THE PERIOD, ON ONE OF TWO AXES. BOTH RESOLVE THROUGH A CHILD TABLE.
  //
  //   ARRIVED  a RECORD captured inside the period. When we captured something
  //            about it.
  //   MOVED    a project_events row inside the period. When something happened
  //            to it.
  //
  // ARRIVED USED TO READ projects.first_seen AND THAT WAS THE BUG. The column is
  // written once, on insert, as the oldest capture date among the project's
  // records, so the filter really asked "was this project's OLDEST record
  // captured in August". A project first seen in July that gained eleven August
  // filings answered no. Measured on the August 2026 capture, Nevada showed 1
  // project where 7 had gained a record, California 2 where 7 had, Tennessee 0
  // where 2 had - a month in which Clark County captured 81 records and Anaheim
  // 79 rendered as an almost empty register.
  //
  // Neither axis contributes ANYTHING until its query has answered. Passing
  // `ids: []` while one is in flight would empty the register for a moment and
  // read as "nothing arrived in August", which is a different statement from
  // "not known yet".
  const periodFilter: Pick<ProjectQuery, 'ids'> = useMemo(() => {
    if (period.key === 'all') return {};
    if (axis === 'moved') return moved.data ? { ids: moved.data.ids } : {};
    return arrived.data ? { ids: arrived.data.ids } : {};
  }, [period, axis, moved.data, arrived.data]);

  // BOTH ID SETS ARE ANDed. A project must satisfy the period and the facets,
  // and each resolves through the records into its own list, so the two are
  // intersected here.
  //
  // THE FACET AXIS FAILS CLOSED: `?? []`, never `undefined`. A constrained
  // facet contributes a list even when that list is empty, so a value no record
  // carries returns nothing rather than everything.
  //
  // This is the direction that matters. `market=Atlantis` used to return all
  // 254 projects in the United States - the parent set, in full, under a filter
  // naming a market that does not exist - and the same shape is what a client
  // scope narrowed to one market would have shipped. An unresolvable facet
  // matching nothing is a visibly empty register; an unresolvable facet matching
  // everything is a document covering projects the client was never sold.
  //
  // The period axis keeps the opposite rule and the comment above says why.
  const idFilter: Pick<ProjectQuery, 'ids'> = useMemo(() => {
    const periodIds = periodFilter.ids;
    const facets = facetConstrained ? (facetIds.data?.ids ?? []) : undefined;
    if (facets === undefined) return periodIds === undefined ? {} : { ids: periodIds };
    if (periodIds === undefined) return { ids: facets };
    const inFacets = new Set(facets);
    return { ids: periodIds.filter((id) => inFacets.has(id)) };
  }, [periodFilter, facetConstrained, facetIds.data]);

  const baseQuery: ProjectQuery = useMemo(
    () => ({
      module: LIVE_PIPELINE_STORAGE_KEY,
      ...statusFilter(viewKey),
      stage: stage ?? undefined,
      // venue_type, development_category and market are deliberately absent:
      // they are resolved against the records into idFilter above. The ABSENCE
      // of a venue or a category is the exception, because no record can carry
      // it - it is a constraint on the project row and goes to the server.
      ...(nullFields.length ? { nullFields } : {}),
      ...geo,
      ...idFilter,
      search: search.trim() || undefined,
    }),
    // idFilter, NOT periodFilter. THE MISSING ENTRY HERE WAS THE WHOLE BUG.
    //
    // Every query on this screen is keyed on the CONTENTS of this object
    // (projectKeys.list runs it through `stable()`), so an object this memo
    // declines to rebuild is a query key that does not change, which is a cache
    // hit, which is no refetch. Venue, category and market each reached the URL,
    // reached React state, reached their record query and reached idFilter - and
    // then stopped here, one line short of the query, because the array did not
    // name the value that had changed.
    //
    // Measured while it was wrong: market=Las Vegas under Nevada returned 71,
    // which is Nevada; L3 Anaheim returned 27, which is California; and
    // market=Atlantis returned the entire United States. The list was answering
    // the parent question every time.
    //
    // periodFilter is deliberately gone rather than kept alongside: it is now
    // read only THROUGH idFilter, which lists it in its own deps. Naming both
    // would leave two ways for this to drift apart again, and the one that was
    // named is the one that was not being used.
    // nullFields is named here for exactly the reason the note above gives: a
    // value that reaches the URL and stops one line short of the query key is a
    // control that does nothing, and this axis has been that once already.
    [viewKey, stage, geo, idFilter, search, nullFields]
  );

  // BUCKETING OWNS THE SORT WHILE IT IS ON.
  //
  // Buckets group the rows of the page that was fetched. Sorted by anything
  // other than the bucket's own date, a page produces interleaved headings -
  // July, then June, then July again - which is not a sequence, it is a mess
  // that looks like a data error. So turning bucketing on takes the sort with
  // it, and the column headers show that it has.
  const bucketMode = ((): BucketMode =>
    bucket === 'week' || bucket === 'month' ? bucket : 'none')();
  const bucketField = axis === 'moved' ? 'last_activity' : 'first_seen';
  const effectiveSort = bucketMode === 'none' ? sortField : bucketField;

  const listQuery: ProjectQuery = useMemo(
    () => ({
      ...baseQuery,
      sortField: effectiveSort,
      sortDir: sortDir === 'asc' ? 'asc' : 'desc',
      page,
      pageSize: DEFAULT_PROJECT_PAGE_SIZE,
    }),
    [baseQuery, effectiveSort, sortDir, page]
  );

  // EVERY QUERY BELOW IS HELD UNTIL THE FACET IDS EXIST. Without the gate each
  // one would fire twice on every chip click - once against the empty id list
  // while the records are being read, once against the real one - and the first
  // answer of that pair is a screen of zeroes. Eleven queries, two round trips
  // each, and a register that blinks empty on the way to the right answer.
  const list = useProjectPage(listQuery, facetsReady);
  const rows = list.data?.rows ?? [];
  const total = list.data?.total ?? 0;
  const pageCount = list.data?.pageCount ?? 1;

  // View counts share every filter EXCEPT the status axis, so a view's count is
  // exactly the rows it shows when clicked.
  const withoutStatus: ProjectQuery = {
    ...baseQuery,
    status: undefined,
    excludeStatus: undefined,
    watch: undefined,
  };
  const counts: Record<ViewKey, number | undefined> = {
    new: useProjectCount({ ...withoutStatus, status: 'new' }, facetsReady).data,
    watchlist: useProjectCount(
      { ...withoutStatus, excludeStatus: 'dismissed', watch: true },
      facetsReady
    ).data,
    client_ready: useProjectCount({ ...withoutStatus, status: 'client_ready' }, facetsReady).data,
    all: useProjectCount({ ...withoutStatus, excludeStatus: 'dismissed' }, facetsReady).data,
    trash: useProjectCount({ ...withoutStatus, status: 'dismissed' }, facetsReady).data,
  };

  // Stage facets exclude the stage filter, so a chip's count equals what
  // clicking it shows.
  const stageFacet = useProjectFacet({ ...baseQuery, stage: undefined }, 'stage', facetsReady);
  // Each facet excludes its OWN filter and honours every other, so a chip's
  // count is exactly what clicking it shows.
  //
  // THAT IS NO LONGER LITERALLY TRUE ON THESE THREE AXES AND IT IS DELIBERATE.
  // A chip counts projects by their venue_type COLUMN, which is a mode over the
  // project's records; the list now matches ANY record. So a chip reads at or
  // below the total clicking it produces - Hotel 29 against a list of 34 - and
  // the direction is guaranteed, since every project whose mode matches also
  // holds a record carrying that value. filters.audit asserts that direction and
  // prints the gap per value. Left as it stands pending Philip's decision on
  // which of the two numbers a chip should show; both are filtered, which is the
  // part that was broken.
  //
  // A FACET STRIPS ITS OWN NULL CONSTRAINT AS WELL AS ITS OWN VALUE. Without
  // this, selecting "No venue type" would leave nullFields on the base the venue
  // chips are counted against, and every venue chip would read 0 beside a list
  // of 64 - the facet counting the one thing it is supposed to exclude.
  const withoutAxis = useCallback(
    (field: LooseField): ProjectQuery => {
      const nulls = (baseQuery.nullFields ?? []).filter((f) => f !== field);
      return {
        ...baseQuery,
        [field]: undefined,
        ...(nulls.length ? { nullFields: nulls } : { nullFields: undefined }),
      };
    },
    [baseQuery]
  );
  const venueBase = useMemo(() => withoutAxis('venue_type'), [withoutAxis]);
  const categoryBase = useMemo(() => withoutAxis('development_category'), [withoutAxis]);
  const venueFacet = useProjectFacet(venueBase, 'venue_type', facetsReady);
  const categoryFacet = useProjectFacet(categoryBase, 'development_category', facetsReady);
  // The other side of each axis: the projects the chips above cannot reach.
  const venueNone = useProjectCount({ ...venueBase, nullFields: ['venue_type'] }, facetsReady);
  const categoryNone = useProjectCount(
    { ...categoryBase, nullFields: ['development_category'] },
    facetsReady
  );
  const geoBase: ProjectQuery = {
    ...baseQuery,
    country: undefined,
    region_state: undefined,
    market: undefined,
  };
  const countryFacet = useProjectFacet(geoBase, 'country', facetsReady);
  const regionFacet = useProjectFacet(
    { ...geoBase, country: geo.country },
    'region_state',
    facetsReady && !!geo.country
  );
  // COUNTED THROUGH THE RECORDS, because that is how the click resolves. Country
  // and region above stay on the project column, because that is how THEIR
  // clicks resolve - both go straight into the project query - so all three
  // nodes now count the thing pressing them returns.
  //
  // The base carries the period ids and the venue/category record facets, and
  // deliberately not the market: a facet never filters itself.
  const marketFacetBase: ProjectQuery = useMemo(
    () => ({
      ...geoBase,
      country: geo.country,
      region_state: geo.region_state,
      ...(periodFilter.ids === undefined && !marketFacetConstrained
        ? {}
        : {
            ids: intersectIds(
              periodFilter.ids,
              marketFacetConstrained ? (marketFacetIds.data?.ids ?? []) : undefined
            ),
          }),
    }),
    [geoBase, geo.country, geo.region_state, periodFilter, marketFacetConstrained, marketFacetIds.data]
  );
  const marketFacet = useMarketFacetFromRecords(
    marketFacetBase,
    facetsReady &&
      !!geo.country &&
      !!geo.region_state &&
      (!marketFacetConstrained || !marketFacetIds.isPending)
  );

  // ONE NUMBER PER NODE, AND IT IS THE ONE THE CLICK PRODUCES.
  //
  // The rail used to print a second, dimmed record count beside the project
  // count, in the same row, and the two answered different questions. The
  // project count respects every filter on this screen - view, stage, period,
  // search. The record count could not: stage is a project attribute and the
  // period axes are defined on projects and project_events, so it was the whole
  // unfiltered corpus for that geography and did not move when the view did.
  //
  // Two numbers side by side with nothing saying they are differently scoped is
  // not extra information, it is a reading the operator has to be told about
  // once and then remember forever. It is the same shape of confusion that made
  // the original period-filter symptom unreadable, and it is the reason this
  // rail could not be trusted at a glance.
  //
  // The record count existed to stop the tree hiding geography that had captures
  // but no clustered project. That job is now done properly rather than
  // annotated: the market facet resolves through the records (see
  // fetchMarketFacetFromRecords), so a market reachable only through a record
  // appears with the count the click returns rather than with a 0 and a
  // footnote. Nothing that can be opened is hidden, and no number on the rail
  // answers a question other than "what happens if I press this".
  // THE COVERED MARKETS, WITH THE STATE EACH IS ACTUALLY IN. Read from the same
  // place the Health screen reads, so the rail and Health cannot disagree about
  // whether Nashville is thin. The project count here is the market's own live
  // count rather than one filtered by this screen's view: it is a statement
  // about coverage, and a coverage figure that moved when the operator clicked
  // Watchlist would be answering a different question again.
  const coverage = useCoverage(LIVE_PIPELINE_STORAGE_KEY);
  const [pressOpen, setPressOpen] = useState(false);
  const coveredNodes = useMemo(
    () =>
      (coverage.data?.markets ?? []).map((m) => ({
        market: m.market,
        regionState: m.regionState,
        country: m.country,
        projects: m.liveProjects,
        state: m.coverage.state,
        why: `${m.coverage.state}: ${m.coverage.why}`,
      })),
    [coverage.data]
  );

  const geoLevels = useCallback(
    (counts: { value: string; count: number }[] | undefined) =>
      [...(counts ?? [])]
        .map((c) => ({ value: c.value, count: c.count }))
        .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
    []
  );

  const { watch, status: statusMutation, busy } = useProjectMutations({ onError: setError });

  // ---- Navigation within the list.
  const selectedIndex = rows.findIndex((r) => r.id === selected);

  const move = useCallback(
    (delta: number) => {
      if (rows.length === 0) return;
      const next = selectedIndex < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, selectedIndex + delta));
      void setSelected(rows[next].id);
      // Keep the moving row in view without yanking the page around.
      listRef.current
        ?.querySelector(`[data-row-id="${rows[next].id}"]`)
        ?.scrollIntoView({ block: 'nearest' });
    },
    [rows, selectedIndex, setSelected]
  );

  const applyStage = useCallback(
    (key: string | null) => {
      void setStage(key);
      void setPage(1);
      void setSaved('none');
    },
    [setStage, setPage, setSaved]
  );

  const applySaved = useCallback(
    (key: string) => {
      void setSaved(key);
      void setPage(1);
      if (key === 'anaheim') {
        void setView('all');
        void setStage(null);
        void setCountry('United States');
        void setRegion('California');
        void setMarket('Anaheim');
      } else if (key === 'approved') {
        void setView('all');
        void setStage('approved');
        void setCountry(null);
        void setRegion(null);
        void setMarket(null);
      } else if (key === 'hearing') {
        void setView('all');
        void setStage('hearing scheduled');
        void setCountry(null);
        void setRegion(null);
        void setMarket(null);
      } else {
        // None means "no saved view", not "no geography". It removes the
        // parameter entirely, which is what puts the United States default back.
        void setView('all');
        void setStage(null);
        void setCountryParam(null);
        void setRegion(null);
        void setMarket(null);
      }
    },
    [setSaved, setPage, setView, setStage, setCountry, setCountryParam, setRegion, setMarket]
  );

  // Dismiss is a status write, never a delete: Trash is a view, so restoring is
  // just another status write. Declared above the keyboard handler because that
  // handler calls it, and a const used before its declaration is a TDZ error.
  const dismiss = useCallback(
    (p: Project) => {
      setError(null);
      statusMutation.mutate({ id: p.id, status: 'dismissed' });
    },
    [statusMutation]
  );

  // Trash is a view, so restoring is the same write with a different value.
  const restore = useCallback(
    (p: Project) => {
      setError(null);
      statusMutation.mutate({ id: p.id, status: 'new' });
    },
    [statusMutation]
  );

  // ---- Keyboard triage.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Never steal a key from a field the operator is typing in.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const current = selectedIndex >= 0 ? rows[selectedIndex] : null;
      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          move(1);
          break;
        case 'k':
          e.preventDefault();
          move(-1);
          break;
        case 'enter':
          if (current) {
            e.preventDefault();
            // Enter is "go and read this properly", which is the full page.
            // Selecting alone is what J and K already do.
            router.push(`/project/${current.id}`);
          }
          break;
        case 'e':
          if (current) {
            e.preventDefault();
            // Dismiss moves the row out of the working set, so selection has to
            // move with it or the pane would show a project no longer listed.
            setChecked(new Set());
            void setSelected(rows[Math.min(rows.length - 1, selectedIndex + 1)]?.id ?? null);
            dismiss(current);
          }
          break;
        case 'w':
          if (current) {
            e.preventDefault();
            watch.mutate({ id: current.id, watch: !current.watch });
          }
          break;
        case 'escape':
          if (selected) {
            e.preventDefault();
            void setSelected(null);
          }
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, selectedIndex, selected, move, router, watch]);

  const toggleCheck = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortBy = (field: string) => {
    if (sortField === field) void setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    else {
      void setSortField(field);
      void setSortDir('asc');
    }
    // Clicking a column header is an instruction to sort by that column, and
    // bucketing owns the sort. Leaving both on would put the arrow on one column
    // while the rows obeyed another - a header lying about what it had just done.
    void setBucket(null);
    void setPage(1);
  };

  const stageChips = useMemo(() => {
    const counts = new Map((stageFacet.data?.counts ?? []).map((f) => [f.value, f.count] as const));
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    return [
      { value: null as string | null, label: 'All stages', count: total },
      ...PROJECT_STAGES.filter((s) => (counts.get(s) ?? 0) > 0 || stage === s).map((s) => ({
        value: s as string | null,
        label: s,
        count: counts.get(s) ?? 0,
      })),
    ];
  }, [stageFacet.data, stage]);

  // THE "ALL" CHIP COUNTS THE WHOLE AXIS, INCLUDING THE PROJECTS THAT HAVE NO
  // VALUE ON IT, and there is a chip that opens them. Before this the All chip
  // was the sum of the named values, which is why it read 203 next to a register
  // of 267 with nothing to click for the difference.
  //
  // The "none" chip is placed last rather than by count: it is the edge of the
  // axis, not a value competing with the others for the top of the row.
  const facetChips = (
    counts: { value: string; count: number }[] | undefined,
    active: string | null,
    allLabel: string,
    noneCount: number | undefined,
    noneLabel: string
  ): { value: string | null; label: string; count: number }[] => {
    const m = new Map((counts ?? []).map((f) => [f.value, f.count] as const));
    const named = [...m.values()].reduce((a, b) => a + b, 0);
    const none = noneCount ?? 0;
    return [
      { value: null as string | null, label: allLabel, count: named + none },
      ...[...m.entries()]
        .filter(([v, n]) => n > 0 || active === v)
        .sort((a, b) => b[1] - a[1])
        .map(([v, n]) => ({ value: v as string | null, label: v, count: n })),
      ...(none > 0 || active === NO_VALUE
        ? [{ value: NO_VALUE as string | null, label: noneLabel, count: none }]
        : []),
    ];
  };
  // A COLLAPSED GROUP STILL SHOWS WHAT IS SELECTED. Slicing the first N would
  // hide an active chip whenever it sorted low, so the control would show no
  // filter while a filter was applied. The active chip is always kept.
  const CHIP_CAP = 5;
  const visible = (chips: { value: string | null; label: string; count: number }[]) => {
    if (filtersOpen || chips.length <= CHIP_CAP + 1) return chips;
    const head = chips.slice(0, CHIP_CAP);
    const active = chips.find((c) => c.value !== null && !head.includes(c) && isActive(c));
    return active ? [...head, active] : head;
  };
  const more = (chips: { value: string | null; label: string; count: number }[]) => {
    if (filtersOpen) {
      return (
        <button type="button" className={styles.chipMore} onClick={() => setFiltersOpen(false)}>
          less
        </button>
      );
    }
    if (chips.length <= CHIP_CAP + 1) return null;
    return (
      <button
        type="button"
        className={styles.chipMore}
        onClick={() => setFiltersOpen(true)}
      >
        +{chips.length - CHIP_CAP} more
      </button>
    );
  };
  const isActive = (c: { value: string | null }) =>
    c.value !== null && (c.value === stage || c.value === venue || c.value === category);

  const venueChips = useMemo(
    () => facetChips(venueFacet.data?.counts, venue, 'All venues', venueNone.data, 'No venue type'),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [venueFacet.data, venue, venueNone.data]
  );
  const categoryChips = useMemo(
    () =>
      facetChips(
        categoryFacet.data?.counts,
        category,
        'All categories',
        categoryNone.data,
        'No category'
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoryFacet.data, category, categoryNone.data]
  );

  return (
    <div className={styles.screen}>
      <ProjectsRail
        views={VIEWS.map((v) => ({ ...v, count: counts[v.key] }))}
        covered={coveredNodes}
        pressCount={coverage.data?.press.length}
        pressOpen={pressOpen}
        onTogglePress={() => setPressOpen((o) => !o)}
        view={viewKey}
        onView={(k) => {
          void setView(k);
          void setPage(1);
          void setSelected(null);
        }}
        countries={geoLevels(countryFacet.data?.counts)}
        regions={geoLevels(regionFacet.data?.counts)}
        markets={geoLevels(marketFacet.data?.counts)}
        geo={geo}
        onGeo={(next) => {
          void setCountry(next.country ?? null);
          void setRegion(next.region_state ?? null);
          void setMarket(next.market ?? null);
          void setPage(1);
        }}
        savedViews={[...SAVED]}
        activeSaved={saved}
        onSaved={applySaved}
      />

      <div className={`${styles.listPane} ${viewKey === 'trash' ? styles.trashView : ''}`}>
        <div className={styles.listHead}>
          <div className={styles.filterBar}>
          <div className={`${styles.chipRow} ${filtersOpen ? styles.chipRowOpen : ''}`} data-testid="register-stage-chips">
            <span className={styles.chipRowLabel}>stage</span>
            {visible(stageChips).map((c) => (
              <button
                key={c.label}
                type="button"
                data-stage={c.value ?? 'all'}
                className={`${styles.chip} ${
                  stage === c.value ? (c.value === null ? styles.chipAllActive : styles.chipActive) : ''
                }`}
                onClick={() => applyStage(c.value)}
              >
                {c.label}
                <span className={`${styles.chipCount} mono`}>{c.count}</span>
              </button>
            ))}
            {more(stageChips)}
          </div>
          <div className={`${styles.chipRow} ${filtersOpen ? styles.chipRowOpen : ''}`} data-testid="register-venue-chips">
            <span className={styles.chipRowLabel}>venue</span>
            {visible(venueChips).map((c) => (
              <button
                key={`v-${c.label}`}
                type="button"
                data-venue={c.value ?? 'all'}
                className={`${styles.chip} ${
                  venue === c.value ? (c.value === null ? styles.chipAllActive : styles.chipActive) : ''
                }`}
                onClick={() => {
                  void setVenue(c.value);
                  void setPage(1);
                }}
              >
                {c.label}
                <span className={`${styles.chipCount} mono`}>{c.count}</span>
              </button>
            ))}
            {more(venueChips)}
          </div>
          <div className={`${styles.chipRow} ${filtersOpen ? styles.chipRowOpen : ''}`} data-testid="register-category-chips">
            <span className={styles.chipRowLabel}>category</span>
            {visible(categoryChips).map((c) => (
              <button
                key={`c-${c.label}`}
                type="button"
                data-category={c.value ?? 'all'}
                className={`${styles.chip} ${
                  category === c.value ? (c.value === null ? styles.chipAllActive : styles.chipActive) : ''
                }`}
                onClick={() => {
                  void setCategory(c.value);
                  void setPage(1);
                }}
              >
                {c.label}
                <span className={`${styles.chipCount} mono`}>{c.count}</span>
              </button>
            ))}
            {more(categoryChips)}
          </div>
          </div>
          <input
            className={styles.search}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Project, applicant or representative"
            aria-label="Search projects"
          />
        </div>

        <div className={styles.periodBar}>
          <PeriodSelector
            period={period}
            now={periodNow}
            onChange={(t) => {
              setPeriod(t);
              void setPage(1);
            }}
          />

          {/* THE AXIS. Which date the period is applied to. Two different
              questions - what arrived, and what moved - that a single "period"
              control would silently conflate. */}
          <div className={styles.axisGroup}>
            {PERIOD_AXES.map((a) => (
              <button
                key={a.key}
                type="button"
                title={a.help}
                data-axis={a.key}
                className={`${styles.chip} ${axis === a.key ? styles.chipActive : ''}`}
                onClick={() => {
                  setAxis(a.key);
                  void setPage(1);
                }}
              >
                {a.label}
              </button>
            ))}
            {BUCKETS.map((b) => (
              <button
                key={b.key}
                type="button"
                data-bucket={b.key}
                className={`${styles.chip} ${bucketMode === b.key ? styles.chipActive : ''}`}
                onClick={() => {
                  void setBucket(b.key === 'none' ? null : b.key);
                  void setPage(1);
                }}
              >
                {b.label}
              </button>
            ))}
          </div>

          {bucketMode !== 'none' && (
            <span className={`${styles.dim} mono`} data-testid="bucket-sort-note">
              ordered by {bucketField === 'first_seen' ? 'first seen' : 'last activity'}
            </span>
          )}

          {axis === 'moved' && period.key !== 'all' && (
            <span className={`${styles.dim} mono`} data-testid="axis-resolution">
              {moved.isPending
                ? 'resolving events...'
                : `${moved.data?.events ?? 0} events, ${moved.data?.ids.length ?? 0} projects`}
              {moved.data?.capped ? ' (CAPPED)' : ''}
            </span>
          )}

          {/* The same statement for Arrived. It exists for the same reason the
              moved one does: the axis resolves through a child table, so the
              register is showing the result of a query it does not otherwise
              display, and "6 projects" with no cause behind it is what let the
              old behaviour go unnoticed. */}
          {axis === 'arrived' && period.key !== 'all' && (
            <span className={`${styles.dim} mono`} data-testid="axis-resolution">
              {arrived.isPending
                ? 'resolving records...'
                : `${arrived.data?.records ?? 0} records, ${arrived.data?.ids.length ?? 0} projects`}
              {arrived.data?.capped ? ' (CAPPED)' : ''}
            </span>
          )}
        </div>

        {/* A FACET THAT COULD NOT BE RESOLVED SAYS SO. Failing closed is only
            honest if the empty register is explained: without this the operator
            sees "No projects" under a venue chip and reads it as an answer about
            the corpus rather than about a query that never came back. Not
            dismissable, because it describes a live condition rather than an
            event. */}
        {(error || facetError) && (
          <div className={styles.error} role="alert" data-testid="register-error">
            {error ?? facetError}
            {error && (
              <button type="button" onClick={() => setError(null)}>
                Dismiss
              </button>
            )}
          </div>
        )}

        {checked.size > 0 && (
          <div className={styles.bulk}>
            <span className="mono">{checked.size} selected</span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                rows.filter((r) => checked.has(r.id)).forEach((r) => watch.mutate({ id: r.id, watch: true }));
                setChecked(new Set());
              }}
            >
              Watch
            </button>
            {/* In Trash the only useful bulk action is the way back out.
                Nothing is ever deleted, so this is the same status write. */}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                rows
                  .filter((r) => checked.has(r.id))
                  .forEach(viewKey === 'trash' ? restore : dismiss);
                setChecked(new Set());
              }}
            >
              {viewKey === 'trash' ? 'Restore' : 'Dismiss'}
            </button>
            <button type="button" onClick={() => setChecked(new Set())}>
              Clear
            </button>
          </div>
        )}

        <div className={styles.table} ref={listRef}>
          <div className={styles.headRow} role="row" data-testid="register-head-row">
            <span />
            {COLUMNS.map((c) => (
              <button
                key={c.key}
                type="button"
                title={c.help}
                data-column={c.key}
                className={`${styles.colHead} ${c.numeric ? styles.num : ''} ${
                  effectiveSort === c.sort ? styles.colHeadActive : ''
                }`}
                onClick={() => c.sort && sortBy(c.sort)}
              >
                {c.label}
                {effectiveSort === c.sort && (
                  <span className={`${styles.sortMark} mono`} aria-hidden="true">
                    {sortDir === 'asc' ? '↑' : '↓'}
                  </span>
                )}
              </button>
            ))}
          </div>

          {list.isPending ? (
            <p className={styles.dim}>Loading...</p>
          ) : rows.length === 0 ? (
            <p className={styles.dim}>
              No projects match this view. {view !== 'all' && 'Try All, or clear the geography filter.'}
            </p>
          ) : (
            rows.map((r, i) => (
              <Fragment key={r.id}>
                {bucketMode !== 'none' &&
                  bucketOf(bucketField === 'first_seen' ? r.first_seen : r.last_activity, bucketMode) !==
                    bucketOf(
                      i === 0
                        ? null
                        : bucketField === 'first_seen'
                          ? rows[i - 1].first_seen
                          : rows[i - 1].last_activity,
                      bucketMode
                    ) && (
                    <div className={styles.bucketHead} role="row">
                      {bucketOf(
                        bucketField === 'first_seen' ? r.first_seen : r.last_activity,
                        bucketMode
                      ) || 'Undated'}
                    </div>
                  )}
              <div
                data-row-id={r.id}
                role="row"
                tabIndex={-1}
                data-testid="register-row"
                className={`${styles.row} ${selected === r.id ? styles.rowSelected : ''}`}
                onClick={() => void setSelected(r.id)}
              >
                <span onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    className={styles.check}
                    checked={checked.has(r.id)}
                    onChange={() => toggleCheck(r.id)}
                    aria-label={`Select ${r.name}`}
                  />
                </span>
                <span
                  className={styles.cellName}
                  title={r.summary ? `${r.name}\n${r.summary}` : r.name}
                >
                  <span className={styles.cellNameLine} data-row-name>
                    {r.watch && (
                      <span className={styles.watchDot} title="Watched" aria-label="Watched" />
                    )}
                    {r.name}
                    {/* A NAME WE DID NOT READ, MARKED WHERE THE LIST IS SCANNED.
                        isProvisionalName is one predicate in lib/taxonomy and it
                        is what a client document uses to REFUSE a project: 39 of
                        267 are excluded from every report on this basis alone.
                        The pane has said so since it was built, but the pane is
                        opened one project at a time and the exclusion is
                        invisible everywhere else, so the operator had no way to
                        see the shape of it - a whole market can be provisional
                        and the register would look complete. It is a mark, not a
                        row of prose: the pane carries the sentence and the way
                        to fix it. */}
                    {isProvisionalName(r.name_source) && (
                      <span
                        className={styles.provisionalTag}
                        data-testid="name-provisional-row"
                        title={
                          'Name taken from the agenda line rather than read from a published ' +
                          'name. Projects named this way are held out of client documents. ' +
                          'Open the project to rename it by hand.'
                        }
                      >
                        unnamed
                      </span>
                    )}
                  </span>
                  {/* The name answers "which one". This answers "what is it".
                      Rendered even when null so every row is the same height. */}
                  <span className={styles.cellSummary} data-row-summary>
                    {r.summary ?? ''}
                  </span>
                </span>
                <span className={`${styles.cell} ${styles.num} mono`} title={significanceTitle(r)}>
                  {r.significance == null ? '--' : Math.round(r.significance)}
                </span>
                <span className={styles.cell}>{r.primary_applicant ?? '--'}</span>
                {/* THE MARKET, AND WHETHER WE ARE STILL READING IT.
                    A frozen market is the one thing about a row that cannot be
                    inferred from anything else on it: the name, the stage and
                    the applicant all look entirely healthy on a project whose
                    source stopped publishing in 2018. Marked on the row rather
                    than only in the pane, because the register is scanned far
                    more often than it is opened, and this is the fact that
                    decides whether a row can be sold as coverage. */}
                <span className={styles.cell}>
                  {r.market ?? r.region_state ?? '--'}
                  {(() => {
                    const feed = deadFeedForMarket(r.market, r.region_state);
                    return feed ? (
                      <span
                        className={styles.frozenTag}
                        data-testid="market-frozen"
                        title={
                          `Our source for ${feed.market} has published nothing since ` +
                          `${feed.frozenSince}. Projects here are held out of client documents.`
                        }
                      >
                        frozen {feed.frozenSince.slice(0, 4)}
                      </span>
                    ) : null;
                  })()}
                </span>
                <span className={styles.cell}>{r.stage ?? '--'}</span>
                <span className={`${styles.cell} ${styles.num} mono`}>{ymd(r.last_activity)}</span>
                {viewKey === 'trash' && (
                  <button
                    type="button"
                    className={styles.rowAction}
                    disabled={busy}
                    onClick={(e) => {
                      e.stopPropagation();
                      restore(r);
                    }}
                  >
                    Restore
                  </button>
                )}
              </div>
              </Fragment>
            ))
          )}
        </div>

        <div className={styles.pager}>
          {/* data-total carries the server's exact count as a value rather than
              as prose. The filtering audit reads it, and parsing "1-50 of 184 |
              648 ms rows" out of a sentence is the kind of thing that silently
              starts matching the wrong element.

              THE ATTRIBUTE IS ABSENT UNTIL THE NUMBER IS FINAL, and the gate is
              three conditions rather than one. isPending alone was false while
              placeholderData held the PREVIOUS filter's page on screen, so an
              audit that clicked a chip and read the attribute measured the
              filter it had just navigated away from and reported it as the new
              one. A measuring instrument that returns the old value on demand
              cannot catch a control that does nothing - the two look identical.
              Settled, or no number at all. */}
          <span
            className={`${styles.dim} mono`}
            data-testid="pager-total"
            {...(facetsPending || list.isPending || list.isPlaceholderData
              ? {}
              : { 'data-total': total })}
          >
            {total === 0
              ? 'No projects'
              : `${(page - 1) * DEFAULT_PROJECT_PAGE_SIZE + 1}-${Math.min(
                  page * DEFAULT_PROJECT_PAGE_SIZE,
                  total
                )} of ${total}`}
            {list.data ? ` | ${list.data.rowsMs} ms rows, ${list.data.countMs} ms count` : ''}
          </span>
          <div className={styles.pagerBtns}>
            <button type="button" disabled={page <= 1} onClick={() => void setPage(page - 1)}>
              Previous
            </button>
            <span className="mono">
              {page} / {pageCount}
            </span>
            <button
              type="button"
              disabled={page >= pageCount}
              onClick={() => void setPage(page + 1)}
            >
              Next
            </button>
          </div>
        </div>

        <p className={styles.keys}>
          <span className="mono">J</span> / <span className="mono">K</span> move
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">Enter</span> open
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">E</span> dismiss
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">W</span> watch
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">Esc</span> close
        </p>
      </div>

      {selected && (
        <ProjectsDetail id={selected} onClose={() => void setSelected(null)} onError={setError} />
      )}
    </div>
  );
}
