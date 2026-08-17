// HOW FAR PRESS FIGURES ACTUALLY REACH ACROSS THE CORPUS.
//
//   npm run press:reach
//
// Not "does Heart Hotel have a room count". Heart Hotel is the project the brief
// names, which makes it the one project we know is covered, and measuring on it
// tells us nothing about the other 258. THE HONEST NUMBER IS THE SHARE OF LIVE
// PROJECTS THAT GAIN ANY FIGURE AT ALL, and it is reported per market because a
// corpus average hides a market that gained nothing (standing rule 2).
//
// It also reads back what `capture:press` stored, because a run that reports 45
// bodies fetched and a table holding 12 is the failure mode worth catching: the
// report is written from memory and the corpus is written to disk.

import { supabaseAdmin } from '../../lib/supabase-admin';
import { attributionTerms, factsForEntry, type PressFact } from './press-facts';

interface ProjRow {
  id: string; name: string; status: string | null;
  market: string | null; region_state: string | null; primary_applicant: string | null;
}
interface LeadRow {
  id: string; url: string | null; project_id: string | null; status: string | null;
  article_status: string | null; article_body: string | null; press_facts: PressFact[] | null;
}

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

async function pageAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

async function main(): Promise<void> {
  const projects = await pageAll<ProjRow>(
    'projects',
    'id,name,status,market,region_state,primary_applicant'
  );
  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted');
  const liveById = new Map(live.map((p) => [p.id, p]));

  const press = await pageAll<LeadRow>(
    'leads',
    'id,url,project_id,status,article_status,article_body,press_facts',
    (q) => q.eq('source', 'gli_serper')
  );
  const undismissed = press.filter((r) => r.status !== 'dismissed');

  // ---- WHAT IS ACTUALLY IN THE TABLE ---------------------------------------
  console.log('===== WHAT capture:press STORED =====\n');
  console.log(`press records (undismissed) : ${undismissed.length}`);
  console.log(`  attached to a live project: ${undismissed.filter((r) => r.project_id && liveById.has(r.project_id)).length}`);
  const tried = undismissed.filter((r) => r.article_status);
  console.log(`  a fetch was attempted     : ${tried.length}`);
  const byStatus: Record<string, number> = {};
  for (const r of tried) byStatus[r.article_status!] = (byStatus[r.article_status!] ?? 0) + 1;
  console.log('\nstored article_status   count');
  for (const [s, n] of Object.entries(byStatus).sort((a, b) => b[1] - a[1])) {
    console.log(`${s.padEnd(24)}${String(n).padStart(5)}`);
  }
  const withBody = undismissed.filter((r) => (r.article_body ?? '').length > 0);
  const withFacts = undismissed.filter((r) => (r.press_facts ?? []).length > 0);
  const factCount = undismissed.reduce((a, r) => a + (r.press_facts ?? []).length, 0);
  console.log(`\nbodies stored           : ${withBody.length}`);
  console.log(`records carrying facts  : ${withFacts.length}`);
  console.log(`facts stored            : ${factCount}`);
  if (withBody.length) {
    const lens = withBody.map((r) => r.article_body!.length).sort((a, b) => a - b);
    console.log(`body length stored      : min ${lens[0]}  median ${lens[Math.floor(lens.length / 2)]}  max ${lens[lens.length - 1]}`);
  }

  // ---- EVERY PUBLISHER, NOT JUST THE BUSY ONES ------------------------------
  //
  // capture:press reports by host only where a host was tried five or more
  // times, which is right for its own progress output and wrong as a coverage
  // fact: the refusals are spread thin. 14 blocked across 14 different
  // publishers reads as "no publisher refuses us" under a five-attempt floor.
  // This lists every host that failed, because "which publishers will not serve
  // us" is a standing question about what we can and cannot cover.
  const byHost = new Map<string, Map<string, number>>();
  for (const r of tried) {
    if (!r.project_id || !liveById.has(r.project_id)) continue;
    let h = '(bad url)';
    try { h = new URL(r.url!).hostname.replace(/^www\./, ''); } catch { /* keep */ }
    const m = byHost.get(h) ?? new Map<string, number>();
    m.set(r.article_status!, (m.get(r.article_status!) ?? 0) + 1);
    byHost.set(h, m);
  }
  const failed = [...byHost.entries()].filter(([, m]) => [...m.keys()].some((k) => k !== 'ok'));
  console.log(`\npublishers tried  : ${byHost.size}`);
  console.log(`  serve us fully  : ${byHost.size - failed.length}`);
  console.log(`  refuse or fail  : ${failed.length}`);
  console.log('\npublisher                          ok   failure');
  for (const [h, m] of failed.sort((a, b) => a[0].localeCompare(b[0]))) {
    const fails = [...m.entries()].filter(([k]) => k !== 'ok').map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`${h.slice(0, 32).padEnd(34)}${String(m.get('ok') ?? 0).padStart(3)}   ${fails}`);
  }

  // ---- REACH ----------------------------------------------------------------
  // A project gains a figure when a press record attached to it carries a fact
  // whose own sentence names the project or a party to it. Anything weaker is
  // a figure about a different building printed under this project's name.
  const factsByProject = new Map<string, PressFact[]>();
  for (const r of undismissed) {
    if (!r.project_id || !liveById.has(r.project_id) || !(r.press_facts ?? []).length) continue;
    const acc = factsByProject.get(r.project_id) ?? [];
    acc.push(...r.press_facts!);
    factsByProject.set(r.project_id, acc);
  }

  const gained = new Map<string, PressFact[]>();
  for (const [pid, facts] of factsByProject) {
    const p = liveById.get(pid)!;
    const kept = factsForEntry(facts, attributionTerms(p.name, p.primary_applicant));
    if (kept.length) gained.set(pid, kept);
  }

  console.log('\n\n===== REACH ACROSS THE CORPUS =====\n');
  console.log(`live projects                          : ${live.length}`);
  console.log(`  hold any press record                : ${new Set(undismissed.filter((r) => r.project_id && liveById.has(r.project_id)).map((r) => r.project_id)).size}`);
  console.log(`  hold a press record with a body      : ${new Set(withBody.filter((r) => r.project_id && liveById.has(r.project_id)).map((r) => r.project_id)).size}`);
  console.log(`  hold any extracted fact              : ${factsByProject.size}`);
  console.log(`  GAIN A FIGURE (survives attribution) : ${gained.size}  (${pct(gained.size, live.length)} of live projects)`);

  // ---- PER MARKET -----------------------------------------------------------
  const marketOf = (p: ProjRow) => p.market ?? p.region_state ?? '(no market)';
  const rows = new Map<string, { live: number; press: number; body: number; gained: number; figures: number }>();
  for (const p of live) {
    const m = marketOf(p);
    rows.set(m, rows.get(m) ?? { live: 0, press: 0, body: 0, gained: 0, figures: 0 });
    rows.get(m)!.live++;
  }
  const pressProjects = new Set(undismissed.filter((r) => r.project_id && liveById.has(r.project_id)).map((r) => r.project_id!));
  for (const pid of pressProjects) rows.get(marketOf(liveById.get(pid)!))!.press++;
  const bodyProjects = new Set(withBody.filter((r) => r.project_id && liveById.has(r.project_id)).map((r) => r.project_id!));
  for (const pid of bodyProjects) rows.get(marketOf(liveById.get(pid)!))!.body++;
  for (const [pid, facts] of gained) {
    const row = rows.get(marketOf(liveById.get(pid)!))!;
    row.gained++;
    row.figures += facts.length;
  }

  console.log('\nmarket                          live  w/press  w/body  GAINED   share  figures');
  for (const [m, s] of [...rows.entries()].sort((a, b) => b[1].gained - a[1].gained || b[1].live - a[1].live)) {
    console.log(
      `${m.slice(0, 30).padEnd(32)}${String(s.live).padStart(4)}${String(s.press).padStart(9)}${String(s.body).padStart(8)}${String(s.gained).padStart(8)}${pct(s.gained, s.live).padStart(8)}${String(s.figures).padStart(9)}`
    );
  }

  // ---- WHERE THE REACH IS LOST ----------------------------------------------
  // Four gates stand between a live project and a figure, and naming which one
  // costs the most is the difference between "press is thin" and a work item.
  console.log('\n\n===== WHERE REACH IS LOST =====\n');
  const attachedLive = undismissed.filter((r) => r.project_id && liveById.has(r.project_id));
  console.log(`press records held                    : ${undismissed.length}`);
  console.log(`  lost: attached to no live project   : ${undismissed.length - attachedLive.length}`);
  console.log(`press records on a live project       : ${attachedLive.length}`);
  console.log(`  lost: publisher refused or unreachable: ${attachedLive.filter((r) => r.article_status && r.article_status !== 'ok').length}`);
  console.log(`bodies fetched                        : ${attachedLive.filter((r) => r.article_status === 'ok').length}`);
  console.log(`  lost: body carries no figure shape  : ${attachedLive.filter((r) => r.article_status === 'ok' && !(r.press_facts ?? []).length).length}`);
  console.log(`records carrying a fact               : ${attachedLive.filter((r) => (r.press_facts ?? []).length).length}`);
  const allFacts = attachedLive.reduce((a, r) => a + (r.press_facts ?? []).length, 0);
  const keptFacts = [...gained.values()].reduce((a, f) => a + f.length, 0);
  console.log(`  facts extracted                     : ${allFacts}`);
  console.log(`  lost: about another project         : ${allFacts - keptFacts}`);
  console.log(`  figures that reach an entry         : ${keptFacts}`);

  console.log('\n--- the projects that gained, most figures first ---');
  for (const [pid, facts] of [...gained.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const p = liveById.get(pid)!;
    console.log(`${String(facts.length).padStart(3)}  ${p.name.slice(0, 44).padEnd(46)}${marketOf(p)}`);
  }

  // ---- WHAT ATTRIBUTION COST ONE PROJECT ------------------------------------
  //
  //   npm run press:reach -- --project="Heart Hotel"
  //
  // The strictness is deliberate and it is not free: a sentence that says "the
  // project will include more than 42,000 square feet of convention space" is
  // about this project and names nothing, so it is dropped. This prints the
  // dropped facts WITH THEIR SENTENCES, which is the only way to judge whether a
  // drop was right - and it is how the loss is quantified rather than asserted.
  const wanted = process.argv.find((a) => a.startsWith('--project='))?.slice(10);
  if (!wanted) return;
  const hits = live.filter((p) => p.name.toLowerCase().includes(wanted.toLowerCase()));
  for (const p of hits) {
    const terms = attributionTerms(p.name, p.primary_applicant);
    const facts = factsByProject.get(p.id) ?? [];
    const kept = new Set(factsForEntry(facts, terms).map((f) => `${f.kind}:${f.display}`));
    console.log(`\n\n===== ${p.name} =====`);
    console.log(`attribution terms: ${terms.join(', ')}`);
    console.log(`\n--- HELD BACK (the sentence never names the project or a party) ---`);
    const shown = new Set<string>();
    for (const f of facts) {
      const key = `${f.kind}:${f.display}`;
      if (kept.has(key) || shown.has(key)) continue;
      shown.add(key);
      console.log(`\n[${f.kind}] ${f.display}`);
      console.log(`   "${f.sentence.slice(0, 300)}"`);
    }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
