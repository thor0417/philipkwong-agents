// READ-ONLY. WHAT NEW YORK'S STORED TEXT ACTUALLY SAYS.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/nyc-vocab.ts
//   ... --show <field>   every value found for one field, for hand-checking
//
// Nothing is written. Same method as Clark and in the same order: sample the
// real text, report every field and its phrasing with counts and a verbatim
// example, and only then write a reader. Never a guessed vocabulary.
//
// WHY NEW YORK IS FIRST DESPITE HAVING NO DOCUMENTS. 93 live projects, 35% of
// the register, and 4 of them carry a readable document. But the three adapters
// already store 1,058 to 2,315 characters of structured text per record in
// raw_content - more than a Clark agenda sheet's General Summary block - and
// nothing reads any of it. It is captured, it is free, and it names co-applicants,
// square footage and unit counts in prose.
//
// THE TEXT IS NOT A DOCUMENT AND THAT CHANGES THE METHOD. Clark's agenda sheet is
// a form with labelled bullets. NYC's is a paragraph an agency wrote, so the
// field list has to come out of the prose rather than off a bullet, and the
// first job is finding which phrasings recur often enough to be a rule rather
// than a coincidence.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const SHOW = (() => {
  const i = process.argv.indexOf('--show');
  return i > -1 ? process.argv[i + 1] : null;
})();

interface Lead {
  id: string; title: string | null; url: string | null; source: string | null;
  status: string | null; raw_content: string | null; project_id: string | null;
  applicant: string | null; presented_by: string | null; action_sought: string | null;
  published_date: string | null;
}

const ADAPTERS = ['nyc-zap', 'nyc-ceqr', 'nyc-city-record'];
const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');
const oneLine = (s: string, n = 120) => s.replace(/\s+/g, ' ').trim().slice(0, n);

async function main(): Promise<void> {
  const rows: Lead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,url,source,status,raw_content,project_id,applicant,presented_by,action_sought,published_date')
      .in('source', ADAPTERS)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Lead[]));
    if (data.length < 1000) break;
  }
  const live = rows.filter((r) => r.status !== 'dismissed');

  console.log('===== THE SAMPLE =====\n');
  console.log('adapter            records   raw_content chars min/median/max');
  for (const a of ADAPTERS) {
    const list = live.filter((r) => r.source === a);
    const lens = list.map((r) => (r.raw_content ?? '').length).sort((x, y) => x - y);
    console.log(
      `${a.padEnd(18)}${String(list.length).padStart(6)}   ${String(lens[0] ?? 0).padStart(6)} / ${String(lens[Math.floor(lens.length / 2)] ?? 0).padStart(6)} / ${String(lens[lens.length - 1] ?? 0).padStart(6)}`
    );
  }

  // ---- THE FIELD LIST, READ OFF THE TEXT ------------------------------------
  //
  // Each adapter writes a header of `Label: value` pairs before the prose. This
  // finds every label it uses, which is the vocabulary the reader must key on
  // and is not guessable from the outside.
  console.log('\n\n===== THE LABELS EACH ADAPTER WRITES =====\n');
  const LABEL = /(?:^|\n)([A-Z][A-Za-z /()-]{2,40}?):\s*([^\n]{1,160})/g;
  for (const a of ADAPTERS) {
    const list = live.filter((r) => r.source === a);
    const counts = new Map<string, { n: number; example: string }>();
    for (const r of list) {
      const t = r.raw_content ?? '';
      LABEL.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = LABEL.exec(t)) !== null) {
        const k = m[1].trim();
        const e = counts.get(k) ?? { n: 0, example: oneLine(m[2], 84) };
        e.n++;
        counts.set(k, e);
      }
    }
    console.log(`--- ${a}  (${list.length} records) ---`);
    console.log('  docs  share   label                          example');
    for (const [k, e] of [...counts.entries()].sort((x, y) => y[1].n - x[1].n)) {
      console.log(`${String(e.n).padStart(6)}${pct(e.n, list.length).padStart(7)}   ${k.slice(0, 28).padEnd(30)} ${e.example}`);
    }
    console.log('');
  }

  // ---- THE PROSE, WHICH IS WHERE THE SCALE IS -------------------------------
  //
  // The header is labelled and easy. The project description is a paragraph, and
  // it is the paragraph that carries square footage, unit counts and the
  // co-applicants. These are the phrasings, counted, so a reader is written
  // against what New York writes rather than what a regex author expects.
  const PHRASINGS: [string, RegExp][] = [
    ['"N square feet" / "N-square-foot"', /\b[\d,]{3,12}(?:[- ]|\s+)?(?:gross[- ])?square[- ]?(?:feet|foot)\b/i],
    ['"gross square feet" specifically', /\bgross[- ]square[- ]?(?:feet|foot)\b/i],
    ['"N sf" or "N s.f."', /\b[\d,]{3,12}\s*s\.?f\.?\b/i],
    ['"N dwelling units"', /\b[\d,]{1,7}\s+dwelling units\b/i],
    ['"N units of housing" / "N units"', /\b[\d,]{1,7}\s+(?:residential\s+)?units\b/i],
    ['"N percent affordable"', /\b\d{1,3}\s*percent\s+affordable\b/i],
    ['"N-story" / "N stories"', /\b\d{1,3}[- ]?stor(?:y|ies|ey|eys)\b/i],
    ['"N feet" in height', /\b\d{2,4}[- ]?(?:feet|foot|ft\.?)\b/i],
    ['"N hotel rooms" / "N-room hotel"', /\b[\d,]{2,7}[- ]?(?:hotel\s+)?rooms?\b/i],
    ['"N seats" / "N-seat"', /\b[\d,]{2,7}[- ]?seats?\b/i],
    ['"N parking spaces"', /\b[\d,]{1,7}\s+parking spaces\b/i],
    ['"Block N, Lot N"', /\bBlock\s+\d{1,5},?\s+Lots?\s+[\d,\sand]{1,30}/i],
    ['"Community District N"', /\bCommunity District\s+\d{1,2}\b/i],
    ['a borough name', /\b(Manhattan|Brooklyn|Queens|The Bronx|Bronx|Staten Island)\b/],
    ['"applicant" / "co-applicants"', /\bco-?applicants?\b/i],
    ['a named LLC or Corp', /\b[A-Z][\w&'.-]*(?:\s+[A-Z][\w&'.-]*){0,4}\s+(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Company)\b/],
    ['"seeks/requests ... actions"', /\b(?:seeks?|requests?|is seeking)\s+(?:a\s+series\s+of\s+)?(?:discretionary\s+)?(?:land use\s+)?actions?\b/i],
    ['a ULURP number', /\b\d{2}[A-Z]{3}\d{3,4}[A-Z]?\b/],
    ['a CEQR number', /\b\d{2}[A-Z]{2,4}\d{3,4}[A-Z]\b/],
    ['a hearing or meeting date', /\b(?:hearing|meeting)[^\n]{0,40}(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}/i],
    ['a dollar amount', /\$\s?[\d,]{3,}/],
    ['"zoning district" change', /\b(?:rezon|zoning map amendment|special permit|zoning text amendment|C\d-\d|R\d{1,2}[A-Z]?|M\d-\d)\b/],
    ['"affordable" anything', /\baffordable\b/i],
    ['a named component', /\b(hotel|arena|stadium|casino|theat(?:re|er)|museum|convention|waterfront|park\b|open space)\b/i],
  ];

  console.log('\n===== HOW NEW YORK PHRASES IT, PER ADAPTER =====\n');
  console.log('records containing the phrasing, out of that adapter\'s records.\n');
  console.log('phrasing'.padEnd(38) + ADAPTERS.map((a) => a.replace('nyc-', '').slice(0, 11).padStart(13)).join(''));
  for (const [name, re] of PHRASINGS) {
    let line = name.slice(0, 36).padEnd(38);
    for (const a of ADAPTERS) {
      const list = live.filter((r) => r.source === a);
      const hit = list.filter((r) => re.test(r.raw_content ?? '')).length;
      line += `${hit}/${list.length}`.padStart(13);
    }
    console.log(line);
  }

  console.log('\n--- one verbatim example each, from whichever adapter has it ---');
  for (const [name, re] of PHRASINGS) {
    let shown = false;
    for (const r of live) {
      const t = r.raw_content ?? '';
      const m = re.exec(t);
      if (!m) continue;
      const at = m.index ?? 0;
      console.log(`  ${name.slice(0, 36).padEnd(38)}[${r.source}] "${oneLine(t.slice(Math.max(0, at - 45), at + 105), 145)}"`);
      shown = true;
      break;
    }
    if (!shown) console.log(`  ${name.slice(0, 36).padEnd(38)}not found in any record`);
  }

  if (SHOW) {
    const re = PHRASINGS.find(([n]) => n.toLowerCase().includes(SHOW.toLowerCase()))?.[1];
    if (!re) { console.log(`\nno phrasing matching "${SHOW}"`); return; }
    console.log(`\n\n===== EVERY MATCH FOR "${SHOW}" =====\n`);
    let n = 0;
    for (const r of live) {
      const t = r.raw_content ?? '';
      const m = re.exec(t);
      if (!m) continue;
      n++;
      const at = m.index ?? 0;
      console.log(`${String(n).padStart(3)}. [${r.source}] ${(r.title ?? '').slice(0, 40)}`);
      console.log(`     "${oneLine(t.slice(Math.max(0, at - 60), at + 140), 190)}"`);
    }
    console.log(`\n${n} records.`);
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
