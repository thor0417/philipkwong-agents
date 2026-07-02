// Bahamas Heads of Agreement (HOA) signals source — clean WordPress REST API.
//
// The Office of the Prime Minister (opm.gov.bs) runs WordPress with an open REST
// API. A signed Heads of Agreement is the Bahamian incentive-approval signal: a
// named developer with a committed resort/tourism project, pre-tender. We query
// posts for "heads of agreement" and keep those whose TITLE is an actual HOA
// signing (the body-only mentions are addresses/remarks, not signings). The
// signals-lane sector gate then keeps the tourism ones. Developer is parsed from
// the title where possible. signal_type 'incentive_approval', country BS.
// On any failure it logs and returns [] without throwing.

import type { NormalizedLead } from './types';

const API = 'https://opm.gov.bs/wp-json/wp/v2/posts';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';
const PER_PAGE = Number(process.env.BAHAMAS_PER_PAGE ?? '30');

interface WpPost {
  title?: { rendered?: string };
  excerpt?: { rendered?: string };
  content?: { rendered?: string };
  link?: string;
  date?: string; // ISO local
  date_gmt?: string;
}

const HOA_RE = /heads?\s+of\s+agreement/i;

function decode(s: string): string {
  return s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#0?39;|&#x27;|&#8217;|&rsquo;/gi, "'")
    .replace(/&#8211;|&ndash;/gi, '-')
    .replace(/&quot;|&#8220;|&#8221;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

// Best-effort developer/project from an HOA title:
// "...Heads of Agreement Signing for Beaches Exuma Resort" -> "Beaches Exuma Resort"
// "...Heads of Agreement with the Concord Wilshire Group" -> "Concord Wilshire Group"
function proponentFrom(title: string): string | null {
  const m = /heads?\s+of\s+agreement[^.]*?\b(?:for|with)\s+(?:the\s+)?([A-Z][A-Za-z0-9&'.-]*(?:\s+[A-Z][A-Za-z0-9&'.-]*){0,5})/i.exec(
    title
  );
  return m ? m[1].trim() : null;
}

export async function scrapeBahamasHoa(): Promise<NormalizedLead[]> {
  const url = `${API}?search=${encodeURIComponent('heads of agreement')}&per_page=${PER_PAGE}`;
  let posts: WpPost[];
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (!res.ok) {
      console.warn(`Bahamas HOA: HTTP ${res.status}.`);
      return [];
    }
    const data = await res.json();
    posts = Array.isArray(data) ? (data as WpPost[]) : [];
  } catch (error) {
    console.warn(`Bahamas HOA: fetch failed (${String(error).slice(0, 80)}).`);
    return [];
  }

  const byUrl = new Map<string, NormalizedLead>();
  for (const p of posts) {
    const title = decode(p.title?.rendered ?? '');
    const link = p.link ?? '';
    if (!title || !link) continue;
    // Keep only actual HOA signings (title match), not body-only mentions.
    if (!HOA_RE.test(title)) continue;
    if (byUrl.has(link)) continue;

    const excerpt = decode(p.excerpt?.rendered ?? '').slice(0, 600);
    const date = (p.date ?? p.date_gmt ?? '').slice(0, 10) || null;
    byUrl.set(link, {
      title,
      url: link,
      raw_content: [`Bahamas Heads of Agreement announcement.`, `Title: ${title}`, excerpt].filter(Boolean).join('\n'),
      company: proponentFrom(title),
      location: 'Bahamas',
      deadline: null,
      value_estimate: null,
      source: 'bahamas_hoa',
      country: 'BS',
      signal_type: 'incentive_approval',
      regulator: 'Government of the Bahamas',
      project_description: excerpt,
      signal_date: date,
    });
  }

  const leads = [...byUrl.values()];
  console.log(`Bahamas HOA: ${leads.length} Heads-of-Agreement signals`);
  return leads;
}
