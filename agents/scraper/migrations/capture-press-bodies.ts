// FETCH ARTICLE BODIES FOR PRESS RECORDS ON TRACKED PROJECTS, AND READ THE
// FIGURES OUT OF THEM.
//
//   npm run capture:press               report only, writes nothing
//   npm run capture:press -- --write    apply (requires migration 034)
//   npm run capture:press -- --limit 40 cap the number of fetches
//
// REPORT-ONLY BY DEFAULT, and not as a courtesy. The deliverable of the first run
// is the failure taxonomy: how many articles are reachable, how many are
// paywalled, which publishers refuse us. That is a coverage fact worth having
// before a single row changes, and it is measurable without the migration.
//
// SCOPE: press records attached to a live project. An unclustered press record is
// not about anything we track, and fetching it spends a request to learn nothing.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { fetchArticleBody, type ArticleFailure } from '../sources/article-body';
import {
  extractPressFacts, verifyNoInvention, attributionTerms, factsForEntry, isAttributed,
  type PressFact,
} from '../press-facts';

const WRITE = process.argv.includes('--write');
const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;
// One at a time per host would be ideal; a small global concurrency with mixed
// hosts is close enough and keeps a run to minutes rather than an hour.
const CONCURRENCY = Number(process.env.ARTICLE_CONCURRENCY ?? '4');

interface Row {
  id: string; url: string | null; title: string | null;
  project_id: string | null; status: string | null; location: string | null;
}

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');
const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '(bad url)'; } };

async function main(): Promise<void> {
  // Live projects only.
  const { data: projs, error: pErr } = await supabaseAdmin
    .from('projects').select('id,name,status,primary_applicant');
  if (pErr) throw new Error(pErr.message);
  const live = new Map(
    (projs ?? [])
      .filter((p: any) => p.status !== 'archived' && p.status !== 'deleted')
      .map((p: any) => [p.id as string, p.name as string])
  );

  // The project's own party, used as an attribution term: a sentence naming the
  // applicant is a sentence about the project.
  const applicantOf = new Map(
    (projs ?? []).map((p: any) => [p.id as string, (p.primary_applicant ?? null) as string | null])
  );

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,url,title,project_id,status,location')
      .eq('source', 'gli_serper')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Row[]));
    if (data.length < 1000) break;
  }

  const targets = rows
    .filter((r) => r.status !== 'dismissed' && r.url && r.project_id && live.has(r.project_id))
    .slice(0, LIMIT === Infinity ? undefined : LIMIT);

  console.log('===== ARTICLE BODY CAPTURE =====');
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: report only, nothing is written\n');
  console.log(`press records            : ${rows.filter((r) => r.status !== 'dismissed').length}`);
  console.log(`  attached to a live project: ${rows.filter((r) => r.status !== 'dismissed' && r.project_id && live.has(r.project_id)).length}`);
  console.log(`  to fetch this run         : ${targets.length}\n`);

  const failures: Record<string, number> = {};
  const byHost: Record<string, { tried: number; ok: number; fail: Record<string, number> }> = {};
  const results: { row: Row; chars: number; from: string; facts: PressFact[] }[] = [];
  let done = 0;

  let next = 0;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const r = targets[next++];
      const h = host(r.url!);
      byHost[h] ??= { tried: 0, ok: 0, fail: {} };
      byHost[h].tried++;
      const res = await fetchArticleBody(r.url!);
      done++;
      if (done % 25 === 0) console.log(`  ...${done}/${targets.length}`);

      if (!res.ok) {
        failures[res.failure] = (failures[res.failure] ?? 0) + 1;
        byHost[h].fail[res.failure] = (byHost[h].fail[res.failure] ?? 0) + 1;
        if (WRITE) {
          await supabaseAdmin.from('leads')
            .update({ article_status: res.failure, article_fetched_at: new Date().toISOString() })
            .eq('id', r.id);
        }
        continue;
      }
      byHost[h].ok++;

      // THE GUARD. An extractor defect stores nothing rather than something
      // plausible, and it is loud.
      let facts: PressFact[];
      try {
        facts = verifyNoInvention(extractPressFacts(res.text), res.text);
      } catch (e) {
        console.error(`  REFUSED (extractor invented a value) ${r.url}\n    ${String(e).slice(0, 200)}`);
        continue;
      }
      results.push({ row: r, chars: res.chars, from: res.extractedFrom, facts });

      if (WRITE) {
        const { error } = await supabaseAdmin.from('leads').update({
          article_body: res.text.slice(0, 200_000),
          article_status: 'ok',
          article_fetched_at: new Date().toISOString(),
          press_facts: facts.length ? facts : null,
        }).eq('id', r.id);
        if (error) throw new Error(`write failed for ${r.id}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  // ---- STEP 2: how many are fetchable, and how the rest fail ----------------
  console.log('\n\n===== STEP 2: FETCHABILITY =====\n');
  const okCount = results.length;
  console.log(`fetched and parsed : ${okCount} of ${targets.length}  (${pct(okCount, targets.length)})`);
  const failTotal = Object.values(failures).reduce((a, b) => a + b, 0);
  console.log(`failed             : ${failTotal}\n`);
  console.log('failure                count   what it means');
  const MEANING: Record<ArticleFailure | string, string> = {
    blocked: 'the publisher refused us specifically (401/403/451)',
    paywalled: 'the page loaded and said it is gated',
    'not-found': 'the article is gone (404/410)',
    timeout: 'no response inside the window',
    network: 'DNS, TLS or connection failure',
    'not-html': 'a PDF, video or image, not an article',
    'too-short': 'loaded and parsed but carries no article',
    'server-error': 'the publisher is broken today; worth retrying',
    'rate-limited': 'too many requests (429)',
    'redirect-loop': 'redirected without settling',
  };
  for (const [f, n] of Object.entries(failures).sort((a, b) => b[1] - a[1])) {
    console.log(`${f.padEnd(22)}${String(n).padStart(6)}   ${MEANING[f] ?? ''}`);
  }

  console.log('\n--- by publisher (5 or more attempts) ---');
  console.log('host                              tried    ok   failures');
  for (const [h, s] of Object.entries(byHost).filter(([, s]) => s.tried >= 5).sort((a, b) => b[1].tried - a[1].tried)) {
    const f = Object.entries(s.fail).map(([k, v]) => `${k} ${v}`).join(', ');
    console.log(`${h.slice(0, 32).padEnd(34)}${String(s.tried).padStart(5)}${String(s.ok).padStart(6)}   ${f}`);
  }

  if (okCount) {
    const lens = results.map((r) => r.chars).sort((a, b) => a - b);
    console.log(`\nbody length: min ${lens[0]}  median ${lens[Math.floor(lens.length / 2)]}  max ${lens[lens.length - 1]}`);
    const froms: Record<string, number> = {};
    for (const r of results) froms[r.from] = (froms[r.from] ?? 0) + 1;
    console.log(`extracted from: ${Object.entries(froms).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }

  // ---- STEPS 3 and 4: extraction rate, and ten examples with their sentence --
  console.log('\n\n===== STEPS 3 AND 4: EXTRACTION =====\n');
  const withFacts = results.filter((r) => r.facts.length);
  console.log(`articles yielding at least one fact: ${withFacts.length} of ${okCount}  (${pct(withFacts.length, okCount)})`);
  const byKind: Record<string, number> = {};
  const recordsByKind: Record<string, number> = {};
  for (const r of results) {
    const kinds = new Set(r.facts.map((f) => f.kind));
    for (const f of r.facts) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
    for (const k of kinds) recordsByKind[k] = (recordsByKind[k] ?? 0) + 1;
  }
  console.log('\nkind        facts   articles carrying it');
  for (const k of ['rooms', 'floors', 'sqft', 'seats', 'money', 'acres', 'firm']) {
    console.log(`${k.padEnd(12)}${String(byKind[k] ?? 0).padStart(5)}${String(recordsByKind[k] ?? 0).padStart(23)}`);
  }

  console.log('\n--- TEN EXTRACTED FACTS, EACH WITH THE SENTENCE IT CAME FROM ---');
  const shown: string[] = [];
  outer: for (const kind of ['rooms', 'floors', 'seats', 'sqft', 'acres', 'money', 'firm']) {
    for (const r of withFacts) {
      const f = r.facts.find((x) => x.kind === kind && !shown.includes(`${x.kind}:${x.display}`));
      if (!f) continue;
      shown.push(`${f.kind}:${f.display}`);
      console.log(`\n${shown.length}. [${f.kind}] ${f.display}`);
      console.log(`   project : ${live.get(r.row.project_id!)}`);
      console.log(`   source  : ${r.row.url}`);
      console.log(`   sentence: "${f.sentence}"`);
      if (shown.length >= 10) break outer;
    }
  }
  // Top up to ten from whatever is left, so the sample is ten even when a kind
  // is absent from the corpus.
  if (shown.length < 10) {
    for (const r of withFacts) {
      for (const f of r.facts) {
        if (shown.includes(`${f.kind}:${f.display}`)) continue;
        shown.push(`${f.kind}:${f.display}`);
        console.log(`\n${shown.length}. [${f.kind}] ${f.display}`);
        console.log(`   project : ${live.get(r.row.project_id!)}`);
        console.log(`   source  : ${r.row.url}`);
        console.log(`   sentence: "${f.sentence}"`);
        if (shown.length >= 10) break;
      }
      if (shown.length >= 10) break;
    }
  }

  // ---- what this changes for the projects Part 5 names ----------------------
  // ---- attribution: what actually belongs in a project entry ----------------
  console.log('\n\n===== ATTRIBUTION: WHICH FACTS ARE ABOUT THE PROJECT =====\n');
  console.log('An article about a project also discusses other projects. A fact');
  console.log('reaches the entry only when its own sentence names the project or a');
  console.log('party to it. The rest stay on the record line.\n');
  let allFacts = 0;
  let attributed = 0;
  for (const r of results) {
    const terms = attributionTerms(live.get(r.row.project_id!) ?? '', applicantOf.get(r.row.project_id!));
    allFacts += r.facts.length;
    attributed += factsForEntry(r.facts, terms).length;
  }
  console.log(`facts extracted        : ${allFacts}`);
  console.log(`survive attribution    : ${attributed}  (${pct(attributed, allFacts)})`);
  console.log(`held on the record line: ${allFacts - attributed}`);

  console.log('\n\n===== THE PROJECTS PART 5 NAMES =====');
  for (const needle of ['Heart Hotel', 'OCVibe', 'Metropolitan Park']) {
    const rs = results.filter((r) => (live.get(r.row.project_id!) ?? '').toLowerCase().includes(needle.toLowerCase()));
    if (!rs.length) { console.log(`\n${needle}: no article read`); continue; }
    const pid = rs[0].row.project_id!;
    const terms = attributionTerms(live.get(pid) ?? '', applicantOf.get(pid));
    const facts = rs.flatMap((r) => r.facts);
    const entry = factsForEntry(facts, terms);
    console.log(`\n${needle}: ${rs.length} articles read, ${facts.length} facts, ${entry.length} about this project`);
    console.log(`  attribution terms: ${terms.join(', ')}`);
    for (const f of entry) {
      console.log(`   [${f.kind}] ${f.display}`);
    }
    const dropped = facts.filter((f) => !isAttributed(f, terms));
    const uniq = [...new Set(dropped.map((f) => `${f.kind} ${f.display}`))];
    console.log(`  held back (${uniq.length} distinct): ${uniq.slice(0, 12).join(' | ')}`);
  }

  if (!WRITE) {
    console.log('\n\nNothing was written. Re-run with --write once migration 034 is applied.');
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
