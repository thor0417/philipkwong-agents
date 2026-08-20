// READ-ONLY. DOES THE CORPUS HOLD A GIVEN FIRM'S NAME ANYWHERE AT ALL?
//
//   node --env-file=.env.local --import tsx \
//     agents/scraper/diagnostics/party-search.ts "Steelman" "Kimley" "Tempo Ventures"
//
// Nothing is written. This answers the one question that decides whether a
// missing party is an EXTRACTION problem or a CAPTURE problem, and those want
// completely different work: if the string is in a row we already hold, the
// reader dropped it; if it is nowhere, we never opened the document that
// carries it.
//
// IT SEARCHES EVERYTHING, INCLUDING WHAT WE THREW AWAY. Dismissed records and
// retired lifecycles are included on purpose - "we had it and binned it" is a
// different finding from "we never saw it", and the tombstone rule exists so
// that question can be asked.
//
// EVERY TEXT COLUMN, not only the party ones. A firm named in an agenda title
// but never lifted into `applicant` is exactly the case this is looking for, so
// searching only the party columns would answer the wrong question.

import { supabaseAdmin } from '../../../lib/supabase-admin';

const TERMS = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (TERMS.length === 0) {
  console.error('usage: party-search.ts "<term>" ["<term>" …]');
  process.exit(1);
}

interface Lead {
  id: string;
  title: string | null;
  url: string | null;
  source: string | null;
  stream: string | null;
  status: string | null;
  lifecycle: string | null;
  market: string | null;
  project_id: string | null;
  applicant: string | null;
  representative: string | null;
  presented_by: string | null;
  contact_name: string | null;
  action_sought: string | null;
  raw_content: string | null;
  primary_document_url: string | null;
  filing_facts: { kind: string; label: string; display: string; line: string }[] | null;
}

async function pageAll<T>(table: string, columns: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin.from(table).select(columns).range(from, from + 499);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as T[]));
    if (data.length < 500) break;
  }
  return out;
}

async function main(): Promise<void> {
  const leads = await pageAll<Lead>(
    'leads',
    'id,title,url,source,stream,status,lifecycle,market,project_id,applicant,representative,' +
      'presented_by,contact_name,action_sought,raw_content,primary_document_url,filing_facts'
  );
  const projects = await pageAll<{
    id: string; name: string; status: string | null; market: string | null;
    primary_applicant: string | null; primary_representative: string | null; summary: string | null;
  }>('projects', 'id,name,status,market,primary_applicant,primary_representative,summary');
  const companies = await pageAll<{ id: string; name: string }>('companies', 'id,name');
  const projById = new Map(projects.map((p) => [p.id, p]));

  console.log('='.repeat(100));
  console.log(`SEARCHING ${leads.length} records, ${projects.length} projects, ${companies.length} companies`);
  console.log('  dismissed and retired INCLUDED');
  console.log('='.repeat(100));

  for (const term of TERMS) {
    const t = term.toLowerCase();
    console.log('');
    console.log('-'.repeat(100));
    console.log(`TERM: ${term}`);
    console.log('-'.repeat(100));

    const hitCompanies = companies.filter((c) => c.name.toLowerCase().includes(t));
    console.log(`  companies rows: ${hitCompanies.length}`);
    for (const c of hitCompanies) console.log(`      ${c.name}`);

    const hitProjects = projects.filter((p) =>
      [p.name, p.primary_applicant, p.primary_representative, p.summary]
        .some((v) => String(v ?? '').toLowerCase().includes(t))
    );
    console.log(`  projects rows: ${hitProjects.length}`);
    for (const p of hitProjects) {
      console.log(`      ${String(p.status).padEnd(10)} ${p.name.slice(0, 44).padEnd(45)} applicant=${p.primary_applicant ?? '-'}`);
    }

    // Per COLUMN, because which column holds it is the whole diagnosis.
    const cols: [string, (l: Lead) => string][] = [
      ['applicant', (l) => String(l.applicant ?? '')],
      ['representative', (l) => String(l.representative ?? '')],
      ['presented_by', (l) => String(l.presented_by ?? '')],
      ['contact_name', (l) => String(l.contact_name ?? '')],
      ['title', (l) => String(l.title ?? '')],
      ['action_sought', (l) => String(l.action_sought ?? '')],
      ['raw_content', (l) => String(l.raw_content ?? '')],
      ['filing_facts', (l) => JSON.stringify(l.filing_facts ?? [])],
    ];
    const seen = new Set<string>();
    let total = 0;
    for (const [name, get] of cols) {
      const hits = leads.filter((l) => get(l).toLowerCase().includes(t));
      if (hits.length === 0) continue;
      console.log(`  leads.${name}: ${hits.length}`);
      for (const l of hits.slice(0, 8)) {
        total++;
        seen.add(l.id);
        const p = l.project_id ? projById.get(l.project_id) : null;
        console.log(
          `      ${String(l.source ?? '-').padEnd(16)} ${String(l.stream ?? '-').padEnd(13)} ` +
            `${String(l.status ?? '-').padEnd(10)} ${String(l.lifecycle ?? '-').padEnd(9)} ` +
            `${String(p?.name ?? '(unclustered)').slice(0, 34).padEnd(35)} ${String(l.title ?? '').slice(0, 40)}`
        );
      }
    }
    if (total === 0 && hitProjects.length === 0 && hitCompanies.length === 0) {
      console.log('  NOT PRESENT ANYWHERE IN THE CORPUS.');
    } else {
      console.log(`  distinct records touched: ${seen.size}`);
    }
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
