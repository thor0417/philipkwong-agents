// READ-ONLY. HOW MANY PARTIES ARE STAFF OF THE BODY DECIDING THE MATTER?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/staff-party-reach.ts
//
// Nothing is written and nothing is gated. It calls the REAL buildParties out of
// dashboard/lib, because the question is what a CLIENT DOCUMENT PRINTS and a
// count of stored columns answers a different one. An agents -> dashboard
// crossing, command line only, excluded from the root tsconfig by name.
//
// ---------------------------------------------------------------------------
// IT READS NO NAMES. IT COMPARES TWO HOSTS.
// ---------------------------------------------------------------------------
//
// The signal is the mailbox the FILING ITSELF PUBLISHES for the person, against
// the host of the record we captured them from. Both are facts about how the
// value arrived, which is the standard the presenter gate meets and the standard
// a name list fails: this repo carries a golden case for a label read as the
// thing it names, and dashboard/lib/people says in its own comment that a
// name-shape rule here would be that defect with better manners.
//
// Three candidate signals are counted SEPARATELY and none is applied, so the
// rule can be chosen from the numbers rather than from a guess:
//
//   A  the AGENCY_HOST test the capture end already uses (contact-labels
//      isPartyEmail), which answers "may this mailbox be attributed to a party"
//   B  the email host shares a registrable domain with the record's own URL
//   C  either of the above
//
// The residue - parties that are plainly government and carry no email at all -
// is counted at the end, because a rule that cannot see them is not a rule that
// has handled them.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { isPartyEmail } from '../sources/contact-labels';
import {
  buildParties,
  contactIsDecidingBodyStaff,
  printableParties,
  staffParties,
} from '../../../dashboard/lib/people';
import type { Project, TimelineRecord } from '../../../dashboard/lib/projects';

const PROJECT_COLUMNS =
  'id,module,name,project_key,country,region_state,market,stage,development_category,' +
  'venue_type,status,watch,notes,manual_overrides,first_seen,last_activity,next_milestone,' +
  'record_count,primary_applicant,primary_representative,created_at,summary,summary_source,' +
  'summary_url,name_source,significance,significance_detail,significance_computed_at,' +
  'stage_press_reported';

const RECORD_COLUMNS =
  'id,title,url,source,source_type,published_date,deadline,first_seen,date_source,' +
  'cluster_reason,status,applicant,representative,presented_by,action_sought,' +
  'contact_name,contact_email,contact_phone,primary_document_url,project_id,market,stream,' +
  'applicant_type,press_facts,filing_facts';

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

const tidy = (s: string | null | undefined): string => String(s ?? '').replace(/\s+/g, ' ').trim();

function emailHost(raw: string | null | undefined): string {
  const m = tidy(raw).toLowerCase().match(/[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/);
  return m ? m[1] : '';
}

function urlHost(raw: string | null | undefined): string {
  try {
    return new URL(String(raw)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
}

/** The last two labels of a host. Crude on purpose: this only counts. */
function registrable(host: string): string {
  const parts = host.split('.').filter(Boolean);
  return parts.length <= 2 ? host : parts.slice(-2).join('.');
}

interface Hit {
  name: string;
  email: string;
  emailHost: string;
  recordHost: string;
  market: string;
  project: string;
  source: string;
  signalA: boolean;
  signalB: boolean;
}

// Crude and deliberately visible. Used ONLY to size the residue a mailbox rule
// cannot see, never to gate anything. Same standing as agency-party-probe.
const AGENCY_WORD =
  /\b(department|dept\.?|authority|commission|agency|bureau|board of|county of|city of|councilman|councilwoman|councilmember|borough president|deputy mayor|redevelopment agency|housing authority|port authority|planning division)\b/i;

async function main(): Promise<void> {
  const projects = await pageAll<Project>('projects', PROJECT_COLUMNS);
  const live = projects
    .filter((p) => p.module === LIVE_PIPELINE_STORAGE_KEY)
    .filter((p) => p.status !== 'dismissed')
    .filter((p) => inCorpusScope(p.country))
    .filter((p) => p.stage !== 'dormant');

  const leads = await pageAll<TimelineRecord & { project_id: string | null }>('leads', RECORD_COLUMNS);
  const byProject = new Map<string, TimelineRecord[]>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }

  const hits: Hit[] = [];
  const residue: { name: string; market: string; project: string; column: string }[] = [];
  let partiesPrinted = 0;
  const projectsWithParties = new Set<string>();

  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const parties = buildParties(p, records);
    partiesPrinted += parties.length;
    if (parties.length) projectsWithParties.add(p.id);

    for (const r of records) {
      const cn = tidy(r.contact_name);
      if (!cn) continue;
      const eh = emailHost(r.contact_email);
      const rh = urlHost(r.url);
      if (!eh) {
        if (AGENCY_WORD.test(cn)) {
          residue.push({ name: cn, market: p.market ?? '(none)', project: p.name, column: 'contact_name' });
        }
        continue;
      }
      hits.push({
        name: cn,
        email: tidy(r.contact_email),
        emailHost: eh,
        recordHost: rh,
        market: p.market ?? '(none)',
        project: p.name,
        source: r.source ?? '(null)',
        signalA: !isPartyEmail(`x@${eh}`),
        signalB: !!rh && registrable(eh) === registrable(rh),
      });
    }

    // The residue in the other party columns, sized the same crude way.
    for (const r of records) {
      for (const col of ['applicant', 'representative'] as const) {
        const v = tidy((r as unknown as Record<string, string | null>)[col]);
        if (v && AGENCY_WORD.test(v)) {
          residue.push({ name: v, market: p.market ?? '(none)', project: p.name, column: col });
        }
      }
    }
  }

  console.log('='.repeat(110));
  console.log('STAFF OF THE DECIDING BODY: REACH, CORPUS-WIDE');
  console.log('='.repeat(110));
  console.log(`  live projects                       : ${live.length}`);
  console.log(`  live projects printing any party    : ${projectsWithParties.size}`);
  console.log(`  parties printed today               : ${partiesPrinted}`);
  console.log(`  records carrying a contact mailbox  : ${hits.length}`);
  console.log('');

  console.log('-'.repeat(110));
  console.log('EVERY MAILBOX, WITH BOTH SIGNALS');
  console.log('-'.repeat(110));
  console.log('   A  B  market            email host            record host           name');
  for (const h of hits.slice().sort((a, b) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name))) {
    console.log(
      `   ${h.signalA ? 'Y' : '.'}  ${h.signalB ? 'Y' : '.'}  ${h.market.slice(0, 16).padEnd(17)} ` +
        `${h.emailHost.slice(0, 21).padEnd(22)}${h.recordHost.slice(0, 21).padEnd(22)}${h.name.slice(0, 34)}`
    );
  }

  console.log('');
  console.log('-'.repeat(110));
  console.log('WHAT EACH SIGNAL WOULD MARK, PER MARKET');
  console.log('-'.repeat(110));
  const markets = [...new Set(hits.map((h) => h.market))].sort();
  console.log('  market              mailboxes   A only   B only   A or B   distinct people (A or B)');
  for (const m of markets) {
    const rs = hits.filter((h) => h.market === m);
    const a = rs.filter((h) => h.signalA);
    const b = rs.filter((h) => h.signalB);
    const either = rs.filter((h) => h.signalA || h.signalB);
    const people = new Set(either.map((h) => h.name.toLowerCase()));
    console.log(
      `  ${m.slice(0, 18).padEnd(19)} ${String(rs.length).padStart(9)} ${String(a.length).padStart(8)} ` +
        `${String(b.length).padStart(8)} ${String(either.length).padStart(8)}   ${people.size}`
    );
  }
  const allEither = hits.filter((h) => h.signalA || h.signalB);
  console.log(
    `  ${'TOTAL'.padEnd(19)} ${String(hits.length).padStart(9)} ` +
      `${String(hits.filter((h) => h.signalA).length).padStart(8)} ` +
      `${String(hits.filter((h) => h.signalB).length).padStart(8)} ` +
      `${String(allEither.length).padStart(8)}   ${new Set(allEither.map((h) => h.name.toLowerCase())).size}`
  );

  console.log('');
  console.log('-'.repeat(110));
  console.log('THE MAILBOXES NEITHER SIGNAL MARKS, IN FULL');
  console.log('-'.repeat(110));
  const unmarked = hits.filter((x) => !x.signalA && !x.signalB);
  for (const h of unmarked) {
    console.log(`  ${h.market.padEnd(18)} ${h.emailHost.padEnd(24)} ${h.name}`);
  }
  if (unmarked.length === 0) console.log('  none');

  // ---- AND THE RULE AS SHIPPED, RUN OVER THE SAME CORPUS -------------------
  //
  // Not signal A and not signal B: the REAL contactIsDecidingBodyStaff, so what
  // is counted here is what a client document stops printing.
  console.log('');
  console.log('-'.repeat(110));
  console.log('THE RULE AS SHIPPED: WHAT A DOCUMENT STOPS PRINTING, PER MARKET');
  console.log('-'.repeat(110));
  const perMarket = new Map<string, { before: number; after: number; held: Set<string>; lost: number; emptied: number }>();
  const heldNames: { market: string; project: string; name: string }[] = [];
  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const all = buildParties(p, records);
    const printable = printableParties(all);
    const held = staffParties(all);
    const m = p.market ?? '(none)';
    if (!perMarket.has(m)) perMarket.set(m, { before: 0, after: 0, held: new Set(), lost: 0, emptied: 0 });
    const acc = perMarket.get(m)!;
    acc.before += all.length;
    acc.after += printable.length;
    for (const h of held) {
      acc.held.add(h.name.toLowerCase());
      heldNames.push({ market: m, project: p.name, name: h.name });
    }
    if (held.length > 0) acc.lost++;
    if (held.length > 0 && printable.length === 0 && all.length > 0) acc.emptied++;
  }
  console.log('  market              parties before   after   people held   projects touched   blocks emptied');
  let tb = 0, ta = 0, tl = 0, te = 0;
  const heldTotal = new Set<string>();
  for (const [m, a] of [...perMarket.entries()].sort()) {
    tb += a.before; ta += a.after; tl += a.lost; te += a.emptied;
    for (const n of a.held) heldTotal.add(n);
    if (a.held.size === 0) continue;
    console.log(
      `  ${m.slice(0, 18).padEnd(19)} ${String(a.before).padStart(14)} ${String(a.after).padStart(7)} ` +
        `${String(a.held.size).padStart(13)} ${String(a.lost).padStart(18)} ${String(a.emptied).padStart(16)}`
    );
  }
  console.log('  ---- markets the rule does not touch at all ----');
  for (const [m, a] of [...perMarket.entries()].sort()) {
    if (a.held.size > 0) continue;
    console.log(`  ${m.slice(0, 18).padEnd(19)} ${String(a.before).padStart(14)} ${String(a.after).padStart(7)}              0                  0                0`);
  }
  console.log(
    `  ${'TOTAL'.padEnd(19)} ${String(tb).padStart(14)} ${String(ta).padStart(7)} ` +
      `${String(heldTotal.size).padStart(13)} ${String(tl).padStart(18)} ${String(te).padStart(16)}`
  );

  console.log('');
  console.log('  EVERY NAME THE RULE HOLDS BACK, IN FULL:');
  for (const h of heldNames.sort((a, b) => a.market.localeCompare(b.market) || a.name.localeCompare(b.name))) {
    console.log(`    ${h.market.padEnd(16)} ${h.name.padEnd(24)} ${h.project.slice(0, 46)}`);
  }
  console.log('');
  console.log(`  contactIsDecidingBodyStaff fires on ${
    live.flatMap((p) => byProject.get(p.id) ?? []).filter((r) => contactIsDecidingBodyStaff(r)).length
  } records of the ${hits.length} carrying a mailbox.`);

  console.log('');
  console.log('-'.repeat(110));
  console.log('THE RESIDUE NO MAILBOX RULE CAN SEE (agency-shaped names carrying no email)');
  console.log('CRUDE WORD MATCH. Sizing only, never a gate.');
  console.log('-'.repeat(110));
  const byMarketResidue = new Map<string, Set<string>>();
  for (const r of residue) {
    if (!byMarketResidue.has(r.market)) byMarketResidue.set(r.market, new Set());
    byMarketResidue.get(r.market)!.add(`${r.column}: ${r.name}`);
  }
  for (const [m, set] of [...byMarketResidue.entries()].sort((a, b) => b[1].size - a[1].size)) {
    console.log(`  ${m.padEnd(18)} ${String(set.size).padStart(3)}`);
    for (const v of [...set].sort().slice(0, 8)) console.log(`      ${v.slice(0, 90)}`);
    if (set.size > 8) console.log(`      (+${set.size - 8} more)`);
  }
  if (residue.length === 0) console.log('  none');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
