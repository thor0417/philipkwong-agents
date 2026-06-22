// RSS feed fetching and parsing for the Upwork scraper.

import Parser from 'rss-parser';

export const UPWORK_FEEDS = [
  // Compliance and regulatory
  'https://www.upwork.com/ab/feed/jobs/rss?q=compliance+consultant&sort=recency',
  'https://www.upwork.com/ab/feed/jobs/rss?q=regulatory+affairs&sort=recency',
  'https://www.upwork.com/ab/feed/jobs/rss?q=QMS+quality+management&sort=recency',
  'https://www.upwork.com/ab/feed/jobs/rss?q=ISO+certification&sort=recency',
  'https://www.upwork.com/ab/feed/jobs/rss?q=cannabis+compliance&sort=recency',
  // Strategy
  'https://www.upwork.com/ab/feed/jobs/rss?q=market+entry+strategy+Canada&sort=recency',
  'https://www.upwork.com/ab/feed/jobs/rss?q=corporate+strategy+consultant&sort=recency',
  // AI and operations
  'https://www.upwork.com/ab/feed/jobs/rss?q=AI+automation+consultant&sort=recency',
  'https://www.upwork.com/ab/feed/jobs/rss?q=business+process+automation&sort=recency',
  // Web
  'https://www.upwork.com/ab/feed/jobs/rss?q=professional+services+website&sort=recency',
];

const parser = new Parser();

export interface RawLead {
  title: string;
  url: string;
  content: string;
  source: string;
}

export async function scrapeUpwork(feeds: string[]): Promise<RawLead[]> {
  const leads: RawLead[] = [];

  for (const feed of feeds) {
    try {
      const result = await parser.parseURL(feed);
      for (const item of result.items) {
        if (item.link && item.title) {
          leads.push({
            title: item.title,
            url: item.link,
            content: item.contentSnippet || item.content || '',
            source: 'upwork',
          });
        }
      }
    } catch (error) {
      console.error(`Feed failed: ${feed}`, error);
      continue;
    }
  }

  return leads;
}
