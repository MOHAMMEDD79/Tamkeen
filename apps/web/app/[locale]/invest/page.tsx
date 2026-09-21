import { notFound } from 'next/navigation';
import { BadgeCheck, CalendarClock, TrendingUp } from 'lucide-react';
import { AppShell, EmptyState, Ltr, MoneyAmount, Notice, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicOfferingCard } from '../../../lib/server-api';
import { readSiteContent } from '../../../lib/site-content';
import { PageHero, forwardIcon } from '../marketing';
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
  const [result, site] = await Promise.all([readPublic<PublicOfferingCard[]>('/offerings'), readSiteContent()]);
  const Forward = forwardIcon(locale);
  const covers = ['/media/defaults/cover-invest-1.jpg', '/media/defaults/cover-invest-2.jpg', '/media/defaults/hero-business.jpg'];

  return (
    <AppShell locale={locale} path="/invest"
      lead={<PageHero
        image={site.tracks.invest?.imageUrl ?? '/media/defaults/track-invest.jpg'}
        kicker={ar ? 'استثمار ربحي' : 'Profit investment'}
        title={ar ? 'استثمر في شركات تنمو مع مجتمعها' : 'Invest in companies growing with their community'}
        lead={ar
          ? 'عروض أسهم من شركات موثقة، لكل عرض إفصاح منشور وأداة واضحة. لا تُسجَّل ملكية قبل تخصيص يعتمده مراجع مستقل.'
          : 'Equity offerings from verified companies, each with a published disclosure and a clear instrument. No ownership before an independently approved allocation.'}>
        <div className="tmk-carousel__actions" style={{ marginBlockStart: 24 }}>
          <a className="tmk-button tmk-button--accent tmk-button--large" href={localePath(locale, '/app/investor/eligibility')}>{ar ? 'فعّل ملف المستثمر' : 'Set up your investor profile'}<Forward aria-hidden="true" size={20} /></a>
        </div>
      </PageHero>}>

      {/* 00-MASTER-PROMPT: a simulated build is never presented as a real market. */}
      <Notice tone="warning" title={ar ? 'الاكتتاب حاليًا في وضع تجريبي' : 'Subscriptions currently run in test mode'}>
        <p style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'يمر الاكتتاب بمحاكي دفع، ولا يصدر سجل مساهمين قانوني ولا ملكية فعلية ولا تداول ثانوي حتى ربط الخدمات المالية.'
            : 'Subscribing runs through a payment simulator; no legal share register, actual ownership or secondary trading exists until the financial services are connected.'}
        </p>
      </Notice>

      <div className="tmk-section__head tmk-reveal" style={{ marginBlock: '48px 32px' }}>
        <p className="tmk-kicker">{ar ? 'العروض المتاحة' : 'Available offerings'}</p>
        <h2>{ar ? 'فرص استثمار بإفصاح كامل' : 'Investment opportunities with full disclosure'}</h2>
        <p>{ar ? 'كل بطاقة تذكر حجم العرض كله كنسبة من الشركة، لأن «1٪ من العرض» ليست «1٪ من الشركة».' : 'Every card states the whole offering as a share of the company, because “1% of the offering” is not “1% of the company”.'}</p>
      </div>

      {!result.ok ? <ReadError locale={locale} result={result} /> : result.data.length === 0 ? (
        <EmptyState title={ar ? 'لا عروض مفتوحة الآن' : 'No offerings are open right now'}>
          {ar
            ? 'العرض لا يظهر هنا قبل أن يعتمده مراجع مستقل وتفتحه الجهة المصدِّرة. عد قريبًا.'
            : 'An offering appears here once an independent reviewer has approved it and the issuer has opened it. Check back soon.'}
        </EmptyState>
      ) : (
        <div className="tmk-projects">
          {result.data.map((offering, index) => (
            <article className="tmk-project tmk-reveal" key={offering.slug} style={{ ['--reveal-delay' as string]: index % 3 }}>
              <div className="tmk-project__media">
                <img src={covers[index % covers.length]} alt="" loading="lazy" />
                <span className="tmk-project__chip"><TrendingUp aria-hidden="true" size={15} />{ar ? 'استثماري' : 'Investment'}</span>
                <span className="tmk-project__state">
                  {/* A card that does not say where its round has got to invites a reader to act on one that closed weeks ago. */}
                  <StatusBadge tone={offering.state === 'open' ? 'success' : offering.state === 'suspended' ? 'warning' : 'neutral'}>{roundLabel(offering.state, ar)}</StatusBadge>
                </span>
              </div>
              <div className="tmk-project__body">
                <p className="tmk-project__org" style={{ margin: 0 }}>
                  {offering.organization.verified ? <BadgeCheck aria-label={ar ? 'جهة موثقة' : 'Verified'} size={16} /> : null}
                  <span>{offering.organization.displayName}</span><span aria-hidden="true">·</span><span>{offering.organization.city}</span>
                </p>
                <h3 className="tmk-project__title"><a href={localePath(locale, `/invest/${offering.slug}`)}>{offering.title}</a></h3>
                <dl className="tmk-metrics">
                  <div><dt>{ar ? 'أقصى جمع' : 'Max raise'}</dt><dd><MoneyAmount minor={offering.maximumRaiseMinor} currency={offering.currency} locale={locale} /></dd></div>
                  <div><dt>{ar ? 'أقل اكتتاب' : 'Min ticket'}</dt><dd><MoneyAmount minor={offering.minimumTicketMinor} currency={offering.currency} locale={locale} /></dd></div>
                  {/* The figure that stops "1% of the offering" being read as "1% of the company". */}
                  <div><dt>{ar ? 'العرض من الشركة' : 'Of the company'}</dt><dd><Ltr>{offering.offeringPercentOfPostRaise}%</Ltr></dd></div>
                </dl>
              </div>
              <div className="tmk-project__foot">
                <span><CalendarClock aria-hidden="true" size={14} style={{ verticalAlign: 'middle' }} /> {ar ? 'يغلق' : 'Closes'} {offering.closesAt ? formatDate(offering.closesAt, locale) : '—'}</span>
                <a className="tmk-button tmk-button--accent" href={localePath(locale, `/invest/${offering.slug}`)}>{ar ? 'راجع العرض' : 'Review'}<Forward aria-hidden="true" size={16} /></a>
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="tmk-cta tmk-reveal" style={{ marginBlockStart: 64 }} aria-labelledby="invest-cta">
        <img src="/media/defaults/hero-business.jpg" alt="" loading="lazy" />
        <h2 id="invest-cta">{ar ? 'جاهز لتصبح مستثمرًا؟' : 'Ready to become an investor?'}</h2>
        <p>{ar ? 'فعّل ملف المستثمر مرة واحدة، ثم اكتتب في العروض المفتوحة وتابع محفظتك وتقارير الشركات.' : 'Set up your investor profile once, then subscribe to open offerings and follow your portfolio and company reports.'}</p>
        <div className="tmk-carousel__actions">
          <a className="tmk-button tmk-button--accent tmk-button--large" href={localePath(locale, '/app/investor/eligibility')}>{ar ? 'فعّل ملف المستثمر' : 'Set up your profile'}<Forward aria-hidden="true" size={20} /></a>
          <a className="tmk-button tmk-button--glass tmk-button--large" href={localePath(locale, '/about')}>{ar ? 'تعرّف على تمكين' : 'About Tamkeen'}</a>
        </div>
      </section>
    </AppShell>
  );
}
