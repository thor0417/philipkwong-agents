// Keyword pre-filter. Zero API cost.
//
// A lead must match at least `minKeywordMatches` of a profile's keywords before
// it is allowed to reach the Haiku scorer. The threshold is per-profile
// (profile.minKeywordMatches), defaulting to 3 when the profile omits it. This
// cuts paid scoring calls by 80 to 90 percent by dropping obvious non-matches.
//
// Operates on a plain haystack string so it stays decoupled from the lead shape;
// the orchestrator assembles the haystack (title + content + company + location).

import type { IndustryProfile } from './profiles';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Word-boundary, case-insensitive match. Keywords here are alphanumeric-bounded
// (phrases, codes like "ISO 13485", "F&B", "tank-to-tank"), so \b on each side
// avoids substring false positives (e.g. "AML" inside another word).
function matchesKeyword(text: string, keyword: string): boolean {
  const re = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, 'i');
  return re.test(text);
}

// Unique keywords from the list that appear in the text.
export function keywordMatches(text: string, keywords: string[]): string[] {
  const found: string[] = [];
  for (const kw of keywords) {
    if (matchesKeyword(text, kw)) found.push(kw);
  }
  return found;
}

// Prefilter threshold for a profile: its minKeywordMatches, or 3 by default.
export function prefilterThreshold(profile: IndustryProfile): number {
  return profile.minKeywordMatches ?? 3;
}

export interface PrefilterResult {
  passed: boolean;
  matched: string[];
  threshold: number;
}

export function passesPrefilter(text: string, profile: IndustryProfile): PrefilterResult {
  const matched = keywordMatches(text, profile.keywords);
  const threshold = prefilterThreshold(profile);
  return { passed: matched.length >= threshold, matched, threshold };
}

// Pick the profile a lead best belongs to among the candidates (those whose
// sources include the lead's source). Returns the profile with the most keyword
// matches that also clears its own threshold, or null if none qualify. Ties
// resolve to the earlier profile in the list (profiles.ts ordering is priority).
export function bestProfileFor(
  text: string,
  candidates: IndustryProfile[]
): { profile: IndustryProfile; matched: string[] } | null {
  let best: { profile: IndustryProfile; matched: string[] } | null = null;
  for (const profile of candidates) {
    const { passed, matched } = passesPrefilter(text, profile);
    if (!passed) continue;
    if (!best || matched.length > best.matched.length) {
      best = { profile, matched };
    }
  }
  return best;
}
