import { NextResponse, type NextRequest } from 'next/server';
import { DEFAULT_LOCALE, LOCALES } from '@tamkeen/ui';

/**
 * Locale lives in the path (04-INFORMATION-ARCHITECTURE), so a request without one is redirected
 * to a prefixed URL rather than silently rendered in a default language.
 *
 * Arabic is the product's primary language, so it is the fallback; Accept-Language is only
 * consulted to honour an explicit English preference. In Next 16 this file convention is `proxy`,
 * which replaced the deprecated `middleware`.
 */
function preferredLocale(request: NextRequest): string {
  const header = request.headers.get('accept-language') ?? '';
  const ranked = header
    .split(',')
    .map(part => {
      const [tag = '', ...rest] = part.trim().split(';');
      const quality = Number(rest.find(entry => entry.trim().startsWith('q='))?.split('=')[1] ?? '1');
      return { tag: tag.trim().toLowerCase(), quality: Number.isFinite(quality) ? quality : 0 };
    })
    .filter(entry => entry.tag)
    .sort((a, b) => b.quality - a.quality);
  for (const entry of ranked) {
    const base = entry.tag.split('-')[0];
    if (base === 'ar') return 'ar';
    if (base === 'en') return 'en';
  }
  return DEFAULT_LOCALE;
}

/** A path with a file extension is an asset request, not a page, so it is never locale-prefixed. */
const isAssetPath = (pathname: string) => /\.[a-zA-Z0-9]+$/.test(pathname);

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (isAssetPath(pathname)) return NextResponse.next();
  if (LOCALES.some(locale => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`))) return NextResponse.next();
  const target = request.nextUrl.clone();
  target.pathname = `/${preferredLocale(request)}${pathname === '/' ? '' : pathname}`;
  target.search = search;
  return NextResponse.redirect(target);
}

export const config = {
  // Kept to the simple form Next can statically analyse; asset and locale skips live in the
  // function above, where they are readable and testable rather than encoded in a lookahead.
  matcher: ['/((?!_next|api).*)']
};
