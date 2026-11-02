import './globals.css';

import { Plus_Jakarta_Sans } from 'next/font/google';

import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// Downloaded at build time and served from this app, so the browser never calls Google.
const jakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  variable: '--font-jakarta',
});

export const metadata: Metadata = {
  title: 'Hisaab',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={jakarta.variable}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
