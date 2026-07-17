// Acceptance-test harness for the two-object model (Phase 1).
//
// Top Gun Las Vegas and OCVibe Anaheim are NOT in the live corpus (verified: zero
// stored rows), so tests 1 and 2 are proven against the REAL classifier/parser
// using faithful synthetic leads -- no rows are written to Supabase. Run:
//   node --import tsx agents/scraper/verify-object-model.ts

import {
  classifyLead,
  opportunityVerdict,
  projectEventVerdict,
  type LeadModel,
} from './lead-date';
import { parseMaxFutureDate, parseDateFromText } from './date-parse';
import type { NormalizedLead } from './sources/types';

const NOW = Date.UTC(2026, 6, 17); // 2026-07-17, the recon date

const lead = (o: Partial<NormalizedLead>): NormalizedLead => ({
  title: '', raw_content: '', url: '', company: null, location: null,
  deadline: null, published_date: null, value_estimate: null, source: '', ...o,
});

let pass = 0;
let fail = 0;
function check(name: string, got: unknown, exp: unknown): void {
  const ok = JSON.stringify(got) === JSON.stringify(exp);
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}\n       got=${JSON.stringify(got)} exp=${JSON.stringify(exp)}`);
  ok ? pass++ : fail++;
}
const model = (l: NormalizedLead): LeadModel => classifyLead(l, NOW);

console.log('=== ACCEPTANCE TEST 1: TOP GUN LAS VEGAS (2025 origin, 2028 opening) ===');
// A project event (no submission deadline), LIVE via a 2028 milestone.
const topGun = lead({
  title: 'Top Gun Las Vegas attraction moves ahead',
  raw_content:
    'Announced 2025 by Paramount with Advent Allen; Simtec Systems named for ride systems. Grand opening scheduled for 2028 on the Las Vegas Strip.',
  published_date: '2026-03-01',
});
const tg = model(topGun);
check('Top Gun object_type = project_event', tg.object_type, 'project_event');
check('Top Gun verdict = live', tg.verdict, 'live');
check('Top Gun milestone_date = 2028', tg.milestone_date, '2028-01-01');

console.log('\n=== ACCEPTANCE TEST 2: OCVIBE ANAHEIM (2022 origin, 2026 activity) ===');
// A project event, LIVE via recent 2026 activity; origination 2022 is NOT a filter.
const ocv = lead({
  title: 'OCVibe Anaheim entertainment district construction update',
  raw_content:
    'The OCVibe development, originated in 2022, entered a new construction phase in 2026 with entitlement approvals granted by the city.',
  published_date: '2026-05-10',
});
const oc = model(ocv);
check('OCVibe object_type = project_event', oc.object_type, 'project_event');
check('OCVibe verdict = live', oc.verdict, 'live');
// Same lead if it had arrived via the opportunity STREAM (still no deadline) -> still project_event.
check('OCVibe stays project_event regardless of lane (no deadline)', model(lead({ ...ocv })).object_type, 'project_event');

console.log('\n=== ACCEPTANCE TEST 3: PRE-2026 OPPORTUNITIES DELETED ===');
const feb2013 = lead({ title: 'EOI for resort feasibility study', raw_content: 'Issued February 2013.', deadline: '2013-02-15T00:00:00Z' });
const f13 = model(feb2013);
check('Feb 2013 EOI object_type = opportunity', f13.object_type, 'opportunity');
check('Feb 2013 EOI verdict = delete', f13.verdict, 'delete');
const oldTender = lead({ title: 'Consultancy tender', raw_content: 'no future dates', deadline: '2019-04-01T00:00:00Z' });
check('2019 tender verdict = delete', model(oldTender).verdict, 'delete');
// A pre-2026 deadline BUT a future milestone -> archive, never delete.
const oldButMilestone = lead({ title: 'Tender', raw_content: 'construction through 2029', deadline: '2019-04-01T00:00:00Z' });
check('pre-2026 deadline + 2029 milestone = archive (not delete)', model(oldButMilestone).verdict, 'archive');

console.log('\n=== BOUNDARY + MILESTONE UNIT CHECKS ===');
check('opportunity deadline today = live', opportunityVerdict('2026-07-17', null, NOW), 'live');
check('opportunity deadline 2025-12-31 no milestone = delete', opportunityVerdict('2025-12-31', null, NOW), 'delete');
check('opportunity deadline 2026-02 passed, 2026-dated = archive', opportunityVerdict('2026-02-01', null, NOW), 'archive');
check('project future milestone overrides old activity = live', projectEventVerdict('2011-01-01', '2028-01-01', NOW), 'live');
check('project silent 18mo no milestone = dormant', projectEventVerdict('2024-12-01', null, NOW), 'dormant');
check('project silent 3yr no milestone = archived', projectEventVerdict('2022-01-01', null, NOW), 'archived');
check('project undated = live (badge DATE UNKNOWN)', projectEventVerdict(null, null, NOW), 'live');
check('milestone parse: opening 2028', parseMaxFutureDate('opening 2028', NOW), '2028-01-01');
check('milestone parse: past-only 2011 -> null', parseMaxFutureDate('2011 RFP', NOW), null);
check('age parse unchanged: 2011 RFP', parseDateFromText('2011 RFP'), '2011-01-01');

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
