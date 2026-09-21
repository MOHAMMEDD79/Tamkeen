import { notFound } from 'next/navigation';
import { AppShell, Card, DataTable, EmptyState, MoneyAmount, Notice, ProgressWithLabel, StatusBadge, Stat, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { pathSegment, readPublic, type PublicContributor, type PublicProjectDetail } from '../../../../lib/server-api';
import { ReadError, cityName, stateLabel, trackLabel } from '../../public-parts';
import { FollowButton } from '../../follow-button';
import { coverFor } from '../../../../lib/site-content';
import { PageHero } from '../../marketing';

/** PUB-06. A project that is not published returns 404: absence, not a forbidden page. */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const result = await readPublic<PublicProjectDetail>(`/projects/${pathSegment(slug)}`);
  if (!result.ok) return { title: locale === 'en' ? 'Project — Tamkeen' : 'مشروع — تمكين' };
  // The public title and summary only; nothing here may come from a private field.
  return { title: `${result.data.title} — ${result.data.organization.displayName}`, description: result.data.summary };
}

export default async function ProjectPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const [result, contributors] = await Promise.all([
    readPublic<PublicProjectDetail>(`/projects/${pathSegment(slug)}`),
    readPublic<PublicContributor[]>(`/projects/${pathSegment(slug)}/contributors`)
  ]);

  if (!result.ok && result.status === 404) notFound();

  return (
    <AppShell locale={locale} path={`/projects/${slug}`}
      lead={result.ok ? (
        <PageHero image={coverFor(result.data)} kicker={`${trackLabel(result.data.type, locale)} · ${cityName(result.data.location, locale)} · ${result.data.organization.displayName}`} title={result.data.title} lead={result.data.summary}>
          <div className="tmk-carousel__actions" style={{ marginBlockStart: 24 }}>
            <FollowButton subjectType="project" subjectSlug={result.data.slug} label={ar ? 'تابع التحديثات' : 'Follow updates'} />
          </div>
        </PageHero>
      ) : undefined}>
      {!result.ok ? <ReadError locale={locale} result={result} /> : (() => {
        const project = result.data;
        return (
          <>
            <nav className="tmk-breadcrumbs" aria-label={ar ? 'مسار التصفح' : 'Breadcrumb'}>
              <ol>
                <li><a href={localePath(locale, '/explore')}>{ar ? 'استكشف' : 'Explore'}</a></li>
                <li><a href={localePath(locale, `/organizations/${project.organization.slug}`)}>{project.organization.displayName}</a></li>
                <li><span aria-current="page">{project.title}</span></li>
              </ol>
            </nav>

            <p className="tmk-row__actions">
              <StatusBadge tone={project.state === 'completed' ? 'success' : project.state === 'paused' ? 'warning' : 'info'}>
                {stateLabel(project.state, locale)}
              </StatusBadge>
              {project.organization.verified
                ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified organisation'}</StatusBadge>
                : <StatusBadge tone="neutral">{ar ? 'جهة غير موثقة' : 'Unverified organisation'}</StatusBadge>}
              {project.publishedAt ? <StatusBadge tone="neutral">{ar ? 'نُشر' : 'Published'} {formatDate(project.publishedAt, locale)}</StatusBadge> : null}
            </p>

            {/* PUB-06 funding. No false CTA and no invented number: a project with no campaign
                says exactly that, and a closed one keeps its figures while refusing money. */}
            {!project.funding.available ? (
              <Notice tone="info" title={ar ? 'لا توجد حملة تمويل لهذا المشروع' : 'This project has no funding campaign'}>
                <p style={{ marginBlockEnd: 0 }}>
                  {ar
                    ? 'لم تفتح الجهة حملة تمويل لهذا المشروع، فلا يوجد هدف ولا مبلغ محقق يُعرض. هذا ليس صفرًا: لا يوجد مصدر رقم أصلًا.'
                    : 'The organisation has not opened a funding campaign for this project, so there is no goal and no raised figure to show. That is not a zero — there is no source for a number at all.'}
                </p>
              </Notice>
            ) : (
              <Card title={ar ? 'التمويل' : 'Funding'} id="funding">
                <ProgressWithLabel
                  id="project-funding"
                  label={ar ? 'نسبة ما تحقق من هدف الحملة' : 'Share of the campaign goal raised'}
                  valueNow={project.funding.percentOfGoal}
                  valueMax={100}
                  startText={<MoneyAmount minor={project.funding.raisedMinor} currency={project.funding.currency} locale={locale} label={ar ? 'المحقق المؤكد' : 'Confirmed raised'} />}
                  endText={<MoneyAmount minor={project.funding.goalMinor} currency={project.funding.currency} locale={locale} label={ar ? 'الهدف' : 'Goal'} />}
                />
                <div className="tmk-grid tmk-grid--stats" style={{ marginBlockStart: 'var(--tmk-space-24)' }}>
                  <Stat
                    label={ar ? 'المحقق المؤكد' : 'Confirmed raised'}
                    value={<MoneyAmount minor={project.funding.raisedMinor} currency={project.funding.currency} locale={locale} />}
                    note={ar ? 'مساهمات مؤكدة بعد خصم أي استرداد مؤكد' : 'Confirmed contributions, less any confirmed refunds'}
                  />
                  <Stat
                    label={ar ? 'المتبقي للهدف' : 'Remaining to the goal'}
                    value={<MoneyAmount minor={project.funding.remainingMinor} currency={project.funding.currency} locale={locale} />}
                    note={ar ? 'ليس رصيدًا متاحًا للإنفاق' : 'Not a balance available to spend'}
                  />
                  <Stat
                    label={ar ? 'عدد المساهمات' : 'Contributions'}
                    value={String(project.funding.contributionCount)}
                    note={ar ? 'مساهمات لا مساهمين: قد يساهم الشخص أكثر من مرة' : 'Contributions, not contributors: one person may give more than once'}
                  />
                  <Stat
                    label={ar ? 'تنتهي الحملة' : 'Campaign ends'}
                    value={formatDate(project.funding.endsAt, locale)}
                    note={project.funding.policy === 'all_or_nothing'
                      ? (ar ? 'الكل أو لا شيء: إن لم يبلغ الهدف تُرد المساهمات' : 'All or nothing: contributions are refunded if the goal is missed')
                      : (ar ? 'تمويل مرن: يُنفذ جزئيًا وفق ميزانية مرحلية' : 'Flexible funding: delivered in stages against a staged budget')}
                  />
                </div>

                {/* 00-MASTER-PROMPT: a simulated figure is never presented as a real one. */}
                <Notice tone="warning" title={ar ? 'بيئة عرض — لا أموال حقيقية' : 'Demonstration build — no real money'}>
                  <p style={{ marginBlockEnd: 0 }}>
                    {ar
                      ? 'لا يوجد مزود دفع حقيقي في هذه النسخة. كل مبلغ معروض هنا نتج عن مسار دفع محاكى، ولم تنتقل أي أموال فعلية.'
                      : 'There is no real payment provider in this build. Every figure here came from a simulated payment path, and no actual money moved.'}
                  </p>
                </Notice>

                <p className="tmk-row__actions">
                  {project.funding.acceptsContributions ? (
                    <a className="tmk-button tmk-button--primary" href={localePath(locale, `/checkout/${project.slug}`)}>
                      {ar ? 'ساهم الآن' : 'Contribute now'}
                    </a>
                  ) : (
                    // 00-MASTER-PROMPT forbids a control that does nothing: the reason is stated
                    // in place of the button rather than behind a click that fails.
                    <StatusBadge tone="neutral">
                      {ar ? 'هذا المشروع لا يقبل مساهمات الآن' : 'This project is not accepting contributions right now'}
                    </StatusBadge>
                  )}
                </p>
              </Card>
            )}

            {/* PUB-06 contributors. Built from the API's allowlisted projection: a name appears
                only where the contributor chose to be named, an amount only where they also
                consented to publishing it. */}
            {project.funding.available ? (
              <Card title={ar ? 'المساهمون' : 'Contributors'}>
                {!contributors.ok ? (
                  <Notice tone="warning" title={ar ? 'تعذّر عرض قائمة المساهمين' : 'The contributor list could not be shown'}>
                    <p style={{ marginBlockEnd: 0 }}>
                      {ar ? 'فشلت قراءة القائمة. أرقام التمويل أعلاه غير متأثرة. المرجع: ' : 'Reading the list failed. The funding figures above are unaffected. Reference: '}
                      <code>{contributors.requestId}</code>
                    </p>
                  </Notice>
                ) : contributors.data.length === 0 ? (
                  <EmptyState title={ar ? 'لا مساهمات مؤكدة بعد' : 'No confirmed contributions yet'}>
                    {ar
                      ? 'لم تُؤكَّد أي مساهمة حتى الآن. المساهمة قيد الدفع لا تظهر هنا قبل تأكيد المزود.'
                      : 'No contribution has been confirmed yet. A contribution still in checkout does not appear here until the provider confirms it.'}
                  </EmptyState>
                ) : (
                  <DataTable
                    caption={ar ? 'المساهمون المؤكدون، وفق ما اختاره كل منهم للنشر' : 'Confirmed contributors, as each of them chose to publish'}
                    rows={contributors.data}
                    rowKey={row => row.id}
                    columns={[
                      {
                        key: 'contributor',
                        header: ar ? 'المساهم' : 'Contributor',
                        cell: row => row.anonymous
                          ? <span className="tmk-field__hint">{ar ? 'مساهم اختار عدم الإفصاح' : 'A contributor who chose not to be named'}</span>
                          : (row.name ?? <span className="tmk-field__hint">{ar ? 'بدون اسم معروض' : 'No name shown'}</span>)
                      },
                      {
                        key: 'amount', numeric: true,
                        header: ar ? 'المبلغ' : 'Amount',
                        cell: row => row.amountMinor
                          ? <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} />
                          : <span className="tmk-field__hint">{ar ? 'غير معروض باختيار المساهم' : 'Not published, by the contributor\u2019s choice'}</span>
                      },
                      { key: 'confirmedAt', header: ar ? 'تاريخ التأكيد' : 'Confirmed', cell: row => row.confirmedAt ? formatDate(row.confirmedAt, locale) : '\u2014' }
                    ]}
                    emptyState={null}
                  />
                )}
              </Card>
            ) : null}

            {project.story ? (
              <Card title={ar ? 'عن المشروع' : 'About this project'}>
                <div className="tmk-prose">{project.story.split('\n').filter(Boolean).map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>
              </Card>
            ) : null}

            <Card title={ar ? 'الجهة المنفذة والمكان' : 'Delivering organisation and location'}>
              <article className="tmk-row">
                <div>
                  <strong><a href={localePath(locale, `/organizations/${project.organization.slug}`)}>{project.organization.displayName}</a></strong>
                  <p className="tmk-field__hint">{project.organization.type} · {project.organization.city}</p>
                </div>
                <div className="tmk-row__actions">
                  <a className="tmk-button tmk-button--secondary" href={`${localePath(locale, '/explore')}?organization=${encodeURIComponent(project.organization.slug)}`}>
                    {ar ? 'مشاريع هذه الجهة' : 'Projects by this organisation'}
                  </a>
                </div>
              </article>
              <article className="tmk-row">
                <div>
                  <strong>{cityName(project.location, locale)}</strong>
                  <p className="tmk-field__hint">
                    {/* 12-SECURITY: the precision itself is stated, so nobody reads a city pin as an address. */}
                    {project.location.precision === 'city'
                      ? (ar ? 'الموقع المعلن على مستوى المدينة فقط.' : 'The published location is at city level only.')
                      : project.location.precision === 'approximate'
                        ? (ar ? 'موقع تقريبي ضمن نطاق نحو كيلومتر.' : 'An approximate location, accurate to about a kilometre.')
                        : (ar ? 'موقع منشأة عامة محدد.' : 'A specific public facility location.')}
                  </p>
                </div>
                <div className="tmk-row__actions">
                  <a className="tmk-button tmk-button--secondary" href={`${localePath(locale, '/map')}?q=${encodeURIComponent(project.title)}`}>{ar ? 'على الخريطة' : 'On the map'}</a>
                </div>
              </article>
            </Card>
          </>
        );
      })()}
    </AppShell>
  );
}
