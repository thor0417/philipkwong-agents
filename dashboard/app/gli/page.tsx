// /gli is gone. The pipeline is Hospitality and Entertainment, and the screen
// is the Register.
//
// This redirect stays permanently rather than being deleted with the route:
// /gli is in the operator's history and bookmarks, and a 404 on a URL that
// worked yesterday is a worse outcome than one file that does nothing but
// forward. Query strings are preserved so an old filtered link still lands on
// the same view.
//
// It points at /records, not /register. /gli WAS the record table, and that
// screen is now called Records; the Register is the project surface, which is
// a different thing. Sending an old link to the screen that merely inherited
// its name would land the operator somewhere that does not hold their data.

import { redirect } from 'next/navigation';

export default function GliRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) value.forEach((v) => qs.append(key, v));
    else if (value !== undefined) qs.set(key, value);
  }
  const query = qs.toString();
  redirect(query ? `/records?${query}` : '/records');
}
