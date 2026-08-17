// REPAIR: A COUNTY OFFICER STORED AS THE APPLICANT ON A DEVELOPMENT MATTER.
//
//   npm run repair:petitioner              report only, writes nothing
//   npm run repair:petitioner -- --write   apply
//
// THE DEFECT. `PETITIONER` sat in legistar-attachments' OWNER_LABELS. Clark
// County's Board and Redevelopment Agency agendas use that word for the officer
// who BRINGS an item to the body, so the extractor read
//
//   PETITIONER: Denis Cederburg, Director of Public Works
//
// and stored a county Director of Public Works as the APPLICANT on a development
// matter. Five of the seven records it produced reach a live project, where the
// report prints "[RECORD] Denis Cederburg - applicant" with a link to a county
// document. A named party with a role the record does not give them is exactly
// what standing rule 1 forbids, and it shipped.
//
// The label has moved to PRESENTER_LABELS, which is what the word means here.
// This repairs what it already wrote.
//
// WHAT IT CHANGES, AND WHY EACH ONE.
//
//   leads.applicant        -> null. The document names no applicant. The honest
//                            negative is the answer, and the verbatim block in
//                            raw_content still says PETITIONER: <name>, so
//                            nothing is lost - it is correctly labelled instead
//                            of wrongly promoted.
//   leads.presented_by     -> the petitioner value, where the record has no
//                            presenter already. Who brought an item is worth
//                            keeping when it is labelled as that.
//   projects.primary_applicant -> recomputed as the mode of the project's
//                            remaining record applicants, which is exactly what
//                            the clusterer computes. Null when no record names
//                            one, which is the correct state for these three.
//   companies              -> TOMBSTONED IN PLACE, never deleted (standing rule
//                            6): company_type becomes 'government officer' and
//                            notes records why. A county officer is not a
//                            company and should not be sold as a player.
//   company_projects       -> the false `applicant` link becomes `presenter`.
//                            Where a presenter link already exists the role
//                            change would collide on the unique key, so that one
//                            duplicate is removed - it is a derived join row
//                            rebuilt by backfill-companies, not a record.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const WRITE = process.argv.includes('--write');
const BLOCK_MARK = '--- contacts from the matter documents ---';
const PETITIONER_LINE = /(?:^|\n)PETITIONER:\s*([^\n]+)/i;

interface Lead {
  id: string; title: string | null; url: string | null;
  applicant: string | null; presented_by: string | null; representative: string | null;
  raw_content: string | null; project_id: string | null; status: string | null;
  primary_document_url: string | null; source: string | null;
}
interface Proj {
  id: string; name: string; status: string | null; market: string | null;
  primary_applicant: string | null;
}

async function pageAll<T>(table: string, columns: string, eq?: [string, string]): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (eq) q = q.eq(eq[0], eq[1]);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

// The clusterer's own rule, so the recomputed value is the value a re-cluster
// would produce rather than a second opinion about it.
function modeOf(values: (string | null | undefined)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of counts) if (n > bestN) { best = v; bestN = n; }
  return best;
}

async function main(): Promise<void> {
  console.log('===== REPAIR: PETITIONER READ AS APPLICANT =====');
  console.log(WRITE ? 'MODE: WRITE\n' : 'MODE: report only, nothing is written\n');

  const leads = await pageAll<Lead>(
    'leads',
    'id,title,url,applicant,presented_by,representative,raw_content,project_id,status,primary_document_url,source'
  );
  const projects = await pageAll<Proj>('projects', 'id,name,status,market,primary_applicant');
  const projById = new Map(projects.map((p) => [p.id, p]));

  // WHAT THE LABEL INTRODUCED, read from the stored block rather than from the
  // applicant column. RE-RUNNABLE BY CONSTRUCTION, and it has to be: a first run
  // of this script was cut off by a pipe to `head`, which corrected two records
  // and left five. Keying the repair on the column it is repairing meant the
  // second run could no longer see the projects and companies the first run had
  // already half-fixed, and it silently declared itself finished. The block is
  // the evidence and the block does not change, so it is what everything below
  // keys on.
  const petitionerOf = (l: Lead): string | null => {
    const block = (l.raw_content ?? '').split(BLOCK_MARK)[1] ?? '';
    return PETITIONER_LINE.exec(block)?.[1].trim() ?? null;
  };
  const fromLabel = leads.filter((l) => l.status !== 'dismissed' && petitionerOf(l));
  const petitionerValues = new Set(fromLabel.map((l) => petitionerOf(l)!).filter(Boolean));

  // A record still needs correcting when its applicant IS what the label
  // introduced. A record whose applicant came from a real OWNER heading is not
  // touched even if the document also prints a petitioner.
  const affected = fromLabel.filter((l) => !!l.applicant && l.applicant.trim() === petitionerOf(l));

  console.log(`records whose contact block used PETITIONER : ${fromLabel.length}`);
  console.log(`  and whose applicant IS that value         : ${affected.length}\n`);

  // EVERY project the label ever touched, not only the ones a record still
  // points at. See the note above: a half-applied run leaves a corrected record
  // beside an uncorrected project, and only this set finds it.
  const touchedProjects = new Set<string>();
  for (const l of fromLabel) {
    const p = l.project_id ? projById.get(l.project_id) : null;
    if (p && p.status !== 'archived' && p.status !== 'deleted') touchedProjects.add(p.id);
  }

  console.log('--- every record it produced ---\n');
  for (const l of affected) {
    const value = petitionerOf(l) ?? '';
    const p = l.project_id ? projById.get(l.project_id) : null;
    const livePr = p && p.status !== 'archived' && p.status !== 'deleted' ? p : null;
    if (livePr) touchedProjects.add(livePr.id);
    console.log(`lead ${l.id}`);
    console.log(`  title           : ${(l.title ?? '').slice(0, 92)}`);
    console.log(`  reaches project : ${livePr ? `${livePr.name}  [${livePr.market}]` : '(no live project)'}`);
    console.log(`  applicant NOW   : ${l.applicant}`);
    console.log(`  applicant AFTER : null`);
    console.log(`  presenter NOW   : ${l.presented_by ?? 'null'}`);
    console.log(`  presenter AFTER : ${l.presented_by ?? value}`);
    console.log(`  document        : ${(l.primary_document_url ?? '').slice(0, 100)}`);
    console.log('');

    if (WRITE) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update({ applicant: null, presented_by: l.presented_by ?? value })
        .eq('id', l.id);
      if (error) throw new Error(`lead ${l.id}: ${error.message}`);
    }
  }

  // ---- the projects that carried it -----------------------------------------
  console.log('\n--- projects whose primary_applicant carried a county officer ---\n');
  const badProjects = projects.filter(
    (p) =>
      p.status !== 'archived' && p.status !== 'deleted' && p.primary_applicant &&
      petitionerValues.has(p.primary_applicant.trim())
  );
  for (const p of badProjects) touchedProjects.add(p.id);

  for (const pid of touchedProjects) {
    const p = projById.get(pid)!;
    const recs = leads.filter((l) => l.project_id === pid && l.status !== 'dismissed');
    const remaining = recs.map((l) => (affected.some((a) => a.id === l.id) ? null : l.applicant));
    const next = modeOf(remaining);
    console.log(`${p.name}  [${p.market}]`);
    console.log(`  primary_applicant NOW   : ${p.primary_applicant ?? 'null'}`);
    console.log(`  primary_applicant AFTER : ${next ?? 'null'}   (mode of ${recs.length} records)`);
    if (next === null && p.primary_applicant) {
      console.log('  NOTE: no record on this project names an applicant. Null is the correct state,');
      console.log('        and the entry will say so rather than name somebody.');
    }
    console.log('');
    if (WRITE && (p.primary_applicant ?? null) !== next) {
      const { error } = await supabaseAdmin.from('projects').update({ primary_applicant: next }).eq('id', pid);
      if (error) throw new Error(`project ${pid}: ${error.message}`);
    }
  }

  // ---- the companies table ---------------------------------------------------
  console.log('\n--- companies that are county officers ---\n');
  const companies = await pageAll<{ id: string; name: string; company_type: string | null; notes: string | null }>(
    'companies',
    'id,name,company_type,notes'
  );
  // MATCHED ON A PREFIX, NOT ON EQUALITY. The companies table stores a truncated
  // name - "Lisa Kremer, Deputy County Manager Dagny Stapleton" against the
  // lead's "...Dagny Stapleton, Community Housing Administrator" - so exact
  // equality found one of the two rows and left the other untouched and
  // untombstoned. The stored name is a prefix of what the label printed, and
  // that is what this tests.
  const badCompanies = companies.filter((c) => {
    const n = (c.name ?? '').trim();
    if (!n) return false;
    return [...petitionerValues].some((v) => v.startsWith(n) || n.startsWith(v));
  });
  const NOTE =
    'Tombstoned 2026-08-17: read from a Clark County PETITIONER label, which names the officer ' +
    'who brought the item to the body, not a party to the project. Kept rather than deleted so ' +
    'the false link can be accounted for.';

  for (const c of badCompanies) {
    const links = await pageAll<{ id: string; project_id: string; role: string }>(
      'company_projects',
      'id,project_id,role',
      ['company_id', c.id]
    );
    console.log(`${c.name.slice(0, 78)}`);
    console.log(`  company_type NOW   : ${c.company_type ?? 'null'}`);
    console.log(`  company_type AFTER : government officer`);
    for (const l of links) {
      const dup = links.some((o) => o.project_id === l.project_id && o.role === 'presenter');
      console.log(
        `  link role ${l.role.padEnd(10)} -> ${l.role === 'applicant' ? (dup ? 'REMOVED, a presenter link already exists' : 'presenter') : 'unchanged'}`
      );
    }
    console.log('');
    if (WRITE) {
      const { error } = await supabaseAdmin
        .from('companies')
        .update({ company_type: 'government officer', notes: NOTE })
        .eq('id', c.id);
      if (error) throw new Error(`company ${c.id}: ${error.message}`);
      for (const l of links) {
        if (l.role !== 'applicant') continue;
        const dup = links.some((o) => o.project_id === l.project_id && o.role === 'presenter');
        const { error: e2 } = dup
          ? await supabaseAdmin.from('company_projects').delete().eq('id', l.id)
          : await supabaseAdmin.from('company_projects').update({ role: 'presenter' }).eq('id', l.id);
        if (e2) throw new Error(`link ${l.id}: ${e2.message}`);
      }
    }
  }

  if (!WRITE) console.log('\nNothing was written. Re-run with --write to apply.');
  else console.log('\nApplied.');
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
