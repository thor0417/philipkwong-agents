// THE DELIVERED DOCUMENTS THAT CARRY A CLIENT'S NAME AS THEIR PUBLISHER.
//
//     cd dashboard
//     npx tsx scripts/reissue-misbranded.ts                   DRY. Lists only.
//     npx tsx scripts/reissue-misbranded.ts --out=./reissue   rebuilds the PDFs
//     APPLY=1 npx tsx scripts/reissue-misbranded.ts --out=./reissue
//                                                             records the correction
//
// WHAT WENT WRONG. The composer resolved a document's cover brand as
// `brandOverride || client?.brand_name || 'Philip Kwong'`, so a client with a
// brand recorded published the document it received. Measured 2026-08-29 over
// the whole deliveries table, paged, no cap: 1,690 rows, 22 of them branded
// 'JKR & Associates' and every one of the 22 sent to JKR & Associates.
//
// ---- WHY THIS IS A REISSUE AND NOT A REPRINT -------------------------------
//
// THE FILES ARE NOT STORED. `deliveries.file_path` holds a FILENAME, not a path:
// documents are streamed to the browser and nothing is kept server-side. So the
// original bytes cannot be corrected; a new document has to be built over the
// same scope.
//
// AND THE CORPUS HAS MOVED. A document built today over July 2026 contains
// records captured since August, so a reissue is NOT byte-identical to what was
// sent and must not claim to be. Every corrected row says so in its note, and
// the original row is kept: standing rule 6, nothing is hard deleted.
//
// AND THE PERIOD TOKEN IS THE TRAP. Most of the 22 stored a RELATIVE token -
// 'last-month', 'this-month' - and re-resolving one today would produce a
// different window, and therefore a different document, while looking like a
// faithful reissue. period_start and period_end are stored absolute on the row,
// so the window is rebuilt from those and the token is used only as a label.
// Same shape as every other defect in this repo: a label read as the thing it
// names.

import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { buildReport, DETAIL_CAP_DEFAULT, geographyLabel } from '../lib/report-build';
import { DEFAULT_SECTION_IDS, REFERRAL_SECTION_IDS } from '../lib/report-sections';
import type { ResolvedPeriod } from '../lib/period';
import type { ClientScope } from '../lib/clients';
import { OPERATOR } from '../../lib/operator';

const args = process.argv.slice(2);
const flag = (n: string) => args.find((a) => a.startsWith(`--${n}=`))?.split('=').slice(1).join('=');
const OUT = flag('out');
const APPLY = process.env.APPLY === '1';

interface DeliveryRow {
  id: string;
  client_id: string | null;
  document_type: string | null;
  scope: Record<string, unknown> | null;
  brand_name: string | null;
  addressee: string | null;
  generated_at: string | null;
  period_start: string | null;
  period_end: string | null;
  project_count: number | null;
  record_count: number | null;
  file_path: string | null;
  delivery_status: string | null;
  notes: string | null;
}

async function signIn(): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (root .env.local).');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: users, error: uerr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (uerr) throw new Error(`listUsers: ${uerr.message}`);
  const email = users.users[0]?.email;
  if (!email) throw new Error('No users on this project, so there is no account to read as.');
  const { data: link, error: lerr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (lerr) throw new Error(`generateLink: ${lerr.message}`);
  const hash = link.properties?.hashed_token;
  if (!hash) throw new Error('generateLink returned no hashed_token.');
  const { error: verr } = await supabase.auth.verifyOtp({ token_hash: hash, type: 'email' });
  if (verr) throw new Error(`verifyOtp: ${verr.message}`);
}

// Paged, uncapped. A correction list assembled from the first page is a
// correction list with rows missing from it.
async function allDeliveries(): Promise<DeliveryRow[]> {
  const out: DeliveryRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('deliveries').select('*').range(from, from + 999);
    if (error) throw new Error(`deliveries: ${error.message}`);
    const rows = (data ?? []) as DeliveryRow[];
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}

// THE WINDOW FROM THE ROW, NOT FROM THE TOKEN. `until` is half-open, so the
// stored inclusive period_end is advanced by one day.
function periodFromRow(d: DeliveryRow): ResolvedPeriod {
  const stmt = (d.scope?.statement ?? {}) as { period?: string };
  const token = String(d.scope?.period ?? 'all');
  if (!d.period_start || !d.period_end) {
    return { key: token, label: stmt.period ?? 'All time', closed: false };
  }
  const until = new Date(`${d.period_end}T00:00:00Z`);
  until.setUTCDate(until.getUTCDate() + 1);
  return {
    key: token,
    label: stmt.period ?? `${d.period_start} to ${d.period_end}`,
    since: d.period_start,
    until: until.toISOString().slice(0, 10),
    // The window is fixed by the stored bounds, whatever the token said.
    closed: true,
  };
}

function scopeFromRow(d: DeliveryRow, clientId: string | null): ClientScope {
  const s = (d.scope ?? {}) as Record<string, unknown>;
  const arr = (k: string) => (Array.isArray(s[k]) ? (s[k] as string[]) : []);
  return {
    id: `reissue-of-${d.id}`,
    client_id: clientId ?? 'reissue',
    pipeline_id: String(s.pipeline_id ?? 'hospitality'),
    countries: arr('countries'),
    regions: arr('regions'),
    markets: arr('markets'),
    streams: arr('streams'),
    development_categories: arr('development_categories'),
    venue_types: arr('venue_types'),
    stages: arr('stages'),
    watch_terms: [],
    notes: null,
    created_at: null,
  };
}

// The same document generated twice is one document and two rows, and a PDF and
// its CSV are one document in two formats. Grouping by what the document IS,
// rather than by row, is what makes "22 rows" and "how many distinct documents"
// two separate and both-true answers.
function documentKey(d: DeliveryRow): string {
  const s = (d.scope ?? {}) as Record<string, unknown>;
  return JSON.stringify([
    d.client_id, d.document_type, d.period_start, d.period_end,
    s.markets, s.regions, s.countries, s.stages, s.streams,
    s.venue_types, s.development_categories, s.projectId,
    (s.statement as { filters?: string[] } | undefined)?.filters,
  ]);
}

async function main(): Promise<void> {
  await signIn();

  const { data: clientRows, error: cerr } = await supabase.from('clients').select('id,name,addressee');
  if (cerr) throw new Error(`clients: ${cerr.message}`);
  const clients = new Map(
    ((clientRows ?? []) as { id: string; name: string; addressee: string | null }[]).map((c) => [c.id, c])
  );

  const all = await allDeliveries();
  const bad = all.filter((d) => !!d.brand_name && d.brand_name !== OPERATOR);

  console.log(`\n${'='.repeat(78)}`);
  console.log('DELIVERED DOCUMENTS WHOSE PUBLISHER IS NOT THE OPERATOR');
  console.log('='.repeat(78));
  console.log(`\n  deliveries read: ${all.length}  (whole table, paged, no cap)`);
  console.log(`  misbranded rows: ${bad.length}\n`);

  const groups = new Map<string, DeliveryRow[]>();
  for (const d of bad) {
    const k = documentKey(d);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(d);
  }
  console.log(`  distinct documents behind those rows: ${groups.size}`);
  console.log('  (the same document generated twice, or as a PDF and a CSV, is one');
  console.log('   document and several rows. Both numbers are true and they are not');
  console.log('   the same number.)\n');

  for (const [, rows] of groups) {
    const first = rows[0];
    const c = first.client_id ? clients.get(first.client_id) : null;
    const s = (first.scope ?? {}) as Record<string, unknown>;
    const stmt = (s.statement ?? {}) as { period?: string; geography?: string };
    console.log(`  ${first.document_type}  ->  ${c?.name ?? '(no client)'}  (addressee ${first.addressee ?? '-'})`);
    console.log(`    branded  : ${first.brand_name}      should be: ${OPERATOR}`);
    console.log(`    period   : ${stmt.period ?? '-'}   window ${first.period_start ?? '-'} to ${first.period_end ?? '-'}   token '${String(s.period)}'`);
    console.log(`    geography: ${stmt.geography ?? '-'}`);
    console.log(`    rows     : ${rows.length}  ${rows.map((r) => `${r.id.slice(0, 8)}.${(r.file_path ?? '').split('.').pop()}`).join('  ')}`);
    console.log('');
  }

  if (!OUT) {
    console.log('  No --out= given, so nothing was rebuilt. Pass --out=<dir> to build the');
    console.log('  corrected documents and read them back off disk.\n');
    return;
  }

  const { mkdir, writeFile, stat } = await import('node:fs/promises');
  const { renderDocumentPdf } = await import('../app/api/report/doc-pdf');
  await mkdir(OUT, { recursive: true });

  console.log('='.repeat(78));
  console.log(`REBUILDING ${groups.size} DOCUMENTS INTO ${OUT}`);
  console.log('='.repeat(78));
  console.log('');

  const built: { rows: DeliveryRow[]; path: string; bytes: number }[] = [];
  const failed: { rows: DeliveryRow[]; why: string }[] = [];

  let n = 0;
  for (const [, rows] of groups) {
    const d = rows[0];
    n += 1;
    const c = d.client_id ? clients.get(d.client_id) : null;
    const referral = (d.document_type ?? '').toLowerCase().includes('referral');
    const scope = scopeFromRow(d, d.client_id);
    const projectId = (d.scope?.projectId as string | null) ?? null;
    try {
      const report = await buildReport({
        scope,
        period: periodFromRow(d),
        sectionIds: referral ? REFERRAL_SECTION_IDS : DEFAULT_SECTION_IDS,
        commentary: {},
        detailCap: DETAIL_CAP_DEFAULT,
        title: d.document_type ?? 'Market intelligence report',
        // THE WHOLE POINT OF THE EXERCISE. Not the client's name, not an
        // override, not a default with a chain in front of it.
        brandName: OPERATOR,
        addressee: d.addressee ?? c?.addressee ?? c?.name ?? 'Internal',
        clientId: d.client_id,
        clientName: c?.name ?? null,
        watchlistOnly: false,
        includeDormant: false,
        includeContext: true,
        geographyLabel: geographyLabel(scope),
        projectId,
      });
      if (report.doc.brandName !== OPERATOR) {
        throw new Error(`the rebuilt document is branded "${report.doc.brandName}"`);
      }
      const name = `reissue-${String(n).padStart(2, '0')}-${d.id.slice(0, 8)}.pdf`;
      const path = `${OUT}/${name}`;
      await writeFile(path, await renderDocumentPdf(report.doc));
      // READ IT BACK OFF DISK. Standing rule 11: a generator that PRINTS an
      // artefact reads it off disk, so a missing file fails the run instead of
      // manufacturing the appearance of one.
      const st = await stat(path);
      if (st.size === 0) throw new Error('wrote a zero-byte file');
      built.push({ rows, path, bytes: st.size });
      console.log(
        `  ok    ${name}  ${String(st.size).padStart(7)} bytes   brand "${report.doc.brandName}"   ` +
          `for "${report.doc.addressee}"   ${report.doc.projectCount} projects / ${report.doc.recordCount} records`
      );
    } catch (e) {
      const why = String(e instanceof Error ? e.message : e).slice(0, 300);
      failed.push({ rows, why });
      console.log(`  FAIL  ${d.id.slice(0, 8)}  ${why}`);
    }
  }

  console.log(
    `\n  built ${built.length} of ${groups.size} documents, covering ` +
      `${built.reduce((a, b) => a + b.rows.length, 0)} of ${bad.length} delivery rows.`
  );
  if (failed.length) {
    console.log(`  ${failed.length} FAILED, listed above. Nothing is recorded for a document that did not build.`);
  }

  // ---- RECORDING THE CORRECTION -------------------------------------------
  //
  // On the ROW, not over it. The original keeps its brand_name - it is the only
  // evidence of what was actually sent - and gains the fact that it was
  // superseded, by what, and when.
  console.log(`\n${'='.repeat(78)}`);
  console.log('RECORDING THE CORRECTION');
  console.log('='.repeat(78));

  const probe = await supabase.from('deliveries').select('corrected_at').limit(1);
  if (probe.error) {
    console.log('\n  MIGRATION 047 IS NOT APPLIED. deliveries has no corrected_at column:');
    console.log(`    ${probe.error.message}`);
    console.log('\n  047 is printed at agents/scraper/migrations/047_delivery_corrections.sql');
    console.log('  and is Philip\'s to run, standing rule 5. NOTHING WAS RECORDED.');
    console.log('  The rebuilt documents above are on disk and were read back off it.\n');
    return;
  }
  if (!APPLY) {
    console.log('\n  DRY RUN. 047 is applied, and these rows WOULD be marked corrected:');
    for (const b of built) for (const r of b.rows) console.log(`    ${r.id}  ${r.brand_name} -> ${OPERATOR}`);
    console.log('\n  Re-run with APPLY=1 to write.\n');
    return;
  }
  let written = 0;
  for (const b of built) {
    for (const r of b.rows) {
      const { error } = await supabase
        .from('deliveries')
        .update({
          corrected_at: new Date().toISOString(),
          corrected_from_brand: r.brand_name,
          correction_note:
            `Published under the recipient's own name. Reissued under ${OPERATOR}. ` +
            `The reissue is a NEW document over the same scope and the same period window ` +
            `(${r.period_start ?? '-'} to ${r.period_end ?? '-'}), not a reprint: the original ` +
            `file was never stored and the corpus has moved since.`,
        })
        .eq('id', r.id);
      if (error) {
        console.log(`    FAILED ${r.id}: ${error.message}`);
        continue;
      }
      written += 1;
    }
  }
  console.log(`\n  ${written} delivery rows marked corrected. brand_name is untouched on every one of them.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
