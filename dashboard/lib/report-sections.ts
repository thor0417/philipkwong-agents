// THE SECTIONS. Composable units, not one template function.
//
// Each section is a value in a registry: an id, a label, a description, and a
// build function that takes the same context and returns a Section. Reordering
// the report is reordering an array; adding a section is adding an entry; and
// no section can affect another, because none of them can see another's output.
//
// The alternative - one buildReport() with nine branches - is what makes a
// report generator ossify: the branches acquire shared state, the order becomes
// load-bearing, and adding a tenth section means understanding the other nine.
//
// EVERY SECTION DECLARES ITS OWN EMPTINESS. A section with nothing to say
// returns an emptyNote instead of no lines, because a section that silently
// vanishes lets the document imply coverage it does not have. "No hearings are
// scheduled in this period" is information; a missing Upcoming hearings heading
// is an unanswered question.

import type { Project } from './projects';
import type { TimelineRecord } from './projects';
import type { EventRow } from './project-event-queries';
import {
  absenceSentence,
  captureSentence,
  commentaryLines,
  isFiling,
  pressLine,
  reconcileSentence,
  recordLine,
  type Entry,
  type Line,
  type Section,
  type Subsection,
} from './report-model';
import { buildEntry, recordSentence } from './report-entry';
import { categoriesForPipeline } from './taxonomy';
import type { PartyHistory } from './people';

export interface SectionContext {
  // Every project in scope, after the scope, dormancy, stream and hollowness
  // filters. The three sets below partition it.
  projects: Project[];
  // The projects this document describes in full, most significant first.
  detailedProjects: Project[];
  // In scope, filed inside the period, but below the detail cap. Counted.
  undetailedProjects: Project[];
  // In scope and filed nothing inside the period. Counted, and counted
  // SEPARATELY: "quiet this month" and "less significant" are different facts.
  silentProjects: Project[];
  // In scope with neither a market nor a region. Counted and named, never
  // grouped: 'Unassigned' is not a place, and printing it as one is how World
  // Bank consultancy tenders came to appear as a market in a hospitality report.
  unplacedProjects: Project[];
  // Dropped before scope for having no live record at all.
  excludedHollow: number;
  // THE READ LIMITS, AND WHETHER EACH ONE BOUND. A cap that binds and is not
  // stated is a document covering less than its scope claims, which is the one
  // failure this layer exists to prevent. See the coverage note.
  caps: {
    projects: boolean;
    projectCap: number;
    records: boolean;
    recordCap: number;
    events: boolean;
    eventCap: number;
    partyHistoryFailed: boolean;
  };
  // EXCLUDED BECAUSE WE CANNOT NAME THEM. name_source 'title' is a cleaned
  // agenda line, not a name anything published. Held as the PROJECTS rather
  // than a count, so the coverage note can say which markets were thinned -
  // "nothing is silently absent" means the reader can see where the gap is,
  // not merely that there is one.
  provisionalExcluded: Project[];
  detailCap: number;
  // THE ENTRIES, BUILT ONCE, IN SIGNIFICANCE ORDER, WITH THEIR MARKET AS group.
  //
  // They used to be built inside the by-market section. With the document now
  // sectioned by category and subheaded by market, two sections would otherwise
  // both have to build them - the category sections to print them and the
  // coverage note to count what they held back - and two builders of one thing
  // eventually disagree about it. See buildReport.
  entries: Entry[];
  // Filings beyond an entry's own cap, and filings folded together as the same
  // item captured twice. Document-level facts, stated in the coverage note.
  heldRecords: number;
  mergedRecords: number;
  // Which pipeline this document is for. The category section list is read from
  // the taxonomy keyed on it.
  pipelineId: string;
  // Where each named party appears on OTHER projects, keyed by normalised name.
  // Empty when the companies layer holds nothing, and nothing is claimed then.
  partyHistory: Map<string, PartyHistory>;
  // Records attached to those projects, already scoped and period-filtered.
  records: (TimelineRecord & { project_id?: string | null; market?: string | null })[];
  events: EventRow[];
  periodLabel: string;
  periodSince: string | null;
  periodUntil: string | null;
  geographyLabel: string;
  // Philip's commentary, keyed by section id.
  commentary: Record<string, string>;
  includeDormant: boolean;
  includeContext: boolean;
  watchlistOnly: boolean;
  // The sections this document actually contains. A section may only point the
  // reader at another one if it is really there: the by-market note used to
  // send them to "the appendix" in documents built from the default set, which
  // does not include the appendix.
  sectionIds: string[];
}

// isFiling - the RECORD-or-PRESS rule - now lives in report-model beside the
// provenance gate it feeds, so that report-entry can reach it without importing
// this file back. Re-exported here because it is part of this module's public
// surface and the provenance audit asserts on it by that name.
export { isFiling };

function host(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function lineForRecord(
  r: TimelineRecord & { market?: string | null },
  prefix = '',
  projectName?: string | null
): Line {
  // The record as a sentence, not as the clerk's agenda line. See
  // report-entry/recordSentence for what this used to print.
  const text = `${prefix}${recordSentence(r, projectName) || r.title || 'Untitled record'}`;
  const meta = [r.published_date?.slice(0, 10), r.market].filter(Boolean).join(' | ');
  return isFiling(r.source, r.source_type, r.stream)
    ? recordLine(text, r.url, r.source ?? host(r.url), meta)
    : pressLine(text, r.url, host(r.url) || (r.source ?? 'press'), meta);
}

// ---- WHAT THE PROJECT IS ----------------------------------------------------
//
// ONLY DERIVED SUMMARIES REACH A CLIENT DOCUMENT, and the provenance model is
// what decides that rather than a preference.
//
// A DERIVED summary is a quotation from one filing. It is a RECORD, and the
// gate requires a RECORD to carry the source the client can go and read - which
// is why the sentence is stored with the URL it came from. Printed without that
// citation it would be an unattributed claim wearing a record's label.
//
// A GENERATED summary has no such source. It is a model's reading of several
// records, and none of them contains the sentence. It cannot be RECORD (no
// document says it), it cannot be PRESS (nobody published it), and labelling it
// ASSESSMENT would put a machine's paraphrase under Philip's name in a document
// going to a client - the exact failure the shot harness was rewritten to stop.
// So it is not printed at all. It stays on the register, the detail pane and
// the project page, each of which says in words that a model wrote it.
//
// A MANUAL summary is Philip's own sentence and belongs in commentary, which he
// writes in the composer, not in a line the generator emits on his behalf.
function summaryLine(p: Project): Line[] {
  if (p.summary_source !== 'derived' || !p.summary || !p.summary_url) return [];
  return [recordLine(`   ${p.summary}`, p.summary_url, 'quoted from the filing')];
}

export interface SectionDef {
  id: string;
  label: string;
  description: string;
  // ONE REGISTRY ENTRY MAY PRODUCE SEVERAL SECTIONS.
  //
  // The category sections are one per category that has something in it, and
  // which categories those are is not knowable until the scope has been
  // resolved. The alternative - a registry entry per category - would mean the
  // composer offering a checkbox for "Infrastructure" whether or not this
  // client has any infrastructure, and a section list that changes shape
  // depending on the data, which is exactly what a registry is for avoiding.
  //
  // So the registry holds ONE 'categories' entry, the composer offers one
  // control, and the document gets as many headings as the taxonomy and the
  // data between them justify.
  build: (ctx: SectionContext) => Section | Section[];
}

function withCommentary(id: string, ctx: SectionContext, section: Omit<Section, 'commentary'>): Section {
  return { ...section, commentary: commentaryLines(ctx.commentary[id]) };
}


/**
 * WHAT EACH READ LIMIT SAYS WHEN IT BINDS.
 *
 * A function rather than four inline branches, because the audit harness has to
 * be able to assert on the sentences without the corpus being large enough to
 * trigger them. dashboard/scripts/exclusion-audit calls this with every flag
 * set; if a sentence is ever deleted, that run fails rather than a future
 * client receiving a document that quietly covers part of its own scope.
 *
 * Each is a HARD ceiling on what was fetched, so the document is describing
 * part of its scope and has to say which part is missing rather than which part
 * is present.
 */
export function capNotes(caps: SectionContext['caps']): string[] {
  const out: string[] = [];
  if (caps.projects) {
    out.push(
      `This scope matched at least ${caps.projectCap} projects, which is the most this document ` +
        `reads. Projects beyond that limit are not covered here at all, and are not included in ` +
        `any count above. Narrow the geography or the period to see them.`
    );
  }
  if (caps.records) {
    out.push(
      `This document cites the ${caps.recordCap} most recent records in scope, which is the most ` +
        `it reads. Older filings on the projects above exist and are not shown or counted.`
    );
  }
  if (caps.events) {
    out.push(
      `More than ${caps.eventCap} project events fell inside this period, which is the most this ` +
        `document reads. "What moved" shows the most recent of them and is not a complete list.`
    );
  }
  if (caps.partyHistoryFailed) {
    out.push(
      `Cross-market history for the parties named above could not be read on this run, so no entry ` +
        `says where else a party appears. That is our failure to read it, not a statement that they ` +
        `appear nowhere else.`
    );
  }
  return out;
}

// ---- 1. COVER ----------------------------------------------------------------

const cover: SectionDef = {
  id: 'cover',
  label: 'Cover',
  description: 'Title, addressee, period and the scoping statement.',
  build: (ctx) =>
    withCommentary('cover', ctx, {
      id: 'cover',
      title: 'Scope of this report',
      lede: 'What this document covers, and what it does not.',
      // The scoping statement is an ASSESSMENT in provenance terms because it is
      // our own description of our own coverage, not something a filing says.
      // Labelling it RECORD would be the exact category error the rule exists to
      // prevent, even though it is factually true.
      // THE SELECTION, ON THE COVER, IN FULL. A reader who counts the entries
      // must find the cover already told them the number, and must be able to
      // account for every project in scope without turning a page. The four
      // counts partition the set: detailed plus counted plus silent is exactly
      // the scope, and the hollow ones are named as never having reached it.
      lines: commentaryLines(
        `This report covers ${ctx.geographyLabel} for ${ctx.periodLabel}. ` +
          `It is drawn from ${ctx.projects.length} project${ctx.projects.length === 1 ? '' : 's'} ` +
          `and ${ctx.records.length} captured record${ctx.records.length === 1 ? '' : 's'}. ` +
          `Of those projects, ${ctx.detailedProjects.length} ${ctx.detailedProjects.length === 1 ? 'is' : 'are'} ` +
          `described in full, selected by significance` +
          (ctx.undetailedProjects.length
            ? `; ${ctx.undetailedProjects.length} further ${ctx.undetailedProjects.length === 1 ? 'project is' : 'projects are'} counted but not described`
            : '') +
          (ctx.silentProjects.length
            ? `; ${ctx.silentProjects.length} ${ctx.silentProjects.length === 1 ? 'project' : 'projects'} filed nothing in this period`
            : '') +
          (ctx.unplacedProjects.length
            ? `; and ${ctx.unplacedProjects.length} ${ctx.unplacedProjects.length === 1 ? 'carries' : 'carry'} no market or region we could resolve`
            : '') +
          `. ` +
          (ctx.excludedHollow
            ? `${ctx.excludedHollow} project${ctx.excludedHollow === 1 ? '' : 's'} whose every record has been dismissed ` +
              `${ctx.excludedHollow === 1 ? 'is' : 'are'} excluded entirely, because ${ctx.excludedHollow === 1 ? 'it has' : 'they have'} ` +
              `no filing to cite. `
            : '') +
          // ON THE COVER AS WELL AS IN THE COVERAGE NOTE. The project count
          // above is the count AFTER this exclusion, so a reader who never
          // reaches the coverage note would otherwise have no way to know the
          // scope was larger than the document. The coverage note carries the
          // reason and the markets; the cover carries the number, next to the
          // other numbers it has to reconcile with.
          (ctx.provisionalExcluded.length
            ? `A further ${ctx.provisionalExcluded.length} project${ctx.provisionalExcluded.length === 1 ? '' : 's'} in this ` +
              `geography ${ctx.provisionalExcluded.length === 1 ? 'is' : 'are'} excluded because our capture holds no ` +
              `published name for ${ctx.provisionalExcluded.length === 1 ? 'it' : 'them'}; the coverage note says where. `
            : '') +
          `Anything outside that geography or period is not covered here.`
      ),
    }),
};

// ---- 2. WHAT MOVED -----------------------------------------------------------

const whatMoved: SectionDef = {
  id: 'moved',
  label: 'What moved',
  description: 'Stage changes inside the period, most advanced first.',
  build: (ctx) => {
    const stageChanges = ctx.events.filter((e) => e.event_type === 'stage_changed');
    const lines = stageChanges.map((e) =>
      recordLine(
        `${e.project?.name ?? 'Unnamed project'}: ${e.from_value ?? 'unknown'} to ${e.to_value ?? 'unknown'}`,
        e.lead?.url ?? '',
        e.lead?.source ?? 'project event',
        [e.occurred_at.slice(0, 10), e.project?.market].filter(Boolean).join(' | ')
      )
    );
    // A stage change with no triggering record cannot be a RECORD line: there is
    // nothing to link. It is dropped from this section rather than emitted
    // unsourced, and the count of what was dropped is stated.
    const sourced = lines.filter((l) => l.source);
    const unsourced = lines.length - sourced.length;
    return withCommentary('moved', ctx, {
      id: 'moved',
      title: 'What moved',
      lede: 'Projects that changed stage in this period.',
      lines: sourced,
      emptyNote:
        sourced.length === 0
          ? `No project in this scope changed stage during ${ctx.periodLabel}.`
          : unsourced > 0
            ? `${unsourced} further stage change${unsourced === 1 ? '' : 's'} had no linkable source record and ${unsourced === 1 ? 'is' : 'are'} not listed.`
            : undefined,
    });
  },
};

// ---- 3. HEADLINE FINDS -------------------------------------------------------

// FIFTEEN, ACROSS EVERY CATEGORY. The brief's number, and the reason for it is
// the resectioning: with the document split by category, a reader who only
// wants "what matters most" has no single section to read unless the headline
// list spans them all. Ten was chosen when the document had one project list.
const HEADLINE_CAP = 15;

const headlines: SectionDef = {
  id: 'headlines',
  label: 'Headline finds',
  description: `The ${HEADLINE_CAP} projects with the most activity in the period.`,
  build: (ctx) => {
    const byProject = new Map<string, number>();
    for (const r of ctx.records) {
      const id = r.project_id ?? '';
      if (id) byProject.set(id, (byProject.get(id) ?? 0) + 1);
    }
    // SELECTED BY SIGNIFICANCE, NOT BY ACTIVITY COUNT.
    //
    // Counting filings in the period picked whichever project a clerk had
    // filed on most, which is a measure of paperwork rather than of
    // importance: a rezoning heard twice outranked a multi-billion casino bid
    // heard once. Activity count survives as the tiebreak, because between two
    // equally significant projects the busier one is the better story.
    const ranked = [...ctx.projects]
      .sort(
        (a, b) =>
          (b.significance ?? -1) - (a.significance ?? -1) ||
          (byProject.get(b.id) ?? 0) - (byProject.get(a.id) ?? 0) ||
          (b.record_count ?? 0) - (a.record_count ?? 0)
      )
      .slice(0, HEADLINE_CAP);
    const lines = ranked.flatMap((p) => {
      // THE MOST RECENT ONE, WHICH IS WHAT THE LEDE PROMISES. find() returned
      // whichever filing the query happened to yield first, so the section
      // heading said "their most recent filing" over a line that was often the
      // oldest - and for Heart Hotel that meant a press aggregator page stood in
      // for a July zoning approval.
      const rec = ctx.records
        .filter((r) => r.project_id === p.id)
        .sort((a, b) => (b.published_date ?? '').localeCompare(a.published_date ?? ''))[0];
      if (!rec) return [];
      return [lineForRecord(rec, `${p.name}: `, p.name), ...summaryLine(p)].filter(
        (l): l is Line => !!l
      );
    });
    return withCommentary('headlines', ctx, {
      id: 'headlines',
      title: 'Headline finds',
      // The count is in the lede because this section is a top-N by
      // construction. A heading reading "Headline finds" over exactly ten lines
      // invites the reader to conclude there were ten.
      lede: `The ${HEADLINE_CAP} most significant projects in this scope and period, with their most recent filing.`,
      lines,
      emptyNote: lines.length === 0 ? 'No project in this scope had a record in this period.' : undefined,
    });
  },
};

// ---- 4. THE CATEGORY SECTIONS -------------------------------------------------
//
// CATEGORY IS WHAT A READER THINKS IN; GEOGRAPHY IS A SUBHEADING INSIDE IT.
//
// The document was sectioned by market, so a reader working a casino brief
// walked seven states to find the casinos and had to hold the set in their head
// as they went. Category first inverts that: the casinos are in one place, and
// the states are subheadings under them. It is also the structure that survives
// the register reaching fifty markets, where a market-per-section document is a
// contents page and nothing else.
//
// THE SECTION LIST COMES FROM THE TAXONOMY, NOT FROM THE DATA AND NOT FROM A
// LITERAL HERE. categoriesForPipeline(pipeline_id) is the locked list in
// lib/taxonomy, mirrored dashboard-side, and it is read at build time. A list
// derived from whichever categories happen to be present would silently change
// shape month to month; a list typed out here would drift from the taxonomy the
// moment anyone edited it.
//
// A CATEGORY WITH NOTHING IN IT IS OMITTED. Not printed empty: a heading over
// an empty-state sentence is a paragraph telling the reader nothing, repeated
// once per category the client does not buy.
//
// A PROJECT WHOSE CATEGORY WE COULD NOT RESOLVE GETS A SECTION NAMED FOR THAT
// FACT, and is never quietly dropped or filed under "Other" - "Other" is a
// value in the taxonomy that means something, and using it for "we do not know"
// would make the two indistinguishable in the one place a reader might act on
// the difference.
//
// THE SECTIONS DESCRIBE WHAT THE DOCUMENT SELECTED. They do not select, and
// they do not build. Selection happens once in buildReport, across the whole
// scope and by significance, and the entries are built once there too - so a
// category section is a partition of a list, and two sections cannot disagree
// about what an entry says.

const CATEGORY_SECTION_PREFIX = 'category:';

/** The section id a category's heading is stored under, for commentary keying. */
export function categorySectionId(category: string): string {
  return `${CATEGORY_SECTION_PREFIX}${category}`;
}

export const UNCATEGORISED_SECTION_ID = 'category:unresolved';

/** Market, or the state when the market is unresolved. Never 'Unassigned'. */
function placeOf(p: Project): string {
  return p.market ?? p.region_state ?? '';
}

/**
 * One section per category holding entries, in taxonomy order, plus a final
 * section for the projects whose category we could not resolve.
 */
function buildCategorySections(ctx: SectionContext): Section[] {
  const projectById = new Map(ctx.detailedProjects.map((p) => [p.id, p]));
  const known = new Set<string>(categoriesForPipeline(ctx.pipelineId));

  // Bucket the entries the document already built. An entry whose project
  // carries no category, or one outside the taxonomy, goes to the unresolved
  // bucket under its own key.
  const buckets = new Map<string, Entry[]>();
  for (const e of ctx.entries) {
    const p = projectById.get(e.id);
    const cat = p?.development_category ?? null;
    const key = cat && known.has(cat) ? cat : UNCATEGORISED_SECTION_ID;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(e);
  }

  // The remainder, per category and then per market inside it, so a reader of
  // one category learns how much of that category is not on the page.
  const remainder = new Map<string, Map<string, number>>();
  for (const p of ctx.undetailedProjects) {
    const cat =
      p.development_category && known.has(p.development_category)
        ? p.development_category
        : UNCATEGORISED_SECTION_ID;
    if (!remainder.has(cat)) remainder.set(cat, new Map());
    const byPlace = remainder.get(cat)!;
    const place = placeOf(p) || 'no resolved market';
    byPlace.set(place, (byPlace.get(place) ?? 0) + 1);
  }

  const section = (key: string, title: string, lede: string): Section | null => {
    const entries = buckets.get(key) ?? [];
    const rest = remainder.get(key);
    // OMITTED, NOT PRINTED EMPTY, and "empty" means NO ENTRY.
    //
    // The first version kept a category that had counted-but-undescribed
    // projects, on the reasoning that "four of these exist and none is
    // described" is information. It is - and printed this way it was three
    // consecutive headings with one sentence under each, which reads as a
    // document with holes in it. The information is not lost: the coverage note
    // names every category that is in scope with nothing described, in one
    // sentence, which is where the document's other limits already are.
    if (entries.length === 0) return null;

    const markets = new Set(entries.map((e) => e.group ?? '').filter(Boolean));
    const notes: string[] = [];
    if (rest) {
      const ranked = [...rest.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
      const many = ranked.filter(([, n]) => n > 1);
      const singles = ranked.filter(([, n]) => n === 1).map(([m]) => m);
      const clauses = many.map(([m, n]) => `${n} further projects in ${m}`);
      if (singles.length === 1) clauses.push(`1 further project in ${singles[0]}`);
      else if (singles.length > 1) {
        clauses.push(
          `1 further project in each of ${singles.slice(0, -1).join(', ')} and ` +
            `${singles[singles.length - 1]}`
        );
      }
      const total = ranked.reduce((n, [, c]) => n + c, 0);
      notes.push(
        `${clauses.join(', ')} ${total === 1 ? 'is' : 'are'} in this category and not described here.`
      );
    }

    // COMMENTARY, KEYED BY CATEGORY, FALLING BACK TO THE COMPOSER'S ONE BOX.
    //
    // The composer offers a single "Category sections" control, so what Philip
    // types there is keyed 'categories'. It attaches to the FIRST category
    // section rather than to all of them, because repeating one paragraph under
    // every heading would read as a template rather than as a remark. A
    // per-category box can be added later without touching this: the key it
    // would write is the category's own name, which is what is read first.
    const commentary = {
      ...ctx.commentary,
      [key]: ctx.commentary[key] ?? (out.length === 0 ? ctx.commentary.categories : undefined) ?? '',
    };
    return withCommentary(key, { ...ctx, commentary }, {
      id: key,
      title,
      lede:
        entries.length === 0
          ? lede
          : `${lede} ${entries.length} project${entries.length === 1 ? '' : 's'} described, ` +
            `across ${markets.size} market${markets.size === 1 ? '' : 's'}.`,
      lines: [],
      entries,
      emptyNote: notes.length ? notes.join(' ') : undefined,
    });
  };

  const out: Section[] = [];
  // TAXONOMY ORDER, NOT COUNT ORDER. A document whose sections reorder
  // themselves month to month is one a reader has to re-learn each time, and
  // the taxonomy's own order is the one Philip already thinks in.
  for (const category of categoriesForPipeline(ctx.pipelineId)) {
    const s = section(
      category,
      category,
      `Projects in this category, described from their own filings, grouped by market.`
    );
    if (s) out.push(s);
  }
  const unresolved = section(
    UNCATEGORISED_SECTION_ID,
    'Projects with no resolved category',
    'These projects are in scope and our classifier could not place them in the taxonomy. ' +
      'They are described here rather than dropped, and they are not filed under "Other", ' +
      'which is a category that means something.'
  );
  if (unresolved) out.push(unresolved);
  return out;
}

const categories: SectionDef = {
  id: 'categories',
  label: 'Category sections',
  description:
    'One section per category in the taxonomy that has something in it, with geography as a subheading inside.',
  build: buildCategorySections,
};

// ---- 5. UPCOMING HEARINGS ----------------------------------------------------

const hearings: SectionDef = {
  id: 'hearings',
  label: 'Upcoming hearings',
  description: 'Records carrying a future decision date.',
  build: (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const future = ctx.records
      .filter((r) => r.deadline && r.deadline.slice(0, 10) > today)
      .sort((a, b) => (a.deadline ?? '').localeCompare(b.deadline ?? ''));
    const lines = future.map((r) => lineForRecord(r, `${r.deadline?.slice(0, 10)}: `));
    return withCommentary('hearings', ctx, {
      id: 'hearings',
      title: 'Upcoming hearings and deadlines',
      lede: 'Decision dates ahead, from the captured records.',
      lines,
      // THE HONEST EMPTY STATE. Measured across the corpus: hearing dates are
      // not being extracted from agenda records at all, so this section is
      // usually empty for a reason that has nothing to do with the client's
      // scope. Saying so is the difference between "nothing is scheduled" and
      // "we do not capture this yet".
      emptyNote:
        lines.length === 0
          ? 'No record in this scope carries a future decision date. Hearing dates are not currently extracted from agenda records, so this reflects our capture rather than the absence of scheduled hearings.'
          : undefined,
    });
  },
};

// ---- 6. WATCH LIST -----------------------------------------------------------

const watchList: SectionDef = {
  id: 'watchlist',
  label: 'Watch list',
  description: 'Watched projects that moved in the period, and a count of those that did not.',
  build: (ctx) => {
    const watched = ctx.projects.filter((p) => p.watch);
    const lines: Line[] = [];
    // THE SAME FALLBACK, THE SAME FIX. This section had the second instance of
    // it: a watched project with no filing in the period was printed as
    // commentary, so "watched, no filing in this period" - a fact about our own
    // register - carried Philip's [ASSESSMENT] tag. A watch list is most useful
    // when it distinguishes the watched things that moved from the watched
    // things that did not, and it can do that in one counted sentence without
    // attributing anything to anybody.
    let quiet = 0;
    for (const p of watched) {
      const rec = ctx.records.find((r) => r.project_id === p.id);
      if (!rec) {
        quiet++;
        continue;
      }
      lines.push(lineForRecord(rec, `${p.name}: `, p.name));
    }
    return withCommentary('watchlist', ctx, {
      id: 'watchlist',
      title: 'Watch list',
      lede: 'Projects being watched in this scope, and what they did in the period.',
      lines,
      emptyNote:
        watched.length === 0
          ? 'No projects in this scope are on the watch list.'
          : quiet > 0
            ? `${quiet} of the ${watched.length} watched project${watched.length === 1 ? '' : 's'} in this scope ` +
              `had no filing captured during ${ctx.periodLabel}.`
            : undefined,
    });
  },
};

// ---- 7. TENDERS OPEN ---------------------------------------------------------

const tenders: SectionDef = {
  id: 'tenders',
  label: 'Tenders open',
  description: 'Tenders and RFPs whose deadline has not passed.',
  build: (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const open = ctx.records.filter(
      (r) => r.deadline && r.deadline.slice(0, 10) >= today && isFiling(r.source, r.source_type, r.stream)
    );
    const lines = open.map((r) => lineForRecord(r, `closes ${r.deadline?.slice(0, 10)}: `));
    return withCommentary('tenders', ctx, {
      id: 'tenders',
      title: 'Tenders open',
      lede: 'Procurement notices in this scope that have not closed.',
      lines,
      emptyNote: lines.length === 0 ? 'No open tenders in this scope.' : undefined,
    });
  },
};

// ---- 8. APPENDIX -------------------------------------------------------------

const appendix: SectionDef = {
  id: 'appendix',
  label: 'Appendix: all records',
  description: 'Every record in scope, with its link.',
  build: (ctx) => {
    const lines = [...ctx.records]
      .sort((a, b) => (b.published_date ?? '').localeCompare(a.published_date ?? ''))
      .map((r) => lineForRecord(r));
    return withCommentary('appendix', ctx, {
      id: 'appendix',
      title: 'Appendix: every record in scope',
      lede: 'The complete captured set behind this report, so any statement above can be checked.',
      lines,
      emptyNote: lines.length === 0 ? 'No records in scope for this period.' : undefined,
    });
  },
};

// ---- 9. APPENDIX: PROJECTS NOT DETAILED --------------------------------------
//
// OFF BY DEFAULT. The point of selection is that a client document is not the
// register, so naming the remainder is an option a reader asks for rather than
// the default state of the document.
//
// EVERY LINE STILL CITES A FILING. A one-line-per-project appendix is exactly
// the shape the old by-market section had, and that shape is what forced the
// [ASSESSMENT] fallback: a project name with no record to point at cannot be
// labelled anything honest. It works here only because these projects are
// undetailed for want of ROOM, not for want of evidence - each one filed
// something inside the period, which is what made it eligible for selection in
// the first place. A project with nothing to cite is in the silent count and
// never reaches this section.
const remainder: SectionDef = {
  id: 'remainder',
  label: 'Appendix: projects not detailed',
  description: 'The projects counted but not described above, one line each, with their most recent filing.',
  build: (ctx) => {
    const byProject = new Map<string, SectionContext['records']>();
    for (const r of ctx.records) {
      const id = r.project_id ?? '';
      if (!id) continue;
      if (!byProject.has(id)) byProject.set(id, []);
      byProject.get(id)!.push(r);
    }
    const lines = ctx.undetailedProjects.flatMap((p) => {
      const rec = (byProject.get(p.id) ?? [])
        .slice()
        .sort((a, b) => (b.published_date ?? '').localeCompare(a.published_date ?? ''))[0];
      if (!rec) return [];
      const market = p.market ?? p.region_state ?? 'Unassigned';
      return [lineForRecord(rec, `${market} | ${p.name}: `, p.name)];
    });
    return withCommentary('remainder', ctx, {
      id: 'remainder',
      title: 'Appendix: projects not detailed',
      lede:
        'Every project in scope that filed inside the period but is not described above, ' +
        'with its most recent filing so it can be looked up.',
      lines,
      emptyNote:
        lines.length === 0
          ? `Every project in scope is described above; there is no remainder.`
          : undefined,
    });
  },
};

// ---- 10. COVERAGE NOTE -------------------------------------------------------

const coverage: SectionDef = {
  id: 'coverage',
  label: 'Coverage note',
  description: 'What this report does not cover, stated plainly.',
  build: (ctx) => {
    const notes: string[] = [
      `Coverage is limited to ${ctx.geographyLabel}. Projects outside it exist in our register and are not reported here.`,
      `The period is ${ctx.periodLabel}. Activity outside it is not included even where it concerns the same project.`,
    ];
    if (!ctx.includeDormant) notes.push('Dormant projects are excluded from this report.');
    if (!ctx.includeContext) notes.push('Context records that support a finding without being about it are excluded.');
    if (ctx.watchlistOnly) notes.push('This report is restricted to watch-listed projects.');
    // THE SELECTION IS A LIMIT ON THE DOCUMENT, so it belongs in the list of
    // the document's limits and not only on the cover. A reader who reaches
    // this section without having read the cover still learns that what they
    // have is the top of a longer list.
    notes.push(
      `This document describes the ${ctx.detailCap} most significant projects in scope. ` +
        (ctx.undetailedProjects.length
          ? `${ctx.undetailedProjects.length} further project${ctx.undetailedProjects.length === 1 ? '' : 's'} ` +
            `in scope ${ctx.undetailedProjects.length === 1 ? 'is' : 'are'} counted but not described.`
          : 'Every project in scope is described.')
    );
    notes.push(...capNotes(ctx.caps));
    // WHAT WE COULD NOT NAME, COUNTED AND LOCATED.
    //
    // The one sentence that stands in for the projects this document refuses to
    // print. It carries the count, the reason and the markets, because a reader
    // who is told only a number cannot tell whether the gap is in the market
    // they care about.
    if (ctx.provisionalExcluded.length) {
      const n = ctx.provisionalExcluded.length;
      const byMarket = new Map<string, number>();
      for (const p of ctx.provisionalExcluded) {
        const m = p.market ?? p.region_state ?? 'no resolved market';
        byMarket.set(m, (byMarket.get(m) ?? 0) + 1);
      }
      const named = [...byMarket.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([m, c]) => `${m} (${c})`);
      notes.push(
        `${n} project${n === 1 ? '' : 's'} in scope ${n === 1 ? 'is' : 'are'} not named in this ` +
          `document because our capture holds no published name for ${n === 1 ? 'it' : 'them'} - ` +
          `only the agenda line the matter was filed under, which is the instrument rather than ` +
          `the project. ${n === 1 ? 'It is' : 'They are'} on the register and can be named by hand. ` +
          `By market: ${named.join(', ')}.`
      );
    }
    // A CATEGORY WITH NOTHING DESCRIBED IS NAMED, ONCE, HERE.
    //
    // The category sections print only where there is an entry to print, so a
    // category holding nothing but counted projects has no heading of its own.
    // Without this sentence a reader would have no way to tell that from "we
    // cover no infrastructure", which is a different and much larger claim.
    const described = new Set(
      ctx.detailedProjects.map((p) => p.development_category).filter(Boolean) as string[]
    );
    const undescribed = new Map<string, number>();
    for (const p of ctx.undetailedProjects) {
      const c = p.development_category;
      if (!c || described.has(c)) continue;
      undescribed.set(c, (undescribed.get(c) ?? 0) + 1);
    }
    if (undescribed.size) {
      const named = [...undescribed.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([c, n]) => `${c} (${n})`);
      notes.push(
        `${named.length === 1 ? 'One category is' : `${named.length} categories are`} in scope with ` +
          `no project described, so ${named.length === 1 ? 'it has' : 'they have'} no section above: ` +
          `${named.join(', ')}. The count in brackets is how many projects in that category are in ` +
          `scope and below the detail cap.`
      );
    }
    // QUIET IS NOT THE SAME AS UNIMPORTANT, and the document says so once.
    //
    // This sentence used to sit under the by-market heading. With the document
    // sectioned by category it has no single section to belong to - the silent
    // projects are spread across every category - so it moved here, which is
    // where the rest of the document's limits already are.
    if (ctx.silentProjects.length) {
      const n = ctx.silentProjects.length;
      notes.push(
        `${n} further project${n === 1 ? '' : 's'} in scope had no filing captured during ` +
          `${ctx.periodLabel}, so ${n === 1 ? 'it is' : 'they are'} not described in any category ` +
          `section. ${n === 1 ? 'It remains' : 'They remain'} on the register.`
      );
    }
    if (ctx.heldRecords) {
      notes.push(
        `${ctx.heldRecords} further filing${ctx.heldRecords === 1 ? '' : 's'} on the projects described ` +
          `${ctx.heldRecords === 1 ? 'is' : 'are'} in scope but not printed, because each project shows ` +
          `its most recent filings only.`
      );
    }
    if (ctx.mergedRecords) {
      // The counts on the cover come from the record set, so a document that
      // prints six lines where the basis counted twelve records has to account
      // for the other six. Two captures of one filing is our capture artefact -
      // a bilingual minute, a plan captured page by page - and the client is
      // told that rather than left to find the arithmetic.
      notes.push(
        `${ctx.mergedRecords} record${ctx.mergedRecords === 1 ? '' : 's'} counted on the cover ` +
          `${ctx.mergedRecords === 1 ? 'is' : 'are'} the same filing captured more than once - a bilingual ` +
          `minute, or a document captured page by page - and ${ctx.mergedRecords === 1 ? 'is' : 'are'} shown ` +
          `once above.`
      );
    }
    if (ctx.unplacedProjects.length) {
      const n = ctx.unplacedProjects.length;
      notes.push(
        `${n} project${n === 1 ? '' : 's'} in scope carr${n === 1 ? 'ies' : 'y'} no market or region in our ` +
          `capture, most often a tender published against a country rather than a place. ` +
          `${n === 1 ? 'It is' : 'They are'} counted but not grouped under any market, because a project ` +
          `we cannot place must not be printed as though it were a market of its own.`
      );
    }
    if (ctx.excludedHollow) {
      notes.push(
        `${ctx.excludedHollow} project${ctx.excludedHollow === 1 ? '' : 's'} in this geography ` +
          `${ctx.excludedHollow === 1 ? 'holds' : 'hold'} no live record and ${ctx.excludedHollow === 1 ? 'is' : 'are'} ` +
          `excluded: every record attached to ${ctx.excludedHollow === 1 ? 'it' : 'them'} has been dismissed on review, ` +
          `so there is nothing to cite.`
      );
    }
    notes.push(
      'Records are captured from published sources. A matter that has not been published, or that is published somewhere we do not yet capture, will not appear.'
    );
    return withCommentary('coverage', ctx, {
      id: 'coverage',
      title: 'Coverage note',
      lede: 'The limits of this document.',
      lines: notes.flatMap((n) => commentaryLines(n)),
    });
  },
};


// ---- THE REFERRAL BRIEF -------------------------------------------------------
//
// A REFERRAL IS A DIFFERENT DOCUMENT, NOT A SHORTER REPORT. It is about one
// matter, written to be forwarded to somebody who will act on that matter, so
// the sections answering "what else is going on" are noise and the sections
// answering "what do we actually know, and how do you know we know it" are the
// whole point.
//
// THE STRUCTURE IS THE JULY BRIEF'S, section for section:
//
//   The project      what it is, then Record provenance (our captured filings)
//                    as its own subsection, then what the press reports, then
//                    the reconciliation of the two, then what the record does
//                    not say.
//   The people       every party the filings name, with the way to reach them
//                    or the statement that there is not one.
//   The opportunity  Philip's commentary. Omitted entirely when he has written
//                    none.
//   Status and risk  the same.
//
// THE LAST RULE IS THE ONE THAT MATTERS. "A fabricated assessment under his
// name has been shipped once and removed." These two sections are the only
// place in any document where a judgement belongs, and they are built from
// ctx.commentary and from nothing else - there is no fallback, no derived
// sentence, and no default text. A build that finds no commentary returns an
// empty array, which buildReport flattens away, so the heading does not appear
// at all rather than appearing over a machine's paraphrase.

/** The single project a referral is about, or null when the scope is not one. */
function soleEntry(ctx: SectionContext): Entry | null {
  return ctx.entries.length === 1 ? ctx.entries[0] : null;
}

function recordLineFor(r: Entry['records'][number]): Line {
  // A SOURCE THAT ALREADY ENDED ITS SENTENCE DOES NOT NEED OUR FULL STOP. Press
  // headlines arrive visibly truncated - "Love is coming to the Las Vegas Strip
  // in the shape of ..." - and appending a period produced "....", which reads
  // as a transcription fault rather than as the source running on.
  const stop = /[.!?…]$/.test(r.text) ? '' : '.';
  const bits = [
    r.date ?? 'no date in the record',
    r.reference ? ` ${r.reference}.` : '.',
    ` ${r.text}${stop}`,
    r.figures.length ? ` ${r.figures.join(', ')}.` : '',
    r.players.length
      ? ` Players: ${r.players.map((p) => `${p.name} (${p.role})`).join('; ')}.`
      : '',
    r.contact ? ` ${r.contact}` : '',
    r.language ? ` [${r.language}]` : '',
  ];
  const text = bits.join('').replace(/\s+/g, ' ').trim();
  return r.provenance === 'RECORD'
    ? recordLine(text, r.url, r.sourceLabel)
    : pressLine(text, r.url, r.sourceLabel);
}

const referralProject: SectionDef = {
  id: 'referral-project',
  label: 'The project (referral)',
  description:
    'One project: what it is, the captured filings as their own subsection, what the press reports, and what the record does not say.',
  build: (ctx) => {
    const e = soleEntry(ctx);
    if (!e) {
      return withCommentary('referral-project', ctx, {
        id: 'referral-project',
        title: 'The project',
        lede: 'A referral brief describes one matter.',
        lines: [],
        emptyNote:
          ctx.entries.length === 0
            ? 'No project in this scope has a filing in the period, so there is nothing to describe.'
            : `This scope holds ${ctx.entries.length} projects. A referral brief is about one ` +
              `matter; choose a single project in the composer.`,
      });
    }

    const filings = e.records.filter((r) => r.provenance === 'RECORD');
    const press = e.records.filter((r) => r.provenance === 'PRESS');

    const subsections: Subsection[] = [];
    subsections.push({
      title: 'Record provenance (our captured filings)',
      lines: filings.map(recordLineFor),
      emptyNote:
        filings.length === 0
          ? 'We hold no captured filing for this project. Everything below is press-sourced.'
          : undefined,
    });
    if (press.length) {
      subsections.push({
        title: 'Reported beyond our record (press)',
        lines: press.map(recordLineFor),
      });
    }

    // THE SUMMARY IS THE ONLY PROSE, AND IT IS A QUOTATION. Same rule as
    // everywhere else: a derived summary carries the link to the filing it was
    // taken from, and a generated one does not reach a client document at all.
    const lines: Line[] = e.summary
      ? [recordLine(e.summary.text, e.summary.url, 'quoted from the filing')]
      : [];

    const derived = [
      e.assembled,
      reconcileSentence(e.records),
      // The cover counts the records in scope and this section prints the ones
      // that survived deduping. Where those differ, say so.
      captureSentence(ctx.records.length, e.records.length, ctx.mergedRecords),
      absenceSentence(e.records, e.people),
    ].filter((d): d is NonNullable<typeof d> => !!d);

    return withCommentary('referral-project', ctx, {
      id: 'referral-project',
      title: 'The project',
      lede: e.meta ? `${e.name}. ${e.meta}.` : e.name,
      lines,
      derived,
      subsections,
    });
  },
};

const referralPeople: SectionDef = {
  id: 'referral-people',
  label: 'The people (referral)',
  description:
    'Every party the filings name, with a way to reach them or the statement that there is none.',
  build: (ctx) => {
    const e = soleEntry(ctx);
    const people = e?.people ?? [];
    const lines: Line[] = people.map((party) => {
      // JOINED WITH SENTENCE PUNCTUATION, not with spaces. Run together, a
      // party read "Brown, Brown, & Premsrirut 520 S. 4th Street, Las Vegas, NV
      // 89101 No phone or email in the record." - three separate facts with
      // nothing between them, in the section a reader of a referral studies
      // hardest.
      const detail = [
        party.firm,
        party.address,
        party.contact?.email || party.contact?.phone
          ? [party.contact?.email, party.contact?.phone].filter(Boolean).join(', ')
          : 'No phone or email in the record',
        party.alsoOn,
      ]
        .filter(Boolean)
        .map((part) => String(part).replace(/[.\s]+$/, ''))
        .join('. ');
      const text = `${party.name} - ${party.roles.join(', ')}. ${detail}.`
        .replace(/\s+/g, ' ')
        .trim();
      // A party's provenance is already RECORD or PRESS by type, and it already
      // carries the record that names them. Both are required by the gate.
      return party.provenance === 'RECORD'
        ? recordLine(text, party.sourceUrl, party.sourceLabel)
        : pressLine(text, party.sourceUrl, party.sourceLabel);
    });
    return withCommentary('referral-people', ctx, {
      id: 'referral-people',
      title: 'The people',
      lede: 'Every party our filings name, and how the record says to reach them.',
      lines,
      emptyNote: lines.length === 0 ? (e?.noPeopleNote ?? 'No project selected.') : undefined,
    });
  },
};

/**
 * A COMMENTARY-ONLY SECTION, WHICH DOES NOT EXIST WHEN THERE IS NO COMMENTARY.
 *
 * Returning an empty array rather than an empty section is the whole mechanism:
 * buildReport flattens, so the heading is absent from the document. There is
 * deliberately no lede, no empty note and no default sentence, because every one
 * of those would be text under Philip's name that Philip did not write.
 */
function assessmentSection(id: string, title: string, description: string): SectionDef {
  return {
    id,
    label: title,
    description,
    build: (ctx) => {
      const lines = commentaryLines(ctx.commentary[id]);
      if (lines.length === 0) return [];
      return { id, title, lines: [], commentary: lines };
    },
  };
}

const referralOpportunity = assessmentSection(
  'referral-opportunity',
  'The opportunity',
  "Philip's read on why this matter is worth a referral. Omitted entirely when empty."
);

const referralRisk = assessmentSection(
  'referral-risk',
  'Status and risk',
  "Philip's read on what is still ahead of this project. Omitted entirely when empty."
);

export const SECTION_REGISTRY: SectionDef[] = [
  cover,
  whatMoved,
  headlines,
  categories,
  hearings,
  watchList,
  tenders,
  remainder,
  appendix,
  coverage,
  referralProject,
  referralPeople,
  referralOpportunity,
  referralRisk,
];

// THE REFERRAL BRIEF, IN THE JULY ORDER. See the section definitions above.
//
// The two assessment sections are in the set on purpose, even though they
// usually render nothing: their presence in the composer's section list is what
// puts a commentary box in front of Philip for each of them. A section he
// cannot see is a section he will not write.
export const REFERRAL_SECTION_IDS = [
  'cover',
  'referral-project',
  'referral-people',
  'referral-opportunity',
  'referral-risk',
];

// THE ORDER THE BRIEF SPECIFIES, and it is the order of the array.
//
// Cover and the provenance legend are rendered by the document itself, ahead of
// every section; 'cover' below is the Scope of this report section that follows
// them. The category sections sit in the middle because that is where the
// substance is: what moved and the headline finds orient a reader, the
// categories are what they came for, and hearings, the watch list and the
// coverage note are what they check afterwards.
export const DEFAULT_SECTION_IDS = [
  'cover',
  'moved',
  'headlines',
  'categories',
  'hearings',
  'watchlist',
  'coverage',
];

// A SAVED TEMPLATE MUST NOT LOSE THE BODY OF THE DOCUMENT.
//
// The by-market section was id 'markets' and stored templates still name it.
// Without this alias sectionById returns undefined, buildReport filters it out,
// and the report generates with a cover, a headline list and a coverage note
// over nothing at all - a document that is wrong in the one way nobody checks,
// because every section it DOES contain is correct.
const LEGACY_SECTION_IDS: Record<string, string> = { markets: 'categories' };

export function sectionById(id: string): SectionDef | undefined {
  const resolved = LEGACY_SECTION_IDS[id] ?? id;
  return SECTION_REGISTRY.find((s) => s.id === resolved);
}
