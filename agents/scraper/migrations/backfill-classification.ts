// One-off backfill: apply the current classification (classify.ts) to every lead
// already in the leads table, in place, without re-scraping. Routing mirrors the
// orchestrator's write-time lanes: signal sources -> signals lane; feasibility
// (incl. the IADB/CDB tourism sector-gate capture) -> feasibility; fuel-module
// leads -> classifyFuel; everything else -> classifyConsulting. It reads each
// row's stored text/source/company, so the tags match what a fresh scrape would
// now write. Idempotent: re-running yields the same tags.
//
// Run: node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-classification.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import {
  classifyFuel,
  classifyConsulting,
  isFeasibilityLead,
  classifyFeasibility,
  passesSectorGate,
  signalSector,
} from '../classify';
import type { NormalizedLead } from '../sources/types';

// Part A development banks whose tourism notices are captured on legitimacy
// (mirrors orchestrator.ts PART_A_BANK_SOURCES): an IADB/CDB notice that clears
// the tourism sector gate is feasibility even without feasibility keywords — the
// sector is the fit signal. Without this the backfill would re-route those bank
// leads through classifyConsulting and regress them out of the feasibility lane.
const PART_A_BANK_SOURCES = new Set(['iadb', 'cdb']);

// Signal-lane sources (mirrors orchestrator.ts SIGNAL_SOURCES). These Part B
// leads are captured in the signals lane — category 'signals', best-guess sector
// as the subcategory — and must NEVER be routed through consulting/feasibility/
// fuel here, or the backfill would strip their 'signals' category (breaking the
// dashboard Signals view). The orchestrator keeps them in their own lane; so must
// this backfill.
const SIGNAL_SOURCES = new Set([
  'fonatur',
  'bahamas_hoa',
  'confotur',
  'semarnat',
  'nepa_jm',
  'cayman_cpa',
]);

interface LeadRow {
  id: string;
  source: string | null;
  title: string | null;
  raw_content: string | null;
  company: string | null;
  location: string | null;
  deadline: string | null;
  value_estimate: string | null;
  url: string | null;
  module: string | null;
  is_cargo: boolean | null;
}

function toNormalized(row: LeadRow): NormalizedLead {
  return {
    title: row.title ?? '',
    url: row.url ?? '',
    raw_content: row.raw_content ?? '',
    company: row.company,
    location: row.location,
    deadline: row.deadline,
    value_estimate: row.value_estimate,
    source: row.source ?? '',
  };
}

async function main(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select(
      'id, source, title, raw_content, company, location, deadline, value_estimate, url, module, is_cargo'
    );
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as LeadRow[];
  console.log(`Backfilling classification on ${rows.length} leads...`);

  let fuel = 0;
  let consulting = 0;
  let updated = 0;
  let failed = 0;
  let cargoCleared = 0;
  let feasibility = 0;
  let signals = 0;

  for (const row of rows) {
    const lead = toNormalized(row);
    // Signals lane runs first (mirrors the orchestrator, which routes signal
    // sources entirely through the signals lane): keep category 'signals' and
    // re-derive the best-guess sector; never fall through to consulting/fuel.
    const isSignal = SIGNAL_SOURCES.has(row.source ?? '');
    // Feasibility lane next, across all remaining leads (mirrors the orchestrator):
    // a feasibility study is pulled into its own category regardless of module.
    // Part A extension: an IADB/CDB notice clearing the tourism sector gate is
    // captured as feasibility too, even without feasibility keywords.
    const isFeas =
      !isSignal &&
      (isFeasibilityLead(lead) ||
        (PART_A_BANK_SOURCES.has(row.source ?? '') && passesSectorGate(lead)));
    const isFuel = !isSignal && !isFeas && row.module === 'fuel';
    const tags = isSignal
      ? {
          category: 'signals',
          subcategory: signalSector(lead),
          product_type: null,
          is_cargo: false,
          volume_estimate: null,
          sector: null,
        }
      : isFeas
        ? classifyFeasibility(lead)
        : isFuel
          ? classifyFuel(lead)
          : classifyConsulting(lead);
    if (isSignal) signals++;
    else if (isFeas) feasibility++;
    else if (isFuel) fuel++;
    else consulting++;
    if (row.is_cargo === true && tags.is_cargo === false) cargoCleared++;

    const { error: upErr } = await supabaseAdmin
      .from('leads')
      .update({
        category: tags.category,
        subcategory: tags.subcategory,
        product_type: tags.product_type,
        is_cargo: tags.is_cargo,
        volume_estimate: tags.volume_estimate,
        sector: tags.sector,
      })
      .eq('id', row.id);
    if (upErr) {
      console.error(`Update failed for ${row.id}: ${upErr.message}`);
      failed++;
      continue;
    }
    updated++;
  }

  console.log(
    `Done. signals=${signals} feasibility=${feasibility} fuel=${fuel} consulting=${consulting} updated=${updated} failed=${failed} cargo_cleared=${cargoCleared}`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
