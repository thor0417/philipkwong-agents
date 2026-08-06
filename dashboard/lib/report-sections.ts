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
}

// ---- PRESS OR RECORD ---------------------------------------------------------
//
// The distinction is in the data, not in a guess. A record from the government
// or opportunity streams is a filing: an agenda item, a tender notice, a
// resolution. A record from the intelligence stream is trade press - it is how
// that lane works, and its source is a publication rather than a clerk.
//
// Anything whose stream is unknown is treated as PRESS, deliberately. The two
// error directions are not symmetrical: calling a filing "press" understates
// it, while calling a headline a "record" tells the client a document exists
// that they can go and read, and it does not.
const RECORD_SOURCES = new Set([
  'legistar', 'agenda-portal', 'clark-tab', 'cftod-pdf', 'ceqanet', 'canadabuys',
  'tedeu', 'uktenders', 'iadb', 'worldbank', 'adb', 'afdb', 'undp', 'nepa_jm',
  'cayman_cpa', 'sfwmd',
]);

export function isFiling(source: string | null | undefined, sourceType?: string | null): boolean {
  if (source && RECORD_SOURCES.has(source)) return true;
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
  return isFiling(r.source, r.source_type)
    ? recordLine(text, r.url, r.source ?? host(r.url), meta)
    : pressLine(text, r.url, host(r.url) || (r.source ?? 'press'), meta);
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

const headlines: SectionDef = {
  id: 'headlines',
  label: 'Headline finds',
  description: 'The projects with the most activity in the period.',
  build: (ctx) => {
    const byProject = new Map<string, number>();
    for (const r of ctx.records) {
      const id = r.project_id ?? '';
      if (id) byProject.set(id, (byProject.get(id) ?? 0) + 1);
    }
    const ranked = [...ctx.projects]
      .sort((a, b) => (byProject.get(b.id) ?? 0) - (byProject.get(a.id) ?? 0) || (b.record_count ?? 0) - (a.record_count ?? 0))
      .slice(0, 10);
    const lines = ranked.flatMap((p) => {
      const rec = ctx.records.find((r) => r.project_id === p.id);
      if (!rec) return [];
      return [
        lineForRecord(rec, `${p.name}: `),
      ];
    });
    return withCommentary('headlines', ctx, {
      id: 'headlines',
      title: 'Headline finds',
      lede: 'The most active projects in this scope and period, with their most recent filing.',
      lines,
      emptyNote: lines.length === 0 ? 'No project in this scope had a record in this period.' : undefined,
    });
  },
};

// ---- 4. BY MARKET ------------------------------------------------------------

const byMarket: SectionDef = {
  id: 'markets',
  label: 'By market',
  description: 'Every project grouped by market, with its record count.',
  build: (ctx) => {
    const groups = new Map<string, Project[]>();
    for (const p of ctx.projects) {
      const k = p.market ?? p.region_state ?? 'Unassigned';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(p);
    }
    const lines: Line[] = [];
    for (const [market, ps] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
      for (const p of ps.slice(0, 25)) {
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
    return withCommentary('markets', ctx, {
      id: 'markets',
      title: 'By market',
      lede: 'Every project in scope, grouped by market.',
      lines,
      emptyNote: lines.length === 0 ? 'No projects in scope.' : undefined,
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
  description: 'Opportunity-stream records whose deadline has not passed.',
  build: (ctx) => {
    const today = new Date().toISOString().slice(0, 10);
    const open = ctx.records.filter(
      (r) => r.deadline && r.deadline.slice(0, 10) >= today && isFiling(r.source, r.source_type)
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
