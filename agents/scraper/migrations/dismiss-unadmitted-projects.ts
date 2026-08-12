// DISMISS THE PROJECTS NO CURRENT GATE RULE WOULD ADMIT.
//
//   npm run dismiss:unadmitted          list them, write nothing
//   APPLY=1 npm run dismiss:unadmitted  write
//
// The re-gate found 48 projects with government records where NOT ONE record is
// admitted by any rule the gate applies today. They were captured under older
// rules and nothing has re-gated them since. Reported grouped by cause and
// decided one cause at a time:
//
//   residential-mixed-use  41  APPROVED. Plain residential rezonings, every one
//                              matching weak:mixed-use plus action:rezoning,
//                              which is precisely the pattern
//                              isResidentialMixedUse exists to reject. 37 New
//                              York, 4 Las Vegas. This is the class
//                              dismiss-regate-classes held back pending exactly
//                              this decision.
//   out-of-vertical         6  APPROVED, including 240 Nassau Street once its
//                              record was read rather than judged on the flag.
//                              See below.
//   weak-without-action     1  NOT APPROVED. The Tohono O'odham Nation tribal
//                              gaming grants ordinance: a real gaming party
//                              filing a non-development instrument, which is
//                              what the significance transaction penalty is
//                              for. Same ruling as the Flamingo street name
//                              change.
//
// 240 NASSAU STREET, READ RATHER THAN GUESSED. Flagged as arguably real because
// it is named a heritage site and carries weak:redevelopment. The CEQR record
// settles it: the co-applicants are the NYC Educational Construction Fund and
// 240 Nassau Street Holdings LLC, and the project is 1,502 residential units
// plus retail plus 121,000 gsf of PUBLIC SCHOOL SPACE replacing an outdated
// 1953 school, adding 208 seats in Community School District 13. The school
// district is the SUBJECT, not a neighbouring property. Its venue type
// "Heritage/Cultural Site" came from the words "cultural space" in a school
// project.
//
// STATUS, NOT DELETION. Nothing is removed; status moves to 'dismissed', the
// register's read paths exclude it, and setting the status back restores it.
// The projects themselves are not touched here: the clusterer never sees a
// dismissed lead, so the next run empties and removes the shells.
//
// EVERY ROW IS RE-GATED HERE RATHER THAN READ FROM A LIST, so this can be
// re-run after the rules move again and will ask the current question.
//
// A CURATED ROW IS REPORTED, NEVER DISMISSED. Any record Philip has touched -
// a status other than 'new', notes, or manual_overrides - is his decision.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { decide } from '../gate-decide';
import { loadKnownEntities } from '../known-entities';

const APPLY = process.env.APPLY === '1';

// The causes approved for dismissal. 'weak-without-action' is deliberately absent.
const APPROVED_CAUSES = new Set(['residential-mixed-use', 'out-of-vertical']);

const GOV_SOURCES = new Set([
  'nyc-zap', 'nyc-ceqr', 'nyc-city-record', 'legistar', 'clark-tab',
  'agenda-portal', 'ceqanet', 'cftod-pdf', 'govdoc', 'sfwmd',
]);

interface Row {
  id: string;
  title: string | null;
  url: string | null;
  source: string | null;
  status: string | null;
  notes: string | null;
  manual_overrides: unknown;
  market: string | null;
  location: string | null;
  raw_content: string | null;
  project_id: string | null;
}

const t = (s: unknown): string => String(s ?? '').trim();

// The adapter judges the item's own subject, not the standing boilerplate.
function subjectOf(raw: string): string {
  const m = /--- item text ---\n([\s\S]*)$/.exec(raw);
  return (m ? m[1] : raw).trim();
}

function curated(r: Row): boolean {
  const mo = r.manual_overrides;
  const hasOverrides =
    !!mo && typeof mo === 'object' && (Array.isArray(mo) ? mo.length > 0 : Object.keys(mo).length > 0);
  return (r.status !== null && r.status !== 'new') || !!r.notes || hasOverrides;
}

async function main(): Promise<void> {
  await loadKnownEntities();

  const rows: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,url,source,status,notes,manual_overrides,market,location,raw_content,project_id')
      .eq('module', 'gli')
      .neq('status', 'dismissed')
      .range(from, from + 499);
    if (error) throw new Error(`read failed: ${error.message}`);
    rows.push(...((data ?? []) as Row[]));
    if ((data ?? []).length < 500) break;
  }

  const { data: projects, error: pErr } = await supabaseAdmin
    .from('projects')
    .select('id,name,market,significance,record_count,status')
    .eq('module', 'gli')
    .neq('status', 'dismissed');
  if (pErr) throw new Error(`projects read failed: ${pErr.message}`);

  const byProject = new Map<string, Row[]>();
  for (const r of rows) {
    const k = t(r.project_id);
    if (!k) continue;
    byProject.set(k, [...(byProject.get(k) ?? []), r]);
  }

  const toDismiss: { row: Row; project: string; cause: string }[] = [];
  const spared: { row: Row; project: string; why: string }[] = [];
  const heldCauses = new Map<string, number>();

  for (const p of projects ?? []) {
    const recs = byProject.get(p.id as string) ?? [];
    const gov = recs.filter((r) => GOV_SOURCES.has(t(r.source)));
    if (gov.length === 0) continue; // press-only: governmentGate never judged it

    const decisions = gov.map((r) => {
      const raw = t(r.raw_content);
      return decide({
        source: t(r.source),
        market: t(r.market) || t(r.location),
        key: t(r.url),
        title: t(r.title),
        gate_text: subjectOf(raw),
        bypass_text: raw,
        bypass_mode: 'all',
      });
    });
    if (decisions.some((d) => d.admitted)) continue;

    const tally = new Map<string, number>();
    for (const d of decisions) tally.set(d.verdict.reason, (tally.get(d.verdict.reason) ?? 0) + 1);
    const cause = [...tally.entries()].sort((a, b) => b[1] - a[1])[0][0];
    if (!APPROVED_CAUSES.has(cause)) {
      heldCauses.set(cause, (heldCauses.get(cause) ?? 0) + 1);
      continue;
    }
    for (const r of recs) {
      if (curated(r)) spared.push({ row: r, project: t(p.name), why: 'curated by hand' });
      else toDismiss.push({ row: r, project: t(p.name), cause });
    }
  }

  const perCause = new Map<string, Set<string>>();
  for (const d of toDismiss) {
    if (!perCause.has(d.cause)) perCause.set(d.cause, new Set());
    perCause.get(d.cause)!.add(d.project);
  }

  console.log(APPLY ? 'DISMISS UNADMITTED: APPLYING\n' : 'DISMISS UNADMITTED: DRY RUN (APPLY=1 to write)\n');
  for (const [cause, names] of perCause) {
    console.log(`  ${cause.padEnd(24)} ${names.size} projects, ${toDismiss.filter((d) => d.cause === cause).length} records`);
  }
  console.log(`\n  HELD, not approved:`);
  if (heldCauses.size === 0) console.log('    (none)');
  for (const [cause, n] of heldCauses) console.log(`    ${cause.padEnd(24)} ${n} projects`);
  console.log(`\n  spared as curated: ${spared.length}`);
  for (const s of spared) console.log(`    ${s.project}: ${t(s.row.title).slice(0, 70)}`);
  console.log(`\n  TOTAL RECORDS TO DISMISS: ${toDismiss.length}`);

  if (!APPLY) {
    console.log('\nNothing was written. APPLY=1 to write.');
    return;
  }

  let done = 0;
  const ids = toDismiss.map((d) => d.row.id);
  for (let i = 0; i < ids.length; i += 100) {
    const slice = ids.slice(i, i + 100);
    const { error } = await supabaseAdmin.from('leads').update({ status: 'dismissed' }).in('id', slice);
    if (error) {
      console.error(`  dismiss failed for ${slice.length} rows: ${error.message}`);
      continue;
    }
    done += slice.length;
  }
  console.log(`\ndismissed ${done} of ${ids.length} records. Run the clusterer to clear the empty project shells.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
