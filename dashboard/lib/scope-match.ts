// WHY IS THIS PROJECT IN THIS CLIENT'S LIST?
//
// It is the question Simtec's list could not answer. A client view that shows
// forty projects and nothing about WHY each one is there is a list you either
// trust entirely or not at all, and "not at all" is the correct response to a
// list you cannot check. One wrong project in a client document is worse than
// four missing ones, and there was no way to spot the wrong one.
//
// So every project in a client view states the axes it matched: "market
// Anaheim, venue type Casino/Gaming, stage approved". That sentence is the
// difference between a filter and an argument.
//
// THE AXES ARE NOT ALL THE SAME KIND OF THING and this is where that shows.
// country, region and stage are columns ON the project. Market, venue type and
// development category are modes over its RECORDS, so a project matches those
// when any of its records carries a scope value - which is exactly how
// resolveScope and report-build already match them, and it means the matching
// VALUE has to come from the records rather than from the project row. A project
// filed as a Family Entertainment Center whose records name Casino/Gaming is in
// a casino scope, and the reason has to say Casino/Gaming or it is not a reason.

import { supabase } from './supabase';
import { resolveScope, type ClientScope } from './clients';
import type { Project } from './projects';

const ID_CHUNK = 150;
const PAGE = 1000;

export interface MatchedAxes {
  projectId: string;
  /** One phrase per axis, in the operator's words. */
  axes: string[];
}

function fold(v: string): string {
  return v.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The record-borne values each project actually carries, for the three axes
 * matched against records.
 *
 * One chunked read of three columns. The alternative - a query per scope value -
 * is thirty round trips for Simtec, whose scope names sixteen markets and
 * fourteen venue types.
 */
async function recordValues(
  ids: string[]
): Promise<Map<string, { markets: Set<string>; venues: Set<string>; categories: Set<string> }>> {
  const out = new Map<string, { markets: Set<string>; venues: Set<string>; categories: Set<string> }>();
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = ids.slice(i, i + ID_CHUNK);
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from('leads')
        .select('project_id,market,venue_type,development_category')
        .in('project_id', chunk)
        .neq('status', 'dismissed')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`scope match read failed: ${error.message}`);
      const rows = (data ?? []) as unknown as {
        project_id: string | null;
        market: string | null;
        venue_type: string | null;
        development_category: string | null;
      }[];
      for (const r of rows) {
        if (!r.project_id) continue;
        const e =
          out.get(r.project_id) ??
          { markets: new Set<string>(), venues: new Set<string>(), categories: new Set<string>() };
        if (r.market) e.markets.add(r.market);
        if (r.venue_type) e.venues.add(r.venue_type);
        if (r.development_category) e.categories.add(r.development_category);
        out.set(r.project_id, e);
      }
      if (rows.length < PAGE) break;
    }
  }
  return out;
}

/**
 * For each project, the scope axes it matched and on what value.
 *
 * AN UNCONSTRAINED AXIS IS NOT A MATCH. A scope naming no markets covers every
 * market, and listing "market" as a reason for all forty projects would be
 * noise dressed as evidence. Only axes the scope actually narrows appear.
 */
export async function matchedAxesFor(
  projects: Project[],
  scope: ClientScope
): Promise<Map<string, string[]>> {
  const { recordFacets } = resolveScope(scope);
  const wanted = {
    countries: new Set((scope.countries ?? []).map(fold)),
    regions: new Set((scope.regions ?? []).map(fold)),
    stages: new Set((scope.stages ?? []).map(fold)),
    markets: new Set((recordFacets.markets ?? []).map(fold)),
    venues: new Set((recordFacets.venue_types ?? []).map(fold)),
    categories: new Set((recordFacets.development_categories ?? []).map(fold)),
  };

  const needsRecords = wanted.markets.size > 0 || wanted.venues.size > 0 || wanted.categories.size > 0;
  const byProject = needsRecords ? await recordValues(projects.map((p) => p.id)) : new Map();

  const out = new Map<string, string[]>();
  for (const p of projects) {
    const axes: string[] = [];
    if (wanted.countries.size && p.country && wanted.countries.has(fold(p.country))) {
      axes.push(`country ${p.country}`);
    }
    if (wanted.regions.size && p.region_state && wanted.regions.has(fold(p.region_state))) {
      axes.push(`region ${p.region_state}`);
    }
    if (wanted.stages.size && p.stage && wanted.stages.has(fold(p.stage))) {
      axes.push(`stage ${p.stage}`);
    }
    const rec = byProject.get(p.id);
    const hits = (have: Set<string> | undefined, want: Set<string>): string[] =>
      have ? [...have].filter((v) => want.has(fold(v))) : [];
    const m = hits(rec?.markets, wanted.markets);
    if (m.length) axes.push(`market ${m.join(' / ')}`);
    const v = hits(rec?.venues, wanted.venues);
    if (v.length) axes.push(`venue type ${v.join(' / ')}`);
    const c = hits(rec?.categories, wanted.categories);
    if (c.length) axes.push(`category ${c.join(' / ')}`);
    out.set(p.id, axes);
  }
  return out;
}
