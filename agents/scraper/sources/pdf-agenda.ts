// Part A: CFTOD PDF interiors. The govdoc lane stores the CFTOD PDFs as single
// records (a bookmark). This module READS them: it fetches each PDF, extracts text
// per page, splits agenda packets into individual agenda items, and gives the
// ~400-page 2045 comprehensive plan a bounded pass over its theme-park / land-use
// provisions. Each item or section that passes the government gate OR matches a
// target bypass term (Disney terms are the signal) becomes its own government lead
// with a real title, the meeting/adoption date, CFTOD jurisdiction, the source_type,
// a link to the packet PDF, and a page reference in raw_content. Player extraction
// then runs downstream in runGovernmentLane over the item text.
//
// On any single-document failure this logs and continues, never crashing the run.

import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import type { NormalizedLead } from './types';
import { CFTOD_PDF_SOURCES, type GovDoc } from './govdocs';
import { governmentGate } from '../../../lib/taxonomy';
import { strongBypassHits, strongBypassesGate } from '../targets';

const UA = 'philipkwong-agents/1.0 (+scraper)';
const FETCH_TIMEOUT_MS = 120000;
const BODY_EXCERPT_CHARS = 3500;
const MAX_ITEMS_PER_PACKET = 80;
const MAX_PLAN_SECTIONS = 8;

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim().toLowerCase();

// Fetch a PDF and return its per-page text. Returns null on any fetch/parse
// failure (logged), so one bad document never stops the lane. Pages are 0-indexed
// in the array; page references reported to users are 1-based.
export async function fetchPdfPages(url: string): Promise<string[] | null> {
  let buf: Buffer;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: '*/*' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`PDF interior: ${url} not reachable (HTTP ${res.status}) -> skipped.`);
      return null;
    }
    buf = Buffer.from(await res.arrayBuffer());
  } catch (error) {
    console.warn(`PDF interior: fetch failed for ${url} (${String(error).slice(0, 70)}).`);
    return null;
  }
  const pages: string[] = [];
  try {
    await pdfParse(buf, {
      pagerender: (pageData) =>
        pageData
          .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false })
          .then((tc) => {
            let lastY: number | undefined;
            let text = '';
            for (const item of tc.items) {
              if (lastY === item.transform[5] || lastY === undefined) text += item.str;
              else text += '\n' + item.str;
              lastY = item.transform[5];
            }
            pages.push(text);
            return text;
          }),
    });
  } catch (error) {
    console.warn(`PDF interior: parse failed for ${url} (${String(error).slice(0, 70)}).`);
    return null;
  }
  return pages;
}

interface OutlineItem {
  num: string; // '6.4', '7', ...
  title: string;
}

// Section headers that are structural, not action items. Sub-items (N.M) under
// them still get parsed; these top-level lines themselves are skipped.
const PROCEDURAL = new Set([
  'call to order',
  'opening invocation',
  'pledge of allegiance',
  'public comment period',
  'public comment',
  'reports',
  'consent agenda',
  'general business',
  'other business',
  'for information',
  'adjourn',
  'approval of agenda',
  'closing',
  'roll call',
]);

// Parse the agenda outline (the numbered listing near the front of the packet)
// into items. Item markers are `N.` or `N.M`; wrapped title lines (which do not
// start with a marker) are appended to the current item. Returns the parsed items
// and the 0-indexed page where the packet body (staff reports / backup) begins.
function parseOutline(pages: string[]): { items: OutlineItem[]; bodyStart: number } {
  // The outline runs from the front of the packet to the page containing ADJOURN
  // (bounded to the first 6 pages so a body mention of "adjourned" cannot extend it).
  let outlineEnd = 0;
  const scanTo = Math.min(pages.length, 6);
  for (let i = 0; i < scanTo; i++) {
    if (/\badjourn\b/i.test(pages[i])) {
      outlineEnd = i;
      break;
    }
  }
  if (outlineEnd === 0) outlineEnd = Math.min(pages.length - 1, 2);

  const items: OutlineItem[] = [];
  let cur: OutlineItem | null = null;
  const lines = pages.slice(0, outlineEnd + 1).join('\n').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+\.\d+|\d+\.)\s*(.*)$/);
    if (m) {
      if (cur) items.push(cur);
      cur = { num: m[1].replace(/\.$/, ''), title: (m[2] ?? '').trim() };
    } else if (cur) {
      cur.title = `${cur.title} ${line}`.trim();
    }
  }
  if (cur) items.push(cur);

  // Keep sub-items and any top-level item with a real (non-procedural) title.
  const kept = items.filter((it) => {
    const t = norm(it.title);
    if (!t || t.length < 6) return false;
    if (PROCEDURAL.has(t)) return false;
    return true;
  });
  return { items: kept, bodyStart: Math.min(outlineEnd + 1, pages.length - 1) };
}

// Locate an item's backup text in the packet body: find the first body page whose
// normalized text contains a distinctive phrase from the item title. Returns the
// 1-based page reference and a bounded body excerpt (that page plus the next).
// Reduce text to its distinctive alphanumeric tokens (drop punctuation like
// "#1"/"#C006831" and short stopword-ish tokens) so a title phrase matches body
// prose that words the same action slightly differently. Applied to BOTH sides so
// the comparison is symmetric.
function distinctiveTokens(s: string): string[] {
  return norm(s)
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(' ')
    .filter((w) => w.length >= 4);
}
const distinctiveText = (s: string): string => distinctiveTokens(s).join(' ');

// Locate an item's backup text: find the first body page whose distinctive text
// contains a contiguous window of the item title's distinctive tokens. Windows
// slide across the WHOLE title (not just the leading words), because the staff
// report rarely repeats the agenda verb ("Approve...") that opens the title.
// Longer windows are tried first so the match is precise.
function locateBody(
  pages: string[],
  bodyStart: number,
  title: string
): { pageRef: number | null; body: string } {
  const tokens = distinctiveTokens(title);
  if (tokens.length < 4) return { pageRef: null, body: '' };
  const pageTexts = pages.map((p, i) => (i >= bodyStart ? distinctiveText(p) : ''));
  for (const size of [6, 5, 4]) {
    for (let s = 0; s + size <= tokens.length; s++) {
      const win = tokens.slice(s, s + size).join(' ');
      if (win.length < 14) continue;
      for (let i = bodyStart; i < pages.length; i++) {
        if (pageTexts[i].includes(win)) {
          const body = `${pages[i]} ${pages[i + 1] ?? ''}`.replace(/\s+/g, ' ').trim().slice(0, BODY_EXCERPT_CHARS);
          return { pageRef: i + 1, body };
        }
      }
    }
  }
  return { pageRef: null, body: '' };
}

// Informational hit line for CFTOD records: strong Disney/target terms only (the
// letterhead geographic terms are excluded, so the line reflects real signal).
function targetHitLine(text: string): string {
  const hits = strongBypassHits(text);
  if (hits.length === 0) return '';
  const uniq = [...new Set(hits.map((h) => h.term))];
  return `Target-term hits: ${uniq.join(', ')}`;
}

// Split one agenda-packet PDF into individual agenda-item leads.
function itemsFromPacket(doc: GovDoc, pages: string[]): NormalizedLead[] {
  const { items, bodyStart } = parseOutline(pages);
  const leads: NormalizedLead[] = [];
  for (const it of items.slice(0, MAX_ITEMS_PER_PACKET)) {
    const { pageRef, body } = locateBody(pages, bodyStart, it.title);
    const gateText = `${it.title}\n${body}`;
    const verdict = governmentGate(gateText);
    // Bypass on STRONG target terms only: inside CFTOD's own packets the geographic
    // Disney terms (Lake Buena Vista, Bay Lake, Reedy Creek) are letterhead, so they
    // do not rescue an off-topic item (e.g. annual financial statements).
    const bypass = strongBypassesGate(gateText);
    if (!verdict.matched && !bypass) continue;

    const title = it.title.replace(/\s+/g, ' ').trim().slice(0, 200);
    const pageLabel = pageRef ? `p.${pageRef}` : 'agenda listing';
    const hitLine = targetHitLine(gateText);
    const raw = [
      `CFTOD agenda item ${it.num} - ${doc.title}`,
      `Jurisdiction: ${doc.jurisdictionLabel}`,
      `Source type: ${doc.sourceType}`,
      `Meeting date: ${doc.docDate ?? '(unknown)'}`,
      `Item title: ${it.title.replace(/\s+/g, ' ').trim()}`,
      `Page reference: ${pageLabel} of the agenda packet (${doc.url})`,
      `Gate: ${bypass ? 'bypass (' + hitLine.replace('Target-term hits: ', '') + ')' : verdict.reason}`,
      hitLine,
      body ? `\n--- item text (excerpt) ---\n${body}` : '\n(item backup not separately located; captured from the agenda listing)',
    ]
      .filter(Boolean)
      .join('\n');

    leads.push({
      title,
      // Unique per item; the fragment keeps the underlying packet URL (which was
      // fetch-verified) as the resolvable resource and jumps to the page.
      url: `${doc.url}#item-${it.num}${pageRef ? `-p${pageRef}` : ''}`,
      raw_content: raw,
      company: doc.jurisdictionLabel,
      location: doc.jurisdictionLabel,
      deadline: null,
      published_date: doc.docDate ?? null,
      value_estimate: null,
      source: 'cftod-pdf',
      source_type: doc.sourceType,
      primary_document_url: doc.url,
      has_primary_document: true,
    });
  }
  return leads;
}

// Bounded pass over the 2045 comprehensive plan: surface its theme-park /
// entertainment / tourist land-use provisions as named records (mission item 3),
// one lead per matching page, capped. Each is a Disney/CFTOD bypass by nature.
const PLAN_PROVISION_TERMS = ['theme park', 'entertainment', 'tourist', 'recreation'];
const PLAN_LANDUSE_CONTEXT = ['land use', 'future land use', 'zoning', 'acre', 'district', 'development'];

function sectionsFromPlan(doc: GovDoc, pages: string[]): NormalizedLead[] {
  const leads: NormalizedLead[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < pages.length && leads.length < MAX_PLAN_SECTIONS; i++) {
    const low = pages[i].toLowerCase();
    const provisionHits = PLAN_PROVISION_TERMS.filter((t) => low.includes(t));
    const contextHits = PLAN_LANDUSE_CONTEXT.filter((t) => low.includes(t));
    // Require a theme-park/entertainment provision term AND land-use context, so we
    // capture substantive provisions, not passing mentions.
    if (!provisionHits.includes('theme park') && !(provisionHits.length >= 2 && contextHits.length >= 1)) continue;
    if (contextHits.length < 1) continue;

    const body = pages[i].replace(/\s+/g, ' ').trim().slice(0, BODY_EXCERPT_CHARS);
    const key = provisionHits.sort().join('|');
    if (seen.has(key) && !low.includes('theme park')) continue;
    seen.add(key);

    const focus = provisionHits.includes('theme park') ? 'theme park provisions' : `${provisionHits.join(' / ')} provisions`;
    const hitLine = targetHitLine(body);
    leads.push({
      title: `CFTOD 2045 Comprehensive Plan - ${focus} (p.${i + 1})`.slice(0, 200),
      url: `${doc.url}#plan-p${i + 1}`,
      raw_content: [
        `CFTOD 2045 Comprehensive Plan - bounded interior pass`,
        `Jurisdiction: ${doc.jurisdictionLabel}`,
        `Source type: ${doc.sourceType}`,
        `Adoption date: ${doc.docDate ?? '(unknown)'}`,
        `Page reference: p.${i + 1} of the plan (${doc.url})`,
        `Provision terms on page: ${provisionHits.join(', ')}`,
        hitLine,
        `\n--- page text (excerpt) ---\n${body}`,
      ]
        .filter(Boolean)
        .join('\n'),
      company: doc.jurisdictionLabel,
      location: doc.jurisdictionLabel,
      deadline: null,
      published_date: doc.docDate ?? null,
      value_estimate: null,
      source: 'cftod-pdf',
      source_type: doc.sourceType,
      primary_document_url: doc.url,
      has_primary_document: true,
    });
  }
  return leads;
}

async function extractOne(doc: GovDoc): Promise<NormalizedLead[]> {
  const pages = await fetchPdfPages(doc.url);
  if (!pages) return [];
  const isPlan = doc.sourceType === 'Comprehensive Plan';
  const leads = isPlan ? sectionsFromPlan(doc, pages) : itemsFromPacket(doc, pages);
  console.log(
    `CFTOD PDF interior "${doc.title.slice(0, 48)}": ${pages.length} pages -> ${leads.length} ${isPlan ? 'sections' : 'items'} kept.`
  );
  return leads;
}

// Read every configured CFTOD PDF and return the extracted item/section leads.
export async function scrapeCftodPdfItems(): Promise<NormalizedLead[]> {
  const settled = await Promise.allSettled(CFTOD_PDF_SOURCES.map(extractOne));
  const leads: NormalizedLead[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') leads.push(...r.value);
    else console.error('CFTOD PDF interior extraction rejected:', r.reason);
  }
  const bypassCount = leads.filter((l) => strongBypassesGate(`${l.title}\n${l.raw_content}`)).length;
  console.log(
    `CFTOD PDF interiors: ${leads.length} item/section leads extracted from ${CFTOD_PDF_SOURCES.length} PDFs (${bypassCount} with a target-term/Disney bypass hit).`
  );
  return leads;
}
