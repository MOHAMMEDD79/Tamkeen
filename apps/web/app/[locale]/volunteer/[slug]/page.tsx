import { notFound } from 'next/navigation';
import { AppShell, Card, Ltr, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { pathSegment, readPublic, type PublicVolunteerOpportunityDetail } from '../../../../lib/server-api';
import { ReadError } from '../../public-parts';

/**
 * PER-17. One volunteering opportunity.
 *
 * The three things a person needs before giving up their time, and which 07 requires to be stated:
 * what the tasks actually are, that somebody is answerable for them, and how they can stop. The
 * apply button appears only where the server would accept an application.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const result = await readPublic<PublicVolunteerOpportunityDetail>(`/volunteer-opportunities/${pathSegment(slug)}`);
  if (!result.ok) return { title: locale === 'en' ? 'Volunteering — Tamkeen' : 'تطوع — تمكين' };
  return { title: `${result.data.title} — ${result.data.organization.displayName}`, description: result.data.summary.slice(0, 160) };
}

const deliveryLabel = (mode: string, ar: boolean) =>
  mode === 'remote' ? (ar ? 'عن بُعد' : 'Remote') : mode === 'hybrid' ? (ar ? 'مختلط' : 'Hybrid') : (ar ? 'حضوري' : 'In person');

export default async function VolunteerOpportunityPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<PublicVolunteerOpportunityDetail>(`/volunteer-opportunities/${pathSegment(slug)}`);
  if (!result.ok && result.status === 404) notFound();

  return (
    <AppShell locale={locale} path={`/volunteer/${slug}`}>
      {!result.ok ? <ReadError locale={locale} result={result} /> : (() => {
        const opportunity = result.data;
        return (
          <>
            <nav className="tmk-breadcrumbs" aria-label={ar ? 'مسار التصفح' : 'Breadcrumb'}>
              <ol>
                <li><a href={localePath(locale, '/volunteer')}>{ar ? 'التطوع' : 'Volunteering'}</a></li>
                <li><a href={localePath(locale, `/organizations/${opportunity.organization.slug}`)}>{opportunity.organization.displayName}</a></li>
                <li><span aria-current="page">{opportunity.title}</span></li>
              </ol>
            </nav>

            <PageHeader
              eyebrow={`${opportunity.organization.displayName} · ${opportunity.city || opportunity.organization.city}`}
              title={opportunity.title}
              lead={opportunity.summary}
            />

            <p className="tmk-row__actions">
              <StatusBadge tone={opportunity.acceptsApplications ? 'success' : 'neutral'}>
                {opportunity.acceptsApplications ? (ar ? 'التقديم مفتوح' : 'Applications open') : (ar ? 'التقديم موقوف' : 'Applications paused')}
              </StatusBadge>
              {opportunity.organization.verified
                ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified'}</StatusBadge>
                : <StatusBadge tone="neutral">{ar ? 'غير موثقة' : 'Unverified'}</StatusBadge>}
            </p>

            <Notice tone="warning" title={ar ? 'عمل تطوعي غير مدفوع' : 'Unpaid volunteering'}>
              <p style={{ marginBlockEnd: 0 }}>
                {ar
                  ? 'لا أجر ولا بدل ولا عقد عمل، ولا يمنح هذا التطوع أولوية في أي وظيفة. ساعاتك تُسجَّل ويعتمدها شخص آخر من الجهة، ولا تصير مبلغًا مستحقًا.'
                  : 'No wage, no stipend and no employment contract, and it gives no priority in any job. Your hours are recorded and approved by somebody else at the organisation; they do not become money owed.'}
              </p>
            </Notice>

            <Card title={ar ? 'المهام والالتزام' : 'Tasks and commitment'}>
              <dl className="tmk-definitions">
                <div><dt>{ar ? 'مكان العمل' : 'Location'}</dt><dd>{deliveryLabel(opportunity.deliveryMode, ar)}{opportunity.city ? ` — ${opportunity.city}` : ''}</dd></div>
                <div><dt>{ar ? 'ساعات أسبوعية' : 'Hours per week'}</dt><dd><Ltr>{String(opportunity.hoursPerWeek)}</Ltr></dd></div>
                <div>
                  <dt>{ar ? 'الأماكن المتبقية' : 'Places left'}</dt>
                  <dd><Ltr>{String(opportunity.placesLeft)}</Ltr> {ar ? `من ${opportunity.capacity}` : `of ${opportunity.capacity}`}</dd>
                </div>
                {opportunity.startsAt ? <div><dt>{ar ? 'تبدأ' : 'Starts'}</dt><dd>{formatDate(opportunity.startsAt, locale)}</dd></div> : null}
                {opportunity.endsAt ? <div><dt>{ar ? 'تنتهي' : 'Ends'}</dt><dd>{formatDate(opportunity.endsAt, locale)}</dd></div> : null}
              </dl>
              <div className="tmk-prose">
                <h3>{ar ? 'المهام' : 'Tasks'}</h3>
                <p>{opportunity.tasks}</p>
                {opportunity.requirements ? <><h3>{ar ? 'المتطلبات' : 'Requirements'}</h3><p>{opportunity.requirements}</p></> : null}
                <h3>{ar ? 'سياسة الانسحاب' : 'Withdrawal policy'}</h3>
                <p>{opportunity.withdrawalPolicy}</p>
              </div>
              {/* 07: somebody is answerable for a volunteer. The page says there is one without
                  putting a private individual's name on an open page. */}
              <p className="tmk-field__hint">
                {ar
                  ? 'لهذه الفرصة مسؤول معيّن من الجهة يتحمل المسؤولية عن المتطوعين فيها، ويُعرّف بنفسه عند قبول طلبك.'
                  : 'This opportunity has a named supervisor at the organisation who is answerable for its volunteers, and who introduces themselves when your application is accepted.'}
              </p>
            </Card>

            <Card title={ar ? 'التقديم' : 'Applying'}>
              {opportunity.acceptsApplications ? (
                <>
                  <p>
                    {ar
                      ? 'التقديم لا يضعك في مهمة: الجهة تقرر أولًا، ثم تُسند إليك مهمة بعينها، ولا تبدأ قبل أن تقبلها أنت.'
                      : 'Applying does not place you in a task: the organisation decides first, then assigns you a specific task, and nothing begins until you accept it.'}
                  </p>
                  <p className="tmk-row__actions">
                    <a className="tmk-button tmk-button--primary" href={`${localePath(locale, '/app/volunteering')}?opportunity=${encodeURIComponent(opportunity.slug)}`}>
                      {ar ? 'تقدّم للتطوع' : 'Apply to volunteer'}
                    </a>
                    <a className="tmk-button tmk-button--quiet" href={localePath(locale, `/organizations/${opportunity.organization.slug}`)}>
                      {ar ? 'صفحة الجهة' : 'The organisation’s page'}
                    </a>
                  </p>
                </>
              ) : (
                <Notice tone="info" title={ar ? 'التقديم غير متاح الآن' : 'Applications are not open'}>
                  <p style={{ marginBlockEnd: 0 }}>
                    {ar ? 'أوقفت الجهة استقبال الطلبات على هذه الفرصة مؤقتًا.' : 'The organisation has paused applications for this opportunity.'}
                  </p>
                </Notice>
              )}
            </Card>
          </>
        );
      })()}
    </AppShell>
  );
}
