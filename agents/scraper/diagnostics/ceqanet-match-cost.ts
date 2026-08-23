// READ-ONLY. What would it cost to match CEQAnet's Anaheim filings to the
// Anaheim projects we already hold?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/ceqanet-match-cost.ts
//
// Nothing is written and no matcher is built. The agency route returns 657
// Anaheim CEQA filings in one request with parcel numbers on 251 of them, and
// the only question that matters is whether any of them can be tied to one of
// our 19 Anaheim projects WITHOUT guessing.
//
// A HIT RATE IS NOT A MATCH RATE, and this file reports both. Anaheim's
// arterials run for miles: Katella Avenue, Lincoln Avenue and State College
// Boulevard each carry dozens of unrelated filings. A project on Katella Avenue
// "matching" every CEQA filing on Katella Avenue is not a match, it is a street.
// So every candidate set is reported with its SIZE, and a candidate set larger
// than a handful is counted as unresolved rather than as reach.
//
// The exact key was checked first and is not available: of the 19 live Anaheim
// projects, ONE carries an Anaheim application number (DEV/CUP/VAR/RCL/TTM) in
// any of its records, so CEQAnet's own "Development Application No." titles have
// nothing to join to.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const UA = 'philipkwong-agents/1.0 (+development intelligence)';
const CSV = 'https://ceqanet.lci.ca.gov/Search?LeadAgency=Anaheim%2C%20City%20of&OutputFormat=CSV';

// A street name without its type suffix, lower case. "South State College
// Boulevard" and "State College Blvd" both reduce to "state college".
const TYPES =
  /\b(?:avenue|ave|boulevard|blvd|street|st|road|rd|drive|dr|way|lane|ln|place|pl|court|ct|circle|cir|highway|hwy|parkway|pkwy|trail|terrace)\b/gi;
const DIRS = /\b(?:north|south|east|west|n|s|e|w|northeast|northwest|southeast|southwest)\b/gi;

function streetsOf(text: string): Set<string> {
  const out = new Set<string>();
  const t = String(text ?? '').replace(/\s+/g, ' ');
  // A street phrase is a run of capitalised words ending in a street type.
  const re = /\b((?:[A-Z][a-zA-Z'.-]+\s+){1,4})(avenue|ave|boulevard|blvd|street|st|road|rd|drive|dr|way|lane|ln|place|pl|court|ct|circle|cir|highway|hwy|parkway|pkwy)\b/gi;
  for (const m of t.matchAll(re)) {
    const bare = (m[1] ?? '')
      .replace(DIRS, ' ')
      .replace(TYPES, ' ')
      .replace(/[^a-zA-Z ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
    // One-word streets are kept only when they are not a bare direction.
    if (bare.length >= 3) out.add(bare);
  }
  return out;
}

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

async function main(): Promise<void> {
  const { data: P } = await supabaseAdmin
    .from('projects')
    .select('id,name,market,stage,module,status')
    .eq('market', 'Anaheim').eq('module', 'gli').neq('status', 'dismissed');
  const projects = (P ?? []) as any[];
  const { data: L } = await supabaseAdmin
    .from('leads')
    .select('project_id,title,location,raw_content,status,lifecycle')
    .in('project_id', projects.map((p) => p.id)).neq('status', 'dismissed');
  const leads = ((L ?? []) as any[]).filter((l) => l.lifecycle !== 'retired');

  // ---- the CEQAnet side ------------------------------------------------------
  const res = await fetch(CSV, { headers: { 'User-Agent': UA } });
  const buf = Buffer.from(await res.arrayBuffer());
  // cp1252, not utf-8. Decoding as utf-8 throws on this file.
  const text = new TextDecoder('windows-1252').decode(buf);
  const rows = parseCsv(text);
  const head = rows[0];
  const idx = (k: string) => head.findIndex((h) => h.trim() === k);
  const iCross = idx('Location Cross Streets');
  const iParcel = idx('Location Parcel Number');
  const iTitle = idx('Project Title');
  const iSch = idx('SCH Number');
  const iRecv = idx('Received');
  const data = rows.slice(1);

  console.log('='.repeat(100));
  console.log('COSTING THE ANAHEIM MATCH');
  console.log('='.repeat(100));
  console.log(`CEQAnet rows for "Anaheim, City of" : ${data.length}   [one request, 55 fields, cp1252]`);
  console.log(`  with cross streets                : ${data.filter((r) => (r[iCross] ?? '').trim()).length}`);
  console.log(`  with a parcel number              : ${data.filter((r) => (r[iParcel] ?? '').trim()).length}`);
  console.log(`live Anaheim projects               : ${projects.length}`);

  // Index CEQAnet rows by street name.
  const byStreet = new Map<string, number[]>();
  data.forEach((r, i) => {
    for (const s of streetsOf(r[iCross] ?? '')) {
      if (!byStreet.has(s)) byStreet.set(s, []);
      byStreet.get(s)!.push(i);
    }
  });
  console.log(`distinct street names on the CEQAnet side: ${byStreet.size}`);

  // HOW AMBIGUOUS IS A STREET. The number that decides whether this is a match
  // key at all.
  const sizes = [...byStreet.values()].map((v) => v.length).sort((a, b) => b - a);
  console.log(`  filings per street: max ${sizes[0]}, median ${sizes[Math.floor(sizes.length / 2)]}`);
  console.log('  the ten busiest streets:');
  for (const [s, v] of [...byStreet].sort((a, b) => b[1].length - a[1].length).slice(0, 10)) {
    console.log(`    ${String(v.length).padStart(3)}  ${s}`);
  }

  // ---- match -----------------------------------------------------------------
  console.log('\n' + '-'.repeat(100));
  console.log('PER PROJECT');
  console.log('-'.repeat(100));
  let anyCandidate = 0;
  let resolvable = 0;
  let withParcel = 0;
  for (const p of projects) {
    const recs = leads.filter((l) => l.project_id === p.id);
    const streets = new Set<string>();
    for (const s of streetsOf(p.name)) streets.add(s);
    for (const r of recs) {
      for (const s of streetsOf(r.location ?? '')) streets.add(s);
      for (const s of streetsOf(r.title ?? '')) streets.add(s);
    }
    if (!streets.size) {
      console.log(`  ${p.name.slice(0, 44).padEnd(46)} NO STREET on the project side at all`);
      continue;
    }
    const hits = new Set<number>();
    for (const s of streets) for (const i of byStreet.get(s) ?? []) hits.add(i);
    if (!hits.size) {
      console.log(`  ${p.name.slice(0, 44).padEnd(46)} streets=[${[...streets].join('|')}]  -> 0 CEQAnet rows`);
      continue;
    }
    anyCandidate++;
    // A candidate set of five or fewer is small enough for a person to resolve;
    // anything larger is a street, not a project.
    const small = hits.size <= 5;
    if (small) resolvable++;
    const parcels = [...hits].filter((i) => (data[i][iParcel] ?? '').trim()).length;
    if (small && parcels) withParcel++;
    console.log(
      `  ${p.name.slice(0, 44).padEnd(46)} streets=[${[...streets].join('|')}]  -> ${String(hits.size).padStart(3)} rows` +
      `${small ? '  RESOLVABLE' : '  too many to resolve'}${parcels ? `, ${parcels} with a parcel` : ''}`
    );
    if (small) {
      for (const i of [...hits].slice(0, 5)) {
        console.log(`        SCH ${data[i][iSch]} ${String(data[i][iRecv]).padEnd(11)} ${String(data[i][iTitle] ?? '').slice(0, 46).padEnd(48)} parcel=${(data[i][iParcel] ?? '').slice(0, 24) || '-'}`);
      }
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('THE COST');
  console.log('='.repeat(100));
  console.log(`  Anaheim projects                                   : ${projects.length}`);
  console.log(`  with any CEQAnet candidate by street               : ${anyCandidate}`);
  console.log(`  whose candidate set is small enough to resolve (<=5): ${resolvable}`);
  console.log(`  of those, carrying a parcel number                 : ${withParcel}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
