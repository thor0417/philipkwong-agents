'use client';

// THE PROJECT PAGE. For deep work, and for the moment before a brief goes out.
//
// Header, then two columns: the timeline at 60% on the left, and everything
// ABOUT the project on the right. The split is deliberate. The timeline is the
// evidence and it is read in sequence; people, documents, related projects and
// the event history are reference, consulted out of order. Putting reference in
// a right-hand column keeps the evidence in one uninterrupted run.
//
// This is not the Register's detail pane with more in it. The pane answers
// "should I keep reading"; this answers "what do I actually know", which is the
// question you have to answer before the brief goes to the client.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useProject, useProjectTimeline } from '@/lib/use-projects';
import { useProjectParties, useRelatedProjects } from '@/lib/use-companies';
import { useProjectHistory } from '@/lib/use-today';
import styles from './page.module.css';

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

export default function ProjectPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const project = useProject(id);
  const timeline = useProjectTimeline(id);
  const parties = useProjectParties(id);
  const history = useProjectHistory(id);
  const p = project.data;
  const related = useRelatedProjects(id, p?.market ?? null);

  const [showAllEvents, setShowAllEvents] = useState(false);

  // Documents are the records that actually carry one, so this is a view over
  // the timeline rather than a second fetch.
  const documents = useMemo(
    () => (timeline.data ?? []).filter((r) => !!r.primary_document_url || !!r.url),
    [timeline.data]
  );

  if (project.isPending) {
    return <div className={styles.screen}><p className={styles.dim}>Loading project...</p></div>;
  }
  if (!p) {
    return (
      <div className={styles.screen}>
        <p className={styles.dim}>
          No project with that id. It may have been merged into another.
        </p>
        <Link href="/register">Back to the Register</Link>
      </div>
    );
  }

  const records = timeline.data ?? [];
  const events = history.data ?? [];
  const shownEvents = showAllEvents ? events : events.slice(0, 8);

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.crumb}>
          <Link href="/register">Register</Link>
          <span aria-hidden="true">/</span>
          <span>{p.market ?? p.region_state ?? p.country ?? 'Unresolved'}</span>
        </div>
        <h1 className={styles.title}>{p.name}</h1>
        {/* The lede. Every fact below this line is a category or a date; this
            is the only sentence on the page that says what the project is, so
            it sits directly under the name and above the fact strip. */}
        {p.summary && (
          <p className={styles.summary}>
            {p.summary}
            <span className={styles.summarySource}>
              {p.summary_source === 'derived'
                ? 'quoted from the filing'
                : p.summary_source === 'generated'
                  ? 'written by model from the records'
                  : 'written by you'}
            </span>
          </p>
        )}
        <div className={styles.facts}>
          <span className={styles.fact}>
            <span className={styles.factLabel}>Stage</span>
            <span className={styles.factValue}>{p.stage ?? '--'}</span>
          </span>
          <span className={styles.fact}>
            <span className={styles.factLabel}>Records</span>
            <span className={`${styles.factValue} mono`}>{p.record_count ?? records.length}</span>
          </span>
          <span className={styles.fact}>
            <span className={styles.factLabel}>First seen</span>
            <span className={`${styles.factValue} mono`}>{ymd(p.first_seen)}</span>
          </span>
          <span className={styles.fact}>
            <span className={styles.factLabel}>Last activity</span>
            <span className={`${styles.factValue} mono`}>{ymd(p.last_activity)}</span>
          </span>
          {p.next_milestone && (
            <span className={styles.fact}>
              <span className={styles.factLabel}>Next milestone</span>
              <span className={`${styles.factValue} mono`}>{ymd(p.next_milestone)}</span>
            </span>
          )}
          {p.watch && <span className={styles.watching}>Watching</span>}
        </div>
      </header>

      <div className={styles.body}>
        {/* ------------------------------------------------ timeline, 60% */}
        <main className={styles.timelineCol}>
          <h2 className={styles.h2}>
            Timeline <span className="mono">{records.length}</span>
          </h2>
          {timeline.isPending ? (
            <p className={styles.dim}>Loading records...</p>
          ) : records.length === 0 ? (
            <p className={styles.dim}>No records are attached to this project.</p>
          ) : (
            <ol className={styles.timeline}>
              {records.map((r) => (
                <li key={r.id} className={styles.tlRow}>
                  <span className={`${styles.tlDate} mono`}>
                    {ymd(r.deadline ?? r.published_date ?? r.first_seen)}
                  </span>
                  <div className={styles.tlBody}>
                    <div className={styles.tlTitle}>
                      {r.url ? (
                        <a href={r.url} target="_blank" rel="noreferrer">
                          {r.title ?? 'Untitled record'}
                        </a>
                      ) : (
                        (r.title ?? 'Untitled record')
                      )}
                    </div>
                    <div className={styles.tlMeta}>
                      <span className={styles.tag}>{r.source_type ?? r.source ?? 'unknown'}</span>
                      {r.action_sought && <span className={styles.dim}>{r.action_sought}</span>}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </main>

        {/* -------------------------------------------------- reference, 40% */}
        <aside className={styles.refCol}>
          {/* Every party is a link through to everything that company has
              filed. This is the whole point of capturing companies. */}
          <section className={styles.block}>
            <h2 className={styles.h3}>People</h2>
            {parties.isPending ? (
              <p className={styles.dim}>Loading...</p>
            ) : (parties.data ?? []).length === 0 ? (
              <p className={styles.dim}>
                No party has been identified on any record for this project yet.
              </p>
            ) : (
              <ul className={styles.partyList}>
                {(parties.data ?? []).map((c) => (
                  <li key={`${c.id}-${c.role}`} className={styles.party}>
                    <Link href={`/company/${c.id}`} className={styles.partyName}>
                      {c.name}
                    </Link>
                    <span className={styles.role}>{c.role ?? 'party'}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.block}>
            <h2 className={styles.h3}>
              Documents <span className="mono">{documents.length}</span>
            </h2>
            {documents.length === 0 ? (
              <p className={styles.dim}>No linked documents.</p>
            ) : (
              <ul className={styles.docList}>
                {documents.slice(0, 12).map((r) => (
                  <li key={r.id}>
                    <a
                      href={r.primary_document_url ?? r.url ?? '#'}
                      target="_blank"
                      rel="noreferrer"
                      className={styles.doc}
                    >
                      {r.title ?? 'Untitled document'}
                    </a>
                    <span className={`${styles.dim} mono`}>
                      {ymd(r.published_date ?? r.first_seen)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* THE SLEEPER FEATURE. A corridor play is visible here or nowhere. */}
          <section className={styles.block}>
            <h2 className={styles.h3}>Related projects</h2>
            {related.isPending ? (
              <p className={styles.dim}>Loading...</p>
            ) : (related.data ?? []).length === 0 ? (
              <p className={styles.dim}>
                Nothing shares a party or a market with this project yet.
              </p>
            ) : (
              <ul className={styles.relList}>
                {(related.data ?? []).slice(0, 10).map((r) => (
                  <li key={r.id} className={styles.rel}>
                    <Link href={`/project/${r.id}`} className={styles.relName}>
                      {r.name}
                    </Link>
                    {/* The reason is stated, never blended into a score:
                        "shares an applicant" and "same market" are very
                        different claims. */}
                    <span className={styles.relWhy}>{r.reasons.join(', ')}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className={styles.block}>
            <h2 className={styles.h3}>
              Event history <span className="mono">{events.length}</span>
            </h2>
            {history.isPending ? (
              <p className={styles.dim}>Loading...</p>
            ) : events.length === 0 ? (
              <p className={styles.dim}>
                No events recorded. Event capture began part-way through this
                project&apos;s life, so its earlier history is in the timeline, not here.
              </p>
            ) : (
              <>
                <ol className={styles.eventList}>
                  {shownEvents.map((e) => (
                    <li key={e.id} className={styles.event}>
                      <span className={`${styles.evDate} mono`}>{ymd(e.occurred_at)}</span>
                      <span className={styles.evBody}>
                        <span className={styles.evType}>{e.event_type.replace(/_/g, ' ')}</span>
                        {e.from_value || e.to_value ? (
                          <span className={styles.evChange}>
                            <span className={`${styles.evFrom} mono`}>{e.from_value ?? '--'}</span>
                            <span className="mono" aria-hidden="true"> &rarr; </span>
                            <span className="mono">{e.to_value ?? '--'}</span>
                          </span>
                        ) : null}
                        <span className={styles.evActor}>{e.actor}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                {events.length > 8 && (
                  <button
                    type="button"
                    className={styles.more}
                    onClick={() => setShowAllEvents((v) => !v)}
                  >
                    {showAllEvents ? 'Show fewer' : `Show all ${events.length}`}
                  </button>
                )}
              </>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
