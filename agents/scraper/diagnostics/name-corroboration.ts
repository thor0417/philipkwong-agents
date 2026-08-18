// IS THE NAME CORROBORATED ANYWHERE BUT THE FIELD IT CAME FROM?
//
// THE DISCRIMINATOR WORTH TESTING, and it is not a name shape. "RDXNWP" and
// "Neon Museum" are both a project named after its applicant; what separates
// them is that "Neon Museum" is also what the filings CALL the thing, and
// "RDXNWP" appears nowhere but the applicant box. That test asks a question
// about the record rather than about the letters, so it means the same thing in
// Clark County, Queens and Osceola - which a consonant count does not.
//
// Read-only. Prints the count the rule reaches and the projects on both sides,
// so it can be judged before it is anything.
//
// It also sizes the CEQR party question two ways, because "CEQR-only and
// partyless" and "has a CEQR record and no party" are different questions and
// the difference is large.

import { supabaseAdmin } from '../../../lib/supabase-admin';

interface P { id: string; name: string | null; name_source: string | null; market: string | null; status: string | null; primary_applicant: string | null; }
interface L {
  id: string; project_id: string | null; source: string | null; title: string | null;
  status: string | null; lifecycle: string | null; applicant: string | null;
  representative: string | null; presented_by: string | null; contact_name: string | null;
  action_sought: string | null;
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

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

async function main(): Promise<void> {
  const projects = await page<P>('projects', 'id,name,name_source,market,status,primary_applicant');
  const leads = await page<L>(
    'leads',
    'id,project_id,source,title,status,lifecycle,applicant,representative,presented_by,contact_name,action_sought',
    (q) => q.not('project_id', 'is', null)
  );
  const live = leads.filter((r) => r.status !== 'dismissed' && r.lifecycle !== 'retired');
  const byProject = new Map<string, L[]>();
  for (const r of live) {
    if (!byProject.has(r.project_id as string)) byProject.set(r.project_id as string, []);
    byProject.get(r.project_id as string)!.push(r);
  }
  const liveProjects = projects.filter((p) => p.status !== 'dismissed' && (byProject.get(p.id)?.length ?? 0) > 0);

  console.log('='.repeat(84));
  console.log('THE CEQR PARTY QUESTION, SIZED TWO WAYS');
  console.log('='.repeat(84));
  const hasParty = (r: L): boolean =>
    !!(r.applicant?.trim() || r.representative?.trim() || r.presented_by?.trim() || r.contact_name?.trim());
  const withCeqr = liveProjects.filter((p) => (byProject.get(p.id) ?? []).some((r) => r.source === 'nyc-ceqr'));
  const ceqrPartyless = withCeqr.filter((p) => !(byProject.get(p.id) ?? []).some(hasParty));
  const ceqrOnly = liveProjects.filter((p) => {
    const s = new Set((byProject.get(p.id) ?? []).map((r) => r.source));
    return s.size === 1 && s.has('nyc-ceqr');
  });
  console.log(`live projects holding at least one CEQR record : ${withCeqr.length}`);
  console.log(`  of those, carrying NO party on any record    : ${ceqrPartyless.length}`);
  console.log(`live projects reachable ONLY through CEQR      : ${ceqrOnly.length}`);
  console.log(`  of those, carrying NO party                  : ${ceqrOnly.filter((p) => !(byProject.get(p.id) ?? []).some(hasParty)).length}`);
  console.log(`total live CEQR records                        : ${live.filter((r) => r.source === 'nyc-ceqr').length}`);

  console.log('\n' + '='.repeat(84));
  console.log('THE DISCRIMINATOR: IS THE NAME CORROBORATED OUTSIDE THE FIELD IT CAME FROM?');
  console.log('='.repeat(84));

  // The candidate set is every project named after a party field, which is the
  // only way an entity name reaches a heading in the first place.
  const candidates = liveProjects.filter((p) => p.name_source === 'applicant' || p.name_source === 'source');
  let corroborated = 0;
  const uncorroborated: P[] = [];
  for (const p of candidates) {
    const n = norm(p.name ?? '');
    if (!n) continue;
    const recs = byProject.get(p.id) ?? [];
    // Corroborated = the name appears in text that is NOT a party field: the
    // filing's own title, or what the filing says is being sought.
    const hit = recs.some((r) => {
      const text = norm(`${r.title ?? ''} ${r.action_sought ?? ''}`);
      return text.includes(n);
    });
    if (hit) corroborated++;
    else uncorroborated.push(p);
  }
  console.log(`projects named from a party field   : ${candidates.length}`);
  console.log(`  name also appears in a filing title or action sought : ${corroborated}`);
  console.log(`  NAME APPEARS NOWHERE BUT THE PARTY FIELD             : ${uncorroborated.length}`);
  const m = new Map<string, number>();
  for (const p of uncorroborated) m.set(p.market ?? '(none)', (m.get(p.market ?? '(none)') ?? 0) + 1);
  console.log('\n  by market:');
  for (const [k, n] of [...m.entries()].sort((a, b) => b[1] - a[1])) console.log(`     ${String(n).padStart(4)}  ${k}`);
  console.log('\n  the projects the rule would reach:');
  for (const p of uncorroborated) {
    console.log(`     ${String(p.name).slice(0, 46).padEnd(46)} ${String(p.market ?? '-').slice(0, 18).padEnd(18)} src=${p.name_source}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
