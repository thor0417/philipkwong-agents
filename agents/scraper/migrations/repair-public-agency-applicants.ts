// REPAIR: A PUBLIC AGENCY STORED AS A PROJECT'S primary_applicant.
//
//   npm run repair:agency-applicant              report only, writes nothing
//   npm run repair:agency-applicant -- --write   apply
//
// THE DEFECT. dashboard/lib/people gates the applicant and the presenter and
// both of those take a RECORD. `primary_applicant` is a column on the PROJECT,
// derived in cluster.ts as the mode of the member records' applicants, so an
// applicant the print end would refuse became a project-level party that
// nothing downstream re-examined. It is the third path by which NYC's
// Department of City Planning reached a party position, and the only one of the
// three that no record-level gate can see.
//
// The gate it walked through was `PUBLIC_AGENCY_APPLICANT_TYPES = {'other
// public agency'}`. ZAP states DCP's type as 'DCP' - an agency code rather than
// a class - so the test never fired. lib/applicant-type.ts now inverts it:
// 'Private' is the only stated value meaning "not a public body". See that file
// for why adding the code to a list would have been the wrong fix.
//
// WHY A REPAIR AND NOT JUST THE NEXT RUN. The column is derived and the next
// clustering pass would recompute it correctly. Waiting for that is the shape
// standing rule 11 names: a description of the work standing in for the work,
// with a client document in between. This closes it now and reads it back.
//
// WHAT IT CHANGES. projects.primary_applicant -> null, and ONLY where every
// record applicant behind it is a stated public agency. Null is the correct
// value: the records name no private applicant, and the honest negative is the
// answer. NOTHING IS DELETED - the applicant stays on every record and on the
// register's own columns, exactly as the print-end gate leaves it.
//
// A PROJECT WITH A MIXED SET IS REPORTED, NEVER GUESSED. Where some records
// name an agency and others name a private party, the mode is recomputed from
// the private ones alone, which is what the clusterer now does.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { applicantTypeIsPublicAgency } from '../../../lib/applicant-type';

const WRITE = process.argv.includes('--write');

interface Lead {
  id: string;
  project_id: string | null;
  status: string | null;
  applicant: string | null;
  applicant_type: string | null;
}
interface Proj {
  id: string;
  name: string;
  status: string | null;
  market: string | null;
  primary_applicant: string | null;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

/** The mode of a list, ignoring null and empty. The clusterer's rule. */
function modeOf(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) {
    const t = (v ?? '').trim();
    if (!t) continue;
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

async function main(): Promise<void> {
  const projects = await pageAll<Proj>('projects', 'id,name,status,market,primary_applicant');
  const leads = await pageAll<Lead>('leads', 'id,project_id,status,applicant,applicant_type');

  const byProject = new Map<string, Lead[]>();
  for (const l of leads) {
    if (l.status === 'dismissed' || !l.project_id) continue;
    const cur = byProject.get(l.project_id);
    if (cur) cur.push(l);
    else byProject.set(l.project_id, [l]);
  }

  console.log('===== REPAIR: A PUBLIC AGENCY AS A PROJECT PARTY =====');
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: report only, nothing is written\n');
  console.log(`projects: ${projects.length} (no cap, paged)`);
  console.log(`records:  ${leads.length}\n`);

  const changes: { p: Proj; next: string | null; agencies: string[] }[] = [];
  for (const p of projects) {
    if (!p.primary_applicant) continue;
    const recs = byProject.get(p.id) ?? [];
    const agencies = recs.filter((r) => applicantTypeIsPublicAgency(r.applicant_type));
    if (agencies.length === 0) continue;
    // Is the STORED value one of the agency applicants?
    const stored = p.primary_applicant.trim();
    if (!agencies.some((r) => (r.applicant ?? '').trim() === stored)) continue;
    const next = modeOf(
      recs.map((r) => (applicantTypeIsPublicAgency(r.applicant_type) ? null : r.applicant))
    );
    changes.push({ p, next, agencies: [...new Set(agencies.map((r) => `${r.applicant} [${r.applicant_type}]`))] });
  }

  if (changes.length === 0) {
    console.log('No project carries a stated public agency as its primary_applicant.');
    return;
  }

  console.log(`${changes.length} project(s) carry a stated public agency as primary_applicant:\n`);
  for (const c of changes) {
    console.log(`  [${c.p.status}] ${c.p.market ?? '(no market)'} :: ${c.p.name}`);
    console.log(`      now  : ${c.p.primary_applicant}`);
    console.log(`      after: ${c.next ?? '(null, and null is the correct answer: no record names a private applicant)'}`);
    for (const a of c.agencies) console.log(`      from : ${a}`);
  }

  if (!WRITE) {
    console.log('\nNothing was written. Re-run with --write to apply.');
    return;
  }

  let ok = 0;
  for (const c of changes) {
    const { error } = await supabaseAdmin
      .from('projects')
      .update({ primary_applicant: c.next })
      .eq('id', c.p.id);
    if (error) {
      console.warn(`  FAILED ${c.p.id}: ${error.message.slice(0, 90)}`);
      continue;
    }
    ok++;
  }
  console.log(`\nWROTE ${ok} of ${changes.length}.`);

  // STANDING RULE 11: read it back off the database, so a failed write fails the
  // run rather than producing the appearance of one.
  const after = await pageAll<Proj>('projects', 'id,name,primary_applicant');
  const byId = new Map(after.map((p) => [p.id, p]));
  let wrong = 0;
  for (const c of changes) {
    const got = byId.get(c.p.id)?.primary_applicant ?? null;
    const want = c.next;
    if ((got ?? null) !== (want ?? null)) {
      wrong++;
      console.error(`  READ BACK WRONG ${c.p.name}: expected ${want ?? 'null'}, got ${got ?? 'null'}`);
    }
  }
  if (wrong > 0) {
    console.error(`\n${wrong} project(s) did not read back as written.`);
    process.exit(1);
  }
  console.log('Read back: every change is on the database.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
