import type { NextConfig } from 'next';

// Pages are server-rendered HTML with no client code, so the browser runs no
// script at all. Injected markup cannot execute, and nothing can send data out.
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ['@hisaab/core', '@hisaab/db'],
  headers: async () => [
    {
      source: '/:path*',
      headers: [
        { key: 'Content-Security-Policy', value: contentSecurityPolicy },
        { key: 'Referrer-Policy', value: 'no-referrer' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    },
  ],
};

export default config;
