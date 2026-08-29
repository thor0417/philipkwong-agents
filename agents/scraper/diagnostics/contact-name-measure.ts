// READ-ONLY. WHO IS IN contact_name ON A GOVERNMENT FILING, AND CAN A DOMAIN
// TELL THEM APART?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/contact-name-measure.ts
//
// Nothing is written and nothing is proposed. It calls the REAL buildParties, so
// what it counts is what a client document prints. Excluded from the root
// tsconfig by name, like the other three crossings.
//
// ---------------------------------------------------------------------------
// THE QUESTION, AND WHY IT IS NOT THE SAME QUESTION presented_by ANSWERED.
// ---------------------------------------------------------------------------
//
// presented_by was settled by the column and the stream: 92 records, 47 distinct
// values, every one a government body, zero on any other stream. No name was
// read and none needed to be.
//
// contact_name is NOT that. It is genuinely mixed on the same column and the
// same stream: Anaheim's is Lisandro Orozco at lorozco@anaheim.net, a planner,
// and Heart Hotel's is Nancy Amundsen of Brown, Brown & Premsrirut, a private
// lawyer who is exactly the person a referral exists to name. A column rule
// would take both.
//
// So the question is whether something ADJACENT to the column separates them:
// the email domain the source itself published. A domain is not a name-shape
// rule - it is a fact the filing states about where to write - which is why it
// is worth measuring before it is dismissed.
//
// IT ONLY COUNTS. It does not decide who is staff. Every distinct value is
// printed in full so a reader can look, exactly as the presented_by census did,
// and the domain tally is reported beside the values rather than applied to
// them.
//
// THE COST SIDE MATTERS MORE THAN USUAL. Ten of 155 live projects carry a
// contact detail at all, so a rule that removes one removes a tenth of the
// reachable corpus. The last section counts precisely that.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isHospitalityModule } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';
import { buildParties } from '../../../dashboard/lib/people';
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

const tidy = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();
const domainOf = (e: string | null | undefined) => {
  const at = tidy(e).toLowerCase().split('@')[1];
  return at ? at.replace(/[>,;].*$/, '').trim() : '';
};

// isFiling, mirrored to the one fact this needs: the stream. Nothing here reads
// a name and nothing here decides who is government.
const isGovStream = (r: TimelineRecord) => (r.stream ?? '') === 'government';

interface Row {
  name: string;
  project: string;
  market: string | null;
  source: string;
  stream: string;
  email: string;
  phone: string;
  /** Does the party layer print this person, and under which roles? */
  printedRoles: string[];
  /** The firm the record gives alongside the name, where it gives one. */
  firm: string | null;
}

async function main(): Promise<void> {
  const projects = await pageAll<Project>('projects', PROJECT_COLUMNS);
  const live = projects
    .filter((p) => isHospitalityModule(p.module))
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

  const rows: Row[] = [];
  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const parties = buildParties(p, records);
    for (const r of records) {
      const cn = tidy(r.contact_name);
      if (!cn || !isGovStream(r)) continue;
      const printed = parties.find(
        (x) => x.name.toLowerCase().includes(cn.toLowerCase()) || cn.toLowerCase().includes(x.name.toLowerCase())
      );
      rows.push({
        name: cn,
        project: p.name,
        market: p.market,
        source: r.source ?? '(null)',
        stream: r.stream ?? '(null)',
        email: tidy(r.contact_email),
        phone: tidy(r.contact_phone),
        printedRoles: printed?.roles ?? [],
        firm: printed?.firm ?? null,
      });
    }
  }

  console.log('='.repeat(104));
  console.log(`contact_name ON GOVERNMENT FILINGS   ${rows.length} records across ${live.length} live projects`);
  console.log('='.repeat(104));
  const withEmail = rows.filter((r) => r.email);
  const withPhone = rows.filter((r) => r.phone);
  console.log(`  records carrying an email:  ${withEmail.length}`);
  console.log(`  records carrying a phone:   ${withPhone.length}`);
  console.log(`  records carrying NEITHER:   ${rows.filter((r) => !r.email && !r.phone).length}`);
  console.log('');

  // ---- 1. EVERY DISTINCT VALUE, IN FULL -------------------------------------
  const byName = new Map<string, Row[]>();
  for (const r of rows) {
    if (!byName.has(r.name)) byName.set(r.name, []);
    byName.get(r.name)!.push(r);
  }
  console.log('-'.repeat(104));
  console.log(`EVERY DISTINCT contact_name VALUE (${byName.size} of them)`);
  console.log('-'.repeat(104));
  console.log('    n  source           stream       email domain          firm on the party  name');
  for (const [name, rs] of [...byName.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const sources = [...new Set(rs.map((r) => r.source))].join(',');
    const streams = [...new Set(rs.map((r) => r.stream))].join(',');
    const domains = [...new Set(rs.map((r) => domainOf(r.email)).filter(Boolean))].join(',') || '(no email)';
    const firm = rs.find((r) => r.firm)?.firm ?? '-';
    console.log(
      `  ${String(rs.length).padStart(3)}  ${sources.slice(0, 15).padEnd(16)} ${streams.slice(0, 11).padEnd(12)} ` +
        `${domains.slice(0, 20).padEnd(21)} ${String(firm).slice(0, 17).padEnd(18)} ${name.slice(0, 40)}`
    );
  }

  // ---- 2. THE DOMAIN TALLY --------------------------------------------------
  console.log('');
  console.log('-'.repeat(104));
  console.log('EMAIL DOMAIN, COUNTED');
  console.log('-'.repeat(104));
  const byDomain = new Map<string, Row[]>();
  for (const r of rows) {
    const d = domainOf(r.email) || '(no email on the record)';
    if (!byDomain.has(d)) byDomain.set(d, []);
    byDomain.get(d)!.push(r);
  }
  for (const [d, rs] of [...byDomain.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const names = [...new Set(rs.map((r) => r.name))];
    console.log(`  ${String(rs.length).padStart(3)}  ${d.padEnd(28)} ${names.slice(0, 3).join('; ').slice(0, 60)}${names.length > 3 ? ` (+${names.length - 3})` : ''}`);
  }

  // ---- 3. WHAT GATING WOULD COST -------------------------------------------
  //
  // The party layer, run twice: as it stands, and with contact_name blanked on
  // government filings. The cost is counted in PROJECTS THAT LOSE THEIR ONLY
  // CONTACT DETAIL, because that is the thing there are only ten of.
  console.log('');
  console.log('-'.repeat(104));
  console.log('WHAT GATING contact_name ON GOVERNMENT FILINGS WOULD COST');
  console.log('-'.repeat(104));
  let hadContact = 0;
  const losesOnly: { name: string; market: string | null; detail: string }[] = [];
  let losesAParty = 0;
  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const before = buildParties(p, records);
    const beforeContacts = before.filter((x) => !!x.contact);
    if (beforeContacts.length > 0) hadContact++;
    const gated = records.map((r) => (isGovStream(r) ? { ...r, contact_name: null } : r));
    const after = buildParties(p, gated);
    if (after.length !== before.length) losesAParty++;
    const afterContacts = after.filter((x) => !!x.contact);
    if (beforeContacts.length > 0 && afterContacts.length === 0) {
      losesOnly.push({
        name: p.name,
        market: p.market,
        detail: beforeContacts
          .map((c) => `${c.name} <${[c.contact?.email, c.contact?.phone].filter(Boolean).join(' ')}>`)
          .join(' | '),
      });
    }
  }
  console.log(`  live projects carrying ANY contact detail today: ${hadContact}`);
  console.log(`  of those, projects that would lose EVERY one:    ${losesOnly.length}`);
  console.log(`  live projects losing at least one party:         ${losesAParty}`);
  console.log('');
  for (const l of losesOnly) {
    console.log(`    ${l.name.slice(0, 40).padEnd(40)} ${String(l.market ?? '-').slice(0, 16).padEnd(16)} ${l.detail.slice(0, 70)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
