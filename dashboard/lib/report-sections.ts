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
  pressLine,
  recordLine,
  type Line,
  type Section,
} from './report-model';

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

// ---- PRESS OR RECORD ---------------------------------------------------------
//
// The distinction is in the data, not in a guess. A record from the government
// or opportunity streams is a filing: an agenda item, a tender notice, a
// resolution. A record from the intelligence stream is trade press - it is how
// that lane works, and its source is a publication rather than a clerk.
//
// THAT PARAGRAPH WAS ALWAYS THE INTENT, AND THE CODE DID NOT IMPLEMENT IT. The
// rule was a list of source NAMES, so the question it actually answered was
// "has someone remembered to add this adapter?" rather than "is this a filing?"
// New York arrived with three government adapters and 325 filings from
// zap.planning.nyc.gov, a002-ceqraccess.nyc.gov and a856-cityrecord.nyc.gov
// rendered as [PRESS] in client documents - every one of them a primary
// government record, described to a client as something a journalist wrote.
//
// A WHITELIST FAILS IN THE WRONG DIRECTION. Measured over the corpus before
// this change: 328 of 778 government-stream records rendered as [PRESS], and 0
// of 410 intelligence-stream records rendered as [RECORD]. The rule was
// conservative in the direction that costs nothing and permissive in the
// direction that costs credibility, and it got worse every time an adapter was
// added, silently, in a document nobody re-reads.
//
// SO THE STREAM DECIDES. The stream is set at write time by the lane that
// captured the row (agents/scraper/government writes 'government'), so it is a
// statement about what the record IS, not about what anyone remembered.
//
// The asymmetry argument in the original comment still holds and is preserved:
// calling a filing "press" understates it, while calling a headline a "record"
// tells the client a document exists that they can go and read when it does
// not. That is why 'intelligence' returns false EXPLICITLY rather than falling
// through, and why an unknown stream still has to earn RECORD through the
// legacy list below rather than defaulting to it.
type Stream = string | null | undefined;

// LEGACY ONLY. 487 rows in the corpus predate the stream column and carry null.
// This list exists for them and must not grow: a new adapter sets a stream, and
// a source added here instead would reintroduce exactly the failure above.
const LEGACY_RECORD_SOURCES = new Set([
  'legistar', 'agenda-portal', 'clark-tab', 'cftod-pdf', 'ceqanet', 'canadabuys',
  'tedeu', 'uktenders', 'iadb', 'worldbank', 'adb', 'afdb', 'undp', 'nepa_jm',
  'cayman_cpa', 'sfwmd',
  // Tender portals that were missing, found by auditing the corpus rather than
  // by noticing a bad document: 41 null-stream rows from these four render as
  // [PRESS] under the old list, and a tender notice is a filing by any reading.
  'tenderned', 'austender', 'ungm', 'gebiz',
]);

// Job boards are deliberately absent from that list and stay PRESS. An employer
// advertising a role is evidence a project exists; it is not a filing, and a
// client clicking through must not be told it was one.

export function isFiling(
  source: string | null | undefined,
  sourceType?: string | null,
  stream?: Stream
): boolean {
  // The stream is the answer whenever the row has one.
  if (stream === 'government' || stream === 'opportunity') return true;
  if (stream === 'intelligence') return false;
  // No stream: a legacy row. It has to earn RECORD.
  if (source && LEGACY_RECORD_SOURCES.has(source)) return true;
  if (sourceType && /agenda|filing|tender|permit|ordinance|resolution/i.test(sourceType)) return true;
  return false;
}

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
      const rec = ctx.records.find((r) => r.project_id === p.id);
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

// PER-MARKET CAP, AND IT IS STATED.
//
// This section listed the first 25 projects in each market and said nothing
// about the rest. A JKR report whose cover read "149 projects" listed 122 of
// them: 19 Clark County projects and 8 Las Vegas ones vanished between the
// basis line and the list, with no note anywhere in the document. A reader
// counting the entries would find the cover wrong, and a reader trusting the
// list would think their market had 25 live projects in it.
//
// The cap itself is worth keeping - a section listing 800 projects is not a
// section a person reads - so what changes is that the document now says what
// it left out, per market, in the same breath as the count on the cover.
const MARKET_LIST_CAP = 25;

const byMarket: SectionDef = {
  id: 'markets',
  label: 'By market',
  description: `Every project grouped by market, up to ${MARKET_LIST_CAP} per market, with the remainder counted.`,
  build: (ctx) => {
    const groups = new Map<string, Project[]>();
    for (const p of ctx.projects) {
      const k = p.market ?? p.region_state ?? 'Unassigned';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    const lines: Line[] = [];
    const truncated: { market: string; listed: number; total: number }[] = [];
    for (const [market, ps] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      if (ps.length > MARKET_LIST_CAP) {
        truncated.push({ market, listed: MARKET_LIST_CAP, total: ps.length });
      }
      // WITHIN A MARKET, MOST SIGNIFICANT FIRST. The cap means this decides
      // WHICH projects a market shows, not merely their order, so ordering by
      // anything else silently drops the important ones.
      ps.sort((a, b) => (b.significance ?? -1) - (a.significance ?? -1));
      for (const p of ps.slice(0, MARKET_LIST_CAP)) {
        const rec = ctx.records.find((r) => r.project_id === p.id);
        lines.push(
          rec
            ? lineForRecord(rec, `${market} | ${p.name}: `)
            : // A project with no record in the period still belongs in a
              // by-market list, but it has nothing to cite, so it is an
              // assessment of our own register rather than a record.
              commentaryLines(`${market} | ${p.name} (${p.stage ?? 'no stage'}), no filing in this period`)[0]
        );
      }
    }
    const held = truncated.reduce((n, t) => n + (t.total - t.listed), 0);
    return withCommentary('markets', ctx, {
      id: 'markets',
      title: 'By market',
      lede: `Every project in scope, grouped by market, up to ${MARKET_LIST_CAP} per market.`,
      lines,
      emptyNote:
        lines.length === 0
          ? 'No projects in scope.'
          : held > 0
            ? `${lines.length} of ${ctx.projects.length} projects are listed individually above. ` +
              `${held} further project${held === 1 ? ' is' : 's are'} in scope and counted on the cover but not listed here, ` +
              `because this section lists at most ${MARKET_LIST_CAP} projects per market: ` +
              truncated.map((t) => `${t.market} has ${t.total}`).join('; ') +
              (ctx.sectionIds.includes('appendix')
                ? '. The appendix below lists every record in scope, including theirs.'
                : '. Add the appendix section to list every record in scope, including theirs.')
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
  description: 'Projects flagged for watching.',
  build: (ctx) => {
    const watched = ctx.projects.filter((p) => p.watch);
    const lines = watched.map((p) => {
      const rec = ctx.records.find((r) => r.project_id === p.id);
      return rec
        ? lineForRecord(rec, `${p.name}: `)
        : commentaryLines(`${p.name} (${p.market ?? 'no market'}), watched, no filing in this period`)[0];
    });
    return withCommentary('watchlist', ctx, {
      id: 'watchlist',
      title: 'Watch list',
      lede: 'Projects being watched in this scope.',
      lines,
      emptyNote: lines.length === 0 ? 'No projects in this scope are on the watch list.' : undefined,
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
