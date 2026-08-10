// DISMISS THE RE-GATE CLASSES PHILIP APPROVED, CLASS BY CLASS.
//
//   npm run dismiss:regate          list them, write nothing
//   APPLY=1 npm run dismiss:regate  write
//
// A re-gate of the live government corpus found 197 records the current rules
// would drop if they arrived fresh. They were reported grouped by class and
// decided one class at a time. Four classes are approved here:
//
//   no-match                   74   CFTOD utility procurement: lift stations,
//                                   change orders, road contracts, budget items
//   weak-without-action        31   minus the held-back rows below
//   deal-detached-residential   4   Toll Brothers detached residential
//   excluded                    3   closed-session items
//
// NOT APPROVED, AND DELIBERATELY UNTOUCHED:
//
//   residential-mixed-use      85   held. 82 of 85 are attached to projects, so
//                                   dismissing them would empty a large number
//                                   of project shells, and the class overlaps
//                                   the New York rows dismissed last round.
//                                   The count is to be re-read after this
//                                   settles, not before.
//
// STATUS, NOT DELETION. Nothing is removed. Setting status back restores the row.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { decide } from '../gate-decide';
import { loadKnownEntities } from '../known-entities';

const APPLY = process.env.APPLY === '1';

const APPROVED_CLASSES = new Set(['no-match', 'weak-without-action', 'deal-detached-residential', 'excluded']);

// ---- WHAT IS HELD BACK OUT OF weak-without-action ---------------------------
//
// The brief was: hold back any row carrying a gaming term or a named private
// applicant. Applied literally that holds 6 of 31, and the other 25 include
// "220 West 42nd Street Hotel Special Permit", "23-27 Allen Street Hotel
// Special Permit", "Disney's Magnolia Golf Course Holes 14-17 Re-Development",
// "Disney's Fort Wilderness Cabin Improvements" and the Black Lake Parcel
// formerly known as Disney's Animal Kingdom Lodge. Dismissing a hotel special
// permit is not what the instruction was for.
//
// The reason the literal rule misses them is visible in WHICH weak term fired.
// 'weak-without-action' means a leisure word appeared with no entitlement verb
// beside it, and those words are not equivalent:
//
//   A VENUE NOUN is the record's subject. hotel, motel, lodge, cabin, golf,
//   gaming, spa. "220 West 42nd Street Hotel Special Permit" is about a hotel.
//
//   A DEVELOPMENT WORD is usually somebody's name or a code section.
//   redevelopment fired five times on "Clark County Redevelopment Agency",
//   which is an agency, not a project; 'mixed use' fired on four Nashville
//   Title 17 code amendments; 'recreation' on three walk-to-park site
//   selections; 'tourism' on a CFTOD territorial agreement.
//
// So a venue noun holds the row and a development word does not. That is a
// widening of the instruction, and it is called out here rather than folded in
// silently.
const VENUE_WEAK = new Set(['hotel', 'motel', 'lodge', 'cabin', 'golf', 'gaming', 'spa']);

const GAMING = /\b(gaming|casino|slot|sportsbook|wager|tribal|gambling|racino|bingo)\b/i;
// An applicant that looks like a company AND does not name a public body. Both
// halves are needed: "EDC - Economic Development Corporation for NYC" carries
// 'Corporation' and is a city agency.
const ORGANISATION = /\b(LLC|L\.L\.C|Inc\.?|Incorporated|Ltd|Corp|Corporation|Company|Holdings|Partners|Properties|Ventures|Group|LP|LLP|Trust|Associates)\b/;
const PUBLIC_BODY =
  /\b(city|county|state|department|agency|authority|commission|board|district|bureau|division|office|municipal\w*|metropolitan|government|nation|economic development)\b/i;

// Named by Philip as possibly real, so it is held whatever the rules above say.
// A row somebody has asked about by name is not a row to dismiss on a heuristic.
const HELD_BY_NAME = [/Spring Mountain/i];

interface Row {
  id: string;
  title: string | null;
  raw_content: string | null;
  market: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  manual_overrides: unknown;
  applicant: string | null;
  project_id: string | null;
}

// Reconstruct each adapter's real gate input. See dismiss-nyc-mixed-use for why
// raw_content as a whole is the wrong text to judge.
function gateTextOf(r: Row): string {
  const rc = r.raw_content ?? '';
  const line = (label: string): string => {
    const m = new RegExp(`^${label}: (.+)$`, 'm').exec(rc);
    return m ? m[1] : '';
  };
  const block = (label: string): string => {
    const i = rc.indexOf(label);
    return i < 0 ? '' : rc.slice(i + label.length);
  };
  if (r.source === 'agenda-portal') return block('--- item text ---') || (r.title ?? '');
  if (r.source === 'nyc-city-record')
    return [r.title, block('Notice: '), line('Agency')].filter(Boolean).join(' ');
  if (r.source === 'nyc-zap' || r.source === 'nyc-ceqr')
    return [r.title, line('Project brief'), line('Project description'), line('Actions')]
      .filter(Boolean)
      .join(' ');
  return r.title ?? '';
}

function curated(r: Row): boolean {
  const mo = r.manual_overrides;
  const hasOverrides =
    !!mo && typeof mo === 'object' && Object.keys(mo as Record<string, unknown>).length > 0;
  return (r.status !== null && r.status !== 'new') || !!r.notes || hasOverrides;
}

/** Why this weak-without-action row is being kept, or null to dismiss it. */
function holdReason(r: Row, weakHits: readonly string[]): string | null {
  const hay = `${r.title ?? ''} ${gateTextOf(r)}`;
  for (const re of HELD_BY_NAME) if (re.test(hay)) return 'named by Philip as possibly real';
  const venue = weakHits.find((w) => VENUE_WEAK.has(w));
  if (venue) return `the record's subject is a venue ('${venue}')`;
  if (GAMING.test(hay)) return 'carries a gaming term';
  const a = (r.applicant ?? '').trim();
  if (a && ORGANISATION.test(a) && !PUBLIC_BODY.test(a)) return `named private applicant: ${a}`;
  return null;
}

async function main(): Promise<void> {
  console.log(APPLY ? 'DISMISS RE-GATE CLASSES: APPLYING' : 'DISMISS RE-GATE CLASSES: DRY RUN (APPLY=1 to write)');
  await loadKnownEntities();

  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,raw_content,market,source,status,notes,manual_overrides,applicant,project_id')
      .eq('stream', 'government')
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  const live = rows.filter((r) => r.status !== 'dismissed');
  console.log(`government records: ${rows.length}   live: ${live.length}\n`);

  const perClass = new Map<string, Row[]>();
  const held: { r: Row; why: string }[] = [];
  const toDismiss: { r: Row; cls: string }[] = [];
  let protectedRows = 0;

  for (const r of live) {
    const d = decide({
      source: r.source ?? '',
      market: r.market ?? '',
      key: r.id,
      title: r.title ?? '',
      gate_text: gateTextOf(r),
      bypass_text: `${r.title ?? ''}\n${r.raw_content ?? ''}`,
      bypass_mode: 'none',
    });
    if (d.admitted) continue;
    const cls = d.reason;
    perClass.set(cls, [...(perClass.get(cls) ?? []), r]);
    if (!APPROVED_CLASSES.has(cls)) continue;

    if (curated(r)) {
      protectedRows++;
      continue;
    }
    if (cls === 'weak-without-action') {
      const why = holdReason(r, d.verdict.weakHits);
      if (why) {
        held.push({ r, why });
        continue;
      }
    }
    toDismiss.push({ r, cls });
  }

  console.log('EVERY REJECTED CLASS, for context:');
  for (const [k, v] of [...perClass].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${String(v.length).padStart(4)}  ${k}${APPROVED_CLASSES.has(k) ? '' : '   (HELD, not approved)'}`);
  }

  console.log(`\nHELD BACK out of weak-without-action: ${held.length}`);
  for (const h of held) {
    console.log(`  [${h.r.market}] ${String(h.r.title).replace(/\s+/g, ' ').slice(0, 66)}`);
    console.log(`      ${h.why}`);
  }

  const byClass = new Map<string, number>();
  for (const t of toDismiss) byClass.set(t.cls, (byClass.get(t.cls) ?? 0) + 1);
  console.log(`\n${APPLY ? 'DISMISSING' : 'WOULD DISMISS'}: ${toDismiss.length}`);
  for (const [k, v] of [...byClass].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${k}`);
  console.log(`  curated rows protected: ${protectedRows}`);

  if (APPLY) {
    for (const t of toDismiss) {
      const { error } = await supabaseAdmin.from('leads').update({ status: 'dismissed' }).eq('id', t.r.id);
      if (error) throw new Error(`dismiss failed for ${t.r.id}: ${error.message}`);
    }
    console.log('\nRun the project recount next, so record counts follow the dismissals.');
  } else {
    console.log('\nNothing was written. APPLY=1 to write.');
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
