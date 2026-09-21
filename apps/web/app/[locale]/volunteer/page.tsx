import { notFound } from 'next/navigation';
import { AppShell, Card, EmptyState, Ltr, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicVolunteerOpportunity } from '../../../lib/server-api';
import { ReadError } from '../public-parts';

/**
 * PER-17, the public half. Volunteering opportunities from verified organisations.
 *
 * Two things every card says out loud, because both are assumptions worth correcting before
 * somebody gives up their time: volunteering here is unpaid, and it is not employment. 07 also
 * requires a named person answerable for a volunteer, so the page states that one exists — without
 * publishing who they are, which would put a private individual's name on an open page.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Volunteering — Tamkeen', description: 'Volunteering opportunities from verified organisations, each with its tasks, its places and its withdrawal policy.' }
    : { title: 'التطوع — تمكين', description: 'فرص تطوع من جهات موثقة، لكل فرصة مهامها وأماكنها وسياسة انسحابها المعلنة.' };
}

const deliveryLabel = (mode: string, ar: boolean) =>
  mode === 'remote' ? (ar ? 'عن بُعد' : 'Remote') : mode === 'hybrid' ? (ar ? 'مختلط' : 'Hybrid') : (ar ? 'حضوري' : 'In person');

export default async function VolunteerPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<PublicVolunteerOpportunity[]>('/volunteer-opportunities');

  return (
    <AppShell locale={locale} path="/volunteer">
      <PageHeader
        eyebrow={ar ? 'التطوع' : 'Volunteering'}
        title={ar ? 'فرص التطوع' : 'Volunteering opportunities'}
        lead={ar
          ? 'وقتك تبرع. التطوع هنا غير مدفوع وليس توظيفًا، ولكل فرصة مسؤول عنها وسياسة انسحاب معلنة قبل أن يتقدم أحد.'
          : 'Your time is a donation. Volunteering here is unpaid and is not employment, and every opportunity has a named supervisor and a withdrawal policy published before anybody applies.'}
      />

      {/* 07's stage limit for this surface, stated where somebody decides rather than in a footnote. */}
      <Notice tone="warning" title={ar ? 'التطوع ليس وظيفة' : 'Volunteering is not a job'}>
        <p style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'لا أجر ولا بدل ولا عقد عمل مقابل التطوع، ولا يمنح التطوع أولوية في أي وظيفة معلنة على المنصة. ساعاتك تُسجَّل ويعتمدها شخص آخر، ولا تتحول إلى مستحق مالي.'
            : 'No wage, no stipend and no employment contract follows from volunteering, and it gives no priority in any job advertised here. Your hours are recorded and approved by somebody else; they do not become money owed.'}
        </p>
      </Notice>

      {!result.ok ? <ReadError locale={locale} result={result} /> : result.data.length === 0 ? (
        <EmptyState title={ar ? 'لا فرص تطوع الآن' : 'No opportunities are open right now'}>
          {ar
            ? 'لا توجد فرصة بلغت مرحلة النشر. الفرصة لا تظهر هنا قبل أن تنشرها جهة موثقة بمهامها وسياسة انسحابها ومسؤول عنها.'
            : 'No opportunity has reached publication. One does not appear here until a verified organisation publishes it with its tasks, its withdrawal policy and a named supervisor.'}
        </EmptyState>
      ) : (
        <div className="tmk-grid tmk-grid--cards">
          {result.data.map(opportunity => (
            <Card key={opportunity.slug} title={<a href={localePath(locale, `/volunteer/${opportunity.slug}`)}>{opportunity.title}</a>}>
              <p className="tmk-field__hint">
                {opportunity.organization.displayName} · {opportunity.city || opportunity.organization.city}{' '}
                {opportunity.organization.verified
                  ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified'}</StatusBadge>
                  : <StatusBadge tone="neutral">{ar ? 'غير موثقة' : 'Unverified'}</StatusBadge>}
              </p>
              <p>{opportunity.summary}</p>
              <dl className="tmk-definitions">
                <div>
                  <dt>{ar ? 'الأماكن المتبقية' : 'Places left'}</dt>
                  <dd><Ltr>{String(opportunity.placesLeft)}</Ltr> {ar ? `من ${opportunity.capacity}` : `of ${opportunity.capacity}`}</dd>
                </div>
                <div>
                  <dt>{ar ? 'الالتزام' : 'Commitment'}</dt>
                  <dd><Ltr>{String(opportunity.hoursPerWeek)}</Ltr> {ar ? 'ساعة أسبوعيًا' : 'hrs/week'} · {deliveryLabel(opportunity.deliveryMode, ar)}</dd>
                </div>
                <div>
                  <dt>{ar ? 'الأجر' : 'Pay'}</dt>
                  <dd>{ar ? 'لا أجر — عمل تطوعي' : 'Unpaid — volunteering'}</dd>
                </div>
                {opportunity.startsAt ? (
                  <div><dt>{ar ? 'تبدأ' : 'Starts'}</dt><dd>{formatDate(opportunity.startsAt, locale)}</dd></div>
                ) : null}
              </dl>
              <p className="tmk-row__actions">
                <a className="tmk-button tmk-button--secondary" href={localePath(locale, `/volunteer/${opportunity.slug}`)}>
                  {ar ? 'اقرأ التفاصيل' : 'Read the details'}
                </a>
              </p>
            </Card>
          ))}
        </div>
      )}

      <nav className="tmk-inline-links">
        <a href={localePath(locale, '/app/volunteering')}>{ar ? 'تطوعي' : 'Your volunteering'}</a>
        <a href={localePath(locale, '/opportunities')}>{ar ? 'التدريب والعمل' : 'Training and work'}</a>
        <a href={localePath(locale, '/about')}>{ar ? 'عن تمكين وحدود النسخة' : 'About Tamkeen and this build’s limits'}</a>
      </nav>
    </AppShell>
  );
}
