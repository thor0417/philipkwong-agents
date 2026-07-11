// GLI lane (Grant Leisure International).
//
// Finds leisure, attraction, hospitality, gaming, and cultural venue
// opportunities. Runs entirely on its own path: Serper results in, an LLM
// inclusion gate + venue/signal tagging, project-level dedup, then a direct
// write with module 'gli'. It never touches the fuel or consulting lanes and is
// never fit-scored by the Haiku consulting scorer.
//
// Inclusion rule (the gate): keep only leads about a NEW or PLANNED visitor
// attraction, leisure destination, resort, hotel, casino, or cultural /
// entertainment venue at a planning, feasibility, development, engineering, or
// operator-selection stage. Operational business news, ticket-price stories,
// existing-venue operations, and generic non-leisure tenders are dropped.
//
// Every kept lead carries a venue_type and a signal_type. General News leads are
// kept but tagged so the dashboard can deprioritize them; non-leisure noise is
// dropped. Contacts are captured when the snippet exposes them, never required.

import Anthropic from '@anthropic-ai/sdk';
import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import type { NormalizedLead } from './sources/types';
import { scrapeSerper } from './sources/serper';
import { gliQueries } from './profiles';
import { normalizeCompany } from './cross-reference';

const MODEL = 'claude-haiku-4-5-20251001';
const GLI_MODULE = 'gli';

export const VENUE_TYPES = [
  'Theme Park',
  'Amusement Park',
  'Waterpark',
  'Family Entertainment Center',
  'Zoo',
  'Aquarium',
  'Museum',
  'Science Center',
  'Heritage/Cultural Site',
  'Hotel',
  'Resort',
  'Integrated Resort',
  'Casino/Gaming',
  'Expo/Exposition',
  'Leisure Destination/Mixed',
] as const;

export const SIGNAL_TYPES = [
  'Origination',
  'Feasibility RFP',
  'Engineering/Technical',
  'Operator/Management',
  'Investment/Funding',
  'General News',
] as const;

type VenueType = (typeof VENUE_TYPES)[number];
type SignalType = (typeof SIGNAL_TYPES)[number];

const PROMPT_HEAD = `You are the lead qualification agent for Grant Leisure International (GLI), which develops and advises on leisure, attraction, hospitality, gaming, and cultural venues worldwide.

Judge the item below and return STRICT JSON only (no preamble, no markdown).

INCLUSION RULE (the gate). Set "keep" to true ONLY when the item is about a NEW or PLANNED visitor attraction, leisure destination, resort, hotel, casino, or cultural / entertainment venue at a planning, feasibility, development, engineering, or operator-selection stage. Set "keep" to false for: operational business news, ticket-price or promotion stories, existing-venue day-to-day operations, earnings/attendance recaps, and any generic non-leisure tender (roads, utilities, generic engineering, IT, defence, etc.). Generic engineering (roads, utilities, plant) that is NOT for a leisure/attraction/hospitality/gaming/cultural venue fails the rule: keep=false.

When keep is true, tag TWO fields.

venue_type (choose exactly one):
Theme Park, Amusement Park, Waterpark, Family Entertainment Center, Zoo, Aquarium, Museum, Science Center, Heritage/Cultural Site, Hotel, Resort, Integrated Resort, Casino/Gaming, Expo/Exposition, Leisure Destination/Mixed

signal_type (choose exactly one):
- Origination: early announcement, no tender yet
- Feasibility RFP: a formal feasibility study or master-plan solicitation
- Engineering/Technical: engineering, design, or technical delivery FOR a leisure/attraction/hospitality/gaming/cultural venue (never generic roads/utilities)
- Operator/Management: seeking an operator or management partner
- Investment/Funding: capital moving into a leisure/attraction project
- General News: relevant to the sector but not yet an actionable project signal

RELEVANCE: Actionable project signals (Origination, Feasibility RFP, Engineering/Technical, Operator/Management, Investment/Funding) are the priority. General News is still kept (keep=true) but tagged General News. Pure non-leisure noise is keep=false.

Also extract, when present in the text (else null):
- project_name: the specific project/venue name (for dedup across articles). Prefer the venue/development name over the publisher.
- location: city / region / country of the project
- contact_name, contact_email, contact_phone: any named contact for the project

Respond in this exact JSON shape:
{
  "keep": true,
  "venue_type": "Resort",
  "signal_type": "Feasibility RFP",
  "project_name": "string or null",
  "location": "string or null",
  "contact_name": "string or null",
  "contact_email": "string or null",
  "contact_phone": "string or null",
  "reason": "one short sentence"
}

Item:
`;

export interface GliClassification {
  keep: boolean;
  venue_type: VenueType | null;
  signal_type: SignalType | null;
  project_name: string | null;
  location: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  reason: string;
}

function coerceEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  const hit = allowed.find((a) => a.toLowerCase() === value.trim().toLowerCase());
  return hit ?? null;
}

function cleanStr(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t || t.toLowerCase() === 'null' || t.toLowerCase() === 'none' || t === 'n/a') return null;
  return t;
}

function parseClassification(text: string): GliClassification | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced ? fenced[1] : text).trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) body = body.slice(first, last + 1);
  try {
    const p = JSON.parse(body);
    const keep = p.keep === true;
    return {
      keep,
      venue_type: keep ? coerceEnum(p.venue_type, VENUE_TYPES) : null,
      signal_type: keep ? coerceEnum(p.signal_type, SIGNAL_TYPES) : null,
      project_name: cleanStr(p.project_name),
      location: cleanStr(p.location),
      contact_name: cleanStr(p.contact_name),
      contact_email: cleanStr(p.contact_email),
      contact_phone: cleanStr(p.contact_phone),
      reason: cleanStr(p.reason) ?? '',
    };
  } catch {
    return null;
  }
}

const client = new Anthropic();
const MAX_CONCURRENCY = 6;
const MAX_RETRIES = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function classifyGli(lead: NormalizedLead): Promise<GliClassification> {
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: PROMPT_HEAD + `Title: ${lead.title}\nURL: ${lead.url}\n\n${lead.raw_content}`,
          },
        ],
      });
      break;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }

  const block = response.content[0];
  const text = block && block.type === 'text' ? block.text : '';
  const parsed = parseClassification(text);
  if (!parsed) {
    console.error(
      `GLI classify parse failed for "${lead.title.slice(0, 50)}". Raw: ${JSON.stringify(text.slice(0, 160))}`
    );
    // Fail closed: an unparseable judgement is dropped, never written blind.
    return {
      keep: false,
      venue_type: null,
      signal_type: null,
      project_name: null,
      location: null,
      contact_name: null,
      contact_email: null,
      contact_phone: null,
      reason: 'Parse error',
    };
  }
  // A kept lead with no usable venue_type is a malformed judgement: fail closed.
  if (parsed.keep && !parsed.venue_type) parsed.keep = false;
  return parsed;
}

// Classify a batch through a fixed-size worker pool. Results preserve order.
async function classifyBatch(leads: NormalizedLead[]): Promise<GliClassification[]> {
  const results = new Array<GliClassification>(leads.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < leads.length) {
      const i = next++;
      results[i] = await classifyGli(leads[i]);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, leads.length) }, worker);
  await Promise.all(workers);
  return results;
}

// Normalized project key for dedup: project name + location. Two articles about
// the same project collapse to one lead. Falls back to the (already
// URL-deduped) title when no project name was extracted, so distinct untitled
// items are not over-merged.
function projectKey(c: GliClassification, lead: NormalizedLead): string {
  const name = normalizeCompany(c.project_name ?? lead.title);
  const loc = normalizeCompany(c.location ?? '');
  return `${name}|${loc}`;
}

export interface GliReport {
  fetched: number;
  urlDeduped: number;
  kept: number;
  droppedNoise: number;
  projectDuplicates: number;
  written: number;
  writeFailed: number;
  perVenueType: Record<string, number>;
  perSignalType: Record<string, number>;
  samples: Array<{
    title: string;
    venue_type: string;
    signal_type: string;
    location: string;
    contact: boolean;
  }>;
}

const inc = (m: Record<string, number>, k: string): void => {
  m[k] = (m[k] ?? 0) + 1;
};

// Run the GLI lane over already-fetched Serper leads: gate, tag, dedup by
// project, and write (module 'gli'). Set GLI_NO_WRITE=1 to produce the report
// without persisting (useful before the 006 migration is applied).
export async function runGliLane(rawLeads: NormalizedLead[]): Promise<GliReport> {
  const fetched = rawLeads.length;

  // URL dedup (the adapter already dedups within itself; this guards merges).
  const byUrl = new Map<string, NormalizedLead>();
  for (const l of rawLeads) if (l.url && !byUrl.has(l.url)) byUrl.set(l.url, l);
  const leads = [...byUrl.values()];

  const classifications = await classifyBatch(leads);

  // Apply the inclusion gate, then dedup kept leads by project key.
  const perVenueType: Record<string, number> = {};
  const perSignalType: Record<string, number> = {};
  const seenProjects = new Set<string>();
  const kept: Array<{ lead: NormalizedLead; c: GliClassification }> = [];
  let droppedNoise = 0;
  let projectDuplicates = 0;

  for (let i = 0; i < leads.length; i++) {
    const lead = leads[i];
    const c = classifications[i];
    if (!c.keep) {
      droppedNoise++;
      continue;
    }
    const key = projectKey(c, lead);
    if (seenProjects.has(key)) {
      projectDuplicates++;
      continue;
    }
    seenProjects.add(key);
    kept.push({ lead, c });
  }

  const report: GliReport = {
    fetched,
    urlDeduped: leads.length,
    kept: kept.length,
    droppedNoise,
    projectDuplicates,
    written: 0,
    writeFailed: 0,
    perVenueType,
    perSignalType,
    samples: [],
  };

  const noWrite = process.env.GLI_NO_WRITE === '1';

  for (const { lead, c } of kept) {
    inc(perVenueType, c.venue_type ?? 'Unclassified');
    inc(perSignalType, c.signal_type ?? 'Unclassified');
    if (report.samples.length < 10) {
      report.samples.push({
        title: lead.title,
        venue_type: c.venue_type ?? '',
        signal_type: c.signal_type ?? '',
        location: c.location ?? '',
        contact: !!(c.contact_name || c.contact_email || c.contact_phone),
      });
    }

    if (noWrite) continue;

    const { error } = await supabaseAdmin.from('leads').upsert(
      {
        source: lead.source,
        url: lead.url,
        title: lead.title,
        raw_content: lead.raw_content,
        score: null,
        score_reason: `GLI lane: ${c.signal_type} (${c.venue_type}). ${c.reason}`,
        status: 'new',
        module: GLI_MODULE,
        industry: GLI_MODULE,
        company: c.project_name,
        location: c.location,
        deadline: null,
        value_estimate: null,
        lead_type: 'gli',
        venue_type: c.venue_type,
        signal_type: c.signal_type,
        contact_name: c.contact_name,
        contact_email: c.contact_email,
        contact_phone: c.contact_phone,
      },
      { onConflict: 'url' }
    );
    if (error) {
      console.error(`GLI write failed for ${lead.url}: ${error.message}`);
      report.writeFailed++;
      continue;
    }
    report.written++;
  }

  return report;
}

export function printGliReport(r: GliReport): void {
  const table = (m: Record<string, number>): string =>
    Object.keys(m).length
      ? Object.entries(m)
          .sort((a, b) => b[1] - a[1])
          .map(([k, v]) => `    ${String(v).padStart(4)}  ${k}`)
          .join('\n')
      : '    (none)';

  console.log('\n========== GLI LANE REPORT ==========');
  console.log(`Fetched from Serper:          ${r.fetched}`);
  console.log(`After URL dedup:              ${r.urlDeduped}`);
  console.log(`Kept after inclusion rule:    ${r.kept}`);
  console.log(`Dropped as noise:             ${r.droppedNoise}`);
  console.log(`Dropped as project duplicate: ${r.projectDuplicates}`);
  console.log(`Written to Supabase:          ${r.written}${r.writeFailed ? `  (write failures: ${r.writeFailed})` : ''}`);
  console.log('Kept by venue_type:');
  console.log(table(r.perVenueType));
  console.log('Kept by signal_type:');
  console.log(table(r.perSignalType));
  console.log('Sample GLI leads (up to 10): title | venue_type | signal_type | location | contact');
  for (const s of r.samples) {
    console.log(
      `    - ${s.title.slice(0, 55)} | ${s.venue_type} | ${s.signal_type} | ${s.location || '(none)'} | ${s.contact ? 'yes' : 'no'}`
    );
  }
  console.log('=====================================\n');
}

// Standalone entrypoint: fetch the GLI queries via Serper and run the lane.
// Kept separate from the full orchestrator so a GLI run does not fan out to
// every other source. Guarded so importing this module never triggers a run.
async function main(): Promise<void> {
  console.log('GLI lane starting...');
  const queries = gliQueries();
  if (queries.length === 0) {
    console.error('GLI lane: no queries configured (gli profile inactive or missing).');
    return;
  }
  const raw = await scrapeSerper(queries);
  const report = await runGliLane(raw);
  printGliReport(report);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('GLI lane failed:', err);
    process.exitCode = 1;
  });
}
