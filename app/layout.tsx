import type { Metadata, Viewport } from 'next';
import { Playfair_Display, Source_Sans_3, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

// Maroon Meridian typography (tokens.css §4).
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-playfair',
  display: 'swap',
});
const sourceSans = Source_Sans_3({
  subsets: ['latin'],
  variable: '--font-source-sans',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  // Neutral product name — NOT a single-property brand (inv. #3 / F-PROD-02).
  title: 'PN Master Suite',
  description: 'Multi-tenant hospitality operating system.',
};

export const viewport: Viewport = {
  themeColor: '#8E2A2E', // maroon-500
  width: 'device-width',
  initialScale: 1,
};

/**
 * Inline theme bootstrap — sets [data-theme] before paint to prevent a
 * light/dark flash (FOUC). Reads the saved preference, falls back to the OS.
 */
const THEME_BOOTSTRAP = `
(function(){try{
  var t = localStorage.getItem('pn-theme');
  if(!t){ t = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
  document.documentElement.setAttribute('data-theme', t);
}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${playfair.variable} ${sourceSans.variable} ${plexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
