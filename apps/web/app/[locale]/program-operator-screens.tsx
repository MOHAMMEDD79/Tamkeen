'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Ltr, Notice, PageHeader,
  Skeleton, Stat, StatusBadge, formatDate, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * PART-10, the operator's side: PRG-01 the dashboard, PRG-02 the editor, PRG-03 screening,
 * PRG-04 the cohort, PRG-05 the register, and the independent programme review.
 *
 * Three things these screens hold to:
 *
 *  - **A claim about work is qualified before it is published.** The editor will not let a number
 *    of jobs stand without saying which kind of claim it is, because the public page would then
 *    print the flattering reading.
 *  - **A candidate's profile appears only where they consented**, and the screen says which of the
 *    two reasons it is missing rather than showing an empty panel.
 *  - **A seat, a decision and a register entry are all recorded as what they are**: a full cohort
 *    refuses an acceptance, a change after close is a revision with a reason, and a dispute goes to
 *    somebody who did not make the record.
 */

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' = 'GET', body?: unknown) => {
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

function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    // Kept general on purpose: this dictionary serves the editor, the screening queue, the cohort,
    // the register and the review, and a message that lists one screen's reasons is wrong on the
    // other four. Each screen writes the reason that applies to it next to the control.
    forbidden: 'لا تملك صلاحية هذا الإجراء على هذا المورد. السبب مكتوب بجانب الإجراء نفسه.',
    not_found: 'المورد غير موجود ضمن نطاق جهتك.',
    conflict: 'تغيّرت الحالة: قد تكون المقاعد امتلأت، أو أُقفل السجل، أو النسخة التي بين يديك قديمة. أعد التحميل واقرأ ما تغيّر.',
    invalid_input: 'تحقق من الحقول: التواريخ بترتيبها وضمن حدود الدفعة، والأسباب والأعذار مطلوبة حيث تُطلب، وعدد الوظائف يحتاج بيان نوعه.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const programStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  review: { text: 'قيد المراجعة المستقلة', tone: 'warning' },
  approved: { text: 'معتمد — لم يُفتح التقديم', tone: 'info' },
  recruiting: { text: 'التقديم مفتوح', tone: 'success' },
  selection: { text: 'مرحلة الاختيار', tone: 'info' },
  active: { text: 'التدريب جارٍ', tone: 'success' },
  completed: { text: 'مكتمل', tone: 'neutral' },
  follow_up: { text: 'مرحلة المتابعة', tone: 'info' },
  closed: { text: 'مغلق', tone: 'neutral' },
  paused: { text: 'موقوف مؤقتًا', tone: 'warning' },
  cancelled: { text: 'ملغى', tone: 'danger' }
};

const applicationStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  submitted: { text: 'أُرسل', tone: 'info' },
  screening: { text: 'قيد الفرز', tone: 'info' },
  shortlisted: { text: 'قائمة قصيرة', tone: 'info' },
  interview: { text: 'مقابلة', tone: 'warning' },
  accepted: { text: 'مقبول', tone: 'success' },
  waitlisted: { text: 'قائمة انتظار', tone: 'warning' },
  rejected: { text: 'غير مقبول', tone: 'danger' },
  withdrawn: { text: 'مسحوب', tone: 'neutral' },
  discarded: { text: 'مسودة ملغاة', tone: 'neutral' }
};

const enrollmentStates: Record<string, { text: string; tone: Tone }> = {
  invited: { text: 'دُعي — لم يقبل بعد', tone: 'warning' },
  confirmed: { text: 'مقعد مؤكَّد', tone: 'success' },
  active: { text: 'متدرب نشط', tone: 'success' },
  completed: { text: 'أكمل', tone: 'success' },
  dropped_out: { text: 'انسحب', tone: 'neutral' },
  terminated: { text: 'أُنهي التحاقه', tone: 'danger' },
  expired: { text: 'انتهت مهلة المقعد', tone: 'neutral' }
};

const sessionStates: Record<string, string> = {
  scheduled: 'مجدولة', held: 'انعقدت', cancelled: 'ملغاة', closed: 'مُقفلة'
};

const attendanceLabels: Record<string, { text: string; tone: Tone }> = {
  present: { text: 'حاضر', tone: 'success' },
  late: { text: 'متأخر', tone: 'warning' },
  excused: { text: 'غياب بعذر', tone: 'info' },
  absent: { text: 'غائب', tone: 'danger' }
};

const blockerLabels: Record<string, string> = {
  summary_too_short: 'الوصف أقصر من أن يقرر أحد على أساسه.',
  attendance_policy_missing: 'سياسة الحضور غير معلنة، ولا يصح أن تظهر بعد أن يلتحق الناس.',
  selection_method_missing: 'طريقة المفاضلة غير معلنة.',
  withdrawal_policy_missing: 'سياسة الانسحاب غير معلنة.',
  assessment_policy_missing: 'آلية التقييم غير معلنة.',
  complaints_contact_missing: 'لا يوجد مسؤول شكاوى معلن.',
  application_deadline_missing: 'لا يوجد موعد نهائي للتقديم.',
  application_deadline_in_past: 'الموعد النهائي للتقديم في الماضي.',
  no_cohort: 'لا توجد دفعة: لا مكان يجلس فيه المقبولون.',
  cohort_seats_below_capacity: 'مجموع مقاعد الدفعات أقل من السعة المعلنة للبرنامج.',
  cohort_starts_in_past: 'إحدى الدفعات تبدأ في الماضي.',
  job_claim_unqualified: 'عدد الوظائف معلن دون بيان أهي مستهدفة أم ملتزم بها.',
  job_commitment_terms_missing: 'الوظائف معلنة كالتزام دون شروط الالتزام.',
  stipend_amount_missing: 'البدل معلن دون مبلغ.'
};

const jobClaim = (program: { jobCommitmentKind: string; jobCount: number }) =>
  program.jobCommitmentKind === 'committed' ? `${program.jobCount} وظيفة ملتزم بها بوثيقة`
    : program.jobCommitmentKind === 'expected' ? `${program.jobCount} وظيفة مستهدفة، غير ملزمة`
    : 'لا وظائف معلنة';

interface ProgramRow {
  id: string; slug: string; title: string; state: string; capacity: number; version: number;
  applyClosesAt: string | null; jobCommitmentKind: string; jobCount: number; jobCommitmentTerms: string;
  completionGuaranteesJob: boolean; stipendOffered: boolean; stipendPayable: boolean;
  cohorts: Array<{ id: string; name: string; capacity: number; seatsTaken: number; seatsRemaining: number; startAt: string; endAt: string; timezone: string; state: string }>;
  applicationCount?: number;
  awaitingDecision?: number;
  readiness?: { ready: boolean; blockers: string[] };
  decisions?: Array<{ id: string; outcome: string; publicReason: string; reviewer: string; at: string }>;
  summary?: string;
  attendancePolicy?: string;
  selectionMethod?: string;
  withdrawalPolicy?: string;
  assessmentPolicy?: string;
  complaintsContact?: string;
  durationWeeks?: number;
  hoursPerWeek?: number;
}

// ---------------------------------------------------------------------------------------------
// PRG-01 / PRG-02 — the operator's programmes
// ---------------------------------------------------------------------------------------------

export function OrgPrograms({ locale, orgId, programId, mode }: { locale: Locale; orgId: string; programId?: string; mode: 'list' | 'new' | 'detail' }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [rows, setRows] = useState<ProgramRow[] | null>(null);
  const [detail, setDetail] = useState<ProgramRow | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (mode === 'detail' && programId) setDetail(await api(`/orgs/${orgId}/programs/${programId}`) as ProgramRow);
    else if (mode === 'list') setRows(await api(`/orgs/${orgId}/programs`) as ProgramRow[]);
  }, [orgId, programId, mode]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر التحميل.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/programs`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/programs`)}>البرامج</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);

  // ---- PRG-02: the editor -------------------------------------------------------------------------
  if (mode === 'new') {
    return shell(
      <>
        <PageHeader dashboard title="برنامج جديد" lead="كل ما يقرره المتقدم قبل أن يتقدم يُكتب هنا. البرنامج يبقى مسودة حتى يعتمده مراجع مستقل، ثم تفتح أنت التقديم." />
        <Notice tone="warning" title="ادعاء الوظائف">
          <p style={{ marginBlockEnd: 0 }}>
            إن أعلنت عددًا من الوظائف فعليك أن تقول أهي مستهدفة أم ملتزم بها بوثيقة. عدد بلا بيان مرفوض من الخادم،
            لأن القارئ سيقرؤه على أفضل احتمال.
          </p>
        </Notice>
        <Card title="الحقول الأساسية">
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              const kind = String(form.get('jobCommitmentKind') ?? 'none');
              const created = await api(`/orgs/${orgId}/programs`, 'POST', {
                title: String(form.get('title') ?? ''),
                summary: String(form.get('summary') ?? ''),
                capacity: Number(form.get('capacity') ?? 0),
                durationWeeks: Number(form.get('durationWeeks') ?? 0),
                hoursPerWeek: Number(form.get('hoursPerWeek') ?? 0),
                city: String(form.get('city') ?? ''),
                skills: String(form.get('skills') ?? '').split(/[,،]/).map(skill => skill.trim()).filter(Boolean),
                applyClosesAt: new Date(String(form.get('applyClosesAt') ?? '')).toISOString(),
                attendancePolicy: String(form.get('attendancePolicy') ?? ''),
                assessmentPolicy: String(form.get('assessmentPolicy') ?? ''),
                selectionMethod: String(form.get('selectionMethod') ?? ''),
                withdrawalPolicy: String(form.get('withdrawalPolicy') ?? ''),
                complaintsContact: String(form.get('complaintsContact') ?? ''),
                jobCommitmentKind: kind,
                jobCount: kind === 'none' ? 0 : Number(form.get('jobCount') ?? 0),
                jobCommitmentTerms: String(form.get('jobCommitmentTerms') ?? '')
              }) as ProgramRow;
              window.location.assign(L(`/org/${orgId}/programs/${created.id}`));
              return 'أُنشئ البرنامج كمسودة.';
            });
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="title">اسم البرنامج</label>
              <input id="title" name="title" className="tmk-field__control" minLength={4} maxLength={200} required />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="summary">الوصف</label>
              <textarea id="summary" name="summary" className="tmk-field__control" rows={4} minLength={50} maxLength={2000} required />
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="capacity">السعة الكلية</label>
                <input id="capacity" name="capacity" type="number" min={1} className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="durationWeeks">المدة (أسابيع)</label>
                <input id="durationWeeks" name="durationWeeks" type="number" min={0} className="tmk-field__control" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="hoursPerWeek">ساعات أسبوعيًا</label>
                <input id="hoursPerWeek" name="hoursPerWeek" type="number" min={0} className="tmk-field__control" />
              </div>
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="city">المدينة</label>
                <input id="city" name="city" className="tmk-field__control" maxLength={100} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="applyClosesAt">آخر موعد للتقديم</label>
                <input id="applyClosesAt" name="applyClosesAt" type="date" className="tmk-field__control" required />
              </div>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="skills">المهارات المستهدفة</label>
              <span className="tmk-field__hint" id="skills-hint">افصل بينها بفاصلة. هذه ما يُفلتر عليه المتقدمون.</span>
              <input id="skills" name="skills" className="tmk-field__control" aria-describedby="skills-hint" />
            </div>

            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="selectionMethod">طريقة المفاضلة</label>
              <textarea id="selectionMethod" name="selectionMethod" className="tmk-field__control" rows={3} minLength={20} maxLength={2000} required />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="attendancePolicy">سياسة الحضور</label>
              <span className="tmk-field__hint" id="attendance-hint">تُعلن قبل أن يتقدم أحد، لا بعد أن يلتحق.</span>
              <textarea id="attendancePolicy" name="attendancePolicy" className="tmk-field__control" rows={3} minLength={20} maxLength={2000} required aria-describedby="attendance-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="assessmentPolicy">آلية التقييم</label>
              <textarea id="assessmentPolicy" name="assessmentPolicy" className="tmk-field__control" rows={3} minLength={20} maxLength={2000} required />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="withdrawalPolicy">سياسة الانسحاب</label>
              <textarea id="withdrawalPolicy" name="withdrawalPolicy" className="tmk-field__control" rows={3} minLength={20} maxLength={2000} required />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="complaintsContact">مسؤول الشكاوى</label>
              <input id="complaintsContact" name="complaintsContact" className="tmk-field__control" maxLength={200} required />
            </div>

            <fieldset className="tmk-fieldset">
              <legend>الوظائف</legend>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="jobCommitmentKind">نوع الادعاء</label>
                <select id="jobCommitmentKind" name="jobCommitmentKind" className="tmk-field__control">
                  <option value="none">لا وظائف معلنة</option>
                  <option value="expected">وظائف مستهدفة — غير ملزمة</option>
                  <option value="committed">وظائف ملتزم بها بوثيقة</option>
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="jobCount">العدد</label>
                <input id="jobCount" name="jobCount" type="number" min={0} className="tmk-field__control" defaultValue={0} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="jobCommitmentTerms">شروط الالتزام</label>
                <span className="tmk-field__hint" id="terms-hint">مطلوبة عند «ملتزم بها»: معاييرها ومتى تتاح.</span>
                <textarea id="jobCommitmentTerms" name="jobCommitmentTerms" className="tmk-field__control" rows={3} maxLength={2000} aria-describedby="terms-hint" />
              </div>
            </fieldset>

            <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>احفظ المسودة</button>
          </form>
        </Card>
      </>
    );
  }

  if (mode === 'detail') {
    if (!detail) return shell(<ErrorState title="غير موجود">هذا البرنامج غير موجود ضمن جهتك.</ErrorState>);
    const state = programStates[detail.state] ?? { text: detail.state, tone: 'neutral' as Tone };
    const blockers = detail.readiness?.blockers ?? [];
    return shell(
      <>
        <PageHeader
          dashboard
          title={detail.title}
          lead="الاعتماد ليس فتحًا للتقديم: المراجع المستقل يجيز، وأنت تقرر متى يُفتح."
          actions={<StatusBadge tone={state.tone}>{state.text}</StatusBadge>}
        />

        <Card title="الجاهزية">
          {blockers.length === 0 ? (
            <p>كل ما يحتاجه المتقدم ليقرر معلن. البرنامج جاهز للإرسال إلى المراجعة.</p>
          ) : (
            <ul>{blockers.map(code => <li key={code}>{blockerLabels[code] ?? code}</li>)}</ul>
          )}
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="السعة" value={<Ltr>{String(detail.capacity)}</Ltr>} />
            <Stat label="الوظائف" value={jobClaim(detail)} note={detail.completionGuaranteesJob ? '' : 'إكمال التدريب لا يمنح حقًا في وظيفة.'} />
            <Stat label="البدل" value={detail.stipendOffered ? 'معلن' : 'غير معلن'} note={detail.stipendPayable ? '' : 'يُصرف عبر دفعات البدلات، دون أموال حقيقية حتى يُربط مزود دفع.'} />
          </div>
          <p className="tmk-row__actions">
            {detail.state === 'draft' ? (
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy || blockers.length > 0}
                onClick={() => void run(async () => {
                  await api(`/orgs/${orgId}/programs/${detail.id}/submit`, 'POST', { version: detail.version });
                  return 'أُرسل للمراجعة المستقلة، وتجمّد التحرير حتى يصدر القرار.';
                })}>
                أرسل للمراجعة
              </button>
            ) : null}
            {['approved', 'paused'].includes(detail.state) ? (
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                onClick={() => void run(async () => {
                  await api(`/orgs/${orgId}/programs/${detail.id}/publish`, 'POST', { version: detail.version });
                  return 'فُتح التقديم. صار البرنامج ظاهرًا للجمهور.';
                })}>
                افتح التقديم
              </button>
            ) : null}
            {detail.state === 'recruiting' ? (
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                onClick={() => void run(async () => {
                  await api(`/orgs/${orgId}/programs/${detail.id}/close-applications`, 'POST', { version: detail.version });
                  return 'أُغلق التقديم. الطلبات القائمة لم تتأثر.';
                })}>
                أغلق التقديم
              </button>
            ) : null}
            <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/applications?program=${detail.id}`)}>الطلبات</a>
            {['recruiting', 'selection', 'active', 'completed', 'follow_up'].includes(detail.state)
              ? <a className="tmk-button tmk-button--quiet" href={L(`/programs/${detail.slug}`)}>الصفحة العامة</a>
              : null}
          </p>
          {detail.state === 'approved' ? (
            <p className="tmk-field__hint">الاعتماد ليس نشرًا: المراجع أجاز، وأنت تقرر متى يُفتح التقديم.</p>
          ) : null}
        </Card>

        <Card title="الدفعات">
          <DataTable
            caption="دفعات هذا البرنامج"
            rows={detail.cohorts}
            rowKey={cohort => cohort.id}
            emptyState={<EmptyState title="لا دفعات">لا يمكن إرسال برنامج بلا دفعة: لا مكان يجلس فيه المقبولون.</EmptyState>}
            columns={[
              { key: 'name', header: 'الدفعة', cell: cohort => cohort.name },
              { key: 'seats', header: 'المقاعد', numeric: true, cell: cohort => <><Ltr>{`${cohort.seatsTaken}/${cohort.capacity}`}</Ltr><span className="tmk-field__hint">متبقٍ {cohort.seatsRemaining}</span></> },
              { key: 'dates', header: 'المدة', cell: cohort => <>{formatDate(cohort.startAt, locale)} → {formatDate(cohort.endAt, locale)}<span className="tmk-field__hint"><Ltr>{cohort.timezone}</Ltr></span></> },
              { key: 'open', header: '', cell: cohort => <a href={L(`/org/${orgId}/cohorts/${cohort.id}`)}>افتح الدفعة</a> }
            ]}
          />
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              await api(`/orgs/${orgId}/programs/${detail.id}/cohorts`, 'POST', {
                name: String(form.get('name') ?? ''),
                capacity: Number(form.get('capacity') ?? 0),
                startAt: new Date(String(form.get('startAt') ?? '')).toISOString(),
                endAt: new Date(String(form.get('endAt') ?? '')).toISOString(),
                acceptanceWindowHours: Number(form.get('acceptanceWindowHours') ?? 72)
              });
              return 'أُضيفت الدفعة.';
            });
          }}>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="cohort-name">اسم الدفعة</label>
                <input id="cohort-name" name="name" className="tmk-field__control" minLength={2} maxLength={140} required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="cohort-capacity">المقاعد</label>
                <input id="cohort-capacity" name="capacity" type="number" min={1} className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="cohort-window">مهلة قبول المقعد (ساعات)</label>
                <span className="tmk-field__hint" id="window-hint">بعدها يتحرر المقعد للتالي في قائمة الانتظار تلقائيًا.</span>
                <input id="cohort-window" name="acceptanceWindowHours" type="number" min={1} max={720} defaultValue={72} className="tmk-field__control" aria-describedby="window-hint" />
              </div>
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="cohort-start">تبدأ</label>
                <input id="cohort-start" name="startAt" type="date" className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="cohort-end">تنتهي</label>
                <input id="cohort-end" name="endAt" type="date" className="tmk-field__control" required />
              </div>
            </div>
            <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>أضف دفعة</button>
          </form>
        </Card>

        {detail.decisions && detail.decisions.length > 0 ? (
          <Card title="قرارات المراجعة">
            <ul>
              {detail.decisions.map(decision => (
                <li key={decision.id}>
                  <strong>{decision.outcome}</strong> — {decision.publicReason || 'دون ملاحظات'} <span className="tmk-field__hint">{decision.reviewer} · {formatDate(decision.at, locale)}</span>
                </li>
              ))}
            </ul>
          </Card>
        ) : null}
      </>
    );
  }

  // ---- PRG-01: the dashboard ----------------------------------------------------------------------
  return shell(
    <>
      <PageHeader
        dashboard
        title="البرامج"
        lead="دفعاتك ومقاعدها وما ينتظر قرارًا بشريًا."
        actions={<a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/programs/new`)}>برنامج جديد</a>}
      />
      <Card title="برامج الجهة">
        <DataTable
          caption="برامج هذه الجهة، أحدثها أولًا"
          rows={rows ?? []}
          rowKey={row => row.id}
          emptyState={
            <EmptyState title="لا برامج بعد" action={<a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/programs/new`)}>أنشئ برنامجًا</a>}>
              البرنامج يبدأ مسودة، ويحتاج مراجعًا مستقلًا قبل أن يُفتح التقديم.
            </EmptyState>
          }
          columns={[
            { key: 'title', header: 'البرنامج', cell: row => <a href={L(`/org/${orgId}/programs/${row.id}`)}>{row.title}</a> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={programStates[row.state]?.tone ?? 'neutral'}>{programStates[row.state]?.text ?? row.state}</StatusBadge> },
            {
              key: 'seats', header: 'المقاعد', numeric: true,
              cell: row => {
                const taken = row.cohorts.reduce((total, cohort) => total + cohort.seatsTaken, 0);
                const seats = row.cohorts.reduce((total, cohort) => total + cohort.capacity, 0);
                return <Ltr>{`${taken}/${seats}`}</Ltr>;
              }
            },
            { key: 'applications', header: 'الطلبات', numeric: true, cell: row => <Ltr>{String(row.applicationCount ?? 0)}</Ltr> },
            {
              key: 'pending', header: 'بانتظار قرار', numeric: true,
              cell: row => row.awaitingDecision
                ? <a href={L(`/org/${orgId}/applications?program=${row.id}&pending=true`)}><Ltr>{String(row.awaitingDecision)}</Ltr></a>
                : <span className="tmk-field__hint">—</span>
            },
            { key: 'jobs', header: 'الوظائف', cell: row => jobClaim(row) }
          ]}
        />
      </Card>
      <p className="tmk-row__actions">
        <a className="tmk-button tmk-button--secondary" href={L(`/org/${orgId}/applications?pending=true`)}>طلبات بحاجة قرار</a>
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-03 — screening
// ---------------------------------------------------------------------------------------------

interface OperatorApplication {
  id: string; reference: string; state: string; version: number;
  cohort: { id: string; name: string; capacity: number };
  submittedAt: string | null; decidedAt: string | null;
  candidate: { name: string; headline: string; summary: string; city: string; availability: string; education: string; experience: string; skills: string[]; cvReference: string; email: string | null } | null;
  profileShared: boolean;
  profileWithheldReason: string;
  latestScore: { total: number; scaleMax: number } | null;
  nextInterview: { scheduledAt: string; state: string; timezone: string } | null;
  enrollmentState: string | null;
  waitlistPosition: number | null;
  motivation?: string;
  reviews?: Array<{ id: string; total: number; scaleMax: number; note: string; reviewer: string; at: string }>;
  decisions?: Array<{ id: string; outcome: string; reason: string; decider: string; at: string }>;
  interviews?: Array<{ id: string; scheduledAt: string; timezone: string; mode: string; location: string; state: string }>;
  program?: { id: string; title: string; selectionMethod: string };
}

export function OrgApplications({ locale, orgId, applicationId }: { locale: Locale; orgId: string; applicationId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [rows, setRows] = useState<OperatorApplication[] | null>(null);
  const [detail, setDetail] = useState<OperatorApplication | null>(null);
  const [capacity, setCapacity] = useState<{ capacity: number; seatsTaken: number; seatsRemaining: number; waitlistLength: number } | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (applicationId) {
      const one = await api(`/orgs/${orgId}/applications/${applicationId}`) as OperatorApplication;
      setDetail(one);
      setCapacity(await api(`/orgs/${orgId}/cohorts/${one.cohort.id}/capacity`) as typeof capacity);
      return;
    }
    const search = new URLSearchParams(window.location.search);
    const query = new URLSearchParams();
    if (search.get('program')) query.set('program', search.get('program')!);
    if (search.get('pending') === 'true') query.set('pending', 'true');
    setRows(await api(`/orgs/${orgId}/applications${query.toString() ? `?${query}` : ''}`) as OperatorApplication[]);
  }, [orgId, applicationId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر التحميل.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/applications`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/programs`)}>البرامج</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);

  if (applicationId) {
    if (!detail) return shell(<ErrorState title="غير موجود">هذا المرشح غير موجود ضمن نطاق جهتك.</ErrorState>);
    const full = capacity ? capacity.seatsRemaining <= 0 : false;
    return shell(
      <>
        <PageHeader
          dashboard
          eyebrow={detail.program?.title}
          title={`المرشح ${detail.reference}`}
          lead="القرار يُكتب للمرشح، والملاحظة الداخلية لا تصل إليه أبدًا."
          actions={<><StatusBadge tone={applicationStates[detail.state]?.tone ?? 'neutral'}>{applicationStates[detail.state]?.text ?? detail.state}</StatusBadge><button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void run(async () => { const job = await api(`/orgs/${orgId}/application-exports`, 'POST', { applicationId: detail.id }) as { id: string }; window.location.assign(L(`/app/exports/${job.id}`)); return 'أُنشئت مهمة التصدير.'; })}>صدّر سجل المرشح</button></>}
        />

        <Card title="الملف">
          {detail.candidate ? (
            <>
              <dl className="tmk-definitions">
                <div><dt>الاسم</dt><dd>{detail.candidate.name}</dd></div>
                <div><dt>سطر التعريف</dt><dd>{detail.candidate.headline || '—'}</dd></div>
                <div><dt>المدينة</dt><dd>{detail.candidate.city || '—'}</dd></div>
                <div><dt>التوفر</dt><dd>{detail.candidate.availability || '—'}</dd></div>
                <div><dt>المهارات</dt><dd>{detail.candidate.skills.join('، ') || '—'}</dd></div>
                <div><dt>البريد</dt><dd>{detail.candidate.email ? <bdi>{detail.candidate.email}</bdi> : <span className="tmk-field__hint">لم يوافق على مشاركته</span>}</dd></div>
              </dl>
              {detail.candidate.education ? <p><strong>التعليم:</strong> {detail.candidate.education}</p> : null}
              {detail.candidate.experience ? <p><strong>الخبرة:</strong> {detail.candidate.experience}</p> : null}
              {detail.candidate.cvReference ? <p className="tmk-field__hint">مرجع السيرة: {detail.candidate.cvReference}</p> : null}
            </>
          ) : (
            <Notice tone="warning" title="الملف غير متاح">
              <p style={{ marginBlockEnd: 0 }}>
                {detail.profileWithheldReason === 'consent_revoked'
                  ? 'سحب المرشح موافقته على مشاركة ملفه، فلم يعد متاحًا لك — حتى على طلب قائم.'
                  : 'لم يوافق المرشح على مشاركة ملفه مع جهتك.'}
              </p>
            </Notice>
          )}
          {detail.motivation ? <div className="tmk-prose"><h3>دافع التقديم</h3><p>{detail.motivation}</p></div> : null}
        </Card>

        <Card title="التقييم">
          {detail.program?.selectionMethod ? <p className="tmk-field__hint">طريقة المفاضلة المعلنة: {detail.program.selectionMethod}</p> : null}
          <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              await api(`/orgs/${orgId}/applications/${detail.id}/reviews`, 'POST', {
                scores: { relevance: Number(form.get('relevance') ?? 0), motivation: Number(form.get('motivationScore') ?? 0) },
                note: String(form.get('note') ?? ''),
                scaleMax: 5
              });
              return 'سُجّل التقييم. الملاحظة داخلية ولا تصل إلى المرشح.';
            });
          }}>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="relevance">الملاءمة (0–5)</label>
                <input id="relevance" name="relevance" type="number" min={0} max={5} className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="motivationScore">الدافع (0–5)</label>
                <input id="motivationScore" name="motivationScore" type="number" min={0} max={5} className="tmk-field__control" required />
              </div>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="note">ملاحظة داخلية</label>
              <span className="tmk-field__hint" id="note-hint">لا تظهر للمرشح أبدًا. سبب القرار يُكتب منفصلًا أدناه.</span>
              <textarea id="note" name="note" className="tmk-field__control" rows={3} minLength={10} maxLength={2000} required aria-describedby="note-hint" />
            </div>
            <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>سجّل التقييم</button>
          </form>
          {detail.reviews && detail.reviews.length > 0 ? (
            <ul>
              {detail.reviews.map(review => (
                <li key={review.id}>
                  <Ltr>{`${review.total}/${review.scaleMax * 2}`}</Ltr> — {review.note} <span className="tmk-field__hint">{review.reviewer} · {formatDate(review.at, locale)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title="المقابلة">
          <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              await api(`/orgs/${orgId}/applications/${detail.id}/interviews`, 'POST', {
                scheduledAt: new Date(String(form.get('scheduledAt') ?? '')).toISOString(),
                durationMinutes: Number(form.get('durationMinutes') ?? 30),
                timezone: String(form.get('timezone') ?? 'Asia/Hebron'),
                mode: String(form.get('mode') ?? 'in_person'),
                location: String(form.get('location') ?? '')
              });
              return 'أُرسلت دعوة المقابلة. المرشح يؤكدها بنفسه، ولا تُعتبر مؤكدة قبل ذلك.';
            });
          }}>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="scheduledAt">الموعد</label>
                <input id="scheduledAt" name="scheduledAt" type="datetime-local" className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="timezone">المنطقة الزمنية</label>
                <span className="tmk-field__hint" id="tz-hint">تُرسل مع الموعد: وقت بلا منطقة وقتٌ يخطئه أحدهم.</span>
                <input id="timezone" name="timezone" className="tmk-field__control" defaultValue="Asia/Hebron" aria-describedby="tz-hint" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="durationMinutes">المدة (دقائق)</label>
                <input id="durationMinutes" name="durationMinutes" type="number" min={5} max={480} defaultValue={30} className="tmk-field__control" />
              </div>
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="mode">النمط</label>
                <select id="mode" name="mode" className="tmk-field__control">
                  <option value="in_person">حضوري</option>
                  <option value="remote">عن بعد</option>
                  <option value="hybrid">مختلط</option>
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="location">المكان</label>
                <span className="tmk-field__hint" id="loc-hint">مطلوب لغير «عن بعد».</span>
                <input id="location" name="location" className="tmk-field__control" maxLength={300} aria-describedby="loc-hint" />
              </div>
            </div>
            <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>حدد مقابلة</button>
          </form>
          {detail.interviews && detail.interviews.length > 0 ? (
            <ul>
              {detail.interviews.map(interview => (
                <li key={interview.id}>
                  {formatDate(interview.scheduledAt, locale, true)} (<Ltr>{interview.timezone}</Ltr>) — {interview.state}
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        <Card title="القرار">
          {capacity ? (
            <div className="tmk-grid tmk-grid--stats">
              <Stat label="المقاعد" value={<Ltr>{`${capacity.seatsTaken}/${capacity.capacity}`}</Ltr>} />
              <Stat label="المتبقي" value={<Ltr>{String(capacity.seatsRemaining)}</Ltr>} note={full ? 'لا يمكن القبول: امتلأت الدفعة.' : ''} />
              <Stat label="قائمة الانتظار" value={<Ltr>{String(capacity.waitlistLength)}</Ltr>} />
            </div>
          ) : null}
          <p className="tmk-field__hint">
            القبول دعوة بمهلة، لا مقعدًا مؤكدًا: المرشح يقبلها بنفسه، وإن انتهت المهلة تحرر المقعد للتالي في قائمة الانتظار.
          </p>
          <p className="tmk-row__actions">
            <button type="button" className="tmk-button tmk-button--primary" disabled={busy || full}
              onClick={() => void run(async () => {
                await api(`/orgs/${orgId}/applications/${detail.id}/decision`, 'POST', { outcome: 'accepted', reason: '', version: detail.version });
                return 'أُرسلت دعوة المقعد. هذا قبول في تدريب، لا عرض عمل.';
              })}>
              اقبل
            </button>
            <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
              onClick={() => void run(async () => {
                const why = window.prompt('سبب وضعه في قائمة الانتظار (عشرة أحرف على الأقل):') ?? '';
                if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                await api(`/orgs/${orgId}/applications/${detail.id}/decision`, 'POST', { outcome: 'waitlisted', reason: why, version: detail.version });
                return 'أُضيف إلى قائمة الانتظار بترتيب موثق.';
              })}>
              قائمة الانتظار
            </button>
            <button type="button" className="tmk-button tmk-button--quiet" disabled={busy}
              onClick={() => void run(async () => {
                const why = window.prompt('سبب الرفض كما سيقرؤه المرشح (عشرة أحرف على الأقل):') ?? '';
                if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                await api(`/orgs/${orgId}/applications/${detail.id}/decision`, 'POST', { outcome: 'rejected', reason: why, version: detail.version });
                return 'سُجّل الرفض بسببه، وهو ما سيقرؤه المرشح.';
              })}>
              ارفض
            </button>
          </p>
          {full ? <p className="tmk-field__hint">القبول معطَّل لأن الدفعة ممتلئة. استخدم قائمة الانتظار بدلًا من محاولة تجاوز السعة.</p> : null}
          {detail.decisions && detail.decisions.length > 0 ? (
            <ul>
              {detail.decisions.map(decision => (
                <li key={decision.id}>
                  <strong>{applicationStates[decision.outcome]?.text ?? decision.outcome}</strong>
                  {decision.reason ? ` — ${decision.reason}` : ''} <span className="tmk-field__hint">{decision.decider} · {formatDate(decision.at, locale)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>

        {/* PRG-03.A05: declared, not offered. */}
        <Card title="تصدير المرشحين">
          <Notice tone="info" title="غير متاح في هذه النسخة">
            <p style={{ marginBlockEnd: 0 }}>
              التصدير مستند مؤرخ يُنتجه مشغّل مهام إلى مخزن مستندات، وكلاهما غير مبني. الجدول معروض كاملًا ويمكن نسخه،
              ولا يخرج منه إلا ما وافق صاحبه على مشاركته.
            </p>
          </Notice>
        </Card>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="فرز المتقدمين" lead="الدرجة والحالة والمقعد. ما لم يوافق صاحبه على مشاركته لا يظهر هنا أصلًا." />
      <Card title="الطلبات">
        <DataTable
          caption="طلبات ضمن نطاق جهتك"
          rows={rows ?? []}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا طلبات">لا يوجد طلب ضمن هذا الفلتر.</EmptyState>}
          columns={[
            {
              key: 'candidate', header: 'المرشح',
              cell: row => row.candidate
                ? <>{row.candidate.name}<span className="tmk-field__hint">{row.candidate.headline}</span></>
                : <span className="tmk-field__hint">{row.profileWithheldReason === 'consent_revoked' ? 'سُحبت الموافقة' : 'لا موافقة مشاركة'}</span>
            },
            { key: 'reference', header: 'الرقم', cell: row => <code><Ltr>{row.reference}</Ltr></code> },
            { key: 'cohort', header: 'الدفعة', cell: row => row.cohort.name },
            { key: 'score', header: 'الدرجة', numeric: true, cell: row => row.latestScore ? <Ltr>{String(row.latestScore.total)}</Ltr> : <span className="tmk-field__hint">—</span> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={applicationStates[row.state]?.tone ?? 'neutral'}>{applicationStates[row.state]?.text ?? row.state}</StatusBadge> },
            {
              key: 'seat', header: 'المقعد',
              cell: row => row.enrollmentState
                ? (enrollmentStates[row.enrollmentState]?.text ?? row.enrollmentState)
                : row.waitlistPosition ? `قائمة انتظار — الدور ${row.waitlistPosition}` : '—'
            },
            { key: 'open', header: '', cell: row => <a href={L(`/org/${orgId}/applications/${row.id}`)}>افتح</a> }
          ]}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-04 / PRG-05 — the cohort and the register
// ---------------------------------------------------------------------------------------------

interface CohortBoard {
  cohort: { id: string; name: string; capacity: number; startAt: string; endAt: string; timezone: string; state: string; version: number; seatsTaken: number; seatsRemaining: number };
  program: { id: string; title: string; organizationId: string; attendancePolicy: string };
  members: Array<{ id: string; name: string; state: string; invitationExpiresAt: string; confirmedAt: string | null; exitReason: string; version: number }>;
  sessions: Array<{ id: string; title: string; startsAt: string; endsAt: string; timezone: string; location: string; state: string; version: number }>;
  trainers: Array<{ id: string; userId: string; name: string; assignedAt: string }>;
  waitlist: Array<{ position: number; applicationId: string; reference: string; name: string }>;
  canManage: boolean;
}

export function OrgCohort({ locale, orgId, cohortId }: { locale: Locale; orgId: string; cohortId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [board, setBoard] = useState<CohortBoard | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => setBoard(await api(`/cohorts/${cohortId}`) as CohortBoard), [cohortId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل الدفعة.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/programs`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/programs`)}>البرامج</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  if (!board) {
    return shell(
      <ErrorState title="خارج نطاقك">
        المدرب يصل إلى الدفعات المسندة إليه وحدها. إن كنت مدربًا في هذه الجهة فاطلب من مدير البرنامج إسنادك لهذه الدفعة.
      </ErrorState>
    );
  }

  return shell(
    <>
      <PageHeader
        dashboard
        eyebrow={board.program.title}
        title={board.cohort.name}
        lead="من في الدفعة، وكم مقعدًا بقي، ومن يدرّب، وما الجلسات."
        actions={<StatusBadge tone={board.cohort.seatsRemaining > 0 ? 'info' : 'neutral'}>{`${board.cohort.seatsTaken}/${board.cohort.capacity}`}</StatusBadge>}
      />

      <div className="tmk-grid tmk-grid--stats">
        <Stat label="المقاعد المشغولة" value={<Ltr>{String(board.cohort.seatsTaken)}</Ltr>} note="دعوة انتهت مهلتها لا تشغل مقعدًا." />
        <Stat label="المتبقي" value={<Ltr>{String(board.cohort.seatsRemaining)}</Ltr>} />
        <Stat label="قائمة الانتظار" value={<Ltr>{String(board.waitlist.length)}</Ltr>} />
      </div>

      <Card title="الأعضاء">
        <DataTable
          caption="أعضاء الدفعة"
          rows={board.members}
          rowKey={member => member.id}
          emptyState={<EmptyState title="لا أعضاء">لم يقبل أحد مقعدًا في هذه الدفعة بعد.</EmptyState>}
          columns={[
            { key: 'name', header: 'المتدرب', cell: member => member.name },
            { key: 'state', header: 'الحالة', cell: member => <StatusBadge tone={enrollmentStates[member.state]?.tone ?? 'neutral'}>{enrollmentStates[member.state]?.text ?? member.state}</StatusBadge> },
            { key: 'window', header: 'مهلة القبول', cell: member => member.state === 'invited' ? formatDate(member.invitationExpiresAt, locale, true) : <span className="tmk-field__hint">—</span> },
            {
              key: 'exit', header: '',
              cell: member => board.canManage && ['invited', 'confirmed', 'active'].includes(member.state)
                ? <button type="button" className="tmk-button tmk-button--quiet" disabled={busy}
                    onClick={() => void run(async () => {
                      const why = window.prompt('سبب تسجيل الانسحاب (عشرة أحرف على الأقل):') ?? '';
                      if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                      await api(`/enrollments/${member.id}/withdraw`, 'POST', { reason: why, version: member.version });
                      return 'سُجّل الانسحاب. سجلات الحضور والتقييم تبقى كما هي: الخروج ليس محوًا.';
                    })}>
                    سجّل انسحابًا
                  </button>
                : <span className="tmk-field__hint">—</span>
            }
          ]}
        />
      </Card>

      {board.waitlist.length > 0 ? (
        <Card title="قائمة الانتظار">
          <p className="tmk-field__hint">بترتيبها الموثق. «التالي» حقيقة يمكن التحقق منها، لا ما تصادف أن أعادته الاستعلامة أولًا.</p>
          <ol>
            {board.waitlist.map(entry => (
              <li key={entry.applicationId}>{entry.name} — <code><Ltr>{entry.reference}</Ltr></code></li>
            ))}
          </ol>
          {board.canManage ? (
            <button type="button" className="tmk-button tmk-button--secondary" disabled={busy || board.cohort.seatsRemaining <= 0}
              onClick={() => void run(async () => {
                const invited = await api(`/cohorts/${cohortId}/waitlist/invite-next`, 'POST') as { invitedFromPosition: number };
                return `أُرسلت دعوة مقعد للدور ${invited.invitedFromPosition} في القائمة.`;
              })}>
              ادعُ التالي
            </button>
          ) : null}
          {board.cohort.seatsRemaining <= 0 ? <p className="tmk-field__hint">لا مقعد متاح الآن، فلا يمكن دعوة أحد.</p> : null}
        </Card>
      ) : null}

      <Card title="الجلسات">
        <DataTable
          caption="جلسات الدفعة"
          rows={board.sessions}
          rowKey={session => session.id}
          emptyState={<EmptyState title="لا جلسات">لم تُجدول جلسات بعد.</EmptyState>}
          columns={[
            { key: 'title', header: 'الجلسة', cell: session => session.title },
            { key: 'when', header: 'الموعد', cell: session => <>{formatDate(session.startsAt, locale, true)}<span className="tmk-field__hint"><Ltr>{session.timezone}</Ltr></span></> },
            { key: 'state', header: 'الحالة', cell: session => sessionStates[session.state] ?? session.state },
            { key: 'open', header: '', cell: session => <a href={L(`/org/${orgId}/cohorts/${cohortId}/sessions/${session.id}`)}>سجل الحضور</a> }
          ]}
        />
        {board.canManage ? (
          <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              await api(`/cohorts/${cohortId}/sessions`, 'POST', {
                title: String(form.get('title') ?? ''),
                startsAt: new Date(String(form.get('startsAt') ?? '')).toISOString(),
                endsAt: new Date(String(form.get('endsAt') ?? '')).toISOString(),
                mode: String(form.get('mode') ?? 'in_person'),
                location: String(form.get('location') ?? '')
              });
              return 'أُنشئت الجلسة ضمن مدة الدفعة.';
            });
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="session-title">عنوان الجلسة</label>
              <input id="session-title" name="title" className="tmk-field__control" minLength={3} maxLength={200} required />
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="session-start">تبدأ</label>
                <input id="session-start" name="startsAt" type="datetime-local" className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="session-end">تنتهي</label>
                <input id="session-end" name="endsAt" type="datetime-local" className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="session-location">المكان</label>
                <input id="session-location" name="location" className="tmk-field__control" maxLength={300} />
              </div>
            </div>
            <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>أنشئ جلسة</button>
          </form>
        ) : null}
      </Card>

      <Card title="المدربون">
        <p className="tmk-field__hint">
          الإسناد هو ما يمنح المدرب نطاقه: بدونه لا يرى هذه الدفعة ولو حمل دور «مدرب» في الجهة. وسحب الإسناد يسحب النطاق فورًا.
        </p>
        <DataTable
          caption="مدربو الدفعة"
          rows={board.trainers}
          rowKey={trainer => trainer.id}
          emptyState={<EmptyState title="لا مدربين">لم يُسند مدرب لهذه الدفعة.</EmptyState>}
          columns={[
            { key: 'name', header: 'المدرب', cell: trainer => trainer.name },
            { key: 'since', header: 'منذ', cell: trainer => formatDate(trainer.assignedAt, locale) },
            {
              key: 'revoke', header: '',
              cell: trainer => board.canManage
                ? <button type="button" className="tmk-button tmk-button--quiet" disabled={busy}
                    onClick={() => void run(async () => {
                      await api(`/cohorts/${cohortId}/trainers/${trainer.id}/revoke`, 'POST');
                      return 'سُحب الإسناد، وانتهى نطاق المدرب على هذه الدفعة فورًا.';
                    })}>
                    اسحب الإسناد
                  </button>
                : <span className="tmk-field__hint">—</span>
            }
          ]}
        />
        {board.canManage ? (
          <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void run(async () => {
              await api(`/cohorts/${cohortId}/trainers`, 'POST', { userId: String(form.get('userId') ?? '') });
              return 'أُسند المدرب لهذه الدفعة وحدها.';
            });
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="trainer-id">معرّف المدرب</label>
              <span className="tmk-field__hint" id="trainer-hint">عضو نشط في جهتك. الإسناد لهذه الدفعة فقط.</span>
              <input id="trainer-id" name="userId" className="tmk-field__control" required aria-describedby="trainer-hint" />
            </div>
            <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>أسند مدربًا</button>
          </form>
        ) : (
          <p className="tmk-field__hint">إسناد المدربين وتسجيل الانسحابات من صلاحية مدير البرنامج، لا المدرب.</p>
        )}
      </Card>
    </>
  );
}

interface RegisterData {
  session: { id: string; title: string; startsAt: string; endsAt: string; timezone: string; location: string; state: string; version: number };
  cohort: { id: string; name: string; timezone: string };
  canCorrect: boolean;
  canReviewObjections: boolean;
  rows: Array<{
    enrollmentId: string; name: string; status: string | null; excuseNote: string;
    attendanceId: string | null; version: number | null;
    revisions: Array<{ id: string; from: string; to: string; reason: string; afterClose: boolean; at: string }>;
    openObjection: string | null;
  }>;
}

export function SessionRegister({ locale, orgId, cohortId, sessionId }: { locale: Locale; orgId: string; cohortId: string; sessionId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [data, setData] = useState<RegisterData | null>(null);
  const [objections, setObjections] = useState<Array<{ id: string; reason: string; raisedBy: string; currentStatus: string; version: number; decidableByYou: boolean; session: { id: string } }>>([]);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setData(await api(`/sessions/${sessionId}/attendance`) as RegisterData);
    // Objections are a manager's queue, so a trainer simply gets nothing here rather than an error.
    try { setObjections(await api(`/orgs/${orgId}/attendance-objections`) as typeof objections); }
    catch { setObjections([]); }
  }, [sessionId, orgId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل السجل.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/programs`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/cohorts/${cohortId}`)}>الدفعة</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  if (!data) return shell(<ErrorState title="خارج نطاقك">هذه الجلسة تخص دفعة لست مسندًا إليها.</ErrorState>);

  const closed = data.session.state === 'closed';
  const sessionObjections = objections.filter(objection => objection.session.id === sessionId);

  return shell(
    <>
      <PageHeader
        dashboard
        eyebrow={data.cohort.name}
        title={data.session.title}
        lead="سجل واحد لكل متدرب في هذه الجلسة. التعديل بعد الإقفال مراجعة مكتوبة، لا استبدال."
        actions={<StatusBadge tone={closed ? 'neutral' : 'info'}>{closed ? 'مُقفل' : 'مفتوح'}</StatusBadge>}
      />
      <p className="tmk-field__hint">
        {formatDate(data.session.startsAt, locale, true)} → {formatDate(data.session.endsAt, locale, true)} (<Ltr>{data.session.timezone}</Ltr>) · {data.session.location}
      </p>

      {closed ? (
        <Notice tone="warning" title="السجل مُقفل">
          <p style={{ marginBlockEnd: 0 }}>
            أي تغيير من الآن يُسجَّل كمراجعة بسبب مكتوب، لأن هذا السجل قد يكون احتُسب بالفعل في استحقاق.
          </p>
        </Notice>
      ) : null}

      <Card title="الحضور">
        <form onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(async () => {
            const entries = data.rows.map(row => {
              const status = String(form.get(`status-${row.enrollmentId}`) ?? '');
              const excuseNote = String(form.get(`note-${row.enrollmentId}`) ?? '');
              const reason = String(form.get(`reason-${row.enrollmentId}`) ?? '');
              return {
                enrollmentId: row.enrollmentId, status, excuseNote,
                ...(reason ? { reason } : {}),
                ...(row.version ? { version: row.version } : {})
              };
            }).filter(entry => entry.status);
            if (!entries.length) throw new Error('لم تُحدَّد أي حالة حضور.');
            // Named before the request, with the trainee it is about, so the answer is the one
            // thing that is missing rather than a general list of what this endpoint can refuse.
            const missingExcuse = entries.find(entry => entry.status === 'excused' && !entry.excuseNote.trim());
            if (missingExcuse) {
              const who = data.rows.find(row => row.enrollmentId === missingExcuse.enrollmentId)?.name ?? '';
              throw new Error(`«غياب بعذر» يحتاج عذرًا مكتوبًا${who ? ` — ${who}` : ''}: غياب بعذر بلا عذر هو غياب قرر أحدهم التلطف معه.`);
            }
            if (closed) {
              const missingReason = entries.find(entry => {
                const current = data.rows.find(row => row.enrollmentId === entry.enrollmentId);
                const changed = current && (current.status !== entry.status || current.excuseNote !== entry.excuseNote);
                return changed && !entry.reason;
              });
              if (missingReason) {
                const who = data.rows.find(row => row.enrollmentId === missingReason.enrollmentId)?.name ?? '';
                throw new Error(`السجل مُقفل، فكل تغيير مراجعة تحتاج سببًا مكتوبًا${who ? ` — ${who}` : ''}.`);
              }
            }
            const result = await api(`/sessions/${sessionId}/attendance`, 'PUT', { entries }) as { written: number; revised: number };
            return `حُفظ السجل: ${result.written} تسجيلًا جديدًا و${result.revised} مراجعة.`;
          });
        }}>
          <DataTable
            caption="متدربو هذه الجلسة"
            rows={data.rows}
            rowKey={row => row.enrollmentId}
            emptyState={<EmptyState title="لا متدربين">لا أحد أكد مقعده في هذه الدفعة بعد.</EmptyState>}
            columns={[
              { key: 'name', header: 'المتدرب', cell: row => row.name },
              {
                key: 'status', header: 'الحضور',
                cell: row => (
                  <select name={`status-${row.enrollmentId}`} defaultValue={row.status ?? ''} className="tmk-field__control" aria-label={`حضور ${row.name}`}>
                    <option value="">—</option>
                    <option value="present">حاضر</option>
                    <option value="late">متأخر</option>
                    <option value="excused">غياب بعذر</option>
                    <option value="absent">غائب</option>
                  </select>
                )
              },
              {
                key: 'note', header: 'العذر',
                cell: row => <input name={`note-${row.enrollmentId}`} defaultValue={row.excuseNote} className="tmk-field__control" maxLength={1000} aria-label={`عذر ${row.name}`} />
              },
              {
                key: 'reason', header: closed ? 'سبب المراجعة' : 'ملاحظة',
                cell: row => <input name={`reason-${row.enrollmentId}`} className="tmk-field__control" maxLength={1000} aria-label={`سبب تعديل سجل ${row.name}`} placeholder={closed ? 'مطلوب عند التغيير' : ''} />
              },
              {
                key: 'history', header: 'المراجعات',
                cell: row => row.revisions.length
                  ? <ul>{row.revisions.map(revision => (
                      <li key={revision.id}>
                        {attendanceLabels[revision.from]?.text ?? revision.from} ← {attendanceLabels[revision.to]?.text ?? revision.to}
                        <span className="tmk-field__hint">{revision.reason}{revision.afterClose ? ' (بعد الإقفال)' : ''}</span>
                      </li>
                    ))}</ul>
                  : <span className="tmk-field__hint">—</span>
              }
            ]}
          />
          <p className="tmk-field__hint">«غياب بعذر» يحتاج عذرًا مكتوبًا: غياب بعذر بلا عذر هو غياب قرر أحدهم التلطف معه.</p>
          <p className="tmk-row__actions">
            <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>احفظ السجل</button>
            {!closed ? (
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                onClick={() => void run(async () => {
                  await api(`/sessions/${sessionId}/close`, 'POST', { version: data.session.version });
                  return 'أُقفل السجل. أي تغيير بعد الآن مراجعة مكتوبة.';
                })}>
                أقفل السجل
              </button>
            ) : null}
          </p>
        </form>
      </Card>

      <Card title="الاعتراضات">
        {!data.canReviewObjections ? (
          <p className="tmk-field__hint">
            البتّ في الاعتراض ليس من صلاحية من سجّل الحضور. يراجعه مدير البرنامج أو مراجع مخول غيرك.
          </p>
        ) : sessionObjections.length === 0 ? (
          <EmptyState title="لا اعتراضات">لا اعتراض قائم على سجلات هذه الجلسة.</EmptyState>
        ) : (
          sessionObjections.map(objection => (
            <article className="tmk-row" key={objection.id}>
              <div>
                <strong>{objection.raisedBy}</strong>
                <p>{objection.reason}</p>
                <p className="tmk-field__hint">السجل الحالي: {attendanceLabels[objection.currentStatus]?.text ?? objection.currentStatus}</p>
              </div>
              {objection.decidableByYou ? (
                <span className="tmk-row__actions">
                  <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                    onClick={() => void run(async () => {
                      const status = window.prompt('الحالة الصحيحة (present / late / excused / absent):') ?? '';
                      if (!['present', 'late', 'excused', 'absent'].includes(status)) throw new Error('حالة غير صالحة.');
                      const why = window.prompt('سبب قبول الاعتراض (عشرة أحرف على الأقل):') ?? '';
                      if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                      await api(`/attendance-objections/${objection.id}/decision`, 'POST', { outcome: 'upheld', reason: why, correctedStatus: status, version: objection.version });
                      return 'قُبل الاعتراض وصُحِّح السجل بمراجعة مكتوبة تبقى فيه.';
                    })}>
                    اقبل وصحّح
                  </button>
                  <button type="button" className="tmk-button tmk-button--quiet" disabled={busy}
                    onClick={() => void run(async () => {
                      const why = window.prompt('سبب رفض الاعتراض (عشرة أحرف على الأقل):') ?? '';
                      if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                      await api(`/attendance-objections/${objection.id}/decision`, 'POST', { outcome: 'rejected', reason: why, version: objection.version });
                      return 'رُفض الاعتراض بسببه، ويبقى مرئيًا للمتدرب.';
                    })}>
                    ارفض
                  </button>
                </span>
              ) : (
                <span className="tmk-field__hint">لست مستقلًا عن هذا السجل: أنت من سجّله أو أنت من اعترض.</span>
              )}
            </article>
          ))
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The independent programme review
// ---------------------------------------------------------------------------------------------

export function ProgramReviews({ locale, programId }: { locale: Locale; programId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [queue, setQueue] = useState<ProgramRow[] | null>(null);
  const [detail, setDetail] = useState<(ProgramRow & { organization: { displayName: string; verification: string } }) | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setQueue(await api('/admin/program-reviews') as ProgramRow[]);
    if (programId) setDetail(await api(`/admin/program-reviews/${programId}`) as typeof detail);
  }, [programId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError || (e instanceof Error && e.message.startsWith('لا تملك'))) setAllowed(false);
        else setError(e instanceof Error ? e.message : 'تعذر التحميل.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const run = async (action: () => Promise<string>) => {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={programId ? `/admin/program-reviews/${programId}` : '/admin/program-reviews'} signedIn={Boolean(queue)}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!allowed || !queue) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>
        مراجعة البرامج تحتاج منحة <code>ContentReviewer</code> مع تحقق بخطوتين، وهي مستقلة عن أي عضوية في جهة.
      </ErrorState>
    );
  }

  if (programId) {
    if (!detail) return shell(<ErrorState title={t('notFoundTitle')}>{t('notFoundBody')}</ErrorState>);
    const blockers = detail.readiness?.blockers ?? [];
    return shell(
      <>
        <PageHeader
          dashboard
          eyebrow={detail.organization.displayName}
          title={detail.title}
          lead="القرار يرتبط بما هو معروض أدناه، ولا يتخذه عضو في الجهة المشغّلة. والاعتماد ليس فتحًا للتقديم."
          actions={<StatusBadge tone={programStates[detail.state]?.tone ?? 'neutral'}>{programStates[detail.state]?.text ?? detail.state}</StatusBadge>}
        />

        <Card title="ما يقرأه المتقدم">
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="السعة" value={<Ltr>{String(detail.capacity)}</Ltr>} />
            <Stat label="الوظائف" value={jobClaim(detail)} note={detail.jobCommitmentTerms || ''} />
            <Stat label="اكتمال المتطلبات" value={blockers.length === 0 ? 'مكتمل' : 'ناقص'} note={blockers.map(code => blockerLabels[code] ?? code).join('؛ ')} />
          </div>
          <div className="tmk-prose">
            <p>{detail.summary}</p>
            <h3>المفاضلة</h3><p>{detail.selectionMethod}</p>
            <h3>الحضور</h3><p>{detail.attendancePolicy}</p>
            <h3>التقييم</h3><p>{detail.assessmentPolicy}</p>
            <h3>الانسحاب</h3><p>{detail.withdrawalPolicy}</p>
          </div>
          {detail.organization.verification !== 'verified' ? (
            <Notice tone="danger" title="الجهة غير موثقة">
              <p style={{ marginBlockEnd: 0 }}>لا يُفتح التقديم لجهة غير موثقة، ويُعاد فحص التوثيق عند الفتح أيضًا.</p>
            </Notice>
          ) : null}
        </Card>

        <Card title="القرار">
          {/* The reason this reader may be refused, written before they press anything. The server
              enforces it either way; this is so the refusal is not a surprise. */}
          <p className="tmk-field__hint">
            القرار لا يتخذه عضو في الجهة المشغّلة ولو حمل منحة المراجعة، ولا يُستلم برنامج استلمه مراجع آخر.
            إن كنت عضوًا في هذه الجهة فسيُرفض قرارك هنا.
          </p>
          <p className="tmk-row__actions">
            <button type="button" className="tmk-button tmk-button--quiet" disabled={busy}
              onClick={() => void run(async () => {
                await api(`/admin/programs/${detail.id}/claim`, 'POST');
                return 'استُلم للمراجعة. لا يمكن لمراجع آخر استلامه.';
              })}>
              استلم للمراجعة
            </button>
            <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
              onClick={() => void run(async () => {
                await api(`/admin/programs/${detail.id}/decision`, 'POST', { outcome: 'approved', publicReason: '', version: detail.version });
                return 'اعتُمد البرنامج. الاعتماد ليس فتحًا للتقديم: الجهة تقرر متى يُفتح.';
              })}>
              اعتمد
            </button>
            <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
              onClick={() => void run(async () => {
                const why = window.prompt('ما الذي يجب تعديله؟ (عشرة أحرف على الأقل):') ?? '';
                if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                await api(`/admin/programs/${detail.id}/decision`, 'POST', { outcome: 'changes_requested', publicReason: why, version: detail.version });
                return 'أُعيد إلى الجهة مع ملاحظات.';
              })}>
              اطلب تعديلات
            </button>
          </p>
        </Card>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="مراجعة البرامج" lead="برامج مُرسلة بانتظار قرار مستقل. عضو الجهة المشغّلة لا يقرر، ولو حمل المنحة." />
      <Card title="بانتظار المراجعة">
        <DataTable
          caption="برامج بانتظار مراجع مستقل"
          rows={queue}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا برامج بانتظار المراجعة">لا يوجد برنامج مُرسل الآن.</EmptyState>}
          columns={[
            { key: 'title', header: 'البرنامج', cell: row => <a href={L(`/admin/program-reviews/${row.id}`)}>{row.title}</a> },
            { key: 'capacity', header: 'السعة', numeric: true, cell: row => <Ltr>{String(row.capacity)}</Ltr> },
            { key: 'jobs', header: 'الوظائف', cell: row => jobClaim(row) },
            { key: 'deadline', header: 'آخر موعد للتقديم', cell: row => row.applyClosesAt ? formatDate(row.applyClosesAt, locale) : '—' }
          ]}
        />
      </Card>
    </>
  );
}
