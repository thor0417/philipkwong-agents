'use client';

// THE INBOX. It empties.
//
// 585 live records carry no project_id and nothing drained them. That is why
// every screen in this product felt unbounded: there was a pile with no bottom
// and no surface that admitted it existed. A list that only grows is not a
// backlog, it is scenery.
//
// WHY THESE RECORDS ARE HERE AT ALL. The clusterer attaches a record to a
// project when it finds a signal - a shared case number, a site, a named
// applicant, a corroborated name. A record with no signal is never guessed at
// and never hidden: it lands here, visible, and a person is the only route out.
// See agents/scraper/cluster. So this is not a queue of failures, it is the
// residue of a rule that refuses to invent a link.
//
// ONE ITEM AT A TIME. The record table showed fifty rows and every one of them
// needed the same two decisions, which is how 585 became 585. Here there is one
// record, its text, and the two things you can do to it.
//
// THE BINDINGS ARE THE ONES ALREADY LEARNED, and no new ones are invented:
// J and K move, Enter opens the document, E dismisses, Escape clears the
// attach box. Attaching is not a keystroke because it cannot be one - it needs
// a project chosen by name - so it is a control, and it is the only control.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryState, parseAsInteger, parseAsString } from 'nuqs';
import Link from 'next/link';
import { useInboxPage, useProjectSearch, useProjectMutations } from '@/lib/use-projects';
import { useLeadMutations } from '@/lib/use-leads';
import { recordProvenance } from '@/lib/report-model';
import styles from './page.module.css';

const PAGE_SIZE = 50;

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

export default function InboxPage() {
  const [search, setSearch] = useQueryState('q', parseAsString.withDefault(''));
  const [page, setPage] = useQueryState('page', parseAsInteger.withDefault(1));
  const [cursor, setCursor] = useState(0);
  const [attachTerm, setAttachTerm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [triaged, setTriaged] = useState(0);

  const inbox = useInboxPage({ search: search.trim() || undefined, page, pageSize: PAGE_SIZE });
  const rows = useMemo(() => inbox.data?.rows ?? [], [inbox.data]);
  const total = inbox.data?.total ?? 0;

  // The cursor is an INDEX INTO A LIST THAT SHRINKS UNDER IT. A dismissed record
  // leaves the page, so the item that was at the cursor is gone and the next one
  // has slid into its place - which is exactly the behaviour wanted, and is also
  // how a cursor ends up past the end.
  useEffect(() => {
    if (cursor > rows.length - 1) setCursor(Math.max(0, rows.length - 1));
  }, [rows.length, cursor]);

  const current = rows[cursor] ?? null;

  // Clear the attach box when the record changes, or a project typed for one
  // record would still be sitting there for the next.
  useEffect(() => {
    setAttachTerm('');
  }, [current?.id]);

  const { applyStatus, busy: leadBusy } = useLeadMutations({ onError: setError });
  const { attach, busy: attachBusy } = useProjectMutations({ onError: setError });
  const candidates = useProjectSearch(attachTerm);
  const busy = leadBusy || attachBusy;

  const dismiss = useCallback(() => {
    if (!current) return;
    setError(null);
    setTriaged((n) => n + 1);
    applyStatus([current.id], 'dismissed');
  }, [current, applyStatus]);

  const doAttach = useCallback(
    (projectId: string) => {
      if (!current) return;
      setError(null);
      setTriaged((n) => n + 1);
      attach.mutate({ leadId: current.id, projectId });
      setAttachTerm('');
    },
    [current, attach]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        if (e.key === 'Escape') el.blur();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      switch (e.key.toLowerCase()) {
        case 'j':
          e.preventDefault();
          setCursor((c) => Math.min(rows.length - 1, c + 1));
          break;
        case 'k':
          e.preventDefault();
          setCursor((c) => Math.max(0, c - 1));
          break;
        case 'enter':
          if (current?.url) {
            e.preventDefault();
            window.open(current.url, '_blank', 'noreferrer');
          }
          break;
        case 'e':
          e.preventDefault();
          dismiss();
          break;
        case 'escape':
          e.preventDefault();
          setAttachTerm('');
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows.length, current, dismiss]);

  return (
    <div className={styles.screen}>
      <div className={styles.head}>
        <h1 className={styles.title}>Inbox</h1>
        {/* THE COUNT IS THE HONEST REMAINDER. It is the server's exact count of
            records with no project and no dismissal, re-read after every write,
            so it goes down as the pile does. A count that only ever grew is what
            made this pile invisible. */}
        <span className={`${styles.count} mono`} data-testid="inbox-total">
          {inbox.isPending ? '--' : total}
        </span>
        <span className={styles.countLabel}>records attached to no project</span>
        {triaged > 0 && (
          <span className={`${styles.triaged} mono`} data-testid="inbox-triaged">
            {triaged} triaged this session
          </span>
        )}
        <input
          className={styles.search}
          value={search}
          onChange={(e) => {
            void setSearch(e.target.value || null);
            void setPage(1);
            setCursor(0);
          }}
          placeholder="Title, applicant, representative or location"
          aria-label="Search the inbox"
        />
      </div>

      {error && (
        <div className={styles.error} role="alert" data-testid="inbox-error">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      {inbox.isPending ? (
        <p className={styles.dim}>Loading...</p>
      ) : total === 0 ? (
        // THE STATE THIS SCREEN EXISTS TO REACH.
        <p className={styles.empty} data-testid="inbox-empty">
          Nothing is waiting. Every captured record belongs to a project.
        </p>
      ) : !current ? (
        <p className={styles.dim}>Nothing left on this page.</p>
      ) : (
        <div className={styles.body}>
          <article className={styles.record} data-testid="inbox-record" data-record-id={current.id}>
            <div className={styles.recordHead}>
              <span
                className={styles.provenance}
                data-provenance={recordProvenance(current.source, current.source_type, current.stream)}
              >
                [{recordProvenance(current.source, current.source_type, current.stream)}]
              </span>
              <span className={`${styles.date} mono`}>
                {ymd(current.published_date ?? current.deadline ?? current.first_seen)}
              </span>
              <span className={styles.source}>{current.source_type ?? current.source ?? 'unknown'}</span>
            </div>

            <h2 className={styles.recordTitle}>
              {current.url ? (
                <a href={current.url} target="_blank" rel="noreferrer">
                  {current.title ?? 'Untitled record'}
                </a>
              ) : (
                (current.title ?? 'Untitled record')
              )}
            </h2>

            {/* Only what the record actually carries. A field with nothing in it
                is not rendered, per the design rule: an empty labelled row reads
                as a fact we hold and do not know. */}
            <dl className={styles.facts}>
              {current.applicant && (
                <>
                  <dt>Applicant</dt>
                  <dd>{current.applicant}</dd>
                </>
              )}
              {current.representative && (
                <>
                  <dt>Representative</dt>
                  <dd>{current.representative}</dd>
                </>
              )}
              {current.presented_by && (
                <>
                  <dt>Presented by</dt>
                  <dd>{current.presented_by}</dd>
                </>
              )}
              {current.action_sought && (
                <>
                  <dt>Action sought</dt>
                  <dd>{current.action_sought}</dd>
                </>
              )}
              {current.cluster_reason && (
                <>
                  <dt>Why it is here</dt>
                  <dd>{current.cluster_reason}</dd>
                </>
              )}
            </dl>
          </article>

          <aside className={styles.actions}>
            {/* ATTACHING IS AN ACTION FROM HERE, and it is the only one that can
                take a record out of this pile and into the register. The sweep
                has already attached everything it can reach; these are precisely
                the records no signal reaches, so a person is the route. */}
            <label className={styles.attachLabel} htmlFor="inbox-attach">
              Attach to a project
            </label>
            <input
              id="inbox-attach"
              className={styles.attachInput}
              value={attachTerm}
              onChange={(e) => setAttachTerm(e.target.value)}
              placeholder="Project or applicant name"
              autoComplete="off"
            />
            {attachTerm.trim().length >= 2 && (
              <ul className={styles.candidates}>
                {candidates.isPending && <li className={styles.dim}>Searching...</li>}
                {!candidates.isPending && (candidates.data ?? []).length === 0 && (
                  <li className={styles.dim}>No project matches that.</li>
                )}
                {(candidates.data ?? []).map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className={styles.candidate}
                      disabled={busy}
                      data-attach-to={p.id}
                      onClick={() => doAttach(p.id)}
                    >
                      <span className={styles.candidateName}>{p.name}</span>
                      <span className={styles.candidateMeta}>
                        {p.market ?? p.region_state ?? p.country ?? ''}
                        <span className="mono"> {p.record_count ?? 0}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <button
              type="button"
              className={styles.dismissBtn}
              disabled={busy}
              onClick={dismiss}
              data-testid="inbox-dismiss"
            >
              Dismiss
            </button>
            {/* Nothing is deleted. Dismissed records keep their row and stay
                reachable through the record table's Trash view. */}
            <p className={styles.note}>
              Dismissing sets the record&apos;s status. Nothing is deleted, and a
              dismissed record keeps its row.
            </p>

            <p className={`${styles.position} mono`}>
              {cursor + 1} of {rows.length} on this page, {total} in all
            </p>
          </aside>
        </div>
      )}

      <p className={styles.keys}>
        <span className="mono">J</span> / <span className="mono">K</span> move
        <span className={styles.dot} aria-hidden="true" />
        <span className="mono">Enter</span> open the document
        <span className={styles.dot} aria-hidden="true" />
        <span className="mono">E</span> dismiss
        <span className={styles.dot} aria-hidden="true" />
        <span className="mono">Esc</span> clear
      </p>

      <p className={styles.footNote}>
        A record reaches this pile when the clusterer finds no signal linking it to
        a project, which is deliberate: it never guesses. <Link href="/projects">Projects</Link> is
        where the attached ones are read.
      </p>
    </div>
  );
}
