// CanadaBuys federal tender notices.
// Free open-data CSV, refreshed every ~2h. No API key required.
// File + column names verified against the official CanadaBuys data dictionary.
//
// Uses the "open tender notices" file (all currently-open opportunities). Unlike
// the original lead-scraper adapter this does NO keyword filtering: it normalizes
// every notice with a title + URL and lets the orchestrator's profile prefilter
// decide relevance (the old hardcoded list excluded fuel tenders).

import { parse } from 'csv-parse/sync';
import type { NormalizedLead } from './types';
import { toIso } from './types';

const CSV_URL =
  'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';

// Verified English column headers from the CanadaBuys data dictionary.
const COL = {
  title: 'title-titre-eng',
  description: 'tenderDescription-descriptionAppelOffres-eng',
  url: 'noticeURL-URLavis-eng',
  gsin: 'gsinDescription-nibsDescription-eng',
  unspsc: 'unspscDescription-eng',
  category: 'procurementCategory-categorieApprovisionnement',
  region: 'regionsOfOpportunity-regionAppelOffres-eng',
  closing: 'tenderClosingDate-appelOffresDateCloture',
  entity: 'contractingEntityName-nomEntitContractante-eng',
} as const;

type Row = Record<string, string | undefined>;

function field(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

export async function scrapeCanadaBuys(): Promise<NormalizedLead[]> {
  let text: string;
  try {
    const res = await fetch(CSV_URL, {
      headers: { 'User-Agent': 'philipkwong-agents/1.0 (+scraper)' },
    });
    if (!res.ok) {
      console.error(`CanadaBuys fetch failed: HTTP ${res.status}`);
      return [];
    }
    text = await res.text();
  } catch (error) {
    console.error('CanadaBuys fetch error:', error);
    return [];
  }

  let rows: Row[];
  try {
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      relax_column_count: true,
      bom: true,
    });
  } catch (error) {
    console.error('CanadaBuys CSV parse error:', error);
    return [];
  }

  const leads: NormalizedLead[] = [];
  for (const row of rows) {
    const title = field(row, COL.title);
    const url = field(row, COL.url);
    if (!title || !url) continue;

    const category = field(row, COL.gsin) || field(row, COL.unspsc);
    const region = field(row, COL.region);
    const closing = field(row, COL.closing);
    const entity = field(row, COL.entity);

    const raw_content = [
      `Tender: ${title}`,
      `Contracting entity: ${entity}`,
      `Category: ${category}`,
      `Region: ${region}`,
      `Closes: ${closing}`,
      '',
      field(row, COL.description),
    ].join('\n');

    leads.push({
      title,
      url,
      raw_content,
      company: entity || null,
      location: region || null,
      deadline: toIso(closing),
      value_estimate: null,
      source: 'canadabuys',
    });
  }

  console.log(`CanadaBuys: ${leads.length} open notices normalized from ${rows.length} rows`);
  return leads;
}
