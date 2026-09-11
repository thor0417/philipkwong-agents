// READ-ONLY. READER 3, ANAHEIM GRANICUS: IS THERE A DOCUMENT BEHIND THOSE URLS?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/reader-three-probe.ts
//
// Nothing is written. The same first question reader 2 was asked, asked here
// before anything is built: ARE THE STORED URLS DOCUMENTS OR VIEWER PAGES, and
// how many DISTINCT things are behind the record count.
//
// Las Vegas answered that question the expensive way. 45 records carried a
// `primary_document_url` and the pile read as "45 unread documents we already
// hold"; they were 27 distinct MEETING pages and no documents at all, so the
// work it needed was a fetch rather than a reader. lib/document-shape carries
// that finding. Anaheim is the same shape of claim and it has never been
// counted the same way.
//
// ---------------------------------------------------------------------------
// WHAT IS ALREADY KNOWN, SO THIS PROBE ADDS RATHER THAN REPEATS
// ---------------------------------------------------------------------------
//
// BRIEF-U-ITEM-3-READERS-REMEASURED.md, 2026-09-07: `capture:filings --lane
// anaheim` read 73 records, extracted 77 facts and moved ZERO projects off
// zero, identical to the 2026-09-02 run. 51 of the 73 were refused as
// `no-document`. The verdict was that reader 3 needs no new reader, it needs
// the document, and the document is one redirect away on local.anaheim.net,
// which this egress cannot reach.
//
// THAT VERDICT WAS REACHED FROM ONE PROBED URL. `anaheim.granicus.com/
// AgendaViewer.php?view_id=2&clip_id=3570` answered 302 -> local.anaheim.net.
// Whether EVERY stored url does that, and whether the redirect target is the
// same unreachable host every time, was never counted. Both matter: a
// DocumentViewer url is a file and IS reachable from here, and the corpus is
// known to hold both shapes.
//
// So this probe answers three things the record cannot:
//
//   THE CENSUS   how many DISTINCT urls the records stand on, per shape.
//   THE PROBE    what each distinct url actually answers - code, bytes,
//                content-type, magic bytes, and where a 302 points. The body,
//                not the status code.
//   THE READ     every existing reader over the text the corpus already holds,
//                and over any document this egress CAN fetch, so "projects
//                moved off zero" is a measurement rather than an estimate.

import { pathToFileURL } from 'node:url';
import { selectAllPaged } from '../page-select';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { readFilingFacts, isClarkAgendaSheet } from '../readers/clark-agenda-sheet';
import { isClarkOrdinanceTitle, readOrdinanceTitleFacts } from '../readers/clark-ordinance-title';
import { readNycFacts, isNycRecord } from '../readers/nyc-records';
import { readOaklandFacts, isOaklandDocument, isCodeAmendment } from '../readers/oakland-ordinance';
import { readAnaheimFacts, isAnaheimAgenda, isSpanishAgenda } from '../readers/anaheim-agenda';
import { documentShape } from '../../../lib/document-shape';
import { fetchPdfPages } from '../sources/pdf-agenda';
import { BROWSER_UA, htmlToText } from '../sources/http';

type Row = Record<string, unknown>;
const tidy = (s: unknown): string => String(s ?? '').replace(/\s+/g, ' ').trim();
const FETCH_TIMEOUT_MS = 20_000;

// Every reader in the tree, run with its own recogniser first and the same
// all-or-nothing guard the write path applies. Identical to reader-two-probe so
// the two answers are comparable.
//
// THE APPLICATION KEY IS NOT OPTIONAL AND THIS PROBE LEARNED IT THE SAME WAY.
// The first run of this file called readAnaheimFacts(text) with no options and
// reported ZERO facts over documents the write path reads 77 from. An Anaheim
// agenda covers many items, and the reader is handed the ONE item the record is
// - `${title} ${action_sought}` - so the hotel item's acreage never lands under
// the church item. Called without it the reader has no item to scope to and
// correctly returns nothing. The write path is capture-filing-facts.ts:215 and
// this mirrors it rather than inventing a call.
function runAll(
  text: string,
  title: string,
  application: string
): { facts: FilingFact[]; by: string; refused: string | null } {
  const attempts: { name: string; ok: boolean; read: () => FilingFact[] }[] = [
    {
      name: 'anaheim-agenda',
      ok: isAnaheimAgenda(text) && !isSpanishAgenda(text),
      read: () => readAnaheimFacts(text, { application }),
    },
    { name: 'clark-agenda-sheet', ok: isClarkAgendaSheet(text), read: () => readFilingFacts(text) },
    { name: 'clark-ordinance-title', ok: !!isClarkOrdinanceTitle(title), read: () => readOrdinanceTitleFacts(title) },
    { name: 'nyc-records', ok: !!isNycRecord(text), read: () => readNycFacts(text) },
    {
      name: 'oakland-ordinance',
      ok: isOaklandDocument(text) && !isCodeAmendment(text),
      read: () => readOaklandFacts(text),
    },
  ];
  for (const a of attempts) {
    if (!a.ok) continue;
    let facts: FilingFact[] = [];
    try {
      facts = a.read();
      verifyFilingFacts(facts, text);
    } catch (e) {
      return { facts: [], by: a.name, refused: String((e as Error).message).slice(0, 100) };
    }
    if (facts.length) return { facts, by: a.name, refused: null };
  }
  // A recogniser that fired and yielded nothing is not the same as no
  // recogniser firing, and the two are reported apart.
  const fired = attempts.find((a) => a.ok);
  return { facts: [], by: fired ? `${fired.name} (no facts)` : 'none', refused: null };
}

// The url shape, named rather than numbered, so a census row says what it is.
function urlForm(url: string): string {
  const u = url.toLowerCase();
  if (/granicus\.com\/agendaviewer\.php/.test(u)) return 'granicus AgendaViewer (page)';
  if (/granicus\.com\/minutesviewer\.php/.test(u)) return 'granicus MinutesViewer (page)';
  if (/granicus\.com\/(documentviewer|metaviewer)\.php/.test(u)) return 'granicus DocumentViewer (file)';
  if (/granicus\.com\/(generatedagenda|mediaplayer)\.php/.test(u)) return 'granicus GeneratedAgenda/Media (page)';
  if (/\/documentcenter\/view\//.test(u)) return 'civicplus DocumentCenter (file)';
  if (/\/agendacenter\/viewfile\//.test(u)) return 'civicplus AgendaCenter ViewFile (file)';
  if (/\/agendacenter/.test(u)) return 'civicplus AgendaCenter (index)';
  if (/local\.anaheim\.net/.test(u)) return 'local.anaheim.net (questys)';
  if (/records\.anaheim\.net/.test(u)) return 'records.anaheim.net';
  if (/\.pdf(\?|$)/.test(u)) return 'a .pdf path';
  return 'other';
}

// WHICH BODY IS THIS RECORD FROM. The agenda-portal adapter writes it as the
// first words of raw_content ("City Council agenda item 5 - Anaheim, CA"), and
// it is the axis the whole of reader 3 turns on: Anaheim's two bodies publish
// through two different hosts and only one of them is reachable from here.
function bodyOf(r: Row): string {
  const t = tidy(r.raw_content).slice(0, 200);
  const m = t.match(/^(City Council|Planning Commission)/i);
  return m ? m[1] : '(unlabelled)';
}

// A meeting date match needs a day either side. The stored published_date is a
// UTC timestamp built from a free-text date parsed in LOCAL time, so every
// Anaheim record sits at 17:00:00Z on the day BEFORE its meeting. Matching on
// the exact string reported 3 of 44 meetings held; the true figure is 11. The
// shift itself is a defect and is measured on its own in date-shift-census.ts.
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

interface Probe {
  url: string;
  code: number | string;
  bytes: number;
  type: string;
  location: string;
  magic: string;
  verdict: string;
}

// WHAT DOES THIS URL ACTUALLY ANSWER. Manual redirect so a 302 is visible as a
// 302 rather than silently followed into a different host's error page, which
// is how a redirector came to read as a host.
async function probe(url: string, depth = 0): Promise<Probe> {
  const out: Probe = { url, code: 0, bytes: 0, type: '', location: '', magic: '', verdict: '' };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      redirect: 'manual',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    out.code = res.status;
    out.type = (res.headers.get('content-type') ?? '').split(';')[0];
    out.location = res.headers.get('location') ?? '';
    const buf = Buffer.from(await res.arrayBuffer());
    out.bytes = buf.length;
    out.magic = buf.subarray(0, 4).toString('latin1').replace(/[^\x20-\x7e]/g, '.');
    if (out.location && depth < 2) {
      const next = new URL(out.location, url).toString();
      const hop = await probe(next, depth + 1);
      out.verdict = `302 -> ${hop.url} :: ${hop.code} ${hop.bytes}b ${hop.type || '(no type)'} ${hop.verdict}`;
      return out;
    }
    if (out.code === 200 && /pdf/i.test(out.type)) out.verdict = 'FILE (pdf)';
    else if (out.code === 200 && /html/i.test(out.type)) {
      // A 200 that is HTML is a page, and a 200 that is HTML with no text is
      // not even that. The scorecard classifier learned this the hard way.
      const text = htmlToText(buf.toString('utf8'));
      out.verdict = text.length < 200 ? `PAGE, ${text.length}b of visible text (empty shell)` : `PAGE, ${text.length}b of text`;
    } else if (out.code === 200) out.verdict = `200 ${out.type || 'unknown type'}`;
    else out.verdict = `HTTP ${out.code}`;
  } catch (e) {
    out.code = 0;
    out.verdict = `no answer (${String((e as Error).message).slice(0, 48)})`;
  }
  return out;
}

async function textOf(url: string): Promise<string | null> {
  if (/\.pdf(\?|$)/i.test(url) || /DocumentViewer\.php/i.test(url) || /DocumentCenter|AgendaCenter/i.test(url)) {
    const pages = await fetchPdfPages(url);
    if (!pages || pages.length === 0) return null;
    return pages.join('\n');
  }
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': BROWSER_UA },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return htmlToText(await res.text());
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const { rows, complete } = await selectAllPaged<Row>(
    'leads',
    'id,title,url,source,location,market,status,raw_content,primary_document_url,has_primary_document,' +
      'filing_facts,project_id,action_sought,published_date',
    (q) => q,
    'reader-three'
  );
  if (!complete) throw new Error('read was partial; refusing to rank a reader on a slice.');

  const { rows: projectRows } = await selectAllPaged<Row>(
    'projects',
    'id,name,market,status,stage',
    (q) => q,
    'r3-projects'
  );
  const projectById = new Map(projectRows.map((p) => [String(p.id), p]));
  const liveProject = (r: Row): boolean => {
    const p = r.project_id ? projectById.get(String(r.project_id)) : null;
    return !!p && String(p.status) !== 'dismissed';
  };

  const an = rows.filter((r) => /^anaheim/i.test(tidy(r.market)) && String(r.status) !== 'dismissed');

  console.log('='.repeat(108));
  console.log('READER 3. ANAHEIM GRANICUS.');
  console.log('='.repeat(108));
  console.log('POPULATION: leads.market starts with Anaheim, status<>dismissed. Paged to exhaustion, no cap.');
  console.log('');
  console.log(`  Anaheim records                         : ${an.length}`);
  console.log(`  on a project the register still holds   : ${an.filter(liveProject).length}`);
  console.log(`  carrying raw_content                    : ${an.filter((r) => tidy(r.raw_content).length > 0).length}`);
  console.log(`  carrying a filing fact today            : ${an.filter((r) => Array.isArray(r.filing_facts) && r.filing_facts.length > 0).length}`);
  const withUrl = an.filter((r) => !!r.primary_document_url);
  console.log(`  carrying a primary_document_url         : ${withUrl.length}`);
  console.log(`  has_primary_document = true             : ${an.filter((r) => r.has_primary_document === true).length}`);
  console.log('');
  const lengths = an
    .filter((r) => tidy(r.raw_content).length > 0)
    .map((r) => String(r.raw_content).length)
    .sort((a, b) => a - b);
  if (lengths.length) {
    console.log(
      `  raw_content chars: min ${lengths[0]}   p25 ${lengths[Math.floor(lengths.length * 0.25)]}   ` +
        `median ${lengths[Math.floor(lengths.length / 2)]}   p75 ${lengths[Math.floor(lengths.length * 0.75)]}   ` +
        `max ${lengths[lengths.length - 1]}`
    );
  }
  console.log(`  per source: ${[...new Set(an.map((r) => String(r.source)))].join(', ')}`);

  // ---- 1. THE CENSUS. HOW MANY DISTINCT THINGS ARE BEHIND THE RECORD COUNT? -
  console.log('');
  console.log('-'.repeat(108));
  console.log('1. THE URL CENSUS. RECORDS ARE NOT DOCUMENTS AND DOCUMENTS ARE NOT DISTINCT DOCUMENTS');
  console.log('-'.repeat(108));
  const byForm = new Map<string, { records: number; urls: Set<string>; shape: Set<string> }>();
  for (const r of withUrl) {
    const u = String(r.primary_document_url);
    const form = urlForm(u);
    const e = byForm.get(form) ?? { records: 0, urls: new Set<string>(), shape: new Set<string>() };
    e.records++;
    e.urls.add(u);
    e.shape.add(documentShape(u));
    byForm.set(form, e);
  }
  console.log(`  ${'url form'.padEnd(40)} ${'records'.padStart(8)} ${'distinct urls'.padStart(14)}  document-shape says`);
  for (const [form, e] of [...byForm.entries()].sort((a, b) => b[1].records - a[1].records)) {
    console.log(
      `  ${form.padEnd(40)} ${String(e.records).padStart(8)} ${String(e.urls.size).padStart(14)}  ${[...e.shape].join(', ')}`
    );
  }
  const distinct = [...new Set(withUrl.map((r) => String(r.primary_document_url)))];
  console.log('');
  console.log(`  ${withUrl.length} records stand on ${distinct.length} DISTINCT urls.`);

  // ---- 2. THE PROBE. THE BODY, NOT THE STATUS CODE. -----------------------
  console.log('');
  console.log('-'.repeat(108));
  console.log('2. WHAT EACH DISTINCT URL ACTUALLY ANSWERS, PROBED FROM THIS MACHINE');
  console.log('-'.repeat(108));
  console.log('  Manual redirect, so a redirector is visible as one. Every distinct url is probed.');
  console.log('');
  const probes: Probe[] = [];
  const CONC = 4;
  let next = 0;
  await Promise.all(
    Array.from({ length: CONC }, async () => {
      while (next < distinct.length) {
        const u = distinct[next++];
        probes.push(await probe(u));
      }
    })
  );
  const byVerdict = new Map<string, number>();
  for (const p of probes) {
    const key = p.verdict.replace(/-> https?:\/\/[^\s]+/, '-> (target)').replace(/\d+b of/, 'Nb of');
    byVerdict.set(key, (byVerdict.get(key) ?? 0) + 1);
  }
  console.log('  verdicts, grouped:');
  for (const [k, v] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(v).padStart(4)}  ${k}`);
  }
  console.log('');
  console.log('  every probe, in full:');
  for (const p of probes.sort((a, b) => a.url.localeCompare(b.url))) {
    console.log(`    ${String(p.code).padStart(3)} ${String(p.bytes).padStart(8)}b ${(p.type || '-').padEnd(26)} ${p.url.slice(0, 84)}`);
    if (p.verdict) console.log(`        ${p.verdict.slice(0, 160)}`);
  }

  // ---- 3. EVERY EXISTING READER OVER THE TEXT ALREADY HELD ----------------
  console.log('');
  console.log('-'.repeat(108));
  console.log('3. EVERY EXISTING READER, OVER THE TEXT THE CORPUS ALREADY HOLDS');
  console.log('-'.repeat(108));
  const withText = an.filter((r) => tidy(r.raw_content).length > 0);
  let reached = 0;
  let factTotal = 0;
  let conditionTotal = 0;
  const byReader = new Map<string, number>();
  const movers = new Set<string>();
  const kinds = new Map<string, number>();
  for (const r of withText) {
    const text = String(r.raw_content);
    const { facts, by, refused } = runAll(text, tidy(r.title), `${tidy(r.title)} ${tidy(r.action_sought)}`);
    byReader.set(by, (byReader.get(by) ?? 0) + 1);
    if (refused) continue;
    if (facts.length) {
      reached++;
      factTotal += facts.length;
      conditionTotal += facts.filter((f) => f.kind === 'condition').length;
      for (const f of facts) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1);
      const already = Array.isArray(r.filing_facts) && r.filing_facts.length > 0;
      if (r.project_id && liveProject(r) && !already) movers.add(String(r.project_id));
    }
  }
  console.log(`  records with text read : ${withText.length}`);
  console.log(`  records reached        : ${reached}`);
  console.log(`  facts extracted        : ${factTotal}`);
  console.log(`  CONDITIONS extracted   : ${conditionTotal}`);
  console.log(`  live projects touched  : ${movers.size}`);
  console.log('  which recogniser fired:');
  for (const [k, v] of [...byReader.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${k.padEnd(34)} ${String(v).padStart(4)}`);
  }
  if (kinds.size) {
    console.log('  fact kinds:');
    for (const [k, v] of [...kinds.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${k.padEnd(34)} ${String(v).padStart(4)}`);
    }
  }

  // ---- 4. THE PROJECTS IN THE GAP, AND WHAT EACH ACTUALLY HOLDS -----------
  console.log('');
  console.log('-'.repeat(108));
  console.log('4. THE ANAHEIM PROJECTS WITH NO FACT, AND WHAT EACH HOLDS');
  console.log('-'.repeat(108));
  const anProjects = projectRows.filter(
    (p) => /^anaheim/i.test(tidy(p.market)) && String(p.status) !== 'dismissed'
  );
  console.log(`  live Anaheim projects: ${anProjects.length}`);
  for (const p of anProjects) {
    const recs = an.filter((r) => String(r.project_id) === String(p.id));
    const facts = recs.reduce((n, r) => n + (Array.isArray(r.filing_facts) ? r.filing_facts.length : 0), 0);
    if (facts > 0) continue;
    const docs = recs.filter((r) => !!r.primary_document_url);
    const files = docs.filter((r) => documentShape(String(r.primary_document_url)) === 'file');
    const chars = recs.reduce((n, r) => n + tidy(r.raw_content).length, 0);
    console.log(
      `  ${tidy(p.name).slice(0, 44).padEnd(45)} ${String(recs.length).padStart(3)} recs  ` +
        `${String(docs.length).padStart(2)} doc urls  ${String(files.length).padStart(2)} files  ` +
        `${String(chars).padStart(7)} chars of text  [${tidy(p.stage)}]`
    );
  }

  // ---- 5. WHAT A FETCH WOULD REACH, PER RECORD, AS THE WRITE PATH READS IT
  //
  // Only the distinct urls this egress can actually fetch. A url that answers
  // nothing here is reported as unreachable and never as empty, which is the
  // difference between a fact about the source and a fact about this machine.
  //
  // AND THE UNIT IS THE RECORD, NOT THE DOCUMENT. One agenda carries several
  // items and each record is one item; the reader is scoped to that item. A
  // per-document count would report one agenda's facts once and attribute them
  // to whichever record happened to be first.
  console.log('');
  console.log('-'.repeat(108));
  console.log('5. THE DOCUMENTS THIS EGRESS CAN FETCH, READ END TO END, PER RECORD');
  console.log('-'.repeat(108));
  const fetchable = probes.filter((p) => /FILE \(pdf\)/.test(p.verdict) || /PAGE, \d{3,}b of text/.test(p.verdict));
  console.log(`  distinct urls this machine can fetch: ${fetchable.length} of ${distinct.length}`);
  const textCache = new Map<string, string | null>();
  for (const p of fetchable) textCache.set(p.url, await textOf(p.url));
  let docFacts = 0;
  let docConditions = 0;
  let docReached = 0;
  let docRecords = 0;
  const docMovers = new Set<string>();
  const docKinds = new Map<string, number>();
  const docForms = new Map<string, number>();
  for (const r of withUrl) {
    const url = String(r.primary_document_url);
    if (!textCache.has(url)) continue;
    const text = textCache.get(url);
    docRecords++;
    if (!text) {
      docForms.set('unreadable-scan', (docForms.get('unreadable-scan') ?? 0) + 1);
      continue;
    }
    const { facts, by, refused } = runAll(text, tidy(r.title), `${tidy(r.title)} ${tidy(r.action_sought)}`);
    docForms.set(refused ? 'refused-by-guard' : by, (docForms.get(refused ? 'refused-by-guard' : by) ?? 0) + 1);
    if (refused || !facts.length) continue;
    docReached++;
    docFacts += facts.length;
    docConditions += facts.filter((f) => f.kind === 'condition').length;
    for (const f of facts) docKinds.set(f.kind, (docKinds.get(f.kind) ?? 0) + 1);
    const already = Array.isArray(r.filing_facts) && r.filing_facts.length > 0;
    if (r.project_id && liveProject(r) && !already) docMovers.add(String(r.project_id));
  }
  console.log(`  records whose document is fetchable : ${docRecords}`);
  console.log(`  records reached                     : ${docReached}`);
  console.log(`  facts                               : ${docFacts}`);
  console.log(`  CONDITIONS                          : ${docConditions}`);
  console.log(`  live projects moved off zero        : ${docMovers.size}`);
  console.log('  forms:');
  for (const [k, v] of [...docForms.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(34)} ${String(v).padStart(4)}`);
  if (docKinds.size) {
    console.log('  fact kinds:');
    for (const [k, v] of [...docKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(34)} ${String(v).padStart(4)}`);
  }
  for (const id of docMovers) console.log(`    moved: ${tidy(projectById.get(id)?.name)}`);

  // ---- 6. IS THE BLOCKED DOCUMENT ACTUALLY BLOCKED? ----------------------
  //
  // THE QUESTION THE EGRESS VERDICT NEVER ASKED. The AgendaViewer urls 302 to a
  // host this machine cannot reach, and the conclusion drawn from that was "the
  // document needs the runner". But ANAHEIM PUBLISHES THROUGH TWO HOSTS, and
  // www.anaheim.net answers 200 here with real PDFs - four are already in this
  // corpus. If the same meeting is published on the reachable host then the
  // document is not blocked at all, and the gap is an adapter holding the wrong
  // url rather than an egress wall.
  //
  // Nothing here is guessed. The CivicPlus AgendaCenter search route is fetched
  // per category and per year and its own links are read; a meeting is matched
  // on its DATE and then the document is opened and checked, because a date
  // match is a candidate and not an answer.
  console.log('');
  console.log('-'.repeat(108));
  console.log('6. THE SAME MEETINGS ON THE OTHER HOST, WHICH THIS EGRESS CAN REACH');
  console.log('-'.repeat(108));
  const blocked = withUrl.filter((r) => /granicus\.com\/AgendaViewer/i.test(String(r.primary_document_url)));
  const blockedUrls = [...new Set(blocked.map((r) => String(r.primary_document_url)))];
  const dateOf = (r: Row): string => {
    const d = tidy(r.published_date).slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '(no date)';
  };
  const blockedDates = [...new Set(blocked.map(dateOf))].filter((d) => d !== '(no date)').sort();
  console.log(`  records on an AgendaViewer url: ${blocked.length} on ${blockedUrls.length} distinct meetings`);
  console.log(`  meeting dates carried         : ${blockedDates.length}`);
  console.log('');
  console.log('  Every one of those urls answers 302 -> local.anaheim.net, which answers nothing here.');
  console.log('  So the question is whether www.anaheim.net publishes the same meeting.');

  // THE AXIS NOBODY HAD LOOKED ALONG. Anaheim has two bodies, and which one a
  // record belongs to decides whether its document is reachable at all.
  console.log('');
  const census = (label: string, set: Row[]): void => {
    const by = new Map<string, number>();
    for (const r of set) by.set(bodyOf(r), (by.get(bodyOf(r)) ?? 0) + 1);
    const parts = [...by.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`);
    console.log(`  ${label.padEnd(40)} ${set.length.toString().padStart(3)}   ${parts.join(',  ')}`);
  };
  census('by body: records on an AgendaViewer url', blocked);
  census('by body: records whose url is a file', an.filter((r) => documentShape(String(r.primary_document_url ?? '')) === 'file'));
  census('by body: every Anaheim record', an);

  // CivicPlus AgendaCenter. The category id is READ FROM THE INDEX rather than
  // hardcoded, so a renumbering shows up as NOT LISTED instead of as a silent
  // zero.
  const indexHtml = await (async () => {
    try {
      const res = await fetch('https://www.anaheim.net/AgendaCenter', {
        headers: { 'User-Agent': BROWSER_UA },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      return res.ok ? await res.text() : '';
    } catch {
      return '';
    }
  })();
  const catOf = (name: string): string | null => {
    for (const m of indexHtml.matchAll(new RegExp(name, 'gi'))) {
      const at = m.index ?? 0;
      const win = indexHtml.slice(Math.max(0, at - 400), at + 400);
      const id = win.match(/cat(\d+)/);
      if (id) return id[1];
    }
    return null;
  };
  const pcCat = catOf('Planning Commission');
  const ccCat = catOf('City Council');
  console.log('');
  console.log(`  www.anaheim.net/AgendaCenter: ${indexHtml.length}b`);
  console.log(`    Planning Commission category : ${pcCat ?? 'NOT LISTED'}`);
  console.log(`    City Council category        : ${ccCat ?? 'NOT LISTED'}`);

  const published = new Map<string, string[]>();
  const years = [...new Set(blockedDates.map((d) => d.slice(0, 4)))].sort();
  for (const cat of [pcCat].filter((c): c is string => !!c)) {
    for (const y of years) {
      const u =
        `https://www.anaheim.net/AgendaCenter/Search/?term=&CIDs=${cat}` +
        `&startDate=01/01/${y}&endDate=12/31/${y}&dateRange=&dateSelector=&backButton=false`;
      let html = '';
      try {
        const res = await fetch(u, { headers: { 'User-Agent': BROWSER_UA }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        html = res.ok ? await res.text() : '';
      } catch {
        html = '';
      }
      const links = [...html.matchAll(/\/AgendaCenter\/ViewFile\/(Agenda|Minutes)\/_(\d{2})(\d{2})(\d{4})-(\d+)/g)];
      console.log(`    CID ${cat} ${y}: ${html.length}b, ${links.length} ViewFile links`);
      for (const m of links) {
        const iso = `${m[4]}-${m[2]}-${m[3]}`;
        const url = `https://www.anaheim.net/AgendaCenter/ViewFile/${m[1]}/_${m[2]}${m[3]}${m[4]}-${m[5]}`;
        const arr = published.get(iso) ?? [];
        // Agenda before Minutes: the agenda carries the item block the reader
        // keys on, the minutes carry the vote.
        if (m[1] === 'Agenda') arr.unshift(url);
        else arr.push(url);
        published.set(iso, [...new Set(arr)]);
      }
    }
  }
  const matched = blockedDates.filter((d) => published.has(d));
  console.log('');
  console.log(`  blocked meeting dates ALSO published on www.anaheim.net: ${matched.length} of ${blockedDates.length}`);
  console.log(`    matched : ${matched.join(' ')}`);
  console.log(`    not     : ${blockedDates.filter((d) => !published.has(d)).join(' ')}`);

  // ---- 7. AND WHAT DOES THE REACHABLE COPY ACTUALLY YIELD? ---------------
  //
  // A date match is a candidate. The document is opened, the recogniser is run,
  // and the reader is handed the record's own item exactly as the write path
  // hands it - so this is what a relocation would produce rather than what it
  // might.
  console.log('');
  console.log('-'.repeat(108));
  console.log('7. THE REACHABLE COPY, OPENED AND READ, PER BLOCKED RECORD');
  console.log('-'.repeat(108));
  const altText = new Map<string, string | null>();
  let altReached = 0;
  let altFacts = 0;
  let altConditions = 0;
  let altRecords = 0;
  const altForms = new Map<string, number>();
  const altKinds = new Map<string, number>();
  const altMovers = new Set<string>();
  for (const r of blocked) {
    const d = dateOf(r);
    const candidates = published.get(d) ?? [];
    if (!candidates.length) {
      altForms.set('no copy on the reachable host', (altForms.get('no copy on the reachable host') ?? 0) + 1);
      continue;
    }
    altRecords++;
    let best: { facts: FilingFact[]; by: string; url: string } | null = null;
    for (const c of candidates) {
      if (!altText.has(c)) altText.set(c, await textOf(c));
      const text = altText.get(c);
      if (!text) continue;
      const { facts, by, refused } = runAll(text, tidy(r.title), `${tidy(r.title)} ${tidy(r.action_sought)}`);
      if (refused) {
        best = { facts: [], by: 'refused-by-guard', url: c };
        continue;
      }
      if (!best || facts.length > best.facts.length) best = { facts, by, url: c };
      if (facts.length) break;
    }
    if (!best) {
      altForms.set('fetched nothing', (altForms.get('fetched nothing') ?? 0) + 1);
      continue;
    }
    altForms.set(best.by, (altForms.get(best.by) ?? 0) + 1);
    if (!best.facts.length) continue;
    altReached++;
    altFacts += best.facts.length;
    altConditions += best.facts.filter((f) => f.kind === 'condition').length;
    for (const f of best.facts) altKinds.set(f.kind, (altKinds.get(f.kind) ?? 0) + 1);
    const already = Array.isArray(r.filing_facts) && r.filing_facts.length > 0;
    if (r.project_id && liveProject(r) && !already) altMovers.add(String(r.project_id));
  }
  console.log(`  blocked records                       : ${blocked.length}`);
  console.log(`  with a copy on the reachable host     : ${altRecords}`);
  console.log(`  records the reader reaches            : ${altReached}`);
  console.log(`  facts                                 : ${altFacts}`);
  console.log(`  CONDITIONS                            : ${altConditions}`);
  console.log(`  live projects moved off zero          : ${altMovers.size}`);
  console.log('  forms:');
  for (const [k, v] of [...altForms.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(34)} ${String(v).padStart(4)}`);
  if (altKinds.size) {
    console.log('  fact kinds:');
    for (const [k, v] of [...altKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(34)} ${String(v).padStart(4)}`);
  }
  for (const id of altMovers) {
    const pr = projectById.get(id);
    console.log(`    MOVED: ${tidy(pr?.name).slice(0, 50).padEnd(52)} [${tidy(pr?.stage)}]`);
  }

  // ---- 8. THE HALF THAT IS REACHABLE, AND WHAT WE HOLD OF IT -------------
  //
  // The blocked half is City Council and it is genuinely runner-only: the
  // reachable host does not list City Council at all. The PLANNING COMMISSION
  // half is the opposite - every one of its agendas opens from this machine -
  // and the question nobody has asked is how much of it the corpus holds.
  //
  // THE LISTING IS NOT CATEGORY-CLEAN, SO THE DOCUMENT DECIDES. The CID 18
  // search route returned a Public Library Board agenda among the Planning
  // Commission files, which is exactly how a date match becomes a wrong meeting.
  // Every candidate is opened and checked for PLANNING COMMISSION in its own
  // first page before it is counted.
  console.log('');
  console.log('-'.repeat(108));
  console.log('8. THE PLANNING COMMISSION HALF: WHAT THE REACHABLE HOST PUBLISHES, AND WHAT WE HOLD');
  console.log('-'.repeat(108));
  const fileRecords = an.filter((r) => documentShape(String(r.primary_document_url ?? '')) === 'file');
  const heldDates = new Set(fileRecords.map((r) => tidy(r.published_date).slice(0, 10)));
  const isHeld = (d: string): boolean => heldDates.has(d) || heldDates.has(addDays(d, -1)) || heldDates.has(addDays(d, 1));
  const gapProjects = anProjects.filter((p) => {
    const recs = an.filter((r) => String(r.project_id) === String(p.id));
    return recs.reduce((n, r) => n + (Array.isArray(r.filing_facts) ? r.filing_facts.length : 0), 0) === 0;
  });

  let pcDates = 0;
  let pcHeld = 0;
  let pcActionAgendas = 0;
  let pcWithVote = 0;
  let pcItems = 0;
  let pcItemsHeldDate = 0;
  let pcReached = 0;
  let pcFacts = 0;
  let pcFactsUnheld = 0;
  let pcConditions = 0;
  const pcKinds = new Map<string, number>();
  const named = new Map<string, number>();
  for (const d of [...published.keys()].sort()) {
    const url = (published.get(d) ?? []).find((u) => /\/Agenda\//.test(u));
    if (!url) continue;
    if (!altText.has(url)) altText.set(url, await textOf(url));
    const text = altText.get(url);
    if (!text || !/PLANNING COMMISSION/i.test(text.slice(0, 3000))) continue;
    pcDates++;
    const held = isHeld(d);
    if (held) pcHeld++;
    // IS THIS THE MEETING'S RECORD OR ITS PROGRAMME? The market standard wants a
    // DECISION, and an agenda published before the meeting cannot carry one. The
    // two are counted apart rather than assumed, because the corpus holds both
    // shapes - DocumentCenter serves "Planning Commission ACTION Agenda" and
    // AgendaCenter serves the agenda.
    if (/ACTION\s+AGENDA/i.test(text.slice(0, 4000))) pcActionAgendas++;
    if (/\b(VOTE|Motion carried|AYES|NOES)\b/i.test(text)) pcWithVote++;
    for (const h of text.matchAll(/ITEM\s+NO\.\s*(\d{1,2})\s+([^\n]{0,120})/gi)) {
      pcItems++;
      if (held) pcItemsHeldDate++;
      const { facts, refused } = runAll(text, tidy(h[2]), `${h[1]} ${h[2]}`);
      if (refused || !facts.length) continue;
      pcReached++;
      pcFacts += facts.length;
      if (!held) pcFactsUnheld += facts.length;
      pcConditions += facts.filter((f) => f.kind === 'condition').length;
      for (const f of facts) pcKinds.set(f.kind, (pcKinds.get(f.kind) ?? 0) + 1);
    }
    // Does any of it name a project the register already holds with no fact?
    for (const p of gapProjects) {
      const n = tidy(p.name);
      if (n.length < 8) continue;
      if (text.toLowerCase().includes(n.toLowerCase())) named.set(n, (named.get(n) ?? 0) + 1);
    }
  }
  console.log(`  Planning Commission agendas that open from this machine : ${pcDates}`);
  console.log(`    the corpus already holds a document for              : ${pcHeld}   (date match +/- one day)`);
  console.log(`    the corpus holds NOTHING for                         : ${pcDates - pcHeld}`);
  console.log(`    titled ACTION AGENDA (the meeting's record)          : ${pcActionAgendas}`);
  console.log(`    carrying vote language at all                        : ${pcWithVote}`);
  console.log(`  ITEM NO. blocks across all of them                     : ${pcItems}`);
  console.log(`    on a meeting we already hold                         : ${pcItemsHeldDate}`);
  console.log(`    on a meeting we hold nothing for                     : ${pcItems - pcItemsHeldDate}`);
  console.log(`  items the EXISTING reader reaches                      : ${pcReached}`);
  console.log(`  facts                                                  : ${pcFacts}`);
  console.log(`    of those, from meetings we hold nothing for          : ${pcFactsUnheld}`);
  console.log(`  CONDITIONS                                             : ${pcConditions}`);
  console.log('  fact kinds:');
  for (const [k, v] of [...pcKinds.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${k.padEnd(24)} ${String(v).padStart(4)}`);
  console.log('');
  console.log(`  live Anaheim projects carrying no fact: ${gapProjects.length}`);
  console.log('  named anywhere in these agendas:');
  if (!named.size) console.log('    NONE');
  for (const [k, v] of [...named.entries()].sort((a, b) => b[1] - a[1])) console.log(`    ${String(v).padStart(3)}  ${k}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
