// IS THE STATED APPLICANT A PUBLIC BODY? READ FROM THE TYPE THE SOURCE STATES.
//
// IMPORT-FREE, and read across the package split by both packages, for the same
// reason lib/dead-feeds and lib/junk-domains are. The CAPTURE end decides
// whether a public agency becomes a project's primary_applicant and the PRINT
// end decides whether it reaches a client document. Those two must never hold
// separate copies of this answer, because the half that drifts is the half that
// prints a city's own planning department as the developer.
//
// ---- THE DEFECT, AND WHY THE OBVIOUS FIX IS THE WRONG ONE ------------------
//
// The gate was `PUBLIC_AGENCY_APPLICANT_TYPES = new Set(['other public agency'])`
// and NYC's Department of City Planning walked through it.
//
// MEASURED 2026-09-05 over 2,455 rows paged to exhaustion. `applicant_type` is
// set on 43 undismissed rows, all of them from nyc-zap, and it takes exactly
// THREE values in the whole corpus:
//
//     Private               34    Griffon Q LLC
//     Other Public Agency    7    PANYNJ - Port Authority of New York & New Jersey
//     DCP                    2    DCP - Department of City Planning (NYC)
//
// TWO OF THOSE ARE CLASSES AND THE THIRD IS AN AGENCY'S OWN CODE. DCP is the
// department that RUNS the ULURP process, so ZAP gives it a code of its own,
// and "Other Public Agency" means, literally, a public agency OTHER THAN DCP.
// The gate was written against the two class values, so the one value that is
// an agency IDENTITY rather than a CLASS is not a missing entry in the list -
// it is a different kind of value, and a list of classes was never going to
// contain it.
//
// Which is why adding 'dcp' to the set would be the wrong fix even though it
// would work today. It would read as a name, it would be defeated by the next
// agency ZAP gives a code to, and this repository already carries golden cases
// for a label read as the thing it names.
//
// SO THE TEST IS INVERTED. `Private` is the only stated value that means "not a
// public body". Every other STATED value is one. That reads no names, uses the
// source's own vocabulary, and a fourth agency code cannot defeat it.
//
// ---- WHAT ABSENCE MEANS, WHICH IS NOT WHAT IT LOOKS LIKE -------------------
//
// NULL IS UNGATED, DELIBERATELY, and that is carried over unchanged from the
// rule this replaces. Null means the source did not say, never that the
// applicant is public. Only ZAP publishes a type at all; gating on absence
// would silence every applicant in every market outside New York.

/** The one stated value that means the applicant is not a public body. */
const PRIVATE_APPLICANT_TYPE = 'private';

/**
 * Does a stated applicant type say this applicant is a government body?
 *
 * Returns false for an absent or empty type: that is an unstated type, and an
 * unstated type is not a claim about anything.
 */
export function applicantTypeIsPublicAgency(applicantType: string | null | undefined): boolean {
  const t = (applicantType ?? '').trim().toLowerCase();
  if (t === '') return false;
  return t !== PRIVATE_APPLICANT_TYPE;
}

/**
 * The applicant a document or a project column may take from this record, or
 * null where the source states it is a public agency.
 *
 * NOTHING IS DELETED by this. The value stays on the record and on the
 * register's own columns; what is gated is what may be PRINTED as a party and
 * what may be promoted to a project's primary_applicant. Standing rule 3
 * applies to the print: a document that withholds a party says so, which is
 * what dashboard/lib/people.ts withheldMovers is for.
 */
export function nameableApplicantOf(r: {
  applicant?: string | null;
  applicant_type?: string | null;
}): string | null {
  return applicantTypeIsPublicAgency(r.applicant_type) ? null : (r.applicant ?? null);
}
