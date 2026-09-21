import { notFound } from 'next/navigation';
import { isLocale, type Locale } from '@tamkeen/ui';
import { Subscribe } from '../../../subscription-screens';

/**
 * PER-08. Subscribing lives under the public offering path because that is where an investor is
 * when they decide, but every read behind it is authenticated: the screen itself asks for a session
 * and says so rather than rendering an empty shell to a signed-out reader.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return { title: locale === 'en' ? 'Subscribe — Tamkeen' : 'الاكتتاب — تمكين', robots: { index: false } };
}

export default async function SubscribePage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  return <Subscribe locale={raw satisfies Locale} slug={slug} />;
}
