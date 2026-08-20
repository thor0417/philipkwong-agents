// Junk domains: the single source of truth, shared by the lane that DROPS them
// (gli.ts, at write time and in the stored-row sweep) and the lane that avoids
// ASKING for them (sources/serper.ts, which excludes them at query time on the
// watch-term pass so Google's ten result slots go to real coverage instead).
//
// Extracted from gli.ts so the two uses cannot drift: a domain added here is
// both un-asked-for and un-stored. Edit this list to add or remove junk sources.

export const JUNK_DOMAINS = [
  'facebook.com',
  'youtube.com',
  'twitter.com',
  'x.com',
  'instagram.com',
  'tiktok.com',
  'reddit.com',
  'letterboxd.com',
  'pinterest.com',
  // linkedin.com is deliberately NOT here: broker and developer posts on it carry
  // real project signal (a stored SkyVue-site post is the case in point).
  // TV news and national wires
  'abcnews.go.com',
  'nbcnews.com',
  'cbsnews.com',
  'foxnews.com',
  'cnn.com',
  'msnbc.com',
  'usatoday.com',
  // Reference and consumer-travel sites: never a project signal
  'wikipedia.org',
  'britannica.com',
  'tripadvisor.com',
];

// ---- CAPTURED ON PURPOSE, NEVER CITED AS COVERAGE ---------------------------
//
// A SECOND LIST, AND IT IS NOT A SOFTER JUNK LIST. JUNK_DOMAINS answers "should
// this ever enter the corpus". This answers a different question: "may a client
// document present this as press coverage of the matter". A thing can be worth
// capturing and unfit to cite, and linkedin.com is exactly that - the comment
// above keeps it OUT of the junk list because broker and developer posts on it
// carry real project signal, and that reasoning is unchanged.
//
// WHAT IT COSTS TO GET THIS WRONG. The Heart Hotel referral brief opened its
// press section with "Hospitality Deal Intelligence's Post", undated, from
// linkedin.com, sitting above the Review-Journal and the Independent under a
// heading reading "Reported beyond our record". A recipient reads that as a
// publication reporting on the project. It is the developer's own side of the
// deal posting about itself.
//
// MEASURED before the rule was written, over the 72 press records on live
// projects across 48 hosts: linkedin.com carries 5, and ALL FIVE ARE UNDATED -
// every LinkedIn record in the corpus. That is the shape of the thing rather
// than a coincidence. An editorial publication stamps a date on a story; a
// social post as we capture it does not, so a brief prints "no date in the
// record" beside it and the reader cannot even place it in time.
//
// NOT A JUDGEMENT ABOUT QUALITY. flevy.com (2 records, both undated) is a
// document-template marketplace and hvs.com is a consultancy publishing its own
// research; neither is here. The test is narrow and mechanical: can the SUBJECT
// of the story publish on this host, about itself, with no editor in between.
// Extending it needs the same measurement, not an opinion about a domain.
export const SELF_PUBLISHED_HOSTS = ['linkedin.com'];

/**
 * True when the host is (or is a subdomain of) a platform whose posts are
 * written by their own subject. Capture keeps these; a client document must not
 * cite them as coverage, and must say how many it withheld and why.
 */
export function isSelfPublished(host: string): boolean {
  if (!host) return false;
  return SELF_PUBLISHED_HOSTS.some((d) => host === d || host.endsWith(`.${d}`));
}

// Bare hostname of a url (leading www. stripped, lowercased), or '' when the url
// is missing or unparseable. Protocol-less and protocol-relative links (e.g.
// "facebook.com/x" or "//facebook.com/x") are retried with an https:// prefix so
// no url form escapes the junk filter.
export function hostOf(url: string | null): string {
  if (!url) return '';
  const parse = (u: string): string | null => {
    try {
      return new URL(u).hostname;
    } catch {
      return null;
    }
  };
  const host = parse(url) ?? parse(`https://${url.replace(/^\/\//, '')}`);
  return host ? host.replace(/^www\./, '').toLowerCase() : '';
}

// True when the host is (or is a subdomain of) a hard-excluded junk domain.
export function isJunkDomain(host: string): boolean {
  if (!host) return false;
  return JUNK_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}
