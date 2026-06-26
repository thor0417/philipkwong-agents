// Google Places source — STUB ONLY.
//
// Not implemented: GOOGLE_PLACES_API_KEY is not yet available. Per spec, do not
// build the implementation until the key is confirmed. This adapter exists so
// the source registry is complete and wiring it later is a one-file change.
// It returns no leads and never throws.

import type { NormalizedLead } from './types';

export async function scrapeGooglePlaces(): Promise<NormalizedLead[]> {
  console.warn('Google Places: stub only (GOOGLE_PLACES_API_KEY unavailable). 0 leads.');
  return [];
}
