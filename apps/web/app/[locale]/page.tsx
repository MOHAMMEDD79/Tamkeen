import { AppShell, Card, Notice, PageHeader, StatusBadge, localePath, type Locale } from '@tamkeen/ui';

export const dynamic = 'force-dynamic';

const copy = {
  ar: {
    eyebrow: 'تمكين · نسخة محلية تجريبية',
    title: 'اعرف إلى أين يذهب تمويلك، من ينفذ، وما الذي تحقق.',
    lead: 'تربط تمكين رأس المال بالجهة المنفذة وبالناس عبر ثلاثة مسارات: العمل الخيري، والاستثمار، والتدريب إلى العمل. هذه النسخة محلية للتطوير، ولا تستقبل أموالًا.',
    statusHeading: 'حالة الاتصال الفعلية',
    ready: 'الخادم وقاعدة البيانات متصلان وجاهزان.',
    notReady: 'الاتصال غير جاهز بعد. شغّل قاعدة البيانات والخادم ثم أعد تحميل الصفحة.',
    stageLabel: 'المرحلة الحالية',
    stageValue: '03 · نظام التصميم وقوالب الواجهة',
    moneyLabel: 'العمليات المالية',
    moneyValue: 'غير مفعّلة',
    dataLabel: 'بيانات المنتج',
    dataValue: 'الهوية والمؤسسات فقط',
    tracksHeading: 'المسارات الثلاثة',
    tracks: [
      { title: 'العمل الخيري', body: 'جهة موثقة تنشر مشروعًا بميزانية ومراحل، والمساهمة تُتابع حتى دليل التنفيذ وتقرير الإغلاق.' },
      { title: 'الاستثمار', body: 'شركة تعرض تمويلًا محددًا بأداة ونسخة إفصاح، والمستثمر لا يملك حصة قبل تخصيص مثبت.' },
      { title: 'التدريب إلى العمل', body: 'برنامج ممول يقود إلى تدريب موثق ثم توظيف يُحتسب من بدء عمل مؤكد، لا من عدد المسجلين.' }
    ],
    reviewLink: 'شاشات مراجعة التصميم',
    signInLink: 'الدخول إلى مساحتي',
    scopeTitle: 'حدود هذه النسخة',
    scopeBody: 'لا مزود دفع ولا بريد خارجي ولا ملكية فعلية. الشاشات التي تعرض أرقامًا مالية في مراجعة التصميم تستخدم بيانات مصطنعة معلنة.'
  },
  en: {
    eyebrow: 'Tamkeen · local preview',
    title: 'See where your funding goes, who delivers, and what was achieved.',
    lead: 'Tamkeen connects capital, the delivering organisation and people across three tracks: charity, investment, and training into work. This build is local and accepts no money.',
    statusHeading: 'Live connection status',
    ready: 'The API and database are connected and ready.',
    notReady: 'Not ready yet. Start the database and the API, then reload this page.',
    stageLabel: 'Current stage',
    stageValue: '03 · Design system and interface templates',
    moneyLabel: 'Financial operations',
    moneyValue: 'Disabled',
    dataLabel: 'Product data',
    dataValue: 'Identity and organisations only',
    tracksHeading: 'The three tracks',
    tracks: [
      { title: 'Charity', body: 'A verified organisation publishes a budgeted, staged project, and a contribution is traceable through to delivery evidence and a closing report.' },
      { title: 'Investment', body: 'A company opens a specific offering with an instrument and a disclosure version, and no investor holds a stake before a proven allocation.' },
      { title: 'Training into work', body: 'A funded programme leads to documented training and then to employment counted from a confirmed start date, not from sign-ups.' }
    ],
    reviewLink: 'Design review screens',
    signInLink: 'Go to my workspace',
    scopeTitle: 'Limits of this build',
    scopeBody: 'No payment provider, no external email, no real ownership. Screens showing financial figures in design review use clearly declared synthetic data.'
  }
} as const;

export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale = (raw === 'en' ? 'en' : 'ar') satisfies Locale;
  const text = copy[locale];

  let ready = false;
  try {
    const response = await fetch(`${process.env.API_BASE_URL ?? 'http://127.0.0.1:4000'}/api/v1/health/ready`, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    ready = response.ok && (await response.json()).status === 'ready';
  } catch { /* The status page stays available when the API or database is down. */ }

  return (
    <AppShell locale={locale} path="/">
      <PageHeader
        eyebrow={text.eyebrow}
        title={text.title}
        lead={text.lead}
        actions={<>
          <a className="tmk-button tmk-button--primary" href={localePath(locale, '/explore')}>{locale === 'ar' ? 'استكشف المشاريع' : 'Explore projects'}</a>
          <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/organizations')}>{locale === 'ar' ? 'دليل الجهات' : 'Organisation directory'}</a>
          <a className="tmk-button tmk-button--quiet" href={localePath(locale, '/app')}>{text.signInLink}</a>
        </>}
      />

      <Card title={text.statusHeading} id="status">
        <Notice tone={ready ? 'success' : 'warning'}>
          <p>{ready ? text.ready : text.notReady}</p>
        </Notice>
        <div className="tmk-grid tmk-grid--stats">
          <div className="tmk-stat"><p className="tmk-stat__label">{text.stageLabel}</p><p className="tmk-stat__value" style={{ fontSize: '17px' }}>{text.stageValue}</p></div>
          <div className="tmk-stat"><p className="tmk-stat__label">{text.moneyLabel}</p><p className="tmk-stat__value" style={{ fontSize: '17px' }}><StatusBadge tone="warning">{text.moneyValue}</StatusBadge></p></div>
          <div className="tmk-stat"><p className="tmk-stat__label">{text.dataLabel}</p><p className="tmk-stat__value" style={{ fontSize: '17px' }}>{text.dataValue}</p></div>
        </div>
      </Card>

      <Card title={text.tracksHeading}>
        <div className="tmk-grid tmk-grid--cards">
          {text.tracks.map(track => (
            <article key={track.title} className="tmk-stat">
              <h3 style={{ marginBlockStart: 0 }}>{track.title}</h3>
              <p style={{ marginBlockEnd: 0, color: 'var(--tmk-color-muted)' }}>{track.body}</p>
            </article>
          ))}
        </div>
      </Card>

      <Notice tone="warning" title={text.scopeTitle}>
        <p style={{ marginBlockEnd: 0 }}>{text.scopeBody}</p>
      </Notice>

      <nav className="tmk-inline-links" aria-label={locale === 'ar' ? 'روابط عامة' : 'Public links'}>
        <a href={localePath(locale, '/map')}>{locale === 'ar' ? 'الخريطة' : 'Map'}</a>
        <a href={localePath(locale, '/invest')}>{locale === 'ar' ? 'الاستثمار' : 'Investment'}</a>
        <a href={localePath(locale, '/opportunities')}>{locale === 'ar' ? 'التدريب والعمل' : 'Training and work'}</a>
        <a href={localePath(locale, '/impact')}>{locale === 'ar' ? 'الأثر' : 'Impact'}</a>
        <a href={localePath(locale, '/about')}>{locale === 'ar' ? 'عن تمكين' : 'About'}</a>
        <a href={localePath(locale, '/design')}>{text.reviewLink}</a>
      </nav>
    </AppShell>
  );
}
