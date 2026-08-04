// /projects became the Register.
//
// The Register IS the project surface: the brief's columns (project, applicant,
// market, stage, last activity) and its detail pane (record count, people,
// timeline of every record) are all project properties. Keeping a second,
// near-identical project screen alive would mean two places that disagree.
//
// The route stays as a redirect because it is in the operator's history, and
// because the command palette shipped links to /projects?open=<id>. That
// parameter is translated to the Register's ?selected=<id> rather than dropped,
// so an old link still opens the project it named.

import { redirect } from 'next/navigation';

export default function ProjectsRedirect({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    const name = key === 'open' ? 'selected' : key;
    if (Array.isArray(value)) value.forEach((v) => qs.append(name, v));
    else if (value !== undefined) qs.set(name, value);
  }
  const query = qs.toString();
  redirect(query ? `/register?${query}` : '/register');
}
