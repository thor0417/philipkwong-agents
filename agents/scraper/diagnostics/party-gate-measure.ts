// READ-ONLY. WHO IS PRINTED AS A PARTY TODAY, THROUGH WHICH COLUMN, AND WHAT A
// GATE WOULD COST.
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/party-gate-measure.ts
//
// Nothing is written. It calls the REAL buildParties and the REAL noPartiesNote
// out of dashboard/lib, for the same reason depth-ranking calls the real
// buildEntry: the question is what a client document PRINTS, and a count of
// stored columns answers a different one. An agents -> dashboard crossing,
// command line only, excluded from the root tsconfig by name.
//
// ---------------------------------------------------------------------------
// IT DOES NOT DECIDE WHO IS A GOVERNMENT BODY. IT COUNTS WHERE NAMES COME FROM.
// ---------------------------------------------------------------------------
//
// There is no name rule here and there must not be one: the repo already holds
// a golden case for a label read as the thing it names, and people.ts says in
// its own comment that a name-shape rule would be that defect with better
// manners. So this measures by COLUMN and by STREAM, which are facts about how
// a value arrived, and prints the distinct values so a reader can see for
// themselves what is in them rather than trusting a classifier.
//
// The one exception is `applicant_type`, which is not an inference: it is what
// the source publishes, and only ZAP publishes it.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isHospitalityModule } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';
import {
  applicantIsPublicAgency,
  buildParties,
  noPartiesNote,
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

const tidy = (s: string | null | undefined) => String(s ?? '').replace(/\s+/g, ' ').trim();

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

  // ---- 1. WHERE A PRINTED PARTY'S NAME CAME FROM ----------------------------
  //
  // Counted on the records of live projects, by column, and split by the one
  // thing that is a fact rather than a reading: the stream that captured the
  // row. `government` means we read a government body's own record of a matter.
  const col = {
    applicantTyped: 0,
    applicantUntyped: 0,
    representative: 0,
    presentedByGov: 0,
    presentedByOther: 0,
    contactFiling: 0,
    contactPress: 0,
  };
  const presentedValues = new Map<string, { n: number; streams: Set<string>; sources: Set<string> }>();
  let liveRecords = 0;

  for (const p of live) {
    for (const r of byProject.get(p.id) ?? []) {
      if (!r.url) continue;
      liveRecords++;
      const gov = (r.stream ?? '') === 'government';
      if (tidy(r.applicant)) {
        if (applicantIsPublicAgency(r)) col.applicantTyped++;
        else col.applicantUntyped++;
      }
      if (tidy(r.representative)) col.representative++;
      const pb = tidy(r.presented_by);
      if (pb) {
        if (gov) col.presentedByGov++;
        else col.presentedByOther++;
        if (!presentedValues.has(pb)) {
          presentedValues.set(pb, { n: 0, streams: new Set(), sources: new Set() });
        }
        const v = presentedValues.get(pb)!;
        v.n++;
        v.streams.add(r.stream ?? '(null)');
        v.sources.add(r.source ?? '(null)');
      }
      if (tidy(r.contact_name)) {
        if (gov) col.contactFiling++;
        else col.contactPress++;
      }
    }
  }

  console.log('='.repeat(100));
  console.log(`WHERE A PARTY'S NAME ARRIVES   ${live.length} live projects, ${liveRecords} records with a url`);
  console.log('='.repeat(100));
  console.log(`  applicant, source states 'other public agency'  ${String(col.applicantTyped).padStart(5)}   ALREADY GATED`);
  console.log(`  applicant, source states no type                ${String(col.applicantUntyped).padStart(5)}   ungated, and null is not private`);
  console.log(`  representative                                  ${String(col.representative).padStart(5)}   ungated`);
  console.log(`  presented_by on a GOVERNMENT record             ${String(col.presentedByGov).padStart(5)}   ungated`);
  console.log(`  presented_by on any other stream                ${String(col.presentedByOther).padStart(5)}   ungated`);
  console.log(`  contact_name on a government record             ${String(col.contactFiling).padStart(5)}   ungated`);
  console.log(`  contact_name on press                           ${String(col.contactPress).padStart(5)}   ungated (prints as press-named)`);

  // ---- 2. WHAT presented_by ACTUALLY HOLDS ---------------------------------
  //
  // Printed in full rather than summarised, because the whole argument for
  // gating this column is that the column ANSWERS A DIFFERENT QUESTION - who in
  // government moved this item - and the only honest way to show that is to let
  // a reader look at every value in it.
  console.log('');
  console.log('-'.repeat(100));
  console.log(`EVERY DISTINCT presented_by VALUE ON A LIVE PROJECT (${presentedValues.size} of them)`);
  console.log('-'.repeat(100));
  for (const [name, v] of [...presentedValues.entries()].sort((a, b) => b[1].n - a[1].n)) {
    console.log(
      `  ${String(v.n).padStart(3)}  ${[...v.streams].join(',').padEnd(14)} ${[...v.sources].join(',').slice(0, 22).padEnd(23)} ${name.slice(0, 52)}`
    );
  }

  // ---- 3. WHAT THE PAGE SHOWS, AND WHAT A GATE WOULD COST -------------------
  //
  // buildParties is called twice: once as it stands, and once over records whose
  // presented_by has been blanked on the government stream. The second is not a
  // proposal about names - it removes a COLUMN on a STREAM - and the difference
  // between the two is the exact cost of the rule.
  let printsPresenterOnly = 0;
  let losesEveryParty = 0;
  let losesSome = 0;
  const wouldEmpty: { name: string; market: string | null; had: string[] }[] = [];

  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const before = buildParties(p, records);
    const gated = records.map((r) =>
      (r.stream ?? '') === 'government' ? { ...r, presented_by: null } : r
    );
    const after = buildParties(p, gated);
    if (before.length === after.length) continue;
    losesSome++;
    // A party whose ONLY role is 'presented by' is one this column alone put on
    // the page.
    if (before.some((x) => x.roles.length === 1 && x.roles[0] === 'presented by')) {
      printsPresenterOnly++;
    }
    if (after.length === 0) {
      losesEveryParty++;
      wouldEmpty.push({
        name: p.name,
        market: p.market,
        had: before.map((x) => `${x.name} (${x.roles.join(', ')})`),
      });
    }
  }

  console.log('');
  console.log('-'.repeat(100));
  console.log('WHAT GATING presented_by ON THE GOVERNMENT STREAM WOULD DO');
  console.log('-'.repeat(100));
  console.log(`  live projects whose printed party list changes at all:      ${losesSome}`);
  console.log(`  of those, at least one party printed ONLY as 'presented by': ${printsPresenterOnly}`);
  console.log(`  live projects that would print NO party at all afterwards:  ${losesEveryParty}`);
  console.log('');
  console.log('  THE ONES THAT WOULD EMPTY, and everything they print today:');
  for (const w of wouldEmpty) {
    console.log(`    ${w.name.slice(0, 44).padEnd(44)} ${String(w.market ?? '-').slice(0, 16).padEnd(16)} ${w.had.join(' | ').slice(0, 90)}`);
  }

  // ---- 4. THE SENTENCE THAT WOULD STAND IN ITS PLACE ------------------------
  //
  // noPartiesNote as it is TODAY, over the gated record set. If it says the
  // filings do not identify who is behind the matter while we are holding a
  // name back, it is false in exactly the way the applicant branch of that
  // function was written to prevent.
  console.log('');
  console.log('-'.repeat(100));
  console.log("WHAT TODAY'S noPartiesNote WOULD PRINT ON EACH OF THOSE, AGAINST THE GATED SET");
  console.log('-'.repeat(100));
  for (const p of live) {
    const records = (byProject.get(p.id) ?? []).filter((r) => !!r.url);
    if (records.length === 0) continue;
    const gated = records.map((r) =>
      (r.stream ?? '') === 'government' ? { ...r, presented_by: null } : r
    );
    if (buildParties(p, gated).length > 0) continue;
    if (buildParties(p, records).length === 0) continue;
    console.log(`\n  ${p.name.slice(0, 60)}`);
    console.log(`    ${noPartiesNote(gated)}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
