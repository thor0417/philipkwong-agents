// Haiku scoring logic. Scores each lead as a potential consulting engagement.

import Anthropic from '@anthropic-ai/sdk';
import type { RawLead } from './scraper';

const SCORING_PROMPT = `
You are a lead scoring agent for Philip Kwong, a regulatory compliance and corporate strategy consultant operating between Vancouver and Bangkok.

Philip's services:
- Regulatory compliance, QMS architecture, licensing pathways
- Corporate strategy, market entry, commercialization
- AI automation systems and agent infrastructure
- Professional web presence for regulated businesses

The lead below is ONE of:
(a) a Canadian government tender / RFP (source: canadabuys) — an organization actively seeking an outside contractor or consultant, or
(b) an employer job posting (source: adzuna) — a company hiring, which is a softer signal that the organization has a need Philip could pitch advisory/interim services against.

Score the lead 0 to 100 on how good a fit it is as a paid engagement Philip could win or pitch. Tenders that directly seek compliance, regulatory, QMS, strategy, or automation services should score highest. A full-time junior job posting unrelated to his services should score low.

Scoring criteria:
- 80 to 100: Direct match. A tender or engagement for compliance, regulatory affairs, QMS, ISO, licensing, market entry, strategy, or AI automation.
- 60 to 79: Strong match. Adjacent advisory/consulting need in a regulated or professional-services context.
- 40 to 59: Partial match. General consulting or strategy need, or a relevant employer hiring signal.
- 0 to 39: Poor match. Unrelated, too junior, or a staff role with no consulting angle.

Also extract:
- jurisdiction: the client's country, province, or region if mentioned (Canadian tenders are usually Canada)
- budget: the contract value, salary, or rate if mentioned, else null

Respond in JSON only. No preamble. No markdown.

{
  "score": 0,
  "score_reason": "one sentence explanation",
  "jurisdiction": "extracted jurisdiction or null",
  "budget": "extracted budget or null"
}

Lead:
`;

// Anthropic() reads ANTHROPIC_API_KEY from the environment automatically.
const client = new Anthropic();

export interface ScoredLead extends RawLead {
  score: number;
  score_reason: string;
  jurisdiction: string | null;
  budget: string | null;
}

export async function scoreLead(lead: RawLead): Promise<ScoredLead> {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [
      {
        role: 'user',
        content:
          SCORING_PROMPT +
          `\nSource: ${lead.source}\nTitle: ${lead.title}\n\n${lead.content}`,
      },
    ],
  });

  const block = response.content[0];
  const text = block && block.type === 'text' ? block.text : '{}';

  try {
    const parsed = JSON.parse(text);
    return {
      ...lead,
      score: typeof parsed.score === 'number' ? parsed.score : 0,
      score_reason: parsed.score_reason || '',
      jurisdiction: parsed.jurisdiction || null,
      budget: parsed.budget || null,
    };
  } catch {
    return {
      ...lead,
      score: 0,
      score_reason: 'Parse error',
      jurisdiction: null,
      budget: null,
    };
  }
}
