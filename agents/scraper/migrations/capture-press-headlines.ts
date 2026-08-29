// RECOVER THE HEADLINE A SEARCH RESULT CUT OFF.
//
//   npm run capture:headlines              report only, writes nothing
//   npm run capture:headlines -- --write   apply
//
// A client brief printed "Southern California gets $4B mega music venue in
// giant ..." as a record line. The ellipsis is not ours. A SERP title is cut to
// fit a column of pixels, and we stored the cut string as the record's title.
// Measured: 43 records on live projects carry a title ending in an ellipsis,
// concentrated on the projects a client actually reads - 10 on Heart Hotel,
// 7 on OCVibe, 6 on Top Gun Las Vegas, 4 on Metropolitan Park.
//
// IT IS NOT RECOVERABLE FROM WHAT WE HOLD, WHICH IS WHY THIS FETCHES. Every one
// of the 43 has a stored body, so the obvious move was to read the headline out
// of it. Measured: 4 of 43, and two of those four "full" strings are themselves
// snippets carrying their own ellipsis. What capture:press-bodies stores for a
// Serper record is the search result's description, not the article page.
//
// THE GUARD, AND WHY IT IS THE WHOLE POINT. A fetched page can be a paywall, a
// consent interstitial, a soft 404 or a site's front page, and each of those has
// a title that is confidently wrong. So a fetched title is accepted ONLY when it
// begins with the head we already hold, compared on letters and digits alone.
// Where it does not, the record keeps its ellipsis: a truncated true headline is
// worth more than a complete false one, and this is the same refusal as
// verifyFilingFacts making a display prove itself against the document.
//
// The site suffix is kept. "OCVibe announces March opening for new 5,000-seat
// concert hall - Orange County Register" is what the publication calls the page,
// and trimming the tail off is a rule about names that would need its own
// evidence. The publisher is printed beside the headline anyway.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { isHospitalityModule } from '../pipelines';
import { inCorpusScope } from '../../../lib/corpus-scope';

const WRITE = process.argv.includes('--write');
const UA =
  'Mozilla/5.0 (compatible; philipkwong-agents/1.0; +development intelligence research)';

// A trailing ellipsis, as a search result writes it: a space then three dots, or
// the single-character ellipsis, at the very end of the string.
const CUT = /(\s|…)(\.\.\.|…)\s*$/;

interface Lead {
  id: string;
  title: string | null;
  url: string | null;
  status: string | null;
  project_id: string | null;
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

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

/** og:title first, because it is the headline; <title> second. */
function titleOf(html: string): string | null {
  const og =
    /<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']{6,300})["']/i.exec(html) ??
    /<meta[^>]+content=["']([^"']{6,300})["'][^>]*property=["']og:title["']/i.exec(html);
  if (og) return decode(og[1]);
  const t = /<title[^>]*>([\s\S]{6,300}?)<\/title>/i.exec(html);
  return t ? decode(t[1]) : null;
}

/** Letters and digits only, lowercased: punctuation and dashes vary between a
 *  SERP title and the page's own, and none of that variation is meaning. */
function key(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function fetchTitle(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
      redirect: 'follow',
      signal: AbortSignal.timeout(25_000),
    });
    if (!res.ok) return null;
    const type = String(res.headers.get('content-type') ?? '');
    if (!/html/i.test(type)) return null;
    // The head is enough and a long article is not worth reading.
    const html = (await res.text()).slice(0, 200_000);
    return titleOf(html);
  } catch {
    return null;
  }
}

async function main(write = WRITE): Promise<void> {
  const projects = await pageAll<{
    id: string;
    name: string;
    module: string | null;
    status: string | null;
    country: string | null;
    stage: string | null;
  }>('projects', 'id,name,module,status,country,stage');
  const live = new Map(
    projects
      .filter(
        (p) =>
          isHospitalityModule(p.module) &&
          p.status !== 'dismissed' &&
          inCorpusScope(p.country) &&
          p.stage !== 'dormant'
      )
      .map((p) => [p.id, p.name])
  );

  const leads = await pageAll<Lead>('leads', 'id,title,url,status,project_id');
  const targets = leads.filter(
    (l) =>
      l.status !== 'dismissed' &&
      l.project_id &&
      live.has(l.project_id) &&
      l.url &&
      CUT.test(String(l.title ?? ''))
  );

  console.log('='.repeat(96));
  console.log(`PRESS HEADLINES  ${write ? '(WRITING)' : '(dry run, nothing written)'}`);
  console.log('='.repeat(96));
  console.log(`  records whose title was cut by the search result: ${targets.length}`);
  console.log('');

  let recovered = 0;
  let refused = 0;
  let unreachable = 0;
  let written = 0;

  for (const l of targets) {
    const fetched = await fetchTitle(String(l.url));
    await new Promise((r) => setTimeout(r, 350));
    const head = String(l.title ?? '').replace(CUT, '').trim();
    if (!fetched) {
      unreachable++;
      console.log(`  UNREACHABLE  ${head.slice(0, 66)}`);
      continue;
    }
    // THE GUARD. The page's own title must begin with the head we hold.
    if (!key(fetched).startsWith(key(head))) {
      refused++;
      console.log(`  REFUSED      ${head.slice(0, 50)}`);
      console.log(`      page says: ${fetched.slice(0, 78)}`);
      continue;
    }
    recovered++;
    console.log(`  ${head.slice(0, 46).padEnd(47)} -> ${fetched.slice(0, 78)}`);
    if (!write) continue;
    const { error } = await supabaseAdmin.from('leads').update({ title: fetched }).eq('id', l.id);
    if (error) {
      console.log(`  WRITE FAILED ${l.id}: ${error.message}`);
      continue;
    }
    written++;
  }

  console.log('');
  console.log('-'.repeat(96));
  console.log(`  headlines recovered and verified: ${recovered}`);
  console.log(`  refused by the guard:             ${refused}   (title kept as it was)`);
  console.log(`  page unreachable:                 ${unreachable}   (title kept as it was)`);
  console.log(`  records written:                  ${written}`);
  if (!write) console.log('\nDRY RUN. Nothing written. Re-run with --write to apply.');
  console.log('');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
