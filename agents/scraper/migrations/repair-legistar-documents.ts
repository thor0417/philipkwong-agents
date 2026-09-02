// REPAIR: SEVEN JURISDICTIONS RECORDED "NO DOCUMENT" FOR A DOCUMENT THEY HELD.
//
//   npm run repair:legistar-docs                     report only, writes nothing
//   npm run repair:legistar-docs -- --write          apply
//   npm run repair:legistar-docs -- --market Broward  one jurisdiction
//
// THE DEFECT, fixed in the adapter by 74bc134 and still standing in the corpus.
// `sources/legistar.ts` set
//
//     primary_document_url: c?.documentUrl ?? null,
//     has_primary_document: !!c,
//
// from the CONTACT result. A staff report that was listed, fetched and parsed
// recorded `false` whenever it named no party in the label format
// contact-labels recognises. The document was read; the fact that we hold it
// was discarded. One write site, seven jurisdictions: Clark, Nashville,
// Phoenix, Oakland, Yonkers, Westchester and Broward.
//
// WHY THE ADAPTER FIX IS NOT ENOUGH ON ITS OWN, which is the reason this file
// exists. The Legistar bound is INCREMENTAL - the newest matter we hold, minus
// a thirty-day overlap - and even a forced `--backfill` reaches only twelve
// months. Re-running the lane therefore corrects the rows inside that window
// and leaves every older row carrying the wrong value. Measured on 2026-09-02,
// a full twelve-month backfill matched 23 Broward matters against 97 Broward
// records held. The remaining rows are not stale captures; they are correct
// records carrying one wrong boolean, and a reader that reads
// `primary_document_url` cannot see past it.
//
// WHAT IT CHANGES, AND WHAT IT REFUSES TO.
//
//   leads.primary_document_url  set to the first FETCHED document, which is what
//   leads.has_primary_document  the column was always supposed to mean.
//
//   leads.applicant             filled ONLY where currently null. A stored value
//   leads.representative        may have been curated by hand or written by a
//   leads.presented_by          later, better pass, and this repair is about the
//                               document flag, not about re-deciding parties.
//
// Nothing is deleted and no record is dismissed (standing rules 6 and 12). A
// matter whose attachments are gone from the publisher keeps whatever it has:
// this only ever moves a row from "we recorded no document" to "we hold this
// one", never the other way, because the reverse would be this machine's
// network speaking about a county's feed - the same verdict verify:staleness
// was moved to the hosted runner for making.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { matterDocuments, contactProvenance } from '../sources/legistar-attachments';
// The parser lives beside the two URL BUILDERS it inverts, so the shape cannot
// drift between the writer and the reader. See sources/legistar.ts.
import { matterRefFromUrl } from '../sources/legistar-urls';

const WRITE = process.argv.includes('--write');
const CONCURRENCY = Number(process.env.REPAIR_CONCURRENCY ?? '4');
const MARKET = (() => {
  const i = process.argv.indexOf('--market');
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
})();
const BLOCK_MARK = '--- contacts from the matter documents ---';

interface Lead {
  id: string;
  url: string | null;
  title: string | null;
  location: string | null;
  status: string | null;
  source: string | null;
  raw_content: string | null;
  primary_document_url: string | null;
  has_primary_document: boolean | null;
  applicant: string | null;
  representative: string | null;
  presented_by: string | null;
}

interface Row {
  examined: number;
  notAMatter: number;
  alreadyHeld: number;
  found: number;
  stillNone: number;
  contactsGained: number;
  changed: number;
}

const emptyRow = (): Row => ({
  examined: 0,
  notAMatter: 0,
  alreadyHeld: 0,
  found: 0,
  stillNone: 0,
  contactsGained: 0,
  changed: 0,
});

async function main(): Promise<void> {
  const rows: Lead[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select(
        'id,url,title,location,status,source,raw_content,primary_document_url,has_primary_document,' +
          'applicant,representative,presented_by'
      )
      .eq('source', 'legistar')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    rows.push(...(data as unknown as Lead[]));
    if (data.length < 1000) break;
  }

  const targets = rows
    .filter((l) => l.status !== 'dismissed')
    .filter((l) => !MARKET || (l.location ?? '').toLowerCase().includes(MARKET.toLowerCase()));

  console.log('===== REPAIR: LEGISTAR DOCUMENT FLAGS =====');
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: report only, nothing is written\n');
  console.log(`legistar records, undismissed : ${targets.length} (no cap, paged)`);
  if (MARKET) console.log(`market filter                 : ${MARKET}`);
  console.log(`concurrency                   : ${CONCURRENCY}\n`);

  const byJur = new Map<string, Row>();
  const touch = (j: string): Row => {
    let r = byJur.get(j);
    if (!r) {
      r = emptyRow();
      byJur.set(j, r);
    }
    return r;
  };

  let next = 0;
  let done = 0;
  const updates: { id: string; patch: Record<string, unknown>; jur: string }[] = [];

  async function worker(): Promise<void> {
    while (next < targets.length) {
      const l = targets[next++];
      const jur = (l.location ?? '(none)').split(',')[0].trim();
      const row = touch(jur);
      row.examined++;
      const ref = matterRefFromUrl(l.url);
      if (!ref) {
        row.notAMatter++;
        done++;
        continue;
      }
      if (l.has_primary_document === true && l.primary_document_url) {
        row.alreadyHeld++;
        done++;
        continue;
      }
      const d = await matterDocuments(ref.client, ref.matterId, l.location ?? jur);
      if (!d?.documentUrl) {
        row.stillNone++;
        done++;
        if (done % 25 === 0) console.log(`  ${done}/${targets.length}`);
        continue;
      }
      row.found++;
      const patch: Record<string, unknown> = {
        primary_document_url: d.documentUrl,
        has_primary_document: true,
      };
      const c = d.contacts;
      if (c) {
        // ONLY WHERE NULL. A stored party may have been curated by hand or
        // written by a later pass, and this repair is about the document flag.
        if (!l.applicant && c.applicant) patch.applicant = c.applicant;
        if (!l.representative && c.representative) patch.representative = c.representative;
        if (!l.presented_by && c.presented_by) patch.presented_by = c.presented_by;
        if (Object.keys(patch).length > 2) row.contactsGained++;
        // The verbatim provenance block, appended once. A reader must be able to
        // check a stored party against the document's own words.
        if (!(l.raw_content ?? '').includes(BLOCK_MARK)) {
          patch.raw_content = (l.raw_content ?? '') + contactProvenance(c);
        }
      }
      updates.push({ id: l.id, patch, jur });
      done++;
      if (done % 25 === 0) console.log(`  ${done}/${targets.length}`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  console.log('\njurisdiction              examined  notMatter  alreadyHeld   FOUND  stillNone  contacts');
  const sorted = [...byJur.entries()].sort((a, b) => b[1].examined - a[1].examined);
  const tot = emptyRow();
  for (const [j, r] of sorted) {
    console.log(
      j.slice(0, 24).padEnd(25) +
        String(r.examined).padStart(9) +
        String(r.notAMatter).padStart(11) +
        String(r.alreadyHeld).padStart(13) +
        String(r.found).padStart(8) +
        String(r.stillNone).padStart(11) +
        String(r.contactsGained).padStart(10)
    );
    tot.examined += r.examined;
    tot.notAMatter += r.notAMatter;
    tot.alreadyHeld += r.alreadyHeld;
    tot.found += r.found;
    tot.stillNone += r.stillNone;
    tot.contactsGained += r.contactsGained;
  }
  console.log(
    'TOTAL'.padEnd(25) +
      String(tot.examined).padStart(9) +
      String(tot.notAMatter).padStart(11) +
      String(tot.alreadyHeld).padStart(13) +
      String(tot.found).padStart(8) +
      String(tot.stillNone).padStart(11) +
      String(tot.contactsGained).padStart(10)
  );

  if (!WRITE) {
    console.log(`\n${updates.length} records would gain a document. Nothing was written.`);
    console.log('Re-run with --write to apply.');
    return;
  }

  let written = 0;
  let failed = 0;
  for (const u of updates) {
    const { error } = await supabaseAdmin.from('leads').update(u.patch).eq('id', u.id);
    if (error) {
      failed++;
      console.warn(`  update failed for ${u.id}: ${error.message.slice(0, 90)}`);
      continue;
    }
    written++;
    touch(u.jur).changed++;
  }
  console.log(`\nWROTE ${written} records${failed ? `, ${failed} failed` : ''}.`);
  for (const [j, r] of sorted) {
    if (r.changed) console.log(`  ${j.padEnd(25)}${r.changed}`);
  }
  console.log('\nFacts are a separate step: run npm run capture:filings after this.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
