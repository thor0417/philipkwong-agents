// A CLIENT'S STATED INTERESTS BECOME STANDING CAPTURE INSTRUCTIONS.
//
// This is the difference between a scope that filters a report and a scope that
// changes what the system goes looking for. If Simtec says they care about ride
// and attraction procurement, and "simtec" only ever narrows a query over
// records we already hold, then their interest cannot surface anything we were
// not already collecting. The scope has to reach the capture layer or it is a
// view, not an instruction.
//
// WHERE THEY LAND. sources/serper.ts issues a watch-term pass exempt from the
// curated-domain allowlist: terms are quoted, OR-grouped, and searched with no
// site: restriction, so a client's term can return a result from a domain
// nobody curated. That pass previously drew its terms from ONE hardcoded place
// (targets.ts bypass lists). It now draws from that list PLUS whatever the
// clients have asked for.
//
// PRIMED, NOT FETCHED LAZILY. watchTerms() is synchronous and is called from
// inside query construction; making it async would push a promise through the
// whole query path for a list that changes once a month. So a run PRIMES the
// terms once at startup, and the sync accessor reads the primed value.
//
// A RUN THAT NEVER PRIMES BEHAVES EXACTLY AS BEFORE. The cache starts empty and
// the accessor returns the target terms alone, so a unit test, a probe, or an
// older entrypoint that has not been updated cannot be broken by this file - it
// simply does not benefit from it. Failing to prime is reported, never thrown:
// a Supabase hiccup must not stop a scrape that has 20 other sources to run.

import { supabaseAdmin } from '../../lib/supabase-admin';

// Terms loaded from client_scopes for this run. Module-level, deliberately: the
// scrape is a single process with a single lifetime.
let primed: string[] = [];
let primedAt: string | null = null;

export interface WatchTermPriming {
  scopes: number;
  terms: string[];
  // Null when the load succeeded. The message when it did not, so a run report
  // can say "client watch terms unavailable" instead of quietly searching less.
  error: string | null;
}

// A watch term is issued as an unrestricted web search, so a term that cannot
// return anything useful costs a search slot every run. One shape is refused:
//
//   TOO SHORT. Under four characters matches everything. "LV" returns the
//   internet.
//
// A BARE SURNAME IS NOT REFUSED, THOUGH IT SHOULD BE, and the reason is worth
// recording because the first version of this file did refuse it and was wrong.
// targets.ts warns that a bare surname returns a different person in every
// result, so this tried to detect one by shape: a single capitalised
// alphabetic token. That rule dropped "Simtec" - the first real client term
// anyone entered - along with "OCVibe" and "CFTOD", because a company name and
// a surname ARE the same shape. There is no regex that separates Simtec from
// Smith, and a filter that silently discards a paying client's stated interest
// is far worse than one that occasionally searches a common name.
//
// So the judgement stays with the operator, where it belongs, and the intake
// form says what a watch term does. What is dropped is dropped loudly: the
// priming report lists the terms it accepted, so a term that never appears in a
// query can be seen rather than guessed at.
const MIN_TERM_LENGTH = 4;

export function usableWatchTerm(raw: string): boolean {
  return raw.trim().length >= MIN_TERM_LENGTH;
}

/**
 * Load every client scope's watch terms and hold them for this run.
 *
 * Deduplicated case-insensitively against nothing else: the merge with the
 * target terms happens in serper.ts, which owns that list.
 */
export async function primeClientWatchTerms(): Promise<WatchTermPriming> {
  const { data, error } = await supabaseAdmin.from('client_scopes').select('watch_terms');
  if (error) {
    primed = [];
    return { scopes: 0, terms: [], error: error.message };
  }
  const rows = (data ?? []) as { watch_terms: string[] | null }[];
  const seen = new Map<string, string>();
  for (const r of rows) {
    for (const term of r.watch_terms ?? []) {
      const t = String(term ?? '').trim();
      if (!t || !usableWatchTerm(t)) continue;
      const k = t.toLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    }
  }
  primed = [...seen.values()];
  primedAt = new Date().toISOString();
  return { scopes: rows.length, terms: primed, error: null };
}

/** The primed terms. Empty until primeClientWatchTerms has run. */
export function clientWatchTerms(): string[] {
  return primed;
}

export function clientWatchTermsPrimedAt(): string | null {
  return primedAt;
}

// Test seam. Used by verify-client-watch-terms.ts so the merge can be
// demonstrated without a database.
export function __setClientWatchTerms(terms: string[]): void {
  primed = terms;
  primedAt = new Date().toISOString();
}
