// THE GOVERNMENT GATE DECISION, IN ONE PLACE, AND THE CORPUS THAT MAKES IT
// MEASURABLE.
//
// Every government source used to inline its own combination of governmentGate
// and the target bypass: legistar.ts, agenda-portal.ts (covering Anaheim, Las
// Vegas and Clark TAB), ceqanet.ts and pdf-agenda.ts each had a copy. Four
// copies of one rule is bad enough. The part that mattered more is that the
// decision existed ONLY inside the adapters, so a rejected record was dropped
// where nothing could ever see it again.
//
// That is why recall went unmeasured for so long. Precision only needs the
// records we kept, and those are in the database. Recall needs the records we
// threw away, and nothing kept them. A number nobody can compute is a number
// nobody checks, and this one turned out to be 30 percent.
//
// gateDecide is the rule, called by every source. With GATE_AUDIT=1 it also
// records the CANDIDATE - the exact text the gate judged, whether it passed or
// not - to a JSONL corpus. Two consequences:
//
//   1. The rejected half of the decision is preserved, so recall is computable.
//   2. A frozen corpus can be re-gated offline after a vocabulary change, so a
//      change in the numbers is attributable to the change in the GATE rather
//      than to whatever the portals happened to publish that morning.
//
// The recorded text is the full text the gate saw, never a truncation, because
// an offline re-gate has to be able to reproduce the live verdict exactly.

import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import { governmentGate, type GateReason, type GateVerdict } from '../../lib/taxonomy';
import { bypassesGate, strongBypassesGate } from './targets';

// How a source treats named-target terms.
//   'all'    - any bypass term admits the record (agenda portals, CEQAnet)
//   'strong' - the CFTOD-letterhead geographic Disney terms do not count
//              (inside CFTOD's own packets they are the district's address)
//   'none'   - the source does not consult the target list at all
export type BypassMode = 'none' | 'all' | 'strong';

export interface GateCandidate {
  // Adapter tag, matching the lead's source column ('legistar', 'agenda-portal',
  // 'clark-tab', 'ceqanet', 'cftod-pdf').
  source: string;
  // Jurisdiction label, so recall can be read per market as well as per source.
  market: string;
  // Stable identity for the candidate, so a record keeps one identity across
  // harvests. Not necessarily a URL: a rejected Legistar matter never gets one.
  key: string;
  title: string;
  // The exact text governmentGate judges.
  gate_text: string;
  // The exact text the target bypass reads. Often wider than gate_text: the gate
  // judges an item's own subject, the bypass reads the whole item.
  bypass_text?: string;
  bypass_mode: BypassMode;
  // The jurisdiction itself is the signal (CFTOD, a Legistar bypassGate client),
  // so the record is kept whatever the vocabulary says.
  single_purpose?: boolean;
}

export type GateDecisionReason = GateReason | 'bypass' | 'single-purpose';

export interface GateDecision {
  admitted: boolean;
  reason: GateDecisionReason;
  verdict: GateVerdict;
  bypass: boolean;
}

// The gate decision for one candidate. PURE: no I/O, no audit, no clock, so the
// measurement harness can re-run it over a frozen corpus and get exactly what
// the live adapter got.
export function decide(c: GateCandidate): GateDecision {
  const verdict = governmentGate(c.gate_text);
  const bypassText = c.bypass_text ?? c.gate_text;
  const bypass =
    c.bypass_mode === 'all'
      ? bypassesGate(bypassText)
      : c.bypass_mode === 'strong'
        ? strongBypassesGate(bypassText)
        : false;

  if (verdict.matched) return { admitted: true, reason: verdict.reason, verdict, bypass };
  if (bypass) return { admitted: true, reason: 'bypass', verdict, bypass };
  if (c.single_purpose) return { admitted: true, reason: 'single-purpose', verdict, bypass };
  return { admitted: false, reason: verdict.reason, verdict, bypass };
}

// Stable identity for labelling: a judgement about a record's relevance is a
// judgement about its text, so the hash covers the text the gate judged. It does
// NOT cover the verdict, so a label survives every gate change in this brief -
// which is the point: the same record judged once stays judged.
export function candidateHash(c: Pick<GateCandidate, 'source' | 'title' | 'gate_text'>): string {
  return createHash('sha1').update(`${c.source}\n${c.title}\n${c.gate_text}`).digest('hex').slice(0, 16);
}

// ---- The audit corpus -------------------------------------------------------

export const DEFAULT_CORPUS_FILE = 'gate-corpus/candidates.jsonl';

const corpusFile = (): string => process.env.GATE_CORPUS_FILE ?? DEFAULT_CORPUS_FILE;

let auditing = false;
let auditCount = 0;
const seenKeys = new Set<string>();

export function gateAuditActive(): boolean {
  return auditing;
}

// Start recording. Truncates the corpus file, so a harvest never appends to a
// stale run and half-reports two different mornings as one corpus.
export function startGateAudit(): void {
  auditing = true;
  auditCount = 0;
  seenKeys.clear();
  const file = corpusFile();
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) rmSync(file);
}

export function stopGateAudit(): number {
  auditing = false;
  return auditCount;
}

// A candidate can be judged twice in one run (the same agenda item reached
// through two meeting links). The corpus keeps the first, so counts are per
// record rather than per evaluation.
function note(c: GateCandidate): void {
  if (!auditing) return;
  const id = `${c.source}|${c.key}`;
  if (seenKeys.has(id)) return;
  seenKeys.add(id);
  auditCount++;
  appendFileSync(corpusFile(), `${JSON.stringify(c)}\n`, 'utf8');
}

// The gate decision AS THE ADAPTERS TAKE IT: decide, then record the candidate
// when a harvest is running.
export function gateDecide(c: GateCandidate): GateDecision {
  note(c);
  return decide(c);
}

export function readGateCorpus(file: string = corpusFile()): GateCandidate[] {
  if (!existsSync(file)) return [];
  const out: GateCandidate[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as GateCandidate);
    } catch {
      // A half-written final line from an interrupted harvest; the rest stands.
    }
  }
  return out;
}

export function corpusPath(): string {
  return corpusFile();
}
