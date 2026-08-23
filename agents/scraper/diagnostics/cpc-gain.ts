// READ-ONLY. BRIEF Q ITEM 2: what the reachable CPC reports would actually ADD,
// per project, against what that project already holds.
//
//   node --env-file=.env.local --import tsx //     agents/scraper/diagnostics/cpc-gain.ts
//
// nyc-cpc-reach answers "does the route return a PDF". This answers the question
// after it: a report that restates the applicant we already stored adds nothing,
// and a reach count that ignores that overstates the gain.
//
// PUBLISHED FIELD ONLY. Same separation nyc-cpc-reach draws and for the same
// reason: a number in a ZAP column is the source stating its own identifier; a
// number matched out of prose can be a cross-reference to another project.

// BRIEF Q ITEM 2. What the reachable CPC reports would actually ADD, per project.
// Reads only. Writes nothing.
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { readCpcReport, isCpcReport } from '../readers/cpc-report';
import { inCorpusScope } from '../../../lib/corpus-scope';

const UA = 'philipkwong-agents/1.0 (+development intelligence)';
const CPC = (n: string) => `https://www.nyc.gov/assets/planning/download/pdf/about/cpc/${n}.pdf`;
const ULURP_RE = /\b(\d{6})([A-Z]{2,4})\b/g;

async function page(t: string, c: string) {
  const o: any[] = [];
  for (let f = 0; ; f += 500) {
    const { data, error } = await supabaseAdmin.from(t).select(c).range(f, f + 499);
    if (error) throw new Error(error.message);
    const r = (data ?? []) as any[];
    o.push(...r);
    if (r.length < 500) break;
  }
  return o;
}

const projects = await page('projects', 'id,name,market,country,module,status,stage,primary_applicant,primary_representative');
const leads = await page('leads', 'id,project_id,source,status,lifecycle,title,raw_content,applicant,representative,filing_facts');
const live = projects.filter((p) => p.module === 'gli' && p.status !== 'dismissed' && inCorpusScope(p.country));
const ny = live.filter((p) => /new york/i.test(String(p.market ?? '')));
const byProj = new Map<string, any[]>();
for (const l of leads) {
  if (!l.project_id || l.status === 'dismissed' || l.lifecycle === 'retired') continue;
  if (!byProj.has(l.project_id)) byProj.set(l.project_id, []);
  byProj.get(l.project_id)!.push(l);
}

// Published-field numbers only, exactly as nyc-cpc-reach separates them.
function published(raw: string | null): string[] {
  const m = /^ULURP numbers:\s*(.+)$/m.exec(String(raw ?? ''));
  if (!m) return [];
  const out: string[] = [];
  ULURP_RE.lastIndex = 0;
  let h;
  while ((h = ULURP_RE.exec(m[1]))) out.push(h[1] + h[2]);
  return out;
}

const numsByProject = new Map<string, Set<string>>();
for (const p of ny) {
  const s = new Set<string>();
  for (const l of byProj.get(p.id) ?? []) for (const n of published(l.raw_content)) s.add(n);
  if (s.size) numsByProject.set(p.id, s);
}

console.log('live New York projects: ' + ny.length);
console.log('projects carrying a published ULURP number: ' + numsByProject.size);
const allNums = [...new Set([...numsByProject.values()].flatMap((s) => [...s]))];
console.log('distinct published numbers: ' + allNums.length);

// ---- fetch + read ----------------------------------------------------------
const readings = new Map<string, any>();
for (const n of allNums) {
  const base = n.slice(0, 6);
  try {
    const res = await fetch(CPC(base), { headers: { 'User-Agent': UA } });
    if (!res.ok) { readings.set(n, { ok: false, http: res.status }); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    const pdf = (await import('pdf-parse/lib/pdf-parse.js')).default;
    const parsed = await pdf(buf);
    const text = String(parsed.text ?? '');
    const reading = readCpcReport(text);
    // Obligation-clause shapes, for item 3. RESOLVED is the legal-resolution
    // anchor; "shall" is the obligation verb. Counted, not extracted.
    const resolved = (text.match(/\bRESOLVED\b/g) ?? []).length;
    const shall = (text.match(/\bshall\b/gi) ?? []).length;
    readings.set(n, {
      ok: true, isCpc: isCpcReport(text), pages: parsed.numpages,
      chars: text.length, applicant: reading.applicant,
      facts: reading.facts.map((f: any) => f.label), resolved, shall,
    });
  } catch (e) {
    readings.set(n, { ok: false, err: (e as Error).message.slice(0, 60) });
  }
  await new Promise((r) => setTimeout(r, 400));
}

console.log('\n=== EVERY PUBLISHED NUMBER, AND WHAT ITS REPORT CARRIES ===');
console.log('number      http/ok  pages  isCPC  applicant                         facts                 RESOLVED  shall');
for (const n of allNums) {
  const r = readings.get(n);
  if (!r?.ok) { console.log(n.padEnd(12) + String(r?.http ?? r?.err ?? '?').padEnd(9) + '  -'); continue; }
  console.log(
    n.padEnd(12) + 'ok'.padEnd(9) + String(r.pages).padStart(5) + '  ' + String(r.isCpc).padEnd(6) + ' ' +
    String(r.applicant ?? '-').slice(0, 33).padEnd(34) + (r.facts.join(',') || '-').padEnd(22) +
    String(r.resolved).padStart(8) + String(r.shall).padStart(7)
  );
}

console.log('\n=== PER PROJECT: WHAT IT HOLDS NOW vs WHAT THE REPORT WOULD ADD ===');
let gainParty = 0, gainDecision = 0, gainAny = 0;
const gainers: string[] = [];
for (const [pid, nums] of numsByProject) {
  const p = ny.find((x) => x.id === pid)!;
  const reach = [...nums].filter((n) => readings.get(n)?.ok);
  const recs = byProj.get(pid) ?? [];
  const hasParty = !!p.primary_applicant || recs.some((r) => r.applicant);
  const hasFacts = recs.some((r) => Array.isArray(r.filing_facts) && r.filing_facts.length);
  const reportApplicants = reach.map((n) => readings.get(n).applicant).filter(Boolean);
  const reportDecision = reach.some((n) => (readings.get(n).facts ?? []).length);
  const newParty = !hasParty && reportApplicants.length > 0;
  const newDecision = !hasFacts && reportDecision;
  if (newParty) gainParty++;
  if (newDecision) gainDecision++;
  if (newParty || newDecision) { gainAny++; gainers.push(p.name); }
  console.log(
    '\n  ' + p.name + '   [' + p.stage + ']' +
    '\n    numbers ' + nums.size + ', reachable ' + reach.length +
    '\n    holds now : party=' + (hasParty ? 'YES' : 'no') + ' facts=' + (hasFacts ? 'YES' : 'no') +
    '\n    report has: applicant=' + (reportApplicants[0] ?? '-') + ' decision/vote facts=' + reportDecision +
    '\n    WOULD GAIN: ' + (newParty ? 'a party ' : '') + (newDecision ? 'a decision ' : '') + (!newParty && !newDecision ? 'nothing it does not already hold' : '')
  );
}
console.log('\n=== THE NUMBER THAT DECIDES THE PASS ===');
console.log('  live New York projects                                   : ' + ny.length);
console.log('  carrying a published ULURP number                        : ' + numsByProject.size);
console.log('  with at least one number that RETURNS a report           : ' + [...numsByProject].filter(([, s]) => [...s].some((n) => readings.get(n)?.ok)).length);
console.log('  that would gain a PARTY they do not already hold         : ' + gainParty);
console.log('  that would gain a DECISION they do not already hold      : ' + gainDecision);
console.log('  that would gain EITHER                                   : ' + gainAny);
console.log('  gainers: ' + (gainers.join('; ') || 'none'));
const totalResolved = allNums.filter((n) => readings.get(n)?.ok).reduce((s, n) => s + readings.get(n).resolved, 0);
const totalShall = allNums.filter((n) => readings.get(n)?.ok).reduce((s, n) => s + readings.get(n).shall, 0);
console.log('\n  ITEM 3 INPUT: across the reachable reports, RESOLVED clauses ' + totalResolved + ', "shall" occurrences ' + totalShall);
