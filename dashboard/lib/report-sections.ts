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
  evidenceAdds,
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
import { categoriesForPipeline, classifyStageTransition } from './taxonomy';
import { frozenMarketSentence, monthYear, type DeadFeed } from '../../lib/dead-feeds';
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
  // Dropped for having had no heartbeat inside the liveness window. Counted as
  // well as named: the coverage note stated the reason for years and never the
  // number, which tells a reader a rule fired without telling them how hard.
  excludedDormant: number;
  // DROPPED BECAUSE THE CLIENT HAS NOT CONFIRMED THEM.
  //
  // The newest exclusion rule and, until now, the only one computed and printed
  // nowhere. It shipped live on two clients: JKR generated a document covering 0
  // projects with no sentence saying why, and Simtec withheld 10 in silence.
  // Both are standing rule 3 broken by the rule that was supposed to enforce it.
  //
  // NULL IS NOT ZERO, and the distinction is the same one client-projects makes.
  // Zero means every project the scope proposed was confirmed. Null means the
  // gate did not run - no client id, or migration 033 unapplied - and there is
  // nothing to state. See membershipGate below and lib/report-build.
  unconfirmedMembers: number | null;
  // Which of the three outcomes the gate had. A document may only claim its
  // contents were confirmed when confirmation actually ran.
  membershipGate: 'enforced' | 'no-client' | 'not-applied';
  // The client this document is for, so the membership sentence can name them.
  // Null for an internal or unassigned document.
  clientName: string | null;
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
  // EXCLUDED BECAUSE THEIR MARKET STOPPED PUBLISHING. Held with the declaration
  // that caused it rather than as a count, because the sentence a client reads
  // has to carry the freeze date: "we do not cover San Antonio" and "we covered
  // San Antonio until September 2021" are different facts and only the second
  // one is true. See lib/dead-feeds.
  frozenExcluded: { project: Project; feed: DeadFeed }[];
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
  // Projects described above whose stored one-line summary is a model's
  // reading rather than a quotation, and is therefore not printed. See
  // capNotes: a withheld sentence is absence and is counted like any other.
  withheldSummaries: number;
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
 * The frozen markets this document lost projects in, grouped and counted.
 *
 * Grouped rather than listed per project because the fact is about the market:
 * three separate Miami-Dade lines would read as three separate problems.
 */
export function frozenByFeed(ctx: SectionContext): { feed: DeadFeed; projects: number }[] {
  const byMarket = new Map<string, { feed: DeadFeed; projects: number }>();
  for (const { feed } of ctx.frozenExcluded) {
    const cur = byMarket.get(feed.market);
    if (cur) cur.projects++;
    else byMarket.set(feed.market, { feed, projects: 1 });
  }
  return [...byMarket.values()].sort(
    (a, b) => b.projects - a.projects || a.feed.market.localeCompare(b.feed.market)
  );
}

/** 'San Antonio' / 'Miami-Dade County and San Antonio', for the cover sentence. */
function frozenMarketsNamed(ctx: SectionContext): string {
  const names = frozenByFeed(ctx).map((f) => f.feed.market);
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
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
export function capNotes(caps: SectionContext['caps'], withheldSummaries = 0): string[] {
  const out: string[] = [];
  if (withheldSummaries) {
    out.push(
      `${withheldSummaries} project${withheldSummaries === 1 ? '' : 's'} described above ` +
        `${withheldSummaries === 1 ? 'has' : 'have'} a one-line description on our register that is ` +
        `not printed here. Those lines were written by a model reading the filings rather than ` +
        `quoted from one, so there is no document to cite for them and they are not offered as ` +
        `Philip's assessment either. The filings under each entry are unaffected.`
    );
  }
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

/**
 * "JKR & Associates'", not "JKR & Associates's".
 *
 * The client's own name is the most conspicuous word on the page it appears on,
 * and a client reading their name misspelled in a document they paid for stops
 * reading the sentence it is in. Both live clients end in s.
 */
export function possessive(name: string): string {
  return /s$/i.test(name.trim()) ? `${name.trim()}'` : `${name.trim()}'s`;
}

// ---- WHAT THE MEMBERSHIP GATE HELD BACK --------------------------------------
//
// THE NEWEST EXCLUSION RULE, AND THE ONE THAT WAS PRINTED NOWHERE.
//
// Every other rule in this file removes projects that are in some way not worth
// printing: dormant, hollow, unnamed, frozen. This one removes projects that are
// perfectly printable and have simply not been approved yet, which makes it the
// exclusion most likely to be mistaken for an empty market. A client whose
// document lost every project to it read a report about nothing and was given no
// way to tell that from a quarter in which nothing was filed.
//
// It is one sentence, produced once and printed twice: on the cover next to the
// numbers a reader has to reconcile, and in the coverage note beside the other
// limits. Two call sites and one string, so the two pages cannot come apart.
export function membershipSentence(ctx: SectionContext): string | null {
  const n = ctx.unconfirmedMembers;
  if (ctx.membershipGate !== 'enforced' || n === null || n <= 0) return null;
  const one = n === 1;
  const whose = ctx.clientName ? `${possessive(ctx.clientName)} coverage` : 'this coverage';
  return (
    `${n} project${one ? '' : 's'} this scope proposes ${one ? 'is' : 'are'} held out of this ` +
    `document because ${one ? 'it has' : 'they have'} not been confirmed as part of ${whose}. ` +
    `A scope is a proposal: it finds projects that look like a match, and each one is confirmed ` +
    `by hand on the register before it may be printed. ${one ? 'That project is' : 'Those projects are'} ` +
    `on the register, unconfirmed, and ${one ? 'is' : 'are'} not a statement that ${one ? 'it does' : 'they do'} ` +
    `not belong here.`
  );
}

/**
 * A DOCUMENT EXCLUDED TO NOTHING SAYS SO, IN ONE SENTENCE A READER CANNOT MISS.
 *
 * Every count on the cover is a count of something removed, and each one reads
 * as a footnote when the number of things remaining is not zero. When it IS
 * zero, the footnotes are the whole document and a reader who skims the first
 * line learns that a report exists rather than that it is empty and why.
 *
 * So this leads the cover, ahead of the geography and the period, and it names
 * the rules that emptied it in the order the builder applies them. It is not the
 * arithmetic: the counts follow in the sentence after it. It is the one line
 * that stops an empty document from reading as a quiet market.
 */
export function emptyDocumentSentence(ctx: SectionContext): string | null {
  if (ctx.projects.length > 0) return null;
  const reasons: string[] = [];
  if (ctx.frozenExcluded.length) reasons.push(`${ctx.frozenExcluded.length} to markets whose source has stopped publishing`);
  if (ctx.excludedDormant) reasons.push(`${ctx.excludedDormant} to dormancy`);
  if (ctx.excludedHollow) reasons.push(`${ctx.excludedHollow} to holding no live record`);
  if (ctx.membershipGate === 'enforced' && ctx.unconfirmedMembers) {
    reasons.push(
      `${ctx.unconfirmedMembers} to awaiting confirmation as part of ` +
        `${ctx.clientName ? possessive(ctx.clientName) : "this client's"} coverage`
    );
  }
  if (ctx.provisionalExcluded.length) reasons.push(`${ctx.provisionalExcluded.length} to having no published name we could print`);
  return (
    `THIS DOCUMENT DESCRIBES NO PROJECTS. ` +
    (reasons.length
      ? `Its scope was not empty: ${reasons.join(', ')}. Every one of those rules is stated below ` +
        `with its count. `
      : `Its scope resolved to nothing at all: no project in our register matched this geography, ` +
        `period and filter set. `) +
    `Read this as our coverage of ${ctx.geographyLabel} being withheld rather than as ` +
    `${ctx.geographyLabel} being quiet. We are not saying nothing was filed.`
  );
}

// ---- 1. COVER ----------------------------------------------------------------

const cover: SectionDef = {
  id: 'cover',
  label: 'Cover',
  description: 'Title, addressee, period and the scoping statement.',
  build: (ctx) => {
    // Built once and read twice below: the lead paragraph is what an empty
    // document opens with, and it is also what decides whether there is one.
    const emptied = emptyDocumentSentence(ctx);
    const unconfirmed = membershipSentence(ctx);
    return withCommentary('cover', ctx, {
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
        // AHEAD OF EVERYTHING, AND ONLY WHEN THERE IS NOTHING. Its own paragraph
        // rather than a clause, because commentaryLines splits on the blank line
        // and the renderer puts each paragraph on its own row: a sentence buried
        // mid-paragraph is exactly the sentence a reader skims past.
        (emptied ? `${emptied}\n\n` : '') +
          `This report covers ${ctx.geographyLabel} for ${ctx.periodLabel}. ` +
          // THE SELECTION ARITHMETIC ONLY EXISTS WHEN THERE IS SOMETHING TO
          // SELECT FROM. "It is drawn from 0 projects. Of those projects, 0 are
          // described in full, selected by significance" is what an emptied
          // document said, and a sentence describing how nothing was ranked
          // reads as a template running rather than as a document. The counts of
          // what was EXCLUDED still follow, because those are the real content
          // of an empty document.
          (emptied
            ? `It draws on no project and no record. What follows is the account of why. `
            : `It is drawn from ${ctx.projects.length} project${ctx.projects.length === 1 ? '' : 's'} ` +
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
              `. `) +
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
          // ON THE COVER TOO, AND NAMING THE MARKETS. The other exclusions are a
          // number on the cover and a reason in the coverage note, because the
          // reader's question is "does this add up". This one is different: a
          // client whose scope includes San Antonio is not asking whether the
          // arithmetic works, they are asking whether they are covered there.
          // That question has to be answerable on the first page.
          // Inflected on the PROJECT count and the MARKET count separately. They
          // are different numbers and one sentence needs both.
          (ctx.frozenExcluded.length
            ? `${ctx.frozenExcluded.length} project${ctx.frozenExcluded.length === 1 ? '' : 's'} in ` +
              `${frozenMarketsNamed(ctx)} ${ctx.frozenExcluded.length === 1 ? 'is' : 'are'} held out entirely: ` +
              `the public source we read for ${frozenByFeed(ctx).length === 1 ? 'that market' : 'those markets'} ` +
              `has stopped publishing, so what we hold is historical. The coverage note gives the dates. `
            : '') +
          // THE MEMBERSHIP EXCLUSION, ON THE COVER, FOR THE SAME REASON THE
          // FROZEN ONE IS. The other counts answer "does this add up". This one
          // answers "why is my report shorter than my coverage", and the answer
          // is a manual step nobody has taken rather than anything about the
          // projects, so it has to be on the first page where it can be acted on.
          (unconfirmed ? `${unconfirmed} ` : '') +
          `Anything outside that geography or period is not covered here.`
      ),
    });
  },
};

// ---- 2. WHAT MOVED -----------------------------------------------------------

/** First letter up, for a note assembled from clauses. */
function capitalise(s: string): string {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}


const whatMoved: SectionDef = {
  id: 'moved',
  label: 'What moved',
  description: 'Stage changes inside the period, most advanced first.',
  build: (ctx) => {
    const stageChanges = ctx.events.filter((e) => e.event_type === 'stage_changed');

    // ONLY AN ADVANCE IS A MOVEMENT. See classifyStageTransition: a step down
    // the ladder is us revising a reading, and a step into stalled or dormant is
    // a verdict about silence. Neither is something that happened, and printing
    // them here told a reader that Heart Hotel had stalled three weeks after
    // Clark County approved it.
    const advanced = stageChanges.filter(
      (e) => classifyStageTransition(e.from_value, e.to_value) === 'advanced'
    );
    const corrected = stageChanges.filter(
      (e) => classifyStageTransition(e.from_value, e.to_value) === 'corrected'
    );
    const liveness = stageChanges.filter(
      (e) => classifyStageTransition(e.from_value, e.to_value) === 'liveness'
    );

    const lines = advanced.map((e) =>
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

    // NOTHING IS SILENTLY ABSENT, so what was withheld is counted and named for
    // what it is. A reader who wonders why a project they know changed is not
    // here gets the answer instead of the impression that nothing happened.
    const withheld: string[] = [];
    if (unsourced > 0) {
      withheld.push(
        `${unsourced} advance${unsourced === 1 ? '' : 's'} had no linkable source record and ${unsourced === 1 ? 'is' : 'are'} not listed`
      );
    }
    if (corrected.length > 0) {
      withheld.push(
        `${corrected.length} stage${corrected.length === 1 ? '' : 's'} moved DOWN the ladder, which is this system revising an earlier reading rather than a project going backwards, so ${corrected.length === 1 ? 'it is' : 'they are'} not listed as movement`
      );
    }
    if (liveness.length > 0) {
      withheld.push(
        `${liveness.length} project${liveness.length === 1 ? '' : 's'} moved into or out of stalled or dormant, which is a verdict about how long a source has been quiet rather than something that happened`
      );
    }

    return withCommentary('moved', ctx, {
      id: 'moved',
      title: 'What moved',
      lede: 'Projects that advanced a stage in this period.',
      lines: sourced,
      emptyNote:
        sourced.length === 0
          ? `No project in this scope advanced a stage during ${ctx.periodLabel}.` +
            (withheld.length ? ` ${capitalise(withheld.join('; '))}.` : '')
          : withheld.length
            ? `${capitalise(withheld.join('; '))}.`
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
    // FIRST OF THE EXCLUSIONS, BECAUSE IT QUALIFIES THE TWO SENTENCES ABOVE IT.
    //
    // Every other note in this section says which projects were left out of a
    // geography we cover. This one says a geography we claim to cover is not
    // being read at all, which is a limit on the coverage statement rather than
    // on the selection, and a reader who stops after three sentences must have
    // had it.
    const frozen = frozenByFeed(ctx);
    if (frozen.length) {
      notes.push(frozenMarketSentence(frozen));
      // The freeze date twice over: once inside the sentence above as a month,
      // and once here per market with what we still hold, because a client whose
      // scope names one of these markets will want to know whether the gap is
      // last quarter or last decade.
      for (const { feed, projects } of frozen) {
        notes.push(
          `On ${feed.market}: the last filing we hold is from ${monthYear(feed.frozenSince)}, and we ` +
            `have captured nothing there since. The ${projects} project${projects === 1 ? '' : 's'} ` +
            `concerned ${projects === 1 ? 'is' : 'are'} on the register with that date against ` +
            `${projects === 1 ? 'it' : 'them'}. We are not able to say what has been filed in ` +
            `${feed.market} since then, and this document should not be read as saying nothing has.`
        );
      }
    }
    // THE REASON AND THE COUNT. The reason alone was here for as long as this
    // section has existed, and it is half a statement: a reader learns a rule
    // fired without learning whether it removed one project or forty.
    if (!ctx.includeDormant) {
      notes.push(
        ctx.excludedDormant
          ? `${ctx.excludedDormant} project${ctx.excludedDormant === 1 ? '' : 's'} in this geography ` +
            `${ctx.excludedDormant === 1 ? 'is' : 'are'} dormant and excluded from this report: ` +
            `${ctx.excludedDormant === 1 ? 'it has' : 'they have'} had no filing for long enough that we ` +
            `no longer treat ${ctx.excludedDormant === 1 ? 'it' : 'them'} as live. ` +
            `${ctx.excludedDormant === 1 ? 'It remains' : 'They remain'} on the register.`
          : 'Dormant projects are excluded from this report. None in this geography is dormant.'
      );
    }
    if (!ctx.includeContext) notes.push('Context records that support a finding without being about it are excluded.');
    if (ctx.watchlistOnly) notes.push('This report is restricted to watch-listed projects.');
    // ---- CONFIRMED MEMBERSHIP, IN ALL THREE OF ITS STATES ------------------
    //
    // The gate has three outcomes and each is a different statement to a reader,
    // so each gets its own sentence rather than one sentence and two silences.
    // Stating only the first would leave a document built with the gate switched
    // off looking identical to one where everything had been approved, which is
    // the same conflation of "nothing confirmed" with "confirmation not running"
    // that lib/client-projects exists to keep apart.
    const unconfirmedNote = membershipSentence(ctx);
    if (unconfirmedNote) {
      notes.push(
        `${unconfirmedNote} Confirming ${ctx.unconfirmedMembers === 1 ? 'it' : 'them'} on the ` +
          `register and regenerating is what puts ${ctx.unconfirmedMembers === 1 ? 'it' : 'them'} in ` +
          `this document.`
      );
    } else if (ctx.membershipGate === 'enforced') {
      notes.push(
        `Every project this scope proposed has been confirmed as part of ` +
          `${ctx.clientName ? possessive(ctx.clientName) : 'this'} coverage, so nothing is held out of ` +
          `this document awaiting confirmation.`
      );
    } else if (ctx.membershipGate === 'not-applied') {
      notes.push(
        `Client confirmation is not switched on for this document, so what it covers is what the ` +
          `scope proposed rather than what has been confirmed by hand. Nothing has been held out on ` +
          `that ground, and nothing above should be read as having been approved individually.`
      );
    } else {
      notes.push(
        `This document is not tied to a client, so no confirmation step applies to it: it covers ` +
          `what the scope resolves to. Nothing is held out awaiting confirmation.`
      );
    }
    // THE SELECTION IS A LIMIT ON THE DOCUMENT, so it belongs in the list of
    // the document's limits and not only on the cover. A reader who reaches
    // this section without having read the cover still learns that what they
    // have is the top of a longer list.
    // A CAP CANNOT SELECT FROM AN EMPTY SET, AND MUST NOT CLAIM TO HAVE. On the
    // emptied document this read "This document describes the 15 most
    // significant projects in scope. Every project in scope is described." over
    // nothing at all, which is two false sentences in a row in the one section
    // whose whole job is to be true about what is missing.
    notes.push(
      ctx.projects.length === 0
        ? `No project reached this document, so nothing was selected for description. The ` +
          `exclusions above account for the whole of this scope.`
        : `This document describes the ${ctx.detailCap} most significant projects in scope. ` +
          (ctx.undetailedProjects.length
            ? `${ctx.undetailedProjects.length} further project${ctx.undetailedProjects.length === 1 ? '' : 's'} ` +
              `in scope ${ctx.undetailedProjects.length === 1 ? 'is' : 'are'} counted but not described.`
            : 'Every project in scope is described.')
    );
    notes.push(...capNotes(ctx.caps, ctx.withheldSummaries));
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

// ---- THE REFERRAL COVER ------------------------------------------------------
//
// A BRIEF IS NOT A REPORT ABOUT A GEOGRAPHY OF ONE.
//
// The referral section set opened with the market report's own cover, and every
// sentence in it was written for a document that selects projects out of a
// market. On Heart Hotel it produced, in order: "GEOGRAPHY one project", "Of
// those projects, 1 is described in full, selected by significance", and "covers
// one project for July 2026" above a period line reading every record held since
// April. Three statements about a selection process that did not happen: nothing
// was selected, nothing was ranked, and no period was applied - a brief is
// deliberately not period-scoped, which is why the cover's own period line reads
// the record span instead. The scoping was right and every sentence describing
// it was wrong.
//
// So the referral gets its own cover, and it answers the questions a referral
// reader actually has: what matter is this, on whose record, over what span, and
// what is NOT in here.
const referralCover: SectionDef = {
  id: 'referral-cover',
  label: 'Cover (referral)',
  description: 'What this brief is about, on what record, and what it is not.',
  build: (ctx) => {
    const e = soleEntry(ctx);
    const filings = e ? e.records.filter((r) => r.provenance === 'RECORD').length : 0;
    const press = e ? e.records.filter((r) => r.provenance === 'PRESS').length : 0;
    // THE SPAN OF WHAT IS HELD, NOT A PERIOD FILTER. buildReport already prints
    // this on the document's own scope block for exactly the same reason; saying
    // "July 2026" here over records reaching back to April is the document
    // describing a filter it did not apply.
    const dates = (e?.records ?? [])
      .map((r) => r.date)
      .filter((d): d is string => !!d)
      .sort();
    const span =
      dates.length === 0
        ? 'None of them carries a date'
        : dates[0] === dates[dates.length - 1]
          ? `All of them dated ${dates[0]}`
          : `Dated between ${dates[0]} and ${dates[dates.length - 1]}`;
    return withCommentary('referral-cover', ctx, {
      id: 'referral-cover',
      title: 'About this brief',
      lede: 'One matter, the record behind it, and the limits of that record.',
      lines: commentaryLines(
        e
          ? `This is a referral brief on ${e.name}${e.meta ? ` in ${e.meta.split('|')[0].trim()}` : ''}. ` +
            `It is about that one matter and is written to be forwarded to someone who will act on ` +
            `it, so it is not scoped to a period: it sets out everything we hold. ` +
            `That is ${filings} captured filing${filings === 1 ? '' : 's'} and ` +
            `${press} press report${press === 1 ? '' : 's'}, ${span.charAt(0).toLowerCase()}${span.slice(1)}. ` +
            `The filings are what we can show you and each carries the link to the document itself. ` +
            `The press is reported elsewhere, attributed to its publisher, and is not our record. ` +
            `Any judgement in this brief is Philip's, is labelled as his, and appears only under a ` +
            `heading that says so.`
          : `A referral brief is about one matter. This document has ` +
            `${ctx.entries.length === 0 ? 'no project selected' : `${ctx.entries.length} projects in scope`}, ` +
            `so there is nothing to brief on. Choose a single project in the composer.`
      ),
    });
  },
};

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

    const subsections: Subsection[] = [];
    subsections.push({
      title: 'Record provenance (our captured filings)',
      lines: filings.map(recordLineFor),
      emptyNote:
        filings.length === 0
          ? 'We hold no captured filing for this project. Everything below is press-sourced.'
          : undefined,
    });
    // DESIGN AND PROGRAM, THE JULY BRIEF'S OWN SECTION, and the one the generated
    // brief did not have. The reader of a referral wants the shape of the thing -
    // how many rooms, how tall, what it cost - and until now that was scattered
    // across fifteen press lines whose headlines carry no numbers at all.
    //
    // IT SITS BETWEEN THE TWO PROVENANCE SUBSECTIONS DELIBERATELY. Above it are
    // the filings; below it are the press reports these figures were read out of.
    // A [PRESS] figure printed between them cannot be mistaken for something the
    // county filed, and each line carries the article link so the reader can go
    // and check the number rather than take it.
    // WHAT THE FILINGS STATE, directly under the filings that state it and above
    // the press. The July brief put the record provenance first and the
    // press-reported programme after it, and this is the same order for the same
    // reason: a reader weighs the county's own numbers before a newspaper's.
    if (e.stated.length) {
      subsections.push({
        title: 'Stated in the filings',
        lines: e.stated.map((f) => {
          // ONE RULE, IN ONE PLACE. This was a second copy of the text
          // renderer's test and it passed the case the renderer passed:
          // Zone quoting itself. See report-model/evidenceAdds.
          // The document's own value often ends its own sentence; a second full
          // stop reads as a typo.
          const stop = /[.!?]$/.test(f.display) ? '' : '.';
          const head = `${f.label}: ${f.display}${stop}`;
          const adds = evidenceAdds(f.label, f.display, f.sentence);
          return recordLine(adds ? `${head} "${f.sentence}"` : head, f.url, f.sourceLabel);
        }),
        emptyNote:
          e.statedHeld > 0
            ? `${e.statedHeld} further stated figure${e.statedHeld === 1 ? '' : 's'} held back ` +
              `to keep this list readable.`
            : undefined,
      });
    }
    if (e.scale.length) {
      subsections.push({
        title: 'Design and program (press-reported)',
        // The figure, then the sentence the publication printed it in. Both, on
        // one line, because a Line is one string and the quotation is what says
        // what the number is for: "amount reported: $70 million" alone would let
        // a reader take a land price for a development cost.
        lines: e.scale.map((f) =>
          pressLine(`${f.label}: ${f.display}. "${f.sentence}"`, f.url, f.sourceLabel)
        ),
        emptyNote:
          e.scaleHeld > 0
            ? `${e.scaleHeld} further reported figure${e.scaleHeld === 1 ? '' : 's'} held back ` +
              `to keep this list readable.`
            : undefined,
      });
    }
    // THE PRESS HEADLINES ARE NOT IN THIS SECTION ANY MORE. See referralPress
    // below: fifteen of them sat between the filings and THE PEOPLE and pushed
    // the parties onto page 3 of a three-page document. In a referral the
    // parties are the reason the document is being forwarded.

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

// ---- WHAT THE APPROVAL IS CONDITIONAL ON -------------------------------------
//
// THE BLOCK THE EXCLUSION COMMENT PROMISED. See report-entry/conditionsOf and
// the note on FILING_FACT_EXCLUDED: conditions were read out of the staff
// reports, verified against them, stored, then excluded from the figure list by
// name with a comment saying they got their own block, and the block did not
// exist. Thirty-six conditions on Heart Hotel reached no page of any document.
//
// THIRD, AFTER THE PROJECT AND THE PEOPLE. A referral is forwarded to somebody
// who will act on the matter, and "approved" against "approved subject to a
// decommissioning bond, an FAA no-hazard determination, a Performance Agreement
// and no east-facing balconies" is the difference between a document that is
// worth forwarding and one that is not.
//
// ONE SUBSECTION PER MATTER. Never one merged list: see conditionsOf.
const referralConditions: SectionDef = {
  id: 'referral-conditions',
  label: 'Conditions of approval (referral)',
  description: 'Every condition the filings attach, quoted, grouped by the matter that carries it.',
  build: (ctx) => {
    const e = soleEntry(ctx);
    const sets = e?.conditions ?? [];
    const total = sets.reduce((n, s) => n + s.conditions.length, 0);
    const subsections: Subsection[] = sets.map((s) => ({
      title: `${s.matter}${s.date ? ` (${s.date})` : ''}: ${s.conditions.length} condition${s.conditions.length === 1 ? '' : 's'}`,
      // NUMBERED, because a condition is referred to by its number in every
      // conversation that follows, and QUOTED, because a paraphrased condition
      // is a claim about what a public body required.
      lines: s.conditions.map((text, i) => recordLine(`${i + 1}. ${text}`, s.url, s.sourceLabel)),
      emptyNote:
        s.held > 0
          ? `${s.held} further condition${s.held === 1 ? '' : 's'} on this matter ${s.held === 1 ? 'is' : 'are'} in the document and not printed here.`
          : undefined,
    }));
    return withCommentary('referral-conditions', ctx, {
      id: 'referral-conditions',
      title: 'Conditions of approval',
      lede:
        sets.length > 1
          ? `${total} conditions across ${sets.length} concurrent matters. Each set binds its own application.`
          : 'Quoted from the filing. Each condition binds the application it is listed under.',
      lines: [],
      subsections,
      // NOTHING IS SILENTLY ABSENT, and an absence here is a real finding: it
      // means either the approval was unconditional or we have not read the
      // conditions out of the document. Those are different, and the sentence
      // says which one we can support.
      emptyNote:
        total === 0
          ? 'We have read no conditions out of the filings we hold for this matter. That is a ' +
            'statement about our capture, not a statement that the approval is unconditional: ' +
            'check the staff report linked under the filings above before relying on it.'
          : undefined,
    });
  },
};

// ---- WHAT WAS REPORTED ELSEWHERE ---------------------------------------------
//
// ITS OWN SECTION, AFTER THE PEOPLE, AND THAT IS THE WHOLE POINT OF THE SPLIT.
//
// These fifteen headlines were a subsection of "The project", between the
// filings and everything else, so on Heart Hotel THE PEOPLE landed on page 3 of
// a three-page brief, under fifteen press lines. In a referral the parties are
// the reason the document is being forwarded at all: somebody is going to call
// one of them. Press is context and belongs after the thing it is context for.
const referralPress: SectionDef = {
  id: 'referral-press',
  label: 'Reported beyond our record (referral)',
  description: 'What publications have reported, attributed to them and separated from our filings.',
  build: (ctx) => {
    const e = soleEntry(ctx);
    const press = (e?.records ?? []).filter((r) => r.provenance === 'PRESS');
    return withCommentary('referral-press', ctx, {
      id: 'referral-press',
      title: 'Reported beyond our record',
      lede: 'Press coverage, attributed to its publisher. This is not our filing record.',
      lines: press.map(recordLineFor),
      emptyNote:
        press.length === 0
          ? 'We hold no press coverage of this matter. Everything above is from the filings.'
          : undefined,
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
  referralCover,
  referralProject,
  referralPeople,
  referralConditions,
  referralPress,
  referralOpportunity,
  referralRisk,
];

// THE REFERRAL BRIEF, IN THE JULY ORDER. See the section definitions above.
//
// The two assessment sections are in the set on purpose, even though they
// usually render nothing: their presence in the composer's section list is what
// puts a commentary box in front of Philip for each of them. A section he
// cannot see is a section he will not write.
// THE ORDER IS THE ARGUMENT THE DOCUMENT MAKES: what the matter is, who is
// behind it, what the approval is conditional on, what has been said about it
// elsewhere, and then Philip's read of it. The people used to be fourth by the
// time fifteen press headlines had been printed inside the project section, and
// press used to be the thing a reader met before the parties.
export const REFERRAL_SECTION_IDS = [
  'referral-cover',
  'referral-project',
  'referral-people',
  'referral-conditions',
  'referral-press',
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
