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
