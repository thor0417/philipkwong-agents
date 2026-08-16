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

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import {
  fetchMembership,
  proposeProjects,
  setMembership,
  type MembershipStatus,
} from './client-projects';
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
   *
   * TWO SETS, BECAUSE TWO DIFFERENT QUESTIONS ARE ASKED OF THEM. `proposed` is
   * "how much of what the scope found is unprintable", which is the size of the
   * naming job. `confirmed` is "how much of what you have actually approved will
   * still not appear", which is the length of the next document and is the one
   * the client bar leads with.
   */
  heldOut: {
    proposed: { unnamed: number; frozen: number; either: number };
    confirmed: { unnamed: number; frozen: number; either: number };
  };
  /** proposed / included / excluded, counted off the membership table. */
  counts: { proposed: number; included: number; excluded: number };
  /** Rows written by this open, which is 0 on every open after the first. */
  newlyProposed: number;
}

/** The three membership states, counted. */
function tally(membership: Map<string, MembershipStatus>): ClientView['counts'] {
  const counts = { proposed: 0, included: 0, excluded: 0 };
  for (const status of membership.values()) counts[status] += 1;
  return counts;
}

const EMPTY_HELD = { unnamed: 0, frozen: 0, either: 0 };

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
      heldOut: { proposed: EMPTY_HELD, confirmed: EMPTY_HELD },
      counts: { proposed: 0, included: 0, excluded: 0 },
      newlyProposed: 0,
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

  // ---- THE SCOPE PROPOSES, BEFORE ANYTHING IS READ BACK. -------------------
  //
  // THE GATE HAD NO WAY THROUGH IT. Migration 033 is applied, so buildReport
  // enforces confirmed membership and keeps only rows marked `included` - and
  // `proposeProjects` existed with nothing calling it, so no project was ever
  // proposed, nothing could be confirmed, and every client document came out
  // covering 0 projects however wide the scope. A gate with no door is not a
  // gate; it is a wall with a sign on it.
  //
  // Opening a client is where the proposal belongs. It is the moment the scope
  // is resolved against the corpus, the axes that matched are in hand, and the
  // operator is about to look at the list.
  //
  // WHY A WRITE IS SAFE IN A READ PATH, which is the obvious objection. This is
  // a react-query queryFn and it can run again on a refetch, a remount or a
  // window focus. proposeProjects upserts with ignoreDuplicates on
  // (client_id, project_id), so a second run inserts nothing and - the part
  // that matters - CANNOT overwrite a decision. A project excluded last month
  // is not re-proposed into this month's document by the same scope that
  // proposed it the first time. That is why the excluded row is a tombstone
  // rather than a deletion, and it is what makes this idempotent rather than
  // merely repeated.
  //
  // It is also deliberately not blocking on failure: a proposal that could not
  // be written must not take the client's list off the screen. The count of
  // what it wrote is returned so the screen can say so.
  const proposal = await proposeProjects(
    clientId,
    matched.map((p) => ({ projectId: p.id, matchedAxes: reasons.get(p.id) ?? [] }))
  ).catch(() => ({ inserted: 0, notApplied: false }));

  // READ AFTER THE WRITE, so the first open of a client shows the proposals it
  // just made rather than an empty membership and a list of fifteen projects
  // with no state on any of them.
  const { rows, notApplied } = await fetchMembership(clientId);
  const membership = new Map(rows.map((r) => [r.project_id, r.status]));

  // The two exclusions the document applies and this list does not. Same two
  // predicates the register marks a row with, and the same two lib/report-build
  // refuses on, so the three cannot come apart.
  const held = (some: Project[]) => {
    let unnamed = 0;
    let frozen = 0;
    let either = 0;
    for (const p of some) {
      const u = isProvisionalName(p.name_source);
      const f = isDeadFeedMarket(p.market, p.region_state);
      if (u) unnamed++;
      if (f) frozen++;
      if (u || f) either++;
    }
    return { unnamed, frozen, either };
  };

  return {
    scope,
    unconstrained: scopeIsEmpty(scope),
    ids: matched.map((p) => p.id),
    reasons,
    membership,
    membershipNotApplied: notApplied || proposal.notApplied,
    capped: all.length >= ROW_CAP,
    heldOut: {
      proposed: held(matched),
      confirmed: held(matched.filter((p) => membership.get(p.id) === 'included')),
    },
    counts: tally(membership),
    newlyProposed: proposal.inserted,
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

/**
 * CONFIRMING AND EXCLUDING, FROM THE SCREEN WHERE THE PROJECT IS READ.
 *
 * The register is where the row is judged, so it is where the judgement is
 * recorded. Both directions WRITE - `excluded` is a tombstone, never a delete,
 * or the next scope resolution would re-propose the same project and ask the
 * same question forever with no record that it had been answered.
 *
 * PRESSING THE SAME KEY TWICE RETURNS THE ROW TO `proposed`, which is the way
 * back and is still a write. Watch behaves the same way, so the register has one
 * rule for reversible marks rather than two.
 *
 * `set_by` records who, because a confirmation nobody can attribute is not much
 * of a confirmation.
 */
export function useMembershipMutation(
  clientId: string | null,
  onError?: (message: string) => void
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      projectId,
      status,
    }: {
      projectId: string;
      status: MembershipStatus;
    }) => {
      if (!clientId) throw new Error('no client is open, so there is nothing to confirm against');
      const who = (await supabase.auth.getUser()).data.user?.email ?? 'operator';
      await setMembership(clientId, projectId, status, who);
    },
    onError: (e) =>
      onError?.(e instanceof Error ? e.message : 'The membership change could not be saved.'),
    // The client view holds the counts, the row marks and the held-out
    // arithmetic, and the report gate reads the same table. Both are dropped.
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['client-view'] }),
        queryClient.invalidateQueries({ queryKey: ['report'] }),
      ]),
  });
}
