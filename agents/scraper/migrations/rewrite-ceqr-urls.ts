// REPLACE THE DEAD CEQR ACCESS LINKS.
//
// Every stored nyc-ceqr row points at
//
//     https://a002-ceqraccess.nyc.gov/ceqr/ProjectInformation/ProjectDetail/{id}-{ceqr}
//
// and every one of those is dead. The host answers HTTP 200 with an 8,949-byte
// "Page Not Found" body for every id, valid or invented, so nothing on that
// host resolves and no fetch check that reads only the status can tell.
//
// This rewrites each row's url to the NYC Open Data view of the CEQR Projects
// dataset filtered to that CEQR number - the publisher of the record, which
// does resolve and does show the row.
//
// UPDATE IN PLACE, NEVER RE-INSERT. url is the upsert key. The CEQAnet host
// change is the precedent: ceqanet.opr.ca.gov became ceqanet.lci.ca.gov and
// every filing is now stored twice, because the new URL looked like a new row.
// Writing the new URL through the scraper would repeat that exactly. So this
// UPDATEs the existing id, and refuses to write a URL that already belongs to a
// different row.
//
// DRY by default. APPLY=1 to write.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { ceqrProjectUrl, normalizeCeqr } from '../sources/nyc-ceqr';

const APPLY = process.env.APPLY === '1';
const DEAD_HOST = 'a002-ceqraccess.nyc.gov';

interface Row {
  id: string;
  title: string | null;
  url: string;
  primary_document_url: string | null;
  raw_content: string | null;
}

// The CEQR number is the tail of the dead path's last segment: "17013-24DPR004X".
// Taken from the URL rather than from a separate column so the rewrite is a pure
// function of what is stored, and a row whose number cannot be read is skipped
// rather than guessed at.
export function ceqrFromDeadUrl(url: string): string | null {
  const seg = url.split('/').filter(Boolean).pop() ?? '';
  const tail = seg.includes('-') ? seg.slice(seg.indexOf('-') + 1) : seg;
  return normalizeCeqr(tail);
}

async function main(): Promise<void> {
  console.log(APPLY ? 'REWRITE CEQR URLS: APPLYING' : 'REWRITE CEQR URLS: DRY RUN (APPLY=1 to write)');

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,url,primary_document_url,raw_content')
      .like('url', `%${DEAD_HOST}%`)
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  console.log(`rows pointing at ${DEAD_HOST}: ${rows.length}\n`);

  let rewritten = 0;
  let unreadable = 0;
  let collided = 0;

  for (const r of rows) {
    const ceqr = ceqrFromDeadUrl(r.url);
    const next = ceqr ? ceqrProjectUrl(ceqr) : null;
    if (!ceqr || !next) {
      unreadable++;
      console.log(`  SKIP (no CEQR number in path)  ${r.url}`);
      continue;
    }

    // Would this URL land on top of a different row?
    const { data: clash, error: cerr } = await supabaseAdmin
      .from('leads')
      .select('id')
      .eq('url', next)
      .neq('id', r.id)
      .limit(1);
    if (cerr) throw new Error(cerr.message);
    if (clash && clash.length) {
      collided++;
      console.log(`  SKIP (url already held by ${clash[0].id})  ${ceqr}`);
      continue;
    }

    console.log(`  ${ceqr.padEnd(12)} ${String(r.title ?? '').slice(0, 54)}`);
    if (rewritten < 3) console.log(`      -> ${next}`);

    if (APPLY) {
      // raw_content quotes the URL too. Left alone except for the dead link
      // line, which the adapter now labels; rewriting free text by search and
      // replace risks corrupting a document body to fix a link.
      const { error: uerr } = await supabaseAdmin
        .from('leads')
        .update({ url: next, primary_document_url: next })
        .eq('id', r.id);
      if (uerr) throw new Error(`rewrite failed for ${r.id}: ${uerr.message}`);
    }
    rewritten++;
  }

  console.log(
    `\n${APPLY ? 'rewritten' : 'would rewrite'}: ${rewritten}  unreadable: ${unreadable}  collided: ${collided}`
  );
  if (!APPLY) console.log('Nothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
