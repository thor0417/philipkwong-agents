'use client';

// Query wiring for the company graph. Thin on purpose: every question lives in
// lib/companies.ts so the Project page and the Company page ask it the same way.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchCompany,
  fetchCompanyProjects,
  fetchProjectParties,
  fetchRelatedCompanies,
  fetchRelatedProjects,
  fetchPlayers,
  searchCompanies,
  mergeCompanies,
} from './companies';

export const companyKeys = {
  all: ['companies'] as const,
  one: (id: string) => ['companies', 'one', id] as const,
  projects: (id: string) => ['companies', 'projects', id] as const,
  related: (id: string) => ['companies', 'related', id] as const,
  parties: (projectId: string) => ['companies', 'parties', projectId] as const,
  relatedProjects: (projectId: string) => ['companies', 'related-projects', projectId] as const,
  search: (term: string) => ['companies', 'search', term] as const,
  players: (module: string) => ['companies', 'players', module] as const,
};

export function useCompany(id: string | null) {
  return useQuery({
    queryKey: companyKeys.one(id ?? ''),
    queryFn: () => fetchCompany(id as string),
    enabled: !!id,
  });
}

export function useCompanyProjects(id: string | null) {
  return useQuery({
    queryKey: companyKeys.projects(id ?? ''),
    queryFn: () => fetchCompanyProjects(id as string),
    enabled: !!id,
  });
}

export function useRelatedCompanies(id: string | null) {
  return useQuery({
    queryKey: companyKeys.related(id ?? ''),
    queryFn: () => fetchRelatedCompanies(id as string),
    enabled: !!id,
  });
}

export function useProjectParties(projectId: string | null) {
  return useQuery({
    queryKey: companyKeys.parties(projectId ?? ''),
    queryFn: () => fetchProjectParties(projectId as string),
    enabled: !!projectId,
  });
}

export function useRelatedProjects(projectId: string | null, market: string | null) {
  return useQuery({
    queryKey: [...companyKeys.relatedProjects(projectId ?? ''), market],
    queryFn: () => fetchRelatedProjects(projectId as string, market),
    enabled: !!projectId,
  });
}

// EVERY PLAYER, AGGREGATED. One query for the whole list rather than one per
// row: a screen that issues 182 requests to draw 182 rows is not a screen.
export function usePlayers(module: string) {
  return useQuery({
    queryKey: companyKeys.players(module),
    queryFn: () => fetchPlayers(module),
    staleTime: 60_000,
  });
}

export function useCompanySearch(term: string) {
  return useQuery({
    queryKey: companyKeys.search(term),
    queryFn: () => searchCompanies(term),
    enabled: term.trim().length >= 2,
  });
}

export function useMergeCompanies(onError?: (message: string) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ winnerId, loserId }: { winnerId: string; loserId: string }) =>
      mergeCompanies(winnerId, loserId),
    onError: (e) => onError?.(e instanceof Error ? e.message : 'Merge failed.'),
    // A merge moves links between companies and changes who appears on a
    // project, so the project graph is invalidated too, not just the companies.
    onSettled: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: companyKeys.all }),
        client.invalidateQueries({ queryKey: ['projects'] }),
      ]),
  });
}
