// IS client_projects.project_id CASCADE OR RESTRICT? ASK THE DATABASE.
//
//   npm run diag:membership-fk
//
// WHY THIS EXISTS RATHER THAN A pg_constraint QUERY. PostgREST exposes tables,
// not the catalog, and this repo has no exec_sql RPC and may not run DDL from
// code (standing rule 5). So the constraint cannot be READ from here. It can be
// OBSERVED: create a throwaway project, point a membership row at it, delete the
// project, and see what the database does.
//
//   cascade   the delete succeeds and the membership row disappears with it
//   restrict  the delete is refused and both rows are still there
//
// That is the read-back for migration 042. Run it before and after.
//
// IT USES A FIXTURE AND REMOVES IT. One project on a reserved project_key no
// clusterer can produce, and one membership row against a client that already
// exists. Both are deleted in a finally, in the order the live constraint
// allows. Philip's rows are read and never written - the fixture is scaffolding,
// not corpus, which is the same line verify-curation draws.
import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';
import { LIVE_PIPELINE_STORAGE_KEY } from '../pipelines';

const FIXTURE_KEY = 'fixture:membership-fk-probe:reserved';
const FIXTURE_NAME = 'FK PROBE FIXTURE (delete me)';

async function main(): Promise<void> {
  console.log('===== client_projects.project_id: CASCADE OR RESTRICT? =====\n');

  const { data: clients } = await supabaseAdmin.from('clients').select('id,name').limit(1);
  const client = (clients ?? [])[0] as { id: string; name: string } | undefined;
  if (!client) {
    console.error('No client row exists, so membership cannot be probed. Nothing was written.');
    process.exitCode = 1;
    return;
  }

  // Leave nothing behind from a previous interrupted run.
  const { data: stale } = await supabaseAdmin.from('projects').select('id').eq('project_key', FIXTURE_KEY);
  for (const s of (stale ?? []) as { id: string }[]) {
    await supabaseAdmin.from('client_projects').delete().eq('project_id', s.id);
    await supabaseAdmin.from('projects').delete().eq('id', s.id);
  }

  let projectId: string | null = null;
  try {
    const { data: created, error: cErr } = await supabaseAdmin
      .from('projects')
      .insert({ module: LIVE_PIPELINE_STORAGE_KEY, name: FIXTURE_NAME, project_key: FIXTURE_KEY, status: 'new' })
      .select('id')
      .single();
    if (cErr || !created) throw new Error(`fixture project insert failed: ${cErr?.message}`);
    projectId = (created as { id: string }).id;
    console.log(`fixture project ${projectId.slice(0, 8)} created`);

    const { error: mErr } = await supabaseAdmin
      .from('client_projects')
      .insert({ client_id: client.id, project_id: projectId, status: 'included', set_by: 'membership-fk-probe' });
    if (mErr) throw new Error(`fixture membership insert failed: ${mErr.message}`);
    console.log(`membership row created: ${client.name} -> included\n`);

    const { error: dErr } = await supabaseAdmin.from('projects').delete().eq('id', projectId);

    if (dErr) {
      console.log('RESTRICT. The database REFUSED to delete a project a client holds.');
      console.log(`   ${dErr.message}`);
      console.log('\n   Migration 042 is applied. A future write path that grows its own');
      console.log('   delete now fails loudly instead of erasing a confirmation.');
    } else {
      const { data: after } = await supabaseAdmin
        .from('client_projects')
        .select('id')
        .eq('project_id', projectId);
      if ((after ?? []).length === 0) {
        console.log('CASCADE. The delete succeeded and took the membership row with it.');
        console.log('\n   Migration 042 is NOT applied. An `included` row is still destroyed');
        console.log('   silently whenever its project row is deleted, with no tombstone.');
        projectId = null; // the row is already gone
      } else {
        console.log('NEITHER. The project deleted and the membership row survived, which');
        console.log('   means the foreign key is missing entirely. That is worse than both.');
        projectId = null;
      }
    }
  } finally {
    // Order matters and depends on which constraint is live, so try both.
    if (projectId) {
      await supabaseAdmin.from('client_projects').delete().eq('project_id', projectId);
      await supabaseAdmin.from('projects').delete().eq('id', projectId);
    }
    const { data: left } = await supabaseAdmin.from('projects').select('id').eq('project_key', FIXTURE_KEY);
    const { data: leftM } = await supabaseAdmin
      .from('client_projects')
      .select('id')
      .eq('set_by', 'membership-fk-probe');
    console.log(
      `\nfixture removed: ${(left ?? []).length === 0 && (leftM ?? []).length === 0 ? 'yes' : 'NO - CLEAN UP BY HAND'}`
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
