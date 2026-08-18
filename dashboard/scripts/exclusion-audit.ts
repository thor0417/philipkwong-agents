// WHAT EVERY DOCUMENT LOSES, AND WHETHER IT SAYS SO.
//
//   node --env-file=.env.local --env-file=dashboard/.env.local \
//     --import tsx dashboard/scripts/exclusion-audit.ts
//
// The condition on every exclusion rule in this system is that nothing is
// silently absent: if a document withholds a project, the document states the
// count and the reason. That is a property of the generated document, so it is
// checked by generating documents and reading them, not by reading the code.
//
// For each scope it reports, per market, how many projects the document loses to
// each rule, and then ASSERTS that every excluded project is accounted for in
// the document's own text. A rule whose count never reaches the page is a silent
// exclusion and fails the run.

import { createClient } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { fetchClients, fetchAllScopes, type ClientScope } from '../lib/clients';
import { buildReport, DETAIL_CAP_DEFAULT, geographyLabel } from '../lib/report-build';
import { resolvePeriod } from '../lib/period';
import {
  capNotes,
  DEFAULT_SECTION_IDS,
  emptyDocumentSentence,
  membershipSentence,
  type SectionContext,
} from '../lib/report-sections';
import { fetchIncludedProjectIds } from '../lib/client-projects';
import { renderDocumentText } from '../lib/report-text';
import { HOSPITALITY_ID } from '../lib/pipelines';
import { isProvisionalName } from '../lib/taxonomy';
import { DEAD_FEEDS, deadFeedForMarket } from '../../lib/dead-feeds';
import { applyProjectFilters, PROJECT_COLUMNS, type Project } from '../lib/projects';
import {
  applyPostFilters,
  hasRecordFacets,
  projectsHoldingStreams,
  projectsMatchingRecordFacets,
  resolveScope,
} from '../lib/clients';
import { LIVE_PIPELINE_STORAGE_KEY } from '../lib/pipelines';

const DETAIL = Number(process.env.AUDIT_DETAIL ?? 60);

async function signIn(): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY missing (root .env.local).');
  const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: users, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
  if (error) throw new Error(`listUsers: ${error.message}`);
  const email = users.users[0]?.email;
  if (!email) throw new Error('no account to read as');
  const { data: link, error: lerr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (lerr) throw new Error(`generateLink: ${lerr.message}`);
  const { error: verr } = await supabase.auth.verifyOtp({ token_hash: link.properties!.hashed_token!, type: 'email' });
  if (verr) throw new Error(`verifyOtp: ${verr.message}`);
  return email;
}

function emptyScope(over: Partial<ClientScope> = {}): ClientScope {
  return {
    id: 'ad-hoc', client_id: 'ad-hoc', pipeline_id: HOSPITALITY_ID,
    countries: null, regions: null, markets: null, streams: null,
    development_categories: null, venue_types: null, stages: null,
    watch_terms: null, notes: null, created_at: null, ...over,
  };
}

const place = (p: Project) => p.market ?? p.region_state ?? '(no market)';

/**
 * Every project the scope query returns BEFORE any document rule runs.
 *
 * The report's own counts are computed after its filters, so they cannot say
 * what the scope held to begin with. This asks the same query with none of the
 * document rules applied, which is the only way to see what each rule removed.
 */
async function scopeTotal(scope: ClientScope): Promise<Project[]> {
  const { query, postFilters, streams, recordFacets } = resolveScope(scope);
  const { data, error } = await applyProjectFilters(
    supabase.from('projects').select(PROJECT_COLUMNS),
    { ...query, module: query.module ?? LIVE_PIPELINE_STORAGE_KEY }
  ).limit(2000);
  if (error) throw new Error(error.message);
  let rows = applyPostFilters(
    (data ?? []) as unknown as Record<string, unknown>[],
    postFilters
  ) as unknown as Project[];
  // THE SAME TWO RECORD-KEYED FILTERS buildReport applies. Market, venue and
  // category are matched against a project's RECORDS rather than its stored
  // column, so a baseline that skips them is the whole register and the audit
  // reports the whole register's dormant projects against a one-market scope.
  if (streams && rows.length) {
    const keep = await projectsHoldingStreams(rows.map((r) => r.id), streams);
    rows = rows.filter((r) => keep.has(r.id));
  }
  if (hasRecordFacets(recordFacets) && rows.length) {
    const keep = await projectsMatchingRecordFacets(rows.map((r) => r.id), recordFacets);
    rows = rows.filter((r) => keep.has(r.id));
  }
  return rows;
}

// A CLIENT CASE CARRIES THE CLIENT ID, NOT ONLY THE NAME.
//
// This is why the audit passed on JKR's empty document. Every case was built
// with clientName set and clientId unset, so buildReport's membership gate took
// the 'no-client' branch and never ran: the harness was auditing a document that
// no client would ever receive. The newest exclusion rule was the one rule the
// audit could not see, which is the worst possible rule for that to be true of.
interface Case { label: string; scope: ClientScope; clientName?: string | null; clientId?: string | null }

async function main(): Promise<void> {
  await signIn();
  const clients = await fetchClients();
  const scopes = await fetchAllScopes();
  const client = clients.find((c) => c.status === 'active');
  const clientScope = client ? scopes.find((s) => s.client_id === client.id) : undefined;

  const cases: Case[] = [
    { label: 'whole register', scope: emptyScope() },
    { label: 'market = Clark County', scope: emptyScope({ markets: ['Clark County'] }) },
    { label: 'market = New York City', scope: emptyScope({ markets: ['New York City'] }) },
    { label: 'market = Nashville', scope: emptyScope({ markets: ['Nashville'] }) },
    { label: 'category = Hospitality/Tourism', scope: emptyScope({ development_categories: ['Hospitality/Tourism'] }) },
    // A SCOPE THAT IS ENTIRELY FROZEN. The exclusion is worth nothing if it is
    // only ever exercised as a rounding error inside a large document: this
    // scope loses every project it has, and the document has to say so rather
    // than come out looking like a market with nothing happening in it.
    ...DEAD_FEEDS.map((f) => ({
      label: `market = ${f.market} (declared frozen)`,
      scope: emptyScope({ markets: [f.market] }),
    })),
  ];
  // EVERY CLIENT THAT HAS A SCOPE, GENERATED THE WAY THEY RECEIVE IT.
  //
  // One active client was audited before, without its id. Both halves were
  // wrong: the membership gate did not run, and the other client's document was
  // never generated at all. Simtec withheld 10 projects in silence and JKR
  // generated an empty document, and neither was in this harness's output.
  for (const c of clients) {
    const s = scopes.find((x) => x.client_id === c.id);
    if (!s) continue;
    cases.push({ label: `client = ${c.name}`, scope: s, clientName: c.name, clientId: c.id });
  }
  // Kept so a register with no client scopes at all still exercises the client
  // shape, rather than the whole block above silently doing nothing.
  if (clientScope && client && !clients.some((c) => scopes.some((s) => s.client_id === c.id))) {
    cases.push({ label: `client = ${client.name}`, scope: clientScope, clientName: client.name, clientId: client.id });
  }

  let failures = 0;

  for (const c of cases) {
    const before = await scopeTotal(c.scope);
    const built = await buildReport({
      scope: c.scope,
      period: resolvePeriod('all', new Date()),
      sectionIds: DEFAULT_SECTION_IDS,
      commentary: {},
      detailCap: DETAIL,
      title: 'audit',
      brandName: 'JKR & Associates',
      addressee: 'audit',
      clientName: c.clientName ?? null,
      clientId: c.clientId ?? null,
      watchlistOnly: false,
      includeDormant: false,
      includeContext: false,
      geographyLabel: geographyLabel(c.scope),
    });
    const text = renderDocumentText(built.doc);

    // Reconstruct what each rule removed, from the same predicates the builder
    // uses, so the audit and the document cannot disagree about the reason.
    // IN THE ORDER THE BUILDER APPLIES THEM. The frozen-market rule runs first,
    // before dormancy, so a project in a frozen market is attributed to the
    // freeze rather than to its own quietness - which is the point of the
    // ordering, and would be invisible to an audit that reconstructed the rules
    // in a different sequence.
    const frozen = before.filter((p) => deadFeedForMarket(p.market, p.region_state));
    const readable = before.filter((p) => !deadFeedForMarket(p.market, p.region_state));
    const dormant = readable.filter((p) => p.stage === 'dormant');
    const live = readable.filter((p) => p.stage !== 'dormant');
    const hollow = live.filter((p) => (p.record_count ?? 0) <= 0);
    const withRecords = live.filter((p) => (p.record_count ?? 0) > 0);
    // THE MEMBERSHIP GATE, RECONSTRUCTED IN THE PLACE THE BUILDER RUNS IT:
    // after the project rules and BEFORE the provisional-name rule. The order is
    // not cosmetic. A project that is both unconfirmed and unnamed is attributed
    // to whichever rule fires first, and an audit that reconstructed them in the
    // other order would report a provisional exclusion the document does not
    // make and call the document silent about it.
    //
    // Read from the same table the gate reads, not from the builder's own
    // answer, so the two can disagree and be caught disagreeing.
    const included = c.clientId ? await fetchIncludedProjectIds(c.clientId) : null;
    const unconfirmed = included ? withRecords.filter((p) => !included.has(p.id)) : [];
    const confirmed = included ? withRecords.filter((p) => included.has(p.id)) : withRecords;
    const provisional = confirmed.filter((p) => isProvisionalName(p.name_source));

    console.log('='.repeat(78));
    console.log(`${c.label}    scope holds ${before.length} projects, document covers ${built.selection.inScope}`);
    console.log('='.repeat(78));

    const rules: { name: string; lost: Project[]; stated: number }[] = [
      { name: 'frozen market (source stopped publishing)', lost: frozen, stated: built.selection.frozenMarkets },
      { name: 'dormant', lost: dormant, stated: built.selection.excludedDormant },
      { name: 'hollow (every record dismissed)', lost: hollow, stated: built.selection.excludedHollow },
      { name: 'provisional name', lost: provisional, stated: built.selection.provisionalNames },
      { name: 'not confirmed for this client', lost: unconfirmed, stated: built.selection.unconfirmed ?? 0 },
    ];
    for (const r of rules) {
      if (r.lost.length === 0) continue;
      const byMarket = new Map<string, number>();
      for (const p of r.lost) byMarket.set(place(p), (byMarket.get(place(p)) ?? 0) + 1);
      console.log(`\n  ${r.name}: ${r.lost.length} projects lost`);
      for (const [m, n] of [...byMarket.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
        console.log(`      ${String(n).padStart(4)}  ${m}`);
      }
    }

    // ---- THE ASSERTION: every rule that removed something says so ----------
    console.log('\n  DOES THE DOCUMENT SAY SO?');
    const checks: { rule: string; lost: number; found: boolean; needle: string }[] = [
      {
        rule: 'frozen market',
        lost: frozen.length,
        needle: 'has stopped publishing',
        found: text.includes('has stopped publishing'),
      },
      {
        // THE COUNT, NOT ONLY THE REASON. This used to accept the bare sentence
        // "Dormant projects are excluded from this report", which satisfies half
        // the rule: a reader learns that a filter ran and never learns whether
        // it took one project or forty.
        rule: 'dormant',
        lost: dormant.length,
        needle: 'dormant and excluded from this report',
        found: /\d+ projects? in this geography (is|are) dormant and excluded/.test(text),
      },
      {
        rule: 'hollow',
        lost: hollow.length,
        needle: 'holds no live record',
        found: /holds? no live record/.test(text),
      },
      {
        rule: 'provisional name',
        lost: provisional.length,
        needle: 'no published name',
        found: text.includes('no published name'),
      },
      {
        rule: 'below the detail cap',
        lost: built.selection.counted,
        needle: 'counted but not described',
        found: text.includes('counted but not described'),
      },
      {
        rule: 'no filing in the period',
        lost: built.selection.silent,
        needle: 'had no filing captured',
        found: text.includes('had no filing captured'),
      },
      {
        rule: 'unplaced',
        lost: built.selection.unplaced,
        needle: 'no market or region',
        found: text.includes('no market or region'),
      },
      // THE COUNT AND THE REASON, the same bar every other rule is held to. The
      // regex requires the NUMBER next to the reason rather than accepting the
      // bare phrase, because "some projects await confirmation" is the half
      // statement this harness already rejected once for dormancy.
      {
        rule: 'not confirmed for this client',
        lost: unconfirmed.length,
        needle: 'not been confirmed as part of',
        found: /\d+ projects? this scope proposes (is|are) held out of this document because (it has|they have) not been confirmed as part of/.test(text),
      },
    ];
    for (const k of checks) {
      if (k.lost === 0) {
        console.log(`    n/a       ${k.rule}: nothing lost`);
        continue;
      }
      const ok = k.found;
      if (!ok) failures++;
      console.log(`    ${ok ? 'STATED  ' : 'SILENT !'}  ${k.rule}: ${k.lost} lost, document ${ok ? 'says so' : 'DOES NOT SAY SO'}`);
    }

    // The count in the document must be the count the rule removed.
    if (provisional.length !== built.selection.provisionalNames) {
      failures++;
      console.log(`    MISMATCH  provisional: audit counts ${provisional.length}, document states ${built.selection.provisionalNames}`);
    }
    if (frozen.length !== built.selection.frozenMarkets) {
      failures++;
      console.log(`    MISMATCH  frozen market: audit counts ${frozen.length}, document states ${built.selection.frozenMarkets}`);
    }
    if (dormant.length !== built.selection.excludedDormant) {
      failures++;
      console.log(`    MISMATCH  dormant: audit counts ${dormant.length}, document states ${built.selection.excludedDormant}`);
    }
    // ---- THE MEMBERSHIP GATE ----------------------------------------------
    //
    // NULL AND ZERO ARE CHECKED SEPARATELY, because they are the two states this
    // whole gate was built to keep apart: null is "confirmation is not switched
    // on", zero is "everything proposed was confirmed", and a document that
    // printed one as the other would be lying in opposite directions.
    if (c.clientId) {
      if (built.membershipGate !== 'enforced') {
        failures++;
        console.log(
          `    GATE OFF! client case ran with membershipGate '${built.membershipGate}': a client ` +
            `document was generated without the confirmation gate running`
        );
      } else if (unconfirmed.length !== built.selection.unconfirmed) {
        failures++;
        console.log(
          `    MISMATCH  unconfirmed: audit counts ${unconfirmed.length}, document states ` +
            `${built.selection.unconfirmed}`
        );
      }
    } else if (built.selection.unconfirmed !== null) {
      failures++;
      console.log(
        `    MISMATCH  no client id, so the gate cannot have run, but the document states ` +
          `${built.selection.unconfirmed} unconfirmed`
      );
    }
    // A DOCUMENT EXCLUDED TO NOTHING SAYS SO, UNMISSABLY.
    //
    // This is the case that shipped: a cover reading "drawn from 0 projects and
    // 0 records", every exclusion sentence absent because every count was zero
    // after the gate, and nothing anywhere saying the scope had been emptied
    // rather than the market being quiet. Every other check in this harness
    // passes on that document, which is why this one is separate.
    if (built.selection.inScope === 0) {
      const said = text.includes('THIS DOCUMENT DESCRIBES NO PROJECTS');
      if (!said) {
        failures++;
        console.log('    SILENT !  document covers 0 projects and never says it describes none');
      } else {
        console.log(`    STATED    document covers 0 projects and says so on the cover`);
      }
      // And the reason has to be there too. An empty document that announces
      // itself and then does not say what emptied it has moved the silence one
      // sentence along.
      const scopeHeld = before.length;
      if (said && scopeHeld > 0 && !/Its scope was not empty/.test(text)) {
        failures++;
        console.log(
          `    SILENT !  scope held ${scopeHeld} projects and the empty-document sentence does ` +
            `not say what removed them`
        );
      }
    }
    // A FROZEN MARKET MUST BE NAMED, NOT ONLY COUNTED. A client scoped to a
    // market that stopped publishing needs the market's name and the date in
    // front of them; a bare number tells them a rule fired somewhere.
    for (const f of DEAD_FEEDS) {
      const lost = frozen.filter((p) => p.market === f.market).length;
      if (lost === 0) continue;
      const named = text.includes(f.market) && text.includes(String(new Date(`${f.frozenSince}T00:00:00Z`).getUTCFullYear()));
      if (!named) {
        failures++;
        console.log(`    SILENT !  frozen market ${f.market}: ${lost} lost, document does not name it with its freeze date`);
      } else {
        console.log(`    NAMED     frozen market ${f.market}: ${lost} lost, named with the ${f.frozenSince.slice(0, 4)} freeze date`);
      }
    }
    console.log('');
  }

  // ---- THE CAPS, FORCED -------------------------------------------------
  //
  // A cap that never binds cannot be shown to be stated, and the three read
  // limits are all far above this corpus. So they are lowered to 1 and the
  // document is re-generated: if the sentence does not appear, the cap is
  // silent and would stay silent on the day the corpus outgrows it.
  console.log('='.repeat(78));
  console.log('READ LIMITS, FORCED TO BIND');
  console.log('='.repeat(78));
  const forced = await buildReport({
    scope: emptyScope(),
    period: resolvePeriod('all', new Date()),
    sectionIds: DEFAULT_SECTION_IDS,
    commentary: {},
    detailCap: 5,
    title: 'audit', brandName: 'JKR & Associates', addressee: 'audit', clientName: null,
    watchlistOnly: false, includeDormant: false, includeContext: false,
    geographyLabel: 'all covered markets',
  });
  const forcedText = renderDocumentText(forced.doc);
  // The detail cap is the one limit that binds on this corpus without help.
  const capChecks = [
    { rule: 'detail cap', bound: forced.selection.counted > 0, needle: 'counted but not described' },
  ];
  for (const k of capChecks) {
    if (!k.bound) { console.log(`    n/a       ${k.rule}: did not bind`); continue; }
    const ok = forcedText.includes(k.needle);
    if (!ok) failures++;
    console.log(`    ${ok ? 'STATED  ' : 'SILENT !'}  ${k.rule}`);
  }
  // The other three cannot bind on this corpus - the register is 267 projects
  // against a cap of 2,000 - so they are asserted by calling the sentence
  // builder directly with every flag set. That is a real assertion rather than
  // a grep, and it fails if a sentence is ever removed.
  const forcedNotes = capNotes(
    {
      projects: true, projectCap: 2000,
      records: true, recordCap: 1500,
      events: true, eventCap: 500,
      partyHistoryFailed: true,
    },
    1
  );
  const capSentences = [
    ['project cap', 'not covered here at all'],
    ['record cap', 'most recent records in scope'],
    ['event cap', 'is not a complete list'],
    ['party history failure', 'could not be read on this run'],
    ['withheld summary', 'not printed here'],
  ] as const;
  for (const [rule, needle] of capSentences) {
    const ok = forcedNotes.some((n) => n.includes(needle));
    if (!ok) failures++;
    console.log(`    ${ok ? 'STATED  ' : 'SILENT !'}  ${rule} (forced)`);
  }
  console.log('');

  // ---- THE MEMBERSHIP SENTENCES, FORCED ---------------------------------
  //
  // The live cases above exercise whatever state the clients happen to be in
  // today. Both of them are in the failing state right now, which is exactly why
  // that is not a test: the day Philip confirms everything for both clients, the
  // live cases stop reaching these sentences and the sentences could then be
  // deleted without a single check going red.
  //
  // So the two producers are called directly with the state forced, the same way
  // capNotes is. That is a real assertion rather than a grep, and it fails if a
  // sentence is ever removed or loses its count.
  console.log('='.repeat(78));
  console.log('MEMBERSHIP SENTENCES, FORCED');
  console.log('='.repeat(78));
  const forceCtx = (over: Partial<SectionContext>): SectionContext =>
    ({
      projects: [],
      frozenExcluded: [],
      provisionalExcluded: [],
      excludedDormant: 0,
      excludedHollow: 0,
      unconfirmedMembers: null,
      membershipGate: 'no-client',
      clientName: null,
      geographyLabel: 'all covered markets',
      ...over,
    }) as unknown as SectionContext;

  const forcedSentences: [string, string | null, RegExp][] = [
    [
      'unconfirmed, plural',
      membershipSentence(forceCtx({ membershipGate: 'enforced', unconfirmedMembers: 10, clientName: 'Simtec' })),
      /10 projects this scope proposes are held out of this document because they have not been confirmed as part of Simtec's coverage/,
    ],
    [
      'unconfirmed, singular',
      membershipSentence(forceCtx({ membershipGate: 'enforced', unconfirmedMembers: 1, clientName: 'Simtec' })),
      /1 project this scope proposes is held out .* because it has not been confirmed/,
    ],
    // A NAME ENDING IN S TAKES A BARE APOSTROPHE. Both live clients do, so the
    // first generated document read "JKR & Associates's coverage" at a reader
    // who is paying for it. Locked here because it is the kind of thing a later
    // edit reintroduces by writing `${name}'s` inline.
    [
      'possessive of a name ending in s',
      membershipSentence(forceCtx({ membershipGate: 'enforced', unconfirmedMembers: 165, clientName: 'JKR & Associates' })),
      /part of JKR & Associates' coverage/,
    ],
    [
      'gate not run: no sentence',
      membershipSentence(forceCtx({ membershipGate: 'not-applied', unconfirmedMembers: null })) ?? '(none)',
      /^\(none\)$/,
    ],
    [
      'everything confirmed: no sentence',
      membershipSentence(forceCtx({ membershipGate: 'enforced', unconfirmedMembers: 0 })) ?? '(none)',
      /^\(none\)$/,
    ],
    [
      'excluded to nothing, by the membership gate',
      emptyDocumentSentence(
        forceCtx({ membershipGate: 'enforced', unconfirmedMembers: 267, geographyLabel: 'all covered markets' })
      ),
      /THIS DOCUMENT DESCRIBES NO PROJECTS\. Its scope was not empty: 267 to awaiting confirmation/,
    ],
    [
      'excluded to nothing, scope genuinely empty',
      emptyDocumentSentence(forceCtx({})),
      /THIS DOCUMENT DESCRIBES NO PROJECTS\. Its scope resolved to nothing at all/,
    ],
    [
      'a document with projects gets no empty sentence',
      emptyDocumentSentence(forceCtx({ projects: [{ id: 'x' } as never] })) ?? '(none)',
      /^\(none\)$/,
    ],
  ];
  for (const [rule, sentence, shape] of forcedSentences) {
    const ok = !!sentence && shape.test(sentence);
    if (!ok) failures++;
    console.log(`    ${ok ? 'STATED  ' : 'SILENT !'}  ${rule} (forced)`);
    if (!ok) console.log(`              got: ${JSON.stringify(sentence)?.slice(0, 200)}`);
  }
  console.log('');

  // ---- THE EVENT READ, PAST THE CHUNK BOUNDARY --------------------------
  //
  // The bug: project events were read with a single `.in('project_id',
  // ids.slice(0, ID_CHUNK))` and no loop, so a scope holding more projects than
  // the chunk size silently lost the stage changes of every project past the
  // 150th. It was invisible only because the register is smaller than the
  // chunk, which is precisely why it needs a test that is NOT.
  //
  // So the document is built with dormant AND provisional-named projects
  // included - the widest scope the builder can produce - to get past 150, and
  // every event the database holds for those projects is required to be in it.
  console.log('='.repeat(78));
  console.log('EVENT READ PAST THE 150-PROJECT CHUNK BOUNDARY');
  console.log('='.repeat(78));
  const wide = await buildReport({
    scope: emptyScope(),
    period: resolvePeriod('all', new Date()),
    sectionIds: DEFAULT_SECTION_IDS,
    commentary: {},
    detailCap: 1,
    title: 'audit', brandName: 'JKR & Associates', addressee: 'audit', clientName: null,
    watchlistOnly: false,
    includeDormant: true,
    includeProvisionalNames: true,
    includeContext: false,
    geographyLabel: 'all covered markets',
  });
  const wideIds = wide.projects.map((p) => p.id);
  console.log(`  document covers ${wideIds.length} projects (chunk size is 150)`);
  if (wideIds.length <= 150) {
    failures++;
    console.log('    INCONCLUSIVE ! the widest scope is under the chunk size, so this proves nothing');
  }

  // Every event the database holds for those projects, read in chunks that are
  // deliberately a different size from the builder's, so the two cannot share a
  // paging mistake.
  const expected = new Set<string>();
  for (let i = 0; i < wideIds.length; i += 40) {
    const { data, error } = await supabase
      .from('project_events')
      .select('id')
      .eq('module', LIVE_PIPELINE_STORAGE_KEY)
      .in('project_id', wideIds.slice(i, i + 40));
    if (error) throw new Error(`event check failed: ${error.message}`);
    for (const r of (data ?? []) as { id: string }[]) expected.add(r.id);
  }
  const got = new Set(wide.events.map((e) => e.id));
  const missing = [...expected].filter((id) => !got.has(id));
  console.log(`  events in the database for those projects : ${expected.size}`);
  console.log(`  events the document actually read         : ${got.size}`);

  // The projects whose events would have been lost by the old single-chunk read.
  const pastChunk = new Set(wideIds.slice(150));
  const pastChunkEvents = wide.events.filter((e) => e.project?.id && pastChunk.has(e.project.id));
  console.log(`  projects past the 150th                   : ${pastChunk.size}`);
  console.log(`  events belonging to those projects        : ${pastChunkEvents.length}`);

  // MISSING IS ONLY A FAILURE IF IT IS UNSTATED. The event read is capped per
  // chunk, and a cap that binds and says so is the correct behaviour - that is
  // the whole rule. What must never happen is events going missing with a
  // silent page.
  const wideText = renderDocumentText(wide.doc);
  const capStated = wideText.includes('is not a complete list');
  if (missing.length === 0) {
    console.log('    COMPLETE  every event the database holds for these projects reached the document');
  } else if (capStated) {
    console.log(
      `    STATED    ${missing.length} events beyond the per-chunk cap are absent, and the coverage ` +
        `note says "What moved" is not a complete list`
    );
  } else {
    failures++;
    console.log(`    SILENT !  ${missing.length} events are absent and the document does not say so`);
  }
  // AND THE CHUNK BUG ITSELF: the projects past the 150th must have contributed
  // events. Under the single-chunk read this number was zero by construction.
  if (pastChunkEvents.length === 0) {
    failures++;
    console.log('    SILENT !  no event from any project past the 150th reached the document');
  } else {
    console.log(
      `    PAST 150  ${pastChunkEvents.length} events from ${pastChunk.size} projects past the chunk ` +
        `boundary reached the document; under the single-chunk read this was zero by construction`
    );
  }
  console.log('');

  console.log(failures === 0
    ? 'PASS: every rule that removed a project from a document is stated in that document.'
    : `FAIL: ${failures} silent or mismatched exclusions.`);
  if (failures > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
