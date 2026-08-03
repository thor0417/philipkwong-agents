// THE PIPELINE REGISTRY, dashboard side.
//
// Mirrors agents/scraper/pipelines.ts, which is the authority. The dashboard is
// its own Next.js project and cannot import the root module - the same
// constraint that makes dashboard/lib/taxonomy.ts a mirror.
//
// WHY THE ID AND THE STORED VALUE DIFFER. The pipeline's id is 'hospitality';
// the value in leads.module and projects.module is 'gli', because that is what
// ~1,400 existing rows carry. Rewriting them is a DATA migration (024) that is
// deliberately separate from the schema and the code, so both strings are
// correct at once and neither is a magic literal scattered through components.
//
// Every dashboard query now scopes by LIVE_PIPELINE_STORAGE_KEY and MEANS the
// hospitality pipeline. When 024 lands, this file changes and nothing else does.

import { supabase } from './supabase';

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

export const HOSPITALITY_ID = 'hospitality';

// The `module` value that identifies the live pipeline's rows today.
export const LIVE_PIPELINE_STORAGE_KEY = 'gli';

export function storageKeyFor(pipelineId: string): string {
  return pipelineId === HOSPITALITY_ID ? LIVE_PIPELINE_STORAGE_KEY : pipelineId;
}

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
