'use client';

// THE COMPANY PAGE. Small screen, high value.
//
// Three questions, in the order they get asked: who is this, what have they
// filed, and who do they keep turning up with. The third is the one no
// competitor in this vertical has, and it costs nothing to answer: it is a
// self-join over data the scraper already writes.
//
// THE MERGE CONTROL. Normalisation is exact-after-cleaning by design, because
// fuzzy matching was tested and rejected for merging genuinely different firms.
// The consequence is that duplicates accumulate and only a human can tell
// "NEVADA PALACE, LLC" from "Nevada Palace LLC." So the merge is manual, it is
// recorded as an override no future run reverts, and it destroys nothing.

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import {
  useCompany,
  useCompanyProjects,
  useRelatedCompanies,
  useCompanySearch,
  useMergeCompanies,
} from '@/lib/use-companies';
import styles from './page.module.css';

function ymd(iso: string | null | undefined): string {
  return iso ? iso.slice(0, 10) : '--';
}

export default function CompanyPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';

  const company = useCompany(id);
  const projects = useCompanyProjects(id);
  const related = useRelatedCompanies(id);

  const [error, setError] = useState<string | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [pick, setPick] = useState<{ id: string; name: string } | null>(null);
  const candidates = useCompanySearch(term);
  const merge = useMergeCompanies(setError);

  const c = company.data;

  if (company.isPending) {
    return <div className={styles.screen}><p className={styles.dim}>Loading company...</p></div>;
  }
  if (!c) {
    return (
      <div className={styles.screen}>
        <p className={styles.dim}>No company with that id.</p>
        <Link href="/projects">Back to Projects</Link>
      </div>
    );
  }

  const rows = projects.data ?? [];
  const mergedNames =
    ((c.manual_overrides as { merged_names?: string[] } | null)?.merged_names) ?? [];
  const mergedInto = (c.manual_overrides as { merged_into?: string } | null)?.merged_into;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div className={styles.crumb}>
          <Link href="/projects">Projects</Link>
          <span aria-hidden="true">/</span>
          <span>Company</span>
        </div>
        <h1 className={styles.title}>{c.name}</h1>
        <div className={styles.facts}>
          <span className={styles.fact}>
            <span className={styles.factLabel}>Type</span>
            <span className={styles.factValue}>{c.company_type ?? 'not classified'}</span>
          </span>
          <span className={styles.fact}>
            <span className={styles.factLabel}>Projects</span>
            <span className={`${styles.factValue} mono`}>{rows.length}</span>
          </span>
          <span className={styles.fact}>
            <span className={styles.factLabel}>First seen</span>
            <span className={`${styles.factValue} mono`}>{ymd(c.first_seen)}</span>
          </span>
          <span className={styles.fact}>
            <span className={styles.factLabel}>Last activity</span>
            <span className={`${styles.factValue} mono`}>{ymd(c.last_activity)}</span>
          </span>
        </div>

        {/* A merged-away record is still readable by URL. Saying so beats a
            page that silently shows nothing. */}
        {mergedInto && (
          <p className={styles.mergedNotice}>
            This company was merged into{' '}
            <Link href={`/company/${mergedInto}`}>another record</Link> and no longer appears in
            listings. Nothing was deleted.
          </p>
        )}
        {mergedNames.length > 0 && (
          <p className={styles.mergedNotice}>
            Also filed as <span className="mono">{mergedNames.join(', ')}</span>. Merged manually;
            no future run reverts this.
          </p>
        )}
      </header>

      {error && (
        <div className={styles.error} role="alert">
          {error}
          <button type="button" onClick={() => setError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className={styles.body}>
        <main className={styles.col}>
          <h2 className={styles.h2}>
            Projects <span className="mono">{rows.length}</span>
          </h2>
          {projects.isPending ? (
            <p className={styles.dim}>Loading...</p>
          ) : rows.length === 0 ? (
            <p className={styles.dim}>This company is not attached to any project.</p>
          ) : (
            <ul className={styles.projectList}>
              {rows.map((p) => (
                <li key={`${p.id}-${p.role}`} className={styles.projectRow}>
                  <Link href={`/project/${p.id}`} className={styles.projectName}>
                    {p.name}
                  </Link>
                  <span className={styles.role}>{p.role ?? 'party'}</span>
                  <span className={styles.meta}>{p.market ?? '--'}</span>
                  <span className={styles.meta}>{p.stage ?? '--'}</span>
                  <span className={`${styles.meta} ${styles.num} mono`}>
                    {ymd(p.last_activity)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </main>

        <aside className={styles.col}>
          <section className={styles.block}>
            <h2 className={styles.h3}>Related companies</h2>
            <p className={styles.note}>
              Parties that appear on the same projects. This is the relationship graph
              falling out of the data, not something anyone captured.
            </p>
            {related.isPending ? (
              <p className={styles.dim}>Loading...</p>
            ) : (related.data ?? []).length === 0 ? (
              <p className={styles.dim}>No other party shares a project with this company.</p>
            ) : (
              <ul className={styles.relList}>
                {(related.data ?? []).slice(0, 15).map((r) => (
                  <li key={r.id} className={styles.rel}>
                    <Link href={`/company/${r.id}`} className={styles.projectName}>
                      {r.name}
                    </Link>
                    <span className={`${styles.meta} mono`}>
                      {r.shared} shared
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ------------------------------------------------------- merge */}
          <section className={styles.block}>
            <h2 className={styles.h3}>Duplicates</h2>
            <p className={styles.note}>
              Company names are matched exactly after cleaning, never fuzzily, because
              fuzzy matching merged genuinely different firms. Duplicates therefore
              accumulate and only a person can resolve them.
            </p>

            {!mergeOpen ? (
              <button type="button" className={styles.mergeBtn} onClick={() => setMergeOpen(true)}>
                Merge another company into this one
              </button>
            ) : (
              <div className={styles.merge}>
                <input
                  className={styles.mergeSearch}
                  value={term}
                  onChange={(e) => {
                    setTerm(e.target.value);
                    setPick(null);
                  }}
                  placeholder="Find the duplicate by name"
                  aria-label="Find a company to merge"
                />

                {pick ? (
                  <div className={styles.confirm}>
                    <p className={styles.confirmText}>
                      Merge <strong>{pick.name}</strong> into <strong>{c.name}</strong>? Its
                      projects move here, and it stops appearing in listings. Nothing is
                      deleted.
                    </p>
                    <div className={styles.confirmActions}>
                      <button
                        type="button"
                        className={styles.primary}
                        disabled={merge.isPending}
                        onClick={() =>
                          merge.mutate(
                            { winnerId: c.id, loserId: pick.id },
                            {
                              onSuccess: () => {
                                setPick(null);
                                setTerm('');
                                setMergeOpen(false);
                              },
                            }
                          )
                        }
                      >
                        {merge.isPending ? 'Merging...' : 'Merge'}
                      </button>
                      <button type="button" onClick={() => setPick(null)}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <ul className={styles.candidates}>
                    {(candidates.data ?? [])
                      .filter((x) => x.id !== c.id)
                      .map((x) => (
                        <li key={x.id}>
                          <button
                            type="button"
                            className={styles.candidate}
                            onClick={() => setPick({ id: x.id, name: x.name })}
                          >
                            {x.name}
                          </button>
                        </li>
                      ))}
                    {term.trim().length >= 2 && (candidates.data ?? []).length === 0 && (
                      <li className={styles.dim}>No company matches that.</li>
                    )}
                  </ul>
                )}

                <button
                  type="button"
                  className={styles.cancelMerge}
                  onClick={() => {
                    setMergeOpen(false);
                    setPick(null);
                    setTerm('');
                  }}
                >
                  Done
                </button>
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
