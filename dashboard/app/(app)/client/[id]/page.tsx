'use client';

// THE CLIENT DETAIL. Contacts, scope, delivery history, notes.
//
// THE SCOPE EDITOR IS INLINE AND PREVIEWED LIVE. Editing a scope changes what a
// client receives, and the effect of the change is shown next to the controls
// making it: turn off a market and watch the project count fall. A scope editor
// that saves silently and reveals the consequence in next month's report is how
// coverage quietly narrows without anyone noticing.
//
// SAVE IS EXPLICIT. The preview updates as fields are toggled, but nothing is
// written until Save. An autosaving scope editor means a mis-click permanently
// changes what a paying client is covered for.

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { CADENCES, CLIENT_STATUSES, type ClientScope } from '@/lib/clients';
import {
  useClient,
  useClientMutations,
  useContacts,
  useScopes,
} from '@/lib/use-clients';
import { useDeliveries } from '@/lib/use-deliveries';
import { HOSPITALITY_ID } from '@/lib/pipelines';
import ScopeFields, { type ScopeDraft } from '@/components/ScopeFields';
import ScopePreviewStrip from '@/components/ScopePreview';
import styles from '../../clients/page.module.css';
import detail from './page.module.css';

function scopeToDraft(s: ClientScope): ScopeDraft {
  return {
    pipeline_id: s.pipeline_id,
    countries: s.countries ?? [],
    regions: s.regions ?? [],
    markets: s.markets ?? [],
    streams: s.streams ?? [],
    development_categories: s.development_categories ?? [],
    venue_types: s.venue_types ?? [],
    stages: s.stages ?? [],
    watch_terms: s.watch_terms ?? [],
    notes: s.notes ?? '',
  };
}

function draftToScope(s: ClientScope, d: ScopeDraft): ClientScope {
  return {
    ...s,
    pipeline_id: d.pipeline_id,
    countries: d.countries,
    regions: d.regions,
    markets: d.markets,
    streams: d.streams,
    development_categories: d.development_categories,
    venue_types: d.venue_types,
    stages: d.stages,
    watch_terms: d.watch_terms,
    notes: d.notes,
  };
}

function ScopeCard({
  scope,
  clientId,
  onError,
}: {
  scope: ClientScope;
  clientId: string;
  onError: (m: string) => void;
}) {
  const [draft, setDraft] = useState<ScopeDraft>(() => scopeToDraft(scope));
  const [dirty, setDirty] = useState(false);
  const { patchScope } = useClientMutations({ onError });

  // A refetch after saving must not clobber an edit in progress, so the draft is
  // only re-seeded from the server while the editor is clean.
  useEffect(() => {
    if (!dirty) setDraft(scopeToDraft(scope));
  }, [scope, dirty]);

  const previewScope = useMemo(() => draftToScope(scope, draft), [scope, draft]);

  return (
    <section className={detail.card} data-testid="scope-card">
      <div className={detail.cardHead}>
        <h2 className={styles.sectionTitle}>Scope: {scope.pipeline_id}</h2>
        {dirty && <span className={detail.dirty}>unsaved</span>}
      </div>

      {/* The preview follows the DRAFT, not the saved scope: the point is to see
          the consequence of a change before committing to it. */}
      <ScopePreviewStrip scope={previewScope} />

      <div className={styles.grid}>
        <ScopeFields
          draft={draft}
          onChange={(next) => {
            setDraft(next);
            setDirty(true);
          }}
        />
      </div>

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.primary}
          disabled={!dirty || patchScope.isPending}
          data-testid="scope-save"
          onClick={() =>
            patchScope.mutate(
              {
                id: scope.id,
                clientId,
                patch: {
                  pipeline_id: draft.pipeline_id,
                  countries: draft.countries,
                  regions: draft.regions,
                  markets: draft.markets,
                  streams: draft.streams,
                  development_categories: draft.development_categories,
                  venue_types: draft.venue_types,
                  stages: draft.stages,
                  watch_terms: draft.watch_terms,
                  notes: draft.notes || null,
                },
              },
              { onSuccess: () => setDirty(false) }
            )
          }
        >
          {patchScope.isPending ? 'Saving...' : 'Save scope'}
        </button>
        <button
          type="button"
          className={styles.ghost}
          disabled={!dirty}
          onClick={() => {
            setDraft(scopeToDraft(scope));
            setDirty(false);
          }}
        >
          Revert
        </button>
      </div>
    </section>
  );
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const [error, setError] = useState<string | null>(null);

  const client = useClient(id);
  const contacts = useContacts(id);
  const scopes = useScopes(id);
  const deliveries = useDeliveries(id);
  const { patchClient, newScope, newContact } = useClientMutations({ onError: setError });

  const [contactDraft, setContactDraft] = useState({ name: '', email: '', role: '' });

  if (client.isPending) return <p className={styles.empty}>Loading...</p>;
  if (client.isError) return <p className={styles.empty}>Client unreadable: {(client.error as Error).message}</p>;

  const c = client.data;

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div>
          <Link href="/clients" className={detail.back}>
            Clients
          </Link>
          <h1 className={styles.title}>{c.name}</h1>
          <p className={styles.lede}>
            {c.organisation ?? 'No organisation recorded'}
            {c.cadence ? ` | ${c.cadence}` : ''}
            {c.next_delivery ? ` | next due ${c.next_delivery}` : ''}
          </p>
        </div>
      </header>

      {error && <div className={styles.error} role="alert">{error}</div>}

      <div className={detail.body}>
        {/* ------------------------------------------------------- the client */}
        <section className={detail.card}>
          <h2 className={styles.sectionTitle}>Delivery details</h2>
          <p className={styles.sectionLede}>
            Who their documents are made out to, and when the next one is due.
            The name that PUBLISHES a document is the operator&apos;s and is not
            editable here: a client is a recipient, never a publisher.
          </p>
          <div className={styles.grid}>
            {(
              [
                // THE BRAND CONTROL IS GONE, not disabled. It was labelled
                // "Brand name on documents" and it did exactly that: JKR's
                // stored brand reached the cover of JKR's own report, twenty-two
                // times. An input that can misattribute authorship is removed
                // rather than guarded.
                ['addressee', 'Addressee'],
              ] as const
            ).map(([field, label]) => (
              <label key={field} className={styles.field}>
                <span className={styles.label}>{label}</span>
                <input
                  className={styles.input}
                  defaultValue={c[field] ?? ''}
                  onBlur={(e) => {
                    if (e.target.value !== (c[field] ?? '')) {
                      patchClient.mutate({ id, patch: { [field]: e.target.value || null } });
                    }
                  }}
                />
              </label>
            ))}
            <label className={styles.field}>
              <span className={styles.label}>Cadence</span>
              <select
                className={styles.select}
                value={c.cadence ?? 'monthly'}
                onChange={(e) => patchClient.mutate({ id, patch: { cadence: e.target.value } })}
              >
                {CADENCES.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Next delivery</span>
              <input
                type="date"
                className={styles.input}
                defaultValue={c.next_delivery ?? ''}
                onBlur={(e) => patchClient.mutate({ id, patch: { next_delivery: e.target.value || null } })}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Status</span>
              <select
                className={styles.select}
                value={c.status ?? 'active'}
                onChange={(e) => patchClient.mutate({ id, patch: { status: e.target.value } })}
              >
                {CLIENT_STATUSES.map((x) => (
                  <option key={x} value={x}>{x}</option>
                ))}
              </select>
            </label>
          </div>
        </section>

        {/* ------------------------------------------------------- contacts */}
        <section className={detail.card}>
          <h2 className={styles.sectionTitle}>Contacts</h2>
          {(contacts.data ?? []).length === 0 ? (
            <p className={styles.hint}>None recorded.</p>
          ) : (
            <ul className={detail.contacts}>
              {(contacts.data ?? []).map((ct) => (
                <li key={ct.id} className={detail.contact}>
                  <span className={styles.name}>{ct.name}</span>
                  {ct.primary_contact && <span className={detail.badge}>primary</span>}
                  <span className={styles.cell}>{ct.role ?? '--'}</span>
                  <span className={`${styles.cell} mono`}>{ct.email ?? '--'}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={styles.contactRow}>
            <input
              className={styles.input}
              placeholder="Name"
              value={contactDraft.name}
              onChange={(e) => setContactDraft({ ...contactDraft, name: e.target.value })}
            />
            <input
              className={styles.input}
              placeholder="Email"
              value={contactDraft.email}
              onChange={(e) => setContactDraft({ ...contactDraft, email: e.target.value })}
            />
            <input
              className={styles.input}
              placeholder="Role"
              value={contactDraft.role}
              onChange={(e) => setContactDraft({ ...contactDraft, role: e.target.value })}
            />
            <button
              type="button"
              className={styles.ghost}
              disabled={!contactDraft.name.trim()}
              onClick={() =>
                newContact.mutate(
                  { clientId: id, contact: { ...contactDraft, primary_contact: false } },
                  { onSuccess: () => setContactDraft({ name: '', email: '', role: '' }) }
                )
              }
            >
              Add
            </button>
          </div>
        </section>

        {/* ------------------------------------------------------- the scopes */}
        {(scopes.data ?? []).map((s) => (
          <ScopeCard key={s.id} scope={s} clientId={id} onError={setError} />
        ))}

        {(scopes.data ?? []).length === 0 && (
          <section className={detail.card}>
            <h2 className={styles.sectionTitle}>No scope</h2>
            <p className={styles.sectionLede}>
              This client has no scope, so nothing can be generated for them. A
              client is written before its scope is, so this is what a
              half-finished intake looks like.
            </p>
            <button
              type="button"
              className={styles.primary}
              onClick={() => newScope.mutate({ clientId: id, pipelineId: HOSPITALITY_ID })}
            >
              Add a scope
            </button>
          </section>
        )}

        {/* ---------------------------------------------------- deliveries */}
        <section className={detail.card} data-testid="delivery-history">
          <h2 className={styles.sectionTitle}>Delivery history</h2>
          <p className={styles.sectionLede}>
            Exactly what this client received and when. The commercial record and
            the legal one.
          </p>
          {deliveries.isError ? (
            <p className={styles.warn}>
              The delivery log is unavailable: {(deliveries.error as Error).message}
            </p>
          ) : deliveries.isPending ? (
            <p className={styles.hint}>Loading...</p>
          ) : (deliveries.data ?? []).length === 0 ? (
            <p className={styles.hint}>Nothing generated for this client yet.</p>
          ) : (
            <ul className={detail.deliveries}>
              {(deliveries.data ?? []).map((d) => (
                <li key={d.id} className={detail.delivery}>
                  <span className="mono">{(d.generated_at ?? '').slice(0, 10)}</span>
                  <span className={styles.name}>{d.document_type}</span>
                  {/* The format, from the stored filename. Without it the PDF,
                      CSV and XLSX of one report are three identical-looking
                      rows, and "exactly what this client received" is the one
                      question this list exists to answer. */}
                  <span className={`${styles.cell} mono`}>
                    {(d.file_path ?? '').split('.').pop()?.toUpperCase() ?? '--'}
                  </span>
                  <span className={styles.cell}>
                    {d.period_start ?? '?'} to {d.period_end ?? '?'}
                  </span>
                  <span className={`${styles.cell} mono`}>
                    {d.project_count ?? 0} projects, {d.record_count ?? 0} records
                  </span>
                  <span className={styles.status}>{d.delivery_status ?? '--'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* --------------------------------------------------------- notes */}
        <section className={detail.card}>
          <h2 className={styles.sectionTitle}>Notes</h2>
          <textarea
            className={styles.textarea}
            defaultValue={c.notes ?? ''}
            onBlur={(e) => {
              if (e.target.value !== (c.notes ?? '')) {
                patchClient.mutate({ id, patch: { notes: e.target.value || null } });
              }
            }}
          />
        </section>
      </div>
    </div>
  );
}
