// CONFIRMED CLIENT MEMBERSHIP.
//
// A client's scope is a query, and a query is a PROPOSAL. It says "these 40
// projects look like Simtec's", and it is right most of the time and wrong in a
// way nobody can see. Today the proposal IS the document: whatever the scope
// resolves to at generation time is what gets printed, with no step between the
// query and the client.
//
// This is that step. The scope proposes, Philip confirms, and only what he
// confirmed may be printed. See migration 033.
//
// THE TABLE MAY NOT EXIST YET AND THAT IS A FIRST-CLASS STATE. 033 is DDL and
// DDL is Philip's to run, so every read here reports "not applied" rather than
// throwing - and, critically, rather than returning an empty list. An empty list
// and an absent table are the same shape and opposite meanings: one says "no
// project has been confirmed for this client", the other says "confirmation is
// not switched on". A report gate that could not tell them apart would either
// print everything or print nothing, and both would look like a decision.

import { supabase } from './supabase';

export type MembershipStatus = 'proposed' | 'included' | 'excluded';

export interface ClientProject {
  id: string;
  client_id: string;
  project_id: string;
  status: MembershipStatus;
  matched_axes: string[];
  set_by: string | null;
  set_at: string | null;
  created_at: string | null;
}

const COLUMNS = 'id,client_id,project_id,status,matched_axes,set_by,set_at,created_at';

/** PostgREST's answer when a table is not in the schema cache. */
function isMissingTable(message: string): boolean {
  return /could not find the table|relation .* does not exist|schema cache/i.test(message);
}

export interface Membership {
  /** Empty when the table is absent. Never conflate the two - see the header. */
  rows: ClientProject[];
  /** True when migration 033 has not been run. */
  notApplied: boolean;
}

export async function fetchMembership(clientId: string): Promise<Membership> {
  const { data, error } = await supabase
    .from('client_projects')
    .select(COLUMNS)
    .eq('client_id', clientId);
  if (error) {
    if (isMissingTable(error.message)) return { rows: [], notApplied: true };
    throw new Error(`client membership read failed: ${error.message}`);
  }
  return { rows: (data ?? []) as unknown as ClientProject[], notApplied: false };
}

/**
 * The confirmed set for a client, for the report gate.
 *
 * Returns null when 033 has not been applied, which the caller MUST handle
 * explicitly. An empty Set would mean "nothing is confirmed" and would silently
 * empty every document.
 */
export async function fetchIncludedProjectIds(clientId: string): Promise<Set<string> | null> {
  const { data, error } = await supabase
    .from('client_projects')
    .select('project_id')
    .eq('client_id', clientId)
    .eq('status', 'included');
  if (error) {
    if (isMissingTable(error.message)) return null;
    throw new Error(`client membership read failed: ${error.message}`);
  }
  return new Set(((data ?? []) as { project_id: string }[]).map((r) => r.project_id));
}

/**
 * Record what the scope proposes, without touching what Philip has decided.
 *
 * PROPOSING NEVER OVERWRITES A DECISION. onConflict does nothing on an existing
 * row, so a project excluded last month is not quietly re-proposed into the
 * document this month by the same scope that proposed it the first time. That is
 * the whole reason an excluded row is a tombstone rather than a deletion.
 */
export async function proposeProjects(
  clientId: string,
  proposals: { projectId: string; matchedAxes: string[] }[]
): Promise<{ inserted: number; notApplied: boolean }> {
  if (!proposals.length) return { inserted: 0, notApplied: false };
  const { data, error } = await supabase
    .from('client_projects')
    .upsert(
      proposals.map((p) => ({
        client_id: clientId,
        project_id: p.projectId,
        status: 'proposed' as const,
        matched_axes: p.matchedAxes,
        set_by: 'scope-resolution',
        set_at: new Date().toISOString(),
      })),
      { onConflict: 'client_id,project_id', ignoreDuplicates: true }
    )
    .select('id');
  if (error) {
    if (isMissingTable(error.message)) return { inserted: 0, notApplied: true };
    throw new Error(`client membership write failed: ${error.message}`);
  }
  return { inserted: (data ?? []).length, notApplied: false };
}

/** Philip's decision on one project. Never a delete: see migration 033. */
export async function setMembership(
  clientId: string,
  projectId: string,
  status: MembershipStatus,
  setBy: string
): Promise<void> {
  const { error } = await supabase.from('client_projects').upsert(
    {
      client_id: clientId,
      project_id: projectId,
      status,
      set_by: setBy,
      set_at: new Date().toISOString(),
    },
    { onConflict: 'client_id,project_id' }
  );
  if (error) throw new Error(`client membership write failed: ${error.message}`);
}
