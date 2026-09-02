// READ-ONLY. WHAT THE GOVERNMENT LANE HOLDS, PER JURISDICTION, AS A FILE.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/legistar-lane-measure.ts --label pre
//
// Nothing is written to the corpus. One JSON file is written to snapshots/ so a
// before/after pair exists on disk rather than in scrollback (standing rule 11).
//
// THE FOUR COLUMNS BRIEF U ASKS FOR, and the predicate for each is stated here
// rather than left to be inferred:
//
//   doc       has_primary_document = true. AFTER commit 74bc134 this means "a
//             document was listed, fetched and parsed". BEFORE it, it meant "a
//             fetched document also carried a Clark-shaped contact block", which
//             is why every figure it produced for seven jurisdictions is an
//             understatement of unknown size. The column name did not change;
//             what it means did, so a before/after on this column is a
//             comparison of two different questions and the report says so.
//   file      of those, the ones whose stored url is a FETCHED FILE rather than
//             a page that lists files. This is the brief's "a real document, not
//             a listing page", and nothing in the tree could answer it until
//             lib/document-shape existed: golden case
//             a-listing-page-stored-as-the-document measured 299 of 579 stored
//             document urls pointing at a Granicus viewer, a PrimeGov meeting
//             portal or a planning application page. Legistar's own values are
//             <guid>.pdf on legistar1.com and are real files, so `doc` and
//             `file` agree on the Legistar table and diverge on the one below
//             it. Where they diverge, `file` is the honest number.
//
//   fact      at least one entry in filing_facts that an ENTRY would print. The
//             same two exclusions the entry applies (case_planner, condition) and
//             the same wholeness check, so this is the printed number rather than
//             the stored one.
//   contacts  applicant, representative or presented_by set on the record. These
//             are written from the document only; the government lane fills a gap
//             from the record text, never the reverse.
//   offzero   live projects in the market carrying at least one printable fact.
//             This is the register-facing number: it is what "moved off zero"
//             means in the brief.
//
// NO CAP. Every table is paged to exhaustion, because PostgREST's default is a
// silent 1000 rows and these figures feed a before/after claim (rule 13).

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { documentShape, documentShapeNote } from '../../../lib/document-shape';

const OUT_DIR = 'snapshots';
const CONTACT_BLOCK = '--- contacts from the matter documents ---';
// The entry excludes these: city staff, and conditions, which get their own block.
const EXCLUDED = new Set(['case_planner', 'condition']);

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? (process.argv[i + 1] ?? null) : null;
};

interface Lead {
  id: string;
  project_id: string | null;
  status: string | null;
  stream: string | null;
  source: string | null;
  market: string | null;
  location: string | null;
  has_primary_document: boolean | null;
  primary_document_url: string | null;
  applicant: string | null;
  representative: string | null;
  presented_by: string | null;
  raw_content: string | null;
  filing_facts: { kind: string; display: string; line: string }[] | null;
}

interface Proj {
  id: string;
  name: string;
  status: string | null;
  market: string | null;
  region_state: string | null;
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

const printableFacts = (l: Lead): number =>
  (l.filing_facts ?? []).filter(
    (f) => f && !EXCLUDED.has(f.kind) && f.display && f.line && f.line.includes(f.display)
  ).length;

interface Row {
  jurisdiction: string;
  records: number;
  doc: number;
  file: number;
  listing: number;
  unknownShape: number;
  withFact: number;
  facts: number;
  contacts: number;
  contactBlock: number;
  liveProjects: number;
  projectsOffZero: number;
  projectsWithDoc: number;
}

const emptyRow = (jurisdiction: string): Row => ({
  jurisdiction,
  records: 0,
  doc: 0,
  file: 0,
  listing: 0,
  unknownShape: 0,
  withFact: 0,
  facts: 0,
  contacts: 0,
  contactBlock: 0,
  liveProjects: 0,
  projectsOffZero: 0,
  projectsWithDoc: 0,
});

async function main(): Promise<void> {
  const label = arg('label') ?? 'measure';

  const projects = await pageAll<Proj>('projects', 'id,name,status,market,region_state');
  const live = projects.filter((p) => p.status !== 'archived' && p.status !== 'deleted');
  const liveById = new Map(live.map((p) => [p.id, p]));

  const leads = await pageAll<Lead>(
    'leads',
    'id,project_id,status,stream,source,market,location,has_primary_document,primary_document_url,' +
      'applicant,representative,presented_by,raw_content,filing_facts'
  );

  // THE JURISDICTION AXIS. A record's market is what a document later filters
  // on; location is the adapter's own jurisdiction label and is the fallback,
  // because Legistar writes it on every row it produces. Resolved by taking the
  // text before the first comma, which is how government.ts already reconciles
  // 'Broward County, FL' against the 'Broward County' the rows carry.
  const jurisdictionOf = (l: Lead): string =>
    (l.market ?? l.location ?? '(no market)').split(',')[0].trim();
  const projectMarket = (p: Proj): string =>
    (p.market ?? p.region_state ?? '(no market)').split(',')[0].trim();

  const gov = leads.filter(
    (l) => l.status !== 'dismissed' && (l.stream === 'government' || l.stream === 'opportunity')
  );

  const bySource = new Map<string, Lead[]>();
  for (const l of gov) {
    const k = l.source ?? '(none)';
    const cur = bySource.get(k);
    if (cur) cur.push(l);
    else bySource.set(k, [l]);
  }

  const build = (rows: Lead[]): Map<string, Row> => {
    const out = new Map<string, Row>();
    const touch = (j: string): Row => {
      let r = out.get(j);
      if (!r) {
        r = emptyRow(j);
        out.set(j, r);
      }
      return r;
    };
    const offZero = new Map<string, Set<string>>();
    const withDoc = new Map<string, Set<string>>();
    for (const l of rows) {
      const r = touch(jurisdictionOf(l));
      r.records++;
      if (l.has_primary_document === true) {
        r.doc++;
        const shape = documentShape(l.primary_document_url);
        if (shape === 'file') r.file++;
        else if (shape === 'listing') r.listing++;
        else r.unknownShape++;
      }
      const n = printableFacts(l);
      if (n > 0) r.withFact++;
      r.facts += n;
      if (l.applicant || l.representative || l.presented_by) r.contacts++;
      if ((l.raw_content ?? '').includes(CONTACT_BLOCK)) r.contactBlock++;
      const proj = l.project_id ? liveById.get(l.project_id) : undefined;
      if (proj) {
        const pm = projectMarket(proj);
        if (n > 0) {
          const s = offZero.get(pm) ?? new Set<string>();
          s.add(proj.id);
          offZero.set(pm, s);
        }
        if (l.has_primary_document === true) {
          const s = withDoc.get(pm) ?? new Set<string>();
          s.add(proj.id);
          withDoc.set(pm, s);
        }
      }
    }
    for (const p of live) {
      const m = projectMarket(p);
      const r = out.get(m);
      if (r) r.liveProjects++;
    }
    for (const [m, s] of offZero) {
      const r = out.get(m);
      if (r) r.projectsOffZero = s.size;
    }
    for (const [m, s] of withDoc) {
      const r = out.get(m);
      if (r) r.projectsWithDoc = s.size;
    }
    return out;
  };

  const legistar = build(bySource.get('legistar') ?? []);
  const allGov = build(gov);

  const table = (title: string, m: Map<string, Row>): string[] => {
    const lines: string[] = [];
    lines.push('');
    lines.push(`===== ${title} =====`);
    lines.push('');
    lines.push(
      'jurisdiction              records    doc   FILE   list   w/fact   facts  contacts  cblock   live  offzero  wdoc'
    );
    const sorted = [...m.values()].sort((a, b) => b.records - a.records);
    const tot = emptyRow('TOTAL');
    const line = (r: Row): string =>
      r.jurisdiction.slice(0, 24).padEnd(25) +
      String(r.records).padStart(7) +
      String(r.doc).padStart(7) +
      String(r.file).padStart(7) +
      String(r.listing).padStart(7) +
      String(r.withFact).padStart(9) +
      String(r.facts).padStart(8) +
      String(r.contacts).padStart(10) +
      String(r.contactBlock).padStart(8) +
      String(r.liveProjects).padStart(7) +
      String(r.projectsOffZero).padStart(9) +
      String(r.projectsWithDoc).padStart(6);
    for (const r of sorted) {
      lines.push(line(r));
      tot.records += r.records;
      tot.doc += r.doc;
      tot.file += r.file;
      tot.listing += r.listing;
      tot.unknownShape += r.unknownShape;
      tot.withFact += r.withFact;
      tot.facts += r.facts;
      tot.contacts += r.contacts;
      tot.contactBlock += r.contactBlock;
      tot.liveProjects += r.liveProjects;
      tot.projectsOffZero += r.projectsOffZero;
      tot.projectsWithDoc += r.projectsWithDoc;
    }
    lines.push(line(tot));
    lines.push('');
    lines.push(
      documentShapeNote({ file: tot.file, listing: tot.listing, unknown: tot.unknownShape })
    );
    return lines;
  };

  const out: string[] = [];
  out.push(`LABEL: ${label}`);
  out.push(`AT: ${new Date().toISOString()}`);
  out.push('');
  out.push(`live projects        : ${live.length}`);
  out.push(`government records   : ${gov.length} (undismissed, stream government or opportunity)`);
  out.push('NO CAP: leads and projects are both paged to exhaustion.');
  out.push(...table('LEGISTAR ONLY, BY JURISDICTION', legistar));
  out.push(...table('EVERY GOVERNMENT SOURCE, BY MARKET', allGov));
  out.push('');
  out.push('doc      = has_primary_document true');
  out.push('FILE     = of those, the url is a fetched file (lib/document-shape)');
  out.push('list     = of those, the url is a page that LISTS documents, not a document');
  out.push('w/fact   = records carrying at least one fact an entry would print');
  out.push('facts    = total printable filing facts');
  out.push('contacts = applicant, representative or presented_by set');
  out.push('cblock   = a contacts provenance block in raw_content');
  out.push('offzero  = live projects in the market with at least one printable fact');
  out.push('wdoc     = live projects with at least one record carrying a real document');

  console.log(out.join('\n'));

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(OUT_DIR, `legistar-lane-${stamp}-${label}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        label,
        at: new Date().toISOString(),
        cap: 'none: leads and projects paged to exhaustion',
        liveProjects: live.length,
        governmentRecords: gov.length,
        legistar: [...legistar.values()],
        allGovernment: [...allGov.values()],
      },
      null,
      2
    ) + '\n'
  );
  // Standing rule 11: a generator that prints an artefact reads it back, so a
  // missing file fails the run instead of manufacturing the appearance of one.
  const back = JSON.parse(readFileSync(file, 'utf8')) as { legistar: unknown[] };
  console.log(`\nWROTE ${file} (${back.legistar.length} legistar rows read back)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
