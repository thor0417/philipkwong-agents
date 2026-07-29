// Registry-tender cross-reference (post-pass).
//
// A tender whose buyer/company is also a licensed fuel entity (Track B registry)
// is a high-value signal. This pass matches registry company names against
// tender lead company names by normalized name, sets matched_counterparty = true
// on both sides, and boosts the tender lead's score.
//
// Runs after all source writes complete (orchestrator final pass).

import { supabaseAdmin } from '../../lib/supabase-admin';
import { selectAllPaged } from './page-select';

const SCORE_BOOST = 20;
const SCORE_CAP = 100;

// Normalize a company name: lowercase, strip legal suffixes, collapse to words.
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(
      /\b(pte|ltd|limited|bv|gmbh|nv|co|inc|llc|sarl|pvt|corp|corporation|company|sa|srl|ag|as|plc|holdings?)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
}

interface LeadRow {
  id: string;
  company: string | null;
  score: number | null;
}

export interface CrossRefResult {
  registryCount: number;
  tenderCount: number;
  matched: number;
}

export async function crossReference(): Promise<CrossRefResult> {
  // PAGED, both sides. Either lead_type can exceed 1000 rows, and an unbounded
  // select would then cross-reference an arbitrary first slice against another.
  const reg = await selectAllPaged<LeadRow>(
    'leads', 'id, company, score', (q) => (q as any).eq('lead_type', 'registry'), 'Cross-reference registry'
  );
  const ten = await selectAllPaged<LeadRow>(
    'leads', 'id, company, score', (q) => (q as any).eq('lead_type', 'tender'), 'Cross-reference tenders'
  );
  if (!reg.complete || !ten.complete) {
    console.error('Cross-reference: read incomplete; skipping rather than matching a partial set.');
    return { registryCount: 0, tenderCount: 0, matched: 0 };
  }

  const registryRows = reg.rows;
  const tenderRows = ten.rows;

  // Map normalized registry name -> registry row ids.
  const registryByNorm = new Map<string, string[]>();
  for (const r of registryRows) {
    if (!r.company) continue;
    const norm = normalizeCompany(r.company);
    if (!norm) continue;
    const ids = registryByNorm.get(norm) ?? [];
    ids.push(r.id);
    registryByNorm.set(norm, ids);
  }

  let matched = 0;
  const matchedRegistryIds = new Set<string>();

  for (const t of tenderRows) {
    if (!t.company) continue;
    const norm = normalizeCompany(t.company);
    if (!norm) continue;
    const regIds = registryByNorm.get(norm);
    if (!regIds) continue;

    const newScore = Math.min(SCORE_CAP, (t.score ?? 0) + SCORE_BOOST);
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ matched_counterparty: true, score: newScore })
      .eq('id', t.id);
    if (error) {
      console.error(`Cross-reference update failed for tender ${t.id}: ${error.message}`);
      continue;
    }
    matched++;
    for (const id of regIds) matchedRegistryIds.add(id);
    console.log(`Cross-reference match: "${t.company}" (tender) <-> registry [${norm}]`);
  }

  // Flag the registry side of each match too.
  for (const id of matchedRegistryIds) {
    await supabaseAdmin.from('leads').update({ matched_counterparty: true }).eq('id', id);
  }

  return { registryCount: registryRows.length, tenderCount: tenderRows.length, matched };
}
