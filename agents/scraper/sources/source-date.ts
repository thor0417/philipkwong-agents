// A SOURCE'S DATE IS THE SOURCE'S DATE. NOT THIS MACHINE'S.
//
// THE DEFECT THIS EXISTS FOR. Golden case
// `a-meeting-date-that-is-the-machines-midnight`. Anaheim publishes the agenda
// for Monday 15 December 2025; the corpus read 2025-12-14. Measured 2026-09-11
// over every dated row: 1,204 of 1,808 stored `published_date` values sat at
// 17:00:00Z, which is midnight at UTC+7, which is the machine that captured
// them. 821 of those are undismissed, across twelve markets, and 1,021
// `project_events.occurred_at` values inherited it.
//
// THE CAUSE IS ONE LINE OF JAVASCRIPT SEMANTICS. `new Date(s)` parses a string
// carrying no timezone in the RUNTIME'S LOCAL ZONE:
//
//     new Date('December 15, 2025')        UTC+7 -> 2025-12-14T17:00:00Z
//     new Date('2026-07-13T00:00:00')      UTC+7 -> 2026-07-12T17:00:00Z
//     new Date('2026-07-13')                     -> 2026-07-13T00:00:00Z
//
// The third is safe: an ISO DATE-ONLY string is parsed as UTC by specification.
// The first two are not, and a corpus captured from Bangkok reads a day earlier
// than the same corpus captured on the hosted runner. So the same code produced
// different data depending on who ran it. Same class as a dead-feed verdict
// recorded from a developer's connection, which this repository already refuses:
// a stored fact that is partly a fact about the machine.
//
// WHAT THIS DOES, AND WHY IT IS THE ONLY HONEST OPTION.
//
//   A zone in the string is the publisher's own answer. Trusted, untouched.
//   A zoneless value carries CALENDAR FIELDS and nothing else, so the calendar
//   fields are what is preserved: the value is read as UTC.
//
// It is worth being exact about what is NOT being claimed. A PrimeGov agenda
// that says `2026-07-13T09:00:00` means nine in the morning in PACIFIC time, and
// the true instant is 16:00Z or 17:00Z depending on the season. This module does
// not pretend to know that: it stores 09:00Z, which is the wrong instant and the
// right DAY. The day is the fact the source published and the fact every
// consumer here uses - bestDate, the liveness floor, a period bound, the date
// printed beside a project in a client document. Inventing a jurisdiction's
// offset to get the instant right would be a fabrication in service of a
// precision nobody reads. Where a source states its zone, we keep it.

// An explicit zone: a trailing Z or +hh:mm / -hhmm offset, or a named GMT/UTC.
//
// THE OFFSET MUST FOLLOW A CLOCK, and that is not fussiness. Written as a bare
// `[+-]\d{2}:?\d{2}$` it matches the tail of "15-Jul-2026" - hyphen, "20", "26" -
// so every World Bank date read as already-zoned and was returned a day early by
// the very function written to correct it. The golden case caught it on the
// second run of this file. A zone is only a zone where a time precedes it.
const HAS_ZONE = /\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\s*(?:Z|[+-]\d{2}:?\d{2})\s*$|\b(?:GMT|UTC)\b/i;

// An ISO date with no time part. Parsed as UTC by specification, so it needs no
// correction; it is matched here only so the offset arithmetic below never runs
// on a value that is already right.
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalise a date a SOURCE published into an ISO instant, without letting the
 * runtime's timezone decide which day it was.
 *
 * Returns null for an absent or unparseable value, exactly as the callers this
 * replaces did: a date we cannot read is never a guess.
 */
export function sourceIso(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // A number is an epoch and carries no zone ambiguity at all.
  if (typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const s = value.trim();
  if (!s) return null;

  if (ISO_DATE_ONLY.test(s)) return `${s}T00:00:00.000Z`;

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  // The publisher said where it is. Believe it.
  if (HAS_ZONE.test(s)) return d.toISOString();

  // It did not. The parse has already applied this machine's offset, so undo
  // exactly that and no more. getTimezoneOffset is evaluated ON THE PARSED DATE,
  // so a value inside a DST window is corrected by the offset that applied then
  // rather than by the offset that applies today.
  //
  // THE SIGN IS THE EASY THING TO GET BACKWARDS, so it is spelled out.
  // getTimezoneOffset returns UTC MINUS LOCAL in minutes: -420 at UTC+7. Parsing
  // "December 15, 2025" there gives 2025-12-14T17:00:00Z, and the value we want
  // is 2025-12-15T00:00:00Z, which is seven hours LATER. So the correction
  // SUBTRACTS a negative offset. Written the other way round it lands on
  // 2025-12-14T10:00:00Z, still the wrong day, and the golden case caught
  // exactly that on the first run of this file.
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString();
}

/**
 * The DAY a source published, as YYYY-MM-DD, or null.
 *
 * For the callers that only ever wanted the day - a signal date, a comparison
 * against a cutoff day - so they stop slicing an instant they had to reason
 * about first.
 */
export function sourceDay(value: string | number | null | undefined): string | null {
  const iso = sourceIso(value);
  return iso ? iso.slice(0, 10) : null;
}
