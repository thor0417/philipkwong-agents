// Fuel broker-noise exclusion.
//
// The public fuel-tender space is flooded with broker/scam boilerplate (ICPO,
// LOI, SBLC, "ready willing and able", Bonny Light procedures, etc.). These are
// never real procurement. This filter runs on fuel-tagged leads only, before
// the prefilter and before any Haiku call: a match is a hard exclude, the lead's
// score is set to 0 and it is flagged broker_noise so it never reaches scoring.

import { keywordMatches } from './prefilter';

// Canonical broker-noise term set. Mirrors the fuel profile excludeKeywords and
// adds "Bonny Light procedure" (per spec section 8).
export const BROKER_NOISE_TERMS = [
  'ICPO',
  'LOI',
  'BCL',
  'SBLC',
  'FCO',
  'soft corporate offer',
  'ready willing and able',
  'mandate',
  'tank-to-tank',
  'TTT',
  'TTO',
  'dip and pay',
  'Rotterdam allocation',
  'performance bond',
  'Bonny Light procedure',
];

export interface BrokerCheck {
  isNoise: boolean;
  matched: string[];
}

// True when the text contains any broker-noise term. Uses the same
// word-boundary matcher as the prefilter so acronyms (LOI, TTT) don't
// false-positive inside other words.
export function isBrokerNoise(text: string): BrokerCheck {
  const matched = keywordMatches(text, BROKER_NOISE_TERMS);
  return { isNoise: matched.length > 0, matched };
}
