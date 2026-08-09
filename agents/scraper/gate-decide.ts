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
import { governmentGate, isDetachedResidential, type GateReason, type GateVerdict } from '../../lib/taxonomy';
import { bypassAdmits, strongBypassAdmits } from './targets';
import { knownEntityHit, type KnownEntity } from './known-entities';

// How a source treats named-target terms.
//   'all'    - any bypass term admits the record (agenda portals, CEQAnet)
//   'strong' - the CFTOD-letterhead geographic Disney terms do not count
//              (inside CFTOD's own packets they are the district's address)
//   'none'   - the source does not consult the target list at all
export type BypassMode = 'none' | 'all' | 'strong';

// BYPASS MODE IS A SOURCE POLICY, NOT A PROPERTY OF ONE CANDIDATE.
//
// It used to be neither: each adapter passed a literal at its own call site, and
// gate-decide took whatever it was handed. That had two consequences, and the
// second is the one that mattered.
//
// The obvious one: the policy was four literals in four files, so "which sources
// read the target list?" could only be answered by grepping.
//
// The one that actually cost us: the harvested corpus RECORDS the mode it was
// given, and the measurement harness re-gates that corpus. So the stored literal
// froze the old policy into every candidate. Changing an adapter's mode would
// change live capture while gate:measure went on reporting the old number - the
// exact failure the frozen corpus exists to prevent, since the whole point is
// that a change in the numbers is attributable to a change in the GATE.
//
// Resolving the mode from this table at decide time fixes both. A corpus
// harvested last week re-gates under today's policy, so the before/after is a
// real measurement of the change rather than a replay of the harvest.
export const SOURCE_BYPASS_MODE: Record<string, BypassMode> = {
  // LEGISTAR NOW CONSULTS THE TARGET LIST.
  //
  // It was the only government source that did not, and it is 1914 of the 2818
  // candidates in the corpus - 68 percent. A Heart Hotel, OCVibe or Disney
  // matter arriving through Legistar with no venue noun in its title was
  // dropped even though the target was named in it, so the watch terms were
  // half-functional on the source that carries most of the traffic.
  legistar: 'all',
  'agenda-portal': 'all',
  'clark-tab': 'all',
  ceqanet: 'all',
  // Inside CFTOD's own packets the geographic Disney terms are letterhead.
  'cftod-pdf': 'strong',
  // The three New York City sources. All read the target list, for the same
  // reason legistar does: a watched developer's filing must be captured whether
  // or not its title happens to carry a venue noun, and ZAP project names are
  // very often a bare street address.
  'nyc-zap': 'all',
  'nyc-city-record': 'all',
  'nyc-ceqr': 'all',
};

// The mode for a source. An unregistered source falls back to what the caller
// declared, so a new adapter behaves as written until it is listed here.
export function bypassModeFor(source: string, declared: BypassMode = 'none'): BypassMode {
  return SOURCE_BYPASS_MODE[source] ?? declared;
}

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
  // The mode the ADAPTER declares. Advisory only for a source listed in
  // SOURCE_BYPASS_MODE, which is where the live policy lives; it is still
  // recorded in the corpus so an old harvest documents the rule it ran under.
  bypass_mode: BypassMode;
  // The jurisdiction itself is the signal (CFTOD, a Legistar bypassGate client),
  // so the record is kept whatever the vocabulary says.
  single_purpose?: boolean;
}

export type GateDecisionReason = GateReason | 'bypass' | 'known-entity' | 'single-purpose';

export interface GateDecision {
  admitted: boolean;
  reason: GateDecisionReason;
  verdict: GateVerdict;
  bypass: boolean;
  // The tracked-project party that admitted this record, when that is why.
  entity?: KnownEntity | null;
}

// The gate decision for one candidate. No I/O, no clock, so the measurement
// harness can re-run it over a frozen corpus and get exactly what the live
// adapter got.
//
// ONE PIECE OF STATE: the known-entity index (agents/scraper/known-entities),
// loaded once per run before the adapters. An unloaded index makes the entity
// bypass inert rather than wrong, which is the safe default for any caller that
// does not want to consult the register.
export function decide(c: GateCandidate): GateDecision {
  const verdict = governmentGate(c.gate_text);
  const bypassText = c.bypass_text ?? c.gate_text;
  // Resolved from the source policy, not from the candidate's stored literal, so
  // a frozen corpus re-gates under today's rule. See SOURCE_BYPASS_MODE.
  const mode = bypassModeFor(c.source, c.bypass_mode);
  // ADMISSION, not flagging: a term marked weakForClustering cannot carry a
  // bypass on its own. See WEAK_ALONE in targets.
  const bypass =
    mode === 'all'
      ? bypassAdmits(bypassText)
      : mode === 'strong'
        ? strongBypassAdmits(bypassText)
        : false;

  if (verdict.matched) return { admitted: true, reason: verdict.reason, verdict, bypass };

  // AN EXCLUSION BEATS THE TARGET BYPASS.
  //
  // It did not, and that made the two layers disagree about the same records.
  // The clusterer already refuses a district term on a city-wide fiscal or
  // electoral record (targets.districtTerms: the budget and a ballot measure
  // enumerate every district in the city and are about none of them), but the
  // GATE went on admitting those same records because 'platinum triangle'
  // appeared somewhere in the agenda text. So the record was captured and then
  // refused a project - noise with nowhere to go.
  //
  // lib/taxonomy has said "EXCLUSIONS override everything" since it was
  // written. This makes the gate agree with its own documentation.
  //
  // Measured over the frozen corpus, 4 records are admitted this way and the
  // labels call all 4 irrelevant, with none of them a real project:
  //   - two Anaheim FY budget / appropriations-limit hearings ('platinum
  //     triangle', excluded by 'budget appropriations')
  //   - the Tourism Mobility Tax submission to the voters ('platinum
  //     triangle', excluded by 'general municipal election')
  //   - a CONFERENCE WITH LABOR NEGOTIATORS closed session, which matched
  //     'ocvibe' and 'platinum triangle' only because the wider agenda text
  //     names them elsewhere on the page
  //
  // This aligns the named-target bypass with the known-entity bypass below,
  // which has never overridden an exclusion. The asymmetry noted there is now
  // closed rather than merely observed.
  if (bypass && verdict.reason !== 'excluded') {
    return { admitted: true, reason: 'bypass', verdict, bypass };
  }

  // THE KNOWN-ENTITY BYPASS. A record whose party is already attached to a
  // tracked project in the same market is admitted on that identity, the way a
  // named target is. Three things about where it sits:
  //
  // It is matched on the record's OWN SUBJECT (gate_text), never the wider body.
  // Measured: matching the body admitted two Clark County waivers whose own
  // subject is a different applicant entirely ("3984 BHLV, LLC"), because a
  // tracked party's name appeared in a neighbouring agenda item. Own-subject
  // matching took the rule from 50 to 62.5 percent precision.
  //
  // It does NOT override an exclusion. A tracked developer named in a
  // proclamation or a closed-session item is not a project event. The named-
  // target bypass above no longer overrides them either: the asymmetry noted
  // here was measured and closed, and both bypasses now yield to an exclusion.
  //
  // It respects the detached-residential veto, so a tracked project's
  // single-family subdivision filings stay out exactly as Part 2 decided.
  if (verdict.reason !== 'excluded' && !isDetachedResidential(c.gate_text)) {
    const entity = knownEntityHit(c.gate_text, c.market);
    if (entity) return { admitted: true, reason: 'known-entity', verdict, bypass, entity };
  }

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
