// RELEVANCE LABELS for the government gate, and the label store that keeps them.
//
// Precision and recall both need one thing the gate cannot supply: a judgement
// about whether a record IS relevant, independent of whether the gate admitted
// it. The earlier precision sample refused to guess at this and left the judging
// to a person, which was honest and also why the number was measured once and
// never again.
//
// This is the compromise that makes it re-runnable without pretending:
//
//   1. Each sampled record is judged ONCE, by a model, against a written rubric.
//   2. The judgement is CACHED in a committed fixture (fixtures/gate-labels.jsonl),
//      with its one-line reason. Re-running the harness re-reads labels; it does
//      not re-judge. So the numbers are reproducible and cost nothing to repeat.
//   3. Every label is legible and correctable. fixtures/gate-labels.overrides.jsonl
//      is hand-authored and ALWAYS wins. When Philip disagrees with a judgement,
//      the fix is one line there and the numbers move accordingly.
//
// So the labels are a model's reading of a published rubric, recorded so they can
// be audited and overridden - not an oracle. A number derived from them is only
// as good as the rubric, and the rubric is in this file where it can be argued
// with. The calibration set (fixtures/gate-probes.jsonl) checks the judge against
// records whose correct answer is already known from the July report.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { candidateHash, type GateCandidate } from './gate-decide';

export const LABEL_FILE = 'agents/scraper/fixtures/gate-labels.jsonl';
export const OVERRIDE_FILE = 'agents/scraper/fixtures/gate-labels.overrides.jsonl';

// THE JUDGE MODEL. Haiku 4.5 was tried first and could not hold the two-limb
// rubric: it agreed with ground truth on 11 of 13 calibration probes, and both
// failures were limb-2 records where it restated "no leisure component" against
// a rubric that explicitly said limb 2 wins. That is the exact class this brief
// exists to fix, so a judge blind to it would have scored the fix as worthless.
//
// NO temperature PARAMETER. Sonnet 5 rejects non-default sampling parameters
// with a 400 (as do Opus 4.7+), so temperature cannot be set here. Determinism
// comes from the LABEL CACHE instead, which is the stronger guarantee anyway: a
// judged record is judged once and the answer is committed to the fixture, so
// re-running the harness re-reads rather than re-rolls.
const MODEL = process.env.GATE_JUDGE_MODEL ?? 'claude-sonnet-5';
const CONCURRENCY = 6;
const RETRIES = 3;

export interface GateLabel {
  hash: string;
  source: string;
  market: string;
  // Truncated for legibility in the fixture; the hash covers the full text.
  title: string;
  relevant: boolean;
  reason: string;
  // 'haiku-4.5' for a judged label, 'hand' for an override.
  judge: string;
  // The rubric the judgement was made against. A label from a superseded rubric
  // is not loaded, so two standards can never be mixed into one number.
  rubric?: string;
}

// THE RUBRIC, AND WHY IT IS WRITTEN DOWN HERE.
//
// Precision and recall are only as meaningful as the definition of "relevant",
// so the definition is published rather than assumed. It has TWO limbs, and the
// second one is easy to miss:
//
//   LIMB 1, the leisure/hospitality domain. The register's subject matter.
//   LIMB 2, the municipal development DEAL. A city transacting with a named
//   private developer over land or money originates exactly the regulatory-
//   compliance and corporate-strategy work this register exists to find,
//   whatever the asset class. This limb is not optional and it is not
//   generosity: all three of the July-report records the audit found rejected
//   are limb-2 records (a disposition and redevelopment solicitation, a TIF
//   reimbursement development agreement, a development agreement amendment).
//   A rubric with only limb 1 labels all three irrelevant and would "prove" the
//   gate correct to have discarded them, which is how a measurement lies.
//
// The exclusions are equally deliberate. A single-family subdivision is not a
// project for this register even when it arrives as a development agreement -
// that is the guard Part 3 of the brief asks for, stated at the level of the
// definition rather than only in code.
//
// FIRST VERSION OF THIS RUBRIC (v1) had limb 1 only. Measured against it, the
// baseline read 48 percent precision and ZERO relevant records among 200
// rejects, i.e. it declared the gate to have perfect recall while the July
// report contained three records it had thrown away. That contradiction is what
// identified the rubric, not the gate, as wrong. Labels carry their rubric
// version and a version change forces a re-judge, so the two standards can
// never be averaged together into a number that means nothing.
// v2 -> v3, both corrections forced by the calibration set rather than chosen:
// the judge disagreed with client-delivered ground truth on two of thirteen
// probes, and in both cases the rubric was underspecified.
//   1. THE SOLICITATION STAGE. "Authorization to Issue Disposition and
//      Redevelopment Solicitation" was judged irrelevant for having no named
//      counterparty. Correct reading of v2, wrong answer: a solicitation is how
//      the counterparty gets found, and a pre-tender register wants the deal at
//      its FIRST public step, not its last.
//   2. PRECEDENCE between the limbs. The Encore Multifamily TIF agreement was
//      judged irrelevant as residential. Both readings were available in v2 and
//      nothing said which wins. It is a $7m public-money deal, so limb 2 wins -
//      except for detached subdivisions, which is the guard the brief asks for.
// v3 -> v4: the rubric text is unchanged in substance; what changed is that the
// judge must now DECIDE IN ORDER and report which limb it applied, and the judge
// model moved up (see MODEL below). Both change the labels, so the version moves
// with them rather than mixing two judges' answers in one number.
// v4 -> v5, the last correction the calibration set forced: limb 2 now requires
// the deal to concern REAL PROPERTY. A $50k "Funding Agreement" for the Art
// Everywhere initiative was judged a limb-2 deal, which is a fair reading of v4
// and the wrong answer - it is arts programming, and admitting its class would
// hand a bare "funding agreement" term in Part 2 a pile of grants to fire on.
export const RUBRIC_VERSION = 'v5';

const RUBRIC = `You are labelling US local-government records for a development register kept by a regulatory-compliance and corporate-strategy consultant. Its subject is leisure and hospitality development (hotels, resorts, casinos and gaming, theme parks and attractions, arenas, stadiums, convention and exhibition centres, entertainment districts, cultural and performing-arts venues, marinas, golf, tourism districts) and, more broadly, the deals cities strike with private developers.

Answer one question: should this record be in that register?

RELEVANT (true) - LIMB 1, the leisure and hospitality domain. The record's own subject is:
- a leisure, hospitality, entertainment, tourism, gaming, resort, attraction, sports-venue or cultural-venue project; or
- a filing, approval, entitlement, ordinance, plan amendment, environmental permit or study that advances one (rezoning, use permit, site plan, plat, comprehensive plan amendment, variance, vacation of right-of-way); or
- the physical capital programme of such a venue: construction, renovation, expansion, or replacement of major building systems; or
- roadway, utility or infrastructure work serving a resort, theme park, entertainment district or single-purpose tourism district (a Walt Disney World roadway change order IS relevant); or
- the finance or governance of a tourism, resort or entertainment DISTRICT specifically (a tourism improvement district assessment, an entertainment-district overlay, a district special tax); or
- a destination mixed-use project with a real leisure component (hotel, entertainment, cultural or convention uses).

RELEVANT (true) - LIMB 2, the municipal development deal. The record's own subject is a deal between a public body and a private developer over land, development rights, or public money for a development project, whatever the asset class. This includes: development agreement (and any amendment to one), disposition and development agreement, redevelopment agreement, ground lease of public land for development, exclusive negotiation agreement, economic incentive agreement, funding agreement for a capital project, tax increment financing or reinvestment-zone reimbursement, participation agreement, land sale or exchange for development.

A limb-2 deal must concern REAL PROPERTY DEVELOPMENT: land, buildings, or the public improvements that serve them. A grant or agreement funding programming, events, marketing, district activation, public art, studies of policy rather than of a site, or ongoing operations is NOT a limb-2 deal, even when the document is titled a funding agreement.

The private party does not have to be named yet. An authorization to ISSUE a disposition, redevelopment or development solicitation - a city inviting proposals from developers for a site it controls - is a limb-2 record: it is the first public step of exactly that deal, and this register wants deals early.

PRECEDENCE. When a record fits limb 2 and also fits a residential exclusion below, limb 2 wins, with one exception: a detached or single-family subdivision is never relevant, not even as a development agreement. So a development agreement, incentive agreement or TIF reimbursement for a multifamily, apartment or mixed-use project IS relevant, while a site plan or design review for the same building, with no deal attached, is NOT.

NOT RELEVANT (false) when the record's own subject is:
- a single-family or detached residential subdivision, including as a development agreement, tentative map, plat or planned unit development;
- routine residential entitlement with no deal and no leisure component: a site plan, design review or use permit for an apartment or condominium building, a housing element update, an affordable-housing allocation;
- industrial, warehouse, logistics, data-centre, office, medical, school, church, correctional or ordinary retail development with no public-private deal;
- municipal governance: personnel, appointments, proclamations, recognitions, labour, litigation, elections, city-wide budgets and appropriations limits, procedural meeting mechanics, minutes, board vacancies;
- general public infrastructure with no leisure or tourism beneficiary and no named private counterparty (a storm-drain master plan, a sewer main, residential street repaving, a transit operating contract);
- procurement of goods or routine services, even for a leisure venue: supplies, furniture, upholstery, locks, landscaping, event staffing, donations, insurance, maintenance service contracts;
- routine licensing, code enforcement, fee schedules or business permits for an existing business with no project attached (a liquor licence renewal is not a project);
- a record naming a venue only as the place a meeting is held, or carrying a leisure term only as agenda boilerplate rather than as its subject.

Judge the record's OWN SUBJECT. A term appearing incidentally does not make it relevant. A terse, coded or bureaucratic title does not make it irrelevant when the subject is a project or a deal: "Authorization to Issue Disposition and Redevelopment Solicitation" is a limb-2 record even though it names no building.

DECIDE IN THIS ORDER, and report which limb you applied:
1. Is it a limb-2 development deal? If yes, relevant - unless it is a detached or single-family subdivision. Answer limb 2.
2. Otherwise, is it a limb-1 leisure and hospitality record? If yes, relevant. Answer limb 1.
3. Otherwise it is not relevant. Answer limb 0.

Return STRICT JSON only: {"limb": 0|1|2, "relevant": true|false, "reason": "<12 words or fewer>"}`;

const client = new Anthropic();
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function readJsonl(file: string): GateLabel[] {
  if (!existsSync(file)) return [];
  const out: GateLabel[] = [];
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    try {
      out.push(JSON.parse(t) as GateLabel);
    } catch {
      console.warn(`Labels: skipped an unparseable line in ${file}.`);
    }
  }
  return out;
}

// Every label on disk for the CURRENT rubric: judged labels first, hand
// overrides last so they win. A hand override is honoured whatever rubric
// version it carries, because a person judging a record outranks the rubric's
// version number.
export function loadLabels(): Map<string, GateLabel> {
  const m = new Map<string, GateLabel>();
  let stale = 0;
  for (const l of readJsonl(LABEL_FILE)) {
    if ((l.rubric ?? 'v1') !== RUBRIC_VERSION) {
      stale++;
      continue;
    }
    m.set(l.hash, l);
  }
  for (const l of readJsonl(OVERRIDE_FILE)) m.set(l.hash, { ...l, judge: 'hand' });
  if (stale > 0) {
    console.log(`Labels: ignored ${stale} labels from a superseded rubric (current: ${RUBRIC_VERSION}).`);
  }
  return m;
}

function parseVerdict(text: string): { relevant: boolean; reason: string; limb?: number } | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced ? fenced[1] : text).trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) body = body.slice(first, last + 1);
  try {
    const p = JSON.parse(body) as { relevant?: unknown; reason?: unknown; limb?: unknown };
    if (typeof p.relevant !== 'boolean') return null;
    return {
      relevant: p.relevant,
      reason: typeof p.reason === 'string' ? p.reason.slice(0, 120) : '',
      limb: typeof p.limb === 'number' ? p.limb : undefined,
    };
  } catch {
    return null;
  }
}

async function judgeOne(c: GateCandidate): Promise<GateLabel | null> {
  const prompt =
    `${RUBRIC}\n\nSource: ${c.source}\nJurisdiction: ${c.market}\nRecord title: ${c.title}\n\n` +
    `Record text as the gate reads it:\n${c.gate_text.slice(0, 1500)}`;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        // ROOM FOR THINKING. Sonnet 5 runs adaptive thinking when the thinking
        // parameter is omitted, and max_tokens caps thinking AND response text
        // together. At 200 tokens the harder records spent the whole budget
        // reasoning and returned an empty reply with stop_reason 'max_tokens' -
        // eight records dropped out of the sample that way. Thinking is left ON
        // deliberately (it is why the judge holds the two-limb rubric at all);
        // the budget is raised instead. Output is billed on what is used, so
        // this costs nothing for the records that already answered in one line.
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      });
      // FIND THE TEXT BLOCK, never assume it is first. Adaptive thinking is on,
      // so a record the judge chose to think about comes back as a thinking
      // block THEN a text block - and because thinking display defaults to
      // omitted, that first block's text is empty. Reading content[0] therefore
      // returned "" and silently dropped exactly the records the judge found
      // hard enough to reason about, which is the worst possible sample to lose.
      const raw = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
      const v = parseVerdict(raw);
      if (!v) {
        if (attempt < RETRIES) continue;
        // NEVER FAIL SILENTLY. An unparseable reply drops the record from the
        // sample, which quietly shrinks n and moves the rates. The reply itself
        // is the only evidence of why, so it is printed rather than swallowed.
        console.error(
          `Labels: unparseable reply after ${RETRIES + 1} attempts for "${c.title.slice(0, 60)}"` +
            ` [${c.source}] stop_reason=${res.stop_reason ?? '?'} reply=${JSON.stringify(raw.slice(0, 200))}`
        );
        return null;
      }
      return {
        hash: candidateHash(c),
        source: c.source,
        market: c.market,
        title: c.title.replace(/\s+/g, ' ').slice(0, 160),
        relevant: v.relevant,
        reason: v.limb !== undefined ? `limb ${v.limb}: ${v.reason}` : v.reason,
        judge: MODEL,
        rubric: RUBRIC_VERSION,
      };
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if ((status === 429 || status === 529 || status === 500) && attempt < RETRIES) {
        await sleep(1500 * 2 ** attempt);
        continue;
      }
      console.error(`Labels: judge failed for "${c.title.slice(0, 48)}": ${String(err).slice(0, 90)}`);
      return null;
    }
  }
}

// Label every candidate that has no label yet, appending each new one to the
// fixture as it lands so an interrupted run keeps what it paid for.
export async function labelCandidates(
  candidates: GateCandidate[]
): Promise<Map<string, GateLabel>> {
  const labels = loadLabels();
  const todo = candidates.filter((c) => !labels.has(candidateHash(c)));
  if (todo.length === 0) {
    console.log(`Labels: all ${candidates.length} sampled records already labelled (${LABEL_FILE}).`);
    return labels;
  }
  if (process.env.GATE_LABELS_READONLY === '1') {
    console.warn(
      `Labels: ${todo.length} sampled records are unlabelled and GATE_LABELS_READONLY=1, so they are excluded from the numbers.`
    );
    return labels;
  }
  console.log(`Labels: judging ${todo.length} new records (${candidates.length - todo.length} cached).`);
  mkdirSync(dirname(LABEL_FILE), { recursive: true });

  let next = 0;
  let done = 0;
  let failed = 0;
  async function worker(): Promise<void> {
    while (next < todo.length) {
      const c = todo[next++];
      const l = await judgeOne(c);
      if (!l) {
        failed++;
        continue;
      }
      labels.set(l.hash, l);
      appendFileSync(LABEL_FILE, `${JSON.stringify(l)}\n`, 'utf8');
      if (++done % 25 === 0) console.log(`    ...${done}/${todo.length} judged`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, todo.length) }, worker));
  console.log(`Labels: ${done} judged, ${failed} failed (unlabelled records are excluded from the rates).`);
  return labels;
}
