// Backfill: read the matter documents behind already-stored Legistar records and
// write the owner / applicant / representative they name.
//
// This is the contact-depth pass that first proved the point (Kulik River
// Capital's use permit naming Nancy Amundsen of Brown, Brown & Premsrirut as the
// contact path) turned into a repeatable migration. New captures no longer need
// it: the Legistar lane now fetches attachments on every gated matter
// (sources/legistar-attachments). This exists for rows written BEFORE that, and
// as the re-runnable path when a jurisdiction's staff reports are published late.
//
// Extraction and attribution are the lane's own, imported not re-implemented, so
// a backfilled row is identical to a freshly captured one. In particular a phone
// or email is attributed to a party only from that party's own labeled block,
// never from an agency's.
//
// Never blanks a field: a document value replaces a stored value (the document
// states it, the model inferred it), and a field the documents do not carry is
// left exactly as it was. Idempotent: the provenance block is written once.
//
//   DRY_RUN=1 reports what would change without writing.
//   node --env-file=.env.local --import tsx agents/scraper/migrations/enrich-legistar-contacts.ts

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { matterContacts, contactProvenance, lastAttachmentStats } from '../sources/legistar-attachments';

const PROVENANCE_MARKER = '--- contacts from the matter documents ---';
const CONCURRENCY = 4;

interface Row {
  id: string;
  url: string | null;
  title: string | null;
  location: string | null;
  raw_content: string | null;
  presented_by: string | null;
  applicant: string | null;
  representative: string | null;
  primary_document_url: string | null;
}

// The Legistar client and matter id behind a stored citizen URL. Both stored
// shapes are handled: the gateway link (gateway.aspx?M=l&ID=110426) and the
// search-page fallback (Legislation.aspx#matter-110426).
export function matterRef(url: string | null): { client: string; matterId: number } | null {
  if (!url) return null;
  let host: string;
  let parsed: URL;
  try {
    parsed = new URL(url);
    host = parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!host.endsWith('.legistar.com')) return null;
  const client = host.replace(/\.legistar\.com$/, '');
  const fromGateway = parsed.searchParams.get('ID');
  const fromFragment = parsed.hash.match(/matter-(\d+)/)?.[1];
  const id = Number(fromGateway ?? fromFragment);
  if (!Number.isInteger(id) || id <= 0) return null;
  return { client, matterId: id };
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('id, url, title, location, raw_content, presented_by, applicant, representative, primary_document_url')
    .eq('source', 'legistar');
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];
  const targets = rows.filter((r) => matterRef(r.url) !== null);
  console.log(
    `Legistar rows: ${rows.length}; resolvable to a matter id: ${targets.length}${dryRun ? '  (DRY_RUN: no writes)' : ''}.`
  );

  let contactsFound = 0;
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  const fieldsFilled: Record<string, number> = { presented_by: 0, applicant: 0, representative: 0 };
  const samples: string[] = [];

  let next = 0;
  async function worker(): Promise<void> {
    while (next < targets.length) {
      const r = targets[next++];
      const ref = matterRef(r.url);
      if (!ref) continue;
      const c = await matterContacts(ref.client, ref.matterId, r.location ?? ref.client);
      if (!c) {
        unchanged++;
        continue;
      }
      contactsFound++;

      const patch: Record<string, unknown> = {};
      for (const f of ['presented_by', 'applicant', 'representative'] as const) {
        const value = c[f];
        if (value && value !== r[f]) {
          patch[f] = value;
          fieldsFilled[f]++;
        }
      }
      if (c.documentUrl && c.documentUrl !== r.primary_document_url) {
        patch.primary_document_url = c.documentUrl;
        patch.has_primary_document = true;
      }
      // Append provenance once; a row already carrying it keeps its text.
      if (!(r.raw_content ?? '').includes(PROVENANCE_MARKER)) {
        patch.raw_content = `${r.raw_content ?? ''}${contactProvenance(c)}`;
      }
      if (Object.keys(patch).length === 0) {
        unchanged++;
        continue;
      }
      if (samples.length < 10) {
        samples.push(
          `${String(r.title).replace(/\s+/g, ' ').slice(0, 52)} | ${c.applicant ?? '-'} | ${c.representative ?? '-'} | ${c.documentName}`
        );
      }
      if (dryRun) {
        updated++;
        continue;
      }
      const { error: upErr } = await supabaseAdmin.from('leads').update(patch).eq('id', r.id);
      if (upErr) {
        console.error(`Update failed for ${r.id}: ${upErr.message}`);
        failed++;
        continue;
      }
      updated++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

  console.log(`\nMatters carrying a contact block: ${contactsFound} of ${targets.length}`);
  console.log(`Rows updated: ${updated}   unchanged: ${unchanged}   failed: ${failed}`);
  console.log(
    `Fields written: presented_by ${fieldsFilled.presented_by}, applicant ${fieldsFilled.applicant}, representative ${fieldsFilled.representative}`
  );
  console.log('Attachment depth per jurisdiction (matters / listed / fetched / contact blocks):');
  for (const [j, s] of Object.entries(lastAttachmentStats()).sort()) {
    console.log(`    ${j}: ${s.mattersProcessed} / ${s.attachmentsListed} / ${s.attachmentsFetched} / ${s.contactsExtracted}`);
  }
  console.log('Sample (title | applicant | representative | source document):');
  for (const s of samples) console.log(`    - ${s}`);
}

main().catch((err) => {
  console.error('enrich-legistar-contacts failed:', err);
  process.exitCode = 1;
});
