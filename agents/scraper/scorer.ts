// Haiku scoring. Runs ONLY on leads that already passed the keyword prefilter
// (and, for fuel leads, the broker-noise filter) so we never pay to score
// garbage. Scores each lead 0-100 as a potential engagement for Philip Kwong,
// using the matched industry to focus the judgement.

import Anthropic from '@anthropic-ai/sdk';

const MODEL = 'claude-haiku-4-5-20251001';

const PROMPT_HEAD = `
You are a lead scoring agent for Philip Kwong, a regulatory compliance and corporate strategy consultant operating between Vancouver and Bangkok.

Philip's services:
- Regulatory compliance, QMS architecture, licensing pathways (pharma, medical device, cannabis, food, financial)
- Corporate strategy, market entry, commercialization, feasibility studies
- AI automation systems and agent infrastructure, digital transformation
- Professional web presence for regulated businesses
- For fuel: he advises on genuine fuel-supply procurement, not brokerage.

The lead below was matched to the industry profile shown. It is either a
government tender/RFP (an organization seeking an outside contractor) or an
employer posting / contract notice (a softer signal that an organization has a
need Philip could pitch advisory or interim services against).

Score 0 to 100 on how good a fit it is as a paid engagement Philip could win or pitch:
- 80 to 100: Direct match. A tender or engagement for compliance, regulatory, QMS, ISO, licensing, market entry, strategy, automation, or genuine fuel supply.
- 60 to 79: Strong match. Adjacent advisory/consulting need in a regulated or professional-services context.
- 40 to 59: Partial match. General consulting/strategy need, or a relevant hiring signal.
- 0 to 39: Poor match. Unrelated, too junior, or no consulting angle.

Respond in JSON only. No preamble. No markdown.

{
  "score": 0,
  "score_reason": "one sentence explanation"
}

Lead:
`;

const client = new Anthropic();

export interface ScorerInput {
  title: string;
  raw_content: string;
  source: string;
  industry: string;
}

export interface ScoreResult {
  score: number;
  score_reason: string;
}

function parseScore(text: string): ScoreResult | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let body = (fenced ? fenced[1] : text).trim();
  const first = body.indexOf('{');
  const last = body.lastIndexOf('}');
  if (first !== -1 && last > first) body = body.slice(first, last + 1);
  try {
    const parsed = JSON.parse(body);
    return {
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      score_reason: parsed.score_reason || '',
    };
  } catch {
    return null;
  }
}

// Bounded connection pool + retry on transient 429s (1s, 2s, 4s).
const MAX_CONCURRENCY = 6;
const MAX_RETRIES = 3;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function scoreLead(lead: ScorerInput): Promise<ScoreResult> {
  let response;
  for (let attempt = 0; ; attempt++) {
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 200,
        messages: [
          {
            role: 'user',
            content:
              PROMPT_HEAD +
              `\nIndustry profile: ${lead.industry}\nSource: ${lead.source}\nTitle: ${lead.title}\n\n${lead.raw_content}`,
          },
        ],
      });
      break;
    } catch (err) {
      const status = (err as { status?: number })?.status;
      if (status === 429 && attempt < MAX_RETRIES) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      throw err;
    }
  }

  const block = response.content[0];
  const text = block && block.type === 'text' ? block.text : '';
  const parsed = parseScore(text);
  if (!parsed) {
    console.error(
      `Score parse failed for "${lead.title.slice(0, 50)}". Raw: ${JSON.stringify(text.slice(0, 160))}`
    );
    return { score: 0, score_reason: 'Parse error' };
  }
  return parsed;
}

// Score a batch through a fixed-size worker pool. Results preserve input order.
export async function scoreLeads(leads: ScorerInput[]): Promise<ScoreResult[]> {
  const results = new Array<ScoreResult>(leads.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < leads.length) {
      const i = next++;
      results[i] = await scoreLead(leads[i]);
    }
  }
  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, leads.length) }, worker);
  await Promise.all(workers);
  return results;
}
