// CanadaBuys federal tender notices source.
// Free open-data CSV, refreshed every ~2h. No API key required.
// File + column names verified against the official CanadaBuys data dictionary.
//
// Uses the "open tender notices" file (all currently-open opportunities) rather
// than "new" (today's only), which is frequently near-empty off-hours.

import { parse } from 'csv-parse/sync';
import type { RawLead } from './scraper';
import { toIso } from '../scraper/sources/types';

const CSV_URL =
  'https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv';

// Cap how many filtered tenders we forward to the scorer (controls LLM spend).
// The keyword filter is deliberately loose; the Haiku scorer is the real gate,
// so this only needs to be high enough not to starve relevant tenders.
const MAX_TENDERS = 200;

// Relevance keywords matched (word-boundary, case-insensitive) against the
// title, description, and category columns.
const KEYWORDS = [
  'compliance',
  'regulatory',
  'regulation',
  'quality management',
  'qms',
  'iso',
  'certification',
  'licensing',
  'licence',
  'accreditation',
  'strategy',
  'strategic',
  'advisory',
  'consulting services',
  'consultant',
  'cannabis',
  'medical device',
  'pharmaceutical',
  'good manufacturing',
  'risk management',
  'governance',
  'feasibility',
  'commercialization',
  'market entry',
  'automation',
  'artificial intelligence',
  'management consulting',
  'professional services',
  'business analysis',
  'policy',
  'training',
  'research',
  'audit',
  'assessment',
  'review',
  'health',
  'technology',
  'digital',
  'transformation',
  'government relations',
];

const RELEVANCE = new RegExp(`\\b(${KEYWORDS.join('|')})\\b`, 'i');

// Dominant federal-tender noise that matches RELEVANCE only incidentally
// (construction RFPs cite "ISO"/"compliance"). Drop before the scorer so these
// don't starve the MAX_TENDERS cap. The Haiku scorer still gates the rest.
const EXCLUDE = /construction source list|source list for construction/i;

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
  published: 'publicationDate-datePublication',
  entity: 'contractingEntityName-nomEntitContractante-eng',
} as const;

type Row = Record<string, string | undefined>;

function field(row: Row, key: string): string {
  return (row[key] ?? '').trim();
}

export async function scrapeCanadaBuys(): Promise<RawLead[]> {
  let text: string;
  try {
    const res = await fetch(CSV_URL, {
      headers: { 'User-Agent': 'philipkwong-agents/1.0 (+lead-scraper)' },
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

  const leads: RawLead[] = [];
  for (const row of rows) {
    const title = field(row, COL.title);
    const url = field(row, COL.url);
    if (!title || !url) continue;

    const category = field(row, COL.gsin) || field(row, COL.unspsc);
    const haystack = `${title} ${field(row, COL.description)} ${category} ${field(
      row,
      COL.category
    )}`;
    if (!RELEVANCE.test(haystack)) continue;
    if (EXCLUDE.test(title)) continue;

    const content = [
      `Tender: ${title}`,
      `Contracting entity: ${field(row, COL.entity)}`,
      `Category: ${category}`,
      `Region: ${field(row, COL.region)}`,
      `Closes: ${field(row, COL.closing)}`,
      '',
      field(row, COL.description),
    ].join('\n');

    leads.push({
      title,
      url,
      content,
      source: 'canadabuys',
      deadline: toIso(field(row, COL.closing)),
      published_date: toIso(field(row, COL.published)),
    });
    if (leads.length >= MAX_TENDERS) {
      console.warn(`CanadaBuys: hit MAX_TENDERS cap (${MAX_TENDERS}); newer matches skipped.`);
      break;
    }
  }

  console.log(`CanadaBuys: ${leads.length} relevant tenders from ${rows.length} notices`);
  return leads;
}
