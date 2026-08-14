// GENERATE A DOCUMENT AND READ IT BACK.
//
//   node --env-file=.env.local --env-file=dashboard/.env.local \
//     --import tsx dashboard/scripts/generate.ts <scope> [options]
//
//   scope:  all
//           market=<name>
//           category=<development category>
//           client=<client name substring>
//           project=<project name substring>
//           combo=<market>+<category>          both axes at once
//
//   options: --referral        the referral section set instead of the default
//            --period=<key>    default 'all'
//            --detail=<n>      how many projects are described in full
//            --text            print the whole document
//            --sections        print the section list with counts (default)
//
// It calls the SAME buildReport the composer calls, through the SAME anon client
// under the SAME row-level security as dashboard/scripts/client-reports, and for
// the same reason: reading the tables with the service key would answer what is
// in the database rather than what a client's document contains.
//
// A DOCUMENT IS ONLY VERIFIED BY READING IT. This exists because a commit is not
// evidence that a report is right: --text prints the generated document in full,
// with its provenance tags, its geography subheadings, its people blocks and its
// contact lines, so a claim about a report can be checked against the report.

import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchClients, fetchAllScopes, type ClientScope } from '../lib/clients';
import { buildReport, DETAIL_CAP_DEFAULT, geographyLabel, listScopeProjects } from '../lib/report-build';
import { resolvePeriod } from '../lib/period';
import { DEFAULT_SECTION_IDS, REFERRAL_SECTION_IDS } from '../lib/report-sections';
import { assertBasis, assertProvenance, provenanceTally } from '../lib/report-model';
import { renderDocumentText } from '../lib/report-text';
import { HOSPITALITY_ID } from '../lib/pipelines';
import { categoriesForPipeline } from '../lib/taxonomy';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? 'all';
const flag = (name: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const REFERRAL = args.includes('--referral');
const AS_TEXT = args.includes('--text');
const PERIOD = flag('period') ?? 'all';
const DETAIL = Number(flag('detail') ?? DETAIL_CAP_DEFAULT);

async function signIn(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
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

function emptyScope(): ClientScope {
  return {
    id: 'ad-hoc',
    client_id: 'ad-hoc',
    pipeline_id: HOSPITALITY_ID,
    countries: null,
    regions: null,
    markets: null,
    streams: null,
    development_categories: null,
    venue_types: null,
    stages: null,
    watch_terms: null,
    notes: null,
    created_at: null,
  };
}

interface Resolved {
  scope: ClientScope;
  label: string;
  clientName: string | null;
  addressee: string;
  brandName: string;
  projectId: string | null;
  projectName?: string | null;
}

async function resolveTarget(): Promise<Resolved> {
  const base: Resolved = {
    scope: emptyScope(),
    label: 'the whole register',
    clientName: null,
    addressee: 'Philip Kwong',
    brandName: 'JKR & Associates',
    projectId: null,
  };
  if (target === 'all') return base;

  const [kind, ...rest] = target.split('=');
  const value = rest.join('=');

  if (kind === 'market') {
    return { ...base, scope: { ...base.scope, markets: [value] }, label: `market ${value}` };
  }
  if (kind === 'category') {
    return {
      ...base,
      scope: { ...base.scope, development_categories: [value] },
      label: `category ${value}`,
    };
  }
  if (kind === 'combo') {
    const [market, category] = value.split('+');
    return {
      ...base,
      scope: { ...base.scope, markets: [market], development_categories: [category] },
      label: `${market} and ${category}`,
    };
  }
  if (kind === 'client') {
    const clients = await fetchClients();
    const client = clients.find((c) => c.name.toLowerCase().includes(value.toLowerCase()));
    if (!client) throw new Error(`no client matching "${value}"`);
    const scope = (await fetchAllScopes()).find((s) => s.client_id === client.id);
    if (!scope) throw new Error(`client "${client.name}" has no stored scope`);
    return {
      scope,
      label: `client ${client.name}`,
      clientName: client.name,
      addressee: client.addressee ?? client.name,
      brandName: client.brand_name ?? 'JKR & Associates',
      projectId: null,
    };
  }
  if (kind === 'project') {
    // Found through the SAME listScopeProjects the composer's picker uses, so a
    // project this script can generate is a project the picker can offer.
    const candidates = await listScopeProjects(base.scope);
    const hit = candidates.find((p) => p.name.toLowerCase().includes(value.toLowerCase()));
    if (!hit) throw new Error(`no project matching "${value}" in scope`);
    return { ...base, label: `project ${hit.name}`, projectId: hit.id, projectName: hit.name };
  }
  throw new Error(`unknown scope "${target}"`);
}

async function main(): Promise<void> {
  await signIn();
  const t = await resolveTarget();
  const period = resolvePeriod(PERIOD, new Date());
  const built = await buildReport({
    scope: t.scope,
    period,
    sectionIds: REFERRAL ? REFERRAL_SECTION_IDS : DEFAULT_SECTION_IDS,
    commentary: {},
    detailCap: DETAIL,
    title: REFERRAL ? 'Project Referral Brief' : 'Government Intelligence Report',
    brandName: t.brandName,
    addressee: t.addressee,
    clientName: t.clientName,
    watchlistOnly: false,
    includeDormant: false,
    includeContext: false,
    // THE SAME LABEL THE COMPOSER PASSES. A referral brief covers one project,
    // and a cover reading "all covered markets" over a single-matter document
    // claims coverage the document does not have.
    geographyLabel: t.projectId ? t.projectName ?? 'one project' : geographyLabel(t.scope),
    projectId: t.projectId,
  });

  let gate = 'passed';
  try {
    assertBasis(built.doc);
    assertProvenance(built.doc);
  } catch (e) {
    gate = `FAILED: ${String(e).slice(0, 200)}`;
  }

  if (AS_TEXT) {
    console.log(renderDocumentText(built.doc));
    console.log('');
  }

  const tally = provenanceTally(built.doc);
  console.log('='.repeat(74));
  console.log(`SCOPE: ${t.label}    period: ${period.label}    detail cap: ${DETAIL}`);
  console.log('='.repeat(74));
  console.log(`  gate: ${gate}`);
  console.log(`  pages (estimate): ${built.pages}`);
  console.log(
    `  projects in scope: ${built.selection.inScope}   detailed: ${built.selection.detailed}   ` +
      `counted: ${built.selection.counted}   silent: ${built.selection.silent}   ` +
      `unplaced: ${built.selection.unplaced}   hollow-excluded: ${built.selection.excludedHollow}`
  );
  console.log(`  records: ${built.doc.recordCount}`);
  console.log(
    `  provenance: RECORD ${tally.RECORD}  PRESS ${tally.PRESS}  ASSESSMENT ${tally.ASSESSMENT}`
  );
  // THE TAXONOMY VALUES USED, AND WHAT IS IN EACH. Read off the same locked
  // list the sections are built from, so a category with no projects is visible
  // as a category with no projects rather than as a section that is simply
  // absent.
  const inScope = new Map<string, number>();
  for (const p of built.projects) {
    const c = p.development_category ?? '(no resolved category)';
    inScope.set(c, (inScope.get(c) ?? 0) + 1);
  }
  console.log('  CATEGORY VALUES (from lib/taxonomy, keyed on pipeline_id ' +
    `"${t.scope.pipeline_id}"), projects in scope:`);
  for (const c of categoriesForPipeline(t.scope.pipeline_id)) {
    console.log(`    ${String(inScope.get(c) ?? 0).padStart(4)}  ${c}`);
  }
  console.log(`    ${String(inScope.get('(no resolved category)') ?? 0).padStart(4)}  (no resolved category)`);

  console.log('  SECTIONS:');
  for (const s of built.doc.sections) {
    const entries = s.entries?.length ?? 0;
    const markets = new Set((s.entries ?? []).map((e) => e.group).filter(Boolean)).size;
    console.log(
      `    ${String(entries || s.lines.length).padStart(3)}  ${s.title}` +
        (entries ? `   (${entries} entries across ${markets} market${markets === 1 ? '' : 's'})` : '') +
        (s.lines.length && !entries ? `   (${s.lines.length} lines)` : '')
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
