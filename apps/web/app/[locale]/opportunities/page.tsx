import { notFound } from 'next/navigation';
import { AppShell, Card, EmptyState, Ltr, MoneyAmount, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { readPublic, type PublicJobCard, type PublicProgramCard } from '../../../lib/server-api';
import { ReadError, jobClaimLabel } from '../public-parts';

/**
 * PUB-09. Training programmes.
 *
 * A programme and a job are separate things (07), and this page never blurs them: every programme
 * card states whether the work it mentions is a target or an obligation, and says plainly that
 * finishing the training entitles nobody to a post. PART-11 added the jobs themselves, in their own
 * section, with their own pay line — never folded into a programme's claim about work.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return locale === 'en'
    ? { title: 'Training and work — Tamkeen', description: 'Training programmes from verified operators, with the seats, the schedule and the selection method each one publishes.' }
    : { title: 'التدريب والعمل — تمكين', description: 'برامج تدريب من جهات موثقة، ولكل برنامج مقاعده وجدوله وطريقة مفاضلته المعلنة.' };
}

/** The contract in words, with a fixed term always carrying its length. */
function jobContractLabel(type: string, months: number | null, ar: boolean): string {
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
}

export default async function Opportunities({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<PublicProgramCard[]>('/programs');
  const jobs = await readPublic<PublicJobCard[]>('/jobs');

  return (
    <AppShell locale={locale} path="/opportunities">
      <PageHeader
        eyebrow={ar ? 'التدريب والعمل' : 'Training and work'}
        title={ar ? 'برامج التدريب' : 'Training programmes'}
        lead={ar
          ? 'البرنامج والوظيفة شيئان منفصلان: قبول التدريب ليس قبول وظيفة، وإكمال التدريب لا يعني عرض عمل.'
          : 'A programme and a job are separate: being accepted onto training is not being hired, and completing training does not mean a job offer.'}
      />

      {!result.ok ? <ReadError locale={locale} result={result} /> : result.data.length === 0 ? (
        <EmptyState title={ar ? 'لا برامج مفتوحة الآن' : 'No programmes are open right now'}>
          {ar
            ? 'لا يوجد برنامج بلغ مرحلة النشر. البرنامج لا يظهر هنا قبل أن يعتمده مراجع مستقل وتفتح الجهة المشغّلة التقديم.'
            : 'No programme has reached publication. A programme does not appear here until an independent reviewer has approved it and the operator has opened applications.'}
        </EmptyState>
      ) : (
        <div className="tmk-grid tmk-grid--cards">
          {result.data.map(program => (
            <Card key={program.slug} title={<a href={localePath(locale, `/programs/${program.slug}`)}>{program.title}</a>}>
              <p className="tmk-field__hint">
                {program.organization.displayName} · {program.city || program.organization.city}{' '}
                {program.organization.verified
                  ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified'}</StatusBadge>
                  : <StatusBadge tone="neutral">{ar ? 'غير موثقة' : 'Unverified'}</StatusBadge>}
              </p>
              <dl className="tmk-definitions">
                <div>
                  <dt>{ar ? 'المدة' : 'Duration'}</dt>
                  <dd><Ltr>{String(program.durationWeeks)}</Ltr> {ar ? 'أسبوعًا' : 'weeks'} · <Ltr>{String(program.hoursPerWeek)}</Ltr> {ar ? 'ساعة أسبوعيًا' : 'hrs/week'}</dd>
                </div>
                <div>
                  <dt>{ar ? 'المقاعد' : 'Seats'}</dt>
                  <dd><Ltr>{String(program.capacity)}</Ltr></dd>
                </div>
                <div>
                  {/* The figure 07 exists to stop being read the flattering way. */}
                  <dt>{ar ? 'الوظائف' : 'Jobs'}</dt>
                  <dd>{jobClaimLabel(program, ar)}</dd>
                </div>
                <div>
                  <dt>{ar ? 'يغلق التقديم' : 'Applications close'}</dt>
                  <dd>{program.applyClosesAt ? formatDate(program.applyClosesAt, locale) : '—'}</dd>
                </div>
              </dl>
              {program.skills.length > 0 ? (
                <p className="tmk-field__hint">{ar ? 'المهارات: ' : 'Skills: '}{program.skills.join('، ')}</p>
              ) : null}
              <p className="tmk-row__actions">
                <a className="tmk-button tmk-button--secondary" href={localePath(locale, `/programs/${program.slug}`)}>
                  {ar ? 'اقرأ التفاصيل' : 'Read the details'}
                </a>
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* PUB-11. Jobs, in their own section. A job's pay is stated on its own card, never inferred
          from whatever a programme claimed about work. */}
      <PageHeader
        eyebrow={ar ? 'الوظائف' : 'Jobs'}
        title={ar ? 'وظائف معلنة' : 'Published jobs'}
        lead={ar
          ? 'إعلانات من جهات موثقة. لكل إعلان نوع عقده ومكانه وأجره — أو سبب عدم إعلان الأجر مكتوبًا بنصه.'
          : 'Listings from verified employers. Each one states its contract, its location and its pay — or the employer’s written reason for not publishing it.'}
      />

      {!jobs.ok ? <ReadError locale={locale} result={jobs} /> : jobs.data.length === 0 ? (
        <EmptyState title={ar ? 'لا وظائف معلنة الآن' : 'No jobs are published right now'}>
          {ar
            ? 'لا توجد وظيفة بلغت مرحلة النشر. الوظيفة لا تظهر هنا قبل أن تنشرها جهة موثقة باكتمال ما يقرره المتقدم.'
            : 'No job has reached publication. A job does not appear here until a verified employer publishes it with everything an applicant decides from.'}
        </EmptyState>
      ) : (
        <div className="tmk-grid tmk-grid--cards">
          {jobs.data.map(job => (
            <Card key={job.slug} title={<a href={localePath(locale, `/jobs/${job.slug}`)}>{job.title}</a>}>
              <p className="tmk-field__hint">
                {job.organization.displayName} · {job.city || job.organization.city}{' '}
                {job.organization.verified
                  ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified'}</StatusBadge>
                  : <StatusBadge tone="neutral">{ar ? 'غير موثقة' : 'Unverified'}</StatusBadge>}
              </p>
              <dl className="tmk-definitions">
                <div>
                  <dt>{ar ? 'نوع العقد' : 'Contract'}</dt>
                  <dd>{jobContractLabel(job.contractType, job.contractMonths, ar)}</dd>
                </div>
                <div>
                  <dt>{ar ? 'الشواغر' : 'Openings'}</dt>
                  <dd><Ltr>{String(job.openings)}</Ltr></dd>
                </div>
                <div>
                  {/* Never a blank: either the figures, or the stated reason they are absent. */}
                  <dt>{ar ? 'الأجر' : 'Pay'}</dt>
                  <dd>
                    {job.salaryDisclosed && job.salaryMinMinor && job.salaryCurrency
                      ? (
                        <>
                          <MoneyAmount minor={job.salaryMinMinor} currency={job.salaryCurrency} locale={locale} />
                          {job.salaryMaxMinor && job.salaryMaxMinor !== job.salaryMinMinor
                            ? <> — <MoneyAmount minor={job.salaryMaxMinor} currency={job.salaryCurrency} locale={locale} /></>
                            : null}
                          {job.salaryPeriod ? <> {job.salaryPeriod}</> : null}
                        </>
                      )
                      : <span className="tmk-field__hint">{ar ? 'غير معلن — ' : 'Not disclosed — '}{job.salaryUndisclosedReason}</span>}
                  </dd>
                </div>
                <div>
                  <dt>{ar ? 'آخر موعد' : 'Closes'}</dt>
                  <dd>{job.closesAt ? formatDate(job.closesAt, locale) : '—'}</dd>
                </div>
              </dl>
              {job.skills.length > 0 ? (
                <p className="tmk-field__hint">{ar ? 'المهارات: ' : 'Skills: '}{job.skills.join('، ')}</p>
              ) : null}
              <p className="tmk-row__actions">
                <a className="tmk-button tmk-button--secondary" href={localePath(locale, `/jobs/${job.slug}`)}>
                  {ar ? 'اقرأ التفاصيل' : 'Read the details'}
                </a>
              </p>
            </Card>
          ))}
        </div>
      )}

      {/* 00-MASTER-PROMPT: the reason stands where the missing section would be. */}
      <Card title={ar ? 'التطوع' : 'Volunteering'}>
        <Notice tone="info" title={ar ? 'غير متاح في هذه النسخة' : 'Not available in this build'}>
          <p style={{ marginBlockEnd: 0 }}>
            {ar
              ? 'فرص التطوع لم تُبنَ بعد. لا تبويب فارغ يوحي بأنها موجودة ولا نتائج فيها.'
              : 'Volunteering opportunities have not been built. There is no empty tab implying they exist but returned nothing.'}
          </p>
        </Notice>
      </Card>

      <nav className="tmk-inline-links">
        <a href={localePath(locale, '/app/career/profile')}>{ar ? 'ملف المهارات' : 'Your skills profile'}</a>
        <a href={localePath(locale, '/app/jobs')}>{ar ? 'طلباتي على الوظائف' : 'Your job applications'}</a>
        <a href={localePath(locale, '/explore')}>{ar ? 'استكشف المشاريع المنشورة' : 'Explore published projects'}</a>
        <a href={localePath(locale, '/about')}>{ar ? 'عن تمكين وحدود النسخة' : 'About Tamkeen and this build’s limits'}</a>
      </nav>
    </AppShell>
  );
}
