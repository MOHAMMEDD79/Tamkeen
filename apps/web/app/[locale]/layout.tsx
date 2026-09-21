import type { Metadata, Viewport } from 'next';
import { notFound } from 'next/navigation';
import { DEFAULT_LOCALE, LOCALES, directionOf, isLocale, tokensCss } from '@tamkeen/ui';
import '@tamkeen/ui/styles.css';

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
    title: arabic ? 'تمكين — نسخة محلية تجريبية' : 'Tamkeen — local preview',
    description: arabic
      ? 'منصة تربط التمويل بالتنفيذ وبنتيجة موثقة عبر العمل الخيري والاستثمار والتدريب إلى العمل.'
      : 'A platform linking funding to delivery and to a documented result across charity, investment and training to work.',
    // Nothing here is production content; keeping it out of indexes is deliberate.
    robots: { index: false, follow: false }
  };
}

export default async function LocaleLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <html lang={locale} dir={directionOf(locale)}>
      <head>
        {/* The token layer is generated from tokens.ts so the stylesheet can never drift from it. */}
        <style id="tamkeen-tokens" dangerouslySetInnerHTML={{ __html: tokensCss() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

export const dynamicParams = false;
export { DEFAULT_LOCALE };
