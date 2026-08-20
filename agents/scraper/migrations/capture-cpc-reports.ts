// STORE WHAT A CITY PLANNING COMMISSION REPORT STATES. New York's staff report.
//
//   npm run capture:cpc              report only, writes nothing
//   npm run capture:cpc -- --write   apply
//
// New York is the largest market in the corpus and carries ZERO conditions while
// one Clark County project carries 51 - because Legistar attaches staff reports
// and we read them. The New York equivalent is the CPC report, published at
// nyc.gov/assets/planning/download/pdf/about/cpc/<ULURP>.pdf.
//
// WHAT IT DOES NOT DO. It does not read conditions. Measured: the Clark
// conditions extractor returns 0, 5 and 0 over three real CPC reports, and the 5
// are an accident of one containing a literal "CONDITIONS:" line. See
// readers/cpc-report and the golden case
// a-legal-resolution-is-not-an-administrative-checklist.
//
// THE ULURP NUMBER COMES FROM A PUBLISHED FIELD, NEVER FROM PROSE. nyc-zap
// writes `ULURP numbers:` from r.ulurp_numbers, a column on the dataset row.
// Measured: prose finds the same 28 and nothing more, so a regex over the body
// buys nothing and risks taking a cross-reference to another project.
//
// THE APPLICANT IS WRITTEN UNGATED, DELIBERATELY. Two of the seven reports
// examined name a public body - the Port Authority and DCP itself - and the
// report states no type. applicant_type is published by ZAP alone, and an
// untyped applicant is ungated EVERYWHERE else in this system because null means
// the source did not say, never that the applicant is private. Making an
// exception here would be inconsistent, and the only way to make one is to read
// the name, which is the rule this codebase refuses. See the golden case
// a-cpc-report-names-a-public-applicant-in-plain-text.
//
// IT NEVER OVERWRITES AN APPLICANT WE ALREADY HOLD. A ZAP row's own applicant is
// the source's structured statement; this is a second reading of a different
// document, and a fuller string is not a better fact.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { readCpcReport } from '../readers/cpc-report';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

const WRITE = process.argv.includes('--write');
const UA = 'philipkwong-agents/1.0 (+development intelligence)';
const CPC = (n: string) => `https://www.nyc.gov/assets/planning/download/pdf/about/cpc/${n}.pdf`;

// Six digits and a two-to-four letter action/borough suffix. The report is filed
// under the BARE SIX DIGITS.
const ULURP_RE = /\b(\d{6})([A-Z]{2,4})\b/g;

interface Lead {
  id: string;
  title: string | null;
  source: string | null;
  status: string | null;
  project_id: string | null;
  applicant: string | null;
  raw_content: string | null;
  filing_facts: FilingFact[] | null;
  primary_document_url: string | null;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return out;
}

function publishedUlurps(raw: string | null | undefined): string[] {
  const m = /^ULURP numbers:\s*(.+)$/m.exec(String(raw ?? ''));
  if (!m) return [];
  const out: string[] = [];
  ULURP_RE.lastIndex = 0;
  let hit: RegExpExecArray | null;
  while ((hit = ULURP_RE.exec(m[1]))) out.push(hit[1]);
  return [...new Set(out)];
}

async function fetchReport(bare: string): Promise<string | null> {
  try {
    const res = await fetch(CPC(bare), { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // The first bytes decide, never the status: NYC hosts serve soft 404s. See
    // the golden case a-200-is-not-a-live-page.
    if (buf.subarray(0, 5).toString('latin1') !== '%PDF-') return null;
    const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
    return String((await pdf(buf)).text ?? '');
  } catch {
    return null;
  }
}

/**
 * THE RE-CHECK, FOR THE GOVERNMENT LANE.
 *
 * 15 of the 28 ULURP numbers the corpus holds return no report yet: the
 * Commission has not voted on them. That is not a miss, it is a matter to
 * re-check - and fifteen matters awaiting a Commission vote is the movement a
 * weekly report is sold on.
 *
 * It is cheap enough to run on every capture. Measured: a CPC report costs a
 * median 497ms to fetch and parse, four times cheaper than a Clark County staff
 * report, so the whole New York set is about six seconds and the misses are
 * faster than that.
 *
 * Errors are swallowed to a line rather than thrown: this runs at the END of a
 * capture that has already written its records, and a New York PDF host having
 * a bad afternoon must not fail a run that captured Clark County correctly.
 */
export async function recheckCpcReports(): Promise<void> {
  try {
    await main(true);
  } catch (e) {
    console.error(`CPC re-check failed (records already written are unaffected): ${String(e).slice(0, 160)}`);
  }
}

async function main(write = WRITE): Promise<void> {
  const projects = await pageAll<{ id: string; name: string; market: string | null; module: string | null; status: string | null; country: string | null; stage: string | null }>(
    'projects',
    'id,name,market,module,status,country,stage'
  );
  const live = new Map(
    projects
      .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY && p.status !== 'dismissed' && inCorpusScope(p.country))
      .map((p) => [p.id, p])
  );
  const nyIds = new Set([...live.values()].filter((p) => /new york/i.test(String(p.market ?? ''))).map((p) => p.id));

  const leads = await pageAll<Lead>(
    'leads',
    'id,title,source,status,project_id,applicant,raw_content,filing_facts,primary_document_url'
  );
  const nyLeads = leads.filter((l) => l.status !== 'dismissed' && l.project_id && nyIds.has(l.project_id));

  // ---- FACT REACH BEFORE ----------------------------------------------------
  const projectsWithFactsBefore = new Set(
    nyLeads.filter((l) => (l.filing_facts ?? []).length > 0).map((l) => l.project_id!)
  );
  const projectsWithApplicantBefore = new Set(
    nyLeads.filter((l) => String(l.applicant ?? '').trim()).map((l) => l.project_id!)
  );

  console.log('='.repeat(96));
  console.log(`CPC REPORTS  ${write ? '(WRITING)' : '(dry run, nothing written)'}`);
  console.log('='.repeat(96));
  console.log(`  live New York projects:                       ${nyIds.size}`);
  console.log(`  New York projects with ANY filing fact today: ${projectsWithFactsBefore.size}`);
  console.log(`  New York projects with an applicant today:    ${projectsWithApplicantBefore.size}`);
  console.log('');

  const targets: { lead: Lead; bare: string }[] = [];
  for (const l of nyLeads) {
    for (const bare of publishedUlurps(l.raw_content)) targets.push({ lead: l, bare });
  }
  console.log(`  records carrying a published ULURP number: ${new Set(targets.map((t) => t.lead.id)).size}`);
  console.log(`  distinct ULURP numbers to fetch:           ${new Set(targets.map((t) => t.bare)).size}`);
  console.log('');

  const gained = { applicant: new Set<string>(), decision: new Set<string>(), vote: new Set<string>() };
  let fetched = 0;
  let missing = 0;
  let rejected = 0;
  let written = 0;

  // One request per (record, number), sequentially and at a walking pace. The
  // whole New York set costs about six seconds of fetch; politeness is free.
  for (const { lead, bare } of targets) {
    const text = await fetchReport(bare);
    await new Promise((r) => setTimeout(r, 400));
    if (!text) {
      missing++;
      continue;
    }
    fetched++;
    const reading = readCpcReport(text);
    let facts: FilingFact[];
    try {
      // ALL OR NOTHING, the same contract capture:filings has: a record whose
      // read fails the guard stores nothing rather than the part that passed.
      facts = verifyFilingFacts(reading.facts, text);
    } catch (e) {
      rejected++;
      console.log(`  REJECTED ${bare}: ${String(e).slice(0, 140)}`);
      continue;
    }
    const pid = lead.project_id!;
    if (reading.applicant && !String(lead.applicant ?? '').trim()) gained.applicant.add(pid);
    if (facts.some((f) => f.kind === 'commission_action')) gained.decision.add(pid);
    if (facts.some((f) => f.kind === 'the_vote')) gained.vote.add(pid);

    console.log(
      `  ${bare}  ${String(live.get(pid)!.name).slice(0, 36).padEnd(37)} ` +
        `${facts.length} fact(s)  applicant=${reading.applicant ? reading.applicant.slice(0, 34) : '(none)'}`
    );

    if (!write) continue;
    // MERGED, NOT REPLACED. A record may already carry facts read from its own
    // ZAP row; the CPC report is a second document about the same application.
    const existing = lead.filing_facts ?? [];
    const merged = [...existing, ...facts.filter((f) => !existing.some((e) => e.kind === f.kind && e.display === f.display))];
    const patch: Record<string, unknown> = { filing_facts: merged };
    if (reading.applicant && !String(lead.applicant ?? '').trim()) patch.applicant = reading.applicant;
    if (!lead.primary_document_url) patch.primary_document_url = CPC(bare);
    const { error } = await supabaseAdmin.from('leads').update(patch).eq('id', lead.id);
    if (error) {
      console.log(`  WRITE FAILED ${lead.id}: ${error.message}`);
      continue;
    }
    written++;
  }

  console.log('');
  console.log('-'.repeat(96));
  console.log(`  reports fetched:                 ${fetched}`);
  console.log(`  numbers with no report yet:      ${missing}   (the Commission has not reported; re-check later)`);
  console.log(`  reads rejected by the guard:     ${rejected}`);
  console.log(`  records written:                 ${written}`);
  console.log('');
  console.log(`  New York projects GAINING an applicant: ${gained.applicant.size}`);
  console.log(`  New York projects GAINING a decision:   ${gained.decision.size}`);
  console.log(`  New York projects GAINING a vote:       ${gained.vote.size}`);
  console.log('');
  const after = new Set([...projectsWithFactsBefore, ...gained.decision, ...gained.vote]);
  console.log(`  NEW YORK FACT REACH  before ${projectsWithFactsBefore.size} of ${nyIds.size}   after ${after.size} of ${nyIds.size}`);
  if (!WRITE) console.log('\nDRY RUN. Nothing written. Re-run with --write to apply.');
  console.log('');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
