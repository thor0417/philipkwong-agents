'use client';

// TODAY. The answer to "what happened while I was away", top to bottom, in ten
// seconds.
//
// The order is the design. What moved comes first because a stage change is the
// most actionable event the system produces: it is the only one that means a
// project's status in the world actually changed, rather than that the system
// learned something. What came in is second because it is volume, not news.
// Needs you is third because it is a backlog, which is always true and rarely
// urgent. Attention is last because it is about the machine, not the market.
//
// EMPTY STATES ARE HONEST HERE, and they have to be. Stage history only began
// when Brief D shipped, so "what moved" is genuinely thin and will stay thin for
// weeks. A section that renders nothing looks broken; one that says why it is
// thin is just telling the truth.

import Link from 'next/link';
import { useMemo } from 'react';
import PeriodSelector from '@/components/PeriodSelector';
import { usePeriodState } from '@/lib/use-period';
import { useBacklog } from '@/lib/use-leads';
import {
  useLastVisit,
  useWhatMoved,
  useWhatCameIn,
  useWatchlistActivity,
  useSourceHealth,
  useAgentHealth,
  agoLabel,
  DEGRADED_DAYS,
  DEAD_DAYS,
} from '@/lib/use-today';
import type { EventRow } from '@/lib/project-event-queries';
import styles from './page.module.css';

function Section({
  n,
  title,
  lede,
  children,
}: {
  n: string;
  title: string;
  lede?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <span className={`${styles.sectionNum} mono`}>{n}</span>
        <h2 className={styles.sectionTitle}>{title}</h2>
      </div>
      {lede && <p className={styles.lede}>{lede}</p>}
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className={styles.empty}>{children}</p>;
}

function projectHref(id: string | undefined): string {
  return id ? `/projects?open=${id}` : '/projects';
}

// A stage change. The project carries the accent because it is the subject of
// the sentence; the stages are mono because they are values, not prose.
function MovedRow({ e }: { e: EventRow }) {
  return (
    <li className={styles.movedRow}>
      <Link href={projectHref(e.project?.id)} className={`${styles.projectLink} ${styles.projectAccent}`}>
        {e.project?.name ?? 'Unnamed project'}
      </Link>
      <span className={styles.stagePair}>
        <span className={`${styles.stageFrom} mono`}>{e.from_value ?? 'unknown'}</span>
        <span className={`${styles.arrow} mono`}>&rarr;</span>
        <span className={`${styles.stageTo} mono`}>{e.to_value ?? 'unknown'}</span>
      </span>
      <span className={styles.market}>{e.project?.market ?? '--'}</span>
      {e.lead?.url ? (
        <a className={styles.trigger} href={e.lead.url} target="_blank" rel="noreferrer">
          {e.lead.title ?? 'source record'}
        </a>
      ) : (
        <span className={styles.trigger}>{e.lead?.title ?? '--'}</span>
      )}
      <span className={`${styles.when} mono`}>{e.occurred_at.slice(0, 10)}</span>
    </li>
  );
}

export default function TodayPage() {
  // Today keeps 'since last visit' as its default - it is the screen that
  // answers "what happened while I was away" - and gains the closed periods
  // from the same shared control the Register and the composer use, so "what
  // happened in July" is now askable here too.
  const { period, setToken: setPeriod } = usePeriodState('visit');
  const periodNow = useMemo(() => new Date(), []);
  const { since: lastVisit, isFirstRun } = useLastVisit();
  const since = period.since ?? lastVisit;

  const moved = useWhatMoved(since, period.until);
  const cameIn = useWhatCameIn(since, period.until);
  const watch = useWatchlistActivity(since, period.until);
  const backlog = useBacklog();
  const sources = useSourceHealth();
  const agents = useAgentHealth();

  const movedRows = moved.data ?? [];
  const created = cameIn.data?.created ?? [];
  const attached = cameIn.data?.attached ?? [];
  const watchRows = watch.data ?? [];

  const degraded = (sources.data?.sources ?? []).filter((s) => s.daysSilent >= DEGRADED_DAYS);
  const failedRuns = (agents.data ?? []).filter((a) => a.status === 'error' || !!a.error);

  // Built as a whole sentence rather than a fragment glued to "since": the
  // visit case and the fixed-window cases take different prepositions, and
  // "what happened since the last 7 days" is not English.
  const windowSentence =
    period.key === 'visit'
      ? isFirstRun
        ? 'What happened in the last 7 days. No previous visit recorded, so this is a first look.'
        : `What happened since your last visit, ${agoLabel(lastVisit)}.`
      : period.closed
        ? `What happened in ${period.label}. That period has closed, so this page will not change.`
        : `What happened in ${period.label.toLowerCase()}.`;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Today</h1>
          <p className={styles.lede}>{windowSentence}</p>
        </div>
        <div className={styles.periods} role="group" aria-label="Period">
          <PeriodSelector period={period} now={periodNow} onChange={setPeriod} />
        </div>
      </header>

      {/* ------------------------------------------------------- what moved */}
      <Section
        n="01"
        title="What moved"
        lede="Stage changes, most advanced destination first. A project reaching construction matters more than one reaching a scheduled hearing, so this is not ordered by time."
      >
        {moved.isPending ? (
          <Empty>Loading...</Empty>
        ) : movedRows.length === 0 ? (
          <Empty>
            Nothing changed stage in this window. Stage history only began when event
            capture shipped, so this section is genuinely thin for now and will fill as
            projects move. It is not broken.
          </Empty>
        ) : (
          <ul className={styles.movedList}>
            {movedRows.map((e) => (
              <MovedRow key={e.id} e={e} />
            ))}
          </ul>
        )}
      </Section>

      {/* ------------------------------------------------------ what came in */}
      <Section
        n="02"
        title="What came in"
        lede="New projects first, then new records on projects you already had. Grouped by project, so six records on one project is one line, not six."
      >
        {cameIn.isPending ? (
          <Empty>Loading...</Empty>
        ) : created.length === 0 && attached.length === 0 ? (
          <Empty>Nothing new in this window.</Empty>
        ) : (
          <>
            {created.length > 0 && (
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>
                  New projects <span className="mono">{created.length}</span>
                </h3>
                <ul className={styles.list}>
                  {created.map((e) => (
                    <li key={e.id} className={styles.row}>
                      <Link href={projectHref(e.project?.id)} className={styles.projectLink}>
                        {e.project?.name ?? 'Unnamed project'}
                      </Link>
                      <span className={styles.market}>{e.project?.market ?? '--'}</span>
                      <span className={styles.rowMeta}>{e.project?.stage ?? '--'}</span>
                      <span className={`${styles.when} mono`}>{e.occurred_at.slice(0, 10)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {attached.length > 0 && (
              <div className={styles.group}>
                <h3 className={styles.groupTitle}>
                  New records on existing projects <span className="mono">{attached.length}</span>
                </h3>
                <ul className={styles.list}>
                  {attached.map((g) => (
                    <li key={g.project?.id ?? Math.random()} className={styles.row}>
                      <Link href={projectHref(g.project?.id)} className={styles.projectLink}>
                        {g.project?.name ?? 'Unnamed project'}
                      </Link>
                      <span className={styles.market}>{g.project?.market ?? '--'}</span>
                      <span className={styles.rowMeta}>
                        <span className="mono">{g.events.length}</span>{' '}
                        {g.events.length === 1 ? 'record' : 'records'}
                      </span>
                      <span className={`${styles.when} mono`}>
                        {g.events[0]?.occurred_at.slice(0, 10)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </Section>

      {/* --------------------------------------------------------- needs you */}
      <Section n="03" title="Needs you" lede="Each of these is a count and a place to go.">
        {/* Each card lands on the screen that holds the thing it counts, with
            the filter already applied. These previously linked with a ?triage=
            parameter that no screen reads, so they navigated to an unfiltered
            list and looked like the count had been forgotten on arrival.
            The backlog counts RECORDS, so it goes to Records; the other two
            count projects, so they go to the Register. */}
        <div className={styles.needs}>
          <Link href="/records" className={styles.need}>
            <span className={`${styles.needCount} mono`}>{backlog.data ?? '--'}</span>
            <span className={styles.needLabel}>Record triage backlog</span>
            <span className={styles.needHint}>Records still at status new, on Records</span>
          </Link>
          <Link href="/projects?view=watchlist" className={styles.need}>
            <span className={`${styles.needCount} mono`}>{watchRows.length}</span>
            <span className={styles.needLabel}>Watchlist activity</span>
            <span className={styles.needHint}>Events on projects you watch</span>
          </Link>
          <Link href="/projects?view=new" className={styles.need}>
            <span className={`${styles.needCount} mono`}>{created.length}</span>
            <span className={styles.needLabel}>New projects to review</span>
            <span className={styles.needHint}>Captured in this window</span>
          </Link>
        </div>
      </Section>

      {/* --------------------------------------------------------- attention */}
      <Section
        n="04"
        title="Attention"
        lede="The machine, not the market. Red only where something is genuinely wrong."
      >
        <div className={styles.attention}>
          <div className={styles.attnBlock}>
            <h3 className={styles.groupTitle}>Sources</h3>
            {sources.isPending ? (
              <Empty>Loading...</Empty>
            ) : degraded.length === 0 ? (
              <p className={styles.ok}>
                All <span className="mono">{sources.data?.sources.length ?? 0}</span> sources
                delivered within {DEGRADED_DAYS} days.
              </p>
            ) : (
              <ul className={styles.list}>
                {degraded.map((s) => (
                  <li key={s.source} className={styles.srcRow}>
                    <span className={styles.srcName}>{s.source}</span>
                    <span
                      className={`${styles.srcDays} mono ${
                        s.daysSilent >= DEAD_DAYS ? styles.bad : styles.warnish
                      }`}
                    >
                      {s.daysSilent}d silent
                    </span>
                    <span className={`${styles.rowMeta} mono`}>{s.records} records</span>
                  </li>
                ))}
              </ul>
            )}
            {sources.data?.capped && (
              <p className={styles.caveat}>
                Freshness read from the most recent records only; a source silent longer than
                that window may be under-reported.
              </p>
            )}
          </div>

          <div className={styles.attnBlock}>
            <h3 className={styles.groupTitle}>Runs</h3>
            {agents.isPending ? (
              <Empty>Loading...</Empty>
            ) : failedRuns.length === 0 ? (
              <p className={styles.ok}>No failed runs.</p>
            ) : (
              <ul className={styles.list}>
                {failedRuns.map((a) => (
                  <li key={a.name} className={styles.srcRow}>
                    <span className={styles.srcName}>{a.name}</span>
                    <span className={`${styles.srcDays} mono ${styles.bad}`}>
                      {a.status ?? 'error'}
                    </span>
                    <span className={`${styles.rowMeta} mono`}>{agoLabel(a.last_run)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Not a placeholder for something coming later: there is no cost
              table in this database, so there is nothing to read. Saying so is
              better than an unexplained gap or a fabricated zero. */}
          <div className={styles.attnBlock}>
            <h3 className={styles.groupTitle}>Cost against ceiling</h3>
            <p className={styles.caveat}>
              Not instrumented. Nothing in this database records spend per run, so no
              figure here would be real. This section stays until it can be.
            </p>
          </div>
        </div>
      </Section>
    </div>
  );
}
