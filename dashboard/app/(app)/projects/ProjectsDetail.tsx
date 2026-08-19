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
import { isProvisionalName } from '@/lib/taxonomy';
import { recordProvenance } from '@/lib/report-model';
// The one copy, read across the package split. See lib/dead-feeds.
import { deadFeedForMarket } from '../../../../lib/dead-feeds';
import { useProject, useProjectTimeline, useProjectMutations } from '@/lib/use-projects';
import { useProjectPeople } from '@/lib/use-people';
import { PROJECT_STAGES } from '@/lib/taxonomy';
import { projectOverriddenFields } from '@/lib/project-mutations';
import type { MembershipStatus } from '@/lib/client-projects';
import styles from './page.module.css';

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

export default function ProjectsDetail({
  id,
  onClose,
  onError,
  // ---- MEMBERSHIP, PASSED IN RATHER THAN READ HERE.
  //
  // The pane is rendered for one project at a time and the membership map is a
  // property of the CLIENT VIEW, which the register already holds. Reading it
  // again here would be a second query answering the same question, and the two
  // could disagree about whether a row is confirmed - which is the one thing on
  // this screen that must never be ambiguous. All four are null or undefined
  // when no client is open, and the block does not render.
  clientName = null,
  membershipStatus = null,
  onMembership,
  membershipBusy = false,
}: {
  id: string;
  onClose: () => void;
  onError: (message: string) => void;
  clientName?: string | null;
  membershipStatus?: MembershipStatus | null;
  onMembership?: (status: MembershipStatus) => void;
  membershipBusy?: boolean;
}) {
  const project = useProject(id);
  const timeline = useProjectTimeline(id);
  const people = useProjectPeople(id);
  const { watch, toggleWatch, stage, notes, busy } = useProjectMutations({ onError });

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
          {/* WHERE THE NAME CAME FROM, MARKED, AND ONLY WHEN IT MATTERS.
              A client document refuses to print a project whose name is a
              cleaned agenda line - see isProvisionalName - so internally this
              is the question worth asking: which of these do we not have a
              name for? Marked here rather than hidden, because the register is
              where naming one by hand is done. Every other source is silent:
              a label on every row is not a label. */}
          {/* THE MARKET STOPPED PUBLISHING, SO EVERYTHING BELOW IS HISTORY.
              Placed above the name source and above the summary because it
              qualifies both: the stage, the last activity date and the record
              timeline in this pane are all accurate and all frozen, and an
              operator reading "approved" on a project last touched in 2021 has
              to be told which of those two facts is load bearing. The date and
              the reason come from the declaration, never from prose here, so
              this pane and the client document cannot disagree. */}
          {(() => {
            const feed = deadFeedForMarket(p.market, p.region_state);
            return feed ? (
              <p className={styles.frozenMarket} data-testid="market-frozen-detail">
                {feed.market} is not being read. The public source we capture from has published
                nothing since {feed.frozenSince}, so the records below are complete up to that date
                and empty after it. Projects in this market are held out of client documents and
                the coverage note says so.
                {feed.liveDataAt
                  ? ` The jurisdiction itself still publishes, at ${feed.liveDataAt}; we do not read it yet.`
                  : ''}
              </p>
            ) : null;
          })()}
          {isProvisionalName(p.name_source) && (
            <p className={styles.nameSource} data-testid="name-provisional">
              Name taken from the agenda line, not a published name. Projects
              named this way are left out of client documents; rename by hand to
              include this one.
            </p>
          )}
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
          onClick={() => toggleWatch(p.id, p.watch)}
          title="Toggle watchlist (W)"
        >
          {p.watch ? 'Watching' : 'Watch'}
        </button>

        <Link href={`/project/${p.id}`} className={styles.fullPage}>
          Open full page
        </Link>

        {/* THE SAME ACTION AS THE PROJECT PAGE, FROM THE PANE WHERE THE PROJECT
            IS ACTUALLY FOUND. The register is where Philip reads the row and
            decides it is worth a brief; without this, acting on that decision
            meant opening the full page to reach a link, or hand-editing a URL.
            Identical target and identical reasoning: it carries the project and
            the referral section set, and it is a LINK rather than a generate
            button because a referral is Philip's assessment plus the record and
            the assessment is written in the composer. */}
        <Link
          href={`/reports?project=${encodeURIComponent(p.id)}&mode=referral`}
          className={styles.fullPage}
          data-testid="register-referral-brief"
        >
          Generate referral brief
        </Link>
      </div>

      {/* ---- IS THIS PROJECT IN THIS CLIENT'S DOCUMENT. --------------------
          The one question the pane could not answer, and the reason every
          client document covered nothing: the scope proposed, the report
          demanded confirmation, and no screen could confirm.
          It sits directly under the actions rather than at the foot of the pane
          because it is the decision the pane exists to support in a client
          view - everything below it (people, timeline, notes) is the evidence
          for making it.
          BOTH DIRECTIONS ARE A WRITE and pressing the current one returns the
          project to `proposed`. Nothing is deleted: an excluded row is a
          tombstone, or the next scope resolution proposes it again and the same
          question gets asked forever. */}
      {onMembership && (
        <section className={styles.detailBlock} data-testid="detail-membership">
          <h3 className={styles.blockTitle}>
            {clientName ?? 'This client'}
          </h3>
          <p className={styles.dim} data-testid="detail-membership-state">
            {membershipStatus === 'included'
              ? 'Confirmed. This project will appear in their document.'
              : membershipStatus === 'excluded'
                ? 'Excluded. It stays on this list and out of the document, and the scope will not propose it again.'
                : 'Proposed by the scope and not yet judged. A document prints the confirmed only, so as it stands this project is not in one.'}
          </p>
          <div className={styles.detailActions}>
            <button
              type="button"
              className={`${styles.watchBtn} ${membershipStatus === 'included' ? styles.watchOn : ''}`}
              disabled={membershipBusy}
              data-testid="detail-confirm"
              title="Confirm for this client (C)"
              onClick={() =>
                onMembership(membershipStatus === 'included' ? 'proposed' : 'included')
              }
            >
              {membershipStatus === 'included' ? 'Confirmed' : 'Confirm'}
            </button>
            <button
              type="button"
              className={`${styles.watchBtn} ${membershipStatus === 'excluded' ? styles.watchOn : ''}`}
              disabled={membershipBusy}
              data-testid="detail-exclude"
              title="Exclude from this client (X)"
              onClick={() =>
                onMembership(membershipStatus === 'excluded' ? 'proposed' : 'excluded')
              }
            >
              {membershipStatus === 'excluded' ? 'Excluded' : 'Exclude'}
            </button>
          </div>
          {membershipStatus === 'included' &&
            (isProvisionalName(p.name_source) || deadFeedForMarket(p.market, p.region_state)) && (
              <p className={styles.dim} data-testid="detail-membership-held">
                Confirmed, and it will still not print:{' '}
                {isProvisionalName(p.name_source)
                  ? 'its name was taken from an agenda line. Rename it and it will.'
                  : 'its market has stopped publishing, and no confirmation changes that.'}
              </p>
            )}
        </section>
      )}

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
                  {/* PROVENANCE ON THE ROW, WHICH IS WHERE THE THREE STREAM
                      TABS WENT. Which lane captured a record is a fact about
                      the record, not a place to visit, and the difference
                      between a filing the client can open and a story somebody
                      wrote is the one thing about a timeline row that decides
                      how much it is worth. Same rule the document uses. */}
                  <span
                    className={styles.tlProvenance}
                    data-provenance={recordProvenance(r.source, r.source_type, r.stream)}
                  >
                    [{recordProvenance(r.source, r.source_type, r.stream)}]
                  </span>
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
