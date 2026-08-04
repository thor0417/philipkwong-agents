import type { Metadata } from 'next';
import { DM_Mono } from 'next/font/google';
import './globals.css';
import Providers from './providers';

const dmMono = DM_Mono({
  weight: ['400', '500'],
  subsets: ['latin'],
  variable: '--font-dm-mono',
});

export const metadata: Metadata = {
  title: 'Philip Kwong — Agents',
  description: 'Lead acquisition dashboard',
};

// Runs before first paint, ahead of React. Without it a dark-mode user gets a
// full-brightness flash on every navigation, which is the single most visible
// way a theme implementation reads as bolted on. Deliberately not a component:
// anything React renders is already too late.
const NO_FLASH = `try{var t=localStorage.getItem('pk-theme');if(t==='dark'||t==='light')document.documentElement.setAttribute('data-theme',t)}catch(e){}`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // suppressHydrationWarning: the script above mutates <html> before React
    // hydrates, so the server markup and the client DOM legitimately differ.
    <html lang="en" className={dmMono.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
