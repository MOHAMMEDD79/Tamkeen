import { notFound } from 'next/navigation';
import { AppShell, Card, Notice, PageHeader, StatusBadge, isLocale, localePath, translator } from '@tamkeen/ui';
import { DESIGN_SCREENS, screenPurpose, screenTitles } from './fixtures';

export default async function DesignIndex({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const ar = locale === 'ar';
  const t = translator(locale);
  return (
    <AppShell locale={locale} path="/design" demoBanner>
      <PageHeader
        eyebrow={t('designReview')}
        title={ar ? 'بوابة قبول نظام التصميم' : 'Design system acceptance gate'}
        lead={ar
          ? 'الشاشات الست التي تحكم على اللغة البصرية قبل تعميمها على بقية المنتج، كما تشترط مواصفة نظام التصميم.'
          : 'The six screens that judge the visual language before it is rolled out, as the design system specification requires.'}
      />

      <Notice tone="warning" title={ar ? 'ليست ميزات منفذة' : 'Not implemented features'}>
        <p style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'كل شاشة هنا دراسة تخطيط فوق بيانات مصطنعة معلنة. لا تستدعي أي منها خادمًا، ولا يوجد خلفها منطق أعمال، ولا تُحتسب تنفيذًا لأي معرّف إجراء.'
            : 'Each screen here is a layout study over declared synthetic data. None calls a server, none has business logic behind it, and none counts as an implementation of any action ID.'}
        </p>
      </Notice>

      <div className="tmk-grid tmk-grid--cards">
        {DESIGN_SCREENS.map((screen, index) => (
          <article className="tmk-card" key={screen}>
            <p className="tmk-page-header__eyebrow">{ar ? `شاشة ${index + 1} من ${DESIGN_SCREENS.length}` : `Screen ${index + 1} of ${DESIGN_SCREENS.length}`}</p>
            <h2 style={{ marginBlockStart: 0, fontSize: 'var(--tmk-type-h3-size)' }}>{screenTitles[screen][locale]}</h2>
            <p style={{ color: 'var(--tmk-color-muted)' }}>{screenPurpose[screen][locale]}</p>
            <a className="tmk-button tmk-button--secondary" href={localePath(locale, `/design/${screen}`)}>{ar ? 'افتح الشاشة' : 'Open screen'}</a>
          </article>
        ))}
      </div>

      <Card title={ar ? 'معرض حالات المكونات' : 'Component states gallery'}>
        <p>
          {ar
            ? 'يعرض كل مكون في حالاته الإلزامية: الافتراضية والتحميل والفارغة والخطأ والمعطلة والتركيز، بالعربية والإنجليزية.'
            : 'Shows every component in its required states — default, loading, empty, error, disabled and focus — in both Arabic and English.'}
        </p>
        <p style={{ marginBlockEnd: 0 }}>
          <a className="tmk-button tmk-button--primary" href={localePath(locale, '/design/states')}>{ar ? 'افتح المعرض' : 'Open the gallery'}</a>
        </p>
      </Card>

      <p className="tmk-field__hint">
        <StatusBadge tone="neutral">{ar ? 'التبديل بين اللغتين من أعلى الصفحة يحافظ على الشاشة نفسها' : 'Switching language at the top keeps you on the same screen'}</StatusBadge>
      </p>
    </AppShell>
  );
}
