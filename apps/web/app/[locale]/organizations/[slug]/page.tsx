import { notFound } from 'next/navigation';
import { AppShell, Card, EmptyState, Notice, PageHeader, StatusBadge, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { pathSegment, readPublic, type PublicOrganizationProfile, type PublicReportSummary } from '../../../../lib/server-api';
import { OrganizationLogo, ProjectCard, ReadError, organizationPlace, organizationTypeLabel } from '../../public-parts';
import { FollowButton } from '../../follow-button';
import { DownloadButton } from '../../download-button';

/**
 * PUB-05. The profile is built from the public projection, so the legal name, the contact address
 * and every banking detail are absent by construction rather than filtered out here.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const result = await readPublic<PublicOrganizationProfile>(`/organizations/${pathSegment(slug)}/profile`);
  if (!result.ok) return { title: locale === 'en' ? 'Organisation — Tamkeen' : 'جهة — تمكين' };
  return { title: `${result.data.displayName} — ${locale === 'en' ? 'Tamkeen' : 'تمكين'}`, description: result.data.publicDescription || undefined };
}

export default async function OrganizationProfile({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const [result, reports] = await Promise.all([
    readPublic<PublicOrganizationProfile>(`/organizations/${pathSegment(slug)}/profile`),
    readPublic<PublicReportSummary[]>(`/public-reports?organizationSlug=${encodeURIComponent(slug)}`)
  ]);
  if (!result.ok && result.status === 404) notFound();

  return (
    <AppShell locale={locale} path={`/organizations/${slug}`}>
      {!result.ok ? <ReadError locale={locale} result={result} /> : (() => {
        const organization = result.data;
        return (
          <>
            <nav className="tmk-breadcrumbs" aria-label={ar ? 'مسار التصفح' : 'Breadcrumb'}>
              <ol>
                <li><a href={localePath(locale, '/organizations')}>{ar ? 'الجهات' : 'Organisations'}</a></li>
                <li><span aria-current="page">{organization.displayName}</span></li>
              </ol>
            </nav>

            <OrganizationLogo organization={organization} size={112} />
            <PageHeader
              eyebrow={`${organizationTypeLabel(organization.type, locale)} · ${organizationPlace(organization, locale)}`}
              title={organization.displayName}
              lead={organization.publicDescription || (ar ? 'لم تضف هذه الجهة وصفًا عامًا بعد.' : 'This organisation has not added a public description yet.')}
              actions={<><FollowButton subjectType="organization" subjectSlug={organization.slug} label={ar ? 'تابع التحديثات' : 'Follow updates'} /><a className="tmk-button tmk-button--secondary" href={`${localePath(locale, '/explore')}?organization=${encodeURIComponent(organization.slug)}`}>{ar ? 'شاهد كل مشاريعها' : 'See all its projects'}</a></>}
            />

            <p className="tmk-row__actions">
              {organization.verified
                ? <StatusBadge tone="success">{ar ? 'موثقة' : 'Verified'}</StatusBadge>
                : <StatusBadge tone="neutral">{ar ? 'غير موثقة' : 'Not verified'}</StatusBadge>}
              {organization.sectors.map(sector => <StatusBadge key={sector} tone="neutral">{sector}</StatusBadge>)}
            </p>

            {/* 12-SECURITY: a verification badge states what was checked and when, not a guarantee. */}
            {organization.verified ? (
              <Notice tone="info">
                <p style={{ marginBlockEnd: 0 }}>
                  {ar
                    ? 'التوثيق يعني أن مراجعًا مستقلًا فحص مستندات تسجيل هذه الجهة. لا يضمن نجاح أي مشروع ولا يغني عن قراءة تفاصيله.'
                    : 'Verification means an independent reviewer checked this organisation’s registration documents. It does not guarantee any project will succeed, and it is not a substitute for reading the detail.'}
                </p>
              </Notice>
            ) : null}

            {organization.websiteUrl || organization.contactEmail ? (
              <Card title={ar ? 'التواصل' : 'Contact'}>
                {organization.websiteUrl ? <p><a href={organization.websiteUrl} rel="nofollow noreferrer" target="_blank">{organization.websiteUrl}</a></p> : null}
                {organization.contactEmail ? <p><a href={`mailto:${organization.contactEmail}`}>{organization.contactEmail}</a></p> : null}
                <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}>
                  {ar ? 'بيانات تواصل عمل نشرتها الجهة بنفسها.' : 'Business contact details the organisation published itself.'}
                </p>
              </Card>
            ) : null}

            <h2>{ar ? 'المشاريع المنشورة' : 'Published projects'}</h2>
            {organization.projects.length
              ? <div className="tmk-grid tmk-grid--cards">{organization.projects.map(project => <ProjectCard key={project.slug} project={project} locale={locale} />)}</div>
              : <EmptyState title={ar ? 'لا مشاريع منشورة بعد' : 'No published projects yet'}>
                  {ar
                    ? 'قد تكون لدى هذه الجهة مسودات قيد الإعداد. المشروع يظهر هنا بعد أن يعتمده مراجع مستقل.'
                    : 'This organisation may have drafts in preparation. A project appears here once an independent reviewer approves it.'}
                </EmptyState>}

            {reports.ok && reports.data.length ? (
              <Card title={ar ? 'تقارير الأثر المنشورة' : 'Published impact reports'}>
                <div className="tmk-stack">
                  {reports.data.map(report => (
                    <article className="tmk-row" key={report.id}>
                      <div><strong>{report.title}</strong><p className="tmk-field__hint">{report.periodStart ?? '—'} — {report.periodEnd ?? '—'} · {report.currency ?? (ar ? 'بلا عملة' : 'No currency')}</p></div>
                      <DownloadButton endpoint={`/public-reports/${report.id}/download`} label={ar ? 'نزّل التقرير' : 'Download report'} />
                    </article>
                  ))}
                </div>
              </Card>
            ) : null}
          </>
        );
      })()}
    </AppShell>
  );
}
