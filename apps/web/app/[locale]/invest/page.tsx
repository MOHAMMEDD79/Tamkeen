import { notFound } from 'next/navigation';
import { AppShell, Card, EmptyState, Ltr, MoneyAmount, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicOfferingCard } from '../../../lib/server-api';
import { ReadError } from '../public-parts';

/**
 * PUB-07. The investment index, server-rendered so it is indexable (10-TECHNICAL-ARCHITECTURE).
 *
 * Every card states what the whole offering amounts to as a share of the company. That figure is
 * here rather than only on the detail page because the number people reach for — "1% of the
 * offering" — is not the number that matters, and a list is where the confusion starts.
 *
 * No projected return and no valuation appears anywhere: neither would be a fact.
 */

export const dynamic = 'force-dynamic';

/** Where a published round has got to, in the reader's language. */
function roundLabel(state: string, ar: boolean): string {
  const labels: Record<string, { ar: string; en: string }> = {
    open: { ar: 'مفتوح للاكتتاب', en: 'Open' },
    suspended: { ar: 'موقوف — صدر إفصاح جديد', en: 'Suspended — new disclosure' },
    closing: { ar: 'أُغلق الاكتتاب', en: 'Subscription closed' },
    failed: { ar: 'لم يبلغ الحد الأدنى', en: 'Minimum not reached' },
    allocated: { ar: 'خُصِّص', en: 'Allocated' },
    reporting: { ar: 'مرحلة التقارير', en: 'Reporting' },
    closed: { ar: 'مغلق', en: 'Closed' }
  };
  const label = labels[state];
  return label ? (ar ? label.ar : label.en) : state;
}

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Investment — Tamkeen', description: 'Equity offerings from verified companies, with the disclosure each one is published against.' }
    : { title: 'الاستثمار — تمكين', description: 'عروض أسهم من شركات موثقة، ولكل عرض إفصاحه المنشور.' };
}

export default async function Invest({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<PublicOfferingCard[]>('/offerings');

  return (
    <AppShell locale={locale} path="/invest">
      <PageHeader
        eyebrow={ar ? 'الاستثمار' : 'Investment'}
        title={ar ? 'عروض التمويل بالأسهم' : 'Equity funding offerings'}
        lead={ar
          ? 'يفصل هذا المسار الاهتمام عن الالتزام عن التخصيص عن الملكية المثبتة. لا تنشأ حصة قبل تخصيص مثبت.'
          : 'This track keeps interest, commitment, allocation and proven holding apart. No stake exists before a proven allocation.'}
      />

      {/* 00-MASTER-PROMPT: a simulated build is never presented as a real market. */}
      <Notice tone="warning" title={ar ? 'بيئة عرض — لا اكتتاب حقيقي' : 'Demonstration build — no real subscription'}>
        <p style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'العروض هنا تجريبية وكذلك الشركات. الاكتتاب يمر بمحاكي دفع محلي، ولا يصدر عن هذه النسخة سجل مساهمين قانوني ولا ملكية فعلية، ولا يوجد تداول ثانوي.'
            : 'These offerings and companies are demonstration data. Subscribing runs through a local payment simulator; this build issues no legal share register and no actual ownership, and there is no secondary trading.'}
        </p>
      </Notice>

      {!result.ok ? <ReadError locale={locale} result={result} /> : result.data.length === 0 ? (
        <EmptyState title={ar ? 'لا عروض مفتوحة الآن' : 'No offerings are open right now'}>
          {ar
            ? 'لا يوجد عرض بلغ مرحلة النشر. العرض لا يظهر هنا قبل أن يعتمده مراجع مستقل وتفتحه الجهة المصدِّرة.'
            : 'No offering has reached publication. An offering does not appear here until an independent reviewer has approved it and the issuer has opened it.'}
        </EmptyState>
      ) : (
        <div className="tmk-grid tmk-grid--cards">
          {result.data.map(offering => (
            <Card key={offering.slug} title={<a href={localePath(locale, `/invest/${offering.slug}`)}>{offering.title}</a>}>
              <p className="tmk-field__hint">
                {offering.organization.displayName} · {offering.organization.city}{' '}
                {offering.organization.verified
                  ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified'}</StatusBadge>
                  : <StatusBadge tone="neutral">{ar ? 'غير موثقة' : 'Unverified'}</StatusBadge>}
              </p>
              <dl className="tmk-definitions">
                <div>
                  <dt>{ar ? 'أقصى ما يمكن جمعه' : 'Maximum raise'}</dt>
                  <dd><MoneyAmount minor={offering.maximumRaiseMinor} currency={offering.currency} locale={locale} /></dd>
                </div>
                <div>
                  <dt>{ar ? 'الحد الأدنى للاكتتاب' : 'Minimum ticket'}</dt>
                  <dd><MoneyAmount minor={offering.minimumTicketMinor} currency={offering.currency} locale={locale} /></dd>
                </div>
                <div>
                  {/* The figure that stops "1% of the offering" being read as "1% of the company". */}
                  <dt>{ar ? 'العرض كله من الشركة' : 'The whole offering, as a share of the company'}</dt>
                  <dd><Ltr>{offering.offeringPercentOfPostRaise}%</Ltr></dd>
                </div>
                <div>
                  {/* A card that does not say where its round has got to invites a reader to act
                      on one that closed weeks ago. */}
                  <dt>{ar ? 'حالة الجولة' : 'Round'}</dt>
                  <dd>
                    <StatusBadge tone={offering.state === 'open' ? 'success' : offering.state === 'suspended' ? 'warning' : 'neutral'}>
                      {roundLabel(offering.state, ar)}
                    </StatusBadge>
                  </dd>
                </div>
                <div>
                  <dt>{ar ? 'يغلق في' : 'Closes'}</dt>
                  <dd>{offering.closesAt ? formatDate(offering.closesAt, locale) : '—'}</dd>
                </div>
              </dl>
              <p className="tmk-row__actions">
                <a className="tmk-button tmk-button--secondary" href={localePath(locale, `/invest/${offering.slug}`)}>
                  {ar ? 'راجع العرض' : 'Review this offering'}
                </a>
              </p>
            </Card>
          ))}
        </div>
      )}

      <nav className="tmk-inline-links">
        <a href={localePath(locale, '/app/investor/eligibility')}>{ar ? 'فعّل ملف المستثمر' : 'Set up your investor profile'}</a>
        <a href={localePath(locale, '/explore')}>{ar ? 'استكشف المشاريع المنشورة' : 'Explore published projects'}</a>
        <a href={localePath(locale, '/about')}>{ar ? 'عن تمكين وحدود النسخة' : 'About Tamkeen and this build’s limits'}</a>
      </nav>
    </AppShell>
  );
}
