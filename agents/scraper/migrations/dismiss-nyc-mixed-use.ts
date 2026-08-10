// DISMISS THE NEW YORK RECORDS THE CALIBRATED GATE NO LONGER ADMITS.
//
//   npm run dismiss:nyc-mixed-use          list them, write nothing
//   APPLY=1 npm run dismiss:nyc-mixed-use  write
//
// The mixed-use rule is now calibrated for New York (lib/taxonomy,
// UNSCALED_MIXED_USE_MARKETS): a record whose only leisure signal is the phrase
// "mixed use", with no strong term, is no longer admitted there regardless of
// whether it states a unit count. DCP writes that phrase on nearly every
// residential rezoning in the ULURP pipeline, so in New York it carries no
// information.
//
// The gate change only governs what is HARVESTED NEXT. These rows are already
// stored, and they stay visible until dismissed.
//
// STATUS, NOT DELETION. Nothing is removed; status moves to 'dismissed', the
// register's read paths exclude it, and setting the status back restores it.
//
// EVERY ROW IS RE-GATED HERE RATHER THAN READ FROM A LIST. A hardcoded set of
// ids would be a snapshot of one measurement, and could not be re-run after the
// rule moved again. This asks the current gate the current question.
//
// A CURATED ROW IS REPORTED, NEVER DISMISSED. Any record Philip has touched -
// a status other than 'new', notes, or manual_overrides - is his decision, and
// the same guard the other dismissal migrations use protects it here.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { governmentGate } from '../../../lib/taxonomy';

const APPLY = process.env.APPLY === '1';
const MARKET = 'New York City';

// SPARED BY NAME, BECAUSE A LABEL OUTRANKS A HEURISTIC.
//
// Both of these carry a ground-truth relevance label from the calibration set,
// and both are city land dispositions - the earliest signal this register
// exists to catch. The calibrated gate rejects them because their only leisure
// vocabulary is "mixed use"; the label says the gate is wrong about these two
// specifically. A measured exception beats an unmeasured rule on the records
// where measurement exists.
//
// THIS LIST IS THE RECORD OF WHY. A future re-gate that sweeps the same
// population will find them here rather than silently dismissing them, and a
// note is written onto each row so the decision is visible in the register too.
//
// NOT A PERMANENT FIX. If 'UDAAP' or a disposition term turns out to mark
// relevant mixed-use records reliably, that belongs in the gate as a rule with
// a number attached, and this list should shrink to nothing. See the commit.
const SPARED: { url: string; why: string }[] = [
  {
    url: 'https://zap.planning.nyc.gov/projects/P2015M0428',
    why: 'labelled relevant: UDAAP disposition and rezoning deal for mixed-use affordable development',
  },
  {
    url: "https://data.cityofnewyork.us/City-Government/CEQR-Projects/gezn-7mgk/explore/query/SELECT%20*%20WHERE%20ceqr%3D'22HPD058Q'/page/filter",
    why: 'labelled relevant: City land disposition and UDAAP deal for mixed-use development',
  },
];

interface Row {
  id: string;
  title: string | null;
  url: string;
  source: string | null;
  status: string | null;
  notes: string | null;
  manual_overrides: unknown;
  market: string | null;
  raw_content: string | null;
  project_id: string | null;
}

// RE-GATE ON WHAT THE GATE ACTUALLY SAW, NOT ON THE WHOLE STORED DOCUMENT.
//
// raw_content is the document we assembled for a reader: it carries the
// adapter's own provenance lines ("Gate: strong"), the meeting's boilerplate,
// and for a City Record notice the full text of every matter on the calendar.
// The gate never read any of that. Its input was the record's own subject -
// project name plus brief, or short title plus notice description.
//
// The difference is not academic. Gating the whole document refused 76 rows;
// reconstructing the real input refused 73, and the 22 rows that differed were
// Board of Standards hearing notices where the phrase "mixed use" appears in
// somebody else's matter further down the same calendar page. Dismissing a
// record for words the gate never saw is not applying the rule, it is applying
// a different and unstated one.
//
// A STORED gate_text COLUMN WOULD MAKE THIS EXACT. This reconstruction is the
// closest available approximation and is written out here so it can be checked.
function gateTextOf(r: Row): string {
  const rc = r.raw_content ?? '';
  const line = (label: string): string => {
    const m = new RegExp(`^${label}: (.+)$`, 'm').exec(rc);
    return m ? m[1] : '';
  };
  if (r.source === 'nyc-city-record') {
    // The notice body runs to the end of the document.
    const at = rc.indexOf('Notice: ');
    const body = at < 0 ? '' : rc.slice(at + 'Notice: '.length);
    return [r.title, body, line('Agency'), line('Notice type')].filter(Boolean).join(' ');
  }
  return [r.title, line('Project brief'), line('Project description'), line('Actions'), line('Lead agency')]
    .filter(Boolean)
    .join(' ');
}

function curated(r: Row): boolean {
  const mo = r.manual_overrides;
  const hasOverrides =
    !!mo && typeof mo === 'object' && Object.keys(mo as Record<string, unknown>).length > 0;
  return (r.status !== null && r.status !== 'new') || !!r.notes || hasOverrides;
}

async function main(): Promise<void> {
  console.log(APPLY ? 'DISMISS NYC MIXED-USE: APPLYING' : 'DISMISS NYC MIXED-USE: DRY RUN (APPLY=1 to write)');

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,url,source,status,notes,manual_overrides,market,raw_content,project_id')
      .eq('market', MARKET)
      .eq('stream', 'government')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }

  const live = rows.filter((r) => r.status !== 'dismissed');
  console.log(`${MARKET} government records: ${rows.length}   not already dismissed: ${live.length}\n`);

  // Admitted under the old global rule, refused under the calibrated one.
  const targets = live.filter((r) => {
    const text = gateTextOf(r);
    return governmentGate(text).matched && !governmentGate(text, r.market).matched;
  });

  let dismissed = 0;
  let protectedRows = 0;

  const spared = new Map(SPARED.map((s) => [s.url, s.why]));
  let sparedCount = 0;

  for (const r of targets) {
    const why = spared.get(r.url);
    if (why) {
      sparedCount++;
      console.log(`  SPARED  ${String(r.title).slice(0, 62)}`);
      console.log(`          ${why}`);
      if (APPLY) {
        // Written onto the row as well as recorded in this file, so the reason
        // is visible where the record is read and not only where it was made.
        const { error } = await supabaseAdmin
          .from('leads')
          .update({ notes: `Kept through the NYC mixed-use gate calibration. ${why}` })
          .eq('id', r.id);
        if (error) throw new Error(`note failed for ${r.id}: ${error.message}`);
      }
      continue;
    }
    if (curated(r)) {
      protectedRows++;
      console.log(`  CURATED, left alone: ${String(r.title).slice(0, 66)}`);
      continue;
    }
    console.log(`  ${String(r.source ?? '').padEnd(16)} ${String(r.title).slice(0, 68)}`);
    if (APPLY) {
      const { error } = await supabaseAdmin
        .from('leads')
        .update({ status: 'dismissed' })
        .eq('id', r.id);
      if (error) throw new Error(`dismiss failed for ${r.id}: ${error.message}`);
    }
    dismissed++;
  }

  console.log(
    `\nrefused by the calibrated gate: ${targets.length}   ` +
      `${APPLY ? 'dismissed' : 'would dismiss'}: ${dismissed}   spared by label: ${sparedCount}   curated, protected: ${protectedRows}`
  );
  // A dismissed record leaves its project's record_count stale. The recount is
  // a separate, idempotent step rather than something this migration does
  // halfway; run it after applying.
  if (APPLY) console.log('Run project recount next, so record counts follow the dismissals.');
  if (!APPLY) console.log('Nothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
