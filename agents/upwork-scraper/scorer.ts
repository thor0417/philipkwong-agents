// Haiku scoring logic for the Upwork scraper.

import Anthropic from '@anthropic-ai/sdk';
import type { RawLead } from './scraper';

const SCORING_PROMPT = `
You are a lead scoring agent for Philip Kwong, a regulatory compliance and corporate strategy consultant operating between Vancouver and Bangkok.

Philip's services:
- Regulatory compliance, QMS architecture, licensing pathways
- Corporate strategy, market entry, commercialization
- AI automation systems and agent infrastructure
- Professional web presence for regulated businesses

Score this Upwork job posting from 0 to 100 based on fit.

Scoring criteria:
- 80 to 100: Direct match. Compliance, regulatory, QMS, ISO, cannabis regulation, market entry Canada, AI automation for business
- 60 to 79: Strong match. Strategy consulting, operations, regulated industry work, professional services web
- 40 to 59: Partial match. General consulting, business strategy, web development for professional firms
- 0 to 39: Poor match. Unrelated industries, too junior, budget too low

Also extract:
- jurisdiction: the client's country or region if mentioned
- budget: the posted budget or rate if mentioned

Respond in JSON only. No preamble. No markdown.

{
  "score": 0,
  "score_reason": "one sentence explanation",
  "jurisdiction": "extracted jurisdiction or null",
  "budget": "extracted budget or null"
}

Job posting:
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
        content: SCORING_PROMPT + `\nTitle: ${lead.title}\n\nDescription: ${lead.content}`,
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
