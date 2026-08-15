// THE REGISTER IS CALLED PROJECTS.
//
// "Register" named the table rather than the thing in it. Every question asked
// of this screen is about a project - which ones matter, which are in a client's
// scope, which moved - and a name that describes the container instead of the
// contents is one more thing to learn before the tool can be used.
//
// The route stays as a redirect rather than being deleted, because /register is
// in the operator's history, in shared links, and in every filtered URL this
// screen has ever produced. A 404 on an address that worked yesterday is worse
// than one file that forwards.
//
// EVERY PARAMETER SURVIVES. A filtered register is a link you can send, which is
// only true if the link keeps meaning what it meant. The whole query string is
// carried across unchanged: the parameter names did not move, only the path did.

import { redirect } from 'next/navigation';

export default function RegisterRedirect({
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
  redirect(query ? `/projects?${query}` : '/projects');
}
