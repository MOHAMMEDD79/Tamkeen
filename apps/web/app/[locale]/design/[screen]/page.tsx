import { notFound } from 'next/navigation';
import { AppShell, isLocale, localePath, translator } from '@tamkeen/ui';
import { isDesignScreen, screenPurpose, screenTitles } from '../fixtures';
import { DesignScreenBody } from '../screens';
import { StatesGallery } from '../states-gallery';

export default async function DesignScreenPage({ params }: { params: Promise<{ locale: string; screen: string }> }) {
  const { locale, screen } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === 'ar';
  const t = translator(locale);
  const gallery = screen === 'states';
  if (!gallery && !isDesignScreen(screen)) notFound();

  return (
    <AppShell locale={locale} path={`/design/${screen}`} demoBanner>
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={localePath(locale, '/design')}>{t('designReview')}</a></li>
          <li><span aria-current="page">{gallery ? (ar ? 'معرض حالات المكونات' : 'Component states gallery') : screenTitles[screen as never][locale]}</span></li>
        </ol>
      </nav>
      {!gallery && (
        <p className="tmk-field__hint">{screenPurpose[screen as never][locale]}</p>
      )}
      {gallery ? <StatesGallery locale={locale} /> : <DesignScreenBody screen={screen as never} locale={locale} />}
    </AppShell>
  );
}
