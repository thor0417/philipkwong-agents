// CORPUS SNAPSHOT, for the isolation proof a scoped run has to produce.
//
//   node --env-file=.env.local --import tsx agents/scraper/corpus-snapshot.ts > before.json
//   npm run scrape:government -- --market="..."
//   node --env-file=.env.local --import tsx agents/scraper/corpus-snapshot.ts > after.json
//
// docs/ADDING-A-MARKET.md step 7 asks for per-market, per-source and per-stream
// counts before and after, because the claim worth making is not "the run was
// scoped" but "every other market's count is identical", and only a diff shows
// that. This existed as a throwaway script the first two times it was needed;
// it is checked in now because the runbook asks for it on every market.
//
// Counting happens client-side over a paged scan rather than through a grouped
// query, because PostgREST has no GROUP BY and the alternative is a database
// view this repo would then have to migrate.
import { supabaseAdmin } from '../../lib/supabase-admin';

async function tally(column: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const PAGE = 1000;
  let attempts = 0;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select(column)
      .range(from, from + PAGE - 1);
    if (error) {
      // Supabase's edge intermittently returns "JWT issued at future" on the
      // sb_secret key path. Retry rather than abandoning the snapshot.
      if (/issued at future|JWT/i.test(error.message) && attempts < 5) {
        attempts++;
        await new Promise((r) => setTimeout(r, 800 * attempts));
        from -= PAGE;
        continue;
      }
      throw new Error(`${column}: ${error.message}`);
    }
    if (!data || data.length === 0) break;
    for (const row of data as unknown as Record<string, unknown>[]) {
      const k = String(row[column] ?? '(null)');
      out[k] = (out[k] ?? 0) + 1;
    }
    if (data.length < PAGE) break;
  }
  return out;
}

async function projectCount(): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from('projects')
    .select('*', { count: 'exact', head: true });
  if (error) return -1;
  return count ?? -1;
}

async function main(): Promise<void> {
  // Sequential, not Promise.all: four concurrent paged scans is what surfaced
  // the intermittent edge error, and a snapshot is not worth parallelising.
  const market = await tally('market');
  const source = await tally('source');
  const stream = await tally('stream');
  const objectType = await tally('object_type');
  const projects = await projectCount();
  const { count: leadCount } = await supabaseAdmin
    .from('leads')
    .select('*', { count: 'exact', head: true });
  console.log(
    JSON.stringify({ leads: leadCount, projects, market, source, stream, objectType }, null, 2)
  );
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
