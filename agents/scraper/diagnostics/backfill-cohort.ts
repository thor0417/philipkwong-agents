// WHAT THE LEGISTAR BACKFILL ACTUALLY ADDED, BY SET DIFFERENCE.
//
//   npm run diag:backfill-cohort
//
// NOT A DATE FILTER. A date filter answers "what arrived since a timestamp",
// which is a different question and a wrong one: it catches rows the backfill
// did not create and misses projects whose created_at predates their entry into
// the live population. The cohort here is the set difference of the two
// snapshots' liveProjectIds - the projects live AFTER the run and not live
// BEFORE it - which is exactly the population the run is answerable for.
//
// It writes the whole cohort to disk with every record title, because judging
// whether a thing is a development or an instrument cannot be done from a name.
import { readFileSync, writeFileSync } from 'node:fs';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const PRE = 'snapshots/corpus-2026-08-21T09-56-35-pre-legistar-backfill.json';
const POST = 'snapshots/corpus-2026-08-21T10-32-43-post-legistar-backfill.json';
const OUT = 'snapshots/backfill-cohort.json';

interface SnapProject { id: string; name: string; market: string | null; records: number; facts: number }

const read = (p: string) => JSON.parse(readFileSync(p, 'utf8')) as { liveProjectIds: SnapProject[] };

async function main() {
  const pre = read(PRE);
  const post = read(POST);
  const preIds = new Set(pre.liveProjectIds.map((p) => p.id));
  const postIds = new Set(post.liveProjectIds.map((p) => p.id));
  const addedIds = post.liveProjectIds.filter((p) => !preIds.has(p.id)).map((p) => p.id);
  const removed = pre.liveProjectIds.filter((p) => !postIds.has(p.id));

  console.error(`pre live ${pre.liveProjectIds.length}  post live ${post.liveProjectIds.length}`);
  console.error(`added ${addedIds.length}  removed ${removed.length}`);

  // Projects, in id chunks: PostgREST has a URL length limit and 108 uuids in
  // one `in.()` is close enough to it to be worth not finding out.
  const CH = 40;
  const projects: Record<string, unknown>[] = [];
  for (let i = 0; i < addedIds.length; i += CH) {
    const { data, error } = await supabaseAdmin.from('projects').select('*').in('id', addedIds.slice(i, i + CH));
    if (error) throw new Error(error.message);
    projects.push(...(data ?? []));
  }

  const leads: Record<string, unknown>[] = [];
  for (let i = 0; i < addedIds.length; i += CH) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id, project_id, title, url, source, market, status, lifecycle, object_type, development_category, venue_type, applicant, representative, presented_by, action_sought, applicant_type, filing_facts, press_facts, project_description, published_date, milestone_date, score_reason, filing_form')
      .in('project_id', addedIds.slice(i, i + CH));
    if (error) throw new Error(error.message);
    leads.push(...(data ?? []));
  }

  const byProject = new Map<string, Record<string, unknown>[]>();
  for (const l of leads) {
    const k = String(l.project_id);
    if (!byProject.has(k)) byProject.set(k, []);
    byProject.get(k)!.push(l);
  }

  const cohort = projects.map((p) => ({ project: p, records: byProject.get(String(p.id)) ?? [] }));

  writeFileSync(
    OUT,
    JSON.stringify(
      {
        about: 'The Legistar backfill cohort, by set difference of the pre and post snapshot liveProjectIds. Not a date filter.',
        pre: PRE,
        post: POST,
        preLive: pre.liveProjectIds.length,
        postLive: post.liveProjectIds.length,
        added: addedIds.length,
        removedFromLive: removed,
        cohort,
      },
      null,
      1
    )
  );
  console.error(`wrote ${OUT}: ${cohort.length} projects, ${leads.length} records`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
