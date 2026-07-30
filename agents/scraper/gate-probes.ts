// THE CALIBRATION SET: records whose correct answer is already known.
//
// Two different things need checking, and they are checked against the same
// thirteen records because both can be wrong:
//
//   THE GATE. Does it admit the records it must admit and reject the records it
//   must reject? The three July-report projects the audit found discarded are in
//   here by name, along with the guard cases that a recall fix must not sweep in
//   (a single-family subdivision development agreement, an airport ground lease,
//   an arts-programming funding agreement).
//
//   THE JUDGE. Does the model's reading of the rubric agree with the known
//   answer? A precision or recall number computed from labels is only worth what
//   the labels are worth, so the labels are checked against ground truth rather
//   than trusted. Judge accuracy is printed with the numbers, every run, so a
//   drifting judge is visible instead of assumed away.
//
// Each probe's candidate is the EXACT candidate the harvest recorded, so a probe
// exercises the same text the live gate saw, not a paraphrase of it.

import { pathToFileURL } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { decide, candidateHash, type GateCandidate } from './gate-decide';
import { labelCandidates, type GateLabel } from './gate-labels';

export const PROBE_FILE = 'agents/scraper/fixtures/gate-probes.jsonl';

export interface GateProbe {
  name: string;
  // What the rubric should say about this record.
  expect_relevant: boolean;
  // What the gate must do with it.
  must_capture: boolean;
  provenance: string;
  candidate: GateCandidate;
}

export function loadProbes(): GateProbe[] {
  if (!existsSync(PROBE_FILE)) return [];
  const out: GateProbe[] = [];
  for (const line of readFileSync(PROBE_FILE, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    out.push(JSON.parse(t) as GateProbe);
  }
  return out;
}

export interface ProbeReport {
  gatePassed: number;
  gateFailed: number;
  judgePassed: number;
  judgeLabelled: number;
}

// Run every probe against the current gate, and (unless labels are read-only)
// against the judge. Prints one line per probe: the gate's verdict, whether that
// matches what must happen, and whether the judge agreed with ground truth.
export async function runProbes(labels?: Map<string, GateLabel>): Promise<ProbeReport> {
  const probes = loadProbes();
  const report: ProbeReport = { gatePassed: 0, gateFailed: 0, judgePassed: 0, judgeLabelled: 0 };
  if (probes.length === 0) {
    console.log(`\nCALIBRATION: no probes at ${PROBE_FILE}.`);
    return report;
  }
  const known = labels ?? (await labelCandidates(probes.map((p) => p.candidate)));

  console.log(`\nCALIBRATION (${probes.length} records with a known answer):`);
  console.log('  gate  judge  record');
  for (const p of probes) {
    const d = decide(p.candidate);
    const gateOk = d.admitted === p.must_capture;
    if (gateOk) report.gatePassed++;
    else report.gateFailed++;
    const l = known.get(candidateHash(p.candidate));
    let judgeMark = '  -  ';
    if (l) {
      report.judgeLabelled++;
      const ok = l.relevant === p.expect_relevant;
      if (ok) report.judgePassed++;
      judgeMark = ok ? ' ok  ' : 'WRONG';
    }
    const want = p.must_capture ? 'must capture' : 'must reject';
    console.log(
      `  ${gateOk ? ' ok ' : 'FAIL'}  ${judgeMark}  ${p.name}`
    );
    console.log(`          ${want}; gate says ${d.admitted ? 'ADMIT' : 'reject'} (${d.reason})` + (l ? `; judge says ${l.relevant ? 'relevant' : 'not relevant'} (${l.reason})` : ''));
  }
  console.log(
    `  Gate: ${report.gatePassed}/${probes.length} probes correct. ` +
      `Judge: ${report.judgePassed}/${report.judgeLabelled} labelled probes agree with ground truth.`
  );
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runProbes().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
