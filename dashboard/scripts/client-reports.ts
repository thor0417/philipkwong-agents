// GENERATE EVERY ACTIVE CLIENT'S REPORT AND AUDIT IT.
//
//   node --env-file=.env.local --env-file=dashboard/.env.local \
//     --import tsx dashboard/scripts/client-reports.ts
//
// This calls the SAME buildReport the composer calls, through the SAME anon
// client under the SAME row-level security. Reading the tables with the service
// key instead would answer a different question - what is in the database
// rather than what a client's document actually contains - and the difference
// between those two is exactly what a report audit is for.
//
// AUTHENTICATION, BECAUSE RLS IS REAL. An unauthenticated anon client reads
// zero rows from projects, so a report built without a session is empty and
// looks like a scope that matched nothing. The session is minted the way
// e2e/auth.setup.ts mints it: the service key generates a one-time magic-link
// token, the anon client redeems it. No password is stored anywhere.
//
// WHAT IT REPORTS, per client:
//   - the project count, and whether every project honours the stored scope
//   - the provenance breakdown, RECORD / PRESS / ASSESSMENT
//   - whether project summaries reach the document
//   - whether any project holding zero live records appears in it

import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchClients, fetchAllScopes, resolveScope } from '../lib/clients';
import { buildReport, DETAIL_CAP_DEFAULT } from '../lib/report-build';
import { geographyLabel } from '../lib/report-build';
import { resolvePeriod } from '../lib/period';
import { DEFAULT_SECTION_IDS } from '../lib/report-sections';
import { assertProvenance, type Line } from '../lib/report-model';

const PERIOD = process.env.REPORT_PERIOD ?? 'all';

async function signIn(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (root .env.local).');
  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
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
  return email;
}

function provenanceOf(lines: Line[]): Record<string, number> {
  const out: Record<string, number> = { RECORD: 0, PRESS: 0, ASSESSMENT: 0 };
  for (const l of lines) out[l.provenance] = (out[l.provenance] ?? 0) + 1;
  return out;
}

async function main(): Promise<void> {
  const email = await signIn();
  console.log(`signed in as ${email}   period: ${PERIOD}\n`);

  // Projects holding no live record. A project whose every record has been
  // dismissed has nothing to say, and a client document that lists one is
  // asserting activity that is not there.
  const { data: empties, error: eerr } = await supabase
    .from('projects')
    .select('id,name,market,record_count')
    .eq('record_count', 0);
  if (eerr) throw new Error(`empty-project read: ${eerr.message}`);
  const emptyIds = new Set((empties ?? []).map((p) => p.id as string));
  console.log(`projects holding zero live records: ${emptyIds.size}\n`);

  const clients = await fetchClients();
  const scopes = await fetchAllScopes();

  for (const c of clients.filter((x) => x.status === 'active')) {
    const scope = scopes.find((s) => s.client_id === c.id);
    if (!scope) {
      console.log(`${c.name}: NO SCOPE STORED, skipped\n`);
      continue;
    }
    const period = resolvePeriod(PERIOD, new Date('2026-08-10T00:00:00Z'));
    const built = await buildReport({
      scope,
      period,
      sectionIds: DEFAULT_SECTION_IDS,
      commentary: {},
      // The default, explicitly. This harness exists to audit what a client
      // would receive, so it must not quietly ask for a different document
      // shape than the composer produces.
      detailCap: DETAIL_CAP_DEFAULT,
      title: `${c.name} - register report`,
      brandName: c.brand_name ?? 'Philip Kwong',
      addressee: c.addressee ?? '',
      clientName: c.name,
      // WHICH CLIENT, so the membership gate runs. The same defect the exclusion
      // audit had: this harness exists to report what a client would receive and
      // was generating a document with the confirmation gate switched off, so
      // its project counts were the scope's proposal rather than the client's
      // document. The composer passes it; every harness claiming to audit the
      // composer's output has to pass it too.
      clientId: c.id,
      watchlistOnly: false,
      includeDormant: false,
      includeContext: false,
      geographyLabel: geographyLabel(scope),
    });

    // The gate the composer runs before rendering. If it throws, the document
    // would not have been generated at all, and saying so is the finding.
    let gate = 'passed';
    try {
      assertProvenance(built.doc);
    } catch (e) {
      gate = `FAILED: ${String(e).slice(0, 140)}`;
    }

    const lines = built.doc.sections.flatMap((s) => [...s.lines, ...s.commentary]);
    const prov = provenanceOf(lines);
    const resolved = resolveScope(scope);

    console.log('='.repeat(72));
    console.log(`${c.name}`);
    console.log('='.repeat(72));
    console.log(`  geography on the cover: ${built.doc.scope.geography}`);
    console.log(`  period: ${built.doc.scope.period}   pages: ${built.pages}   provenance gate: ${gate}`);
    console.log(`  PROJECTS: ${built.doc.projectCount}   RECORDS: ${built.doc.recordCount}`);
    console.log(`  capped: projects=${built.capped.projects} records=${built.capped.records}`);
    console.log(`  PROVENANCE: RECORD ${prov.RECORD}   PRESS ${prov.PRESS}   ASSESSMENT ${prov.ASSESSMENT}`);
    console.log(
      `  scope stored: venues=${(scope.venue_types ?? []).length} stages=${(scope.stages ?? []).length} ` +
        `markets=${(scope.markets ?? []).length} watch=${(scope.watch_terms ?? []).length}`
    );
    console.log(`  resolved to: ${JSON.stringify(resolved.query)}`);
    console.log(`  post-filters: ${resolved.postFilters.map((p) => p.field).join(', ') || '(none)'}`);

    // ---- 1. SCOPE CONFORMANCE, project by project -------------------------
    const venues = scope.venue_types ?? [];
    const stages = scope.stages ?? [];
    const markets = scope.markets ?? [];
    const breaches: string[] = [];
    for (const p of built.projects) {
      if (venues.length && !venues.includes(p.venue_type ?? '')) {
        breaches.push(`venue "${p.venue_type ?? 'null'}" not in scope: ${p.name}`);
      }
      if (stages.length && !stages.includes(p.stage ?? '')) {
        breaches.push(`stage "${p.stage ?? 'null'}" not in scope: ${p.name}`);
      }
      if (markets.length && !markets.includes(p.market ?? '')) {
        breaches.push(`market "${p.market ?? 'null'}" not in scope: ${p.name}`);
      }
    }
    console.log(`  SCOPE CONFORMANCE: ${breaches.length === 0 ? 'every project honours the stored scope' : breaches.length + ' BREACHES'}`);
    for (const b of breaches.slice(0, 10)) console.log(`      ${b}`);
    // Printed for any scope small enough to read, so "conforms" is a claim the
    // reader can check rather than one they have to accept.
    if (built.projects.length <= 25) {
      for (const p of built.projects) {
        console.log(
          `      ${String(p.venue_type ?? 'null').padEnd(28)} ${String(p.stage ?? 'null').padEnd(18)} ` +
            `rec=${String(p.record_count ?? 0).padStart(2)}  ${p.name.slice(0, 44)}`
        );
      }
    }

    // ---- 2. SUMMARIES ------------------------------------------------------
    // A summary reaches the document as a RECORD line carrying this label, and
    // only a DERIVED summary can: a generated one has no filing to cite.
    const summaryLines = lines.filter((l) => l.sourceLabel === 'quoted from the filing');
    const withSummary = built.projects.filter((p) => p.summary).length;
    const derivable = built.projects.filter((p) => p.summary_source === 'derived' && p.summary_url).length;
    console.log(
      `  SUMMARIES: ${withSummary} of ${built.projects.length} projects carry one ` +
        `(${derivable} derived-and-citable); ${summaryLines.length} printed in the document`
    );
    for (const l of summaryLines.slice(0, 3)) console.log(`      ${l.text.trim().slice(0, 92)}`);

    // ---- 3. EMPTY PROJECTS -------------------------------------------------
    const emptiesInDoc = built.projects.filter((p) => emptyIds.has(p.id));
    console.log(`  ZERO-LIVE-RECORD PROJECTS IN THIS DOCUMENT: ${emptiesInDoc.length}`);
    for (const p of emptiesInDoc.slice(0, 8)) console.log(`      [${p.market ?? ''}] ${p.name}`);
    if (emptiesInDoc.length > 8) console.log(`      ... and ${emptiesInDoc.length - 8} more`);
    console.log('');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
