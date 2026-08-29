// BACKFILL: the company register, from the parties already stored on records.
//
//   node --env-file=.env.local --import tsx agents/scraper/migrations/backfill-companies.ts
//   COMPANIES_DRY=1 to report without writing.
//
// A company link needs a PROJECT, so only records that belong to one are read.
// An unclustered record's applicant is a real company, but there is nothing to
// link it to; it will arrive here the moment the record joins a project, because
// this backfill is idempotent and re-runnable.
//
// Idempotent twice over: companies upsert on normalized_name and links upsert on
// (company, project, role), both of which are unique indexes in migration 022.
// Re-running writes nothing.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { selectAllPaged } from '../page-select';
import { hospitalityModuleValues } from '../pipelines';
import {
  extractParties,
  consolidate,
  hasCoParties,
  GENERIC_PARTY_EXAMPLES,
} from '../companies';
import type { CompanyRole } from '../../../lib/taxonomy';

interface LeadRow {
  id: string;
  title: string | null;
  raw_content: string | null;
  applicant: string | null;
  representative: string | null;
  presented_by: string | null;
  project_id: string | null;
  published_date: string | null;
  deadline: string | null;
  first_seen: string | null;
}

function leadDate(l: LeadRow): string | null {
  return l.deadline ?? l.published_date ?? l.first_seen ?? null;
}

interface Pending {
  normalized: string;
  displayName: string;
  role: CompanyRole;
  projectId: string;
  at: string | null;
}

export async function backfillCompanies(): Promise<void> {
  const dry = process.env.COMPANIES_DRY === '1';
  console.log('===== COMPANY BACKFILL =====');
  if (dry) console.log('(COMPANIES_DRY=1: nothing will be written)');

  const { rows: leads, complete } = await selectAllPaged<LeadRow>(
    'leads',
    'id,title,raw_content,applicant,representative,presented_by,project_id,published_date,deadline,first_seen',
    (q: unknown) => (q as { in: (a: string, b: string[]) => unknown }).in('module', hospitalityModuleValues()),
    'leads'
  );
  if (!complete) {
    console.error('Read incomplete; refusing to backfill a partial register.');
    process.exitCode = 1;
    return;
  }
  const attached = leads.filter((l) => l.project_id);
  console.log(`\n${leads.length} records read, ${attached.length} attached to a project.`);

  // ---- Extract ---------------------------------------------------------------
  const pending: Pending[] = [];
  const byRole: Record<string, number> = {};
  let coPartyRecords = 0;
  let refusedGeneric = 0;

  for (const l of attached) {
    if (hasCoParties(l.applicant)) coPartyRecords++;
    // Count what the stoplist refuses, so the guard is visible rather than
    // implied. A field that produced no mention either was empty or was refused.
    const before = [l.applicant, l.representative, l.presented_by].filter(Boolean).length;
    const parties = extractParties(l);
    const fromColumns = parties.filter((p) => p.role !== 'owner').length;
    if (before > fromColumns) refusedGeneric += before - fromColumns;

    for (const p of parties) {
      pending.push({
        normalized: p.normalized,
        displayName: p.name,
        role: p.role,
        projectId: l.project_id as string,
        at: leadDate(l),
      });
      byRole[p.role] = (byRole[p.role] ?? 0) + 1;
    }
  }

  console.log('\nParty mentions extracted, by role:');
  for (const [r, n] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(5)}  ${r}`);
  }
  console.log(`  ${String(refusedGeneric).padStart(5)}  refused: generic party (city, county, department, utility)`);
  console.log(`  ${String(coPartyRecords).padStart(5)}  records naming CO-APPLICANTS; only the first party is taken`);
  console.log('\n  The stoplist is the clusterer\'s own isGenericEntity, not a second list.');
  console.log('  It refuses, among others:');
  for (const g of GENERIC_PARTY_EXAMPLES) console.log(`    ${g}`);
  console.log('  and it matches the WHOLE name, so "City Parkway V" survives it.');

  // ---- Consolidate -----------------------------------------------------------
  const { canonical, merges } = consolidate(pending.map((p) => p.normalized));
  console.log(`\nDistinct normalized names: ${new Set(pending.map((p) => p.normalized)).size}`);
  console.log(`Fuzzy merges (>=0.90, same first token, both >=10 chars): ${merges.length}`);
  for (const m of merges) console.log(`    "${m.merged}" -> "${m.kept}"  (${m.similarity})`);
  if (merges.length === 0) {
    console.log('    (none: legal-suffix normalisation already collapses every variant here)');
  }

  // One row per company, with the longest display name seen and the earliest and
  // latest dates across all of its mentions.
  const companies = new Map<
    string,
    { display: string; first: string | null; last: string | null }
  >();
  for (const p of pending) {
    const key = canonical.get(p.normalized) ?? p.normalized;
    const c = companies.get(key) ?? { display: p.displayName, first: null, last: null };
    if (p.displayName.length > c.display.length) c.display = p.displayName;
    if (p.at && (!c.first || p.at < c.first)) c.first = p.at;
    if (p.at && (!c.last || p.at > c.last)) c.last = p.at;
    companies.set(key, c);
  }

  const links = new Map<string, { key: string; projectId: string; role: CompanyRole; at: string | null }>();
  for (const p of pending) {
    const key = canonical.get(p.normalized) ?? p.normalized;
    const id = `${key}|${p.projectId}|${p.role}`;
    const prev = links.get(id);
    if (!prev || (p.at && prev.at && p.at < prev.at)) {
      links.set(id, { key, projectId: p.projectId, role: p.role, at: p.at });
    }
  }

  console.log(`\nCompanies to write: ${companies.size}`);
  console.log(`Links to write:     ${links.size}`);

  if (dry) {
    console.log('\n(dry run: nothing written)');
    console.log('============================\n');
    return;
  }

  // ---- Write ------------------------------------------------------------------
  const rows = [...companies.entries()].map(([normalized, c]) => ({
    name: c.display,
    normalized_name: normalized,
    first_seen: c.first ?? undefined,
    last_activity: c.last ?? undefined,
  }));
  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from('companies')
      .upsert(rows.slice(i, i + 200), { onConflict: 'normalized_name', ignoreDuplicates: false });
    if (error) console.error(`  company write failed: ${error.message.slice(0, 90)}`);
    else written += rows.slice(i, i + 200).length;
  }

  const { rows: stored } = await selectAllPaged<{ id: string; normalized_name: string }>(
    'companies',
    'id,normalized_name',
    (q: unknown) => (q as { order: (c: string) => unknown }).order('id'),
    'companies'
  );
  const idByName = new Map(stored.map((s) => [s.normalized_name, s.id]));

  const linkRows = [...links.values()]
    .map((l) => ({
      company_id: idByName.get(l.key),
      project_id: l.projectId,
      role: l.role,
      first_seen: l.at ?? undefined,
    }))
    .filter((r) => r.company_id);
  let linked = 0;
  for (let i = 0; i < linkRows.length; i += 200) {
    const { error } = await supabaseAdmin
      .from('company_projects')
      .upsert(linkRows.slice(i, i + 200), {
        onConflict: 'company_id,project_id,role',
        ignoreDuplicates: true,
      });
    if (error) console.error(`  link write failed: ${error.message.slice(0, 90)}`);
    else linked += linkRows.slice(i, i + 200).length;
  }

  console.log(`\nWRITTEN: ${written} companies, ${linked} links.`);
  await reportTopCompanies();
  console.log('============================\n');
}

async function reportTopCompanies(): Promise<void> {
  const { rows: links } = await selectAllPaged<{ company_id: string; project_id: string; role: string }>(
    'company_projects',
    'company_id,project_id,role',
    (q: unknown) => (q as { order: (c: string) => unknown }).order('id'),
    'company_projects'
  );
  const { rows: companies } = await selectAllPaged<{ id: string; name: string }>(
    'companies',
    'id,name',
    (q: unknown) => (q as { order: (c: string) => unknown }).order('id'),
    'companies'
  );
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const projectsBy = new Map<string, Set<string>>();
  const rolesBy = new Map<string, Set<string>>();
  for (const l of links) {
    if (!projectsBy.has(l.company_id)) projectsBy.set(l.company_id, new Set());
    projectsBy.get(l.company_id)!.add(l.project_id);
    if (!rolesBy.has(l.company_id)) rolesBy.set(l.company_id, new Set());
    rolesBy.get(l.company_id)!.add(l.role);
  }
  const top = [...projectsBy.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 10);
  console.log('\nTEN MOST ACTIVE COMPANIES, by project count:');
  for (const [id, projects] of top) {
    console.log(
      `  ${String(projects.size).padStart(3)} projects  ${(nameById.get(id) ?? '?').slice(0, 52).padEnd(54)}` +
        `[${[...(rolesBy.get(id) ?? [])].join(', ')}]`
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillCompanies().catch((err) => {
    console.error('Company backfill failed:', err);
    process.exitCode = 1;
  });
}
