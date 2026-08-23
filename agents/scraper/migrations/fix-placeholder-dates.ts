// RE-DERIVE published_date FOR RECORDS CARRYING A FAR-FUTURE PLACEHOLDER.
//
//   npm run fix:placeholder-dates             report only, writes nothing
//   npm run fix:placeholder-dates -- --apply  write the re-derived date
//
// The rule now lives in deriveLeadDates (see notAPlaceholder there and the
// thirty-day note above it), so this is a one-off correction of rows written
// before it. Nothing is deleted and no row is dismissed: the date is re-derived
// through the same ladder a fresh capture would use, so a record keeps a date and
// its date_source says which kind it is.
//
// WHY IT MATTERS MORE THAN A WRONG NUMBER ON A SCREEN. The Legistar incremental
// cursor is taken from the newest stored date for a jurisdiction. Phoenix's three
// 2026-12-31 permits put its cursor at 2026-12-01, so the 2026-08-23 harvest
// fetched "0 matters since 2026-12-01" - a whole jurisdiction silently unread.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { deriveLeadDates, FUTURE_DATE_LIMIT_DAYS } from '../lead-date';
import type { NormalizedLead } from '../sources/types';

const APPLY = process.argv.includes('--apply');

interface Row {
  id: string;
  market: string | null;
  source: string | null;
  title: string | null;
  raw_content: string | null;
  published_date: string | null;
  deadline: string | null;
  date_source: string | null;
  status: string | null;
  lifecycle: string | null;
}

async function main(): Promise<void> {
  console.log(APPLY ? '=== FIXING PLACEHOLDER DATES ===' : '=== REPORT ONLY (pass --apply to write) ===');
  console.log(`limit: a published_date more than ${FUTURE_DATE_LIMIT_DAYS} days ahead is a placeholder\n`);

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,market,source,title,raw_content,published_date,deadline,date_source,status,lifecycle')
      .range(from, from + 999);
    if (error) throw new Error(`leads read failed: ${error.message}`);
    const r = (data ?? []) as Row[];
    rows.push(...r);
    if (r.length < 1000) break;
  }
  console.log(`leads read: ${rows.length}   [paged to exhaustion, NO CAP]`);

  const now = Date.now();
  const limit = FUTURE_DATE_LIMIT_DAYS * 86_400_000;
  const todo = rows.filter(
    (r) =>
      r.status !== 'dismissed' &&
      r.lifecycle !== 'retired' &&
      r.published_date &&
      Date.parse(r.published_date) - now > limit
  );

  console.log(`\nrecords carrying a placeholder: ${todo.length}`);
  const byMarket = new Map<string, number>();
  for (const r of todo) byMarket.set(String(r.market ?? '(none)'), (byMarket.get(String(r.market ?? '(none)')) ?? 0) + 1);
  for (const [m, n] of [...byMarket].sort((a, b) => b[1] - a[1])) console.log(`  ${m.padEnd(28)} ${n}`);

  const plan = todo.map((r) => {
    const next = deriveLeadDates(
      {
        title: r.title ?? '',
        raw_content: r.raw_content ?? '',
        published_date: r.published_date,
        deadline: r.deadline,
      } as unknown as NormalizedLead,
      'government',
      now
    );
    return { row: r, next };
  });

  console.log('');
  for (const { row, next } of plan) {
    console.log(
      `  ${String(row.market).padEnd(12)} ${String(row.published_date).slice(0, 10)} -> ` +
        `${String(next.published_date ?? 'null').slice(0, 10)}  (date_source ${row.date_source} -> ${next.date_source})`
    );
    console.log(`      ${String(row.title).slice(0, 84)}`);
  }

  if (!APPLY) {
    console.log(`\nWOULD FIX: ${plan.length} records. Pass --apply to write.`);
    return;
  }

  let written = 0;
  for (const { row, next } of plan) {
    const { error } = await supabaseAdmin
      .from('leads')
      .update({ published_date: next.published_date, date_source: next.date_source })
      .eq('id', row.id);
    if (error) throw new Error(`write failed for ${row.id}: ${error.message}`);
    written++;
  }
  console.log(`\nwritten: ${written}`);

  // READ IT BACK OFF THE DATABASE, and report the newest date per affected market
  // because that is the value the cursor is taken from.
  for (const m of byMarket.keys()) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('published_date')
      .eq('market', m)
      .neq('status', 'dismissed')
      .order('published_date', { ascending: false })
      .limit(1);
    if (error) throw new Error(`read-back failed: ${error.message}`);
    console.log(`  read back ${m}: newest published_date is now ${(data ?? [])[0]?.published_date ?? 'none'}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
