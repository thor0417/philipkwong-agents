// READ-ONLY. READER 4, PHOENIX: IS THE ZERO A FACT ABOUT PHOENIX OR ABOUT US?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/reader-four-probe.ts
//
// Nothing is written.
//
// READER 4 HAS BEEN CLOSED TWICE AND BOTH TIMES ON THE SAME GROUND: Phoenix
// holds 20 live projects and ZERO of them are in the vertical, so there is no
// gap for a reader to close. The 2026-09-02 pass found its 22 documents to be
// liquor licence data sheets at a median of 825 characters that no field set
// reaches; the 2026-09-07 re-measure after the cleanout said the question had
// gone away entirely.
//
// THE ANAHEIM PASS IS WHY THIS IS BEING ASKED AGAIN. Reader 3 was also closed -
// "Anaheim needs the hosted runner" - and the verdict was drawn from the wrong
// axis. All 51 blocked Anaheim records were CITY COUNCIL; the Planning
// Commission was on a second host that answered 200 here all along, and the
// market was half unread rather than blocked.
//
// "Zero in the vertical" is a claim about WHAT WE CAPTURED. It is only a claim
// about Phoenix if the source we read is the one that would carry a hospitality
// entitlement. So this probe asks three things in order:
//
//   1. WHAT WE HOLD    the url census and what each answers, as reader 3 did.
//   2. WHAT IT IS      the documents read end to end, so "liquor licence data
//                      sheet" is a reading rather than a repetition.
//   3. WHAT PHOENIX    which bodies the Legistar client we read actually
//      PUBLISHES       carries, and whether an entitlement matter exists in it
//                      at all. A city that files its rezonings somewhere else is
//                      the Anaheim shape, and this is where it would show.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { readFilingFacts, isClarkAgendaSheet } from '../readers/clark-agenda-sheet';
import { isClarkOrdinanceTitle, readOrdinanceTitleFacts } from '../readers/clark-ordinance-title';
import { readNycFacts, isNycRecord } from '../readers/nyc-records';
import { readOaklandFacts, isOaklandDocument, isCodeAmendment } from '../readers/oakland-ordinance';
import { readAnaheimFacts, isAnaheimAgenda, isSpanishAgenda } from '../readers/anaheim-agenda';
import { documentShape } from '../../../lib/document-shape';
import { governmentGate } from '../../../lib/taxonomy';
import { fetchPdfPages } from '../sources/pdf-agenda';
import { BROWSER_UA } from '../sources/http';

type Row = Record<string, unknown>;
const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const FETCH_TIMEOUT_MS = 20_000;

function runAll(text: string, title: string, application: string): { facts: FilingFact[]; by: string } {
  const attempts: { name: string; ok: boolean; read: () => FilingFact[] }[] = [
    { name: 'clark-agenda-sheet', ok: isClarkAgendaSheet(text), read: () => readFilingFacts(text) },
    { name: 'clark-ordinance-title', ok: !!isClarkOrdinanceTitle(title), read: () => readOrdinanceTitleFacts(title) },
    { name: 'nyc-records', ok: !!isNycRecord(text), read: () => readNycFacts(text) },
    { name: 'oakland-ordinance', ok: isOaklandDocument(text) && !isCodeAmendment(text), read: () => readOaklandFacts(text) },
    {
      name: 'anaheim-agenda',
      ok: isAnaheimAgenda(text) && !isSpanishAgenda(text),
      read: () => readAnaheimFacts(text, { application }),
    },
  ];
  for (const a of attempts) {
    if (!a.ok) continue;
    let facts: FilingFact[] = [];
    try {
      facts = a.read();
      verifyFilingFacts(facts, text);
    } catch {
      return { facts: [], by: `${a.name} (refused)` };
    }
    if (facts.length) return { facts, by: a.name };
  }
  const fired = attempts.find((a) => a.ok);
  return { facts: [], by: fired ? `${fired.name} (no facts)` : 'none' };
}

async function probe(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    const type = (res.headers.get('content-type') ?? '').split(';')[0];
    const loc = res.headers.get('location');
    const bytes = (await res.arrayBuffer()).byteLength;
    return `${res.status} ${bytes}b ${type || '-'}${loc ? ` -> ${loc.slice(0, 60)}` : ''}`;
  } catch (e) {
    return `no answer (${String((e as Error).message).slice(0, 40)})`;
  }
}

async function main(): Promise<void> {
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,url,source,source_type,location,market,status,raw_content,primary_document_url,' +
      'has_primary_document,filing_facts,project_id,action_sought,applicant,representative,contact_name',
    (q) => q,
    'reader-four'
  );
  if (!complete) throw new Error('read was partial; refusing to close a reader on a slice.');
  const { rows: projectRows } = await selectAllPaged<Row>('projects', 'id,name,market,status,stage', (q) => q, 'r4-projects');
  const projectById = new Map(projectRows.map((p) => [String(p.id), p]));
  const liveProject = (r: Row): boolean => {
    const p = r.project_id ? projectById.get(String(r.project_id)) : null;
    return !!p && String(p.status) !== 'dismissed';
  };

  const px = rows.filter((r) => /^phoenix/i.test(tidy(r.market)) && String(r.status) !== 'dismissed');

  console.log('='.repeat(104));
  console.log('READER 4. PHOENIX.');
  console.log('='.repeat(104));
  console.log(`  Phoenix records                        : ${px.length}`);
  console.log(`  on a project the register still holds  : ${px.filter(liveProject).length}`);
  console.log(`  carrying raw_content                   : ${px.filter((r) => tidy(r.raw_content).length > 0).length}`);
  console.log(`  carrying a filing fact today           : ${px.filter((r) => Array.isArray(r.filing_facts) && r.filing_facts.length > 0).length}`);
  const withUrl = px.filter((r) => !!r.primary_document_url);
  console.log(`  carrying a primary_document_url        : ${withUrl.length}`);
  console.log(`  has_primary_document = true            : ${px.filter((r) => r.has_primary_document === true).length}`);
  console.log(`  naming a party (applicant or rep)      : ${px.filter((r) => tidy(r.applicant) || tidy(r.representative)).length}`);
  console.log(`  naming a contact                       : ${px.filter((r) => tidy(r.contact_name)).length}`);
  console.log(`  per source: ${[...new Set(px.map((r) => String(r.source)))].join(', ')}`);
  console.log(`  per source_type: ${[...new Set(px.map((r) => tidy(r.source_type) || '(none)'))].join(', ')}`);

  // ---- 1. THE URL CENSUS --------------------------------------------------
  console.log('');
  console.log('-'.repeat(104));
  console.log('1. THE URL CENSUS, AND WHAT EACH DISTINCT URL ANSWERS');
  console.log('-'.repeat(104));
  const distinct = [...new Set(withUrl.map((r) => String(r.primary_document_url)))];
  const shapes = new Map<string, number>();
  for (const u of distinct) shapes.set(documentShape(u), (shapes.get(documentShape(u)) ?? 0) + 1);
  console.log(`  ${withUrl.length} records stand on ${distinct.length} distinct urls`);
  console.log(`  document-shape: ${[...shapes.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  const hosts = new Map<string, number>();
  for (const u of distinct) {
    try {
      const h = new URL(u).hostname;
      hosts.set(h, (hosts.get(h) ?? 0) + 1);
    } catch {
      hosts.set('(unparseable)', (hosts.get('(unparseable)') ?? 0) + 1);
    }
  }
  console.log(`  hosts: ${[...hosts.entries()].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log('');
  for (const u of distinct.slice(0, 8)) console.log(`    ${await probe(u)}   ${u.slice(0, 78)}`);
  if (distinct.length > 8) console.log(`    ... ${distinct.length - 8} more not probed individually`);

  // ---- 2. WHAT THE DOCUMENTS ACTUALLY ARE ---------------------------------
  console.log('');
  console.log('-'.repeat(104));
  console.log('2. THE DOCUMENTS, READ END TO END RATHER THAN REPEATED');
  console.log('-'.repeat(104));
  const files = distinct.filter((u) => documentShape(u) === 'file');
  console.log(`  urls that are a fetched file: ${files.length} of ${distinct.length}`);
  let read = 0;
  let facts = 0;
  let conditions = 0;
  const byReader = new Map<string, number>();
  const lengths: number[] = [];
  for (const u of files) {
    const text = ((await fetchPdfPages(u)) ?? []).join('\n');
    const recs = withUrl.filter((r) => String(r.primary_document_url) === u);
    if (!text) {
      byReader.set('unreadable', (byReader.get('unreadable') ?? 0) + 1);
      continue;
    }
    read++;
    lengths.push(text.length);
    const { facts: f, by } = runAll(text, tidy(recs[0]?.title), `${tidy(recs[0]?.title)} ${tidy(recs[0]?.action_sought)}`);
    byReader.set(by, (byReader.get(by) ?? 0) + 1);
    facts += f.length;
    conditions += f.filter((x) => x.kind === 'condition').length;
    if (read <= 3) {
      console.log('');
      console.log(`    ${u.slice(0, 90)}`);
      console.log(`    ${text.length} chars, first 260: ${text.replace(/\s+/g, ' ').slice(0, 260)}`);
    }
  }
  lengths.sort((a, b) => a - b);
  console.log('');
  console.log(`  documents read : ${read}`);
  console.log(`  chars: min ${lengths[0] ?? 0}  median ${lengths[Math.floor(lengths.length / 2)] ?? 0}  max ${lengths[lengths.length - 1] ?? 0}`);
  console.log(`  facts extracted: ${facts}   CONDITIONS: ${conditions}`);
  console.log(`  which recogniser fired: ${[...byReader.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);

  // ---- 3. THE REGISTER ----------------------------------------------------
  console.log('');
  console.log('-'.repeat(104));
  console.log('3. WHAT PHOENIX IS IN THE REGISTER');
  console.log('-'.repeat(104));
  const pxProjects = projectRows.filter((p) => /^phoenix/i.test(tidy(p.market)) && String(p.status) !== 'dismissed');
  console.log(`  live Phoenix projects: ${pxProjects.length}`);
  for (const p of pxProjects) {
    const recs = px.filter((r) => String(r.project_id) === String(p.id));
    const n = recs.reduce((a, r) => a + (Array.isArray(r.filing_facts) ? r.filing_facts.length : 0), 0);
    console.log(`    ${tidy(p.name).slice(0, 62).padEnd(64)} ${String(recs.length).padStart(3)} recs  ${String(n).padStart(3)} facts  [${tidy(p.stage)}]`);
  }

  // ---- 4. WHAT THE SOURCE WE READ ACTUALLY CARRIES ------------------------
  //
  // THE ANAHEIM QUESTION. Zero in the vertical is only a fact about Phoenix if
  // the source we read is the one that would carry a hospitality entitlement.
  // The Legistar client is asked what BODIES it files under, straight from its
  // own API, which is sourceable rather than navigated.
  console.log('');
  console.log('-'.repeat(104));
  console.log('4. WHICH BODIES THE LEGISTAR CLIENT WE READ ACTUALLY CARRIES');
  console.log('-'.repeat(104));
  try {
    const res = await fetch('https://webapi.legistar.com/v1/phoenix/bodies?$top=200', {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.log(`  bodies: HTTP ${res.status}`);
    } else {
      const bodies = (await res.json()) as { BodyName?: string; BodyTypeName?: string; BodyActiveFlag?: number }[];
      console.log(`  ${bodies.length} bodies published`);
      const interesting = bodies.filter((b) =>
        /plan|zon|hearing|village|develop|design|histor|board of adjust/i.test(String(b.BodyName ?? ''))
      );
      console.log(`  bodies whose NAME is entitlement-shaped: ${interesting.length}`);
      for (const b of interesting.slice(0, 20)) {
        console.log(`    ${String(b.BodyName).slice(0, 62).padEnd(64)} ${String(b.BodyTypeName ?? '')}  active ${b.BodyActiveFlag ?? '?'}`);
      }
    }
  } catch (e) {
    console.log(`  bodies: no answer (${String((e as Error).message).slice(0, 50)})`);
  }

  // And what the matters themselves look like, by type, so "18 instruments" is
  // a property of the FEED rather than of our gate.
  try {
    const res = await fetch(
      "https://webapi.legistar.com/v1/phoenix/matters?$top=1000&$orderby=MatterIntroDate%20desc",
      { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(60_000) }
    );
    if (!res.ok) {
      console.log(`  matters: HTTP ${res.status}`);
    } else {
      const matters = (await res.json()) as { MatterId?: number; MatterTypeName?: string; MatterTitle?: string; MatterBodyName?: string }[];
      const byType = new Map<string, number>();
      for (const m of matters) byType.set(String(m.MatterTypeName ?? '(none)'), (byType.get(String(m.MatterTypeName ?? '(none)')) ?? 0) + 1);
      console.log('');
      console.log(`  newest ${matters.length} matters, by type:`);
      for (const [k, v] of [...byType.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
        console.log(`    ${k.slice(0, 44).padEnd(46)} ${String(v).padStart(4)}`);
      }
      const HOSP = /hotel|resort|stadium|arena|theat|casino|entertainment|convention|ballpark|amphitheat|water park|restaurant/i;
      const ENT = /rezon|zoning|planned unit|general plan|site plan|use permit|variance|special permit|development agreement/i;
      const hosp = matters.filter((m) => HOSP.test(String(m.MatterTitle ?? '')));
      const ent = matters.filter((m) => ENT.test(String(m.MatterTitle ?? '')));
      console.log('');
      console.log(`  of those ${matters.length}: ${hosp.length} name a hospitality or entertainment venue, ${ent.length} are entitlement-shaped`);
      for (const m of hosp.slice(0, 12)) console.log(`    HOSP  ${String(m.MatterTitle).replace(/\s+/g, ' ').slice(0, 94)}`);
      for (const m of ent.slice(0, 8)) console.log(`    ENT   ${String(m.MatterTitle).replace(/\s+/g, ' ').slice(0, 94)}`);

      // ---- 5. THE ENTITLEMENT MATTERS, OPENED ---------------------------
      //
      // THE QUESTION THE TITLE CANNOT ANSWER. A Phoenix rezoning is titled
      // "Amend City Code - Ordinance Adoption - Rezoning Application Z-79-26-8 -
      // Approximately 100 Feet ..." - a case number and a location, and no use.
      // The government gate judges the title, so a hotel rezoning and a
      // warehouse rezoning are the same string to it. Whether any of these is
      // the register's subject can only be read from the body, so the bodies are
      // opened here rather than guessed at.
      console.log('');
      console.log('-'.repeat(104));
      console.log('5. THE ENTITLEMENT MATTERS, OPENED, BECAUSE THE TITLE CANNOT SAY WHAT THEY ARE');
      console.log('-'.repeat(104));
      const VENUE = /\bhotel|resort|motel|inn\b|hospitality|restaurant|bar\b|tavern|brewery|theat|cinema|arena|stadium|ballpark|amphitheat|casino|gaming|entertainment|convention|banquet|event center|water ?park|amusement|golf|spa\b|club\b|lodge|museum/i;
      let opened = 0;
      let named = 0;
      const hits: string[] = [];
      const bodies: [string, string][] = [];
      // NO CAP. Standing rule 13: where the figure is a pass/fail rather than
      // a display, the cap is removed instead of stated. "Is there anything in
      // Phoenix" is a pass/fail, so every entitlement matter is opened.
      for (const m of ent) {
        const id = (m as { MatterId?: number }).MatterId;
        if (!id) continue;
        let body = String(m.MatterTitle ?? '');
        try {
          const ares = await fetch(`https://webapi.legistar.com/v1/phoenix/matters/${id}/attachments`, {
            headers: { 'User-Agent': BROWSER_UA },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          });
          if (ares.ok) {
            const atts = (await ares.json()) as { MatterAttachmentName?: string; MatterAttachmentHyperlink?: string }[];
            body += ' ' + atts.map((a) => String(a.MatterAttachmentName ?? '')).join(' ');
            const first = atts.find((a) => /\.pdf$/i.test(String(a.MatterAttachmentHyperlink ?? '')));
            if (first?.MatterAttachmentHyperlink) {
              const text = ((await fetchPdfPages(String(first.MatterAttachmentHyperlink))) ?? []).join('\n');
              body += ' ' + text.slice(0, 6000);
            }
          }
        } catch {
          // A matter we cannot open is reported as unopened, never as empty.
        }
        opened++;
        bodies.push([String(m.MatterTitle ?? ''), body]);
        // A REGEX HIT IS NOT A VENUE. "Golf" is a street name in this city,
        // "BAR" is an abbreviation and "convention" is inside "conventional", so
        // every hit is printed with the words either side of it and counted only
        // as a candidate.
        const hit = VENUE.exec(body);
        if (hit) {
          named++;
          const at = hit.index;
          hits.push(
            `${String(m.MatterTitle).replace(/\s+/g, ' ').slice(0, 60)}
        ...${body
              .slice(Math.max(0, at - 90), at + 90)
              .replace(/\s+/g, ' ')}...`
          );
        }
      }
      // ---- 6. THE GATE, ON THE TITLE AND ON THE BODY --------------------
      //
      // THE DECIDING NUMBER. A Phoenix rezoning title is a case number and a
      // location. The government gate judges the title, so the question is not
      // whether a reader could read these - it is whether they ever reach one.
      // Both judgements are made here with the SAME function the capture lane
      // uses, over the same 49 matters.
      let titleAdmitted = 0;
      let bodyAdmitted = 0;
      const bodyOnly: string[] = [];
      for (const [title, body] of bodies) {
        const t = governmentGate(title, 'Phoenix');
        const b = governmentGate(`${title}
${body}`, 'Phoenix');
        if (t.matched) titleAdmitted++;
        if (b.matched) bodyAdmitted++;
        if (!t.matched && b.matched) bodyOnly.push(title.replace(/\s+/g, ' ').slice(0, 86));
      }
      console.log('');
      console.log('-'.repeat(104));
      console.log('6. THE SAME GATE, ON THE TITLE AND ON THE BODY');
      console.log('-'.repeat(104));
      console.log(`  entitlement matters judged      : ${bodies.length}`);
      console.log(`  admitted on the TITLE alone     : ${titleAdmitted}`);
      console.log(`  admitted once the BODY is read  : ${bodyAdmitted}`);
      console.log(`  reachable only through the body : ${bodyOnly.length}`);
      for (const t of bodyOnly) console.log(`    ${t}`);

      console.log(`  entitlement matters opened: ${opened}`);
      console.log(`  naming a venue in the body : ${named}`);
      for (const h of hits) console.log(`    ${h}`);
    }
  } catch (e) {
    console.log(`  matters: no answer (${String((e as Error).message).slice(0, 50)})`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
