// STORE WHAT THE READERS PRODUCE. Migration 035.
//
//   npm run capture:filings              report only, writes nothing
//   npm run capture:filings -- --write   apply
//   npm run capture:filings -- --lane clark|nyc|oakland|anaheim
//
// FOUR READERS, ONE WRITE PATH, ONE GUARD. Every fact goes through
// verifyFilingFacts before it is stored, and a record whose read fails the guard
// stores NOTHING rather than the part that passed - the same all-or-nothing
// contract the contact lane has, because a half-stored read is a document with
// some checkable facts and some unaccountable ones.
//
// THE PER-FIELD RATE IS REPORTED AGAINST THE MEASUREMENT so a drift between
// measuring and storing is visible in the same run rather than discovered in a
// client document. The diagnostics measured from a cached corpus on disk; this
// fetches the document the record itself points at, which is what production
// does. If those two disagree the difference is the finding.
//
// NOTHING PRINTS FROM THIS. Storage and printing are separate decisions and this
// is the first.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { fetchPdfPages } from '../sources/pdf-agenda';
import { verifyFilingFacts, type FilingFact } from '../readers/core';
import { readFilingFacts, isClarkAgendaSheet } from '../readers/clark-agenda-sheet';
import { readNycFacts, isNycRecord } from '../readers/nyc-records';
import { readOaklandFacts, isOaklandDocument, isCodeAmendment } from '../readers/oakland-ordinance';
import { readAnaheimFacts, isAnaheimAgenda, isSpanishAgenda } from '../readers/anaheim-agenda';

const WRITE = process.argv.includes('--write');
const LANE = (() => { const i = process.argv.indexOf('--lane'); return i > -1 ? process.argv[i + 1] : null; })();
const CONCURRENCY = Number(process.env.FILING_CONCURRENCY ?? '4');

interface Lead {
  id: string; title: string | null; url: string | null; source: string | null;
  status: string | null; location: string | null; market: string | null;
  raw_content: string | null; action_sought: string | null; project_id: string | null;
  primary_document_url: string | null; has_primary_document: boolean | null;
}

// WHICH READER A RECORD BELONGS TO, decided by the adapter that captured it and
// then confirmed by the reader's own recogniser. Two gates because the adapter
// says where a record came from and only the text says what form it is in: a
// Clark Legistar record can be an agenda sheet, a redevelopment item or a
// justification letter, and only the first is readable.
type LaneName = 'nyc' | 'clark' | 'oakland' | 'anaheim';

function laneOf(l: Lead): LaneName | null {
  const s = l.source ?? '';
  if (s.startsWith('nyc-')) return 'nyc';
  if (s === 'agenda-portal' && (l.location ?? '').includes('Anaheim')) return 'anaheim';
  if (s === 'legistar' && (l.location ?? '').includes('Oakland')) return 'oakland';
  if ((s === 'legistar' || s === 'clark-tab') && (l.location ?? '').includes('Clark')) return 'clark';
  return null;
}

// The named negative, stored in filing_form. "We do not read this county's form"
// and "we have not tried" are different facts about our coverage and only one is
// worth doing something about.
type Form =
  | 'clark-agenda-sheet' | 'nyc-zap' | 'nyc-ceqr' | 'nyc-city-record'
  | 'oakland-ordinance' | 'anaheim-agenda'
  | 'no-document' | 'unreadable-scan' | 'form-not-supported'
  | 'anaheim-spanish' | 'oakland-code-amendment' | 'anaheim-item-not-on-agenda'
  | 'refused-by-guard';

interface Result { lead: Lead; lane: LaneName; form: Form; facts: FilingFact[] }

const pct = (n: number, d: number) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

async function main(): Promise<void> {
  const rows: Lead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,url,source,status,location,market,raw_content,action_sought,project_id,primary_document_url,has_primary_document')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as Lead[]));
    if (data.length < 1000) break;
  }

  const targets = rows
    .filter((l) => l.status !== 'dismissed')
    .map((l) => ({ l, lane: laneOf(l) }))
    .filter((x): x is { l: Lead; lane: LaneName } => !!x.lane)
    .filter((x) => !LANE || x.lane === LANE);

  console.log('===== FILING FACTS =====');
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: report only, nothing is written\n');
  const byLane = new Map<LaneName, number>();
  for (const t of targets) byLane.set(t.lane, (byLane.get(t.lane) ?? 0) + 1);
  console.log('records in scope:');
  for (const [k, v] of byLane) console.log(`  ${k.padEnd(10)}${v}`);
  console.log('');

  const results: Result[] = [];
  let done = 0;
  let next = 0;

  async function textFor(l: Lead, lane: LaneName): Promise<{ text: string | null; form: Form | null }> {
    if (lane === 'nyc') {
      const t = l.raw_content ?? '';
      const kind = isNycRecord(t);
      if (!kind) return { text: null, form: 'form-not-supported' };
      return { text: t, form: kind === 'zap' ? 'nyc-zap' : kind === 'ceqr' ? 'nyc-ceqr' : 'nyc-city-record' };
    }
    if (!l.has_primary_document || !l.primary_document_url) return { text: null, form: 'no-document' };
    const pages = await fetchPdfPages(l.primary_document_url);
    if (!pages || !pages.length) return { text: null, form: 'unreadable-scan' };
    const text = pages.join('\n');
    if (text.replace(/\s/g, '').length < 400) return { text: null, form: 'unreadable-scan' };
    return { text, form: null };
  }

  async function worker(): Promise<void> {
    while (next < targets.length) {
      const { l, lane } = targets[next++];
      done++;
      if (done % 25 === 0) console.log(`  ...${done}/${targets.length}`);

      const { text, form: earlyForm } = await textFor(l, lane);
      if (!text) {
        results.push({ lead: l, lane, form: earlyForm ?? 'form-not-supported', facts: [] });
        continue;
      }

      let facts: FilingFact[] = [];
      let form: Form = earlyForm ?? 'form-not-supported';
      if (lane === 'nyc') {
        facts = readNycFacts(text);
      } else if (lane === 'clark') {
        if (!isClarkAgendaSheet(text)) { form = 'form-not-supported'; }
        else { form = 'clark-agenda-sheet'; facts = readFilingFacts(text); }
      } else if (lane === 'oakland') {
        if (!isOaklandDocument(text)) form = 'form-not-supported';
        else if (isCodeAmendment(text)) form = 'oakland-code-amendment';
        else { form = 'oakland-ordinance'; facts = readOaklandFacts(text); }
      } else if (lane === 'anaheim') {
        if (!isAnaheimAgenda(text)) form = 'form-not-supported';
        else if (isSpanishAgenda(text)) form = 'anaheim-spanish';
        else {
          // THE ITEM THIS RECORD IS, never the whole agenda. See the note on
          // readAnaheimFacts: an agenda covers many projects and handing all of
          // it to one is the press round-up defect.
          facts = readAnaheimFacts(text, { application: `${l.title ?? ''} ${l.action_sought ?? ''}` });
          form = facts.length ? 'anaheim-agenda' : 'anaheim-item-not-on-agenda';
        }
      }

      // ALL OR NOTHING. A read that fails the guard stores no facts and records
      // that it was refused, which is a fact about our coverage worth keeping.
      if (facts.length) {
        try {
          verifyFilingFacts(facts, text);
        } catch (e) {
          console.error(`  REFUSED ${(l.title ?? '').slice(0, 44)}: ${String(e).slice(0, 130)}`);
          facts = [];
          form = 'refused-by-guard';
        }
      }
      results.push({ lead: l, lane, form, facts });

      if (WRITE) {
        const { error } = await supabaseAdmin.from('leads').update({
          filing_facts: facts.length ? facts : null,
          filing_read_at: new Date().toISOString(),
          filing_form: form,
        }).eq('id', l.id);
        if (error) throw new Error(`write failed for ${l.id}: ${error.message}`);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  // ---- what was stored ------------------------------------------------------
  console.log('\n\n===== ROWS WRITTEN, PER JURISDICTION =====\n');
  console.log('lane        records   with facts   facts   forms');
  for (const lane of ['nyc', 'clark', 'oakland', 'anaheim'] as LaneName[]) {
    const rs = results.filter((r) => r.lane === lane);
    if (!rs.length) continue;
    const withFacts = rs.filter((r) => r.facts.length);
    const forms = new Map<string, number>();
    for (const r of rs) forms.set(r.form, (forms.get(r.form) ?? 0) + 1);
    console.log(
      `${lane.padEnd(12)}${String(rs.length).padStart(5)}${`${withFacts.length} (${pct(withFacts.length, rs.length)})`.padStart(13)}` +
        `${String(rs.reduce((a, r) => a + r.facts.length, 0)).padStart(8)}   ` +
        [...forms.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')
    );
  }

  // ---- per field, against the report-only measurement -----------------------
  console.log('\n\n===== PER FIELD, AS STORED =====\n');
  console.log('Denominator is the records whose form the reader READS, which is the');
  console.log('same denominator the diagnostics used. A field that moved between');
  console.log('measuring and storing is a drift and shows here.\n');
  for (const lane of ['nyc', 'clark', 'oakland', 'anaheim'] as LaneName[]) {
    const readable = results.filter(
      (r) => r.lane === lane && !['no-document', 'unreadable-scan', 'form-not-supported', 'anaheim-spanish', 'oakland-code-amendment'].includes(r.form)
    );
    if (!readable.length) continue;
    const counts = new Map<string, number>();
    for (const r of readable) for (const k of new Set(r.facts.map((f) => f.kind))) counts.set(k, (counts.get(k) ?? 0) + 1);
    console.log(`--- ${lane}  (${readable.length} records the reader reads) ---`);
    for (const [k, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(28)}${String(n).padStart(4)}${pct(n, readable.length).padStart(7)}`);
    }
    console.log('');
  }

  if (!WRITE) console.log('\nNothing was written. Re-run with --write to apply.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
