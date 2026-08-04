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

import { useEffect, useState } from 'react';
import { useProject, useProjectTimeline, useProjectMutations } from '@/lib/use-projects';
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

      </div>

      {overridden.length > 0 && (
        <p className={styles.override}>
          Manually corrected: <span className="mono">{overridden.join(', ')}</span>. No future run
          overwrites these.
        </p>
      )}

      {/* People, with provenance. Applicant and representative are derived by the
          scraper, so they are labelled as derived rather than presented as fact. */}
      <section className={styles.detailBlock}>
        <h3 className={styles.blockTitle}>People</h3>
        {p.primary_applicant || p.primary_representative ? (
          <dl className={styles.people}>
            {p.primary_applicant && (
              <>
                <dt>Applicant</dt>
                <dd>
                  {p.primary_applicant}
                  <span className={styles.provenance}>
                    {overridden.includes('primary_applicant') ? 'corrected' : 'derived from records'}
                  </span>
                </dd>
              </>
            )}
            {p.primary_representative && (
              <>
                <dt>Representative</dt>
                <dd>
                  {p.primary_representative}
                  <span className={styles.provenance}>
                    {overridden.includes('primary_representative')
                      ? 'corrected'
                      : 'derived from records'}
                  </span>
                </dd>
              </>
            )}
          </dl>
        ) : (
          <p className={styles.dim}>No party identified on any record yet.</p>
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
