/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // THE REPORT LAYER SHARES THE SCRAPER'S TEXT CLEANING.
  //
  // agents/scraper/project-summary.ts owns the rules for turning a clerk's
  // agenda line into something printable: case-number prefixes, item numbers,
  // procedural lead-ins and block capitals. The report prints record text
  // directly and needs exactly those rules, and a second copy of them inside
  // this package would drift - with the divergence landing in client documents,
  // which is where it would be noticed last.
  //
  // The file is deliberately import-free so it can be compiled by either
  // package. This flag is what lets the Next build reach it across the
  // two-package split described in CLAUDE.md.
  experimental: {
    externalDir: true,
    // Ensure the PP Neue York TTFs ship with the report API route's serverless
    // bundle so the branded PDF keeps its fonts in production.
    outputFileTracingIncludes: {
      '/api/gli-report': ['./public/fonts/*.ttf'],
    },
  },
};

module.exports = nextConfig;
