// THE PIPELINE REGISTRY, dashboard side.
//
// Mirrors agents/scraper/pipelines.ts, which is the authority. The dashboard is
// its own Next.js project and cannot import the root module - the same
// constraint that makes dashboard/lib/taxonomy.ts a mirror.
//
// THE IDENTITY IS NO LONGER DECLARED HERE. It used to be:
//
//     export const LIVE_PIPELINE_STORAGE_KEY = 'gli';   // a literal
//
// while the agent side derived the same value through storageKeyFor(). Two
// packages, two declarations, no shared line of code - and only this one deploys
// to Vercel. So the halves could disagree about the name of the thing every
// register query is scoped to, and a query scoped to a key no row carries
// returns nothing, which looks exactly like a quiet week rather than like a bug.
//
// Both packages now read lib/pipeline-id.ts at the repo root. It is import-free,
// which is what makes the crossing safe: a file that imports nothing cannot
// reach for a root node_modules that Vercel never creates.

import { supabase } from './supabase';
import {
  HOSPITALITY_ID,
  LEGACY_HOSPITALITY_KEY,
  TOLERATE_LEGACY_HOSPITALITY_KEY,
  LIVE_PIPELINE_STORAGE_KEY,
  storageKeyFor,
  hospitalityModuleValues,
  isHospitalityModule,
  moduleQueryValues,
  moduleQueryPredicate,
  notHospitalityFilter,
} from '../../lib/pipeline-id';

export interface Pipeline {
  id: string;
  name: string;
  short_name: string;
  brand_name: string | null;
  brand_logo: string | null;
  active: boolean;
  retired_reason: string | null;
  sort_order: number;
}

// Re-exported so every existing dashboard import keeps its path. The values
// come from the root module; nothing here declares one.
export {
  HOSPITALITY_ID,
  LEGACY_HOSPITALITY_KEY,
  TOLERATE_LEGACY_HOSPITALITY_KEY,
  LIVE_PIPELINE_STORAGE_KEY,
  storageKeyFor,
  hospitalityModuleValues,
  isHospitalityModule,
  moduleQueryValues,
  moduleQueryPredicate,
  notHospitalityFilter,
};

// The registry, for anything that needs to LIST pipelines (a switcher, a
// delivery header that needs the brand name). Reads are cheap and cached by the
// query layer; this is deliberately not wired into every page, because today
// there is exactly one active pipeline and a switcher would be a control with
// one option.
export async function fetchPipelines(): Promise<Pipeline[]> {
  const { data, error } = await supabase
    .from('pipelines')
    .select('id,name,short_name,brand_name,brand_logo,active,retired_reason,sort_order')
    .order('sort_order');
  if (error) {
    console.error(`pipelines unreadable: ${error.message}`);
    return [];
  }
  return (data ?? []) as Pipeline[];
}

export async function fetchActivePipelines(): Promise<Pipeline[]> {
  return (await fetchPipelines()).filter((p) => p.active);
}
