import { notFound } from 'next/navigation';
import { AppShell, Card, Ltr, MoneyAmount, Notice, PageHeader, StatusBadge, formatDate, isLocale, localePath, type Locale } from '@tamkeen/ui';
import { pathSegment, readPublic, type PublicProgramDetail } from '../../../../lib/server-api';
import { ReadError, jobClaimLabel } from '../../public-parts';

/**
 * PUB-10. One programme, with everything 07 says a candidate must be able to read *before* they
 * apply: the seats, the schedule, the attendance rule, how people are chosen, what happens if they
 * withdraw, and who to complain to.
 *
 * The page refuses three things that would mislead a reader:
 *  - it never states a number of jobs without saying which kind of claim it is;
 *  - it says in words that finishing the training entitles nobody to a post;
 *  - it offers an apply button only where the server would actually accept an application.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale, slug } = await params;
  const result = await readPublic<PublicProgramDetail>(`/programs/${pathSegment(slug)}`);
  if (!result.ok) return { title: locale === 'en' ? 'Programme — Tamkeen' : 'برنامج — تمكين' };
  return { title: `${result.data.title} — ${result.data.organization.displayName}`, description: result.data.summary.slice(0, 160) };
}

/** Why applications are not open, in the reader's language. An unknown code is shown, not dropped. */
function closedReason(code: string, ar: boolean): string {
  const reasons: Record<string, { ar: string; en: string }> = {
    paused: { ar: 'البرنامج موقوف مؤقتًا.', en: 'The programme is paused.' },
    selection_in_progress: { ar: 'أُغلق التقديم وبدأت مرحلة الاختيار.', en: 'Applications have closed and selection has begun.' },
    programme_started: { ar: 'بدأ البرنامج فعلًا.', en: 'The programme has already started.' },
    not_open: { ar: 'لم يُفتح التقديم لهذا البرنامج.', en: 'Applications have not opened for this programme.' },
    not_open_yet: { ar: 'لم يحن موعد فتح التقديم بعد.', en: 'Applications have not opened yet.' },
    deadline_passed: { ar: 'مضى الموعد النهائي للتقديم.', en: 'The application deadline has passed.' }
  };
  const reason = reasons[code];
  if (reason) return ar ? reason.ar : reason.en;
  return ar ? `التقديم غير متاح (${code}).` : `Applications are unavailable (${code}).`;
}

export default async function ProgramPage({ params }: { params: Promise<{ locale: string; slug: string }> }) {
  const { locale: raw, slug } = await params;
  if (!isLocale(raw)) notFound();
  const locale = raw satisfies Locale;
  const ar = locale === 'ar';
  const result = await readPublic<PublicProgramDetail>(`/programs/${pathSegment(slug)}`);
  if (!result.ok && result.status === 404) notFound();

  return (
    <AppShell locale={locale} path={`/programs/${slug}`}>
      {!result.ok ? <ReadError locale={locale} result={result} /> : (() => {
        const program = result.data;
        return (
          <>
            <nav className="tmk-breadcrumbs" aria-label={ar ? 'مسار التصفح' : 'Breadcrumb'}>
              <ol>
                <li><a href={localePath(locale, '/opportunities')}>{ar ? 'التدريب والعمل' : 'Training and work'}</a></li>
                <li><a href={localePath(locale, `/organizations/${program.organization.slug}`)}>{program.organization.displayName}</a></li>
                <li><span aria-current="page">{program.title}</span></li>
              </ol>
            </nav>

            <PageHeader
              eyebrow={`${program.organization.displayName} · ${program.city || program.organization.city}`}
              title={program.title}
              lead={program.summary}
            />

            <p className="tmk-row__actions">
              <StatusBadge tone={program.acceptsApplications ? 'success' : 'neutral'}>
                {program.acceptsApplications ? (ar ? 'التقديم مفتوح' : 'Applications open') : (ar ? 'التقديم مغلق' : 'Applications closed')}
              </StatusBadge>
              {program.organization.verified
                ? <StatusBadge tone="success">{ar ? 'جهة موثقة' : 'Verified operator'}</StatusBadge>
                : <StatusBadge tone="neutral">{ar ? 'جهة غير موثقة' : 'Unverified operator'}</StatusBadge>}
            </p>

            {/* 07: the claim about work, stated as what it is before anybody reads anything else. */}
            <Notice tone={program.jobCommitmentKind === 'committed' ? 'info' : 'warning'} title={ar ? 'التدريب ليس توظيفًا' : 'Training is not employment'}>
              <p>
                {ar
                  ? 'قبولك في التدريب ليس قبولًا لوظيفة، وإكمال البرنامج لا يمنحك حقًا في وظيفة.'
                  : 'Being accepted onto this training is not being hired, and completing it gives you no entitlement to a job.'}
              </p>
              <p style={{ marginBlockEnd: 0 }}>
                <strong>{ar ? 'ما يعلنه البرنامج: ' : 'What this programme states: '}</strong>
                {jobClaimLabel(program, ar)}
                {program.jobCommitmentTerms ? ` — ${program.jobCommitmentTerms}` : ''}
              </p>
            </Notice>

            <Card title={ar ? 'الشروط والمقاعد' : 'Terms and seats'}>
              <dl className="tmk-definitions">
                <div><dt>{ar ? 'المقاعد' : 'Seats'}</dt><dd><Ltr>{String(program.capacity)}</Ltr></dd></div>
                <div><dt>{ar ? 'المدة' : 'Duration'}</dt><dd><Ltr>{String(program.durationWeeks)}</Ltr> {ar ? 'أسبوعًا' : 'weeks'}</dd></div>
                <div><dt>{ar ? 'الساعات أسبوعيًا' : 'Hours per week'}</dt><dd><Ltr>{String(program.hoursPerWeek)}</Ltr></dd></div>
                <div><dt>{ar ? 'نمط التقديم' : 'Delivery'}</dt><dd>{program.deliveryMode === 'remote' ? (ar ? 'عن بعد' : 'Remote') : program.deliveryMode === 'hybrid' ? (ar ? 'مختلط' : 'Hybrid') : (ar ? 'حضوري' : 'In person')}</dd></div>
                <div><dt>{ar ? 'يغلق التقديم' : 'Applications close'}</dt><dd>{program.applyClosesAt ? formatDate(program.applyClosesAt, locale, true) : '—'}</dd></div>
                <div>
                  <dt>{ar ? 'شروط العمر' : 'Age'}</dt>
                  <dd>{program.minimumAge || program.maximumAge ? <Ltr>{`${program.minimumAge ?? '—'}–${program.maximumAge ?? '—'}`}</Ltr> : (ar ? 'لا شرط' : 'No requirement')}</dd>
                </div>
              </dl>
              {program.educationRequirement ? <p className="tmk-field__hint">{ar ? 'التعليم: ' : 'Education: '}{program.educationRequirement}</p> : null}
              {program.skills.length > 0 ? <p className="tmk-field__hint">{ar ? 'المهارات المستهدفة: ' : 'Skills taught: '}{program.skills.join('، ')}</p> : null}
            </Card>

            {program.cohorts.length > 0 ? (
              <Card title={ar ? 'الدفعات' : 'Cohorts'}>
                <ul>
                  {program.cohorts.map(cohort => (
                    <li key={cohort.id}>
                      <strong>{cohort.name}</strong> — {formatDate(cohort.startAt, locale)} → {formatDate(cohort.endAt, locale)}{' '}
                      (<Ltr>{cohort.timezone}</Ltr>) · {ar ? 'المقاعد المتبقية: ' : 'Seats left: '}<Ltr>{String(cohort.seatsRemaining)}</Ltr>
                    </li>
                  ))}
                </ul>
              </Card>
            ) : null}

            {/* Every mandatory disclosure in 07, on the page a person decides from. */}
            <Card title={ar ? 'ما يجب أن تعرفه قبل التقديم' : 'What you need to know before applying'}>
              <div className="tmk-prose">
                <h3>{ar ? 'كيف يُختار المتقدمون' : 'How applicants are selected'}</h3>
                <p>{program.selectionMethod}</p>
                <h3>{ar ? 'سياسة الحضور' : 'Attendance policy'}</h3>
                <p>{program.attendancePolicy}</p>
                <h3>{ar ? 'التقييم' : 'Assessment'}</h3>
                <p>{program.assessmentPolicy}</p>
                <h3>{ar ? 'الانسحاب' : 'Withdrawal'}</h3>
                <p>{program.withdrawalPolicy}</p>
                {program.schedule ? <><h3>{ar ? 'الجدول' : 'Schedule'}</h3><p>{program.schedule}</p></> : null}
                {program.accessibilityNote ? <><h3>{ar ? 'ترتيبات الإتاحة' : 'Accessibility'}</h3><p>{program.accessibilityNote}</p></> : null}
                {program.privacyNote ? <><h3>{ar ? 'الخصوصية' : 'Privacy'}</h3><p>{program.privacyNote}</p></> : null}
              </div>
              {program.complaintsContact ? (
                <p className="tmk-field__hint">{ar ? 'مسؤول الشكاوى: ' : 'Complaints contact: '}<bdi>{program.complaintsContact}</bdi></p>
              ) : null}
            </Card>

            <Card title={ar ? 'البدل' : 'Stipend'}>
              {program.stipendOffered ? (
                <>
                  <p>
                    {ar ? 'يعلن البرنامج بدلًا قدره ' : 'This programme advertises a stipend of '}
                    {program.stipendAmountMinor && program.stipendCurrency
                      ? <MoneyAmount minor={program.stipendAmountMinor} currency={program.stipendCurrency} locale={locale} />
                      : '—'}
                    {program.stipendConditions ? ` — ${program.stipendConditions}` : ''}
                  </p>
                  <Notice tone="warning" title={ar ? 'لا يُصرف في هذه النسخة' : 'Not paid in this build'}>
                    <p style={{ marginBlockEnd: 0 }}>
                      {ar
                        ? 'البدل معلن هنا لتقرأه قبل التقديم، ولم يُبنَ صرفه بعد. لا يُدفع أي مبلغ من هذه النسخة.'
                        : 'The stipend is stated here so you can read it before applying. Paying one has not been built, and no money is paid by this build.'}
                    </p>
                  </Notice>
                </>
              ) : (
                <p>{ar ? 'لا يعلن هذا البرنامج بدلًا.' : 'This programme advertises no stipend.'}</p>
              )}
            </Card>

            {/* 00-MASTER-PROMPT: the button appears only where the server would accept it. */}
            <Card title={ar ? 'التقديم' : 'Applying'}>
              {program.acceptsApplications ? (
                <>
                  <p>
                    {ar
                      ? 'التقديم مسودة أولًا: تملأ ما تستطيع وتحفظه، ثم ترسله. لا يُرسل شيء عنك إلى الجهة المشغّلة قبل أن توافق صراحة على مشاركة ملفك.'
                      : 'An application starts as a draft: fill in what you can, save it, then submit. Nothing about you reaches the operator until you explicitly agree to share your profile.'}
                  </p>
                  <p className="tmk-row__actions">
                    <a className="tmk-button tmk-button--primary" href={`${localePath(locale, '/app/applications/new')}?program=${encodeURIComponent(program.slug)}`}>
                      {ar ? 'ابدأ التقديم' : 'Start an application'}
                    </a>
                    <a className="tmk-button tmk-button--secondary" href={localePath(locale, '/app/career/profile')}>
                      {ar ? 'ملف المهارات' : 'Your skills profile'}
                    </a>
                  </p>
                </>
              ) : (
                <Notice tone="info" title={ar ? 'التقديم غير متاح الآن' : 'Applications are not open'}>
                  <p style={{ marginBlockEnd: 0 }}>{closedReason(program.applicationsUnavailableReason, ar)}</p>
                </Notice>
              )}
              <p className="tmk-field__hint">
                {ar
                  ? 'حفظ البرنامج في قائمتك لا يُنشئ طلبًا، والتقديم لا يحجز مقعدًا: المقعد يُمنح بقرار ثم تقبله أنت خلال مهلة.'
                  : 'Saving a programme creates no application, and applying reserves no seat: a seat is granted by a decision and then accepted by you within a deadline.'}
              </p>
            </Card>
          </>
        );
      })()}
    </AppShell>
  );
}
