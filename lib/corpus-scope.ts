// WHICH COUNTRIES THIS SYSTEM IS FOR, DECLARED ONCE.
//
// The product is US-only right now. That is a SYSTEM setting and not a client
// one, and the difference matters: it was found while narrowing one client's
// scope to the United States, and narrowing a client is the wrong fix for a
// corpus that should not have held the rows in the first place. A client scope
// says who a project is for; this says whether we cover it at all.
//
// WHAT IT IS FOR. The intelligence lane searches the open web, so it captures
// whatever the search engine returns: 216 of 451 live press records resolved to
// somewhere outside the United States - Saudi Arabia 40, Australia 36, the UAE
// 33, and thirty more countries with one or two each. None of it is coverage.
// There is no adapter pointed at any of those places, so what we hold is a
// headline and no filing behind it, and a headline with no filing is the thing
// a client document must never be built from.
//
// THE CONSTRAINT IS THE PROJECT'S GEOGRAPHY, NOT THE PUBLISHER'S. A Las Vegas
// development written up by the Independent or by a Buenos Aires outlet is US
// coverage reported abroad and is kept. Two live records are exactly that.
//
// AN UNRESOLVED COUNTRY IS NOT A FOREIGN ONE. 104 press records resolve to no
// country at all, and they include "Fort Wayne" and "Brandywine Zoo". Dropping
// on unknown would discard real US coverage to enforce a rule about foreign
// coverage, so this fails OPEN on null and closed only on a resolved country
// outside the list. The cost of that choice is that unresolved foreign rows
// still get in; the cost of the other choice is losing US rows, which is worse.
//
// REOPENING IS ONE LINE. Add the country here and every reader follows: the
// lane stops refusing it, and the tombstoned rows are still in the database
// with their status, so what we already held can be read back rather than
// re-scraped.

export const CORPUS_COUNTRIES: readonly string[] = ['United States'];

/**
 * Whether a resolved country is one this system covers.
 *
 * Null is TRUE. See the note above: unknown is not foreign, and a rule that
 * treats it as foreign loses more than it removes.
 */
export function inCorpusScope(country: string | null | undefined): boolean {
  if (!country) return true;
  const c = country.trim().toLowerCase();
  return CORPUS_COUNTRIES.some((x) => x.toLowerCase() === c);
}

/** The sentence a report or a log line uses, so they cannot disagree. */
export function corpusScopeSentence(): string {
  return CORPUS_COUNTRIES.length === 1
    ? `This system covers ${CORPUS_COUNTRIES[0]} only.`
    : `This system covers ${CORPUS_COUNTRIES.join(', ')}.`;
}
