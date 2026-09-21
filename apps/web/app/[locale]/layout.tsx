import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, LOCALES, directionOf, isLocale, themeBootScript, tokensCss } from '@tamkeen/ui';
import '@tamkeen/ui/styles.css';

// Self-hosted by next/font at build time (SIL OFL 1.1): the browser never calls a font CDN.
// It covers Latin as well, so English pages share the same voice. The variable feeds the token layer.
const brandFont = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600', '700'], variable: '--tmk-font-brand', display: 'swap' });

// Both locales are known at build time, so each shell is prerendered rather than negotiated twice.
export function generateStaticParams() {
  return LOCALES.map(locale => ({ locale }));
}

/** Keep mobile browsers at the device width so RTL content does not render into a 980px canvas. */
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const arabic = locale !== 'en';
  return {
    title: arabic ? 'تمكين — تمويل يصل، وأثر يُثبت' : 'Tamkeen — funding that arrives, impact that is proven',
    description: arabic
      ? 'منصة تربط التمويل بالتنفيذ وبنتيجة موثقة عبر العمل الخيري والاستثمار والتدريب إلى العمل.'
      : 'A platform linking funding to delivery and to a documented result across charity, investment and training to work.',
    icons: { icon: '/brand/icon.png', apple: '/brand/icon.png' },
    // Nothing here is production content; keeping it out of indexes is deliberate.
    robots: { index: false, follow: false }
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    // The boot script may set data-theme before React hydrates, so that one attribute is expected
    // to differ from the server render.
    <html lang={locale} dir={directionOf(locale)} className={brandFont.variable} suppressHydrationWarning>
      <head>
        {/* Runs before first paint so a remembered dark or light choice never flashes the other. */}
        <script dangerouslySetInnerHTML={{ __html: themeBootScript() }} />
        {/* The token layer is generated from tokens.ts so the stylesheet can never drift from it. */}
        <style id="tamkeen-tokens" dangerouslySetInnerHTML={{ __html: tokensCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

export const dynamicParams = false;
export { DEFAULT_LOCALE };
