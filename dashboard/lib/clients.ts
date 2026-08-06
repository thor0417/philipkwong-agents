// CLIENTS, CONTACTS AND SCOPES. The query layer.
//
// THE ONE IDEA THIS FILE EXISTS TO ENFORCE: a scope is a query, not a note.
//
// Every array on client_scopes names a column the register already filters on,
// so resolveScope below turns a client's stated interest into the same
// ProjectQuery the Register builds from its own controls. That is what makes
// the scope preview possible - live counts of what a client's scope matches,
// before a document is generated rather than after it is sent - and it is the
// difference between a CRM note and an executable definition of coverage.
//
// AN EMPTY ARRAY IS NO CONSTRAINT, NOT AN EMPTY RESULT. A scope naming no
// markets covers every market. The opposite reading would make a half-filled
// intake form silently match nothing, and "matches nothing" is precisely the
// failure the preview exists to make visible - it must mean the scope really is
// empty, not that a field was left blank.

import { supabase } from './supabase';
import { HOSPITALITY_ID, storageKeyFor } from './pipelines';
import type { ProjectQuery } from './projects';

export interface Client {
  id: string;
  name: string;
  organisation: string | null;
  status: string | null;
  brand_name: string | null;
  addressee: string | null;
  cadence: string | null;
  next_delivery: string | null;
  notes: string | null;
  created_at: string | null;
}

export interface ClientContact {
  id: string;
  client_id: string;
  name: string;
  email: string | null;
  role: string | null;
  primary_contact: boolean | null;
  created_at: string | null;
}

export interface ClientScope {
  id: string;
  client_id: string;
  pipeline_id: string;
  countries: string[] | null;
  regions: string[] | null;
  markets: string[] | null;
  streams: string[] | null;
  development_categories: string[] | null;
  venue_types: string[] | null;
  stages: string[] | null;
  watch_terms: string[] | null;
  notes: string | null;
  created_at: string | null;
}

export const CADENCES = ['weekly', 'fortnightly', 'monthly', 'quarterly', 'on request'] as const;
export const CLIENT_STATUSES = ['active', 'paused', 'prospect', 'closed'] as const;

const CLIENT_COLUMNS =
  'id,name,organisation,status,brand_name,addressee,cadence,next_delivery,notes,created_at';
const CONTACT_COLUMNS = 'id,client_id,name,email,role,primary_contact,created_at';
const SCOPE_COLUMNS =
  'id,client_id,pipeline_id,countries,regions,markets,streams,development_categories,' +
  'venue_types,stages,watch_terms,notes,created_at';

// ---- Reads --------------------------------------------------------------------

export async function fetchClients(): Promise<Client[]> {
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .order('name', { ascending: true });
  if (error) throw new Error(`clients query failed: ${error.message}`);
  return (data ?? []) as unknown as Client[];
}

export async function fetchClient(id: string): Promise<Client> {
  const { data, error } = await supabase.from('clients').select(CLIENT_COLUMNS).eq('id', id).single();
  if (error) throw new Error(`client fetch failed: ${error.message}`);
  return data as unknown as Client;
}

export async function fetchContacts(clientId: string): Promise<ClientContact[]> {
  const { data, error } = await supabase
    .from('client_contacts')
    .select(CONTACT_COLUMNS)
    .eq('client_id', clientId)
    .order('primary_contact', { ascending: false })
    .order('name', { ascending: true });
  if (error) throw new Error(`contacts query failed: ${error.message}`);
  return (data ?? []) as unknown as ClientContact[];
}

export async function fetchScopes(clientId: string): Promise<ClientScope[]> {
  const { data, error } = await supabase
    .from('client_scopes')
    .select(SCOPE_COLUMNS)
    .eq('client_id', clientId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`scopes query failed: ${error.message}`);
  return (data ?? []) as unknown as ClientScope[];
}

/** Every scope, for the list's market counts. One query rather than one per row. */
export async function fetchAllScopes(): Promise<ClientScope[]> {
  const { data, error } = await supabase.from('client_scopes').select(SCOPE_COLUMNS);
  if (error) throw new Error(`scopes query failed: ${error.message}`);
  return (data ?? []) as unknown as ClientScope[];
}

// ---- Writes -------------------------------------------------------------------

export interface ClientIntake {
  client: Omit<Client, 'id' | 'created_at'>;
  contacts: { name: string; email: string; role: string; primary_contact: boolean }[];
  scope: Omit<ClientScope, 'id' | 'client_id' | 'created_at'>;
}

// The identity a client is unique on, matching migration 027's expression index.
// Case and surrounding whitespace are not identity.
export function clientIdentity(name: string, organisation: string | null | undefined): string {
  return `${String(name ?? '').trim().toLowerCase()}|${String(organisation ?? '').trim().toLowerCase()}`;
}

/**
 * The client with this identity, or null.
 *
 * Filtered in JS over a name match rather than by an ilike on both columns,
 * because organisation is nullable and `organisation.eq.null` and
 * `organisation.eq.''` are different queries in PostgREST while being the same
 * client to a person.
 */
export async function findClientByIdentity(
  name: string,
  organisation: string | null
): Promise<Client | null> {
  // No sanitisation: this is a single .ilike() VALUE, which the client
  // parameterises. The quote-stripping the search helpers do exists because
  // .or() takes a filter STRING where a quote changes the parse, and copying
  // it here would only mangle a client legitimately called O"Brien & Co.
  const safe = name.trim();
  if (!safe) return null;
  const { data, error } = await supabase
    .from('clients')
    .select(CLIENT_COLUMNS)
    .ilike('name', safe);
  if (error) throw new Error(`client lookup failed: ${error.message}`);
  const want = clientIdentity(name, organisation);
  return (
    ((data ?? []) as unknown as Client[]).find((c) => clientIdentity(c.name, c.organisation) === want) ??
    null
  );
}

/**
 * Onboard a client: the client row, its contacts, and its first scope.
 *
 * AN UPSERT, NOT A BLIND INSERT. Eight identical clients accumulated because
 * this function only ever inserted, and nothing above or below it asked whether
 * the client already existed. It now looks the client up by identity first and
 * updates that row instead of adding another - which is also what a person
 * double-clicking Create expects, since the second click cannot mean "make me a
 * second identical client".
 *
 * Migration 027's unique index is the backstop, not the mechanism. The lookup
 * closes the ordinary case; the index closes the race between two callers that
 * both looked and both saw nothing.
 *
 * CHILDREN ARE MERGED, NOT DUPLICATED. Re-running intake for an existing client
 * adds contacts it does not have and a scope for a pipeline it does not cover,
 * and leaves the rest alone. Overwriting the stored scope here would let a
 * re-run silently narrow what a client is covered for.
 *
 * NOT A TRANSACTION, AND THE ORDER IS THE MITIGATION. PostgREST has no
 * multi-statement transaction, so this writes the client first and its children
 * after. If a child write fails the client exists with no scope, which the
 * clients list shows as "no scope" and the detail page offers to fix - a visible
 * half-finished record. The alternative failure, a scope with no client, is
 * impossible: the foreign key refuses it.
 */
export async function createClient(intake: ClientIntake): Promise<string> {
  const existing = await findClientByIdentity(intake.client.name, intake.client.organisation);

  let clientId: string;
  if (existing) {
    clientId = existing.id;
    const { error } = await supabase.from('clients').update(intake.client).eq('id', clientId);
    if (error) throw new Error(`client update failed: ${error.message}`);
  } else {
    const { data, error } = await supabase.from('clients').insert(intake.client).select('id').single();
    if (error) throw new Error(`client insert failed: ${error.message}`);
    clientId = (data as { id: string }).id;
  }

  const wanted = intake.contacts.filter((c) => c.name.trim());
  if (wanted.length) {
    const have = existing ? await fetchContacts(clientId) : [];
    const key = (n: string, e: string | null) =>
      `${n.trim().toLowerCase()}|${String(e ?? '').trim().toLowerCase()}`;
    const seen = new Set(have.map((c) => key(c.name, c.email)));
    const fresh = wanted.filter((c) => !seen.has(key(c.name, c.email)));
    if (fresh.length) {
      const { error: cErr } = await supabase
        .from('client_contacts')
        .insert(fresh.map((c) => ({ ...c, client_id: clientId })));
      if (cErr) throw new Error(`contacts insert failed (client ${clientId} exists): ${cErr.message}`);
    }
  }

  const scopes = existing ? await fetchScopes(clientId) : [];
  if (!scopes.some((s) => s.pipeline_id === intake.scope.pipeline_id)) {
    const { error: sErr } = await supabase
      .from('client_scopes')
      .insert({ ...intake.scope, client_id: clientId });
    if (sErr) throw new Error(`scope insert failed (client ${clientId} exists): ${sErr.message}`);
  }

  return clientId;
}

export async function updateClient(id: string, patch: Partial<Client>): Promise<void> {
  const { error } = await supabase.from('clients').update(patch).eq('id', id);
  if (error) throw new Error(`client update failed: ${error.message}`);
}

export async function updateScope(id: string, patch: Partial<ClientScope>): Promise<void> {
  const { error } = await supabase.from('client_scopes').update(patch).eq('id', id);
  if (error) throw new Error(`scope update failed: ${error.message}`);
}

export async function addContact(
  clientId: string,
  contact: { name: string; email: string; role: string; primary_contact: boolean }
): Promise<void> {
  const { error } = await supabase.from('client_contacts').insert({ ...contact, client_id: clientId });
  if (error) throw new Error(`contact insert failed: ${error.message}`);
}

export async function addScope(clientId: string, pipelineId: string): Promise<void> {
  const { error } = await supabase
    .from('client_scopes')
    .insert({ client_id: clientId, pipeline_id: pipelineId });
  if (error) throw new Error(`scope insert failed: ${error.message}`);
}

// ---- The resolver -------------------------------------------------------------

export interface ResolvedScope {
  // The project query this scope resolves to, minus the period.
  query: ProjectQuery;
  // Filters the scope states that the PROJECT query cannot express, applied to
  // the fetched rows instead. Named rather than silently dropped.
  postFilters: { field: string; values: string[] }[];
  // Axes the scope leaves unconstrained, so the preview can say "every market"
  // rather than showing a blank.
  unconstrained: string[];
}

function nonEmpty(a: string[] | null | undefined): string[] | null {
  const v = (a ?? []).map((s) => s.trim()).filter(Boolean);
  return v.length ? v : null;
}

/**
 * A scope, as a query.
 *
 * SINGLE VALUES GO TO THE SERVER, LISTS COME BACK AS POST-FILTERS, and that
 * split is a limitation of ProjectQuery rather than a design choice: it holds
 * one country, one region, one market, one stage. A scope naming three markets
 * cannot be expressed as one server-side filter through it.
 *
 * Rather than quietly filtering on the first market and reporting a count for
 * three, a multi-value axis is returned in `postFilters` and applied to the
 * rows. The caller knows the difference and the preview says so. The set being
 * filtered is already bounded by every single-valued axis and by the period, so
 * this is a filter over a page, not a table scan.
 */
export function resolveScope(scope: ClientScope): ResolvedScope {
  const countries = nonEmpty(scope.countries);
  const regions = nonEmpty(scope.regions);
  const markets = nonEmpty(scope.markets);
  const stages = nonEmpty(scope.stages);
  const categories = nonEmpty(scope.development_categories);
  const venues = nonEmpty(scope.venue_types);

  // THE PIPELINE'S ID IS NOT THE VALUE STORED ON A ROW, and this is the one
  // place the two meet. client_scopes.pipeline_id is a foreign key into
  // pipelines, so it holds 'hospitality'; leads.module and projects.module hold
  // 'gli', because that is what ~1,400 existing rows carry. storageKeyFor is
  // the translation, and skipping it produces a scope that resolves to a module
  // no row has - a query that matches nothing, from a scope that looks correct.
  const query: ProjectQuery = {
    module: storageKeyFor(scope.pipeline_id || HOSPITALITY_ID),
    excludeStatus: 'dismissed',
  };
  const postFilters: ResolvedScope['postFilters'] = [];

  const single = (
    values: string[] | null,
    field: keyof ProjectQuery,
    postName: string
  ): void => {
    if (!values) return;
    if (values.length === 1) (query as Record<string, unknown>)[field] = values[0];
    else postFilters.push({ field: postName, values });
  };

  single(countries, 'country', 'country');
  single(regions, 'region_state', 'region_state');
  single(markets, 'market', 'market');
  single(stages, 'stage', 'stage');
  single(categories, 'development_category', 'development_category');
  // venue_type has no ProjectQuery field at all, so it is always a post-filter.
  if (venues) postFilters.push({ field: 'venue_type', values: venues });

  const unconstrained: string[] = [];
  if (!countries) unconstrained.push('country');
  if (!regions) unconstrained.push('region');
  if (!markets) unconstrained.push('market');
  if (!stages) unconstrained.push('stage');
  if (!categories) unconstrained.push('development category');
  if (!venues) unconstrained.push('venue type');

  return { query, postFilters, unconstrained };
}

/** Apply the post-filters a scope could not push to the server. */
export function applyPostFilters<T extends Record<string, unknown>>(
  rows: T[],
  postFilters: ResolvedScope['postFilters']
): T[] {
  let out = rows;
  for (const f of postFilters) {
    const want = new Set(f.values.map((v) => v.toLowerCase()));
    out = out.filter((r) => {
      const v = r[f.field];
      return typeof v === 'string' && want.has(v.toLowerCase());
    });
  }
  return out;
}

export function scopeIsEmpty(scope: ClientScope): boolean {
  return (
    !nonEmpty(scope.countries) &&
    !nonEmpty(scope.regions) &&
    !nonEmpty(scope.markets) &&
    !nonEmpty(scope.streams) &&
    !nonEmpty(scope.development_categories) &&
    !nonEmpty(scope.venue_types) &&
    !nonEmpty(scope.stages)
  );
}
