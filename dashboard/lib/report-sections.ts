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
  commentaryLines,
  isFiling,
  pressLine,
  recordLine,
  type Entry,
  type Line,
  type Section,
} from './report-model';
import { buildEntry } from './report-entry';

export interface SectionContext {
  projects: Project[];
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
  prefix = ''
): Line {
  const text = `${prefix}${r.title ?? 'Untitled record'}`;
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
  build: (ctx: SectionContext) => Section;
}

function withCommentary(id: string, ctx: SectionContext, section: Omit<Section, 'commentary'>): Section {
  return { ...section, commentary: commentaryLines(ctx.commentary[id]) };
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
      lines: commentaryLines(
        `This report covers ${ctx.geographyLabel} for ${ctx.periodLabel}. ` +
          `It is drawn from ${ctx.projects.length} project${ctx.projects.length === 1 ? '' : 's'} ` +
          `and ${ctx.records.length} captured record${ctx.records.length === 1 ? '' : 's'}. ` +
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

const HEADLINE_CAP = 10;

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
      return [lineForRecord(rec, `${p.name}: `), ...summaryLine(p)].filter(
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

// ---- 4. BY MARKET ------------------------------------------------------------

// THE SECTION THAT LISTED STRANGERS.
//
// It printed one line per project - market, name, stage, link - and never said
// what a single one of them was. 111 of the 171 live projects carry a derived,
// citable sentence describing themselves; none of it appeared here. And for a
// project with no filing inside the period it printed
//
//   [ASSESSMENT] Clark County | Symphony Park Hotel (approved), no filing in this period
//
// which is the defect the brief names first: our own register, rendered as
// Philip's personal judgement, on a line the client cannot check.
//
// BOTH FAILURES HAVE THE SAME FIX. The section now emits ENTRIES: a project
// named, described from its own derived summary, and evidenced by its own dated
// filings, each with players, figures, a contact where the record names one, and
// a link. An entry is built from records, so a project with no record in the
// period cannot produce one - buildEntry returns null - and there is no longer
// any code path that reaches for commentary to fill the hole. The fallback is
// not fixed; it is gone, and the count of what it would have covered is stated
// in the section note instead.
//
// PER-MARKET CAP, AND IT IS STATED.
//
// A JKR report whose cover read "149 projects" listed 122 of them: 19 Clark
// County projects and 8 Las Vegas ones vanished between the basis line and the
// list, with no note anywhere in the document. The cap is worth keeping - a
// section describing 800 projects is not a section a person reads - so what
// changes is that the document says what it left out, per market, in the same
// breath as the count on the cover.
const MARKET_LIST_CAP = 25;

const byMarket: SectionDef = {
  id: 'markets',
  label: 'By market',
  description: `Each project described, with its filings, grouped by market, up to ${MARKET_LIST_CAP} per market.`,
  build: (ctx) => {
    const groups = new Map<string, Project[]>();
    for (const p of ctx.projects) {
      const k = p.market ?? p.region_state ?? 'Unassigned';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }

    // Records bucketed once. find() per project was O(projects x records) and
    // returned only the FIRST match, which is why the old section could show a
    // project's oldest filing and call it the project.
    const byProject = new Map<string, SectionContext['records']>();
    for (const r of ctx.records) {
      const id = r.project_id ?? '';
      if (!id) continue;
      if (!byProject.has(id)) byProject.set(id, []);
      byProject.get(id)!.push(r);
    }

    const entries: Entry[] = [];
    const truncated: { market: string; listed: number; total: number; unreached: number }[] = [];
    let silent = 0; // in scope, but with no filing inside the period
    let heldRecords = 0; // filings beyond an entry's own cap
    let mergedRecords = 0; // the same filing captured twice, folded into one

    for (const [market, ps] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      // WITHIN A MARKET, MOST SIGNIFICANT FIRST. The cap means this decides
      // WHICH projects a market shows, not merely their order, so ordering by
      // anything else silently drops the important ones.
      ps.sort((a, b) => (b.significance ?? -1) - (a.significance ?? -1));

      const forMarket: Entry[] = [];
      let considered = 0;
      for (const p of ps) {
        if (forMarket.length >= MARKET_LIST_CAP) break;
        considered++;
        const built = buildEntry(p, byProject.get(p.id) ?? []);
        if (!built) {
          silent++;
          continue;
        }
        heldRecords += built.held;
        mergedRecords += built.merged;
        // The market is on the entry's meta line, so the name does not have to
        // carry it. "Clark County | Heart Hotel / Kulik River: ..." was a line
        // that named a place twice and a project once.
        forMarket.push(built.entry);
      }
      // Truncated only if the cap is what stopped us, and the count is of the
      // projects never looked at - not of the ones looked at and found silent,
      // which the note below reports separately and for a different reason.
      if (considered < ps.length) {
        truncated.push({ market, listed: forMarket.length, total: ps.length, unreached: ps.length - considered });
      }
      entries.push(...forMarket);
    }

    const notes: string[] = [];
    if (truncated.length) {
      const held = truncated.reduce((n, t) => n + t.unreached, 0);
      notes.push(
        `${entries.length} of ${ctx.projects.length} projects are described above. ` +
          `${held} further project${held === 1 ? ' is' : 's are'} in scope and counted on the cover but not described here, ` +
          `because this section describes at most ${MARKET_LIST_CAP} projects per market: ` +
          truncated.map((t) => `${t.market} has ${t.total}`).join('; ') +
          (ctx.sectionIds.includes('appendix')
            ? '. The appendix below lists every record in scope, including theirs.'
            : '. Add the appendix section to list every record in scope, including theirs.')
      );
    }
    if (silent) {
      // STATED, NOT PRINTED AS AN ENTRY. These are the projects the old section
      // rendered as [ASSESSMENT] lines. They are in the client's scope and they
      // did nothing in the period, and saying so once in a sentence is both
      // shorter and more honest than saying it project by project in a label
      // that claims Philip wrote it.
      notes.push(
        `${silent} further project${silent === 1 ? '' : 's'} in scope had no filing captured during ` +
          `${ctx.periodLabel}, so ${silent === 1 ? 'it is' : 'they are'} not described here. ` +
          `${silent === 1 ? 'It remains' : 'They remain'} on the register.`
      );
    }
    if (heldRecords) {
      notes.push(
        `${heldRecords} further filing${heldRecords === 1 ? '' : 's'} on the projects above ` +
          `${heldRecords === 1 ? 'is' : 'are'} in scope but not printed, because each project shows its ` +
          `most recent filings only.`
      );
    }
    if (mergedRecords) {
      // The counts on the cover come from the record set, so an entry that
      // prints six lines where the basis counted twelve records has to account
      // for the other six. Two captures of one filing is our capture artefact -
      // a bilingual minute, a plan captured page by page - and the client is
      // told that rather than left to find the arithmetic.
      notes.push(
        `${mergedRecords} record${mergedRecords === 1 ? '' : 's'} counted on the cover ` +
          `${mergedRecords === 1 ? 'is' : 'are'} the same filing captured more than once - a bilingual ` +
          `minute, or a document captured page by page - and ${mergedRecords === 1 ? 'is' : 'are'} shown ` +
          `once above.`
      );
    }

    return withCommentary('markets', ctx, {
      id: 'markets',
      title: 'By market',
      lede: 'Each project in scope, described from its own filings, grouped by market.',
      lines: [],
      entries,
      emptyNote: entries.length === 0
        ? `No project in this scope had a filing captured during ${ctx.periodLabel}, so there is nothing to describe.`
        : notes.length
          ? notes.join(' ')
          : undefined,
    });
  },
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
      lines.push(lineForRecord(rec, `${p.name}: `));
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

// ---- 9. COVERAGE NOTE --------------------------------------------------------

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

export const SECTION_REGISTRY: SectionDef[] = [
  cover,
  whatMoved,
  headlines,
  byMarket,
  hearings,
  watchList,
  tenders,
  appendix,
  coverage,
];

export const DEFAULT_SECTION_IDS = [
  'cover',
  'moved',
  'headlines',
  'markets',
  'hearings',
  'watchlist',
  'coverage',
];

export function sectionById(id: string): SectionDef | undefined {
  return SECTION_REGISTRY.find((s) => s.id === id);
}
