'use client';

// CLIENTS. The list, and the intake form that onboards one.
//
// WHY THE INTAKE FORM IS ON THIS SCREEN rather than behind a route of its own:
// onboarding a client is something Philip does a handful of times a year, and a
// route that exists to be visited five times is a route nobody remembers the
// name of. It opens in place, over the list, and the list is what the screen is.
//
// THE SCOPE PREVIEW RUNS DURING INTAKE, not only afterwards. The counts update
// as the scope is filled in, so a combination that matches nothing is visible
// while it is being chosen - which is the only moment it costs nothing to fix.

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CADENCES, CLIENT_STATUSES, type ClientScope } from '@/lib/clients';
import { useClients, useAllScopes, useClientMutations } from '@/lib/use-clients';
import ScopeFields, { EMPTY_SCOPE, type ScopeDraft } from '@/components/ScopeFields';
import ScopePreviewStrip from '@/components/ScopePreview';
import styles from './page.module.css';

interface ContactDraft {
  name: string;
  email: string;
  role: string;
  primary_contact: boolean;
}

const EMPTY_CONTACT: ContactDraft = { name: '', email: '', role: '', primary_contact: false };

// The draft scope, shaped as a ClientScope so the preview can be run against it
// before it has ever been saved. Ids are empty strings: the preview reads the
// filter arrays and nothing else.
function draftAsScope(d: ScopeDraft): ClientScope {
  return {
    id: '',
    client_id: '',
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
    created_at: null,
  };
}

function IntakeForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [name, setName] = useState('');
  const [organisation, setOrganisation] = useState('');
  const [status, setStatus] = useState<string>('active');
  const [brand, setBrand] = useState('');
  const [addressee, setAddressee] = useState('');
  const [cadence, setCadence] = useState<string>('monthly');
  const [nextDelivery, setNextDelivery] = useState('');
  const [notes, setNotes] = useState('');
  const [contacts, setContacts] = useState<ContactDraft[]>([{ ...EMPTY_CONTACT, primary_contact: true }]);
  const [scope, setScope] = useState<ScopeDraft>(EMPTY_SCOPE);
  const [error, setError] = useState<string | null>(null);

  const { create } = useClientMutations({ onError: setError });
  const previewScope = useMemo(() => draftAsScope(scope), [scope]);

  const submit = () => {
    setError(null);
    if (!name.trim()) {
      setError('A client needs a name.');
      return;
    }
    create.mutate(
      {
        client: {
          name: name.trim(),
          organisation: organisation.trim() || null,
          status,
          brand_name: brand.trim() || null,
          addressee: addressee.trim() || null,
          cadence,
          next_delivery: nextDelivery || null,
          notes: notes.trim() || null,
        },
        contacts: contacts.filter((c) => c.name.trim()),
        scope: {
          pipeline_id: scope.pipeline_id,
          countries: scope.countries,
          regions: scope.regions,
          markets: scope.markets,
          streams: scope.streams,
          development_categories: scope.development_categories,
          venue_types: scope.venue_types,
          stages: scope.stages,
          watch_terms: scope.watch_terms,
          notes: scope.notes.trim() || null,
        },
      },
      { onSuccess: onDone }
    );
  };

  return (
    <div className={styles.intake} data-testid="intake-form">
      {error && <div className={styles.error} role="alert">{error}</div>}

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Who they are</h2>
        <p className={styles.sectionLede}>
          Brand and addressee are what appear on their documents. They live here
          rather than in the generator so one client&apos;s report can never go
          out with another client&apos;s name on it.
        </p>
        <div className={styles.grid}>
          <label className={styles.field}>
            <span className={styles.label}>Client name</span>
            <input className={styles.input} data-testid="client-name" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Organisation</span>
            <input className={styles.input} value={organisation} onChange={(e) => setOrganisation(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Brand name on documents</span>
            <input className={styles.input} value={brand} onChange={(e) => setBrand(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Addressee</span>
            <input className={styles.input} value={addressee} onChange={(e) => setAddressee(e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Status</span>
            <select className={styles.select} value={status} onChange={(e) => setStatus(e.target.value)}>
              {CLIENT_STATUSES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Cadence</span>
            <select className={styles.select} value={cadence} onChange={(e) => setCadence(e.target.value)}>
              {CADENCES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.label}>Next delivery</span>
            <input type="date" className={styles.input} value={nextDelivery} onChange={(e) => setNextDelivery(e.target.value)} />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Contacts</h2>
        <p className={styles.sectionLede}>Who receives the work.</p>
        {contacts.map((c, i) => (
          <div key={i} className={styles.contactRow}>
            <input
              className={styles.input}
              placeholder="Name"
              value={c.name}
              onChange={(e) =>
                setContacts(contacts.map((x, j) => (i === j ? { ...x, name: e.target.value } : x)))
              }
            />
            <input
              className={styles.input}
              placeholder="Email"
              value={c.email}
              onChange={(e) =>
                setContacts(contacts.map((x, j) => (i === j ? { ...x, email: e.target.value } : x)))
              }
            />
            <input
              className={styles.input}
              placeholder="Role"
              value={c.role}
              onChange={(e) =>
                setContacts(contacts.map((x, j) => (i === j ? { ...x, role: e.target.value } : x)))
              }
            />
            <label className={styles.hint}>
              <input
                type="checkbox"
                checked={c.primary_contact}
                onChange={() =>
                  setContacts(contacts.map((x, j) => ({ ...x, primary_contact: i === j })))
                }
              />{' '}
              primary
            </label>
          </div>
        ))}
        <button type="button" className={styles.ghost} onClick={() => setContacts([...contacts, { ...EMPTY_CONTACT }])}>
          Add contact
        </button>
      </section>

      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>What they are looking for</h2>
        <p className={styles.sectionLede}>
          Every field here is a filter the register already applies, so the scope
          resolves to a query rather than to a sentence somebody has to
          interpret. The counts below are what it matches right now.
        </p>
        <ScopePreviewStrip scope={previewScope} />
        <div className={styles.grid}>
          <ScopeFields draft={scope} onChange={setScope} />
        </div>
      </section>

      <section className={styles.section}>
        <label className={styles.field}>
          <span className={styles.label}>Client notes</span>
          <textarea className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </section>

      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={submit} disabled={create.isPending} data-testid="intake-save">
          {create.isPending ? 'Saving...' : 'Create client'}
        </button>
        <button type="button" className={styles.ghost} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const [intake, setIntake] = useState(false);
  const clients = useClients();
  const scopes = useAllScopes();

  const scopesByClient = useMemo(() => {
    const m = new Map<string, ClientScope[]>();
    for (const s of scopes.data ?? []) {
      if (!m.has(s.client_id)) m.set(s.client_id, []);
      m.get(s.client_id)!.push(s);
    }
    return m;
  }, [scopes.data]);

  return (
    <div className={styles.screen}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Clients</h1>
          <p className={styles.lede}>
            Who the work is for, what they have asked to be covered, and when
            they are next due. A scope here is a query, not a note: it resolves
            to the same filters the register uses, so what a client will receive
            can be counted before it is written.
          </p>
        </div>
        {!intake && (
          <button type="button" className={styles.primary} onClick={() => setIntake(true)} data-testid="new-client">
            New client
          </button>
        )}
      </header>

      {intake ? (
        <IntakeForm onDone={() => setIntake(false)} onCancel={() => setIntake(false)} />
      ) : clients.isPending ? (
        <p className={styles.empty}>Loading...</p>
      ) : clients.isError ? (
        <p className={styles.empty}>
          Clients unreadable: {(clients.error as Error).message}
        </p>
      ) : (clients.data ?? []).length === 0 ? (
        <p className={styles.empty}>
          No clients yet. New client opens the intake form, which writes the
          client, their contacts and their first scope in one pass.
        </p>
      ) : (
        <div className={styles.table}>
          <div className={styles.headRow}>
            <span>Client</span>
            <span>Organisation</span>
            <span>Pipeline</span>
            <span>Markets</span>
            <span>Cadence</span>
            <span>Next delivery</span>
            <span>Status</span>
          </div>
          {(clients.data ?? []).map((c) => {
            const cs = scopesByClient.get(c.id) ?? [];
            const marketCount = new Set(cs.flatMap((s) => s.markets ?? [])).size;
            return (
              <Link key={c.id} href={`/client/${c.id}`} className={styles.row} data-client-id={c.id}>
                <span className={styles.name}>{c.name}</span>
                <span className={styles.cell}>{c.organisation ?? '--'}</span>
                <span className={styles.cell}>
                  {cs.length === 0 ? (
                    <span className={styles.warn}>no scope</span>
                  ) : (
                    cs.map((s) => s.pipeline_id).join(', ')
                  )}
                </span>
                <span className={`${styles.cell} mono`}>
                  {cs.length === 0 ? '--' : marketCount === 0 ? 'all' : marketCount}
                </span>
                <span className={styles.cell}>{c.cadence ?? '--'}</span>
                <span className={`${styles.cell} mono`}>{c.next_delivery ?? '--'}</span>
                <span className={styles.status}>{c.status ?? '--'}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
