'use client';

// THE VOCABULARY.
//
// The design system documents tokens, and tokens were never the confusing part.
// Half a working session was lost to two labels that read as one thing and
// filtered on another, and the cost of that is not the half day - it is that
// afterwards you do not fully trust any control on the screen, because you have
// learned that a label can be wrong.
//
// So every word the product uses is written down once, with the column or rule
// behind it. THE POINT IS THE SECOND COLUMN: a term with no definition is a term
// two people can use differently for a month before anyone notices.
//
// EVERY LIST HERE IS READ FROM THE CODE THAT ENFORCES IT. The stages come from
// lib/taxonomy, the axes from lib/period, the coverage states from lib/coverage.
// A vocabulary page maintained by hand is a vocabulary page that is wrong by the
// end of the month, and being wrong is the exact failure it exists to fix.

import Link from 'next/link';
import { PROJECT_STAGES, STAGE_LADDER } from '@/lib/taxonomy';
import { PERIOD_AXES } from '@/lib/period';
import { STREAM_LABELS } from '@/lib/streams';
import { COVERAGE_LABEL, STALE_DAYS, THIN_NAMED_SHARE } from '../../../../lib/coverage';
import styles from './page.module.css';

interface Term {
  term: string;
  means: string;
}

const OBJECTS: Term[] = [
  {
    term: 'Record',
    means:
      'One captured document: an agenda item, a filing, a permit, a tender notice, a press story. The row in leads.',
  },
  {
    term: 'Project',
    means:
      'A site or a scheme, made of records that the clusterer decided are about the same thing. The row in projects. It has a timeline; a record does not.',
  },
  {
    term: 'Opportunity',
    means:
      'A deadline-bound thing that dies on its deadline. The other half of the two-object model, and a different sense of the word from the retired "opportunity" stream.',
  },
  {
    term: 'Player',
    means:
      'A company or a person named on a filing. The row in companies, linked to projects through company_projects with a role.',
  },
  {
    term: 'Client',
    means:
      'Who the work is for. Carries a scope, which is a query, and - once migration 033 is applied - a confirmed list of projects.',
  },
  {
    term: 'Scope',
    means:
      'A client’s stated coverage, as an executable query rather than a note. An empty axis is NO constraint on that axis, never an empty result.',
  },
];

const PROVENANCE: Term[] = [
  {
    term: '[RECORD]',
    means:
      'A filing the client can open. From the government lane, or a legacy row whose source is on the filing list. See isFiling in lib/report-model.',
  },
  {
    term: '[TENDER]',
    means:
      'A solicitation with a deadline you can still bid into. A filing, split out on screen because it is a different object from a council resolution. Screens only: a document says RECORD.',
  },
  {
    term: '[PRESS]',
    means: 'Somebody reported it. Evidence a project exists; not a filing, and never presented as one.',
  },
  {
    term: '[ASSESSMENT]',
    means:
      'Philip’s read. In no document we hold. Can only be constructed through commentaryLines(), so it cannot be mislabelled even deliberately.',
  },
];

const DATES: Term[] = [
  {
    term: 'Captured',
    means:
      'When WE fetched the record. leads.first_seen. Says nothing about when the thing happened, and is never allowed to stand in for a publication date.',
  },
  {
    term: 'Published',
    means: 'The date the SOURCE put on the document. leads.published_date, or a deadline where there is one.',
  },
  {
    term: 'Last filed',
    means:
      'The newest published date across a project’s records. projects.last_activity. Was called "last activity", which read as "when we last did something".',
  },
  {
    term: 'First seen',
    means:
      'The OLDEST capture among a project’s records, written once on insert. When the project entered the corpus, not when anything happened to it.',
  },
  {
    term: 'Date unknown',
    means:
      'The record carries no source or parsed date, only a capture floor. Shown as a badge rather than quietly dated to the scrape.',
  },
];

const MEMBERSHIP: Term[] = [
  { term: 'proposed', means: 'The client’s scope matched it and nobody has looked yet.' },
  { term: 'included', means: 'Philip confirmed it. The only status a report may print.' },
  {
    term: 'excluded',
    means:
      'Philip looked and said no. A tombstone, never a deletion: deleting it would let the next scope resolution ask the same question forever.',
  },
];

const STATUS: Term[] = [
  { term: 'new', means: 'Captured and not yet triaged. The default for everything.' },
  { term: 'watchlist', means: 'Marked to follow. A flag, not a stage.' },
  { term: 'client_ready', means: 'Judged fit to go in front of a client.' },
  {
    term: 'dismissed',
    means:
      'Judged not worth carrying. Never deleted: Trash is a view, and restoring is the same write with a different value.',
  },
];

function Table({ rows, label }: { rows: Term[]; label: string }) {
  return (
    <dl className={styles.terms} aria-label={label}>
      {rows.map((r) => (
        <div key={r.term} className={styles.termRow} data-term={r.term}>
          <dt className={styles.term}>{r.term}</dt>
          <dd className={styles.means}>{r.means}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({
  n,
  title,
  note,
  children,
}: {
  n: string;
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.block}>
      <div className={styles.blockHead}>
        <span className={`${styles.blockNum} mono`}>{n}</span>
        <h2 className={styles.blockTitle}>{title}</h2>
      </div>
      {note && <p className={styles.note}>{note}</p>}
      {children}
    </section>
  );
}

export default function VocabularyPage() {
  const stageRows: Term[] = PROJECT_STAGES.map((s) => ({
    term: s,
    means: (STAGE_LADDER as readonly string[]).includes(s)
      ? 'On the ladder: a step a project climbs through, in this order.'
      : s === 'stalled'
        ? 'Off the ladder. Something stopped it, and a filing says so.'
        : 'Off the ladder. Nothing has happened for long enough that we stopped counting it as live.',
  }));

  const axisRows: Term[] = PERIOD_AXES.map((a) => ({ term: a.label, means: a.help }));

  const coverageRows: Term[] = [
    {
      term: COVERAGE_LABEL.live,
      means: 'An adapter is pointed at it, it is publishing, and its projects name parties.',
    },
    {
      term: COVERAGE_LABEL.degraded,
      means:
        'The adapter is failing in a known, written-down way. Declared in the known-degraded register with the condition that makes it alert again.',
    },
    {
      term: COVERAGE_LABEL.stale,
      means: `The source still answers and the newest document we hold from it is more than ${STALE_DAYS} days old. Not dead; the same shape of failure at an earlier stage.`,
    },
    {
      term: COVERAGE_LABEL.thin,
      means: `It captures and it clusters and it cannot name a party - fewer than ${Math.round(
        THIN_NAMED_SHARE * 100
      )}% of its projects name anybody - so a report scoped to it comes out empty.`,
    },
    {
      term: COVERAGE_LABEL.dead,
      means:
        'The source has published nothing for over a year, measured on the SOURCE rather than on our captures. Declared in lib/dead-feeds and withheld from client documents.',
    },
  ];

  const streamRows: Term[] = Object.entries(STREAM_LABELS).map(([id, label]) => ({
    term: label,
    means: `The capture lane, stored as "${id}". A fact about which of our adapters found a row, not about its subject - which is why the three lanes are no longer a place you navigate to.`,
  }));

  return (
    <main className={styles.page}>
      <header className={styles.pageHead}>
        <div>
          <h1 className={styles.pageTitle}>Vocabulary</h1>
          <p className={styles.lede}>
            Every term this product uses, with the column or rule behind it. The{' '}
            <Link href="/design">design system</Link> documents tokens, which were never the
            confusing part: half a working session was lost to two labels that read as one thing and
            filtered on another. Every list below is read from the code that enforces it, so this
            page cannot drift from the product.
          </p>
        </div>
      </header>

      <Block
        n="01"
        title="The objects"
        note="Six nouns. Everything else on every screen is a property of one of them."
      >
        <Table rows={OBJECTS} label="Objects" />
      </Block>

      <Block
        n="02"
        title="The two date axes"
        note="These are the two labels that cost the session. They are both dates, they are dates of DIFFERENT THINGS, and the old names - Arrived and Moved - described the project rather than the date. A view filtered on Captured can legitimately show a project last filed in 2024."
      >
        <Table rows={axisRows} label="Period axes" />
      </Block>

      <Block n="03" title="The dates themselves">
        <Table rows={DATES} label="Dates" />
      </Block>

      <Block
        n="04"
        title="Provenance"
        note="What a line or a record is, and whether a client can check it. Enforced in the type system and again by a gate that walks the whole document before it renders."
      >
        <Table rows={PROVENANCE} label="Provenance" />
      </Block>

      <Block
        n="05"
        title="The stages"
        note="Where a project has got to. The first six are a ladder and are ordered; the last two are off it."
      >
        <Table rows={stageRows} label="Stages" />
      </Block>

      <Block
        n="06"
        title="Coverage states"
        note="What a market actually is, as opposed to whether it is on a list. Each state is the WORST thing true of the market: a dead market is also stale and also thin, and saying thin about it would be true and useless."
      >
        <Table rows={coverageRows} label="Coverage states" />
      </Block>

      <Block
        n="07"
        title="Triage status"
        note="Philip's axis on a record or a project. Nothing here is a deletion."
      >
        <Table rows={STATUS} label="Status" />
      </Block>

      <Block
        n="08"
        title="Client membership"
        note="The scope proposes; Philip confirms. Only what he confirmed can be printed. Requires migration 033."
      >
        <Table rows={MEMBERSHIP} label="Membership" />
      </Block>

      <Block
        n="09"
        title="The capture lanes"
        note="Kept for reading run output and stored scopes. They are not navigation: which lane found a row says nothing about its subject."
      >
        <Table rows={streamRows} label="Streams" />
      </Block>
    </main>
  );
}
