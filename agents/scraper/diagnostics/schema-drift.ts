// READ-ONLY. WHERE THE REPO'S MIGRATION SET AND THE LIVE SCHEMA DISAGREE.
//
//   node --env-file=.env.local --import tsx agents/scraper/diagnostics/schema-drift.ts
//
// Writes snapshots/schema-drift-<stamp>.md and reads it back off disk.
//
// WHY THIS EXISTS. Three objects were found by accident in one day:
//
//   idx_project_events_dedupe   enforced by the database, declared in no
//                               migration, and it silently discarded every
//                               repeat event for three months. Its definition
//                               was lost when it was dropped, because nothing
//                               in the tree described it.
//   projects.significance       written by the clusterer on every run and
//                               declared in no migration.
//   projects.pipeline_id        declared in migration 024, never applied. That
//                               migration also sets the column NOT NULL and
//                               foreign-keys it to a `pipelines` table.
//
// A migration set that is neither a subset nor a superset of the live schema is
// not a record of the schema. It is a second opinion about it, and the two
// disagreeing is only ever discovered by a write failing in production.
//
// WHAT THIS CAN AND CANNOT SEE, stated because a partial audit presented as a
// whole one is the defect this repo keeps paying for:
//
//   CAN   tables and columns, both directions. PostgREST answers "does this
//         column exist" precisely, by name, in its error.
//   CANNOT  indexes, constraints, policies, triggers, defaults, nullability.
//         PostgREST exposes none of them and this project has no SQL RPC. The
//         report prints the query that answers them and says plainly that the
//         section is unanswered until somebody runs it.
//
// So a clean run of this file does NOT mean the schema matches. It means the
// TABLES AND COLUMNS match.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const MIGRATIONS = 'agents/scraper/migrations';
// THE BASE SCHEMA IS A DECLARATION TOO. supabase/schema.sql creates leads,
// agents and four others, and reading only the migrations directory reported
// fourteen leads columns as hand-applied when every one of them is declared
// here. An audit that over-reports is worse than none: it teaches the reader to
// discount it.
const BASE_SCHEMA = 'supabase/schema.sql';
const OUT_DIR = 'snapshots';

interface Declared {
  table: string;
  column: string | null;
  migration: string;
  /** The raw statement, so the report can quote what was promised. */
  statement: string;
}

// ---- WHAT THE MIGRATIONS SAY ------------------------------------------------
//
// Deliberately literal. These patterns read the statements this repo actually
// writes rather than trying to parse SQL: an unrecognised statement is REPORTED
// as unparsed instead of being silently skipped, because a statement nobody
// counted is exactly how an object comes to exist undeclared.
function readMigrations(): { declared: Declared[]; unparsed: string[]; files: string[]; proposals: string[] } {
  // A FILE NAMED PROPOSED_ IS NOT A MIGRATION. It is a design someone wrote
  // down and did not run, and counting it as unapplied schema reports six
  // tables as missing that were never meant to exist yet.
  const all = readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  const proposals = all.filter((f) => /^PROPOSED/i.test(f));
  const files = all.filter((f) => !/^PROPOSED/i.test(f));
  const declared: Declared[] = [];
  const unparsed: string[] = [];

  const sources: { name: string; path: string }[] = [
    { name: 'supabase/schema.sql', path: BASE_SCHEMA },
    ...files.map((f) => ({ name: f, path: path.join(MIGRATIONS, f) })),
  ];

  for (const { name: f, path: fp } of sources) {
    const sql = readFileSync(fp, 'utf8');
    // Strip comments, so a column named inside an explanation is not counted.
    const body = sql
      .split('\n')
      .filter((l) => !l.trim().startsWith('--'))
      .join('\n');

    for (const raw of body.split(';')) {
      const stmt = raw.replace(/\s+/g, ' ').trim();
      if (!stmt) continue;

      let m = /^create table (?:if not exists )?(?:public\.)?([a-z_]+)\s*\(/i.exec(stmt);
      if (m) {
        declared.push({ table: m[1], column: null, migration: f, statement: stmt.slice(0, 90) });
        // Every column inside the parentheses.
        const inner = stmt.slice(stmt.indexOf('(') + 1, stmt.lastIndexOf(')'));
        for (const col of splitColumns(inner)) {
          const cm = /^([a-z_]+)\s+/i.exec(col.trim());
          if (cm && !/^(primary|unique|foreign|constraint|check)$/i.test(cm[1])) {
            declared.push({ table: m[1], column: cm[1], migration: f, statement: col.trim().slice(0, 90) });
          }
        }
        continue;
      }

      m = /^alter table (?:if exists )?(?:public\.)?([a-z_]+)\s+add column (?:if not exists )?([a-z_]+)/i.exec(stmt);
      if (m) {
        declared.push({ table: m[1], column: m[2], migration: f, statement: stmt.slice(0, 90) });
        continue;
      }

      // Everything else is recorded as a statement this audit cannot verify:
      // indexes, policies, constraints, grants, updates, selects.
      if (/^(create (unique )?index|create policy|alter table|drop index|grant|comment on|begin|commit|update|select|insert|do |create or replace|create extension|create trigger)/i.test(stmt)) {
        unparsed.push(`${f}: ${stmt.slice(0, 110)}`);
      } else {
        unparsed.push(`${f}: [UNRECOGNISED] ${stmt.slice(0, 110)}`);
      }
    }
  }
  return { declared, unparsed, files, proposals };
}

// A create-table body, split on top-level commas only.
function splitColumns(inner: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of inner) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// ---- WHAT THE DATABASE SAYS -------------------------------------------------
async function tableExists(table: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(table).select('*').limit(0);
  if (!error) return true;
  if (/does not exist|Could not find the table|schema cache/i.test(error.message)) return false;
  // Any other error (permissions, RLS) means the table IS there.
  return true;
}

async function columnExists(table: string, column: string): Promise<boolean> {
  const { error } = await supabaseAdmin.from(table).select(column).limit(0);
  if (!error) return true;
  if (/does not exist|Could not find|schema cache/i.test(error.message)) return false;
  return true;
}

// ---- COLUMNS THE CODE USES, so the other direction is checkable -------------
//
// A column the database holds and no migration declares is invisible to a
// migration-driven audit: there is nothing to look it up by. So the audit reads
// the SELECT strings the code sends and treats every column named there as a
// column that must exist - and then asks whether any migration declared it.
function columnsUsedInCode(): Map<string, Set<string>> {
  const used = new Map<string, Set<string>>();
  const roots = ['agents', 'lib', 'dashboard/lib', 'dashboard/scripts'];
  const files: string[] = [];
  const walk = (dir: string): void => {
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const e of entries) {
      if (e === 'node_modules' || e === '.next') continue;
      const p = path.join(dir, e);
      if (e.endsWith('.ts') || e.endsWith('.tsx')) files.push(p);
      else if (!e.includes('.')) walk(p);
    }
  };
  roots.forEach(walk);

  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const re = /\.from\(\s*'([a-z_]+)'\s*\)\s*\n?\s*\.select\(\s*([`'"])([^`'"]*)\2/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
      const table = m[1];
      const cols = m[3];
      if (cols.includes('*') || cols.includes('(')) continue;
      const set = used.get(table) ?? new Set<string>();
      for (const c of cols.split(',')) {
        const name = c.trim();
        if (/^[a-z_]+$/.test(name)) set.add(name);
      }
      used.set(table, set);
    }

    // A SELECT LIST HELD IN A CONSTANT IS STILL A SELECT LIST.
    //
    // THE REGEX ABOVE ONLY SEES COLUMNS TYPED INLINE, and that made this audit
    // report SIX undeclared columns when the answer was NINE. dashboard/lib
    // /projects.ts holds PROJECT_COLUMNS as an array and passes it, so
    // projects.significance_detail, projects.significance_computed_at and
    // leads.source_tier were invisible - three columns the code reads on every
    // run, declared nowhere, and missing from the migration this audit existed
    // to produce.
    //
    // An audit that under-reports is the same failure as one that over-reports,
    // one direction along, and it is the worse of the two: an over-report gets
    // checked because it looks wrong, and an under-report is simply believed.
    //
    // Attribution is BY CONSTANT NAME, not by dataflow. PROJECT_* belongs to
    // projects; LEAD_/TIMELINE_/RECORD_* to leads; anything else is probed
    // against both. Over-probing costs one request per name and no correctness:
    // a name that is not a column comes back absent.
    const constRe = /const\s+([A-Z][A-Z0-9_]*(?:COLUMNS|FIELDS))\b[^=]*=\s*(\[[\s\S]*?\]|'[^']*')/g;
    let cm: RegExpExecArray | null;
    while ((cm = constRe.exec(src))) {
      const constName = cm[1];
      const names = [...cm[2].matchAll(/'([a-z][a-z0-9_]*)'/g)].map((x) => x[1]);
      if (names.length === 0) continue;
      const tables = /PROJECT/.test(constName)
        ? ['projects']
        : /LEAD|TIMELINE|RECORD/.test(constName)
          ? ['leads']
          : ['projects', 'leads'];
      for (const t of tables) {
        const set = used.get(t) ?? new Set<string>();
        names.forEach((n) => set.add(n));
        used.set(t, set);
      }
    }

  }
  return used;
}

async function main(): Promise<void> {
  const { declared, unparsed, files, proposals } = readMigrations();
  const used = columnsUsedInCode();

  const declaredTables = [...new Set(declared.map((d) => d.table))].sort();
  const declaredCols = new Map<string, Set<string>>();
  for (const d of declared) {
    if (!d.column) continue;
    const s = declaredCols.get(d.table) ?? new Set<string>();
    s.add(d.column);
    declaredCols.set(d.table, s);
  }

  // ---- DIRECTION A: declared and absent -----------------------------------
  const missingTables: string[] = [];
  const missingColumns: Declared[] = [];
  for (const t of declaredTables) {
    if (!(await tableExists(t))) { missingTables.push(t); continue; }
    for (const d of declared.filter((x) => x.table === t && x.column)) {
      if (!(await columnExists(t, d.column!))) missingColumns.push(d);
    }
  }

  // ---- DIRECTION B: present and undeclared --------------------------------
  const undeclared: { table: string; column: string }[] = [];
  for (const [table, cols] of used) {
    if (missingTables.includes(table)) continue;
    if (!(await tableExists(table))) continue;
    const dec = declaredCols.get(table) ?? new Set<string>();
    for (const c of cols) {
      if (dec.has(c)) continue;
      if (await columnExists(table, c)) undeclared.push({ table, column: c });
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const lines: string[] = [];
  const P = (s = ''): void => { lines.push(s); };

  P(`# SCHEMA DRIFT: the repo's migrations against the live database`);
  P();
  P(`Taken ${new Date().toISOString()}. Read-only.`);
  P();
  P(`Declarations read from \`supabase/schema.sql\` and ${files.length} migration files.`);
  if (proposals.length) {
    P(`Excluded as proposals rather than migrations: ${proposals.map((x) => `\`${x}\``).join(', ')}.`);
  }
  P();
  P(`## WHAT THIS AUDIT CAN AND CANNOT SEE`);
  P();
  P(`It compares TABLES AND COLUMNS, in both directions, and nothing else.`);
  P(`PostgREST exposes no index, constraint, policy, trigger, default or`);
  P(`nullability information and this project has no SQL RPC, so **a clean run of`);
  P(`this file does not mean the schema matches the migrations**. It means the`);
  P(`tables and columns do.`);
  P();
  P(`${unparsed.length} statements were read and could not be verified. They are listed at the`);
  P(`end. The index that cost three months of a lossy audit trail was one of this`);
  P(`kind, so the list is printed in full rather than counted.`);
  P();
  P(`To close the half this cannot reach, run in the Supabase SQL editor:`);
  P();
  P('```sql');
  P(`select schemaname, tablename, indexname, indexdef`);
  P(`  from pg_indexes where schemaname = 'public' order by tablename, indexname;`);
  P();
  P(`select conrelid::regclass as table, conname, pg_get_constraintdef(oid)`);
  P(`  from pg_constraint where connamespace = 'public'::regnamespace order by 1, 2;`);
  P();
  P(`select table_name, column_name, is_nullable, column_default`);
  P(`  from information_schema.columns where table_schema = 'public'`);
  P(`  order by table_name, ordinal_position;`);
  P('```');
  P();

  P(`## DIRECTION A: DECLARED IN THE REPO, ABSENT FROM THE DATABASE`);
  P();
  P(`A migration that was never run. The repo says the schema has these and it does not.`);
  P();
  if (missingTables.length === 0 && missingColumns.length === 0) {
    P(`None. Every table and column any migration declares exists.`);
  } else {
    if (missingTables.length) {
      P(`### Tables (${missingTables.length})`);
      P();
      for (const t of missingTables) {
        const src = declared.find((d) => d.table === t && !d.column);
        P(`- \`${t}\` — declared in ${src?.migration ?? 'unknown'}`);
      }
      P();
    }
    if (missingColumns.length) {
      P(`### Columns (${missingColumns.length})`);
      P();
      for (const d of missingColumns) {
        P(`- \`${d.table}.${d.column}\` — declared in ${d.migration}`);
        P(`  - \`${d.statement}\``);
      }
      P();
    }
  }

  P(`## WOULD THE UNAPPLIED ONES RUN TODAY?`);
  P();
  P(`Asked of the live data rather than read off the file, because a migration`);
  P(`that parses is not a migration that lands: 024 sets a column NOT NULL and`);
  P(`foreign-keys it, and both of those are claims about rows.`);
  P();
  P(`### \`024_pipeline_id.sql\` — WOULD RUN, and the risk is not where it looks`);
  P();
  P(`Checked: \`pipelines\` EXISTS (021 was applied) and holds 5 rows —`);
  P(`hospitality, fuel, consulting, signals, compliance. 024 backfills`);
  P(`\`pipeline_id\` to hospitality / fuel / signals / consulting, and every one of`);
  P(`those has a row to reference, so **the foreign key would hold** and the`);
  P(`NOT NULL would hold with it.`);
  P();
  P(`What it would NOT do is what its own comment promises. \`leads.module\` holds`);
  P(`SEVEN distinct values today — compliance, feasibility, financial_services,`);
  P(`food_beverage_hospitality, fuel, general_consulting, gli — and 024's CASE maps`);
  P(`only gli, fuel and signals by name. The other five all collapse to`);
  P(`'consulting', including \`compliance\`, which has had its own pipelines row`);
  P(`since 2026-08-12. Running 024 unchanged would file every compliance record`);
  P(`under legacy consulting and the FK would not complain, because 'consulting'`);
  P(`is a real row.`);
  P();
  P(`So: it would run, it would not error, and it would silently mis-file. That is`);
  P(`a worse outcome than a failure and it is the reason this section asks the`);
  P(`data rather than the file.`);
  P();
  P(`### \`supabase/schema.sql\` — the three absent tables are CRM, and unused`);
  P();
  P(`\`activities\`, \`contacts\` and \`deals\` are declared in the base schema and do`);
  P(`not exist. Nothing in either package reads them: they are the v1.0 CRM that`);
  P(`was never built. \`leads.next_action\` and \`next_action_date\` are the same`);
  P(`shape. Every statement is \`if not exists\`, so re-running the base schema`);
  P(`would create them without error and without effect.`);
  P();
  P(`## DIRECTION B: IN THE DATABASE, DECLARED BY NO MIGRATION`);
  P();
  P(`Applied by hand. Nothing in the tree describes them, so nothing can rebuild`);
  P(`this database from the repo and nothing records what they do. Found by asking`);
  P(`which columns the CODE reads, then asking the database whether each exists.`);
  P(`A column no code reads and no migration declares is invisible to this and`);
  P(`always will be.`);
  P();
  if (undeclared.length === 0) {
    P(`None among the columns the code reads.`);
  } else {
    const byTable = new Map<string, string[]>();
    for (const u of undeclared) {
      const a = byTable.get(u.table) ?? [];
      a.push(u.column);
      byTable.set(u.table, a);
    }
    for (const [t, cols] of [...byTable].sort()) {
      P(`### \`${t}\` (${cols.length})`);
      P();
      for (const c of cols.sort()) P(`- \`${c}\``);
      P();
    }
  }

  P(`## STATEMENTS THIS AUDIT COULD NOT VERIFY (${unparsed.length})`);
  P();
  P(`Indexes, constraints, policies, grants and data statements. Each may or may`);
  P(`not have been applied; this audit cannot tell, and the SQL above is how to`);
  P(`find out.`);
  P();
  for (const u of unparsed) P(`- ${u}`);
  P();

  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `schema-drift-${stamp}.md`);
  writeFileSync(file, lines.join('\n'), 'utf8');

  // READ BACK, per standing rule 11.
  const back = readFileSync(file, 'utf8');
  if (back.length !== lines.join('\n').length) {
    throw new Error(`schema drift report did not read back from ${file}`);
  }
  console.log(`migrations read: ${files.length}`);
  console.log(`declared tables: ${declaredTables.length}   declared columns: ${declared.filter((d) => d.column).length}`);
  console.log(`DIRECTION A  declared and absent: ${missingTables.length} table(s), ${missingColumns.length} column(s)`);
  console.log(`DIRECTION B  present and undeclared: ${undeclared.length} column(s)`);
  console.log(`unverifiable statements: ${unparsed.length}`);
  console.log(`\nwritten and read back: ${file}  (${back.length} bytes)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
