import { notFound } from 'next/navigation';
import { AppShell, Card, Notice, PageHeader, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { CURRENT_TERMS_VERSION } from '@tamkeen/config';
import { DownloadButton } from '../download-button';

/** PUB-13. Static, server-rendered, and explicit about the limits of this build. */

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'About Tamkeen', description: 'What Tamkeen does, how funding reaches delivery, and what this build does not do.' }
    : { title: 'عن تمكين', description: 'ما تفعله تمكين، وكيف يصل التمويل إلى التنفيذ، وما لا تفعله هذه النسخة.' };
}

export default async function About({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';

  const tracks = ar
    ? [
        { title: 'العمل الخيري', body: 'جهة موثقة تنشر مشروعًا بميزانية ومراحل. المساهمة تُتابع حتى دليل التنفيذ وتقرير الإغلاق، لا حتى بلوغ شريط التمويل 100%.' },
        { title: 'الاستثمار', body: 'شركة تفتح عرضًا محددًا بأداة ونسخة إفصاح. الالتزام ليس ملكية؛ لا تنشأ حصة قبل تخصيص مثبت.' },
        { title: 'التدريب إلى العمل', body: 'برنامج ممول يقود إلى تدريب موثق ثم توظيف يُحتسب من تاريخ بدء عمل مؤكد، لا من عدد المسجلين.' }
      ]
    : [
        { title: 'Charity', body: 'A verified organisation publishes a budgeted, staged project. A contribution is traceable through to delivery evidence and a closing report — not merely to a funding bar reaching 100%.' },
        { title: 'Investment', body: 'A company opens a specific offering with an instrument and a disclosure version. A commitment is not ownership; no stake exists before a proven allocation.' },
        { title: 'Training into work', body: 'A funded programme leads to documented training and then to employment counted from a confirmed start date, not from sign-up numbers.' }
      ];

  return (
    <AppShell locale={locale} path="/about">
      <PageHeader
        eyebrow={ar ? 'عن تمكين' : 'About Tamkeen'}
        title={ar ? 'اعرف إلى أين يذهب تمويلك، من ينفذ، وما الذي تحقق' : 'Know where your funding goes, who delivers, and what was achieved'}
        lead={ar
          ? 'تربط تمكين رأس المال بالجهة المنفذة وبالناس، وتُبقي كل مبلغ مرتبطًا بمصدره واستخدامه ونتيجته.'
          : 'Tamkeen connects capital, the delivering organisation and people, and keeps every amount tied to its source, its use and its result.'}
      />

      <Card title={ar ? 'المسارات الثلاثة' : 'The three tracks'}>
        <div className="tmk-grid tmk-grid--cards">
          {tracks.map(track => (
            <article key={track.title} className="tmk-stat">
              <h3 style={{ marginBlockStart: 0 }}>{track.title}</h3>
              <p style={{ marginBlockEnd: 0, color: 'var(--tmk-color-muted)' }}>{track.body}</p>
            </article>
          ))}
        </div>
      </Card>

      <Card title={ar ? 'ماذا يعني التوثيق' : 'What verification means'}>
        <p>
          {ar
            ? 'شارة «موثقة» تعني أن مراجعًا مستقلًا فحص مستندات تسجيل الجهة في تاريخ محدد. لا تعني ضمان نجاح أي مشروع، ولا تقييمًا لجودة التنفيذ، ولا مسؤولية المنصة عن نتيجة.'
            : 'A “verified” badge means an independent reviewer checked the organisation’s registration documents on a given date. It does not guarantee any project will succeed, does not rate delivery quality, and does not make the platform responsible for an outcome.'}
        </p>
        <p style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'التوثيق المنتهي لا يُحتسب موثقًا، وتُمنع الجهة من عمليات تتطلب توثيقًا ساريًا حتى تُجدده.'
            : 'An expired verification does not count as verified, and the organisation is blocked from operations that require a current one until it renews.'}
        </p>
      </Card>

      <Notice tone="warning" title={ar ? 'حدود هذه النسخة' : 'What this build does not do'}>
        <p>
          {ar
            ? 'هذه نسخة تطوير محلية. لا تستقبل أموالًا، ولا ترتبط بمزود دفع، ولا ترسل بريدًا خارجيًا، ولا تنشئ ملكية أو التزامًا استثماريًا. المساهمة والاكتتاب والتقديم للبرامج غير متاحة بعد.'
            : 'This is a local development build. It accepts no money, connects to no payment provider, sends no external email, and creates no ownership or investment obligation. Contributing, subscribing and applying to programmes are not available yet.'}
        </p>
        <p style={{ marginBlockEnd: 0 }}>
          {ar
            ? <>نسخة الشروط الحالية <code>{CURRENT_TERMS_VERSION}</code>. <a href={localePath(locale, '/policies/terms')}>اقرأ الشروط وحدود البيئة</a>.</>
            : <>Current terms version <code>{CURRENT_TERMS_VERSION}</code>. <a href={localePath(locale, '/policies/terms')}>Read the terms and environment limits</a>.</>}
        </p>
      </Notice>

      <nav className="tmk-inline-links">
        <a href={localePath(locale, '/explore')}>{ar ? 'استكشف المشاريع' : 'Explore projects'}</a>
        <a href={localePath(locale, '/organizations')}>{ar ? 'دليل الجهات' : 'Organisation directory'}</a>
        <a href={localePath(locale, '/impact')}>{ar ? 'الأثر والشفافية' : 'Impact and transparency'}</a>
        <DownloadButton endpoint={`/policies/terms/versions/${CURRENT_TERMS_VERSION}`} label={ar ? 'نزّل نسخة الشروط المؤرخة' : 'Download dated terms'} />
      </nav>
    </AppShell>
  );
}
