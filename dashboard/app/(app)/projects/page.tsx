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
import { useClientView, useMembershipMutation } from '@/lib/use-client-view';
import { useClients } from '@/lib/use-clients';
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

// THE DEFAULT IS THE CORPUS, NOT AN EQUALITY ON ONE COUNTRY.
//
// `country = 'United States'` drops every project whose country did not
// resolve, and an unresolved country is not a foreign one - lib/corpus-scope
// says so in full and every reader in the agent runtime already obeys it. The
// dashboard obeyed it nowhere, and this screen is the one projects are
// confirmed on, so five US projects were absent from the list used to decide
// what a client is shown: Austin, Sacramento and a California street address
// among them.
//
// TRUE ONLY IN THE DEFAULT STATE. An explicit pick is a question about that
// country and stays an equality; 'any' is every country and filters nothing.
// The three URL states are unchanged, only what the absent one MEANS.
function countryIsCorpusScope(param: string | null): boolean {
  return param === null;
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

// ---- THE SIGNIFICANCE SCALE, MEASURED RATHER THAN ASSUMED -------------------
//
// 91, 88 and 80 sit at the top of the register and they are the extreme tail.
// Measured 2026-08-16 over the 267 live projects: min 0, p25 16.4, median 26.4,
// p75 38.9, p90 48.1, max 90.5. Twenty-one projects score 50 or more and two
// score above 80, so four fifths of the register lives between 10 and 50 - and
// a person reading "38" has no way of knowing that is the top quarter.
//
// WHY NOT CUT AT THE ROUND QUARTERS OF 100. Because 75/50/25 would put 99% of
// the register in one band and say nothing at all. The scale in use is not the
// scale on the tin, and banding it as though it were is how a legend comes to
// describe a distribution that does not exist.
//
// WHY THE INK LADDER AND NOT A BAR, A COLOUR OR A SECOND NUMBER. A bar is a
// chart in a table cell; a colour would spend the accent on something that
// appears on every row; a second number is more to read, not less. The ladder
// costs no width and no new token: sorted by significance, which is the default,
// the column runs from full ink at the top to muted at the bottom, so the shape
// of the ranking is visible without anyone learning what 38 means. Sorted by
// anything else, a dark number in a grey column is a row worth stopping on.
//
// THE CUTS ARE DATA AND WILL DRIFT. They are stated here with the date and the
// distribution they were taken from, so a future reader can tell a deliberate
// threshold from a stale one.
const SIGNIFICANCE_BANDS: { min: number; key: string; label: string }[] = [
  { min: 50, key: 'top', label: 'top tenth of the register' },
  { min: 40, key: 'high', label: 'top quarter' },
  { min: 16, key: 'mid', label: 'middle half' },
  { min: 0, key: 'low', label: 'bottom quarter' },
];

function significanceBand(v: number | null | undefined): { key: string; label: string } {
  if (v == null) return { key: 'none', label: 'not scored yet' };
  return SIGNIFICANCE_BANDS.find((b) => v >= b.min) ?? { key: 'low', label: 'bottom quarter' };
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
  // The band before the breakdown: the first question a score raises is "is
  // that a big number", and it is the one the breakdown does not answer.
  return [head, significanceBand(p.significance).label, ...parts].join('\n');
}

const COLUMNS: { key: string; label: string; sort?: string; numeric?: boolean; help?: string }[] = [
  { key: 'name', label: 'Project', sort: 'name' },
  {
    key: 'significance',
    label: 'Sig',
    sort: 'significance',
    numeric: true,
    help:
      'Nine weighted signals, out of 100 - but the register does not use the ' +
      'whole scale. Measured 2026-08-16 over 267 live projects: median 26, ' +
      'top quarter above 39, top tenth above 48, highest 90. The number is set ' +
      'in full ink in the top tenth, ink in the top quarter, secondary in the ' +
      'middle half and muted in the bottom quarter, so the ranking can be read ' +
      'without knowing the scale. Hover a score for its breakdown.',
  },
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

/**
 * WHAT AN EMPTY REGISTER MEANS WHEN NOTHING IS FILTERING IT.
 *
 * An empty screen is often the correct answer here, and the useful version of
 * it names the state and the action that changes it. "No projects match this
 * view" was neither: it described the query rather than the situation, and its
 * one piece of advice - "try All, or clear the geography filter" - was given
 * whether or not a geography filter was applied.
 */
function emptyViewSentence(view: ViewKey): string {
  switch (view) {
    case 'new':
      return 'Nothing is untriaged. Every project has been watched, dismissed or marked client ready.';
    case 'watchlist':
      return 'Nothing is being watched. Press W on a row, or use Watch in the detail pane; the watchlist is a flag you set, not a stage a project reaches.';
    case 'client_ready':
      return 'Nothing has been marked client ready. Open a project and set its status; this is the list a client document is built from, so it stays empty until somebody judges a project fit to send.';
    case 'trash':
      return 'Nothing has been dismissed. Press E on a row to dismiss it - it lands here, and nothing is ever deleted.';
    default:
      return 'The register holds no project at all. That is a capture problem rather than a filter one: check Health for a source that has stopped, and Inbox for records attached to nothing.';
  }
}

/**
 * THE ONE MARK A ROW CAN CARRY THAT SAYS IT CANNOT BE SOLD.
 *
 * Two facts hold a project out of every client document: the market's source has
 * stopped publishing (lib/dead-feeds), or the name was assembled from an agenda
 * line rather than read (isProvisionalName). They were marked separately, in two
 * different cells, in the same hairline box - so a row carrying both showed two
 * boxes, and a row carrying either showed a warning whose relationship to the
 * other was left to the reader.
 *
 * ONE SLOT, ORDERED. The frozen market comes first because it outranks an
 * unread name: a name can be fixed by typing one in, and a dead feed cannot be
 * fixed at all. That is the precedence the detail pane already states in prose,
 * so the row now agrees with it.
 *
 * Both reasons carry a `data-` attribute rather than only text, because two
 * audits assert that these exclusions are visible SOMEWHERE - 39 of 267
 * projects are refused by a client document on the name alone - and a selector
 * that reads rendered words breaks the moment the wording improves.
 */
function heldMark(p: Project) {
  const feed = deadFeedForMarket(p.market, p.region_state);
  const unread = isProvisionalName(p.name_source);
  if (!feed && !unread) return null;

  const parts: string[] = [];
  const why: string[] = [];
  if (feed) {
    parts.push(`frozen ${feed.frozenSince.slice(0, 4)}`);
    why.push(
      `Our source for ${feed.market} has published nothing since ${feed.frozenSince}.`
    );
  }
  if (unread) {
    parts.push('unnamed');
    why.push(
      'The name was taken from the agenda line rather than read from a published ' +
        'name. Open the project to rename it by hand.'
    );
  }
  return (
    <span
      className={styles.heldTag}
      data-testid="row-held"
      data-held-frozen={feed ? feed.frozenSince : undefined}
      data-held-unnamed={unread ? 'true' : undefined}
      title={`Held out of client documents. ${why.join(' ')}`}
    >
      {parts.join(' · ')}
    </span>
  );
}

/**
 * ONE AXIS INSIDE THE FILTER PANEL, WITH EVERY VALUE ON IT.
 *
 * No cap and no "+N more". The cap existed because these were rows on the
 * screen and a row cannot grow; inside a panel it can, so the twenty venue
 * values are twenty chips rather than five and a promise.
 *
 * The data attribute is passed rather than switched on, because three audits
 * read these chips by `[data-venue]` / `[data-stage]` / `[data-category]` and a
 * component that renamed them would break the instruments silently.
 */
function FilterGroup({
  label,
  testId,
  attr,
  chips,
  active,
  onPick,
}: {
  label: string;
  testId: string;
  attr: 'data-stage' | 'data-venue' | 'data-category';
  chips: { value: string | null; label: string; count: number }[];
  active: string | null;
  onPick: (value: string | null) => void;
}) {
  return (
    <div className={styles.panelGroup} data-testid={testId}>
      <span className={styles.panelLabel}>{label}</span>
      <div className={styles.panelChips}>
        {chips.map((c) => {
          const mark: Record<string, string> = { [attr]: c.value ?? 'all' };
          return (
            <button
              key={`${attr}-${c.label}`}
              type="button"
              {...mark}
              className={`${styles.chip} ${
                active === c.value
                  ? c.value === null
                    ? styles.chipAllActive
                    : styles.chipActive
                  : ''
              }`}
              onClick={() => onPick(c.value)}
            >
              {c.label}
              <span className={`${styles.chipCount} mono`}>{c.count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ProjectsPage() {
  const router = useRouter();

  // ---- URL state.
  const [view, setView] = useQueryState('view', parseAsString.withDefault('all'));
  const [stage, setStage] = useQueryState('stage', parseAsString);
  // VENUE AND CATEGORY ON THIS SCREEN. Records has had both since it was
  // built; the register, which is the working surface, could not answer
  // "New York, then Casino/Gaming" at all - so the question had to be asked on
  // the screen that cannot act on the answer.
  //
  // ALL THREE AXES ARE BEHIND ONE DISCLOSURE. They were three labelled rows of
  // chips, each capped at five values with the rest behind a "+16 more" - which
  // is three controls' worth of screen spent saying "there are more filters"
  // and one axis, venue, whose twenty values were mostly unreachable. Inside
  // the panel every value on every axis is present and wrapped, so the control
  // that promises the other fifteen is now the control that shows them.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // The period, the axis it applies to and the bucketing, behind their own.
  const [periodOpen, setPeriodOpen] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  // Declared with the state rather than beside its first use, because the
  // keyboard effect below lists it as a dependency and a const is in its
  // temporal dead zone until the line that declares it has run.
  const closePanels = useCallback(() => {
    setFiltersOpen(false);
    setPeriodOpen(false);
  }, []);
  const [venue, setVenue] = useQueryState('venue', parseAsString);
  const [category, setCategory] = useQueryState('category', parseAsString);
  const [countryParam, setCountryParam] = useQueryState('country', parseAsString);
  const [region, setRegion] = useQueryState('region', parseAsString);
  const [market, setMarket] = useQueryState('market', parseAsString);
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [selected, setSelected] = useQueryState('selected', parseAsString);
  // THE ROW CLICK'S URL WRITE, HELD SO A NAVIGATION CAN WAIT FOR IT.
  //
  // nuqs updates React state at once and the query string a moment later, and
  // the deferred write targets the url as it was when the write was queued. So
  // clicking a row and pressing Enter before that write flushed pushed
  // /project/<id> correctly and was then thrown straight back to
  // /projects?selected=<id> by the click's own late write. Enter awaits this
  // before pushing, so the clobbering write lands FIRST and the push wins.
  //
  // A person cannot click and type in the same millisecond, so this cost
  // nothing a client would see - but it left e2e/referral.audit.ts red, and a
  // failing test explained by a comment is an ungated gate rather than a known
  // issue.
  const pendingSelection = useRef<Promise<unknown> | null>(null);
  const [saved, setSaved] = useQueryState('saved', parseAsString.withDefault('none'));
  // A CLIENT IS A SAVED VIEW YOU OPEN. ?client=<id> narrows this list to that
  // client's stored scope - same table, same columns, same sort, same keyboard -
  // and turns on the column saying why each project is in it.
  const [clientId, setClientId] = useQueryState('client', parseAsString);
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
  // THE CLIENT SCOPE IS A THIRD ID CONSTRAINT, ANDed with the other two.
  //
  // It fails closed the way the facets do and for the same reason, which matters
  // more here than anywhere else on the screen: a client view that quietly
  // widened to the whole register is the exact set a client document would then
  // have been built from. `?? []` while the scope is resolving, never undefined.
  const client = useClientView(clientId);
  const clientConstrained = !!clientId;

  // The client scope joins the same gate: a list rendered before the scope has
  // resolved is a list of projects the client is not covered for.
  const facetsPending =
    (facetConstrained && facetIds.isPending) || (clientConstrained && client.isPending);
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
  const corpusScoped = countryIsCorpusScope(countryParam);

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
    const scoped = clientConstrained ? (client.data?.ids ?? []) : undefined;
    const ids = intersectIds(intersectIds(periodIds, facets), scoped);
    return ids === undefined ? {} : { ids };
  }, [periodFilter, facetConstrained, facetIds.data, clientConstrained, client.data]);

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
      // AFTER `geo`, because it OVERRIDES the equality geo carries. `country`
      // stays on the query for the rail's active node and the filter chip; this
      // flag is what the server actually filters on in the default state. See
      // countryIsCorpusScope and ProjectQuery.countryInScope.
      countryInScope: corpusScoped || undefined,
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
    // corpusScoped IS NAMED HERE, and for the reason the note above gives. It
    // flips while `country` does not move: pressing United States on the rail
    // when the register is already defaulting to it changes the query from
    // corpus scope to an equality and changes the count by five. A value that
    // reaches the URL and stops one line short of the query key is a control
    // that does nothing, and this file has paid for that twice.
    [viewKey, stage, geo, corpusScoped, idFilter, search, nullFields]
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

  // THE ONE CONDITION UNDER WHICH NOTHING ON THIS SCREEN IS AN ANSWER YET.
  // Named once and read by the rows, the count and the pager's data attribute,
  // so the three cannot disagree about whether the register has settled.
  const settling = facetsPending || list.isPending || list.isPlaceholderData;

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
  // A FACET NEVER FILTERS ITSELF, and the corpus scope is a country filter.
  // Left on, the country tree would count the corpus rather than the register
  // and could never offer a country the corpus does not yet cover - which is
  // the one thing this tree exists to show.
  const geoBase: ProjectQuery = {
    ...baseQuery,
    country: undefined,
    countryInScope: undefined,
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
  // THE CLIENTS, IN THE RAIL, BESIDE THE SAVED VIEWS. A client is a saved view
  // you open (see use-client-view), and the two sat on different screens.
  const clients = useClients();
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

  const { watch, toggleWatch, status: statusMutation, busy } = useProjectMutations({ onError: setError });
  // Confirm and exclude. Inert with no client open: see the C and X cases in
  // the keyboard handler.
  const membership = useMembershipMutation(clientId, setError);

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

  // A panel closes when the operator looks away from it. Bound only while one is
  // open, so the screen carries no listener it is not using.
  useEffect(() => {
    if (!filtersOpen && !periodOpen) return;
    const onDown = (e: MouseEvent) => {
      if (headRef.current && !headRef.current.contains(e.target as Node)) closePanels();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [filtersOpen, periodOpen, closePanels]);

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

      // A PANEL IS OPEN, SO THE KEYBOARD BELONGS TO IT. Without this, pressing E
      // while reading the venue list dismisses whatever row happened to be
      // selected behind the panel - a destructive write from a key the operator
      // thought they were typing into a filter. Escape closes the panel and
      // stops there rather than also clearing the selection.
      if (filtersOpen || periodOpen) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closePanels();
        }
        return;
      }

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
            //
            // Awaits any URL write the row click queued. See pendingSelection.
            const target = current.id;
            void (async () => {
              try {
                await pendingSelection.current;
              } catch {
                // A failed selection write must not stop the navigation: the
                // reader asked for the page, and the query string is a detail.
              }
              pendingSelection.current = null;
              router.push(`/project/${target}`);
            })();
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
            // The row on screen is the fallback, not the source. See toggleWatch.
            toggleWatch(current.id, current.watch);
          }
          break;
        // ---- CONFIRM AND EXCLUDE, IN A CLIENT VIEW ONLY. -------------------
        //
        // The register is where a row is judged, so it is where the judgement
        // is recorded - the alternative was a screen that does not exist, which
        // is why every client document covered nothing.
        //
        // BOUND ONLY WHEN A CLIENT IS OPEN, because "confirm" has no meaning
        // outside one: confirmed FOR WHOM. Pressed on the plain register these
        // do nothing at all rather than guessing a client, and the key legend
        // under the list only offers them when they are live.
        //
        // Both write, and pressing the same key twice returns the row to
        // `proposed`. That is the way back, and it is still a write: an
        // excluded row is a tombstone, never a deletion, or the next scope
        // resolution re-proposes it and asks the same question forever.
        case 'c':
          if (current && clientId) {
            e.preventDefault();
            membership.mutate({
              projectId: current.id,
              status:
                client.data?.membership.get(current.id) === 'included' ? 'proposed' : 'included',
            });
          }
          break;
        case 'x':
          if (current && clientId) {
            e.preventDefault();
            membership.mutate({
              projectId: current.id,
              status:
                client.data?.membership.get(current.id) === 'excluded' ? 'proposed' : 'excluded',
            });
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
  }, [
    rows,
    selectedIndex,
    selected,
    move,
    router,
    watch,
    toggleWatch,
    filtersOpen,
    periodOpen,
    closePanels,
    clientId,
    membership,
    client.data,
  ]);

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

  // ---- WHAT IS CURRENTLY APPLIED, AS A LIST THE ROW CAN PRINT.
  //
  // Every constraint the register is under, coarse to fine, each with the way
  // to remove it. This is the whole justification for collapsing the chip rows:
  // a filter behind a disclosure is acceptable only because the SELECTION is
  // not behind it.
  //
  // GEOGRAPHY IS IN HERE TOO, AND IT WAS NOT ON THE OLD FILTER BLOCK AT ALL. It
  // is chosen from the rail, and the rail marks the active node - but the
  // register opens on the United States by DEFAULT, and that default appeared
  // nowhere: the country tree is behind the collapsed press-coverage node, so
  // the one filter that is always on was the one filter nothing on the screen
  // stated. It reads as a chip like any other and clears like one.
  const activeFilters = useMemo(() => {
    const out: { key: string; axis: string; label: string; clear: () => void }[] = [];
    if (country) {
      out.push({
        key: 'country',
        axis: 'country',
        // THE CHIP SAYS WHICH OF THE TWO FILTERS IS ON. The default is the
        // corpus and admits a project whose country did not resolve; an
        // explicit pick is an equality and does not. Labelling both "United
        // States" would leave the one filter that is always on describing
        // itself as the stricter thing it is not, which is how it went five
        // days unnoticed.
        label: corpusScoped ? `${country} or unresolved` : country,
        clear: () => {
          void setCountry(null);
          void setRegion(null);
          void setMarket(null);
          void setPage(1);
        },
      });
    }
    if (region) {
      out.push({
        key: 'region',
        axis: 'state',
        label: region,
        clear: () => {
          void setRegion(null);
          void setMarket(null);
          void setPage(1);
        },
      });
    }
    if (market) {
      out.push({
        key: 'market',
        axis: 'market',
        label: market,
        clear: () => {
          void setMarket(null);
          void setPage(1);
        },
      });
    }
    if (stage) {
      out.push({ key: 'stage', axis: 'stage', label: stage, clear: () => applyStage(null) });
    }
    if (venue) {
      out.push({
        key: 'venue',
        axis: 'venue',
        label: venue === NO_VALUE ? 'no venue type' : venue,
        clear: () => {
          void setVenue(null);
          void setPage(1);
        },
      });
    }
    if (category) {
      out.push({
        key: 'category',
        axis: 'category',
        label: category === NO_VALUE ? 'no category' : category,
        clear: () => {
          void setCategory(null);
          void setPage(1);
        },
      });
    }
    return out;
  }, [
    country,
    corpusScoped,
    region,
    market,
    stage,
    venue,
    category,
    setCountry,
    setRegion,
    setMarket,
    setVenue,
    setCategory,
    setPage,
    applyStage,
  ]);

  // "Captured, this month". One statement, from what used to be two rows and a
  // dropdown. The bucketing joins it only when it is on, because "flat" is the
  // default and a label that recites its defaults is a label nobody reads.
  const axisLabel = PERIOD_AXES.find((a) => a.key === axis)?.label ?? 'Captured';
  const periodStatement =
    `${axisLabel}, ${period.label}` +
    (bucketMode === 'none'
      ? ''
      : `, ${(BUCKETS.find((b) => b.key === bucketMode)?.label ?? '').toLowerCase()}`);

  // EVERY CONSTRAINT THE REGISTER IS UNDER, WITH THE WAY OUT OF EACH.
  //
  // The toolbar's chips cover the six filter axes; this adds the three that
  // are not chips - the view, the period and the search - so an empty register
  // can list what produced it rather than guessing which one to blame.
  const constraints = useMemo(() => {
    const out = activeFilters.map((f) => ({ ...f, undo: 'remove' }));
    if (viewKey !== 'all') {
      out.unshift({
        key: 'view',
        axis: 'view',
        label: VIEWS.find((v) => v.key === viewKey)?.label ?? viewKey,
        undo: 'show all',
        clear: () => {
          void setView('all');
          void setPage(1);
        },
      });
    }
    if (period.key !== 'all') {
      out.push({
        key: 'period',
        axis: 'period',
        label: periodStatement,
        undo: 'all time',
        clear: () => {
          setPeriod(null);
          void setPage(1);
        },
      });
    }
    if (search.trim()) {
      out.push({
        key: 'search',
        axis: 'search',
        label: `"${search.trim()}"`,
        undo: 'clear',
        clear: () => {
          setSearchDraft('');
          void setSearch(null);
          void setPage(1);
        },
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFilters, viewKey, period.key, periodStatement, search]);


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
        clientViews={(clients.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
        activeClient={clientId}
        onClient={(id) => {
          void setClientId(id);
          void setPage(1);
          void setSelected(null);
        }}
      />

      <div className={`${styles.listPane} ${viewKey === 'trash' ? styles.trashView : ''}`}>
        <div className={styles.listHead} ref={headRef}>
          {/* ---- ONE FILTER CONTROL, NOT FIVE ROWS. ------------------------ */}
          <div className={styles.control}>
            <button
              type="button"
              data-testid="filter-toggle"
              aria-expanded={filtersOpen}
              className={`${styles.disclosure} ${filtersOpen ? styles.disclosureOn : ''}`}
              onClick={() => {
                setPeriodOpen(false);
                setFiltersOpen((o) => !o);
              }}
            >
              Filter
              <span className={styles.caret} aria-hidden="true">
                {filtersOpen ? '▴' : '▾'}
              </span>
            </button>

            {filtersOpen && (
              <div className={styles.panel} data-testid="filter-panel">
                <FilterGroup
                  label="Stage"
                  testId="register-stage-chips"
                  attr="data-stage"
                  chips={stageChips}
                  active={stage}
                  onPick={applyStage}
                />
                <FilterGroup
                  label="Venue"
                  testId="register-venue-chips"
                  attr="data-venue"
                  chips={venueChips}
                  active={venue}
                  onPick={(v) => {
                    void setVenue(v);
                    void setPage(1);
                  }}
                />
                <FilterGroup
                  label="Category"
                  testId="register-category-chips"
                  attr="data-category"
                  chips={categoryChips}
                  active={category}
                  onPick={(v) => {
                    void setCategory(v);
                    void setPage(1);
                  }}
                />
              </div>
            )}
          </div>

          {/* ---- AND WHAT IS ON, WHICH IS NEVER BEHIND ANYTHING. ----------- */}
          {activeFilters.map((f) => (
            <button
              key={f.key}
              type="button"
              className={styles.activeChip}
              data-active-filter={f.key}
              title={`Remove the ${f.axis} filter`}
              onClick={() => f.clear()}
            >
              <span className={styles.activeAxis}>{f.axis}</span>
              {f.label}
              <span className={styles.activeClear} aria-hidden="true">
                ×
              </span>
            </button>
          ))}

          {/* ---- THE PERIOD AND ITS AXIS, AS ONE STATEMENT. ---------------- */}
          <div className={styles.control}>
            <button
              type="button"
              data-testid="period-toggle"
              aria-expanded={periodOpen}
              className={`${styles.disclosure} ${
                periodOpen || period.key !== 'all' ? styles.disclosureOn : ''
              }`}
              onClick={() => {
                setFiltersOpen(false);
                setPeriodOpen((o) => !o);
              }}
            >
              {periodStatement}
              <span className={styles.caret} aria-hidden="true">
                {periodOpen ? '▴' : '▾'}
              </span>
            </button>

            {periodOpen && (
              <div className={styles.panel} data-testid="period-panel">
                {/* THE AXIS. Which date the period is applied to. Two different
                    questions - what arrived, and what moved - that a single
                    "period" control would silently conflate. */}
                <div className={styles.panelGroup}>
                  <span className={styles.panelLabel}>Which date</span>
                  <div className={styles.panelChips}>
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
                  </div>
                </div>

                <div className={styles.panelGroup}>
                  <span className={styles.panelLabel}>Period</span>
                  {/* ALL TIME HAD NO CONTROL AT ALL. The register's default
                      period is 'all', and neither the rolling nor the calendar
                      list offers it - so picking "7 days" was a one-way door
                      and the only way back was editing the URL. It sits with
                      the periods rather than inside PeriodSelector because that
                      component is shared with Today and the composer, where
                      "all time" is not an option worth offering. */}
                  <div className={styles.panelChips}>
                    <button
                      type="button"
                      data-period="all"
                      className={`${styles.chip} ${
                        period.key === 'all' ? styles.chipAllActive : ''
                      }`}
                      onClick={() => {
                        setPeriod(null);
                        void setPage(1);
                      }}
                    >
                      All time
                    </button>
                  </div>
                  <PeriodSelector
                    period={period}
                    now={periodNow}
                    onChange={(t) => {
                      setPeriod(t);
                      void setPage(1);
                    }}
                  />
                </div>

                <div className={styles.panelGroup}>
                  <span className={styles.panelLabel}>Grouping</span>
                  <div className={styles.panelChips}>
                    {BUCKETS.map((b) => (
                      <button
                        key={b.key}
                        type="button"
                        data-bucket={b.key}
                        className={`${styles.chip} ${
                          bucketMode === b.key ? styles.chipActive : ''
                        }`}
                        onClick={() => {
                          void setBucket(b.key === 'none' ? null : b.key);
                          void setPage(1);
                        }}
                      >
                        {b.label}
                      </button>
                    ))}
                    {bucketMode !== 'none' && (
                      <span className={styles.toolbarNote} data-testid="bucket-sort-note">
                        ordered by {bucketField === 'first_seen' ? 'first seen' : 'last activity'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* WHAT THE PERIOD AXIS RESOLVED TO, on the row rather than in the
              panel: it is the result of a query the screen issued and does not
              otherwise display, and "6 projects" with no cause behind it is what
              let the old first_seen behaviour go unnoticed for a month. A
              statement, not a control - it is not counted as a decision because
              there is nothing to decide about it. */}
          {axis === 'moved' && period.key !== 'all' && (
            <span className={`${styles.toolbarNote} mono`} data-testid="axis-resolution">
              {moved.isPending
                ? 'resolving events...'
                : `${moved.data?.events ?? 0} events, ${moved.data?.ids.length ?? 0} projects`}
              {moved.data?.capped ? ' (CAPPED)' : ''}
            </span>
          )}

          {axis === 'arrived' && period.key !== 'all' && (
            <span className={`${styles.toolbarNote} mono`} data-testid="axis-resolution">
              {arrived.isPending
                ? 'resolving records...'
                : `${arrived.data?.records ?? 0} records, ${arrived.data?.ids.length ?? 0} projects`}
              {arrived.data?.capped ? ' (CAPPED)' : ''}
            </span>
          )}

          <input
            className={styles.search}
            value={searchDraft}
            onChange={(e) => setSearchDraft(e.target.value)}
            placeholder="Project, applicant or representative"
            aria-label="Search projects"
          />
        </div>

        {/* A FACET THAT COULD NOT BE RESOLVED SAYS SO. Failing closed is only
            honest if the empty register is explained: without this the operator
            sees "No projects" under a venue chip and reads it as an answer about
            the corpus rather than about a query that never came back. Not
            dismissable, because it describes a live condition rather than an
            event. */}
        {/* THE CLIENT BANNER. What is being looked at, and on what basis.
            A filtered list with no statement of the filter is a list you have to
            remember the provenance of, and the whole point of opening a client
            is that the answer to "why these" must be on the screen. */}
        {clientId && (
          <div className={styles.clientBar} data-testid="client-scope-bar">
            <span className={styles.clientName}>
              {client.data?.scope ? 'Client scope' : 'Client'}
            </span>
            {client.isPending ? (
              <span className={styles.dim}>resolving the stored scope...</span>
            ) : !client.data?.scope ? (
              <span className={styles.dim}>
                This client stores no scope, so nothing is narrowed and the list below is
                every project.
              </span>
            ) : (
              /* THE THREE COUNTS, AND WHAT EACH ONE MEANS FOR THE DOCUMENT.
                 The bar used to lead with what the SCOPE proposes, which is the
                 number that feels like the answer and is not: the report prints
                 the CONFIRMED set and nothing else. A client bar reading "15
                 projects proposed" over a document covering zero is the exact
                 shape of confusion this gate was added to prevent.
                 So: three counts, then the sentence that turns them into a page
                 count, then what will still not print. */
              <span className={styles.dim}>
                {client.data.unconstrained && (
                  <span>
                    The stored scope constrains no axis, so this client is proposed
                    everything.{' '}
                  </span>
                )}
                <span data-testid="client-counts">
                  <span className="mono">{client.data.counts.proposed}</span> proposed,{' '}
                  <span className="mono">{client.data.counts.included}</span> confirmed,{' '}
                  <span className="mono">{client.data.counts.excluded}</span> excluded
                  {client.data.capped ? ' (CAPPED)' : ''}.
                </span>{' '}
                {client.data.membershipNotApplied ? (
                  'Confirmed membership is not switched on: migration 033 has not been run, so nothing here has been confirmed or excluded yet.'
                ) : (
                  <span data-testid="client-document-line">
                    {client.data.counts.included === 0
                      ? 'A document prints the confirmed only, so it would cover no projects at all. Press C on a row to confirm it, X to exclude it.'
                      : `A document would cover ${
                          client.data.counts.included - client.data.heldOut.confirmed.either
                        } of the ${client.data.counts.included} confirmed.`}
                  </span>
                )}
                {/* WHAT THIS LIST SHOWS AND THE DOCUMENT WILL NOT.
                    The register marks a provisional name and a frozen market on
                    the row; the report path drops those projects entirely. So a
                    client's list can look healthy while their document comes
                    out a third shorter, and until now the only place that gap
                    appeared was inside the generated PDF. Said here, with the
                    action that closes the half of it that can be closed.
                    Counted over the CONFIRMED set once anything is confirmed,
                    because that is the set the document is built from; over the
                    proposal before then, because that is the size of the naming
                    job standing between here and a document. */}
                {(() => {
                  const confirmed = client.data.counts.included > 0;
                  const h = confirmed
                    ? client.data.heldOut.confirmed
                    : client.data.heldOut.proposed;
                  if (h.either === 0) return null;
                  return (
                    <span data-testid="client-held-out">
                      {' '}
                      <span className="mono">{h.either}</span>{' '}
                      {confirmed ? 'of the confirmed' : 'of the proposed'} will not print:{' '}
                      {[
                        h.unnamed
                          ? `${h.unnamed} carry a name taken from an agenda line, which you can fix by opening the project and renaming it`
                          : '',
                        h.frozen
                          ? `${h.frozen} sit in a market whose source has stopped publishing, which you cannot`
                          : '',
                      ]
                        .filter(Boolean)
                        .join(', and ')}
                      .
                    </span>
                  );
                })()}
              </span>
            )}
            <button
              type="button"
              className={styles.chipMore}
              onClick={() => {
                void setClientId(null);
                void setPage(1);
              }}
            >
              clear
            </button>
          </div>
        )}

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

        {/* A LOADING STATE THAT COULD BE MISTAKEN FOR AN ANSWER IS A DEFECT.
            Every query on this screen carries `placeholderData: (prev) => prev`
            so the register never blinks empty while a filter resolves - which
            is right, and which means the rows on screen are the PREVIOUS
            filter's answer while the new one is in flight. Rendered at full
            fidelity under a chip that has already changed, they read as the
            answer to a question nobody asked yet.
            The pager has withheld its data-total in this state since the filter
            work, because an audit that read it measured the filter it had just
            navigated away from. The operator was given no such signal. Now the
            rows dim and the count says so. */}
        <div
          className={styles.table}
          ref={listRef}
          data-testid="register-scroll"
          data-settling={settling ? 'true' : undefined}
        >
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
            <p className={styles.dim}>Reading the register...</p>
          ) : rows.length === 0 ? (
            /* AN EMPTY REGISTER IS AN INVITATION, NEVER AN APOLOGY, and on this
               product it is often the correct and important answer. So it says
               what is true - which constraints are on, and what each one is -
               and every line is the control that removes it. Nothing here
               guesses: the old text advised clearing the geography filter
               whether or not one was applied. */
            <div className={styles.empty} data-testid="register-empty">
              {/* WHEN THE ONLY THING FILTERING IS THE VIEW, THE VIEW IS THE
                  ANSWER. "No project satisfies this" over a single line reading
                  "view / Client ready" is true and useless: what the operator
                  needs is what that view MEANS and how a project gets into it,
                  which is a different sentence per view rather than one
                  sentence about the query. */}
              <p className={styles.emptyLead}>
                {constraints.every((c) => c.key === 'view')
                  ? emptyViewSentence(viewKey)
                  : constraints.length === 1
                    ? 'No project satisfies this.'
                    : `No project satisfies all ${constraints.length} of these at once.`}
              </p>

              {constraints.length > 0 && (
                <ul className={styles.emptyList}>
                  {constraints.map((c) => (
                    <li key={c.key} data-empty-constraint={c.key}>
                      <span className={styles.emptyAxis}>{c.axis}</span>
                      <span className={styles.emptyValue}>{c.label}</span>
                      <button type="button" className={styles.chipMore} onClick={() => c.clear()}>
                        {c.undo}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {/* THE CLIENT CASE, WHICH IS THE ONE THAT MATTERS MOST. An empty
                  client view has to distinguish "the scope proposes nothing"
                  from "the scope proposes twelve and the filters above removed
                  all of them", because the first is a scope to widen on Clients
                  and the second is a chip to press here. */}
              {clientId && client.data && (
                <p className={styles.emptyNote} data-testid="register-empty-client">
                  {client.data.ids.length === 0
                    ? 'The stored scope for this client proposes no project at all. Widen it on Clients: a scope that matches nothing produces a document with nothing in it.'
                    : `The stored scope proposes ${client.data.ids.length} project${
                        client.data.ids.length === 1 ? '' : 's'
                      }, and the constraints above remove ${
                        client.data.ids.length === 1 ? 'it' : 'all of them'
                      }.`}
                </p>
              )}
            </div>
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
                /* THE SELECTION IS WRITTEN AT ONCE, NOT ON A THROTTLE, AND
                   THE WRITE IS HELD so a navigation can wait for it.

                   nuqs batches query-string writes: a row click updates
                   `selected` in React immediately and reaches the URL about
                   50ms later, and the deferred write targets the url as it was
                   when queued. Pressing Enter in that window pushed
                   /project/<id> with the right project and was thrown back to
                   /projects?selected=<id> by the click's own late write.
                   throttleMs 0 narrowed the window and did not close it.

                   CLOSED BY ORDERING RATHER THAN BY TIMING. The promise goes in
                   pendingSelection and Enter awaits it before pushing, so the
                   late write lands first and cannot overtake the navigation.
                   There is no interval left to lose a race in. */
                onClick={() => {
                  pendingSelection.current = setSelected(r.id, { throttleMs: 0 });
                }}
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
                    {/* ONE MARK, NOT TWO BOXES IN TWO COLUMNS.
                        A row could carry an "unnamed" tag on this line and a
                        "frozen 2018" tag in the market cell, in the same
                        hairline box, and the two read as two unrelated warnings
                        of equal weight. They are not two warnings. They are ONE
                        statement - this project may not go in a client document
                        - with two possible causes, and the causes are ordered:
                        a market whose source has stopped outranks a name we
                        assembled, which is the precedence the detail pane has
                        always used.
                        Measured 2026-08-16 over the 267 live projects: 39 are
                        unnamed, 6 sit in a frozen market, 1 is both, and 1 is
                        watched. So the marks barely collide in practice; what
                        was wrong is that one vocabulary was being spelled two
                        ways in two places.
                        The watch dot stays where it is, before the name: it is
                        the operator's own bookmark rather than a fact about the
                        project, and it is the only mark here that says nothing
                        about whether the row can be sold. */}
                    {heldMark(r)}
                  </span>
                  {/* The name answers "which one". This answers "what is it".
                      Rendered even when null so every row is the same height.

                      IN A CLIENT VIEW IT ANSWERS "WHY IS THIS HERE" INSTEAD, and
                      that is the more urgent question of the two. A client list
                      showing forty projects and nothing about why each one is in
                      it is a list you either trust entirely or not at all, and
                      "not at all" is the correct response to a list you cannot
                      check. One wrong project in a client document is worse than
                      four missing ones. It replaces the summary rather than
                      joining it because the row is two lines by design and a
                      third would change the density of every screen. */}
                  {clientId ? (
                    <span className={styles.cellReason} data-row-reason>
                      {/* WHAT HAS BEEN DECIDED ABOUT THIS ROW, BEFORE WHY IT IS
                          HERE. `proposed` is the default and stays silent, the
                          same rule the rail's `live` coverage state follows: a
                          mark on every row is not a mark. Only a decision shows,
                          because only a decision changes the document. */}
                      {(() => {
                        const status = client.data?.membership.get(r.id);
                        if (status !== 'included' && status !== 'excluded') return null;
                        return (
                          <span
                            className={styles.memberMark}
                            data-membership={status}
                            title={
                              status === 'included'
                                ? 'Confirmed for this client. Press C to put it back to proposed.'
                                : 'Excluded from this client. Press X to put it back to proposed.'
                            }
                          >
                            {status === 'included' ? 'confirmed' : 'excluded'}
                          </span>
                        );
                      })()}
                      {(() => {
                        const axes = client.data?.reasons.get(r.id) ?? [];
                        if (!client.data?.scope) return 'no stored scope: not narrowed';
                        if (client.data.unconstrained) return 'scope constrains no axis: everything is in scope';
                        return axes.length
                          ? axes.join(', ')
                          : 'matched no constrained axis - check the scope';
                      })()}
                    </span>
                  ) : (
                    <span className={styles.cellSummary} data-row-summary>
                      {r.summary ?? ''}
                    </span>
                  )}
                </span>
                {/* THE RANK, WHICH IS THE FIRST THING AFTER THE NAME.
                    Still the score, because the score is the thing that can be
                    interrogated - hover it for the nine signals that made it -
                    but set on the ink ladder so its STANDING is readable
                    without anyone learning the scale. See SIGNIFICANCE_BANDS. */}
                <span
                  className={`${styles.cell} ${styles.num} ${styles.sig} mono`}
                  data-band={significanceBand(r.significance).key}
                  title={significanceTitle(r)}
                >
                  {r.significance == null ? '--' : Math.round(r.significance)}
                </span>
                <span className={styles.cell}>{r.primary_applicant ?? '--'}</span>
                {/* The market, and nothing else. The fact that its source has
                    stopped is a fact about whether the ROW can be sold, so it
                    is stated once, with the name, alongside the other reason a
                    row can be held out. It used to be marked here as well, in
                    the identical hairline box, which is how one statement came
                    to read as two warnings. */}
                <span className={styles.cell}>{r.market ?? r.region_state ?? '--'}</span>
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
            {...(settling ? {} : { 'data-total': total })}
          >
            {settling
              ? 'resolving...'
              : total === 0
                ? 'No projects'
                : `${(page - 1) * DEFAULT_PROJECT_PAGE_SIZE + 1}-${Math.min(
                    page * DEFAULT_PROJECT_PAGE_SIZE,
                    total
                  )} of ${total}`}
            {!settling && list.data
              ? ` | ${list.data.rowsMs} ms rows, ${list.data.countMs} ms count`
              : ''}
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
          {/* OFFERED ONLY WHERE THEY DO SOMETHING. Confirm and exclude are
              meaningless outside a client view - confirmed for whom - so the
              legend does not advertise two keys that would be inert. */}
          {clientId && (
            <>
              <span className={styles.dot} aria-hidden="true" />
              <span className="mono">C</span> confirm
              <span className={styles.dot} aria-hidden="true" />
              <span className="mono">X</span> exclude
            </>
          )}
          <span className={styles.dot} aria-hidden="true" />
          <span className="mono">Esc</span> close
        </p>
      </div>

      {selected && (
        <ProjectsDetail
          id={selected}
          onClose={() => void setSelected(null)}
          onError={setError}
          // The membership controls appear in the pane only when a client is
          // open, for the same reason the keys are bound only then.
          clientName={clientId ? (clients.data ?? []).find((c) => c.id === clientId)?.name ?? null : null}
          membershipStatus={clientId ? (client.data?.membership.get(selected) ?? null) : null}
          onMembership={
            clientId ? (status) => membership.mutate({ projectId: selected, status }) : undefined
          }
          membershipBusy={membership.isPending}
        />
      )}
    </div>
  );
}
