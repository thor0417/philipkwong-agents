// One-off: rewrite stored Legistar government URLs to the verified public InSite
// citizen URL. The old rows used LegislationDetail/MeetingDetail with the Web API's
// MatterId/EventId, which the public viewer rejects as "Invalid parameters!" (the
// InSite ids differ from the API ids). This resolves each record's correct citizen
// URL via gateway.aspx (302 -> real detail page), verifying by fetch before writing,
// and falls back to the jurisdiction's public search (matters) / calendar (events)
// page for records not published to the public portal. Never stores a URL that
// errors. Idempotent: re-running re-resolves from the stored id and is a no-op when
// nothing changed.
//   node --env-file=.env.local --import tsx agents/scraper/migrations/fix-legistar-urls.ts
// DRY_RUN=1 previews without writing.

import { supabaseAdmin } from '../../../lib/supabase-admin';
import { publicMatterUrl, publicEventUrl } from '../sources/legistar';

interface Row {
  id: string;
  url: string;
}

// Parse the jurisdiction client + record kind + Web-API id from a stored URL,
// tolerating both the old detail form and the new gateway form (idempotency).
function parseStored(u: string): { client: string; kind: 'matter' | 'event' | 'other'; id: number } {
  let host = '';
  try {
    host = new URL(u).host;
  } catch {
    /* leave host empty -> skipped */
  }
  const client = host.split('.')[0] ?? '';
  const patterns: { re: RegExp; kind: 'matter' | 'event' }[] = [
    { re: /LegislationDetail\.aspx\?ID=(\d+)/i, kind: 'matter' },
    { re: /gateway\.aspx\?M=l&ID=(\d+)/i, kind: 'matter' },
    { re: /Legislation\.aspx#matter-(\d+)/i, kind: 'matter' },
    { re: /MeetingDetail\.aspx\?ID=(\d+)/i, kind: 'event' },
    { re: /gateway\.aspx\?M=e&ID=(\d+)/i, kind: 'event' },
    { re: /Calendar\.aspx#event-(\d+)/i, kind: 'event' },
  ];
  for (const p of patterns) {
    const m = u.match(p.re);
    if (m) return { client, kind: p.kind, id: Number(m[1]) };
  }
  return { client, kind: 'other', id: 0 };
}

async function main(): Promise<void> {
  const dry = process.env.DRY_RUN === '1';
  const { data, error } = await supabaseAdmin.from('leads').select('id, url').eq('source', 'legistar');
  if (error) {
    console.error('Fetch failed:', error.message);
    process.exit(1);
  }
  const rows = (data ?? []) as Row[];

  let matterResolved = 0;
  let matterSearchFallback = 0;
  let eventCalendarFallback = 0;
  let eventResolved = 0;
  let unchanged = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of rows) {
    const p = parseStored(r.url);
    if (p.kind === 'other' || !p.client || !p.id) {
      skipped++;
      continue;
    }
    const newUrl = p.kind === 'matter' ? await publicMatterUrl(p.client, p.id) : await publicEventUrl(p.client, p.id);

    if (newUrl.includes('gateway.aspx?M=l')) matterResolved++;
    else if (newUrl.includes('Legislation.aspx#')) matterSearchFallback++;
    else if (newUrl.includes('gateway.aspx?M=e')) eventResolved++;
    else if (newUrl.includes('Calendar.aspx#')) eventCalendarFallback++;

    if (newUrl === r.url) {
      unchanged++;
      continue;
    }
    if (dry) continue;
    const { error: e } = await supabaseAdmin.from('leads').update({ url: newUrl }).eq('id', r.id);
    if (e) {
      console.error(`Update failed for ${r.id}: ${e.message}`);
      failed++;
    }
  }

  console.log(`\n===== LEGISTAR URL FIX =====${dry ? '  (DRY_RUN: no writes)' : ''}`);
  console.log(`Legistar rows scanned:            ${rows.length}`);
  console.log(`Matters -> gateway (real record): ${matterResolved}`);
  console.log(`Matters -> search fallback:       ${matterSearchFallback}`);
  console.log(`Events  -> gateway (real record): ${eventResolved}`);
  console.log(`Events  -> calendar fallback:     ${eventCalendarFallback}`);
  console.log(`Unchanged (already correct):      ${unchanged}`);
  console.log(`Skipped (unrecognized url):       ${skipped}`);
  console.log(`Write failures:                   ${failed}`);
  console.log('============================\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
