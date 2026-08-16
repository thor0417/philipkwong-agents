// ARTICLE BODY CAPTURE. The press lane stores a headline and a search snippet
// and nothing else, so every figure an operator looks for first is missing.
//
// MEASURED BEFORE BUILT (2026-08-16): all 239 stored press records carry a
// raw_content between 116 and 274 characters, median 182, which is a Google
// result snippet ending in an ellipsis. 29% carry any figure at all, and those
// are almost entirely dollar amounts and acreages that happened to fall inside
// the first 180 characters. Heart Hotel holds 15 press records and not one names
// its 752 rooms or its 29 storeys. Metropolitan Park's own headline says "unveils
// 3 hotel towers" and the snippet beneath it carries no figure.
//
// WHAT THIS MODULE DOES AND DOES NOT DO. It fetches a page we already hold a URL
// for, reduces it to readable text, and hands that text back. It does not decide
// what the text means: extraction lives in press-facts.ts, and every figure it
// finds carries the sentence it came from so a reader can check it.
//
// EVERY FAILURE IS NAMED, NOT SWALLOWED. A blocked host, a paywall and an empty
// page are three different facts about our coverage, and a run that reports
// "fetched 0" without saying which is a run that teaches us nothing. The failure
// taxonomy below is the deliverable as much as the text is.

import { htmlToText } from './http';

// Long enough to be an article, short enough that a 40MB page cannot stall a run.
const TIMEOUT_MS = Number(process.env.ARTICLE_TIMEOUT_MS ?? '20000');
const MAX_BYTES = 4_000_000;
// Below this, whatever came back is a stub, an interstitial or a consent wall
// rather than an article. Measured against the corpus: real articles clear it
// comfortably and every page under it was boilerplate.
const MIN_ARTICLE_CHARS = 600;

// A REAL BROWSER STRING, and it is worth saying why rather than leaving it to
// look like evasion. These are public news pages we already link to in client
// documents, fetched one at a time at reading pace. Many publishers' edge rules
// reject an unknown agent outright, so a scraper-shaped string does not get a
// polite refusal, it gets a 403 that we would then have to report as "blocked"
// when the page is in fact open to any reader. We identify the project in the
// URL below so an operator reading their logs can see exactly who called.
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/126.0.0.0 Safari/537.36 (+https://github.com/thor0417/philipkwong-agents)';

export type ArticleFailure =
  | 'blocked'        // 401/403/451: the host refused us specifically
  | 'not-found'      // 404/410: the article is gone
  | 'server-error'   // 5xx: the host is broken today, worth retrying later
  | 'rate-limited'   // 429
  | 'timeout'
  | 'network'        // DNS, TLS, connection reset
  | 'not-html'       // a PDF, a video page, an image
  | 'paywalled'      // the page loaded and told us it is gated
  | 'too-short'      // loaded, parsed, and carries no article
  | 'redirect-loop';

export interface ArticleBody {
  ok: true;
  text: string;
  chars: number;
  finalUrl: string;
  /** Where the text came from, so a thin result can be explained. */
  extractedFrom: 'json-ld' | 'article' | 'main' | 'body';
}
export interface ArticleFailed {
  ok: false;
  failure: ArticleFailure;
  detail: string;
}
export type ArticleResult = ArticleBody | ArticleFailed;

// ---- paywall detection ------------------------------------------------------
// A page that loads and then tells us it is gated. These are the phrases the
// publishers in this corpus actually print; a page whose text is dominated by
// them carries no article regardless of its length.
const PAYWALL_MARKERS = [
  'subscribe to continue',
  'subscribers only',
  'to continue reading',
  'create a free account to',
  'this content is for subscribers',
  'already a subscriber',
  'sign in to read',
  'you have reached your article limit',
  'become a member to read',
  'unlock this article',
];

export function looksPaywalled(text: string): boolean {
  const head = text.slice(0, 3000).toLowerCase();
  return PAYWALL_MARKERS.some((m) => head.includes(m));
}

// ---- extraction -------------------------------------------------------------
// Chrome and furniture. Removed before the text is taken so a site's navigation,
// its cookie banner and its "more stories" rail do not become article prose and
// then get mined for figures that belong to a different project entirely. That
// last failure is the dangerous one: a "$2 billion" in a sidebar teaser is a real
// number about the wrong thing.
const FURNITURE =
  /<(nav|header|footer|aside|form|figure|figcaption|iframe|noscript|svg|template)\b[\s\S]*?<\/\1>/gi;

function firstMatch(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m ? m[1] : null;
}

// Many publishers ship the full article as JSON-LD for search engines. When it is
// there it is the cleanest possible source: it is the body the publisher itself
// considers the article, with no furniture at all.
export function articleBodyFromJsonLd(html: string): string | null {
  const blocks = html.match(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  for (const block of blocks) {
    const raw = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue; // A malformed block is common and is not worth a failure.
    }
    // The shape varies: a bare object, an array, or a @graph wrapper.
    const stack: unknown[] = [parsed];
    while (stack.length) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        stack.push(...node);
        continue;
      }
      if (!node || typeof node !== 'object') continue;
      const obj = node as Record<string, unknown>;
      if (typeof obj.articleBody === 'string' && obj.articleBody.length > MIN_ARTICLE_CHARS) {
        return obj.articleBody;
      }
      if (Array.isArray(obj['@graph'])) stack.push(...(obj['@graph'] as unknown[]));
    }
  }
  return null;
}

export function extractArticle(html: string): { text: string; from: ArticleBody['extractedFrom'] } {
  const fromLd = articleBodyFromJsonLd(html);
  if (fromLd) return { text: fromLd.replace(/\s+/g, ' ').trim(), from: 'json-ld' };

  const cleaned = html.replace(FURNITURE, ' ');
  const article = firstMatch(cleaned, /<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (article && htmlToText(article).length > MIN_ARTICLE_CHARS) {
    return { text: htmlToText(article), from: 'article' };
  }
  const main = firstMatch(cleaned, /<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (main && htmlToText(main).length > MIN_ARTICLE_CHARS) {
    return { text: htmlToText(main), from: 'main' };
  }
  const body = firstMatch(cleaned, /<body\b[^>]*>([\s\S]*?)<\/body>/i) ?? cleaned;
  return { text: htmlToText(body), from: 'body' };
}

// ---- the fetch --------------------------------------------------------------
export async function fetchArticleBody(url: string): Promise<ArticleResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const msg = String(e);
    if (/timeout|abort/i.test(msg)) return { ok: false, failure: 'timeout', detail: `${TIMEOUT_MS}ms` };
    if (/redirect/i.test(msg)) return { ok: false, failure: 'redirect-loop', detail: msg.slice(0, 80) };
    return { ok: false, failure: 'network', detail: msg.slice(0, 100) };
  }

  if (!res.ok) {
    const s = res.status;
    const failure: ArticleFailure =
      s === 401 || s === 403 || s === 451 ? 'blocked'
        : s === 404 || s === 410 ? 'not-found'
          : s === 429 ? 'rate-limited'
            : s >= 500 ? 'server-error'
              : 'network';
    return { ok: false, failure, detail: `HTTP ${s}` };
  }

  const type = res.headers.get('content-type') ?? '';
  if (!/html|xml|text\/plain/i.test(type)) {
    return { ok: false, failure: 'not-html', detail: type.split(';')[0] || 'unknown' };
  }

  let html: string;
  try {
    const buf = await res.arrayBuffer();
    html = Buffer.from(buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf).toString('utf8');
  } catch (e) {
    return { ok: false, failure: 'network', detail: String(e).slice(0, 100) };
  }

  const { text, from } = extractArticle(html);
  if (looksPaywalled(text)) {
    return { ok: false, failure: 'paywalled', detail: `${text.length} chars behind a gate` };
  }
  if (text.length < MIN_ARTICLE_CHARS) {
    return { ok: false, failure: 'too-short', detail: `${text.length} chars` };
  }
  return { ok: true, text, chars: text.length, finalUrl: res.url || url, extractedFrom: from };
}
