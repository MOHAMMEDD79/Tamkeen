'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Notice, PageHeader,
  Skeleton, StatusBadge, formatDate, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * PART-11, the candidate's side: applying for a job, answering a referral, reading an offer, and
 * the placement that follows.
 *
 * Three things these screens must never let somebody misread, because each one is about whether a
 * person has work:
 *
 *  - **Accepting an offer is not starting a job.** The acceptance screen says so before the button
 *    and again after it, and the placement it creates is shown as "waiting to start", never as
 *    employment. That is JOB-01, and the server enforces it too.
 *  - **A follow-up nobody answered is `unknown`.** The screen offers "I did not want to answer" as
 *    a real choice with the same weight as the others, because a form that only accepts good news
 *    produces only good news.
 *  - **A referral shares nothing until the person agrees.** The invitation says, in words, that the
 *    employer has not been told anything about them yet.
 */

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown) => {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'include',
    headers: body ? { 'content-type': 'application/json' } : {},
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new UnauthenticatedError('unauthenticated');
  if (!response.ok) throw new Error(message(payload?.error?.code, response.status));
  return payload.data;
};

/**
 * Error wording written for the person in front of the screen.
 *
 * `conflict` covers several different situations here, so it names them rather than saying "the
 * state changed": a candidate who has just been refused needs to know whether the deadline passed,
 * the offer was withdrawn, or they are simply looking at a stale page.
 */
function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء.',
    not_found: 'المورد غير موجود، أو ليس لك.',
    conflict: 'تغيّرت الحالة: قد تكون مهلة الرد على العرض انتهت، أو سُحب العرض، أو لم يحن موعد نقطة المتابعة بعد، أو النسخة التي بين يديك قديمة. أعد التحميل واقرأ ما تغيّر.',
    invalid_input: 'تحقق من الحقول: التاريخ يجب أن يكون يومًا مضى لا يومًا قادمًا، وكل نتيجة عدا «لا أعرف» تحتاج مصدرًا.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const jobApplicationStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  submitted: { text: 'أُرسل', tone: 'info' },
  screening: { text: 'قيد الفرز', tone: 'info' },
  shortlisted: { text: 'ضمن القائمة القصيرة', tone: 'info' },
  interview: { text: 'مقابلة', tone: 'warning' },
  offered: { text: 'وصلك عرض', tone: 'success' },
  hired: { text: 'قبلتَ العرض — لم يبدأ العمل بعد', tone: 'success' },
  rejected: { text: 'غير مقبول', tone: 'danger' },
  withdrawn: { text: 'مسحوب', tone: 'neutral' }
};

const offerStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة لدى الجهة', tone: 'neutral' },
  sent: { text: 'بانتظار ردك', tone: 'warning' },
  accepted: { text: 'قبلتَه', tone: 'success' },
  declined: { text: 'رفضتَه', tone: 'neutral' },
  withdrawn: { text: 'سحبته الجهة', tone: 'danger' },
  expired: { text: 'انتهت مهلته دون رد', tone: 'neutral' }
};

/** The distance between `start_pending` and `started` is the whole of JOB-01, so it is spelled out. */
const placementStates: Record<string, { text: string; tone: Tone }> = {
  start_pending: { text: 'بانتظار تأكيد بدء العمل', tone: 'warning' },
  started: { text: 'بدأ العمل — مؤكَّد', tone: 'success' },
  retained: { text: 'مستمر بعد ٩٠ يومًا', tone: 'success' },
  ended: { text: 'انتهى', tone: 'neutral' },
  disputed: { text: 'محل خلاف — بانتظار مراجعة', tone: 'danger' },
  offered: { text: 'عرض', tone: 'info' },
  accepted: { text: 'مقبول', tone: 'info' }
};

const followupResults: Record<string, { text: string; tone: Tone }> = {
  working: { text: 'ما زال على رأس العمل', tone: 'success' },
  ended: { text: 'انتهى العمل', tone: 'neutral' },
  unknown: { text: 'لا جواب — غير معروف', tone: 'warning' },
  disputed: { text: 'محل خلاف', tone: 'danger' }
};

const contractTypes: Record<string, string> = {
  full_time: 'دوام كامل',
  part_time: 'دوام جزئي',
  fixed_term: 'عقد محدد المدة',
  apprenticeship: 'تدرّج مهني',
  temporary: 'مؤقت'
};

const deliveryModes: Record<string, string> = { in_person: 'حضوري', remote: 'عن بُعد', hybrid: 'مختلط' };

/** Repeated wherever somebody might read an accepted offer as a job already begun. */
function AcceptanceIsNotAStart({ children }: { children?: ReactNode }) {
  return (
    <Notice tone="warning" title="قبول العرض ليس بدء العمل">
      <p style={{ marginBlockEnd: 0 }}>
        {children ?? 'قبولك يعني أنك وافقت على الشروط. لا يُحتسب بدء العمل إلا بتاريخ فعلي يؤكده الطرفان — أنت وجهة العمل — أو بقرار مراجعة مستند إلى دليل. حتى ذلك الحين حالتك «بانتظار تأكيد البدء»، ولا تُعدّ في أي رقم توظيف.'}
      </p>
    </Notice>
  );
}

const money = (minor: string | null, currency: string | null) =>
  minor === null || currency === null ? null : `${(Number(minor) / 100).toLocaleString('ar', { minimumFractionDigits: 2 })} ${currency}`;

/** Pay, or the stated reason there is none on the page. Never an empty line. */
function Pay({ job }: { job: { salaryDisclosed: boolean; salaryMinMinor: string | null; salaryMaxMinor: string | null; salaryCurrency: string | null; salaryPeriod: string; salaryUndisclosedReason: string } }) {
  if (!job.salaryDisclosed) {
    return <span className="tmk-field__hint">الأجر غير معلن. السبب المعلن: {job.salaryUndisclosedReason}</span>;
  }
  const min = money(job.salaryMinMinor, job.salaryCurrency);
  const max = money(job.salaryMaxMinor, job.salaryCurrency);
  // The period is a word after the amount, not a Latin `/` that an RTL line would strand.
  return <span>{max && max !== min ? `${min} — ${max}` : min}{job.salaryPeriod ? ` ${job.salaryPeriod}` : ''}</span>;
}

// ---------------------------------------------------------------------------------------------
// PUB-11.A01 — applying for a job
// ---------------------------------------------------------------------------------------------

interface PublicJob {
  id: string; slug: string; title: string; summary: string; requirements: string;
  contractType: string; deliveryMode: string; city: string; closesAt: string | null;
  acceptsApplications: boolean; applicationsUnavailableReason: string;
  organization: { displayName: string };
  salaryDisclosed: boolean; salaryMinMinor: string | null; salaryMaxMinor: string | null;
  salaryCurrency: string | null; salaryPeriod: string; salaryUndisclosedReason: string;
}

const unavailableReasons: Record<string, string> = {
  paused: 'أوقفت الجهة استقبال الطلبات مؤقتًا.',
  filled: 'شُغلت الوظيفة.',
  not_open: 'الوظيفة ليست مفتوحة للتقديم.',
  deadline_passed: 'مضى الموعد النهائي للتقديم.'
};

/**
 * The job application form (PUB-11.A01, reached at /app/applications/new?job=…).
 *
 * The consent is part of the same submission rather than a separate later step: without it the
 * employer receives nothing and the candidacy cannot be assessed, so asking afterwards would be
 * asking about something already sent.
 */
export function JobApplicationForm({ locale, jobSlug }: { locale: Locale; jobSlug: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [job, setJob] = useState<PublicJob | null>(null);
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const loaded = await api(`/jobs/${encodeURIComponent(jobSlug)}`) as PublicJob;
        const profile = await api('/me/candidate-profile') as { exists: boolean };
        if (!active) return;
        setJob(loaded);
        setProfileReady(profile.exists);
      } catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل الوظيفة.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [jobSlug]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !job) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      const draft = await api('/job-applications', 'POST', { jobId: job.id, coverNote: String(form.get('coverNote') ?? '') }) as { id: string; version: number };
      await api(`/job-applications/${draft.id}/submit`, 'POST', { sharingConsent: true, version: draft.version });
      setDone('أُرسل طلبك. ستجده في «وظائفي» مع كل تحديث يطرأ عليه.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال الطلب.');
    } finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path="/app/applications/new" signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app/jobs')}>وظائفي</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(`${L('/app/applications/new')}?job=${jobSlug}`)}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!job) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);
  if (done) {
    return shell(
      <EmptyState title="أُرسل الطلب" action={<a className="tmk-button tmk-button--primary" href={L('/app/jobs')}>وظائفي</a>}>
        {done}
      </EmptyState>
    );
  }

  return shell(
    <>
      <PageHeader dashboard eyebrow={job.organization.displayName} title={`التقديم على: ${job.title}`}
        lead="التقديم على وظيفة مسار مستقل عن التدريب: القبول في برنامج تدريبي لا يعني قبولًا هنا، ولا العكس." />

      {!job.acceptsApplications ? (
        <Notice tone="warning" title="التقديم غير متاح">
          <p style={{ marginBlockEnd: 0 }}>{unavailableReasons[job.applicationsUnavailableReason] ?? 'التقديم غير متاح الآن.'}</p>
        </Notice>
      ) : null}

      {profileReady === false ? (
        <Notice tone="warning" title="ملف المهارات مطلوب قبل الإرسال">
          <p style={{ marginBlockEnd: 0 }}>
            لا يستلم صاحب العمل شيئًا عنك سوى ما في ملف مهاراتك. أنشئه أولًا، وإلا فليس في الطلب ما يُقيَّم.
          </p>
          <p className="tmk-row__actions">
            <a className="tmk-button tmk-button--secondary" href={L('/app/career/profile')}>املأ ملف المهارات</a>
          </p>
        </Notice>
      ) : null}

      <Card title="الوظيفة">
        <dl className="tmk-definitions">
          <div><dt>نوع العقد</dt><dd>{contractTypes[job.contractType] ?? job.contractType}</dd></div>
          <div><dt>مكان العمل</dt><dd>{deliveryModes[job.deliveryMode] ?? job.deliveryMode}{job.city ? ` — ${job.city}` : ''}</dd></div>
          <div><dt>الأجر</dt><dd><Pay job={job} /></dd></div>
          <div><dt>آخر موعد</dt><dd>{job.closesAt ? formatDate(job.closesAt, locale) : '—'}</dd></div>
        </dl>
        <p>{job.requirements}</p>
      </Card>

      <Card title="طلبك">
        <form onSubmit={event => void submit(event)}>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="coverNote">لماذا أنت مناسب لهذه الوظيفة؟</label>
            <span className="tmk-field__hint" id="cover-hint">اختياري، لكنه ما يقرؤه صاحب العمل قبل ملفك.</span>
            <textarea id="coverNote" name="coverNote" className="tmk-field__control" rows={6} maxLength={4000} aria-describedby="cover-hint" />
          </div>

          <Notice tone="info" title="ما الذي سيصل صاحب العمل">
            <p style={{ marginBlockEnd: 0 }}>
              بإرسال الطلب توافق على مشاركة ملف مهاراتك مع هذه الجهة وحدها. بدون هذه الموافقة لا يصلها عنك شيء ولا يمكن تقييم طلبك.
              يمكنك سحب المشاركة لاحقًا من ملف المهارات، وعندها يختفي عن كل الجهات فورًا بما فيها طلبات قائمة.
            </p>
          </Notice>

          <p className="tmk-row__actions">
            <button type="submit" className="tmk-button tmk-button--primary" disabled={busy || !job.acceptsApplications || profileReady === false}>
              أرسل الطلب وأوافق على مشاركة ملفي
            </button>
            <a className="tmk-button tmk-button--quiet" href={L(`/jobs/${job.slug}`)}>عد إلى الوظيفة</a>
          </p>
        </form>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-14 — the candidate's job candidacies, referrals and placements
// ---------------------------------------------------------------------------------------------

interface MyJobApplication {
  id: string; reference: string; state: string; submittedAt: string | null; withdrawnReason: string;
  version: number; jobSlug: string; jobTitle: string; employer: string;
  interviews: Array<{ id: string; scheduledAt: string; timezone: string; mode: string; location: string; state: string; version: number }>;
  latestOffer: { id: string; sequence: number; state: string; respondByAt: string } | null;
}

interface MyReferral {
  id: string; note: string; version: number; profileShared: boolean; referredBy: string;
  job: { slug: string; title: string; state: string; employer: string };
}

interface MyPlacement {
  id: string; state: string; proposedStartDate: string; actualStartDate: string | null;
  startConfirmed: boolean; countsAsEmployment: boolean; version: number;
  confirmedByMe: boolean; confirmedByEmployer: boolean; disputeReason: string; endReason: string;
  job: { slug: string; title: string; city: string; employer: string };
  followups: Array<{ id: string; dayOffset: number; dueAt: string; result: string; source: string; answered: boolean; due: boolean; version: number }>;
}

export function MyJobs({ locale }: { locale: Locale }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [applications, setApplications] = useState<MyJobApplication[] | null>(null);
  const [referrals, setReferrals] = useState<MyReferral[]>([]);
  const [placements, setPlacements] = useState<MyPlacement[]>([]);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [apps, refs, places] = await Promise.all([
      api('/me/job-applications') as Promise<MyJobApplication[]>,
      api('/me/job-referrals') as Promise<MyReferral[]>,
      api('/me/placements') as Promise<MyPlacement[]>
    ]);
    setApplications(apps); setReferrals(refs); setPlacements(places);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر التحميل.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const act = async (run: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await run(); await load(); setNotice(success); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path="/app/jobs" signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L('/app/jobs'))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!applications) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  return shell(
    <>
      <PageHeader dashboard title="وظائفي" lead="طلباتك على الوظائف، والترشيحات التي تنتظر موافقتك، وأي عمل بدأته عبر المنصة." />

      {/* PRG-07.A05 from the candidate's side. Nothing about them has been sent yet, and the card
          says so before offering the choice — otherwise "agree" reads as a formality. */}
      {referrals.length ? (
        <Card title="ترشيحات تنتظر موافقتك">
          <Notice tone="info" title="لم يصل صاحب العمل شيء عنك بعد">
            <p style={{ marginBlockEnd: 0 }}>
              رشّحك أحدهم لوظيفة، لكن ملفك لم يُشارك. بموافقتك يُنشأ طلب باسمك ويصل ملف مهاراتك إلى الجهة. برفضك لا يصلها شيء وينتهي الأمر.
            </p>
          </Notice>
          {referrals.map(referral => (
            <div key={referral.id} className="tmk-row">
              <div>
                <strong>{referral.job.title}</strong>
                <span className="tmk-field__hint"> — {referral.job.employer} · رشّحك: {referral.referredBy}</span>
                {referral.note ? <p>{referral.note}</p> : null}
              </div>
              <p className="tmk-row__actions">
                <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                  onClick={() => void act(async () => { await api(`/job-referrals/${referral.id}/response`, 'POST', { accept: true, version: referral.version }); }, 'وافقت على الترشيح، وأُنشئ طلب باسمك وشورك ملفك مع هذه الجهة.')}>
                  أوافق وأشارك ملفي
                </button>
                <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                  onClick={() => void act(async () => { await api(`/job-referrals/${referral.id}/response`, 'POST', { accept: false, version: referral.version }); }, 'رفضت الترشيح. لم يصل الجهة شيء عنك.')}>
                  أرفض
                </button>
                <a className="tmk-button tmk-button--quiet" href={L(`/jobs/${referral.job.slug}`)}>اقرأ الوظيفة</a>
              </p>
            </div>
          ))}
        </Card>
      ) : null}

      <Card title="طلباتي على الوظائف">
        <DataTable
          caption="طلبات الوظائف"
          rows={applications}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا طلبات بعد" action={<a className="tmk-button tmk-button--primary" href={L('/opportunities')}>تصفّح الفرص</a>}>لم تتقدم إلى وظيفة حتى الآن.</EmptyState>}
          columns={[
            { key: 'job', header: 'الوظيفة', cell: row => <a href={L(`/jobs/${row.jobSlug}`)}>{row.jobTitle}</a> },
            { key: 'employer', header: 'الجهة', cell: row => row.employer },
            { key: 'reference', header: 'المرجع', cell: row => row.reference },
            {
              key: 'state', header: 'الحالة', cell: row => (
                <>
                  <StatusBadge tone={jobApplicationStates[row.state]?.tone ?? 'neutral'}>{jobApplicationStates[row.state]?.text ?? row.state}</StatusBadge>
                  {row.state === 'rejected' && row.withdrawnReason ? <span className="tmk-field__hint">{row.withdrawnReason}</span> : null}
                </>
              )
            },
            {
              key: 'interview', header: 'المقابلة', cell: row => {
                const next = row.interviews.find(interview => interview.state === 'proposed' || interview.state === 'confirmed');
                if (!next) return <span className="tmk-field__hint">—</span>;
                return (
                  <>
                    <span>{formatDate(next.scheduledAt, locale)} ({next.timezone})</span>
                    <span className="tmk-field__hint">{deliveryModes[next.mode] ?? next.mode}{next.location ? ` — ${next.location}` : ''}</span>
                    {next.state === 'proposed' ? (
                      <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                        onClick={() => void act(async () => { await api(`/interviews/${next.id}/confirm`, 'POST', { version: next.version }); }, 'أكّدت حضورك للمقابلة.')}>
                        أكّد الحضور
                      </button>
                    ) : null}
                  </>
                );
              }
            },
            {
              key: 'offer', header: 'العرض', cell: row => row.latestOffer
                ? (
                  <>
                    <StatusBadge tone={offerStates[row.latestOffer.state]?.tone ?? 'neutral'}>{offerStates[row.latestOffer.state]?.text ?? row.latestOffer.state}</StatusBadge>
                    <a className="tmk-button tmk-button--quiet" href={L(`/app/job-offers/${row.latestOffer.id}`)}>اقرأ العرض</a>
                  </>
                )
                : <span className="tmk-field__hint">—</span>
            }
          ]}
        />
      </Card>

      <Card title="أعمالي عبر المنصة">
        {placements.length ? (
          <DataTable
            caption="التوظيف والمتابعة"
            rows={placements}
            rowKey={row => row.id}
            emptyState={<EmptyState title="لا شيء بعد">لم تقبل عرضًا حتى الآن.</EmptyState>}
            columns={[
              { key: 'job', header: 'الوظيفة', cell: row => <a href={L(`/app/placements/${row.id}`)}>{row.job.title}</a> },
              { key: 'employer', header: 'الجهة', cell: row => row.job.employer },
              { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={placementStates[row.state]?.tone ?? 'neutral'}>{placementStates[row.state]?.text ?? row.state}</StatusBadge> },
              {
                key: 'start', header: 'تاريخ البدء', cell: row => row.actualStartDate
                  ? <span>{formatDate(row.actualStartDate, locale)} <span className="tmk-field__hint">(فعلي ومؤكد)</span></span>
                  : <span className="tmk-field__hint">مقترح: {formatDate(row.proposedStartDate, locale)} — لم يُؤكد بعد</span>
              },
              {
                key: 'due', header: 'متابعة مستحقة', numeric: true,
                cell: row => row.followups.filter(followup => followup.due).length || <span className="tmk-field__hint">—</span>
              }
            ]}
          />
        ) : (
          <EmptyState title="لا شيء بعد">لم تقبل عرض عمل حتى الآن.</EmptyState>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-14.A01 / A02 — one offer
// ---------------------------------------------------------------------------------------------

interface OfferDetail {
  id: string; sequence: number; state: string; title: string; terms: string;
  contractType: string; contractMonths: number | null; salaryMinor: string | null;
  salaryCurrency: string | null; salaryPeriod: string; proposedStartDate: string;
  respondByAt: string; termsChecksum: string; declineReason: string; withdrawReason: string;
  version: number;
  job: { slug: string; title: string; city: string; deliveryMode: string; employer: string };
  applicationReference: string;
  canRespond: boolean; respondUnavailableReason: string;
  placement: { id: string; state: string } | null;
}

const respondUnavailable: Record<string, string> = {
  deadline_passed: 'انتهت مهلة الرد على هذا العرض.',
  offer_accepted: 'قبلتَ هذا العرض.',
  offer_declined: 'رفضتَ هذا العرض.',
  offer_withdrawn: 'سحبت الجهة هذا العرض.',
  offer_expired: 'انتهت مهلة العرض دون رد.',
  offer_draft: 'هذا العرض لم يُرسل بعد.'
};

export function JobOfferScreen({ locale, offerId }: { locale: Locale; offerId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [offer, setOffer] = useState<OfferDetail | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [accepted, setAccepted] = useState<{ placementId: string } | null>(null);
  const [declining, setDeclining] = useState(false);

  const load = useCallback(async () => setOffer(await api(`/job-offers/${offerId}`) as OfferDetail), [offerId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل العرض.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const accept = async () => {
    if (busy || !offer) return;
    setBusy(true); setError('');
    try {
      // The checksum is quoted back, so a candidate can only accept the text they were shown.
      const result = await api(`/job-offers/${offer.id}/accept`, 'POST', { termsChecksum: offer.termsChecksum, version: offer.version }) as { placement: { id: string } };
      setAccepted({ placementId: result.placement.id });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر قبول العرض.');
    } finally { setBusy(false); }
  };

  const decline = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !offer) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      await api(`/job-offers/${offer.id}/decline`, 'POST', { reason: String(form.get('reason') ?? ''), version: offer.version });
      setDeclining(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر رفض العرض.');
    } finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/app/job-offers/${offerId}`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app/jobs')}>وظائفي</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={8} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/app/job-offers/${offerId}`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!offer) return shell(<ErrorState title="العرض غير موجود">قد يكون العرض ليس لك، أو لم يُرسل بعد.</ErrorState>);

  return shell(
    <>
      <PageHeader dashboard eyebrow={offer.job.employer} title={offer.title}
        actions={<StatusBadge tone={offerStates[offer.state]?.tone ?? 'neutral'}>{offerStates[offer.state]?.text ?? offer.state}</StatusBadge>}
        lead={`النسخة رقم ${offer.sequence} من العرض على طلبك ${offer.applicationReference}. أي تعديل من الجهة يصلك كنسخة جديدة برقم جديد، فما تقرؤه هنا هو بالضبط ما ستوافق عليه.`} />

      {accepted ? (
        <Notice tone="success" title="قبلتَ العرض — ولم يبدأ العمل بعد" live="polite">
          <p>
            سُجِّل قبولك. حالتك الآن «بانتظار تأكيد بدء العمل»: لا يُحتسب بدء العمل حتى تؤكد أنت وجهة العمل التاريخ الفعلي نفسه.
          </p>
          <p className="tmk-row__actions">
            <a className="tmk-button tmk-button--primary" href={L(`/app/placements/${accepted.placementId}`)}>افتح صفحة العمل وأكّد البدء لاحقًا</a>
          </p>
        </Notice>
      ) : null}

      <Card title="الشروط">
        <dl className="tmk-definitions">
          <div><dt>الوظيفة</dt><dd>{offer.job.title} — {offer.job.employer}</dd></div>
          <div><dt>نوع العقد</dt><dd>{contractTypes[offer.contractType] ?? offer.contractType}{offer.contractMonths ? ` — ${offer.contractMonths} شهرًا` : ''}</dd></div>
          <div><dt>مكان العمل</dt><dd>{deliveryModes[offer.job.deliveryMode] ?? offer.job.deliveryMode}{offer.job.city ? ` — ${offer.job.city}` : ''}</dd></div>
          <div><dt>الأجر</dt><dd>{money(offer.salaryMinor, offer.salaryCurrency) ?? <span className="tmk-field__hint">غير مذكور في هذا العرض</span>}{offer.salaryPeriod ? ` ${offer.salaryPeriod}` : ''}</dd></div>
          <div><dt>تاريخ البدء المقترح</dt><dd>{formatDate(offer.proposedStartDate, locale)}</dd></div>
          <div><dt>آخر موعد للرد</dt><dd>{formatDate(offer.respondByAt, locale)}</dd></div>
        </dl>
        <p style={{ whiteSpace: 'pre-wrap' }}>{offer.terms}</p>
      </Card>

      {offer.state === 'declined' && offer.declineReason ? <Notice tone="neutral" title="رفضتَ هذا العرض"><p style={{ marginBlockEnd: 0 }}>{offer.declineReason}</p></Notice> : null}
      {offer.state === 'withdrawn' && offer.withdrawReason ? <Notice tone="danger" title="سحبت الجهة هذا العرض"><p style={{ marginBlockEnd: 0 }}>{offer.withdrawReason}</p></Notice> : null}

      {offer.canRespond ? (
        <>
          <AcceptanceIsNotAStart />
          <Card title="ردّك">
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void accept()}>
                أقبل هذه الشروط
              </button>
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setDeclining(value => !value)}>
                أرفض العرض
              </button>
            </p>
            {declining ? (
              <form onSubmit={event => void decline(event)}>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="declineReason">سبب الرفض</label>
                  <span className="tmk-field__hint" id="decline-hint">يُحفظ مع قرارك، وتقرؤه الجهة.</span>
                  <textarea id="declineReason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required aria-describedby="decline-hint" />
                </div>
                <p className="tmk-row__actions">
                  <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>أكّد الرفض</button>
                </p>
              </form>
            ) : null}
          </Card>
        </>
      ) : (
        <Notice tone="info" title="لا يمكن الرد على هذا العرض">
          <p style={{ marginBlockEnd: 0 }}>{respondUnavailable[offer.respondUnavailableReason] ?? 'لا يمكن الرد الآن.'}</p>
        </Notice>
      )}

      {offer.placement ? (
        <p className="tmk-row__actions">
          <a className="tmk-button tmk-button--secondary" href={L(`/app/placements/${offer.placement.id}`)}>صفحة العمل والمتابعة</a>
        </p>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-14.A03 / A04 / A05 — one placement
// ---------------------------------------------------------------------------------------------

export function PlacementScreen({ locale, placementId }: { locale: Locale; placementId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [placement, setPlacement] = useState<MyPlacement | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [answering, setAnswering] = useState<number | null>(null);
  const [disputing, setDisputing] = useState(false);

  const load = useCallback(async () => {
    const rows = await api('/me/placements') as MyPlacement[];
    setPlacement(rows.find(row => row.id === placementId) ?? null);
  }, [placementId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر التحميل.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const act = async (run: () => Promise<void>, success: string) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await run(); await load(); setNotice(success); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/app/placements/${placementId}`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app/jobs')}>وظائفي</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={8} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/app/placements/${placementId}`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!placement) return shell(<ErrorState title="غير موجود">هذا العمل ليس لك، أو لم يعد موجودًا.</ErrorState>);

  const today = new Date().toISOString().slice(0, 10);

  return shell(
    <>
      <PageHeader dashboard eyebrow={placement.job.employer} title={placement.job.title}
        actions={<StatusBadge tone={placementStates[placement.state]?.tone ?? 'neutral'}>{placementStates[placement.state]?.text ?? placement.state}</StatusBadge>}
        lead="هذه صفحة العمل نفسه: تأكيد البدء، ثم نقطتا متابعة بعد ٣٠ و٩٠ يومًا من تاريخ البدء الفعلي." />

      <Card title="البدء">
        <dl className="tmk-definitions">
          <div><dt>التاريخ المقترح في العرض</dt><dd>{formatDate(placement.proposedStartDate, locale)}</dd></div>
          <div>
            <dt>التاريخ الفعلي</dt>
            <dd>{placement.actualStartDate ? formatDate(placement.actualStartDate, locale) : <span className="tmk-field__hint">لم يُؤكد بعد</span>}</dd>
          </div>
          <div><dt>أكّدتَ أنت</dt><dd>{placement.confirmedByMe ? 'نعم' : 'لا'}</dd></div>
          <div><dt>أكّدت جهة العمل</dt><dd>{placement.confirmedByEmployer ? 'نعم' : 'لا'}</dd></div>
        </dl>

        {!placement.startConfirmed ? (
          <>
            <AcceptanceIsNotAStart>
              يُحتسب بدء العمل حين تؤكد أنت وجهة العمل التاريخ الفعلي نفسه. إن اختلف التاريخان سُجِّل الأمر خلافًا ولم يُحتسب بدءًا، وتنظر فيه مراجعة مستقلة.
            </AcceptanceIsNotAStart>
            {!placement.confirmedByMe ? (
              <form onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void act(async () => {
                  await api(`/placements/${placement.id}/start-confirmations`, 'POST', {
                    startDate: String(form.get('startDate') ?? ''),
                    evidenceRef: String(form.get('evidenceRef') ?? '')
                  });
                }, 'سُجِّل تأكيدك. إن كانت جهة العمل قد أكدت التاريخ نفسه فقد بدأ العمل رسميًا؛ وإلا فالأمر بانتظارها.');
              }}>
                <div className="tmk-grid tmk-grid--stats">
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="startDate">تاريخ أول يوم عمل فعلي</label>
                    <span className="tmk-field__hint" id="start-hint">يومٌ مضى. لا يُقبل تاريخ في المستقبل.</span>
                    <input id="startDate" name="startDate" type="date" max={today} className="tmk-field__control" required aria-describedby="start-hint" />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="evidenceRef">مرجع الدليل (اختياري)</label>
                    <input id="evidenceRef" name="evidenceRef" className="tmk-field__control" maxLength={200} />
                  </div>
                </div>
                <p className="tmk-row__actions">
                  <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>أكّد بدء العمل</button>
                </p>
              </form>
            ) : (
              <Notice tone="info" title="أكّدتَ من جانبك">
                <p style={{ marginBlockEnd: 0 }}>بقي تأكيد جهة العمل بالتاريخ نفسه. تأكيد طرف واحد ادعاء لا واقعة.</p>
              </Notice>
            )}
          </>
        ) : null}

        {placement.disputeReason ? (
          <Notice tone="danger" title="خلاف مسجّل">
            <p style={{ marginBlockEnd: 0 }}>{placement.disputeReason}</p>
          </Notice>
        ) : null}
      </Card>

      <Card title="المتابعة">
        {placement.followups.length ? (
          <>
            <p className="tmk-field__hint">
              نقاط المتابعة محسوبة من تاريخ البدء الفعلي لا من تاريخ العرض. «لا أعرف» جواب مقبول ومسجَّل كما هو، ولا يُحسب استمرارًا في العمل.
            </p>
            <DataTable
              caption="نقاط المتابعة"
              rows={placement.followups}
              rowKey={row => row.id}
              emptyState={<EmptyState title="لا نقاط متابعة">ستُنشأ عند تأكيد البدء.</EmptyState>}
              columns={[
                { key: 'day', header: 'النقطة', cell: row => `بعد ${row.dayOffset} يومًا` },
                { key: 'due', header: 'تستحق في', cell: row => formatDate(row.dueAt, locale) },
                {
                  key: 'result', header: 'النتيجة', cell: row => (
                    <>
                      <StatusBadge tone={followupResults[row.result]?.tone ?? 'neutral'}>{followupResults[row.result]?.text ?? row.result}</StatusBadge>
                      {row.answered ? <span className="tmk-field__hint">المصدر: {row.source}</span> : <span className="tmk-field__hint">لم يُسجَّل جواب</span>}
                    </>
                  )
                },
                {
                  key: 'action', header: 'الإجراء', cell: row => row.due
                    ? <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setAnswering(answering === row.dayOffset ? null : row.dayOffset)}>أجب</button>
                    : <span className="tmk-field__hint">{row.answered ? 'مُجاب' : 'لم تستحق بعد'}</span>
                }
              ]}
            />
            {answering !== null ? (
              <form onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const followup = placement.followups.find(row => row.dayOffset === answering);
                if (!followup) return;
                const result = String(form.get('result') ?? 'unknown');
                void act(async () => {
                  await api(`/placements/${placement.id}/followups`, 'POST', {
                    dayOffset: answering,
                    result,
                    ...(result === 'unknown' ? {} : { source: String(form.get('source') ?? '') }),
                    note: String(form.get('note') ?? ''),
                    version: followup.version
                  });
                }, result === 'unknown'
                  ? 'سُجِّل أنك لم تجب. تبقى النتيجة «غير معروف»، ولا تُحسب استمرارًا ولا انتهاءً.'
                  : 'سُجِّلت نتيجة المتابعة.');
                setAnswering(null);
              }}>
                <fieldset className="tmk-fieldset">
                  <legend>جوابك عن النقطة بعد {answering} يومًا</legend>
                  <label className="tmk-choice" htmlFor="result-working">
                    <input id="result-working" name="result" type="radio" value="working" defaultChecked />
                    <span>ما زلت على رأس العمل</span>
                  </label>
                  <label className="tmk-choice" htmlFor="result-ended">
                    <input id="result-ended" name="result" type="radio" value="ended" />
                    <span>انتهى عملي هناك</span>
                  </label>
                  {/* JOB-02 on the screen: the same weight as the other two, not a way out. */}
                  <label className="tmk-choice" htmlFor="result-unknown">
                    <input id="result-unknown" name="result" type="radio" value="unknown" />
                    <span>أفضّل ألا أجيب — تُسجَّل النتيجة «غير معروف»</span>
                  </label>
                </fieldset>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="source">مصدر الجواب</label>
                  <span className="tmk-field__hint" id="source-hint">مطلوب لكل جواب عدا «أفضّل ألا أجيب». اكتب مثلًا: إفادة مباشرة مني.</span>
                  <input id="source" name="source" className="tmk-field__control" maxLength={120} aria-describedby="source-hint" />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="note">ملاحظة (اختياري)</label>
                  <textarea id="note" name="note" className="tmk-field__control" rows={2} maxLength={1000} />
                </div>
                <p className="tmk-row__actions">
                  <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>سجّل الجواب</button>
                  <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setAnswering(null)}>إلغاء</button>
                </p>
              </form>
            ) : null}
          </>
        ) : (
          <EmptyState title="لا نقاط متابعة بعد">تُنشأ نقطتا المتابعة بعد تأكيد تاريخ البدء الفعلي، ومنه تُحسب.</EmptyState>
        )}
      </Card>

      {/* PER-14.A05. The shared support queue is PART-13, so this is the placement's own objection
          rather than a ticket — and it does something real: it stops this placement counting
          either way until somebody with review permission looks at it. */}
      <Card title="اعتراض">
        <p className="tmk-field__hint">
          إن كان المسجَّل عن عملك غير صحيح، سجّل اعتراضك هنا. ينتقل العمل إلى حالة «محل خلاف» فلا يُحسب ضمن أي رقم حتى تفصل فيه مراجعة مستقلة.
          صفحة الدعم العامة (PER-15) ليست جزءًا من هذه المرحلة، وهذا الاعتراض لا يمر بها.
        </p>
        {placement.state === 'disputed' ? (
          <Notice tone="info" title="هناك اعتراض قائم">
            <p style={{ marginBlockEnd: 0 }}>سُجِّل الخلاف وهو بانتظار مراجعة. لا يمكن تسجيل اعتراض ثانٍ قبل الفصل في الأول.</p>
          </Notice>
        ) : (
          <>
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setDisputing(value => !value)}>اعترض على ما سُجِّل</button>
            </p>
            {disputing ? (
              <form onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void act(async () => {
                  await api(`/placements/${placement.id}/disputes`, 'POST', { reason: String(form.get('reason') ?? ''), version: placement.version });
                }, 'سُجِّل اعتراضك، وانتقل العمل إلى حالة «محل خلاف» بانتظار مراجعة مستقلة.');
                setDisputing(false);
              }}>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="disputeReason">ما الذي تعترض عليه؟</label>
                  <textarea id="disputeReason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required />
                </div>
                <p className="tmk-row__actions">
                  <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>سجّل الاعتراض</button>
                </p>
              </form>
            ) : null}
          </>
        )}
      </Card>
    </>
  );
}
