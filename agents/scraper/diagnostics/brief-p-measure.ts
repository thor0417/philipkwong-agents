// BRIEF P, PARTS 4, 6, 7, 8 AND 9: THE NUMBERS, BEFORE ANY OF IT IS BUILT.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/brief-p-measure.ts
//
// READ-ONLY. Nothing is written, no column is added, no name is invented. Each
// part of the brief says "report, then propose, then build", and this is the
// report. A rule proposed without the count behind it is a preference.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(0)}%` : '-');
const rule = (t: string) => { console.log('\n' + '='.repeat(78)); console.log(t); console.log('='.repeat(78)); };

async function pageAll<T>(table: string, columns: string, filter?: (q: any) => any): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    let q = supabaseAdmin.from(table).select(columns).range(from, from + 999);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 1000) break;
  }
  return out;
}

interface Lead {
  id: string; title: string | null; action_sought: string | null; source: string | null;
  published_date: string | null; first_seen: string | null; project_id: string | null;
  status: string | null; applicant: string | null; representative: string | null;
  presented_by: string | null; contact_name: string | null; stream: string | null;
}
interface Project {
  id: string; name: string; status: string | null; stage: string | null;
  summary: string | null; summary_source: string | null; market: string | null;
  record_count: number | null;
}

async function main(): Promise<void> {
  const projects = await pageAll<Project>(
    'projects', 'id,name,status,stage,summary,summary_source,market,record_count'
  );
  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted' && p.stage !== 'dormant');
  const leads = await pageAll<Lead>(
    'leads',
    'id,title,action_sought,source,published_date,first_seen,project_id,status,applicant,representative,presented_by,contact_name,stream'
  );
  const liveLeads = leads.filter((l) => l.status !== 'dismissed');
  const byProject = new Map<string, Lead[]>();
  for (const l of liveLeads) {
    if (!l.project_id) continue;
    if (!byProject.has(l.project_id)) byProject.set(l.project_id, []);
    byProject.get(l.project_id)!.push(l);
  }
  console.log(`corpus: ${projects.length} projects (${live.length} live), ${liveLeads.length} live records`);

  // ---- PART 4: HOW THE DESCRIPTION RECORD IS CHOSEN -------------------------
  //
  // THE COMPLAINT: Disneyland Resort opens on a Caltrans off-ramp agreement and
  // Heart Hotel opens on a tentative map. Both are real filings and neither
  // describes the project. The question is not "is the sentence true" - it is -
  // but "is this the record that says what the thing IS".
  rule('PART 4: THE DESCRIPTION SENTENCE, AND WHICH RECORD IT COMES FROM');
  const withSummary = live.filter((p) => p.summary && p.summary_source === 'derived');
  console.log(`  live projects                       : ${live.length}`);
  console.log(`  carrying a DERIVED summary          : ${withSummary.length}  (${pct(withSummary.length, live.length)})`);
  console.log(`  carrying a GENERATED summary        : ${live.filter((p) => p.summary_source === 'generated').length}  (never printed to a client)`);
  console.log(`  carrying none                       : ${live.filter((p) => !p.summary).length}`);

  // Is the summary's record the NEWEST record, and is the newest record the one
  // a reader would pick? Measured by how often the newest record is procedural.
  const PROCEDURAL = /\b(off-?ramp|easement|vacate|abandon|right-of-way|tentative map|final map|encroachment|licen[cs]e and maintenance|street name|dedication|survey|utility|sewer|drainage|traffic study)\b/i;
  const DESCRIPTIVE = /\b(hotel|resort|casino|arena|stadium|theater|theatre|museum|park|entertainment|mixed-use|tower|convention|attraction|waterpark|aquarium|studio)\b/i;
  let newestProcedural = 0, newestDescriptive = 0, newestNeither = 0, hasBetter = 0;
  const examples: string[] = [];
  for (const p of live) {
    const rs = (byProject.get(p.id) ?? []).filter((r) => r.published_date);
    if (rs.length < 2) continue;
    rs.sort((a, b) => (b.published_date ?? '').localeCompare(a.published_date ?? ''));
    const newestText = `${rs[0].title ?? ''} ${rs[0].action_sought ?? ''}`;
    const procedural = PROCEDURAL.test(newestText) && !DESCRIPTIVE.test(newestText);
    if (procedural) newestProcedural++;
    else if (DESCRIPTIVE.test(newestText)) newestDescriptive++;
    else newestNeither++;
    // Would an older record have been better? Only counted where the newest is
    // procedural AND some older record is descriptive - that is the defect.
    if (procedural && rs.slice(1).some((r) => DESCRIPTIVE.test(`${r.title ?? ''} ${r.action_sought ?? ''}`))) {
      hasBetter++;
      if (examples.length < 6) {
        const better = rs.slice(1).find((r) => DESCRIPTIVE.test(`${r.title ?? ''} ${r.action_sought ?? ''}`))!;
        examples.push(
          `    ${p.name.slice(0, 42).padEnd(42)}\n` +
          `        newest  ${(rs[0].published_date ?? '').slice(0, 10)} ${String(rs[0].title ?? '').replace(/\s+/g, ' ').slice(0, 95)}\n` +
          `        better  ${(better.published_date ?? '').slice(0, 10)} ${String(better.title ?? '').replace(/\s+/g, ' ').slice(0, 95)}`
        );
      }
    }
  }
  const multi = newestProcedural + newestDescriptive + newestNeither;
  console.log(`\n  Of the ${multi} live projects holding 2+ dated records, the NEWEST record is:`);
  console.log(`      procedural only  ${String(newestProcedural).padStart(4)}  (${pct(newestProcedural, multi)})  an easement, a map, an off-ramp`);
  console.log(`      descriptive      ${String(newestDescriptive).padStart(4)}  (${pct(newestDescriptive, multi)})  names a hotel, arena, resort`);
  console.log(`      neither          ${String(newestNeither).padStart(4)}  (${pct(newestNeither, multi)})`);
  console.log(`\n  NEWEST IS PROCEDURAL AND AN OLDER RECORD IS DESCRIPTIVE: ${hasBetter} projects`);
  console.log('  That is the defect, counted. Examples:');
  for (const e of examples) console.log(e);

  // ---- PART 6: TITLES THAT ARE ONLY AN ACTION-CODE LIST ---------------------
  rule('PART 6: RECORDS WHOSE TITLE IS ONLY A LIST OF ACTION CODES');
  // A code is 2-3 capitals; the title is nothing but codes and separators.
  const CODE_ONLY = /^[\s;,/&-]*(?:[A-Z]{2,4})(?:[\s;,/&-]+[A-Z]{2,4})*[\s;,/&.-]*$/;
  const codeOnly = liveLeads.filter((l) => {
    const t = String(l.title ?? '').trim();
    return t.length > 0 && t.length < 60 && CODE_ONLY.test(t) && /[A-Z]{2}/.test(t);
  });
  console.log(`  live records with a code-only title : ${codeOnly.length} of ${liveLeads.length}  (${pct(codeOnly.length, liveLeads.length)})`);
  const bySource = new Map<string, number>();
  for (const l of codeOnly) bySource.set(l.source ?? '(none)', (bySource.get(l.source ?? '(none)') ?? 0) + 1);
  console.log('\n  by source:');
  for (const [s, n] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${s}`);
  }
  const withAction = codeOnly.filter((l) => (l.action_sought ?? '').trim().length > 10);
  console.log(`\n  of those, carrying a usable action_sought : ${withAction.length}  (${pct(withAction.length, codeOnly.length)})`);
  console.log('  -> that share can be rescued from the record itself, with no mapping and no invention.');
  console.log('\n  the distinct codes, so a published mapping can be checked against them:');
  const codes = new Map<string, number>();
  for (const l of codeOnly) {
    for (const c of String(l.title).split(/[\s;,/&-]+/).filter((x) => /^[A-Z]{2,4}$/.test(x))) {
      codes.set(c, (codes.get(c) ?? 0) + 1);
    }
  }
  console.log('      ' + [...codes.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}(${n})`).join(' '));
  console.log('\n  examples:');
  for (const l of codeOnly.slice(0, 8)) {
    console.log(`      [${l.source}] "${String(l.title).replace(/\s+/g, ' ')}"  action_sought: ${(l.action_sought ?? '(none)').replace(/\s+/g, ' ').slice(0, 80)}`);
  }

  // ---- PART 7: PARTIES PRINTED TWICE, AND CIRCULARLY ------------------------
  rule('PART 7: PARTIES PRINTED TWICE, BY SHAPE');
  const norm = (s: string) =>
    s.toLowerCase().replace(/[.,]/g, '').replace(/\b(inc|llc|lp|llp|corp|co|company|ltd|dpc|pc)\b/g, '')
      .replace(/\s+/g, ' ').trim();
  let sameNameTwoRoles = 0, projectNamesItself = 0, parentAndProperty = 0, sameBodyManyForms = 0;
  const ex7: string[] = [];
  for (const p of live) {
    const rs = byProject.get(p.id) ?? [];
    const roleOf = new Map<string, Set<string>>();
    for (const r of rs) {
      for (const [role, v] of [['applicant', r.applicant], ['representative', r.representative],
        ['presented by', r.presented_by], ['contact', r.contact_name]] as const) {
        const name = String(v ?? '').trim();
        if (!name) continue;
        const k = norm(name);
        if (!k) continue;
        if (!roleOf.has(k)) roleOf.set(k, new Set());
        roleOf.get(k)!.add(role);
      }
    }
    // SHAPE A: one normalised name holding two or more roles.
    for (const [k, roles] of roleOf) {
      if (roles.size > 1) {
        sameNameTwoRoles++;
        if (ex7.length < 8) ex7.push(`    A  ${p.name.slice(0, 34).padEnd(34)} "${k}" is ${[...roles].join(' AND ')}`);
      }
      // SHAPE B: the project naming itself as its own party.
      if (k && norm(p.name).includes(k) && k.length > 6) {
        projectNamesItself++;
        if (ex7.length < 12) ex7.push(`    B  ${p.name.slice(0, 34).padEnd(34)} names itself: "${k}"`);
      }
    }
    // SHAPE C: one name a strict substring of another on the same project.
    const keys = [...roleOf.keys()];
    for (const a of keys) for (const b of keys) {
      if (a !== b && b.includes(a) && a.length > 5) {
        parentAndProperty++;
        if (ex7.length < 16) ex7.push(`    C  ${p.name.slice(0, 34).padEnd(34)} "${a}" inside "${b}"`);
      }
    }
  }
  // SHAPE D: one body written many ways across the whole corpus.
  const formsOf = new Map<string, Set<string>>();
  for (const l of liveLeads) {
    for (const v of [l.applicant, l.representative, l.presented_by]) {
      const name = String(v ?? '').trim();
      if (!name) continue;
      const k = norm(name);
      if (!k) continue;
      if (!formsOf.has(k)) formsOf.set(k, new Set());
      formsOf.get(k)!.add(name);
    }
  }
  const manyForms = [...formsOf.entries()].filter(([, f]) => f.size > 1);
  sameBodyManyForms = manyForms.length;
  console.log(`  A  one name, two or more roles on one project : ${sameNameTwoRoles}`);
  console.log(`  B  a project naming itself as its own party   : ${projectNamesItself}`);
  console.log(`  C  one name contained inside another          : ${parentAndProperty}   <-- parent/property, NEVER auto-merge`);
  console.log(`  D  one body written several ways (corpus-wide): ${sameBodyManyForms}`);
  console.log('\n  examples:');
  for (const e of ex7) console.log(e);
  console.log('\n  shape D, the ten with the most spellings:');
  for (const [k, forms] of manyForms.sort((a, b) => b[1].size - a[1].size).slice(0, 10)) {
    console.log(`      ${k.slice(0, 40).padEnd(40)} ${forms.size}: ${[...forms].slice(0, 3).join(' | ').slice(0, 110)}`);
  }

  // ---- PART 9: COMPANY ROWS THAT NAME NOTHING -------------------------------
  rule('PART 9: COMPANY ROWS WITH NO LIVE PROJECT LINK');
  const companies = await pageAll<{ id: string; name: string }>('companies', 'id,name');
  const links = await pageAll<{ company_id: string; project_id: string; role: string | null }>(
    'company_projects', 'company_id,project_id,role'
  );
  const liveIds = new Set(live.map((p) => p.id));
  const allIds = new Set(projects.map((p) => p.id));
  const linksByCompany = new Map<string, { project_id: string; role: string | null }[]>();
  for (const l of links) {
    if (!linksByCompany.has(l.company_id)) linksByCompany.set(l.company_id, []);
    linksByCompany.get(l.company_id)!.push(l);
  }
  let noLinkAtAll = 0, onlyDeadLinks = 0, onlyNonLiveLinks = 0, visible = 0;
  for (const c of companies) {
    const ls = linksByCompany.get(c.id) ?? [];
    if (ls.length === 0) { noLinkAtAll++; continue; }
    if (!ls.some((l) => allIds.has(l.project_id))) { onlyDeadLinks++; continue; }
    if (!ls.some((l) => liveIds.has(l.project_id))) { onlyNonLiveLinks++; continue; }
    visible++;
  }
  console.log(`  companies                             : ${companies.length}`);
  console.log(`  company_projects links                : ${links.length}`);
  console.log(`  VISIBLE (>=1 live project)            : ${visible}  (${pct(visible, companies.length)})`);
  console.log(`  hidden: no link row at all            : ${noLinkAtAll}`);
  console.log(`  hidden: links point at no project row : ${onlyDeadLinks}   <-- dangling, a real defect`);
  console.log(`  hidden: links only to dormant/archived: ${onlyNonLiveLinks}`);
  console.log(`\n  -> the screen must state ${companies.length - visible} hidden rows and why, not just show ${visible}.`);
  const roleCounts = new Map<string, number>();
  for (const l of links) roleCounts.set(l.role ?? '(no role)', (roleCounts.get(l.role ?? '(no role)') ?? 0) + 1);
  console.log('\n  roles on the link rows, which is what a visible row can state:');
  for (const [r, n] of [...roleCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${r}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
