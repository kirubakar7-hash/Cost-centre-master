import type { Metadata } from 'next';
import { Maven_Pro } from 'next/font/google';
import { headers } from 'next/headers';
import './globals.css';

const maven = Maven_Pro({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-maven' });

export const metadata: Metadata = {
  title: 'SolidPro Cost Centre Portal',
  description: 'Find the right cost centre code — Solidpro Engineering Support Pvt Ltd (internal)',
  robots: { index: false, follow: false },
  icons: { icon: '/solidpro-mark.png' },
};

// Applies the saved/OS theme before first paint (no flash).
const themeScript = `try{var t=localStorage.getItem('theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get('x-nonce') ?? undefined;
  return (
    <html lang="en" className={maven.variable} suppressHydrationWarning>
      <head>
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
