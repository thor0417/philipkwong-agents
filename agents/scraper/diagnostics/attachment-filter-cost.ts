// WHAT THE DRAWING_NAME CHANGE COSTS AND GAINS, PER JURISDICTION.
//
//   npm run diag:attachment-cost
//
// STANDING RULE 2: measure before changing, and measure PER MARKET. A corpus
// average hides a market-specific harm, and this exact change is the one
// BROWARD-DOCUMENTS-DIAGNOSIS.md refused to make without this measurement:
// removing `exhibit` from the blocklist admits every Broward exhibit AND every
// Clark exhibit, and Clark is the only market currently at standard.
//
// ---- THE DEFECT BEING COSTED ----------------------------------------------
//
// sources/legistar-attachments.ts strips an attachment whose NAME reads as a
// drawing, because a map or elevation set extracts to a few hundred characters
// of street labels and fetching it is pure cost. The regex was written against
// Clark County, where `UC-26-0303_Color_Merged.pdf` is a genuine drawing set.
//
// Broward calls its prose documents `Exhibit 1 - Proposed Ordinance`, and
// `exhibit` is on the blocklist. So the filter throws away exactly what the
// reader wants, on the word `exhibit`, in one jurisdiction and not the other.
// That is a label read as the thing it names: `exhibit` means "drawing" in
// Clark and "attached document" in Broward, and one regex was asked to speak
// for both.
//
// ---- THE PROPOSED RULE, STATED SO IT CAN BE ARGUED WITH -------------------
//
// A name is a drawing when it carries a drawing word AND CARRIES NO PROSE NOUN.
// `Exhibit 1 - Proposed Ordinance` has `ordinance` and survives;
// `UC-26-0303_Color_Merged.pdf` has no prose noun and is still stripped. The
// test is on the whole name rather than on a substring anywhere in it, which is
// what the diagnosis proposed.
//
// ---- THE CAP IS STATED BESIDE EVERY FIGURE. Standing rule 13. -------------
//
// Attachments are listed per matter, one request each, so the sample is capped
// at MATTER_SAMPLE matters per jurisdiction out of the newest MATTER_PAGE. Every
// count below is "of that sample" and says so. A jurisdiction whose Matters or
// Attachments call fails is reported as UNREAD rather than counted as zero -
// a network failure and a publisher with no attachments are different facts,
// and this machine has confused them before.

import { DEFAULT_JURISDICTIONS } from '../sources/legistar-jurisdictions';

const BASE = 'https://webapi.legistar.com/v1';
const MATTER_PAGE = 60;
const MATTER_SAMPLE = 25;
const UA = 'philipkwong-agents/1.0 (+attachment-filter-cost)';

// The rule as it stands today, copied from sources/legistar-attachments.ts:51.
const DRAWING_NAME =
  /(color[_ ]?merged|\bmaps?\b|exhibit|elevation|drawing|site\s*plan|landscape|render|photo|survey|plat\b|aerial)/i;

// The prose nouns that mark an attachment as a document rather than a picture.
// Deliberately narrow: every one of these names a thing that is read, not
// looked at.
const PROSE_NOUN =
  /(ordinance|resolution|agreement|\breport\b|memo|letter|application|justification|contract|amendment|estimate|analysis|staff|minutes|correspondence|petition|covenant|declaration)/i;

const proposedIsDrawing = (name: string): boolean =>
  DRAWING_NAME.test(name) && !PROSE_NOUN.test(name);

// Today's priority list, and what Broward's vocabulary would add to it.
const DOC_PRIORITY = [
  /staff\s*report/i, /agenda\s*sheet/i, /^\d+[\s_-]/, /application/i,
  /justification/i, /\breport\b/i, /letter/i, /memo/i,
];
const DOC_PRIORITY_PROPOSED = [
  ...DOC_PRIORITY,
  /ordinance/i, /resolution/i, /agreement/i, /amendment\s*report/i, /business\s*impact/i,
];

async function json(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': UA } });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

interface Row {
  market: string;
  client: string;
  read: boolean;
  matters: number;
  withAttachments: number;
  attachments: number;
  keptNow: number;
  keptProposed: number;
  prioritisedNow: number;
  prioritisedProposed: number;
  admitted: string[];
  stillStripped: string[];
}

async function measure(client: string, market: string): Promise<Row> {
  const row: Row = {
    market, client, read: false, matters: 0, withAttachments: 0, attachments: 0,
    keptNow: 0, keptProposed: 0, prioritisedNow: 0, prioritisedProposed: 0,
    admitted: [], stillStripped: [],
  };
  const matters = (await json(
    `${BASE}/${client}/Matters?$orderby=MatterId%20desc&$top=${MATTER_PAGE}`
  )) as { MatterId: number }[] | null;
  if (!Array.isArray(matters) || matters.length === 0) return row;
  row.read = true;
  const sample = matters.slice(0, MATTER_SAMPLE);
  row.matters = sample.length;

  for (const m of sample) {
    const list = (await json(`${BASE}/${client}/Matters/${m.MatterId}/Attachments`)) as
      | { MatterAttachmentName?: string; MatterAttachmentHyperlink?: string }[]
      | null;
    if (!Array.isArray(list) || list.length === 0) continue;
    const usable = list.filter((a) => !!a.MatterAttachmentHyperlink);
    if (usable.length > 0) row.withAttachments += 1;
    row.attachments += usable.length;
    for (const a of usable) {
      const name = a.MatterAttachmentName ?? '';
      const nowKept = !DRAWING_NAME.test(name);
      const propKept = !proposedIsDrawing(name);
      if (nowKept) row.keptNow += 1;
      if (propKept) row.keptProposed += 1;
      if (nowKept && DOC_PRIORITY.some((re) => re.test(name))) row.prioritisedNow += 1;
      if (propKept && DOC_PRIORITY_PROPOSED.some((re) => re.test(name))) row.prioritisedProposed += 1;
      // THE TWO LISTS THAT DECIDE WHETHER THE RULE IS RIGHT: what the change
      // newly admits, and what it still throws away. Both are printed, because
      // a rule judged only on what it gains is a rule nobody costed.
      if (!nowKept && propKept && row.admitted.length < 6) row.admitted.push(name);
      if (!propKept && row.stillStripped.length < 4) row.stillStripped.push(name);
    }
  }
  return row;
}

async function main(): Promise<void> {
  console.log(`\nATTACHMENT FILTER COST, PER JURISDICTION.`);
  console.log(
    `CAP, STATED: the newest ${MATTER_PAGE} matters are listed and the first ` +
      `${MATTER_SAMPLE} of them are checked for attachments. Every count below is of that sample.\n`
  );

  const rows: Row[] = [];
  for (const j of DEFAULT_JURISDICTIONS) {
    process.stdout.write(`  reading ${j.client}...`);
    const r = await measure(j.client, j.jurisdictionLabel);
    rows.push(r);
    console.log(r.read ? ` ${r.attachments} attachments on ${r.withAttachments}/${r.matters} matters` : ' UNREAD');
  }

  const unread = rows.filter((r) => !r.read);
  console.log('');
  console.log(
    `  ${'jurisdiction'.padEnd(24)} ${'attach'.padStart(6)} ${'kept now'.padStart(9)} ${'kept new'.padStart(9)} ${'prio now'.padStart(9)} ${'prio new'.padStart(9)}`
  );
  for (const r of rows) {
    if (!r.read) {
      console.log(`  ${r.market.padEnd(24)}    UNREAD - the feed did not answer from this machine, NOT counted as zero`);
      continue;
    }
    console.log(
      `  ${r.market.padEnd(24)} ${String(r.attachments).padStart(6)} ${String(r.keptNow).padStart(9)} ${String(r.keptProposed).padStart(9)} ${String(r.prioritisedNow).padStart(9)} ${String(r.prioritisedProposed).padStart(9)}`
    );
  }

  console.log('\n  WHAT THE CHANGE ADMITS, AND WHAT IT STILL STRIPS, PER JURISDICTION:');
  for (const r of rows.filter((x) => x.read)) {
    const gain = r.keptProposed - r.keptNow;
    console.log(`\n  ${r.market}   ${gain >= 0 ? '+' : ''}${gain} attachments admitted`);
    if (r.admitted.length) {
      console.log('    NEWLY ADMITTED:');
      for (const n of r.admitted) console.log(`      ${n.slice(0, 78)}`);
    } else if (gain === 0) {
      console.log('    nothing changes here');
    }
    if (r.stillStripped.length) {
      console.log('    STILL STRIPPED (the rule must keep throwing these away):');
      for (const n of r.stillStripped) console.log(`      ${n.slice(0, 78)}`);
    }
  }

  // THE COST SIDE, SAID PLAINLY. More admitted attachments is more fetching, and
  // the fetch is the expensive half. A rule that admits a drawing set costs a
  // fetch and returns street labels.
  const readRows = rows.filter((r) => r.read);
  const nowTotal = readRows.reduce((a, b) => a + b.keptNow, 0);
  const propTotal = readRows.reduce((a, b) => a + b.keptProposed, 0);
  console.log(`\n  ACROSS ${readRows.length} JURISDICTIONS READ: ${nowTotal} kept today, ${propTotal} under the proposed rule, ` +
    `${propTotal - nowTotal >= 0 ? '+' : ''}${propTotal - nowTotal} more fetches per ${MATTER_SAMPLE}-matter sample.`);
  if (unread.length) {
    console.log(`\n  ${unread.length} jurisdiction(s) UNREAD from this machine: ${unread.map((r) => r.client).join(', ')}.`);
    console.log('  Re-run before acting on the totals. An unread feed is not a feed with no attachments.');
  }
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
