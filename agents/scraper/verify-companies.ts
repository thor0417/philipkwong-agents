// THE THREE QUESTIONS THE COMPANY REGISTER EXISTS TO ANSWER.
//
//   node --env-file=.env.local --import tsx agents/scraper/verify-companies.ts
//
// Before migration 022 none of these could be asked at all: the parties were
// free text on the lead row, and "KULIK RIVER CAPITAL, LLC" and "Kulik River
// Capital LLC" were two different strings. These are the questions a partner
// brief is built from, so they are the acceptance test.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../lib/supabase-admin';
import { selectAllPaged } from './page-select';
import { normalizeEntity } from './cluster';

interface Link {
  company_id: string;
  project_id: string;
  role: string;
  first_seen: string | null;
}

async function main(): Promise<void> {
  const { rows: companies } = await selectAllPaged<{
    id: string;
    name: string;
    normalized_name: string;
    last_activity: string | null;
  }>('companies', 'id,name,normalized_name,last_activity', (q: unknown) =>
    (q as { order: (c: string) => unknown }).order('id'), 'companies');
  const { rows: links } = await selectAllPaged<Link>(
    'company_projects',
    'company_id,project_id,role,first_seen',
    (q: unknown) => (q as { order: (c: string) => unknown }).order('id'),
    'company_projects'
  );
  const { rows: projects } = await selectAllPaged<{
    id: string;
    name: string;
    market: string | null;
    stage: string | null;
  }>('projects', 'id,name,market,stage', (q: unknown) =>
    (q as { order: (c: string) => unknown }).order('id'), 'projects');

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const linksByCompany = new Map<string, Link[]>();
  for (const l of links) {
    if (!linksByCompany.has(l.company_id)) linksByCompany.set(l.company_id, []);
    linksByCompany.get(l.company_id)!.push(l);
  }

  console.log('===== COMPANY REGISTER =====');
  console.log(`${companies.length} companies, ${links.length} company-project links.\n`);

  // Match on the NORMALISED name, which is the whole point: a caller types the
  // company as they think of it and the register resolves it.
  const find = (query: string): typeof companies =>
    companies.filter((c) => c.normalized_name.includes(normalizeEntity(query)));

  const show = (label: string, matches: typeof companies): void => {
    console.log(`--- ${label}`);
    if (matches.length === 0) {
      console.log('    no company matched.\n');
      return;
    }
    for (const c of matches) {
      const ls = linksByCompany.get(c.id) ?? [];
      console.log(`    ${c.name}   (${ls.length} link${ls.length === 1 ? '' : 's'})`);
      for (const l of ls.sort((a, b) => String(a.first_seen).localeCompare(String(b.first_seen)))) {
        const p = projectById.get(l.project_id);
        console.log(
          `      ${String(l.first_seen ?? '').slice(0, 10).padEnd(11)}` +
            `${l.role.padEnd(15)}${(p?.name ?? '?').slice(0, 46).padEnd(48)}` +
            `${p?.market ?? '?'} / ${p?.stage ?? '?'}`
        );
      }
      console.log('');
    }
  };

  // ---- 1 ---------------------------------------------------------------------
  show('1. EVERY PROJECT KULIK RIVER CAPITAL HAS FILED', find('Kulik River Capital'));

  // ---- 2 ---------------------------------------------------------------------
  show('2. EVERYTHING NANCY AMUNDSEN HAS CARRIED', find('Nancy Amundsen'));

  // ---- 3 ---------------------------------------------------------------------
  console.log('--- 3. THE MOST ACTIVE REPRESENTATIVE ACROSS THE CORPUS');
  const repProjects = new Map<string, Set<string>>();
  for (const l of links) {
    if (l.role !== 'representative') continue;
    if (!repProjects.has(l.company_id)) repProjects.set(l.company_id, new Set());
    repProjects.get(l.company_id)!.add(l.project_id);
  }
  const nameById = new Map(companies.map((c) => [c.id, c.name]));
  const ranked = [...repProjects.entries()].sort((a, b) => b[1].size - a[1].size);
  if (ranked.length === 0) {
    console.log('    no representative links stored.');
  }
  for (const [id, ps] of ranked.slice(0, 10)) {
    console.log(`    ${String(ps.size).padStart(2)} projects   ${nameById.get(id) ?? '?'}`);
    for (const pid of ps) {
      const p = projectById.get(pid);
      console.log(`                  ${(p?.name ?? '?').slice(0, 52).padEnd(54)}${p?.market ?? '?'}`);
    }
  }

  // ---- Role coverage, so the answer's limits are visible ---------------------
  const byRole: Record<string, number> = {};
  for (const l of links) byRole[l.role] = (byRole[l.role] ?? 0) + 1;
  console.log('\n--- LINKS BY ROLE');
  for (const [r, n] of Object.entries(byRole).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(n).padStart(4)}  ${r}`);
  }
  for (const r of ['architect', 'agent']) {
    if (!byRole[r]) {
      console.log(`       0  ${r}   (in the vocabulary; no source in this corpus states it)`);
    }
  }
  console.log('============================\n');
  void supabaseAdmin;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Company verification failed:', err);
    process.exitCode = 1;
  });
}
