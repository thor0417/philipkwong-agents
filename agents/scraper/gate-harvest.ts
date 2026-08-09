// HARVEST: freeze one candidate corpus for the government gate.
//
// Runs every gate-bearing government source with the audit recorder on and
// writes each candidate - the exact text the gate judged, admitted or rejected -
// to a JSONL corpus. Nothing is written to Supabase and no model is called: this
// fetches and gates, nothing else.
//
// WHY FREEZE. The measurement harness re-gates this corpus offline. If each
// stage of a remediation re-fetched instead, the corpus would change under the
// measurement and a recall gain from a vocabulary change would be
// indistinguishable from a quiet morning at the portals. One corpus, re-gated
// per stage, makes every delta attributable to the gate.
//
// Attachment fetching is off by default (LEGISTAR_ATTACHMENTS): a matter's
// attachments are read AFTER the gate, so they cannot change a gate decision,
// and fetching them here would add multi-megabyte PDF downloads to a harvest
// that does not use them.
//
// Run: npm run gate:harvest        (or automatically from npm run gate:measure)

import { pathToFileURL } from 'node:url';
import { startGateAudit, stopGateAudit, corpusPath, readGateCorpus } from './gate-decide';
import { loadKnownEntities } from './known-entities';
import { scrapeLegistar } from './sources/legistar';
import { scrapeCftodPdfItems } from './sources/pdf-agenda';
import { scrapeAnaheimAgendas } from './sources/agenda-portal';
import { scrapeLasVegasAgendas } from './sources/lasvegas';
import { scrapeClarkTabAgendas } from './sources/clark-tab';
import { scrapeCeqanet } from './sources/ceqanet';
import { scrapeNycZap } from './sources/nyc-zap';
import { scrapeNycCityRecord } from './sources/nyc-city-record';
import { scrapeNycCeqr } from './sources/nyc-ceqr';

export async function harvestGateCorpus(): Promise<number> {
  if (!process.env.LEGISTAR_ATTACHMENTS) process.env.LEGISTAR_ATTACHMENTS = '0';
  // The known-entity bypass consults the project register, so the index is built
  // before any adapter gates anything. Without this the bypass is inert and the
  // harvest would record decisions the live lane would not have taken.
  const entities = await loadKnownEntities();
  console.log(
    `Known entities: ${entities.entities} parties trusted across ${entities.anchors} anchor projects ` +
      `(of ${entities.projects}).`
  );
  startGateAudit();
  console.log(`Gate harvest: recording every candidate to ${corpusPath()}.`);
  // Each source is independent; one that dies contributes zero rather than
  // killing the harvest. A dead source shows up as zero candidates in the
  // per-source table, which is exactly the reading the amendment asks for.
  const settled = await Promise.allSettled([
    scrapeLegistar(),
    scrapeAnaheimAgendas(),
    scrapeLasVegasAgendas(),
    scrapeClarkTabAgendas(),
    scrapeCeqanet(),
    scrapeCftodPdfItems(),
    // NEW YORK CITY. Three gate-bearing sources, so they belong in the corpus
    // the gate is measured on. Leaving them out would not have been neutral: it
    // would have gone on reporting precision and recall for a system that had
    // grown three sources and roughly a third of its capture, and the numbers
    // would have looked stable precisely because the new work was invisible.
    scrapeNycZap(),
    scrapeNycCityRecord(),
    scrapeNycCeqr(),
  ]);
  for (const r of settled) if (r.status === 'rejected') console.error('Gate harvest: source failed:', r.reason);
  const n = stopGateAudit();

  const corpus = readGateCorpus();
  const bySource: Record<string, number> = {};
  for (const c of corpus) bySource[c.source] = (bySource[c.source] ?? 0) + 1;
  console.log(`\nGate harvest: ${n} candidates recorded (${corpus.length} readable).`);
  for (const [s, k] of Object.entries(bySource).sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(k).padStart(5)}  ${s}`);
  }
  // SFWMD and the govdoc sources are absent BY DESIGN, and it is worth saying so
  // rather than leaving a reader to wonder. Neither consults the gate: SFWMD
  // filters server-side on Disney applicant names in its ArcGIS query, and a
  // govdoc is a hand-listed document. There is no gate decision to record, so
  // there is no gate recall to measure - their recall is a question about their
  // QUERY, which is reported separately in the measurement output.
  console.log('    (sfwmd and govdocs take no gate decision: nothing to record. See the harness note.)');

  // A SOURCE THAT PRODUCED NOTHING DOES NOT APPEAR IN THE TABLE ABOVE, and that
  // absence is exactly how a dead source hides. It happened on the first harvest
  // that included New York: nyc-city-record contributed zero candidates, threw
  // no exception, rejected no promise, and simply was not printed - while the
  // same adapter run alone fetched 2,342 rows. Keyless Socrata throttles under
  // concurrency (sources/socrata now retries), but the harness must name the
  // hole regardless of the cause.
  //
  // So the sources that are EXPECTED to produce candidates are listed, and any
  // one of them at zero is called out by name.
  const EXPECTED = [
    'legistar',
    'agenda-portal',
    'clark-tab',
    'ceqanet',
    'cftod-pdf',
    'nyc-zap',
    'nyc-city-record',
    'nyc-ceqr',
  ];
  const silent = EXPECTED.filter((s) => (bySource[s] ?? 0) === 0);
  if (silent.length > 0) {
    console.error(
      `
  GATE HARVEST INCOMPLETE: ${silent.length} expected source(s) produced ZERO candidates: ` +
        `${silent.join(', ')}.
` +
        '  The corpus is not comparable to a previous one. Re-harvest before measuring.'
    );
  }
  return corpus.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  harvestGateCorpus().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
