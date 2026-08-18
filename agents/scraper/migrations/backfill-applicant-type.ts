// LIFT THE APPLICANT'S TYPE OUT OF raw_content AND INTO ITS OWN COLUMN.
//
//   DRY_RUN=1 node --env-file=.env.local --import tsx \
//     agents/scraper/migrations/backfill-applicant-type.ts
//   node --env-file=.env.local --import tsx \
//     agents/scraper/migrations/backfill-applicant-type.ts
//
// The nyc-zap adapter has always captured ZAP's applicant type; until migration
// 037 it had nowhere to put it but the raw_content prose line "Applicant type: X",
// which the document layer never selects and cannot query. The adapter now writes
// the column, so every record captured BEFORE that change needs the value moved.
// Without this the gate is live and reads null on all of them, which means every
// public-agency applicant already in the corpus keeps printing as a named party.
//
// IT MOVES A STORED STRING AND DERIVES NOTHING. The value is whatever the prose
// line holds, trimmed. A record whose raw_content has no such line is left null,
// because the source did not state a type and null says exactly that.
//
// raw_content IS NOT MODIFIED. The prose line stays where it is: it is the
// captured text, and rewriting captured text to tidy up a schema change is how a
// corpus stops being a primary source.
//
// IDEMPOTENT. A row whose column already matches its prose line is not rewritten.

import { supabaseAdmin } from '../../../lib/supabase-admin';

interface Row {
  id: string;
  source: string | null;
  applicant: string | null;
  applicant_type: string | null;
  raw_content: string | null;
  project_id: string | null;
  status: string | null;
}

// The line the adapter wrote, and only that line. Anchored to a line start so a
// sentence mentioning the phrase inside a description cannot be read as the field.
const LINE = /^Applicant type:\s*(.+?)\s*$/m;

function statedType(raw: string | null): string | null {
  const m = raw ? LINE.exec(raw) : null;
  const v = m?.[1]?.trim();
  return v ? v : null;
}

async function loadAll(): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,source,applicant,applicant_type,raw_content,project_id,status')
      .eq('source', 'nyc-zap')
      .range(from, from + 499);
    if (error) throw new Error(`loadAll: ${error.message}`);
    if (!data?.length) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < 500) break;
  }
  return out;
}

async function main(): Promise<void> {
  const dryRun = process.env.DRY_RUN === '1';
  const rows = await loadAll();

  const byType = new Map<string, number>();
  const toWrite: { id: string; type: string }[] = [];
  let noLine = 0;
  let already = 0;

  for (const r of rows) {
    const t = statedType(r.raw_content);
    if (!t) {
      noLine++;
      continue;
    }
    byType.set(t, (byType.get(t) ?? 0) + 1);
    if (r.applicant_type === t) already++;
    else toWrite.push({ id: r.id, type: t });
  }

  console.log('='.repeat(84));
  console.log(`BACKFILL applicant_type FROM raw_content${dryRun ? '   (DRY RUN, nothing written)' : ''}`);
  console.log('='.repeat(84));
  console.log(`  nyc-zap records          : ${rows.length}`);
  console.log(`  live (not dismissed)     : ${rows.filter((r) => r.status !== 'dismissed').length}`);
  console.log(`  no 'Applicant type:' line: ${noLine}   (left null: the source did not state one)`);
  console.log(`  already correct          : ${already}`);
  console.log(`  to write                 : ${toWrite.length}`);

  console.log('\n  types as the source states them:');
  for (const [t, n] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(n).padStart(4)}  ${t}`);
  }

  // WHO STOPS BEING NAMED, BY NAME. The point of the pass is a display change on
  // a specific set of applicants, and a count cannot be checked against the
  // filings. This prints the applicant string, its type and its project id.
  const gated = rows.filter((r) => (statedType(r.raw_content) ?? '').toLowerCase() === 'other public agency');
  console.log(`\n  APPLICANTS THAT STOP BEING PRINTED AS A NAMED PARTY: ${gated.length}`);
  for (const r of gated) {
    console.log(`      ${(r.applicant ?? '(none)').slice(0, 62).padEnd(62)}  project=${r.project_id ?? '-'}`);
  }

  if (dryRun) {
    console.log('\nDRY RUN. Nothing written.');
    return;
  }
  if (toWrite.length === 0) {
    console.log('\nNothing to do.');
    return;
  }

  let failed = 0;
  // Written per distinct type rather than per row: three values over 39 rows is
  // three statements, and a row-at-a-time loop here is 39 round trips for nothing.
  const types = [...new Set(toWrite.map((w) => w.type))];
  for (const t of types) {
    const ids = toWrite.filter((w) => w.type === t).map((w) => w.id);
    for (let i = 0; i < ids.length; i += 100) {
      const slice = ids.slice(i, i + 100);
      const { error } = await supabaseAdmin.from('leads').update({ applicant_type: t }).in('id', slice);
      if (error) {
        console.error(`  update failed for ${slice.length} rows (${t}): ${error.message}`);
        failed += slice.length;
      }
    }
  }
  console.log(`\nwrote ${toWrite.length - failed} rows, ${failed} failed. raw_content untouched.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
