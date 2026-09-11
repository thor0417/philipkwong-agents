// READ-ONLY. WHAT AN ANAHEIM ACTION AGENDA ACTUALLY PRINTS.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/anaheim-action-vocab.ts
//
// The vocabulary pass every reader in this tree was written after, and the one
// `clark-ordinance-title` never got outside Clark: per-field hit rates over the
// real documents, and the false positives each pattern would produce, BEFORE a
// reader exists to defend.
//
// WHY THIS DOCUMENT AND NOT THE AGENDA. Anaheim is below the market standard on
// one criterion, DECISION (verify:market-standard: 14 live, 11 party, 2 facts, 0
// decision). Measured 2026-09-11, none of the 44 reachable Planning Commission
// AGENDAS carries a vote or is titled ACTION AGENDA: they are the programme,
// published before the meeting. The AgendaCenter entry filed under Minutes is
// not minutes - it opens "CITY OF ANAHEIM PLANNING COMMISSION ACTION AGENDA" and
// carries the roll call, the motion and the vote. 33 of the 44 dates publish
// one, and every one of them opens from this machine.
//
// THE SHAPE, from 2026-08-24 item 1:
//
//     Approved Resolution No.
//     PC2026-020.
//
//     MOTION: (Walker/Perez)
//
//     VOTE:  5-1-1
//     Chairperson Castro and Commissioners: Lieberman, Perez, Tran-Martin,
//     and Walker voted yes.
//     Commissioner Kelly abstained.
//     Commissioner Abdulrahman voted no.
//
// THE MOVERS ARE NOT A PARTY. "(Walker/Perez)" are commissioners of the deciding
// body, the same class as the Project Planner the Anaheim reader already stores
// as `case_planner` rather than as an applicant. Counted here so the decision is
// not silently read as naming somebody, never stored as one.

import { pathToFileURL } from 'node:url';
import { fetchPdfPages } from '../sources/pdf-agenda';
import { BROWSER_UA } from '../sources/http';
import { readAnaheimFacts } from '../readers/anaheim-agenda';

const YEARS = ['2025', '2026'];
const PC_CATEGORY = '18';

// Candidate patterns. NOTHING HERE IS WIRED TO ANYTHING; this file measures what
// each would do if it were.
const CANDIDATES: { name: string; re: RegExp }[] = [
  // The action itself. Anchored on the verb followed by what was resolved, so
  // the Request line - "the applicant requests approval of a tentative tract
  // map" - cannot match: that is lower case and reads "approval", not
  // "Approved".
  { name: 'Approved Resolution No. PCyyyy-nnn', re: /\bApproved\s+Resolution\s+No\.\s*\n?\s*(PC\d{4}-\d{1,4})/gi },
  { name: 'Denied', re: /\bDenied\s+(?:the\s+)?(?:request|Resolution)/gi },
  { name: 'Continued to <date>', re: /\bContinued\s+to\s+([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/gi },
  { name: 'Withdrawn', re: /\bWithdrawn\b/gi },
  { name: 'Received and filed', re: /\bReceived\s+and\s+filed\b/gi },
  // The vote.
  { name: 'VOTE: n-n(-n)', re: /\bVOTE:\s*(\d{1,2}-\d{1,2}(?:-\d{1,2})?)/gi },
  { name: 'MOTION: (a/b)', re: /\bMOTION:\s*\(([^)]{3,60})\)/gi },
  // The false-positive candidates. Counted so the cost of a looser pattern is a
  // number rather than a worry.
  { name: 'FP: bare "approval" anywhere', re: /\bapprov(?:al|e)\b/gi },
  { name: 'FP: bare "Approved" anywhere', re: /\bApproved\b/g },
  { name: 'FP: "appeal period"', re: /\bappeal\s+period\b/gi },
];

async function listFiles(kind: 'Agenda' | 'Minutes'): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const y of YEARS) {
    const u =
      `https://www.anaheim.net/AgendaCenter/Search/?term=&CIDs=${PC_CATEGORY}` +
      `&startDate=01/01/${y}&endDate=12/31/${y}&dateRange=&dateSelector=&backButton=false`;
    let html = '';
    try {
      const res = await fetch(u, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(20_000) });
      html = res.ok ? await res.text() : '';
    } catch {
      html = '';
    }
    const re = new RegExp(`/AgendaCenter/ViewFile/(${kind})/_(\\d{2})(\\d{2})(\\d{4})-(\\d+)`, 'g');
    for (const m of html.matchAll(re)) {
      out.set(
        `${m[4]}-${m[2]}-${m[3]}`,
        `https://www.anaheim.net/AgendaCenter/ViewFile/${kind}/_${m[2]}${m[3]}${m[4]}-${m[5]}`
      );
    }
  }
  return out;
}

async function main(): Promise<void> {
  const agendas = await listFiles('Agenda');
  const minutes = await listFiles('Minutes');
  console.log('='.repeat(100));
  console.log('THE ANAHEIM ACTION AGENDA, MEASURED BEFORE A READER EXISTS');
  console.log('='.repeat(100));
  console.log(`Planning Commission dates published on www.anaheim.net: ${agendas.size} with an Agenda, ${minutes.size} with an ACTION AGENDA`);
  console.log(`  dates carrying both: ${[...agendas.keys()].filter((d) => minutes.has(d)).length}`);
  console.log(`  dates with an agenda and no action agenda: ${[...agendas.keys()].filter((d) => !minutes.has(d)).length}`);

  let docs = 0;
  let isAction = 0;
  let chars = 0;
  let items = 0;
  const hits = new Map<string, number>();
  const docsWith = new Map<string, number>();
  const samples = new Map<string, string[]>();
  const perItem: { date: string; item: string; action: string; vote: string; movers: string }[] = [];
  // FETCH ONCE. The second pass below re-read every document and came back empty
  // on all 33, printing nothing and looking like a finding: no item lacks a
  // readable action. It was the fetch, not the corpus. A cache is the fix and
  // the reason it is here is the reason it is written down.
  const cache = new Map<string, string>();
  // And a second index keyed by URL, for the sections that read BOTH shapes.
  const byUrl = new Map<string, string>();

  for (const [date, url] of [...minutes.entries()].sort()) {
    const text = ((await fetchPdfPages(url)) ?? []).join('\n');
    if (!text) {
      console.log(`  ${date}  NO TEXT  ${url}`);
      continue;
    }
    cache.set(date, text);
    docs++;
    chars += text.length;
    if (/PLANNING COMMISSION\s*\n?\s*ACTION AGENDA/i.test(text.replace(/\s+/g, ' ')) || /ACTION AGENDA/i.test(text.slice(0, 800))) isAction++;

    for (const c of CANDIDATES) {
      const found = [...text.matchAll(c.re)];
      if (found.length) {
        hits.set(c.name, (hits.get(c.name) ?? 0) + found.length);
        docsWith.set(c.name, (docsWith.get(c.name) ?? 0) + 1);
        const s = samples.get(c.name) ?? [];
        if (s.length < 3) {
          s.push(found[0][0].replace(/\s+/g, ' ').slice(0, 70));
          samples.set(c.name, s);
        }
      }
    }

    // Per ITEM, which is the unit a record is. The block runs to the next item
    // or to the end, exactly as the existing Anaheim reader scopes itself.
    const marks = [...text.matchAll(/ITEM\s+NO\.\s*(\d{1,2})/gi)];
    for (let i = 0; i < marks.length; i++) {
      items++;
      const start = marks[i].index ?? 0;
      const end = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : text.length;
      const block = text.slice(start, end);
      const action =
        block.match(/\bApproved\s+Resolution\s+No\.\s*\n?\s*(PC\d{4}-\d{1,4})/i)?.[0] ??
        block.match(/\bContinued\s+to\s+[A-Z][a-z]+\s+\d{1,2},\s*\d{4}/i)?.[0] ??
        block.match(/\bDenied[^\n]{0,60}/i)?.[0] ??
        block.match(/\bWithdrawn[^\n]{0,40}/i)?.[0] ??
        '';
      perItem.push({
        date,
        item: marks[i][1],
        action: action.replace(/\s+/g, ' ').trim(),
        vote: block.match(/\bVOTE:\s*(\d{1,2}-\d{1,2}(?:-\d{1,2})?)/i)?.[1] ?? '',
        movers: block.match(/\bMOTION:\s*\(([^)]{3,60})\)/i)?.[1]?.replace(/\s+/g, ' ') ?? '',
      });
    }
  }

  console.log('');
  console.log(`documents read ${docs}, titled ACTION AGENDA ${isAction}, mean ${docs ? Math.round(chars / docs) : 0} chars, ITEM NO. blocks ${items}`);
  console.log('');
  console.log(`${'pattern'.padEnd(38)} ${'docs'.padStart(5)} ${'hits'.padStart(6)}   first match`);
  for (const c of CANDIDATES) {
    console.log(
      `${c.name.padEnd(38)} ${String(docsWith.get(c.name) ?? 0).padStart(5)} ${String(hits.get(c.name) ?? 0).padStart(6)}   ${(samples.get(c.name) ?? [''])[0] ?? ''}`
    );
  }

  console.log('');
  console.log('PER ITEM. This is what a reader would store.');
  const withAction = perItem.filter((p) => p.action).length;
  const withVote = perItem.filter((p) => p.vote).length;
  const withBoth = perItem.filter((p) => p.action && p.vote).length;
  console.log(`  items ${perItem.length}   with an action ${withAction}   with a vote ${withVote}   with both ${withBoth}`);
  console.log('');
  for (const p of perItem) {
    console.log(
      `  ${p.date}  item ${p.item.padStart(2)}  ${(p.vote || '-').padEnd(8)} ${(p.movers || '-').padEnd(22)} ${p.action.slice(0, 52) || '(NO ACTION READ)'}`
    );
  }

  // THE ITEMS THAT CARRY A VOTE AND NO ACTION THIS PATTERN SET CAN READ. The
  // 200 characters before the VOTE line, which is where the action is printed.
  console.log('');
  console.log('  ITEMS WITH A VOTE AND NO READABLE ACTION, showing what precedes the vote:');
  console.log(`  (cache holds ${cache.size} documents)`);
  for (const date of [...minutes.keys()].sort()) {
    const text = cache.get(date);
    if (!text) continue;
    const marks = [...text.matchAll(/ITEM\s+NO\.\s*(\d{1,2})/gi)];
    console.log(`      ${date}: ${text.length} chars, ${[...text.matchAll(/ITEM\s+NO\./gi)].length} item marks, VOTE present ${/VOTE:/i.test(text)}`);
    for (let i = 0; i < marks.length; i++) {
      const start = marks[i].index ?? 0;
      const end = i + 1 < marks.length ? (marks[i + 1].index ?? text.length) : text.length;
      const block = text.slice(start, end);
      const vote = block.match(/\bVOTE:\s*(\d{1,2}-\d{1,2}(?:-\d{1,2})?)/i);
      if (!vote) continue;
      // THE ACTION SITS IMMEDIATELY BEFORE THE MOTION LINE, in every document read.
      // That is STRUCTURE rather than vocabulary, and structure is what a reader
      // keys on where the wording varies. Printed for every item that carries a
      // vote, so the variety is visible before a pattern is chosen rather than
      // after one has been defended.
      const motion = block.match(/MOTION:/i);
      const at = motion?.index ?? vote.index ?? 0;
      console.log(
        `    ${date} item ${marks[i][1]} [${vote[1]}]: ...${block.slice(Math.max(0, at - 200), at).replace(/\s+/g, ' ').trim()}`
      );
    }
  }

  // ---- THE READER ITSELF, OVER BOTH DOCUMENTS -----------------------------
  //
  // Standing rule 2: measured before and after, and the after is measured on
  // BOTH shapes. The action agenda is where a decision may be read; the agenda
  // is where it must not be, and an agenda reporting a decision it never saw
  // would be the same defect as a press round-up attributing a figure.
  console.log('');
  console.log('-'.repeat(100));
  console.log('THE READER, RUN OVER BOTH DOCUMENT SHAPES');
  console.log('-'.repeat(100));
  for (const [label, map] of [
    ['ACTION AGENDA (the meeting record)', minutes],
    ['AGENDA (the programme)', agendas],
  ] as const) {
    let docs2 = 0;
    let reached = 0;
    let facts = 0;
    let actions = 0;
    let votesRead = 0;
    let conditions = 0;
    const kinds = new Map<string, number>();
    for (const [, url] of [...map.entries()].sort()) {
      // KEYED BY URL, NOT BY DATE. An agenda and an action agenda share a
      // meeting date, so a date-keyed cache served the ACTION agenda's text for
      // the agenda row: the false-positive check measured the same 33 documents
      // twice and reported identical numbers for both shapes, which reads as a
      // reader that cannot tell them apart. It was the cache, not the reader.
      const text = byUrl.get(url) ?? ((await fetchPdfPages(url)) ?? []).join('\n');
      if (!text) continue;
      byUrl.set(url, text);
      docs2++;
      const f = readAnaheimFacts(text, { allItems: true });
      if (f.length) reached++;
      facts += f.length;
      for (const x of f) {
        kinds.set(x.kind, (kinds.get(x.kind) ?? 0) + 1);
        if (x.kind === 'commission_action') actions++;
        if (x.kind === 'the_vote') votesRead++;
        if (x.kind === 'condition') conditions++;
      }
    }
    console.log(`  ${label}`);
    console.log(`    documents ${docs2}   yielding ${reached}   facts ${facts}   commission_action ${actions}   the_vote ${votesRead}   CONDITIONS ${conditions}`);
    console.log(`    kinds: ${[...kinds.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
  }

  // What the action field actually stores, in full, so a value nobody would send
  // to a client is visible here rather than in a document.
  console.log('');
  console.log('  every commission_action value the reader would store:');
  for (const [date] of [...minutes.entries()].sort()) {
    const text = cache.get(date);
    if (!text) continue;
    for (const f of readAnaheimFacts(text, { allItems: true })) {
      if (f.kind !== 'commission_action') continue;
      console.log(`    ${date}  ${f.display.slice(0, 150)}`);
    }
  }

  // THE VOTE VALUES, so a pattern that reads a page number as a vote is visible.
  const votes = new Map<string, number>();
  for (const p of perItem) if (p.vote) votes.set(p.vote, (votes.get(p.vote) ?? 0) + 1);
  console.log('');
  console.log('  vote values seen:');
  for (const [v, n] of [...votes.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${v.padEnd(10)} x${n}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
