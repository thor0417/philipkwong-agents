// TWO QUESTIONS, ONE READ. Read-only.
//
// 1. How many live projects carry no party AND are reachable only through a
//    source that publishes none, so the coverage note can state it.
// 2. How many live projects are NAMED after a shell entity or an opaque token,
//    across every market - and what else the records hold that could name the
//    thing instead.
//
// NOTHING HERE IS A RULE. Each discriminator is printed with the count it
// reaches, so a rule is chosen against numbers in every market rather than
// against the one project that prompted the question.

import { supabaseAdmin } from '../../../lib/supabase-admin';

interface P {
  id: string; name: string | null; name_source: string | null; market: string | null;
  status: string | null; stage: string | null; primary_applicant: string | null; record_count: number | null;
}
interface L {
  id: string; project_id: string | null; source: string | null; status: string | null;
  lifecycle: string | null; applicant: string | null; representative: string | null;
  presented_by: string | null; contact_name: string | null;
  filing_facts: { kind: string; label: string; display: string }[] | null;
}

async function page<T>(table: string, cols: string, f?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q: any = supabaseAdmin.from(table).select(cols).range(from, from + 999);
    if (f) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

// SHAPE A. A registered entity used as the project name. The suffix is PUBLISHED
// by the filer, not guessed from the letters.
const ENTITY_SUFFIX = /(,?\s*(LLC|L\.L\.C\.|INC|CORP|LP|L\.P\.|LLP|LTD|CO\.|COMPANY|TRUST|PARTNERS|HOLDINGS)\b\.?)\s*$/i;
// SHAPE B. An opaque token: a single unspaced all-caps string that is not a
// known initialism. "Six consonants" is not the rule; this is the rule that
// consonant-counting was reaching for, and it is still only a candidate.
const OPAQUE_TOKEN = /^[A-Z0-9&.'-]{3,20}$/;
const KNOWN_INITIALISMS = new Set([
  'CFTOD', 'OCVIBE', 'MSG', 'JFK', 'LAX', 'NYC', 'SLS', 'MGM', 'LVCVA', 'AEG',
  'EDC', 'PANYNJ', 'HPD', 'DCAS', 'LPC', 'DOT', 'DCP',
]);
const VOWELS = /[AEIOUY]/;

async function main(): Promise<void> {
  const projects = await page<P>('projects', 'id,name,name_source,market,status,stage,primary_applicant,record_count');
  const leads = await page<L>(
    'leads',
    'id,project_id,source,status,lifecycle,applicant,representative,presented_by,contact_name,filing_facts',
    (q) => q.not('project_id', 'is', null)
  );
  const live = leads.filter((r) => r.status !== 'dismissed' && r.lifecycle !== 'retired');
  const byProject = new Map<string, L[]>();
  for (const r of live) {
    if (!byProject.has(r.project_id as string)) byProject.set(r.project_id as string, []);
    byProject.get(r.project_id as string)!.push(r);
  }
  const liveProjects = projects.filter(
    (p) => p.status !== 'dismissed' && (byProject.get(p.id)?.length ?? 0) > 0
  );

  console.log('='.repeat(84));
  console.log('1. PROJECTS WITH NO PARTY, AND WHERE THEY COME FROM');
  console.log('='.repeat(84));
  const hasParty = (r: L): boolean =>
    !!(r.applicant?.trim() || r.representative?.trim() || r.presented_by?.trim() || r.contact_name?.trim());
  const partyless = liveProjects.filter((p) => !(byProject.get(p.id) ?? []).some(hasParty));
  console.log(`live projects                       : ${liveProjects.length}`);
  console.log(`carrying no party on any record     : ${partyless.length}`);

  const srcMix = new Map<string, number>();
  for (const p of partyless) {
    const srcs = [...new Set((byProject.get(p.id) ?? []).map((r) => r.source ?? '?'))].sort();
    const k = srcs.join('+');
    srcMix.set(k, (srcMix.get(k) ?? 0) + 1);
  }
  console.log('\n  by the sources they are reachable through:');
  for (const [k, n] of [...srcMix.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(n).padStart(4)}  ${k}`);
  }
  const ceqrOnly = partyless.filter((p) => {
    const s = new Set((byProject.get(p.id) ?? []).map((r) => r.source));
    return s.size === 1 && s.has('nyc-ceqr');
  });
  console.log(`\n  CEQR-ONLY and partyless           : ${ceqrOnly.length}`);
  console.log('  CEQR publishes no applicant field at all, so this is a source fact and not a capture gap.');
  const ceqrMarkets = new Map<string, number>();
  for (const p of ceqrOnly) ceqrMarkets.set(p.market ?? '(none)', (ceqrMarkets.get(p.market ?? '(none)') ?? 0) + 1);
  for (const [k, n] of [...ceqrMarkets.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`     ${String(n).padStart(4)}  ${k}`);
  }

  console.log('\n' + '='.repeat(84));
  console.log('2. PROJECTS NAMED AFTER A SHELL ENTITY OR AN OPAQUE TOKEN');
  console.log('='.repeat(84));
  const shapeA = liveProjects.filter((p) => p.name && ENTITY_SUFFIX.test(p.name.trim()));
  const shapeB = liveProjects.filter((p) => {
    const n = (p.name ?? '').trim();
    if (!n || n.includes(' ')) return false;
    if (n !== n.toUpperCase()) return false;
    if (!OPAQUE_TOKEN.test(n)) return false;
    return !KNOWN_INITIALISMS.has(n);
  });
  const shapeC = liveProjects.filter(
    (p) => p.name && p.primary_applicant && p.name.trim().toLowerCase() === p.primary_applicant.trim().toLowerCase()
  );

  const tally = (label: string, set: P[]): void => {
    console.log(`\n  ${label}: ${set.length}`);
    const m = new Map<string, number>();
    for (const p of set) m.set(p.market ?? '(none)', (m.get(p.market ?? '(none)') ?? 0) + 1);
    for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`      ${String(n).padStart(4)}  ${k}`);
    for (const p of set.slice(0, 40)) {
      console.log(`        ${String(p.name).slice(0, 52).padEnd(52)} src=${p.name_source ?? '-'}  ${p.market ?? '-'}`);
    }
  };
  tally('SHAPE A  name ends in a published entity suffix (LLC, Inc, LP, Trust)', shapeA);
  tally('SHAPE B  name is a single unspaced all-caps token, not a known initialism', shapeB);
  tally('SHAPE C  name is exactly the primary applicant string', shapeC);

  const unionIds = [...new Set([...shapeA, ...shapeB, ...shapeC].map((p) => p.id))];
  console.log(`\n  UNION of the three shapes: ${unionIds.length} live projects`);
  const noVowel = shapeB.filter((p) => !VOWELS.test((p.name ?? '').toUpperCase()));
  console.log(`  of shape B, carrying no vowel at all: ${noVowel.length}   <- the 'six consonants' idea, sized`);

  console.log('\n' + '='.repeat(84));
  console.log('3. WHAT ELSE THE RECORDS HOLD THAT COULD NAME THE THING');
  console.log('='.repeat(84));
  const WANT = ['project type', 'location', 'site acreage', 'apn', 'land use plan', 'zone', 'number of rooms'];
  const reach = new Map<string, number>();
  for (const id of unionIds) {
    const labels = new Set<string>();
    for (const r of byProject.get(id) ?? []) for (const f of r.filing_facts ?? []) labels.add((f.label ?? '').toLowerCase());
    for (const w of WANT) if ([...labels].some((l) => l.includes(w))) reach.set(w, (reach.get(w) ?? 0) + 1);
  }
  console.log(`  over the ${unionIds.length} projects in the union, how many carry each stated field:`);
  for (const w of WANT) console.log(`     ${String(reach.get(w) ?? 0).padStart(4)} / ${unionIds.length}   ${w}`);

  console.log('\n  per project, what is available:');
  for (const id of unionIds.slice(0, 30)) {
    const p = liveProjects.find((x) => x.id === id) as P;
    const labels = new Set<string>();
    const vals = new Map<string, string>();
    for (const r of byProject.get(id) ?? []) {
      for (const f of r.filing_facts ?? []) {
        labels.add(f.label ?? '');
        if (!vals.has((f.label ?? '').toLowerCase())) vals.set((f.label ?? '').toLowerCase(), f.display ?? '');
      }
    }
    const hit = WANT.filter((w) => [...labels].some((l) => l.toLowerCase().includes(w)));
    console.log(`     ${String(p.name).slice(0, 34).padEnd(34)} ${String(p.market ?? '-').slice(0, 16).padEnd(16)} ${hit.join(', ') || '(no stated field)'}`);
    const type = [...vals.entries()].find(([l]) => l.includes('project type'));
    const loc = [...vals.entries()].find(([l]) => l.includes('location') || l.includes('generally located'));
    if (type) console.log(`         project type: ${type[1].slice(0, 70)}`);
    if (loc) console.log(`         location    : ${loc[1].slice(0, 70)}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
