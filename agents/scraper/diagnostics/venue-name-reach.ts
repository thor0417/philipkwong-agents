// A VENUE NOUN INSIDE A PROPER NAME IS NOT A VENUE. HOW FAR DOES IT REACH?
//
//   npm run diag:venue-name-reach
//
// PLAN_NAME already handles ONE shape of this: "<Name> Redevelopment Plan".
// The backfill cohort produced fifteen more it does not reach - a street called
// Casino Center Drive, a licensee called Arena Sports Grill, a school called
// Museum Magnet, a code definition for an Inflatable Amusement Device. This
// measures the whole corpus rather than the cohort, because reach decides
// whether a new rule is worth its own risk.
//
// IT FINDS THE LOAD-BEARING WORD BY ABLATION, NOT BY A COPIED VOCABULARY.
// The first version carried its own list of venue words and reported the first
// one it found, which is not the one that decided anything: "Desert Inn Road"
// made 16 records look like they classified on 'inn' when the venue came from
// elsewhere. So every distinct word is blanked in turn and classifyVenueType is
// asked again; a word whose removal changes the answer is the word the answer
// rests on. The real classifier makes every decision here.
//
// AND IT TESTS ADJACENCY, NOT A WINDOW. The second version asked whether a
// street suffix or an "LLC" appeared anywhere within 55 characters, which
// convicts the innocent: "MSG Arena LLC" really is an arena, and "Athletics
// StadCo LLC for a recreational facility (baseball stadium)" really is a
// stadium - the corporate suffix just happened to be nearby. What matters is
// whether the venue word sits INSIDE the name, so each construct below is
// anchored to the word itself.
//
// Nothing here changes a stored value. Every bucket is written out with samples
// so the judgement is made on the text rather than on the count.
import { writeFileSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { classifyVenueType, venueReadableText } from '../../../lib/taxonomy';

const OUT = 'snapshots/venue-name-reach.json';
const CAP = 2500; // chars of raw_content considered, so the ablation stays tractable

const STREET = String.raw`(?:Drive|Street|Avenue|Boulevard|Road|Lane|Way|Place|Court|Parkway|Highway|Blvd|Ave|Rd|Dr)`;
const CORP = String.raw`(?:LLC|L\.L\.C|Inc|Incorporated|Corporation|Corp|Company|LP|Ltd|Limited|Partnership|Holdings|Associates)`;
const INSTITUTION = String.raw`(?:Association|Magnet|School|Academy|University|College|Library|Ministries|Church|Authority|Commission|Institute|District|Society|Foundation|Grill|Bar|Lounge|Club|Cafe)`;

/**
 * Is the load-bearing word part of a name, rather than the record's subject?
 * Each test is anchored to the word, so a corporate suffix merely nearby does
 * not convict. `w` is lower case; the text keeps its original casing.
 */
function nameConstruct(text: string, w: string): string | null {
  const W = w.replace(/[.*+?^${}()|[\]\\-]/g, String.raw`\$&`);
  const cap = String.raw`[A-Z][\w'&.-]*`;
  // The organisation tests run case-SENSITIVELY, because a venue noun only sits
  // inside a proper name when it is itself capitalised: "Arena Sports Grill" is
  // a name, "an arena" is a subject. The ablation hands us a lower-cased word,
  // so capitalise it before asking. Without this the case-sensitive tests could
  // never fire at all, which is how the first run reported zero of them.
  const Wc = W.charAt(0).toUpperCase() + W.slice(1);

  // "Casino Center Drive", "Convention Center Drive", "Desert Inn Road":
  // the word, then at most two more capitalised tokens, then a street suffix.
  if (new RegExp(String.raw`\b${W}\b(?:\s+${cap}){0,2}\s+${STREET}\b`, 'i').test(text)) return 'street name';

  // "Shemer Art Center and Museum Association, Inc.", "Arena Sports Grill":
  // the word inside a run of capitalised tokens closed by a corporate or
  // institutional suffix. The word itself must be capitalised to count.
  if (new RegExp(String.raw`\b${Wc}\b(?:\s+(?:and\s+|of\s+|&\s+)?${cap}){0,4}[,]?\s+(?:${CORP}|${INSTITUTION})\b`).test(text)) return 'organisation name';
  if (new RegExp(String.raw`(?:${cap}\s+){1,4}${Wc}(?:\s+${cap}){0,3}[,]?\s+(?:${CORP}|${INSTITUTION})\b`).test(text)) return 'organisation name';

  // "definitions for Inflatable Amusement Device"
  if (new RegExp(String.raw`(?:definitions?\s+for|as\s+defined\s+(?:in|by)|the\s+term)\b[^.]{0,60}\b${W}\b`, 'i').test(text)) return 'code definition';

  // "Corridor Mixed-Use (CM)", "Entertainment Mixed-Use (EM)": a land use
  // CATEGORY name, which names a designation and not a building.
  if (new RegExp(String.raw`\b${W}[\w-]*\s*\((?:CM|EM|MN|CN|UN|LN|BE|OL|RN|CR|H-1|C-2)\)`, 'i').test(text)) return 'land use category';
  if (new RegExp(String.raw`land\s+use\s+category[^.]{0,80}\b${W}\b`, 'i').test(text)) return 'land use category';

  // "<Name> Redevelopment Plan" - already neutralised by PLAN_NAME, kept so the
  // measurement shows it reaching zero rather than being silently absent.
  if (new RegExp(String.raw`\b${W}\b[^.]{0,40}Redevelopment\s+Plan\b`, 'i').test(text)) return 'redevelopment plan';

  return null;
}

interface Row {
  id: string;
  title: string | null;
  raw_content: string | null;
  venue_type: string | null;
  project_id: string | null;
  market: string | null;
}

const PAGE = 1000;

async function main() {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, title, raw_content, venue_type, project_id, market')
      .neq('status', 'dismissed')
      .neq('lifecycle', 'retired')
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || !data.length) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE) break;
  }

  const findings: Record<string, { count: number; samples: { market: string | null; window: string }[] }> = {};
  const standsAlone: Record<string, number> = {};
  const aloneSamples: string[] = [];
  const affectedProjects = new Set<string>();
  let classified = 0;
  let noLoadBearingWord = 0;

  for (const r of rows) {
    const text = `${r.title ?? ''} ${(r.raw_content ?? '').slice(0, CAP)}`;
    const base = classifyVenueType(text);
    if (!base) continue;
    classified++;

    const readable = venueReadableText(text);
    const words = [...new Set(readable.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? [])];
    let found = false;
    for (const w of words) {
      const esc = w.replace(/[.*+?^${}()|[\]\\-]/g, String.raw`\$&`);
      const re = new RegExp(String.raw`\b` + esc + String.raw`\b`, 'gi');
      if (classifyVenueType(text.replace(re, ' ')) === base) continue;

      const m = new RegExp(String.raw`\b` + esc + String.raw`\b`, 'i').exec(readable);
      const i = m ? m.index : readable.toLowerCase().indexOf(w);
      const win = readable.slice(Math.max(0, i - 60), i + w.length + 60).replace(/\s+/g, ' ').trim();
      const con = nameConstruct(readable, w);
      if (con) {
        const key = `${con} :: ${w} -> ${base}`;
        if (!findings[key]) findings[key] = { count: 0, samples: [] };
        findings[key].count++;
        if (findings[key].samples.length < 6) findings[key].samples.push({ market: r.market, window: win });
        if (r.project_id) affectedProjects.add(r.project_id);
      } else {
        const k = `${w} -> ${base}`;
        standsAlone[k] = (standsAlone[k] ?? 0) + 1;
        if (aloneSamples.length < 40) aloneSamples.push(`${k}  ::  ${win.slice(0, 110)}`);
      }
      found = true;
      break; // one load-bearing word per record is enough to characterise it
    }
    if (!found) noLoadBearingWord++;
  }

  const byConstruct: Record<string, number> = {};
  for (const k of Object.keys(findings)) {
    const c = k.split(' :: ')[0];
    byConstruct[c] = (byConstruct[c] ?? 0) + findings[k].count;
  }

  const out = {
    about:
      'For every live record the classifier gives a venue_type, the word whose removal changes that answer, and whether that word sits inside a name. Load-bearing word found by ablation against the real classifyVenueType; construct tests are anchored to the word, not to a character window.',
    liveRecords: rows.length,
    classifierGivesAVenue: classified,
    venueWordIsInsideAName: Object.values(findings).reduce((a, b) => a + b.count, 0),
    projectsTouched: affectedProjects.size,
    venueWordStandsAlone: Object.values(standsAlone).reduce((a, b) => a + b, 0),
    noSingleLoadBearingWord: noLoadBearingWord,
    byConstruct,
    detail: findings,
    standsAloneTally: standsAlone,
    standsAloneSamples: aloneSamples,
  };
  writeFileSync(OUT, JSON.stringify(out, null, 1));
  console.error(`live ${rows.length}; classifier gives a venue on ${classified}`);
  console.error(
    `inside a name ${out.venueWordIsInsideAName} (touching ${affectedProjects.size} projects); stands alone ${out.venueWordStandsAlone}; no single word ${noLoadBearingWord}`
  );
  console.error(`wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
