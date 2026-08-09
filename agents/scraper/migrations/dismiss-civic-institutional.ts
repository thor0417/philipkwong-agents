// DISMISS THE APPROVED CIVIC AND INSTITUTIONAL RECORDS.
//
// Nine rows, listed and approved individually before this was written. status
// moves to 'dismissed'; NOTHING IS DELETED and no record changes project. The
// register's read paths already exclude dismissed rows, and the decision is
// reversible by setting status back.
//
// WHY A SCRIPT AND NOT A HAND EDIT. Nine ids typed into a SQL editor cannot be
// reviewed, cannot be re-run, and leave no statement of why each row went. This
// prints every row with its class before touching anything and refuses to widen
// past the approved set.
//
// DRY by default. APPLY=1 to write.

import { pathToFileURL } from 'node:url';
import { supabaseAdmin } from '../../../lib/supabase-admin';

const APPLY = process.env.APPLY === '1';

// The approved nine, identified by the URL that is their upsert key rather than
// by title: two Western Prelacy rows share a title and differ only by document,
// and two "1946 East 7th Street Rezoning" rows differ only by source.
const APPROVED: { url: string; why: string }[] = [
  {
    url: 'https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:a2fa4a10-419e-4b46-86bf-dc724ef63f40/original/as/Winchester-Minutes-011326-.pdf#item-uc-25-0839',
    why: 'place of worship: use permit for an office in conjunction with a church',
  },
  {
    url: 'https://www.clarkcountynv.gov/adobe/assets/urn:aaid:aem:cda70dd0-fdc4-4328-839c-3396c7509ed7/original/as/Winchester-Agenda-011326.pdf#item-uc-25-0839',
    why: 'place of worship: the same matter on the agenda',
  },
  {
    url: 'https://clark.legistar.com/gateway.aspx?M=l&ID=110428',
    why: 'place of worship: plan amendment to redesignate land use for a church',
  },
  {
    url: 'https://www.sfwmd.gov/regpermitting#erp-040304-17_49-00094-S-133',
    why: 'school: Reedy Creek Elementary School',
  },
  {
    url: 'https://www.sfwmd.gov/regpermitting#erp-240709-44658_49-111246-P',
    why: 'school: Reedy Creek Elementary School',
  },
  {
    url: 'https://zap.planning.nyc.gov/projects/2022K0408',
    why: 'seniors residence: 100% affordable senior housing rezoning',
  },
  {
    url: 'https://a002-ceqraccess.nyc.gov/ceqr/ProjectInformation/ProjectDetail/11797-25DCP060K',
    why: 'seniors residence: the same rezoning, environmental record',
  },
  {
    url: 'https://zap.planning.nyc.gov/projects/2022X0393',
    why: 'seniors residence: affordable housing with a senior building',
  },
  {
    url: 'https://a002-ceqraccess.nyc.gov/ceqr/ProjectInformation/ProjectDetail/17638-25HPD078X',
    why: 'seniors residence: affordable independent residence for seniors',
  },
];

async function main(): Promise<void> {
  console.log(APPLY ? 'DISMISS: APPLYING' : 'DISMISS: DRY RUN (APPLY=1 to write)');
  console.log(`approved rows: ${APPROVED.length}\n`);

  let dismissed = 0;
  let already = 0;
  let missing = 0;

  for (const row of APPROVED) {
    const { data, error } = await supabaseAdmin
      .from('leads')
      .select('id,title,market,source,status,project_id')
      .eq('url', row.url)
      .limit(1);
    if (error) throw new Error(error.message);
    const r = (data ?? [])[0] as Record<string, unknown> | undefined;
    if (!r) {
      missing++;
      console.log(`  MISSING  ${row.url}`);
      continue;
    }
    if (r.status === 'dismissed') {
      already++;
      console.log(`  already  ${String(r.title).slice(0, 62)}`);
      continue;
    }
    console.log(`  dismiss  ${String(r.market).slice(0, 14).padEnd(15)} ${String(r.title).slice(0, 56)}`);
    console.log(`           ${row.why}`);
    if (!APPLY) continue;
    const { error: uerr } = await supabaseAdmin
      .from('leads')
      .update({ status: 'dismissed' })
      .eq('id', r.id as string);
    if (uerr) throw new Error(`dismiss failed for ${r.id}: ${uerr.message}`);
    dismissed++;
  }

  console.log(
    `\n${APPLY ? 'dismissed' : 'would dismiss'}: ${APPLY ? dismissed : APPROVED.length - already - missing}` +
      `  already dismissed: ${already}  not found: ${missing}`
  );
  if (!APPLY) console.log('Nothing was written. APPLY=1 to write.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
