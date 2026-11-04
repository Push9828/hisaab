import type { NextConfig } from 'next';

// Pages are server-rendered HTML with none of our components on the client, so the browser runs no
// script at all, and injected markup cannot execute. This does not stop every way
// out: a link can go anywhere, and a form can post to the addresses in form-action.
const contentSecurityPolicy = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'self'",
  "img-src 'self'",
  "font-src 'self'",
  "base-uri 'none'",
  // Chrome also applies this to redirects, and sign-in redirects to Google.
  "form-action 'self' https://accounts.google.com",
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
        // Not no-referrer: that makes browsers send `Origin: null` on form posts,
        // which fails the server action origin check.
        { key: 'Referrer-Policy', value: 'same-origin' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
      ],
    },
  ],
};

export default config;
