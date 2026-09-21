import { notFound } from 'next/navigation';
import { AppShell, Card, Ltr, MoneyAmount, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { pathSegment, readPublic, type PublicJobDetail } from '../../../../lib/server-api';
import { ReadError } from '../../public-parts';

/**
 * PUB-11. One job.
 *
 * Three things this page is built to avoid:
 *  - **A pay line that says nothing.** Either the figures are here, or the employer's stated reason
 *    for not publishing them is — never a blank.
 *  - **A programme reading as a promise.** Where the job came out of training, the link is shown
 *    and immediately qualified: that programme did not promise this job to anybody.
 *  - **An apply button the server would refuse.** It appears only where an application would
 *    actually be accepted, and the reason it is missing stands in its place.
 *
 * No candidate data of any kind reaches this page. The projection it reads is built field by field.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const result = await readPublic<PublicJobDetail>(`/jobs/${pathSegment(slug)}`);
  if (!result.ok) return { title: locale === 'en' ? 'Job — Tamkeen' : 'وظيفة — تمكين' };
  return { title: `${result.data.title} — ${result.data.organization.displayName}`, description: result.data.summary.slice(0, 160) };
}

const contractLabel = (type: string, months: number | null, ar: boolean): string => {
  const labels: Record<string, { ar: string; en: string }> = {
    full_time: { ar: 'دوام كامل', en: 'Full time' },
    part_time: { ar: 'دوام جزئي', en: 'Part time' },
    fixed_term: { ar: 'عقد محدد المدة', en: 'Fixed term' },
    apprenticeship: { ar: 'تدرّج مهني', en: 'Apprenticeship' },
    temporary: { ar: 'مؤقت', en: 'Temporary' }
  };
  const label = labels[type];
  const base = label ? (ar ? label.ar : label.en) : type;
  if (type !== 'fixed_term' || !months) return base;
  return ar ? `${base} — ${months} شهرًا` : `${base} — ${months} months`;
};

const deliveryLabel = (mode: string, ar: boolean) =>
  mode === 'remote' ? (ar ? 'عن بُعد' : 'Remote') : mode === 'hybrid' ? (ar ? 'مختلط' : 'Hybrid') : (ar ? 'حضوري' : 'In person');

/** Why applications are not open, in the reader's language. An unknown code is shown, not dropped. */
function closedReason(code: string, ar: boolean): string {
  const reasons: Record<string, { ar: string; en: string }> = {
    paused: { ar: 'أوقفت الجهة استقبال الطلبات مؤقتًا.', en: 'The employer has paused applications.' },
    filled: { ar: 'شُغلت الوظيفة.', en: 'The job has been filled.' },
    not_open: { ar: 'الوظيفة ليست مفتوحة للتقديم.', en: 'The job is not open for applications.' },
    deadline_passed: { ar: 'مضى الموعد النهائي للتقديم.', en: 'The application deadline has passed.' }
  };
  const reason = reasons[code];
  if (reason) return ar ? reason.ar : reason.en;
  return ar ? `التقديم غير متاح (${code}).` : `Applications are unavailable (${code}).`;
}

/** Pay, or the employer's stated reason there is none on the page. Never a blank line. */
function Pay({ job, locale, ar }: { job: PublicJobDetail; locale: Locale; ar: boolean }) {
  if (!job.salaryDisclosed) {
    return (
      <>
        <span>{ar ? 'غير معلن' : 'Not disclosed'}</span>
        <span className="tmk-field__hint">
          {ar ? 'السبب المعلن من الجهة: ' : 'The employer’s stated reason: '}{job.salaryUndisclosedReason}
        </span>
      </>
    );
  }
  const min = job.salaryMinMinor && job.salaryCurrency
    ? <MoneyAmount minor={job.salaryMinMinor} currency={job.salaryCurrency} locale={locale} />
    : null;
  const max = job.salaryMaxMinor && job.salaryCurrency && job.salaryMaxMinor !== job.salaryMinMinor
    ? <MoneyAmount minor={job.salaryMaxMinor} currency={job.salaryCurrency} locale={locale} />
    : null;
  // No slash: in RTL a Latin separator lands at the far left of the line and orphans the period.
  return <>{min}{max ? <> — {max}</> : null}{job.salaryPeriod ? <> {job.salaryPeriod}</> : null}</>;
}

export default async function JobPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<PublicJobDetail>(`/jobs/${pathSegment(slug)}`);
  if (!result.ok && result.status === 404) notFound();

  return (
    <AppShell locale={locale} path={`/jobs/${slug}`}>
      {!result.ok ? <ReadError locale={locale} result={result} /> : (() => {
        const job = result.data;
        return (
          <>
            <nav className="tmk-breadcrumbs" aria-label={ar ? 'مسار التصفح' : 'Breadcrumb'}>
              <ol>
                <li><a href={localePath(locale, '/opportunities')}>{ar ? 'التدريب والعمل' : 'Training and work'}</a></li>
                <li><a href={localePath(locale, `/organizations/${job.organization.slug}`)}>{job.organization.displayName}</a></li>
                <li><span aria-current="page">{job.title}</span></li>
              </ol>
            </nav>

            <PageHeader
              eyebrow={`${job.organization.displayName} · ${job.city || job.organization.city}`}
              title={job.title}
              lead={job.summary}
            />

            <p className="tmk-row__actions">
              <StatusBadge tone={job.acceptsApplications ? 'success' : 'neutral'}>
                {job.acceptsApplications ? (ar ? 'التقديم مفتوح' : 'Applications open') : (ar ? 'التقديم مغلق' : 'Applications closed')}
              </StatusBadge>
              {job.organization.verified
                ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified employer'}</StatusBadge>
                : <StatusBadge tone="neutral">{ar ? 'جهة غير موثقة' : 'Unverified employer'}</StatusBadge>}
            </p>

            <Card title={ar ? 'الشروط' : 'Terms'}>
              <dl className="tmk-definitions">
                <div><dt>{ar ? 'نوع العقد' : 'Contract'}</dt><dd>{contractLabel(job.contractType, job.contractMonths, ar)}</dd></div>
                <div><dt>{ar ? 'مكان العمل' : 'Location'}</dt><dd>{deliveryLabel(job.deliveryMode, ar)}{job.city ? ` — ${job.city}` : ''}</dd></div>
                <div><dt>{ar ? 'ساعات أسبوعية' : 'Hours per week'}</dt><dd><Ltr>{String(job.hoursPerWeek)}</Ltr></dd></div>
                <div><dt>{ar ? 'عدد الشواغر' : 'Openings'}</dt><dd><Ltr>{String(job.openings)}</Ltr></dd></div>
                {/* 07: pay is stated or its absence is explained. This line is never empty. */}
                <div><dt>{ar ? 'الأجر' : 'Pay'}</dt><dd><Pay job={job} locale={locale} ar={ar} /></dd></div>
                <div><dt>{ar ? 'آخر موعد للتقديم' : 'Applications close'}</dt><dd>{job.closesAt ? formatDate(job.closesAt, locale, true) : '—'}</dd></div>
              </dl>
              {job.skills.length > 0 ? (
                <p className="tmk-field__hint">{ar ? 'المهارات المطلوبة: ' : 'Skills required: '}{job.skills.join('، ')}</p>
              ) : null}
            </Card>

            {job.responsibilities || job.requirements ? (
              <Card title={ar ? 'المهام والمتطلبات' : 'Responsibilities and requirements'}>
                <div className="tmk-prose">
                  {job.responsibilities ? <><h3>{ar ? 'المهام' : 'Responsibilities'}</h3><p>{job.responsibilities}</p></> : null}
                  {job.requirements ? <><h3>{ar ? 'المتطلبات' : 'Requirements'}</h3><p>{job.requirements}</p></> : null}
                </div>
              </Card>
            ) : null}

            {/* 07's stage limit, at the one place a reader would otherwise draw the wrong line
                between a programme and the work that came out of it. */}
            {job.program ? (
              <Notice tone="warning" title={ar ? 'هذه الوظيفة ليست وعدًا من البرنامج' : 'This job is not a promise from the programme'}>
                <p style={{ marginBlockEnd: 0 }}>
                  {ar
                    ? 'أعلنت الجهة أن هذه الوظيفة خرجت من برنامج '
                    : 'The employer states that this job came out of the programme '}
                  <a href={localePath(locale, `/programs/${job.program.slug}`)}>{job.program.title}</a>
                  {ar
                    ? '. الالتحاق بالبرنامج أو إكماله لا يمنح أحدًا حقًا في هذه الوظيفة، والتقديم عليها مسار مستقل تمامًا.'
                    : '. Joining or completing that programme entitles nobody to this job, and applying for it is an entirely separate process.'}
                </p>
              </Notice>
            ) : null}

            {/* 00-MASTER-PROMPT: the button appears only where the server would accept it. */}
            <Card title={ar ? 'التقديم' : 'Applying'}>
              {job.acceptsApplications ? (
                <>
                  <p>
                    {ar
                      ? 'لا يُرسل شيء عنك إلى صاحب العمل قبل أن توافق صراحة على مشاركة ملف مهاراتك معه، والموافقة لهذه الجهة وحدها وقابلة للسحب.'
                      : 'Nothing about you reaches the employer until you explicitly agree to share your skills profile with them. The consent is for this employer alone and can be withdrawn.'}
                  </p>
                  <p className="tmk-row__actions">
                    <a className="tmk-button tmk-button--primary" href={`${localePath(locale, '/app/applications/new')}?job=${encodeURIComponent(job.slug)}`}>
                      {ar ? 'تقدّم للوظيفة' : 'Apply for this job'}
                    </a>
                    <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/app/career/profile')}>
                      {ar ? 'ملف المهارات' : 'Your skills profile'}
                    </a>
                  </p>
                </>
              ) : (
                <Notice tone="info" title={ar ? 'التقديم غير متاح الآن' : 'Applications are not open'}>
                  <p style={{ marginBlockEnd: 0 }}>{closedReason(job.applicationsUnavailableReason, ar)}</p>
                </Notice>
              )}
            </Card>

            {/* PUB-11.A02 and A03. One is a plain link anybody can copy; the other needs a support
                queue that has not been built, so the page says where a complaint can actually go
                instead of offering a button that would reach nobody. */}
            <Card title={ar ? 'المشاركة والإبلاغ' : 'Sharing and reporting'}>
              <p className="tmk-field__hint">
                {ar ? 'رابط هذه الوظيفة: ' : 'This job’s link: '}
                <Ltr>{`/${locale}/jobs/${job.slug}`}</Ltr>
                {ar ? ' — لا يحمل أي بيانات عن متقدم.' : ' — it carries no applicant data.'}
              </p>
              <Notice tone="info" title={ar ? 'الإبلاغ عن إعلان غير سليم' : 'Reporting a listing'}>
                <p style={{ marginBlockEnd: 0 }}>
                  {ar
                    ? 'يفتح البلاغ تذكرة خاصة في طابور الدعم. لا يغيّر الإعلان أو حالة التقديم مباشرة، ويمكنك متابعة الرد من حسابك.'
                    : 'A report opens a private ticket in the support queue. It does not directly change the listing or an application, and you can follow the response from your account.'}
                </p>
              </Notice>
              <p className="tmk-row__actions">
                <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/contact')}>
                  {ar ? 'أبلغ الدعم' : 'Report to support'}
                </a>
                <a className="tmk-button tmk-button--quiet" href={localePath(locale, `/organizations/${job.organization.slug}`)}>
                  {ar ? 'صفحة الجهة' : 'The employer’s page'}
                </a>
              </p>
            </Card>
          </>
        );
      })()}
    </AppShell>
  );
}
