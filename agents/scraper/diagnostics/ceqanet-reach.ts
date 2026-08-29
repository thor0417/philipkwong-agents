// READ-ONLY. BRIEF Q ITEM 5: how far does the CEQAnet CSV route reach, and what
// would its 55 fields add to a California project that has none of them?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/ceqanet-reach.ts [--fetch]
//
// Nothing is written and no reader is built. --fetch pulls the CSV for every
// reachable SCH, one request at a walking pace, and reports which of the 55
// fields are populated per project.
//
// PUBLISHED FIELD AND PROSE ARE COUNTED APART, and never merged. That separation
// is not fastidiousness: a week ago a ULURP count that matched the literal word
// "ULURP" as well as the identifier reported 123 where the reachable set was 28,
// and the inflated figure reached a brief. See the golden case
// a-regex-that-counts-the-keyword-not-the-identifier.
//
//   PUBLISHED  the project holds a ceqanet record, whose URL IS the SCH. The
//              source stating its own identifier.
//   PROSE      an SCH-shaped number found in the text of some other record.
//              Could be a cross-reference to a neighbouring project, a number
//              quoted in passing, or a misread, and is reported as a candidate
//              rather than as reach.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { ceqanetSchOf } from '../sources/ceqanet';
import { isHospitalityModule } from '../pipelines';

const FETCH = process.argv.includes('--fetch');
const UA = 'philipkwong-agents/1.0 (+development intelligence)';
const CSV = (sch: string) => `https://ceqanet.lci.ca.gov/Search?Sch=${sch}&OutputFormat=CSV`;

// AN SCH NUMBER AS CEQAnet ISSUES IT: YYYYMM then four digits. Anchored on the
// year and month so a ten-digit phone number, a parcel number or an ordinance
// reference cannot match. Deliberately NOT the loose SCH_SHAPE the adapter uses
// to validate an already-identified SCH - that one is for a string already known
// to be an SCH, this one is looking for it in prose.
const SCH_IN_PROSE = /\b(?:19|20)\d{2}(?:0[1-9]|1[0-2])\d{4}\b/g;

interface Row { id: string; name: string; market: string | null; region_state: string | null; country: string | null; module: string | null; status: string | null; stage: string | null }
interface Lead { id: string; project_id: string | null; source: string | null; url: string | null; title: string | null; raw_content: string | null; status: string | null; lifecycle: string | null; filing_facts: unknown }

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function main(): Promise<void> {
  const projects = await pageAll<Row>('projects', 'id,name,market,region_state,country,module,status,stage');
  const leads = await pageAll<Lead>('leads', 'id,project_id,source,url,title,raw_content,status,lifecycle,filing_facts');

  const live = projects.filter((p) => isHospitalityModule(p.module) && p.status !== 'dismissed' && inCorpusScope(p.country));
  // CALIFORNIA, PLUS ANY PROJECT HOLDING A CEQANET RECORD WHATEVER ITS STATE.
  // CEQAnet is a California-only source, so a project holding one of its records
  // IS in California whether or not geography resolved. Measured: '1020 West
  // Imperial Highway' holds a live CEQAnet record and carries region_state null,
  // so a state equality alone would have reported the reach one project short.
  const ceqanetProjectIds = new Set(
    leads
      .filter((l) => l.source === 'ceqanet' && l.status !== 'dismissed' && l.lifecycle !== 'retired' && l.project_id)
      .map((l) => String(l.project_id))
  );
  const ca = live.filter((p) => p.region_state === 'California' || ceqanetProjectIds.has(p.id));
  const byProject = new Map<string, Lead[]>();
  for (const l of leads) {
    if (!l.project_id || l.status === 'dismissed' || l.lifecycle === 'retired') continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  console.log('='.repeat(100));
  console.log('CEQANET REACH ACROSS LIVE CALIFORNIA PROJECTS');
  console.log('='.repeat(100));
  console.log(`live California projects (register predicate, dormant included): ${ca.length}`);

  const publishedByProject = new Map<string, Set<string>>();
  const proseByProject = new Map<string, Set<string>>();
  for (const p of ca) {
    const recs = byProject.get(p.id) ?? [];
    for (const r of recs) {
      const sch = ceqanetSchOf(r.url ?? '');
      if (sch) {
        if (!publishedByProject.has(p.id)) publishedByProject.set(p.id, new Set());
        publishedByProject.get(p.id)!.add(sch);
      }
      const text = `${r.title ?? ''} ${r.raw_content ?? ''}`;
      SCH_IN_PROSE.lastIndex = 0;
      for (const m of text.matchAll(SCH_IN_PROSE)) {
        if (!proseByProject.has(p.id)) proseByProject.set(p.id, new Set());
        proseByProject.get(p.id)!.add(m[0]);
      }
    }
  }
  // A number that is BOTH published and in prose is published; it is the same fact.
  for (const [pid, set] of proseByProject) {
    const pub = publishedByProject.get(pid);
    if (!pub) continue;
    for (const s of pub) set.delete(s);
    if (!set.size) proseByProject.delete(pid);
  }

  const allPublished = [...new Set([...publishedByProject.values()].flatMap((s) => [...s]))];
  const allProse = [...new Set([...proseByProject.values()].flatMap((s) => [...s]))];
  console.log(`  projects holding a ceqanet record (SCH IS the url)          : ${publishedByProject.size}`);
  console.log(`  distinct published SCH numbers                              : ${allPublished.length}`);
  console.log(`  projects with an SCH-SHAPED number only in prose             : ${proseByProject.size}`);
  console.log(`  distinct prose-only candidates                               : ${allProse.length}`);
  console.log(`  California projects with NO route to an SCH at all           : ${ca.length - publishedByProject.size - proseByProject.size}`);

  console.log('\n--- PROJECTS WITH A PUBLISHED SCH ---');
  for (const [pid, set] of publishedByProject) {
    const p = ca.find((x) => x.id === pid)!;
    console.log(`  ${p.name.slice(0, 52).padEnd(54)} ${p.market ?? '-'}   ${[...set].join(', ')}`);
  }
  if (proseByProject.size) {
    console.log('\n--- PROSE-ONLY CANDIDATES, reported as candidates and not as reach ---');
    for (const [pid, set] of proseByProject) {
      const p = ca.find((x) => x.id === pid)!;
      console.log(`  ${p.name.slice(0, 52).padEnd(54)} ${p.market ?? '-'}   ${[...set].join(', ')}`);
    }
  }

  if (!FETCH) {
    console.log('\n(--fetch to pull the CSV for each published SCH and report what its fields hold)');
    return;
  }

  // ---- WHAT THE 55 FIELDS ACTUALLY HOLD, PER PROJECT -------------------------
  console.log('\n' + '='.repeat(100));
  console.log('WHAT THE 55 FIELDS HOLD, per reachable SCH');
  console.log('='.repeat(100));

  // The fields worth naming: the ones a California project has none of today.
  const WANTED = [
    'Location Parcel Number', 'Location Total Acres', 'Location Cross Streets',
    'Location Zip Code', 'Location Coordinates', 'Cities', 'Counties',
    'NOD Approved By Lead Agency', 'NOD Approved Date',
    'NOD Significant Environmental Impact', 'NOC Development Type', 'NOC Local Action',
    'Document Type', 'Project Title', 'Contact Full Name', 'Contact Authority', 'Contact Job Title',
  ];

  const filled: Record<string, number> = {};
  let fetched = 0;
  for (const sch of allPublished) {
    let text = '';
    try {
      const res = await fetch(CSV(sch), { headers: { 'User-Agent': UA } });
      if (!res.ok) { console.log(`  ${sch}  HTTP ${res.status}`); continue; }
      text = await res.text();
    } catch (e) {
      console.log(`  ${sch}  FETCH FAILED ${(e as Error).message.slice(0, 50)}`);
      continue;
    }
    fetched++;
    const rows = parseCsv(text);
    if (rows.length < 2) { console.log(`  ${sch}  CSV returned no data row`); continue; }
    const head = rows[0];
    const val = rows[1];
    const get = (k: string) => {
      const i = head.findIndex((h) => h.trim() === k);
      return i === -1 ? '' : (val[i] ?? '').trim();
    };
    console.log(`\n  SCH ${sch}   (${head.length} fields in the header)`);
    for (const k of WANTED) {
      const v = get(k);
      if (v) filled[k] = (filled[k] ?? 0) + 1;
      console.log(`    ${v ? '*' : ' '} ${k.padEnd(38)} ${v ? v.slice(0, 52) : '(empty)'}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  console.log('\n--- ACROSS THE ' + fetched + ' REACHABLE RECORDS, HOW OFTEN EACH FIELD IS POPULATED ---');
  for (const k of WANTED) {
    console.log(`  ${String(filled[k] ?? 0).padStart(3)} / ${fetched}   ${k}`);
  }
}

// A CSV parser that respects quoted commas, because every CEQAnet description
// field contains them and a naive split reports the wrong column for everything
// after the first one.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cur); cur = ''; }
    else if (c === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
    else if (c !== '\r') cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
