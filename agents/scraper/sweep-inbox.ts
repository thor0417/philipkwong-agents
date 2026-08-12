// Standalone Inbox sweep: attach every record that has no project, whoever
// wrote it and whenever.
//
//   npm run projects:sweep
//
// attachOnWrite reports only on its own run's URLs, so a lane that wrote and
// never attached leaves records nothing will ever mention again. This sweeps by
// state instead: null project_id, regardless of provenance.

import { pathToFileURL } from 'node:url';
import { sweepInbox, printSweepReport } from './project-attach';

async function main(): Promise<void> {
  printSweepReport(await sweepInbox());
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
