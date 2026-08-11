'use client';

// THE DETAIL PANE. A pane, not a modal.
//
// This is the whole reason the Register is a split: inspecting a project must
// never cost you your place in the list. A modal covers the list, and closing it
// is a decision; a pane sits beside it, so the operator can move down the list
// with J and K and watch this side change.
//
// It is deliberately NOT the project page. This shows what is needed to decide
// whether to keep reading: identity, stage, people, the record timeline, notes.
// The full page (people, documents, related projects, full event history) is one
// click away and is a different screen.

import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { useProject, useProjectTimeline, useProjectMutations } from '@/lib/use-projects';
import { useProjectPeople } from '@/lib/use-people';
import { PROJECT_STAGES } from '@/lib/taxonomy';
import { projectOverriddenFields } from '@/lib/project-mutations';
import styles from './page.module.css';

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

export default function RegisterDetail({
  id,
  onClose,
  onError,
}: {
  id: string;
  onClose: () => void;
  onError: (message: string) => void;
}) {
  const project = useProject(id);
  const timeline = useProjectTimeline(id);
  const people = useProjectPeople(id);
  const { watch, stage, notes, busy } = useProjectMutations({ onError });

  const p = project.data;
  const [noteDraft, setNoteDraft] = useState<string | null>(null);

  // Reset the draft when the selection changes, or typing a note on one project
  // would carry over to the next one arrowed to.
  useEffect(() => {
    setNoteDraft(null);
  }, [id]);

  if (project.isPending) {
    return <aside className={styles.detail}><p className={styles.dim}>Loading...</p></aside>;
  }
  if (!p) {
    return (
      <aside className={styles.detail}>
        <p className={styles.dim}>That project could not be loaded.</p>
      </aside>
    );
  }

  const overridden = projectOverriddenFields(p.manual_overrides);
  const records = timeline.data ?? [];

  return (
    <aside className={styles.detail} aria-label="Project detail">
      <div className={styles.detailHead}>
        <div className={styles.detailIdent}>
          <h2 className={styles.detailName}>{p.name}</h2>
          {/* LABELLED BY PROVENANCE, for the same reason the report labels
              [RECORD] and [ASSESSMENT]: a derived line is the filing's own
              words and can be quoted to a client, a generated line is a
              model's reading of it and cannot. A pane that shows both
              identically forces the reader to guess which is which. */}
          {p.summary && (
            <p className={styles.detailSummary}>
              {p.summary}
              <span className={styles.summarySource}>
                {p.summary_source === 'derived'
                  ? 'from the filing'
                  : p.summary_source === 'generated'
                    ? 'written by model from the records'
                    : 'written by you'}
              </span>
            </p>
          )}
          {/* THE SCORE, WITH ITS BREAKDOWN, AT THE POINT OF USE. A ranking
              nobody can interrogate is a ranking nobody can trust; showing
              only the number would move the problem rather than fix it. */}
          {p.significance != null && (
            <div className={styles.sigBlock}>
              <span className={`${styles.sigScore} mono`}>{Math.round(p.significance)}</span>
              <span className={styles.sigOf}>of 100</span>
              {overridden.includes('significance') && <span className={styles.sigPinned}>pinned by you</span>}
              <ul className={styles.sigList}>
                {Object.entries(p.significance_detail ?? {})
                  .filter(([, d]) => d && d.points !== 0)
                  .sort((a, b) => b[1].points - a[1].points)
                  .map(([k, d]) => (
                    <li key={k}>
                      <span className={styles.sigName}>{k}</span>
                      <span className={`${styles.sigPts} mono`}>
                        {d.points}/{d.of}
                      </span>
                      <span className={styles.sigWhy}>{d.why}</span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
          <div className={styles.detailMeta}>
            <span>{p.market ?? p.region_state ?? p.country ?? 'Unresolved location'}</span>
            <span className={styles.dot} aria-hidden="true" />
            <span className="mono">{p.record_count ?? records.length} records</span>
          </div>
        </div>
        <button type="button" className={styles.close} onClick={onClose} title="Close (Esc)">
          Close
        </button>
      </div>

      <div className={styles.detailActions}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Stage</span>
          <select
            value={p.stage ?? ''}
            disabled={busy}
            onChange={(e) => stage.mutate({ id: p.id, stage: e.target.value })}
          >
            {!p.stage && <option value="">--</option>}
            {PROJECT_STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className={`${styles.watchBtn} ${p.watch ? styles.watchOn : ''}`}
          disabled={busy}
          onClick={() => watch.mutate({ id: p.id, watch: !p.watch })}
          title="Toggle watchlist (W)"
        >
          {p.watch ? 'Watching' : 'Watch'}
        </button>

        <Link href={`/project/${p.id}`} className={styles.fullPage}>
          Open full page
        </Link>
      </div>

      {overridden.length > 0 && (
        <p className={styles.override}>
          Manually corrected: <span className="mono">{overridden.join(', ')}</span>. No future run
          overwrites these.
        </p>
      )}

      {/* THE SAME PEOPLE THE DOCUMENT PRINTS.
          This block read projects.primary_applicant and primary_representative,
          which are two mode columns, so it could show at most two parties and
          never a presenter, a contact or a phone number. The report meanwhile
          built its list from the records. Two answers to one question, and the
          pane is where the operator decides whether a project is worth a brief.
          Both now come from lib/people. The corrected/derived provenance is kept
          for the two columns a person can override. */}
      <section className={styles.detailBlock}>
        <h3 className={styles.blockTitle}>People</h3>
        {people.isPending ? (
          <p className={styles.dim}>Loading...</p>
        ) : people.note ? (
          <p className={styles.dim} data-people-none>{people.note}</p>
        ) : (
          <dl className={styles.people}>
            {people.parties.map((party, i) => (
              <Fragment key={i}>
                <dt>{party.roles.join('; ')}</dt>
                <dd data-party>
                  {party.name}
                  {party.firm ? `, ${party.firm}` : ''}
                  <span className={styles.provenance}>
                    {overridden.includes('primary_applicant') && party.roles.includes('applicant')
                      ? 'corrected'
                      : party.contact
                        ? [party.contact.email, party.contact.phone].filter(Boolean).join(', ')
                        : 'No phone or email in the record.'}
                  </span>
                  {party.address && <span className={styles.provenance}>{party.address}</span>}
                  {party.alsoOn && <span className={styles.provenance}>{party.alsoOn}</span>}
                </dd>
              </Fragment>
            ))}
          </dl>
        )}
      </section>

      {/* The timeline. Every record in date order, with its source and a link. */}
      <section className={styles.detailBlock}>
        <h3 className={styles.blockTitle}>
          Timeline <span className="mono">{records.length}</span>
        </h3>
        {timeline.isPending ? (
          <p className={styles.dim}>Loading records...</p>
        ) : records.length === 0 ? (
          <p className={styles.dim}>No records attached.</p>
        ) : (
          <ol className={styles.timeline}>
            {records.map((r) => (
              <li key={r.id} className={styles.tlRow}>
                <span className={`${styles.tlDate} mono`}>
                  {ymd(r.deadline ?? r.published_date ?? r.first_seen)}
                </span>
                <span className={styles.tlBody}>
                  {r.url ? (
                    <a href={r.url} target="_blank" rel="noreferrer" className={styles.tlLink}>
                      {r.title ?? 'Untitled record'}
                    </a>
                  ) : (
                    <span>{r.title ?? 'Untitled record'}</span>
                  )}
                  <span className={styles.tlSource}>{r.source_type ?? r.source ?? 'unknown'}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className={styles.detailBlock}>
        <h3 className={styles.blockTitle}>Notes</h3>
        <textarea
          className={styles.notes}
          rows={4}
          value={noteDraft ?? p.notes ?? ''}
          placeholder="Anything the records do not say."
          onChange={(e) => setNoteDraft(e.target.value)}
        />
        {noteDraft !== null && noteDraft !== (p.notes ?? '') && (
          <div className={styles.noteActions}>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                notes.mutate({ id: p.id, notes: noteDraft }, { onSuccess: () => setNoteDraft(null) })
              }
            >
              Save note
            </button>
            <button type="button" onClick={() => setNoteDraft(null)}>
              Discard
            </button>
          </div>
        )}
      </section>
    </aside>
  );
}
