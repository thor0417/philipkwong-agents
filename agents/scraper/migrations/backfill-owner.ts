// EXTRACT THE OWNER A FILING NAMES.
//
//   npm run owner:backfill           dry run
//   APPLY=1 npm run owner:backfill   write
//
// An entitlement filed by a developer on land somebody else owns has two
// commercially different parties, and until leads.owner existed they collapsed
// into one. Anaheim prints the owner on its planning items:
//
//   OWNER: DENTAL TRAINING CENTER & DIGITAL LAB, INC.
//
// 18 records carry the label, all agenda-portal / Las Vegas and Anaheim.
//
// VERBATIM, AND NULL MEANS THE RECORD DID NOT SAY. Never that the applicant owns
// the site. Nothing here infers an owner from an applicant, from a firm name or
// from an address.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { overriddenFields } from '../write-guard';

const APPLY = process.env.APPLY === '1';

// The label, and everything up to the end of the clause. The trailing cut is
// what stops "OWNER: DENTAL TRAINING CENTER & DIGITAL LAB, INC. - For possible
// action" storing the agenda's procedural tail as part of a company name.
const OWNER_LABEL = /OWNER(?:S)?\s*[:\-]\s*([^\n\r]{3,120})/i;

// Where the value stops. Any of these begins something that is not the owner.
const VALUE_END =
  /\s+(?:-\s+(?:For possible action|Discussion|Action|Presentation|Update|Report|Introduction|Public hearing)|For possible action|APPLICANT\s*:|CONTACT\s*:|REPRESENTATIVE\s*:|ATTN\s*:|Source document|Document URL|Request\s*:|Location\s*:)/i;

export function extractOwner(raw: string): string | null {
  if (!raw) return null;
  const m = OWNER_LABEL.exec(raw);
  if (!m) return null;
  let value = m[1].split(VALUE_END)[0].trim();
  // A trailing separator is the agenda's punctuation, not the company's name.
  value = value.replace(/[\s,;:.\-]+$/, '').trim();
  if (value.length < 3) return null;
  // A label with nothing after it, or a cross-reference rather than a party.
  if (/^(?:n\/?a|none|unknown|same as applicant|see applicant)$/i.test(value)) return null;
  return value;
}

async function main(): Promise<void> {
  const rows: Record<string, unknown>[] = [];
  for (let f = 0; ; f += 500) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,source,market,location,raw_content,owner,applicant,manual_overrides,status')
      .neq('status', 'dismissed')
      .range(f, f + 499);
    if (error) throw new Error(`read failed: ${error.message}`);
    rows.push(...((data ?? []) as Record<string, unknown>[]));
    if ((data ?? []).length < 500) break;
  }
  console.log(`records scanned: ${rows.length}`);

  const hits: { id: string; source: string; market: string; owner: string; applicant: string }[] = [];
  let alreadySet = 0;
  let protectedCount = 0;
  for (const r of rows) {
    if (String(r.owner ?? '').trim()) {
      alreadySet++;
      continue;
    }
    if (overriddenFields(r.manual_overrides).has('owner')) {
      protectedCount++;
      continue;
    }
    const owner = extractOwner(String(r.raw_content ?? ''));
    if (!owner) continue;
    hits.push({
      id: String(r.id),
      source: String(r.source),
      market: String(r.market ?? r.location ?? '(unplaced)'),
      owner,
      applicant: String(r.applicant ?? '').trim(),
    });
  }

  const byMarket = new Map<string, number>();
  const bySource = new Map<string, number>();
  for (const h of hits) {
    byMarket.set(h.market, (byMarket.get(h.market) ?? 0) + 1);
    bySource.set(h.source, (bySource.get(h.source) ?? 0) + 1);
  }
  console.log(`\nOWNERS FOUND: ${hits.length}   (already set: ${alreadySet}, protected: ${protectedCount})`);
  console.log('\nPER MARKET');
  for (const [k, v] of [...byMarket.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(28)} ${String(v).padStart(3)}`);
  }
  console.log('\nPER SOURCE');
  for (const [k, v] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${k.padEnd(28)} ${String(v).padStart(3)}`);
  }

  // THE COMMERCIAL POINT: how often the owner is somebody other than the
  // applicant. Where they are the same party the column adds nothing; where they
  // differ it names a second counterparty the document could not name before.
  const differs = hits.filter(
    (h) => h.applicant && h.owner.toLowerCase().replace(/[^a-z0-9]/g, '') !== h.applicant.toLowerCase().replace(/[^a-z0-9]/g, '')
  );
  console.log(`\nowner differs from the applicant on ${differs.length} of ${hits.length}`);
  console.log('\nEXAMPLES');
  for (const h of hits.slice(0, 12)) {
    console.log(`   [${h.market}] OWNER: ${h.owner}`);
    console.log(`        applicant on the same record: ${h.applicant || '(none named)'}`);
  }

  if (!APPLY) {
    console.log('\nNothing was written. APPLY=1 to write.');
    return;
  }
  let written = 0;
  for (const h of hits) {
    const { error } = await supabaseAdmin.from('leads').update({ owner: h.owner }).eq('id', h.id);
    if (error) {
      console.error(`   write failed for ${h.id}: ${error.message}`);
      continue;
    }
    written++;
  }
  console.log(`\nwritten: ${written} of ${hits.length}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
