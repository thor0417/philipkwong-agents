'use client';

// The clients data layer. Same shape as use-projects: keyed reads, plain
// mutations that invalidate rather than patch the cache by hand.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addContact,
  addScope,
  createClient,
  fetchAllScopes,
  fetchClient,
  fetchClients,
  fetchContacts,
  fetchScopes,
  updateClient,
  updateScope,
  type Client,
  type ClientIntake,
  type ClientScope,
} from './clients';
import { fetchScopePreview } from './scope-preview';
import type { ResolvedPeriod } from './period';

export const clientKeys = {
  all: ['clients'] as const,
  list: () => ['clients', 'list'] as const,
  detail: (id: string) => ['clients', 'detail', id] as const,
  contacts: (id: string) => ['clients', 'contacts', id] as const,
  scopes: (id: string) => ['clients', 'scopes', id] as const,
  allScopes: () => ['clients', 'scopes', 'all'] as const,
  preview: (scopeId: string, period: string) => ['clients', 'preview', scopeId, period] as const,
};

export function useClients() {
  return useQuery({ queryKey: clientKeys.list(), queryFn: fetchClients });
}

export function useClient(id: string) {
  return useQuery({ queryKey: clientKeys.detail(id), queryFn: () => fetchClient(id), enabled: !!id });
}

export function useContacts(id: string) {
  return useQuery({ queryKey: clientKeys.contacts(id), queryFn: () => fetchContacts(id), enabled: !!id });
}

export function useScopes(id: string) {
  return useQuery({ queryKey: clientKeys.scopes(id), queryFn: () => fetchScopes(id), enabled: !!id });
}

export function useAllScopes() {
  return useQuery({ queryKey: clientKeys.allScopes(), queryFn: fetchAllScopes });
}

/**
 * The live counts a scope currently matches.
 *
 * The whole scope object joins the cache key, not just its id: editing a scope
 * and seeing the previous scope's counts would defeat the point of a preview,
 * and that is exactly what keying on the id alone would do.
 */
export function useScopePreview(scope: ClientScope | null, period: ResolvedPeriod) {
  return useQuery({
    queryKey: [
      'clients',
      'preview',
      scope?.id ?? '',
      JSON.stringify([
        scope?.pipeline_id,
        scope?.countries,
        scope?.regions,
        scope?.markets,
        scope?.stages,
        scope?.development_categories,
        scope?.venue_types,
      ]),
      period.since ?? '',
      period.until ?? '',
    ],
    queryFn: () => fetchScopePreview(scope as ClientScope, period),
    enabled: !!scope,
  });
}

export function useClientMutations(opts: { onError?: (m: string) => void } = {}) {
  const qc = useQueryClient();
  const fail = (e: unknown) => opts.onError?.(e instanceof Error ? e.message : String(e));
  const refresh = (id?: string) => {
    void qc.invalidateQueries({ queryKey: clientKeys.all });
    if (id) void qc.invalidateQueries({ queryKey: clientKeys.detail(id) });
  };

  return {
    create: useMutation({
      mutationFn: (intake: ClientIntake) => createClient(intake),
      onSuccess: () => refresh(),
      onError: fail,
    }),
    patchClient: useMutation({
      mutationFn: (v: { id: string; patch: Partial<Client> }) => updateClient(v.id, v.patch),
      onSuccess: (_d, v) => refresh(v.id),
      onError: fail,
    }),
    patchScope: useMutation({
      mutationFn: (v: { id: string; clientId: string; patch: Partial<ClientScope> }) =>
        updateScope(v.id, v.patch),
      onSuccess: (_d, v) => refresh(v.clientId),
      onError: fail,
    }),
    newContact: useMutation({
      mutationFn: (v: {
        clientId: string;
        contact: { name: string; email: string; role: string; primary_contact: boolean };
      }) => addContact(v.clientId, v.contact),
      onSuccess: (_d, v) => refresh(v.clientId),
      onError: fail,
    }),
    newScope: useMutation({
      mutationFn: (v: { clientId: string; pipelineId: string }) => addScope(v.clientId, v.pipelineId),
      onSuccess: (_d, v) => refresh(v.clientId),
      onError: fail,
    }),
  };
}
