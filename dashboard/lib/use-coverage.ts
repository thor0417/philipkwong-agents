'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchCoverage } from './coverage-query';

export const coverageKeys = {
  all: ['coverage'] as const,
  report: (module: string) => ['coverage', 'report', module] as const,
};

// ONE READ, SHARED BY THE RAIL AND BY HEALTH. Both screens ask the same
// question, so they ask it once: a second implementation is a second chance to
// disagree, which is exactly what happened between the geography rail's market
// count and the market filter.
export function useCoverage(module: string) {
  return useQuery({
    queryKey: coverageKeys.report(module),
    queryFn: () => fetchCoverage(module),
    staleTime: 60_000,
  });
}
