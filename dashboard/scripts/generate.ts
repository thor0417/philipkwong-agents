// GENERATE A DOCUMENT AND READ IT BACK.
//
//   node --env-file=.env.local --env-file=dashboard/.env.local \
//     --import tsx dashboard/scripts/generate.ts <scope> [options]
//
//   scope:  all
//           market=<name>
//           category=<development category>
//           client=<client name substring>
//           project=<project name substring>   with --client=<name> for a
//                                              client's referral brief
//           combo=<market>+<category>          both axes at once
//
//   options: --referral        the referral section set instead of the default
//            --no-context      drop context records. The composer INCLUDES them
//                              by default and so does this.
//            --dormant         include dormant projects
//            --watchlist       watch list only
//            --brand=<name>    the name on the document. Defaults to the
//                              client's stored brand, then to Philip Kwong.
//            --to=<name>       WHO THE DOCUMENT IS ADDRESSED TO. Required with
//                              --referral; see resolveTarget.
//            --label=<text>   override the caller's geography label. FOR PROVING
//                              the document does not depend on it; never for a
//                              document that is sent.
//            --period=<key>    default 'all'
//            --detail=<n>      how many projects are described in full
//            --pdf=<path>     ALSO write the PDF the client receives, through
//                              the same renderer app/api/report calls, and read
//                              its size back off disk. RUN THIS ONE FROM
//                              dashboard/, because doc-pdf imports through the
//                              @/ alias and tsx resolves that from the tsconfig
//                              at the working directory. From the repo root it
//                              fails with "Cannot find module '@/lib/report-model'"
//                              AFTER --text has already printed, which truncates
//                              a redirected .md file rather than leaving it alone:
//                                cd dashboard && node --env-file=../.env.local //                                  --env-file=.env.local --import tsx //                                  scripts/generate.ts ... --pdf=<absolute path>
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
import { OPERATOR } from '../../lib/operator';

const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--')) ?? 'all';
const flag = (name: string): string | null => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};
const REFERRAL = args.includes('--referral');
// WHICH CLIENT A project= BRIEF IS FOR. Optional, and the summary states which
// membership gate actually ran either way, so an internal read of one matter is
// still possible and cannot be mistaken for a client's document.
const CLIENT = flag('client');
// THERE IS NO --brand FLAG AND NO DEFAULT TO PICK.
//
// This script used to resolve `BRAND ?? client.brand_name ?? DEFAULT_BRAND` -
// the composer's defect with a command-line override bolted on top, so it could
// misattribute a document in two ways instead of one. Both are gone. The
// publisher is OPERATOR, imported, and a read-back tool that could brand a
// document differently from the composer is worse than no read-back tool,
// because it is trusted. --to still names the RECIPIENT, which is a real input.

// THE INCLUSION TOGGLES, DEFAULTED TO THE COMPOSER'S. --no-context and
// --dormant and --watchlist move them, so an internal read can still ask a
// narrower question than the button does - deliberately, and by saying so.
const INCLUDE_CONTEXT = !args.includes('--no-context');
const INCLUDE_DORMANT = args.includes('--dormant');
const WATCHLIST_ONLY = args.includes('--watchlist');
const AS_TEXT = args.includes('--text');
// WRITE THE PDF a client would receive, to this path. See the block in main().
const PDF_PATH = flag('pdf');
// A DELIBERATELY WRONG geographyLabel, for proving the document ignores it.
const LABEL = flag('label');
const PERIOD = flag('period') ?? 'all';
const DETAIL = Number(flag('detail') ?? DETAIL_CAP_DEFAULT);
// THE RECIPIENT IS AN INPUT, NOT THE OPERATOR.
//
// The default addressee below is the person GENERATING the document, which is
// right for a market report - an internal read of our own register - and wrong
// for the one document type designed to leave the building. The Heart Hotel
// referral brief printed "Prepared for Philip Kwong" on a brief about a JKR
// project lead, written to be FORWARDED to whoever will act on the matter.
//
// So --to is required with --referral and there is no fallback, because every
// available fallback is a false statement about who a document is for. Naming
// the operator is the worst of them: it reads as correct, so nobody checks it.
const TO = flag('to');

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
  // THE CLIENT'S ID, NOT JUST THEIR NAME, AND THE DIFFERENCE IS THE WHOLE GATE.
  //
  // This script existed to answer "what does a client's document contain" and
  // for a client target it answered a different question, because buildReport
  // enforces confirmed membership only when it is given a clientId and this
  // passed the name, the addressee and the brand and not the id.
  //
  // Measured the day Simtec's membership was first confirmed: 5 included and 10
  // excluded, and this script generated a 13-project document containing EIGHT
  // of the excluded ones - and printed "gate: passed" over it. The provenance
  // gate had indeed passed; the membership gate had never run.
  //
  // A read-back tool that builds a different document from the composer is worse
  // than no read-back tool, because it is trusted.
  clientId: string | null;
  clientName: string | null;
  addressee: string;
  brandName: string;
  projectId: string | null;
  projectName?: string | null;
}

/**
 * A CLIENT, RESOLVED ONCE, FOR BOTH THE client= AND THE project= TARGET.
 *
 * Every field a client document needs comes from here: the stored scope, the ID
 * the membership gate reads, the brand on the page and who it is addressed to.
 * One implementation, because the whole reason the project= branch was wrong is
 * that it built its own version of this and left the id out.
 */
async function clientTarget(value: string): Promise<Resolved> {
  const clients = await fetchClients();
  const client = clients.find((c) => c.name.toLowerCase().includes(value.toLowerCase()));
  if (!client) throw new Error(`no client matching "${value}"`);
  const scope = (await fetchAllScopes()).find((s) => s.client_id === client.id);
  if (!scope) throw new Error(`client "${client.name}" has no stored scope`);
  return {
    scope,
    label: `client ${client.name}`,
    clientId: client.id,
    clientName: client.name,
    // --to still wins for a client target: a client's document may be sent to a
    // named person at that client rather than to the account.
    addressee: TO ?? client.addressee ?? client.name,
    brandName: OPERATOR,
    projectId: null,
  };
}

async function resolveTarget(): Promise<Resolved> {
  if (REFERRAL && !TO) {
    throw new Error(
      'A referral brief is addressed to someone. Pass --to="<name>". ' +
        'It exists to be forwarded to whoever will act on the matter, so the recipient is an ' +
        'input to the document. There is deliberately no default: addressing it to whoever ' +
        'generated it is the error this check exists to stop.'
    );
  }
  const base: Resolved = {
    scope: emptyScope(),
    clientId: null,
    label: 'the whole register',
    clientName: null,
    addressee: TO ?? OPERATOR,
    brandName: OPERATOR,
    projectId: null,
  };
  if (target === 'all') return base;

  const [kind, ...rest] = target.split('=');
  const value = rest.join('=');

  if (kind === 'market') {
    // ---- A MARKET TARGET MAY CARRY A CLIENT TOO ----------------------------
    //
    // Same branch-away miss as the project target below, and the same fix. A
    // "Clark County report for JKR" is not the same document as a Clark County
    // report: it carries the client's brand, its addressee, and above all its
    // membership gate, so a project on the register that JKR has not confirmed
    // is withheld and counted. Without --client this built with an empty scope
    // and a null client id, and the gate reported 'no-client' - which is a fine
    // internal read and is not what a client is sent.
    //
    // The market NARROWS the client's scope rather than replacing it. Every
    // other axis the client's scope constrains still constrains.
    const withClient = CLIENT ? await clientTarget(CLIENT) : base;
    return {
      ...withClient,
      scope: { ...withClient.scope, markets: [value] },
      label: CLIENT ? `market ${value} for ${withClient.clientName}` : `market ${value}`,
    };
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
  if (kind === 'client') return clientTarget(value);
  if (kind === 'project') {
    // ---- A PROJECT TARGET MAY CARRY A CLIENT, AND USUALLY MUST --------------
    //
    // This returned { ...base, projectId } and base holds an EMPTY SCOPE AND A
    // NULL CLIENT ID, so every referral brief this script has ever produced was
    // built with no client scope and with the membership gate reporting
    // 'no-client' - a different document from the one the composer's button
    // makes, which is the exact failure the golden case
    // a-read-back-tool-builds-the-clients-document records. That case fixed the
    // client= branch and left this one, one branch away, untouched.
    //
    // So --client applies here too: the scope, the id, the brand and the
    // addressee all come from the client, and the project is then selected out
    // of THEIR scope rather than out of the whole register. Without it the
    // behaviour is unchanged and the summary says which gate ran, so an internal
    // read is still possible and is never mistaken for a client's document.
    const withClient = CLIENT ? await clientTarget(CLIENT) : base;
    // Found through the SAME listScopeProjects the composer's picker uses, so a
    // project this script can generate is a project the picker can offer.
    const candidates = await listScopeProjects(withClient.scope);
    const hit = candidates.find((p) => p.name.toLowerCase().includes(value.toLowerCase()));
    if (!hit) {
      throw new Error(
        `no project matching "${value}" in ${CLIENT ? `${withClient.clientName}'s scope` : 'scope'}`
      );
    }
    return {
      ...withClient,
      label: CLIENT ? `project ${hit.name} for ${withClient.clientName}` : `project ${hit.name}`,
      projectId: hit.id,
      projectName: hit.name,
    };
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
    clientId: t.clientId,
    clientName: t.clientName,
    watchlistOnly: WATCHLIST_ONLY,
    includeDormant: INCLUDE_DORMANT,
    // ---- THE COMPOSER'S DEFAULT, NOT THIS SCRIPT'S -------------------------
    //
    // This was hardcoded false while the composer's checkbox starts CHECKED, so
    // a brief generated here held fewer records than the same brief generated
    // from the button and nothing said so. The third default in this file to
    // disagree with the screen, after the client id and the brand - the same
    // shape each time: a script that stands in for the product and drifts from
    // it, which is what the golden case
    // a-read-back-tool-builds-the-clients-document is about.
    includeContext: INCLUDE_CONTEXT,
    // THE SAME LABEL THE COMPOSER PASSES. A referral brief covers one project,
    // and a cover reading "all covered markets" over a single-matter document
    // claims coverage the document does not have.
    // THE SAME PLACEHOLDER THE COMPOSER CARRIED, AND FOR THE SAME REASON IT HAD
    // TO GO: it is a caller's guess printed on a client document. --label exists
    // to PROVE the document no longer depends on this value: pass a deliberately
    // wrong one and read the cover back. If the matter still names the project,
    // the builder is reading the row rather than the caller.
    geographyLabel: LABEL ?? (t.projectId ? t.projectName ?? geographyLabel(t.scope) : geographyLabel(t.scope)),
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

  // ---- AND THE ARTEFACT THE CLIENT ACTUALLY RECEIVES ------------------------
  //
  // THE TEXT RENDERER IS NOT THE DOCUMENT, AND THIS SCRIPT SPENT A DAY IMPLYING
  // THAT IT WAS. Every check run through --text is a check on one renderer, and
  // the four defects found on the Heart Hotel brief were all in the other one -
  // the PDF footer most of all, which report-text prints once as a header line
  // and which @react-pdf repeats `fixed` on every page. "Zero occurrences in the
  // markdown" was a true statement about a file and an inference about the PDF,
  // and the inference was wrong three times in one day.
  //
  // renderDocumentPdf is the same function app/api/report/route.ts calls. That
  // route takes an already-built `doc` and renders it, so buildReport ->
  // renderDocumentPdf is the whole path from scope to artefact, not an
  // approximation of it.
  if (PDF_PATH) {
    const { renderDocumentPdf } = await import('../app/api/report/doc-pdf');
    const { writeFile } = await import('node:fs/promises');
    const buf = await renderDocumentPdf(built.doc);
    await writeFile(PDF_PATH, buf);
    // READ BACK OFF DISK, never reported from the buffer. Standing rule 11: a
    // generator that PRINTS an artefact reads it off disk, so a missing file
    // fails the run instead of manufacturing the appearance of one.
    const { stat } = await import('node:fs/promises');
    const st = await stat(PDF_PATH);
    console.log(`PDF written: ${PDF_PATH}  ${st.size} bytes`);
  }

  const tally = provenanceTally(built.doc);
  console.log('='.repeat(74));
  console.log(`SCOPE: ${t.label}    period: ${period.label}    detail cap: ${DETAIL}`);
  console.log('='.repeat(74));
  console.log(`  gate: ${gate}`);
  // WHICH GATE PASSED, SAID OUT LOUD. "gate: passed" is the PROVENANCE gate, and
  // printing it alone over a client document read as though every gate had run.
  // The membership gate is the one that decides which projects a client is
  // covered for, and a document built with it 'no-client' or 'not-applied' is a
  // scope preview rather than a client's document. It now says which it is.
  console.log(`  membership gate: ${built.membershipGate}`);
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
