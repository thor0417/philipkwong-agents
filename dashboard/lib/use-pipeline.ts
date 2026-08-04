'use client';

// THE ACTIVE PIPELINE, AND THE LABELS THAT FOLLOW FROM IT.
//
// Which pipeline you are looking at is URL state, not component state. That is
// deliberate: it means a link to a filtered view carries the pipeline with it,
// the back button moves between pipelines, and nothing has to be re-selected
// after a reload. nuqs makes the URL the single source of truth rather than a
// copy of it.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQueryState, parseAsString } from 'nuqs';
import { fetchPipelines, type Pipeline } from './pipelines';
import { brandFor, PIPELINE_SEED, SEED_BRAND, type Brand } from './brand';

export const pipelineKeys = {
  all: ['pipelines'] as const,
};

/** The registry. Effectively static, so it is cached hard. */
export function usePipelineRegistry() {
  return useQuery({
    queryKey: pipelineKeys.all,
    queryFn: fetchPipelines,
    staleTime: 60 * 60_000,
    gcTime: 60 * 60_000,
  });
}

export interface ActivePipeline {
  pipeline: Pipeline;
  brand: Brand;
  /** Every pipeline that can currently be switched to. */
  options: Pipeline[];
  /** True until the registry has answered; labels are the seed until then. */
  resolving: boolean;
  setPipeline: (id: string) => void;
}

export function useActivePipeline(): ActivePipeline {
  const { data, isPending } = usePipelineRegistry();
  // History push, not replace: switching pipeline is a navigation, and the back
  // button should undo it.
  const [requested, setRequested] = useQueryState(
    'pipeline',
    parseAsString.withOptions({ history: 'push' })
  );

  return useMemo(() => {
    const all = data ?? [];
    const active = all.filter((p) => p.active);

    // An unknown or retired id in the URL falls back to the default rather than
    // rendering an empty shell. A stale bookmark should still land somewhere.
    const chosen =
      (requested ? all.find((p) => p.id === requested && p.active) : undefined) ??
      active[0] ??
      PIPELINE_SEED;

    const resolving = isPending || all.length === 0;

    return {
      pipeline: chosen,
      brand: resolving ? SEED_BRAND : brandFor(chosen),
      options: active,
      resolving,
      setPipeline: (id: string) => {
        // Clearing the param when selecting the default keeps the common URL
        // clean instead of pinning ?pipeline= on every link.
        void setRequested(id === active[0]?.id ? null : id);
      },
    };
  }, [data, isPending, requested, setRequested]);
}

/** Labels only, for the many components that need a name and nothing else. */
export function useBrand(): Brand {
  return useActivePipeline().brand;
}
