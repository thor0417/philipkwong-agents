'use client';

// A CLIENT IS A SAVED VIEW YOU OPEN, NOT A SCREEN YOU VISIT.
//
// Opening a client opens Projects filtered to that client's stored scope: same
// table, same columns, same sort, same keyboard. A separate client screen would
// be a second implementation of the project list, and two implementations of a
// list is two answers to "what is in this client's coverage".
//
// This resolves the stored scope into the id set the Projects screen already
// knows how to be filtered by, and the reason each project is in it.

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';
import {
  applyPostFilters,
  fetchScopes,
  projectsHoldingStreams,
  resolveScope,
  scopeIsEmpty,
  type ClientScope,
} from './clients';
import { projectsMatchingRecordFacets, hasRecordFacets } from './clients';
import { applyProjectFilters, PROJECT_COLUMNS, type Project } from './projects';
import { matchedAxesFor } from './scope-match';
import { fetchMembership, type MembershipStatus } from './client-projects';
import { isProvisionalName } from './taxonomy';
// The one copy, read across the package split. See lib/dead-feeds.
import { isDeadFeedMarket } from '../../lib/dead-feeds';

// The same cap the scope preview uses, and stated for the same reason: a bounded
// read whose limit is visible beats an unbounded one that works until it does not.
const ROW_CAP = 2000;

export interface ClientView {
  scope: ClientScope | null;
  /** True when the client stores a scope that constrains nothing. */
  unconstrained: boolean;
  /** The projects the scope proposes, in the order the register would show them. */
  ids: string[];
  /** projectId -> the axes it matched, for the reason on each row. */
  reasons: Map<string, string[]>;
  /** projectId -> confirmed membership, empty while 033 is unapplied. */
  membership: Map<string, MembershipStatus>;
  /** True when migration 033 has not been run. */
  membershipNotApplied: boolean;
  capped: boolean;
  /**
   * OF THE PROJECTS THIS SCOPE PROPOSES, HOW MANY A DOCUMENT WILL REFUSE.
   *
   * The register shows a provisional name and a frozen market with a mark on
   * the row; the report path drops them entirely. So a client's list can look
   * healthy while the document built from it is a third shorter, and until now
   * the only place that difference appeared was inside the generated PDF.
   *
   * Counted here rather than derived at the call site because this is where the
   * project rows already are: the register only ever receives their ids.
   */
  heldOut: { unnamed: number; frozen: number; either: number };
}

export const clientViewKeys = {
  view: (clientId: string) => ['client-view', clientId] as const,
};

async function fetchClientView(clientId: string): Promise<ClientView> {
  const scopes = await fetchScopes(clientId);
  const scope = scopes[0] ?? null;
  if (!scope) {
    return {
      scope: null,
      unconstrained: true,
      ids: [],
      reasons: new Map(),
      membership: new Map(),
      membershipNotApplied: false,
      capped: false,
      heldOut: { unnamed: 0, frozen: 0, either: 0 },
    };
  }

  const { query, postFilters, streams, recordFacets } = resolveScope(scope);

  const { data, error } = await applyProjectFilters(
    supabase.from('projects').select(PROJECT_COLUMNS),
    query
  )
    .order('significance', { ascending: false, nullsFirst: false })
    .limit(ROW_CAP);
  if (error) throw new Error(`client view failed: ${error.message}`);

  const all = (data ?? []) as unknown as Project[];
  let matched = applyPostFilters(
    all as unknown as Record<string, unknown>[],
    postFilters
  ) as unknown as Project[];

  if (streams && matched.length) {
    const keep = await projectsHoldingStreams(matched.map((p) => p.id), streams);
    matched = matched.filter((p) => keep.has(p.id));
  }
  // THE RECORD AXES, WHICH THE SCOPE PREVIEW DOES NOT APPLY AND THE REPORT DOES.
  // Applied here because this view must agree with the DOCUMENT, not with the
  // preview: a client opening their list and then receiving a report built from
  // a different set is the failure this whole part exists to close.
  if (hasRecordFacets(recordFacets) && matched.length) {
    const keep = await projectsMatchingRecordFacets(matched.map((p) => p.id), recordFacets);
    matched = matched.filter((p) => keep.has(p.id));
  }

  const reasons = await matchedAxesFor(matched, scope);
  const { rows, notApplied } = await fetchMembership(clientId);

  // The two exclusions the document applies and this list does not. Same two
  // predicates the register marks a row with, and the same two lib/report-build
  // refuses on, so the three cannot come apart.
  let unnamed = 0;
  let frozen = 0;
  let either = 0;
  for (const p of matched) {
    const u = isProvisionalName(p.name_source);
    const f = isDeadFeedMarket(p.market, p.region_state);
    if (u) unnamed++;
    if (f) frozen++;
    if (u || f) either++;
  }

  return {
    scope,
    unconstrained: scopeIsEmpty(scope),
    ids: matched.map((p) => p.id),
    reasons,
    membership: new Map(rows.map((r) => [r.project_id, r.status])),
    membershipNotApplied: notApplied,
    capped: all.length >= ROW_CAP,
    heldOut: { unnamed, frozen, either },
  };
}

export function useClientView(clientId: string | null) {
  return useQuery({
    queryKey: clientViewKeys.view(clientId ?? ''),
    queryFn: () => fetchClientView(clientId as string),
    enabled: !!clientId,
    staleTime: 30_000,
  });
}
