/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Ensure the PP Neue York TTFs ship with the report API route's serverless
    // bundle so the branded PDF keeps its fonts in production.
    outputFileTracingIncludes: {
      '/api/gli-report': ['./public/fonts/*.ttf'],
    },
  },
};

module.exports = nextConfig;
