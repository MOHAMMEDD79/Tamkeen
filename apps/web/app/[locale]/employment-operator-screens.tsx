'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Notice, PageHeader,
  Skeleton, Stat, StatusBadge, formatDate, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * PART-11, the employer's side: PRG-07 jobs, PRG-08 offers, PRG-09 placements and follow-up.
 *
 * The rules these screens exist to hold, all of which are easier to break here than anywhere else
 * in the product, because this is where the numbers a funder reads are made:
 *
 *  - **An accepted offer is not a hire.** The offers list shows an accepted offer against its
 *    placement's real state, and the placements screen keeps `start_pending` visibly apart from
 *    `started`.
 *  - **An operator cannot confirm a start alone.** Their confirmation is one of two, and the screen
 *    says which side is still missing rather than showing a tick.
 *  - **Asking and answering are different buttons.** "Request a follow-up" writes no result, and
 *    says so on the button's own row.
 *  - **`unknown` is offered as a normal choice.** A form that only takes good news produces only
 *    good news, and 14 wants the unknowns counted.
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

/** Written for an operator, and naming this screen's own conflicts rather than "the state changed". */
function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء في هذه الجهة. تسجيل بدء العمل يحتاج placement.verify، والفصل في الخلاف يحتاج placement.review وهي ليست من صلاحيات المسؤول عن التوظيف.',
    not_found: 'المورد غير موجود ضمن جهتك.',
    conflict: 'تغيّرت الحالة: قد يكون العرض أُرسل فلم يعد قابلًا للتعديل، أو امتلأت الشواغر، أو ما زالت طلبات قائمة تمنع الإغلاق، أو النسخة التي بين يديك قديمة. أعد التحميل واقرأ ما تغيّر.',
    invalid_input: 'تحقق من الحقول: الأجر إمّا معلن بمبلغ وعملة أو غير معلن بسبب مكتوب، والعقد محدد المدة يحتاج عدد أشهر، ومهلة الرد يجب أن تسبق تاريخ البدء المقترح.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const jobStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  review: { text: 'قيد المراجعة', tone: 'info' },
  open: { text: 'مفتوحة', tone: 'success' },
  paused: { text: 'موقوفة مؤقتًا', tone: 'warning' },
  closed: { text: 'مغلقة', tone: 'neutral' },
  filled: { text: 'شُغلت', tone: 'info' },
  cancelled: { text: 'ملغاة', tone: 'neutral' }
};

const applicationStates: Record<string, { text: string; tone: Tone }> = {
  submitted: { text: 'جديد', tone: 'info' },
  screening: { text: 'قيد الفرز', tone: 'info' },
  shortlisted: { text: 'قائمة قصيرة', tone: 'info' },
  interview: { text: 'مقابلة', tone: 'warning' },
  offered: { text: 'أُرسل عرض', tone: 'success' },
  hired: { text: 'قبل العرض — لم يبدأ بعد', tone: 'success' },
  rejected: { text: 'مرفوض', tone: 'danger' },
  withdrawn: { text: 'منسحب', tone: 'neutral' },
  draft: { text: 'مسودة لدى المتقدم', tone: 'neutral' }
};

const offerStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  sent: { text: 'أُرسل — بانتظار الرد', tone: 'warning' },
  accepted: { text: 'قُبل', tone: 'success' },
  declined: { text: 'رُفض', tone: 'neutral' },
  withdrawn: { text: 'مسحوب', tone: 'neutral' },
  expired: { text: 'انتهت مهلته', tone: 'neutral' }
};

const placementStates: Record<string, { text: string; tone: Tone }> = {
  start_pending: { text: 'بانتظار تأكيد البدء', tone: 'warning' },
  started: { text: 'بدأ العمل — مؤكَّد', tone: 'success' },
  retained: { text: 'مستمر بعد ٩٠ يومًا', tone: 'success' },
  ended: { text: 'انتهى', tone: 'neutral' },
  disputed: { text: 'محل خلاف', tone: 'danger' },
  offered: { text: 'عرض', tone: 'info' },
  accepted: { text: 'مقبول', tone: 'info' }
};

const followupResults: Record<string, { text: string; tone: Tone }> = {
  working: { text: 'على رأس العمل', tone: 'success' },
  ended: { text: 'انتهى', tone: 'neutral' },
  unknown: { text: 'لا جواب — غير معروف', tone: 'warning' },
  disputed: { text: 'محل خلاف', tone: 'danger' }
};

const contractTypes: Record<string, string> = {
  full_time: 'دوام كامل', part_time: 'دوام جزئي', fixed_term: 'عقد محدد المدة',
  apprenticeship: 'تدرّج مهني', temporary: 'مؤقت'
};

const blockerText: Record<string, string> = {
  summary_too_short: 'النبذة قصيرة: أقل من ٥٠ حرفًا لا تكفي لأن يقرر أحد التقديم.',
  requirements_missing: 'المتطلبات غير مكتوبة.',
  deadline_missing: 'لا يوجد موعد نهائي للتقديم.',
  deadline_in_past: 'الموعد النهائي مضى.',
  fixed_term_length_missing: 'العقد محدد المدة ولم تُذكر مدته بالأشهر.',
  salary_incomplete: 'اخترت إعلان الأجر دون مبلغ أو عملة.',
  salary_silence_unexplained: 'الأجر غير معلن ولم تكتب سبب عدم إعلانه. الصمت وحده غير مقبول.'
};

/** The denominator codes 14 allows, in the reader's language. */
const denominatorText: Record<string, string> = {
  ninety_days_since_confirmed_start: 'التوظيف الذي مضى على تاريخ بدئه الفعلي المؤكَّد تسعون يومًا أو أكثر'
};

const money = (minor: string | null, currency: string | null) =>
  minor === null || currency === null ? null : `${(Number(minor) / 100).toLocaleString('ar', { minimumFractionDigits: 2 })} ${currency}`;

// ---------------------------------------------------------------------------------------------
// PRG-07 — jobs
// ---------------------------------------------------------------------------------------------

interface OrgJob {
  id: string; slug: string; title: string; summary: string; responsibilities: string; requirements: string;
  skills: string[]; contractType: string; contractMonths: number | null; deliveryMode: string;
  city: string; hoursPerWeek: number; salaryDisclosed: boolean; salaryMinMinor: string | null;
  salaryMaxMinor: string | null; salaryCurrency: string | null; salaryPeriod: string;
  salaryUndisclosedReason: string; closesAt: string | null; openings: number; state: string;
  stateReason: string; version: number; applicationCount: number; deadlinePassed: boolean;
  publiclyVisible: boolean;
}

interface JobReadiness { ready: boolean; blockers: string[] }

export function OrgJobs({ locale, orgId, mode, jobId }: { locale: Locale; orgId: string; mode: 'list' | 'new' | 'edit'; jobId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [jobs, setJobs] = useState<OrgJob[] | null>(null);
  const [detail, setDetail] = useState<(OrgJob & { readiness: JobReadiness }) | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [closing, setClosing] = useState<OrgJob | null>(null);
  const [disclosePay, setDisclosePay] = useState(false);

  const load = useCallback(async () => {
    setJobs(await api(`/orgs/${orgId}/jobs`) as OrgJob[]);
    if (jobId) {
      const one = await api(`/orgs/${orgId}/jobs/${jobId}`) as OrgJob & { readiness: JobReadiness };
      setDetail(one);
      setDisclosePay(one.salaryDisclosed);
    }
  }, [orgId, jobId]);

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

  const readForm = (form: FormData) => {
    const disclosed = form.get('salaryDisclosed') === 'on';
    const asMinor = (value: string) => value.trim() === '' ? null : String(Math.round(Number(value) * 100));
    return {
      title: String(form.get('title') ?? ''),
      summary: String(form.get('summary') ?? ''),
      responsibilities: String(form.get('responsibilities') ?? ''),
      requirements: String(form.get('requirements') ?? ''),
      skills: String(form.get('skills') ?? '').split(/[,،]/).map(skill => skill.trim()).filter(Boolean),
      contractType: String(form.get('contractType') ?? 'full_time'),
      contractMonths: String(form.get('contractMonths') ?? '').trim() === '' ? null : Number(form.get('contractMonths')),
      deliveryMode: String(form.get('deliveryMode') ?? 'in_person'),
      city: String(form.get('city') ?? ''),
      hoursPerWeek: Number(form.get('hoursPerWeek') ?? 0),
      salaryDisclosed: disclosed,
      salaryMinMinor: disclosed ? asMinor(String(form.get('salaryMin') ?? '')) : null,
      salaryMaxMinor: disclosed ? asMinor(String(form.get('salaryMax') ?? '')) : null,
      salaryCurrency: disclosed ? String(form.get('salaryCurrency') ?? 'ILS') : null,
      salaryPeriod: String(form.get('salaryPeriod') ?? ''),
      salaryUndisclosedReason: disclosed ? '' : String(form.get('salaryUndisclosedReason') ?? ''),
      closesAt: String(form.get('closesAt') ?? '').trim() === '' ? null : new Date(String(form.get('closesAt'))).toISOString(),
      openings: Number(form.get('openings') ?? 1)
    };
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/jobs`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/jobs`)}>الوظائف</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/org/${orgId}/jobs`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!jobs) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const editing = mode === 'edit' ? detail : null;

  if (mode === 'new' || editing) {
    const source = editing;
    return shell(
      <>
        <PageHeader dashboard title={editing ? `تعديل: ${editing.title}` : 'وظيفة جديدة'}
          lead="الوظيفة تُنشأ مسودة لا يراها أحد. النشر خطوة منفصلة، ولا يُقبل قبل اكتمال ما يقرره المتقدم." />

        {editing && !editing.readiness.ready ? (
          <Notice tone="warning" title="ما يمنع النشر">
            <ul>
              {editing.readiness.blockers.map(code => <li key={code}>{blockerText[code] ?? code}</li>)}
            </ul>
          </Notice>
        ) : null}

        <Card title="بيانات الوظيفة">
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const body = readForm(form);
            void act(async () => {
              if (editing) await api(`/orgs/${orgId}/jobs/${editing.id}`, 'PATCH', { ...body, version: editing.version });
              else await api(`/orgs/${orgId}/jobs`, 'POST', body);
            }, editing ? 'حُفظ التعديل.' : 'أُنشئت الوظيفة كمسودة. راجع ما يمنع النشر ثم انشرها.');
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="title">المسمى</label>
              <input id="title" name="title" className="tmk-field__control" defaultValue={source?.title} minLength={4} maxLength={200} required />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="summary">نبذة</label>
              <span className="tmk-field__hint" id="summary-hint">٥٠ حرفًا على الأقل للنشر: هذه ما يقرؤه المتقدم قبل أن يقرر.</span>
              <textarea id="summary" name="summary" className="tmk-field__control" rows={4} defaultValue={source?.summary} minLength={20} maxLength={2000} required aria-describedby="summary-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="responsibilities">المهام</label>
              <textarea id="responsibilities" name="responsibilities" className="tmk-field__control" rows={4} defaultValue={source?.responsibilities} maxLength={4000} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="requirements">المتطلبات</label>
              <span className="tmk-field__hint" id="req-hint">٢٠ حرفًا على الأقل للنشر.</span>
              <textarea id="requirements" name="requirements" className="tmk-field__control" rows={4} defaultValue={source?.requirements} maxLength={4000} aria-describedby="req-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="skills">المهارات المطلوبة</label>
              <span className="tmk-field__hint" id="skills-hint">افصل بينها بفاصلة. عليها يُفلتر الباحثون عن عمل.</span>
              <input id="skills" name="skills" className="tmk-field__control" defaultValue={source?.skills.join('، ')} aria-describedby="skills-hint" />
            </div>

            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="contractType">نوع العقد</label>
                <select id="contractType" name="contractType" className="tmk-field__control" defaultValue={source?.contractType ?? 'full_time'}>
                  {Object.entries(contractTypes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="contractMonths">مدة العقد بالأشهر</label>
                <span className="tmk-field__hint" id="months-hint">مطلوبة للعقد محدد المدة.</span>
                <input id="contractMonths" name="contractMonths" type="number" min={1} max={120} className="tmk-field__control" defaultValue={source?.contractMonths ?? ''} aria-describedby="months-hint" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="deliveryMode">مكان العمل</label>
                <select id="deliveryMode" name="deliveryMode" className="tmk-field__control" defaultValue={source?.deliveryMode ?? 'in_person'}>
                  <option value="in_person">حضوري</option>
                  <option value="remote">عن بُعد</option>
                  <option value="hybrid">مختلط</option>
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="city">المدينة</label>
                <input id="city" name="city" className="tmk-field__control" defaultValue={source?.city} maxLength={100} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="hoursPerWeek">ساعات أسبوعية</label>
                <input id="hoursPerWeek" name="hoursPerWeek" type="number" min={0} max={80} className="tmk-field__control" defaultValue={source?.hoursPerWeek ?? 0} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="openings">عدد الشواغر</label>
                <input id="openings" name="openings" type="number" min={1} max={10000} className="tmk-field__control" defaultValue={source?.openings ?? 1} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="closesAt">آخر موعد للتقديم</label>
                <input id="closesAt" name="closesAt" type="datetime-local" className="tmk-field__control"
                  defaultValue={source?.closesAt ? source.closesAt.slice(0, 16) : ''} />
              </div>
            </div>

            {/* 07: pay is stated or its absence is. The form makes the second a written answer
                rather than an empty field somebody skipped. */}
            <fieldset className="tmk-fieldset">
              <legend>الأجر</legend>
              <label className="tmk-choice" htmlFor="salaryDisclosed">
                <input id="salaryDisclosed" name="salaryDisclosed" type="checkbox" defaultChecked={source?.salaryDisclosed}
                  onChange={event => setDisclosePay(event.currentTarget.checked)} />
                <span>أعلن الأجر</span>
              </label>
              {disclosePay ? (
                <div className="tmk-grid tmk-grid--stats">
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="salaryMin">الحد الأدنى</label>
                    <input id="salaryMin" name="salaryMin" type="number" step="0.01" min="0" className="tmk-field__control"
                      defaultValue={source?.salaryMinMinor ? Number(source.salaryMinMinor) / 100 : ''} />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="salaryMax">الحد الأعلى</label>
                    <input id="salaryMax" name="salaryMax" type="number" step="0.01" min="0" className="tmk-field__control"
                      defaultValue={source?.salaryMaxMinor ? Number(source.salaryMaxMinor) / 100 : ''} />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="salaryCurrency">العملة</label>
                    <input id="salaryCurrency" name="salaryCurrency" className="tmk-field__control" maxLength={3} defaultValue={source?.salaryCurrency ?? 'ILS'} />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="salaryPeriod">الدورة</label>
                    <span className="tmk-field__hint" id="period-hint">مثل: شهريًا.</span>
                    <input id="salaryPeriod" name="salaryPeriod" className="tmk-field__control" maxLength={20} defaultValue={source?.salaryPeriod} aria-describedby="period-hint" />
                  </div>
                </div>
              ) : (
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="salaryUndisclosedReason">سبب عدم إعلان الأجر</label>
                  <span className="tmk-field__hint" id="undisclosed-hint">
                    مطلوب: ١٠ أحرف على الأقل. إعلان بلا أجر ولا سبب يترك الباحث عن عمل يخمّن، وهذا ما تمنعه المواصفة.
                  </span>
                  <input id="salaryUndisclosedReason" name="salaryUndisclosedReason" className="tmk-field__control" maxLength={200}
                    defaultValue={source?.salaryUndisclosedReason} aria-describedby="undisclosed-hint" />
                </div>
              )}
            </fieldset>

            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>{editing ? 'احفظ التعديل' : 'أنشئ المسودة'}</button>
              <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/jobs`)}>عد إلى الوظائف</a>
            </p>
          </form>
        </Card>

        {editing ? (
          <Card title="النشر والإغلاق">
            <p className="tmk-field__hint">
              التعديل ممنوع وهي مفتوحة: تغيير ما تقدم الناس إليه يحرّك الشروط من تحتهم. أوقفها مؤقتًا أولًا إن احتجت تعديلها.
            </p>
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy || !editing.readiness.ready || editing.state === 'open'}
                onClick={() => void act(async () => { await api(`/orgs/${orgId}/jobs/${editing.id}/publish`, 'POST', { version: editing.version }); }, 'نُشرت الوظيفة وصارت مفتوحة للتقديم.')}>
                انشر
              </button>
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy || !['open', 'paused'].includes(editing.state)}
                onClick={() => setClosing(editing)}>
                أغلق
              </button>
            </p>
            {!editing.readiness.ready ? <p className="tmk-field__hint">زر النشر معطّل لأن ما يمنعه مذكور أعلاه، لا لسبب مجهول.</p> : null}
          </Card>
        ) : null}
        {closing ? <CloseJobForm locale={locale} orgId={orgId} job={closing} busy={busy} onCancel={() => setClosing(null)} onDone={(text) => { setClosing(null); void act(async () => {}, text); }} setError={setError} /> : null}

        {/* PRG-07.A05. It creates an invitation, not a referral: nothing about the person reaches
            this organisation until they agree, and the card says so before the button rather than
            after it. */}
        {editing && editing.state === 'open' ? (
          <Card title="رشّح متدربًا لهذه الوظيفة">
            <Notice tone="info" title="الترشيح يحتاج موافقة الشخص">
              <p style={{ marginBlockEnd: 0 }}>
                لا يصلك عن المرشَّح شيء بمجرد ترشيحه. تصله دعوة، وإن وافق أُنشئ طلب باسمه وشورك ملف مهاراته معكم؛ وإن رفض لم يصلكم شيء.
              </p>
            </Notice>
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const target = event.currentTarget;
              void act(async () => {
                await api(`/orgs/${orgId}/jobs/${editing.id}/referrals`, 'POST', {
                  userId: String(form.get('userId') ?? ''),
                  note: String(form.get('note') ?? '')
                });
              }, 'أُرسلت دعوة الترشيح. لم يصلكم عن الشخص شيء بعد، وينتظر الأمر موافقته.');
              target.reset();
            }}>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="referUser">معرّف المتدرب</label>
                <span className="tmk-field__hint" id="refer-hint">
                  البحث عن المتدربين بالاسم ليس في هذه المرحلة: انسخ المعرّف من سجل الدفعة. لا تُرشّح من لا تعرف أنه يبحث عن عمل.
                </span>
                <input id="referUser" name="userId" className="tmk-field__control" required
                  pattern="[0-9a-fA-F-]{36}" aria-describedby="refer-hint" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="referNote">لماذا ترشّحه؟</label>
                <textarea id="referNote" name="note" className="tmk-field__control" rows={2} maxLength={1000} />
              </div>
              <p className="tmk-row__actions">
                <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>أرسل دعوة ترشيح</button>
              </p>
            </form>
          </Card>
        ) : editing ? (
          <Card title="رشّح متدربًا لهذه الوظيفة">
            <p className="tmk-field__hint">
              الترشيح متاح للوظائف المفتوحة فقط. هذه الوظيفة {jobStates[editing.state]?.text ?? editing.state}، فلا مكان يُرشَّح إليه الآن.
            </p>
          </Card>
        ) : null}
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="الوظائف"
        actions={<a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/jobs/new`)}>وظيفة جديدة</a>}
        lead="وظائف الجهة، بما فيها المسودات. الوظيفة شيء مستقل عن البرنامج التدريبي حتى لو خرجت منه." />

      <DataTable
        caption="وظائف الجهة"
        rows={jobs}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا وظائف" action={<a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/jobs/new`)}>أنشئ وظيفة</a>}>لم تنشئ وظيفة بعد.</EmptyState>}
        columns={[
          { key: 'title', header: 'المسمى', cell: row => <a href={L(`/org/${orgId}/jobs/${row.id}/edit`)}>{row.title}</a> },
          {
            key: 'state', header: 'الحالة', cell: row => (
              <>
                <StatusBadge tone={jobStates[row.state]?.tone ?? 'neutral'}>{jobStates[row.state]?.text ?? row.state}</StatusBadge>
                {row.publiclyVisible ? null : <span className="tmk-field__hint">غير ظاهرة للعامة</span>}
                {row.stateReason ? <span className="tmk-field__hint">{row.stateReason}</span> : null}
              </>
            )
          },
          { key: 'openings', header: 'الشواغر', numeric: true, cell: row => row.openings },
          { key: 'applications', header: 'الطلبات', numeric: true, cell: row => row.applicationCount },
          {
            key: 'closes', header: 'آخر موعد', cell: row => row.closesAt
              ? <>{formatDate(row.closesAt, locale)}{row.deadlinePassed ? <span className="tmk-field__hint">مضى</span> : null}</>
              : <span className="tmk-field__hint">غير محدد</span>
          },
          { key: 'actions', header: 'الإجراءات', cell: row => <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/jobs/${row.id}/edit`)}>افتح</a> }
        ]}
      />

      <p className="tmk-row__actions">
        <a className="tmk-button tmk-button--secondary" href={L(`/org/${orgId}/job-offers`)}>العروض والمرشحون</a>
        <a className="tmk-button tmk-button--secondary" href={L(`/org/${orgId}/placements`)}>التوظيف والمتابعة</a>
      </p>
    </>
  );
}

/**
 * PRG-07.A04. Closing, with the open candidacies named rather than silently dropped.
 *
 * The confirmation states the count, because the server refuses the close until the operator says
 * what happens to the people still waiting.
 */
function CloseJobForm({ locale, orgId, job, busy, onCancel, onDone, setError }: {
  locale: Locale; orgId: string; job: OrgJob; busy: boolean;
  onCancel: () => void; onDone: (notice: string) => void; setError: (value: string) => void;
}) {
  void locale;
  return (
    <Card title={`إغلاق: ${job.title}`}>
      <Notice tone="warning" title="ما يحدث للطلبات القائمة">
        <p style={{ marginBlockEnd: 0 }}>
          لهذه الوظيفة {job.applicationCount} طلبًا. الطلبات التي ما زالت قيد النظر تُرفض بسبب الإغلاق نفسه ويُعرض عليها، ولا تبقى معلّقة بلا جواب.
        </p>
      </Notice>
      <form onSubmit={event => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        void (async () => {
          try {
            const result = await api(`/orgs/${orgId}/jobs/${job.id}/close`, 'POST', {
              reason: String(form.get('reason') ?? ''),
              rejectOpen: true,
              version: job.version
            }) as { applicationsRejected: number };
            onDone(`أُغلقت الوظيفة، ورُفض ${result.applicationsRejected} طلبًا قائمًا بالسبب نفسه.`);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'تعذر الإغلاق.');
          }
        })();
      }}>
        <div className="tmk-field">
          <label className="tmk-field__label" htmlFor="closeReason">سبب الإغلاق</label>
          <span className="tmk-field__hint" id="close-hint">يُعرض على كل طلب يُرفض بسببه، فاكتبه بصيغة يفهمها المتقدم.</span>
          <input id="closeReason" name="reason" className="tmk-field__control" minLength={10} maxLength={200} required aria-describedby="close-hint" />
        </div>
        <p className="tmk-row__actions">
          <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>أغلق وارفض الطلبات القائمة</button>
          <button type="button" className="tmk-button tmk-button--quiet" onClick={onCancel}>تراجع</button>
        </p>
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-08 — candidates and offers
// ---------------------------------------------------------------------------------------------

interface EmployerApplication {
  id: string; reference: string; state: string; version: number; submittedAt: string | null;
  job: { id: string; title: string };
  candidate: { name: string; headline: string; city: string; skills: string[]; email: string | null } | null;
  profileShared: boolean; profileWithheldReason: string; viaReferral: boolean;
  nextInterview: { scheduledAt: string; state: string; timezone: string } | null;
  latestOffer: { id: string; sequence: number; state: string } | null;
}

/** What the row needs to know about the job an offer would be written against. */
interface JobCapacity { id: string; title: string; openings: number; contractType: string; remaining: number }

interface EmployerOffer {
  id: string; sequence: number; state: string; title: string; proposedStartDate: string;
  respondByAt: string; salaryMinor: string | null; salaryCurrency: string | null; version: number;
  application: { id: string; reference: string; state: string };
  job: { id: string; title: string };
  candidateName: string | null; profileShared: boolean;
  placement: { id: string; state: string; actualStartDate: string | null } | null;
  countsAsStarted: boolean;
}

const withheldReasons: Record<string, string> = {
  no_consent: 'لم يوافق المتقدم على مشاركة ملفه.',
  consent_revoked: 'سحب المتقدم موافقته على المشاركة.'
};

export function OrgJobOffers({ locale, orgId }: { locale: Locale; orgId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [applications, setApplications] = useState<EmployerApplication[] | null>(null);
  const [offers, setOffers] = useState<EmployerOffer[]>([]);
  const [capacity, setCapacity] = useState<JobCapacity[]>([]);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [offering, setOffering] = useState<EmployerApplication | null>(null);
  const [rejecting, setRejecting] = useState<EmployerApplication | null>(null);
  // An inline form rather than a browser prompt: a modal dialog cannot be read by the same
  // assistive technology as the rest of the page, and it has no place to explain itself.
  const [withdrawing, setWithdrawing] = useState<EmployerOffer | null>(null);

  const load = useCallback(async () => {
    const [apps, made, jobs, places] = await Promise.all([
      api(`/orgs/${orgId}/job-applications`) as Promise<EmployerApplication[]>,
      api(`/orgs/${orgId}/job-offers`) as Promise<EmployerOffer[]>,
      api(`/orgs/${orgId}/jobs`) as Promise<OrgJob[]>,
      api(`/orgs/${orgId}/placements`) as Promise<OrgPlacement[]>
    ]);
    // The openings a job still has, worked out the same way the server does: a placement that has
    // not ended holds one, and so does every offer still live. Without this the screen would invite
    // an operator to write an offer the server is about to refuse.
    setCapacity(jobs.map(job => {
      const held = places.filter(place => place.job.id === job.id && ['start_pending', 'started', 'retained'].includes(place.state)).length;
      const live = made.filter(offer => offer.job.id === job.id && ['draft', 'sent'].includes(offer.state)).length;
      return { id: job.id, title: job.title, openings: job.openings, contractType: job.contractType, remaining: job.openings - held - live };
    }));
    setApplications(apps); setOffers(made);
  }, [orgId]);

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
    <AppShell locale={locale} path={`/org/${orgId}/job-offers`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/jobs`)}>الوظائف</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/org/${orgId}/job-offers`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!applications) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  return shell(
    <>
      <PageHeader dashboard title="المرشحون والعروض"
        lead="طلبات التوظيف والعروض المرسلة. قبول المرشح للعرض لا يعني أنه بدأ العمل، والعمود الأخير يُظهر حالة التوظيف الحقيقية لا حالة العرض." />

      <Card title="الطلبات">
        <DataTable
          caption="طلبات التوظيف"
          rows={applications}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا طلبات">لم يصل طلب بعد.</EmptyState>}
          columns={[
            { key: 'job', header: 'الوظيفة', cell: row => row.job.title },
            {
              key: 'candidate', header: 'المرشح', cell: row => row.candidate
                ? (
                  <>
                    <strong>{row.candidate.name}</strong>
                    <span className="tmk-field__hint">{row.candidate.headline}{row.candidate.city ? ` — ${row.candidate.city}` : ''}</span>
                    {row.candidate.email ? <span className="tmk-field__hint">{row.candidate.email}</span> : null}
                    {row.viaReferral ? <span className="tmk-field__hint">وصل عبر ترشيح وافق عليه</span> : null}
                  </>
                )
                : (
                  <>
                    <span className="tmk-field__hint">{withheldReasons[row.profileWithheldReason] ?? 'الملف غير مشارك.'}</span>
                    <span className="tmk-field__hint">المرجع: {row.reference}</span>
                  </>
                )
            },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={applicationStates[row.state]?.tone ?? 'neutral'}>{applicationStates[row.state]?.text ?? row.state}</StatusBadge> },
            {
              key: 'interview', header: 'المقابلة', cell: row => row.nextInterview
                ? <>{formatDate(row.nextInterview.scheduledAt, locale)} <span className="tmk-field__hint">({row.nextInterview.timezone})</span></>
                : <span className="tmk-field__hint">—</span>
            },
            {
              key: 'actions', header: 'الإجراءات', cell: row => {
                const open = ['submitted', 'screening', 'shortlisted', 'interview'].includes(row.state);
                if (!open) return <span className="tmk-field__hint">—</span>;
                const seats = capacity.find(job => job.id === row.job.id);
                // Every reason an offer cannot be written is named here rather than left to a
                // greyed-out button the operator has to guess at — or worse, left enabled until
                // the server refuses a form they had already filled in.
                const blocked = row.state !== 'shortlisted'
                  ? 'لكتابة عرض انقل الطلب إلى القائمة القصيرة أولًا.'
                  : seats && seats.remaining <= 0
                    ? `لا شواغر متبقية في هذه الوظيفة. الشواغر المعلنة: ${seats.openings}، وكلها مشغولة بعروض قائمة أو بتوظيف. عدّل عدد الشواغر أو اسحب عرضًا قائمًا.`
                    : '';
                return (
                  <>
                    <button type="button" className="tmk-button tmk-button--secondary" disabled={busy || !row.profileShared || row.state === 'shortlisted'}
                      onClick={() => void act(async () => { await api(`/orgs/${orgId}/job-applications/${row.id}/decision`, 'POST', { outcome: 'shortlisted', version: row.version }); }, 'نُقل الطلب إلى القائمة القصيرة.')}>
                      قائمة قصيرة
                    </button>
                    <button type="button" className="tmk-button tmk-button--primary" disabled={busy || blocked !== ''}
                      onClick={() => setOffering(row)}>
                      اكتب عرضًا
                    </button>
                    <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => setRejecting(row)}>ارفض</button>
                    {!row.profileShared ? <span className="tmk-field__hint">لا يمكن تقييم طلب بلا ملف مشارك.</span> : null}
                    {blocked ? <span className="tmk-field__hint">{blocked}</span> : null}
                  </>
                );
              }
            }
          ]}
        />
      </Card>

      {rejecting ? (
        <Card title={`رفض الطلب ${rejecting.reference}`}>
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void act(async () => {
              await api(`/orgs/${orgId}/job-applications/${rejecting.id}/decision`, 'POST', {
                outcome: 'rejected', reason: String(form.get('reason') ?? ''), version: rejecting.version
              });
            }, 'سُجِّل الرفض، والسبب يقرؤه المتقدم.');
            setRejecting(null);
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="rejectReason">سبب الرفض</label>
              <span className="tmk-field__hint" id="reject-hint">يقرؤه المتقدم بنصه، فاكتبه له لا لسجلك.</span>
              <textarea id="rejectReason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required aria-describedby="reject-hint" />
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>أكّد الرفض</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setRejecting(null)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      {offering ? (
        <Card title={`عرض للمرشح على: ${offering.job.title}`}>
          <Notice tone="info" title="العرض نسخة ثابتة">
            <p style={{ marginBlockEnd: 0 }}>
              بعد الإرسال لا يمكن تعديل نص العرض. أي تغيير عرض جديد برقم نسخة جديد، ليعرف المرشح دائمًا أي نص وافق عليه.
            </p>
          </Notice>
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const salary = String(form.get('salary') ?? '').trim();
            void act(async () => {
              await api(`/orgs/${orgId}/job-offers`, 'POST', {
                jobApplicationId: offering.id,
                title: String(form.get('title') ?? ''),
                terms: String(form.get('terms') ?? ''),
                contractType: String(form.get('contractType') ?? 'full_time'),
                contractMonths: String(form.get('contractMonths') ?? '').trim() === '' ? null : Number(form.get('contractMonths')),
                salaryMinor: salary === '' ? null : String(Math.round(Number(salary) * 100)),
                salaryCurrency: salary === '' ? null : String(form.get('salaryCurrency') ?? 'ILS'),
                salaryPeriod: String(form.get('salaryPeriod') ?? ''),
                proposedStartDate: String(form.get('proposedStartDate') ?? ''),
                respondByAt: new Date(String(form.get('respondByAt'))).toISOString()
              });
            }, 'أُنشئ العرض كمسودة. أرسله من جدول العروض أدناه حين يصبح جاهزًا.');
            setOffering(null);
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="offerTitle">عنوان العرض</label>
              <input id="offerTitle" name="title" className="tmk-field__control" minLength={4} maxLength={200} required defaultValue={offering.job.title} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="terms">الشروط</label>
              <span className="tmk-field__hint" id="terms-hint">٢٠ حرفًا على الأقل: هذا ما سيوافق عليه المرشح بالضبط.</span>
              <textarea id="terms" name="terms" className="tmk-field__control" rows={6} minLength={20} maxLength={4000} required aria-describedby="terms-hint" />
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="offerContractType">نوع العقد</label>
                <span className="tmk-field__hint" id="offer-contract-hint">
                  مبدئيًا نوع العقد المعلن في الوظيفة. غيّره إن كان العرض مختلفًا، ولا تترك النص يقول شيئًا والحقل يقول غيره.
                </span>
                <select id="offerContractType" name="contractType" className="tmk-field__control"
                  defaultValue={capacity.find(job => job.id === offering.job.id)?.contractType ?? 'full_time'}
                  aria-describedby="offer-contract-hint">
                  {Object.entries(contractTypes).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="offerContractMonths">المدة بالأشهر</label>
                <input id="offerContractMonths" name="contractMonths" type="number" min={1} max={120} className="tmk-field__control" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="salary">الأجر</label>
                <input id="salary" name="salary" type="number" step="0.01" min="0" className="tmk-field__control" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="offerCurrency">العملة</label>
                <input id="offerCurrency" name="salaryCurrency" className="tmk-field__control" maxLength={3} defaultValue="ILS" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="offerPeriod">الدورة</label>
                <input id="offerPeriod" name="salaryPeriod" className="tmk-field__control" maxLength={20} defaultValue="شهريًا" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="proposedStartDate">تاريخ البدء المقترح</label>
                <input id="proposedStartDate" name="proposedStartDate" type="date" className="tmk-field__control" required />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="respondByAt">آخر موعد للرد</label>
                <span className="tmk-field__hint" id="respond-hint">يجب ألا يتجاوز تاريخ البدء المقترح: مهلة بعد أول يوم عمل لا تجيب عن شيء.</span>
                <input id="respondByAt" name="respondByAt" type="datetime-local" className="tmk-field__control" required aria-describedby="respond-hint" />
              </div>
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>أنشئ مسودة العرض</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setOffering(null)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      {withdrawing ? (
        <Card title={`سحب العرض (النسخة ${withdrawing.sequence})`}>
          <Notice tone="warning" title="السحب قبل القبول فقط">
            <p style={{ marginBlockEnd: 0 }}>
              بعد قبول المرشح لا يُسحب العرض: يكون التوظيف قد نشأ، وإنهاؤه يُسجَّل كتوظيف منتهٍ بسببه لا كعرض مسحوب بصمت.
            </p>
          </Notice>
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void act(async () => {
              await api(`/job-offers/${withdrawing.id}/withdraw`, 'POST', { reason: String(form.get('reason') ?? ''), version: withdrawing.version });
            }, 'سُحب العرض، وعاد الطلب إلى القائمة القصيرة لا إلى الرفض.');
            setWithdrawing(null);
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="withdrawReason">سبب السحب</label>
              <span className="tmk-field__hint" id="withdraw-hint">يقرؤه المرشح بنصه.</span>
              <textarea id="withdrawReason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required aria-describedby="withdraw-hint" />
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>أكّد السحب</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setWithdrawing(null)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      <Card title="العروض">
        <DataTable
          caption="العروض الوظيفية"
          rows={offers}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا عروض">لم تُنشئ عرضًا بعد.</EmptyState>}
          columns={[
            { key: 'job', header: 'الوظيفة', cell: row => row.job.title },
            { key: 'candidate', header: 'المرشح', cell: row => row.candidateName ?? <span className="tmk-field__hint">الملف غير مشارك — {row.application.reference}</span> },
            { key: 'sequence', header: 'النسخة', numeric: true, cell: row => row.sequence },
            { key: 'state', header: 'حالة العرض', cell: row => <StatusBadge tone={offerStates[row.state]?.tone ?? 'neutral'}>{offerStates[row.state]?.text ?? row.state}</StatusBadge> },
            { key: 'salary', header: 'الأجر', cell: row => money(row.salaryMinor, row.salaryCurrency) ?? <span className="tmk-field__hint">غير مذكور</span> },
            { key: 'respondBy', header: 'مهلة الرد', cell: row => formatDate(row.respondByAt, locale) },
            {
              // JOB-01 made visible in the one place an operator would otherwise read acceptance as
              // a hire: the column shows the placement, not the offer.
              key: 'placement', header: 'حالة التوظيف', cell: row => row.placement
                ? (
                  <>
                    <StatusBadge tone={placementStates[row.placement.state]?.tone ?? 'neutral'}>{placementStates[row.placement.state]?.text ?? row.placement.state}</StatusBadge>
                    {row.placement.actualStartDate ? <span className="tmk-field__hint">بدأ في {formatDate(row.placement.actualStartDate, locale)}</span> : <span className="tmk-field__hint">لم يُؤكد بدء العمل</span>}
                  </>
                )
                : <span className="tmk-field__hint">لا توظيف بعد</span>
            },
            {
              key: 'actions', header: 'الإجراءات', cell: row => (
                <>
                  {row.state === 'draft' ? (
                    <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                      onClick={() => void act(async () => { await api(`/job-offers/${row.id}/send`, 'POST', { version: row.version }); }, 'أُرسل العرض، ونصه مجمّد من الآن.')}>
                      أرسل
                    </button>
                  ) : null}
                  {['draft', 'sent'].includes(row.state) ? (
                    <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => setWithdrawing(row)}>
                      اسحب
                    </button>
                  ) : null}
                  {row.state === 'accepted' ? <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/placements`)}>تابع البدء</a> : null}
                </>
              )
            }
          ]}
        />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-09 — placements and follow-up
// ---------------------------------------------------------------------------------------------

interface OrgPlacement {
  id: string; state: string; proposedStartDate: string; actualStartDate: string | null;
  startConfirmed: boolean; countsAsEmployment: boolean; disputeReason: string; endReason: string;
  selfFound: boolean; version: number;
  job: { id: string; slug: string; title: string };
  candidateName: string | null; profileShared: boolean; profileWithheldReason: string;
  confirmedByEmployer: boolean; confirmedByCandidate: boolean;
  followups: Array<{ id: string; dayOffset: number; dueAt: string; result: string; source: string; answered: boolean; due: boolean; version: number }>;
  followupsDue: number;
  latestReview: { outcome: string; reason: string; createdAt: string } | null;
}

interface PlacementSummary {
  offersAccepted: number; startsConfirmed: number; startsPending: number; ended: number;
  disputed: number; selfFound: number;
  retention: { denominator: number; denominatorDefinition: string; answered: number; working: number; unknown: number };
  redacted: boolean; containsPersonalData: boolean;
}

export function OrgPlacements({ locale, orgId }: { locale: Locale; orgId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [placements, setPlacements] = useState<OrgPlacement[] | null>(null);
  const [summary, setSummary] = useState<PlacementSummary | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState<OrgPlacement | null>(null);
  const [recording, setRecording] = useState<{ placement: OrgPlacement; dayOffset: number } | null>(null);
  const [reviewing, setReviewing] = useState<OrgPlacement | null>(null);
  const [exportUnavailable, setExportUnavailable] = useState('');

  const load = useCallback(async () => setPlacements(await api(`/orgs/${orgId}/placements`) as OrgPlacement[]), [orgId]);

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
    <AppShell locale={locale} path={`/org/${orgId}/placements`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/jobs`)}>الوظائف</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/org/${orgId}/placements`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!placements) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const today = new Date().toISOString().slice(0, 10);

  return shell(
    <>
      <PageHeader dashboard title="التوظيف والمتابعة"
        lead="من قبل عرضًا، ومن بدأ فعلًا، وماذا قالت نقاط المتابعة. الفرق بين الاثنين الأولين مقصود ولا يُجمعان." />

      <Notice tone="info" title="ما يُحتسب توظيفًا">
        <p style={{ marginBlockEnd: 0 }}>
          قبول العرض ليس بدء عمل. لا يدخل التوظيف في أي رقم قبل تأكيد تاريخ بدء فعلي من الطرفين — الجهة والشخص — أو بقرار مراجعة مستند إلى دليل.
          نقطتا المتابعة تُحسبان من تاريخ البدء الفعلي، و«لا جواب» نتيجة مسجَّلة لا فراغ.
        </p>
      </Notice>

      <DataTable
        caption="التوظيف"
        rows={placements}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا توظيف بعد">لم يقبل أحد عرضًا حتى الآن.</EmptyState>}
        columns={[
          { key: 'job', header: 'الوظيفة', cell: row => row.job.title },
          { key: 'person', header: 'الشخص', cell: row => row.candidateName ?? <span className="tmk-field__hint">{withheldReasons[row.profileWithheldReason] ?? 'الملف غير مشارك.'}</span> },
          {
            key: 'state', header: 'الحالة', cell: row => (
              <>
                <StatusBadge tone={placementStates[row.state]?.tone ?? 'neutral'}>{placementStates[row.state]?.text ?? row.state}</StatusBadge>
                {row.selfFound ? <span className="tmk-field__hint">وجد العمل بنفسه — يُذكر منفصلًا</span> : null}
                {row.disputeReason ? <span className="tmk-field__hint">{row.disputeReason}</span> : null}
              </>
            )
          },
          {
            key: 'start', header: 'البدء', cell: row => row.actualStartDate
              ? <>{formatDate(row.actualStartDate, locale)}<span className="tmk-field__hint">فعلي ومؤكد</span></>
              : (
                <>
                  <span className="tmk-field__hint">مقترح: {formatDate(row.proposedStartDate, locale)}</span>
                  <span className="tmk-field__hint">
                    {row.confirmedByEmployer && !row.confirmedByCandidate ? 'أكّدت الجهة — بانتظار الشخص'
                      : row.confirmedByCandidate && !row.confirmedByEmployer ? 'أكّد الشخص — بانتظار الجهة'
                        : 'لم يؤكد أي طرف'}
                  </span>
                </>
              )
          },
          {
            key: 'followups', header: 'المتابعة', cell: row => row.followups.length
              ? row.followups.map(followup => (
                <span key={followup.id} style={{ display: 'block' }}>
                  {followup.dayOffset} يومًا:{' '}
                  <StatusBadge tone={followupResults[followup.result]?.tone ?? 'neutral'}>{followupResults[followup.result]?.text ?? followup.result}</StatusBadge>
                  {followup.due ? <span className="tmk-field__hint">مستحقة ولم تُجب</span> : null}
                </span>
              ))
              : <span className="tmk-field__hint">تُنشأ عند تأكيد البدء</span>
          },
          {
            key: 'actions', header: 'الإجراءات', cell: row => (
              <>
                {!row.startConfirmed && !row.confirmedByEmployer ? (
                  <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => setConfirming(row)}>
                    سجّل بدء العمل
                  </button>
                ) : null}
                {row.followups.filter(followup => followup.due).map(followup => (
                  <span key={followup.id} style={{ display: 'block' }}>
                    {/* PRG-09.A01 and A02 are two buttons on purpose: one asks, one records. */}
                    <button type="button" className="tmk-button tmk-button--quiet" disabled={busy}
                      onClick={() => void act(async () => { await api(`/placements/${row.id}/followup-requests`, 'POST', { dayOffset: followup.dayOffset }); }, `أُرسل طلب متابعة عن النقطة بعد ${followup.dayOffset} يومًا. لم تُسجَّل أي نتيجة بهذا الطلب.`)}>
                      اطلب متابعة ({followup.dayOffset})
                    </button>
                    <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                      onClick={() => setRecording({ placement: row, dayOffset: followup.dayOffset })}>
                      سجّل نتيجة ({followup.dayOffset})
                    </button>
                  </span>
                ))}
                {row.state === 'disputed' ? (
                  <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setReviewing(row)}>افصل في الخلاف</button>
                ) : null}
                {/* An empty cell reads as a missing control. Where there is genuinely nothing to
                    do, the row says which of the two reasons it is. */}
                {row.state !== 'disputed' && (row.startConfirmed || row.confirmedByEmployer) && row.followupsDue === 0 ? (
                  <span className="tmk-field__hint">
                    {row.startConfirmed
                      ? 'لا إجراء مستحق: لم يحن موعد أي نقطة متابعة بعد.'
                      : 'سجّلت الجهة تأكيدها، والأمر بانتظار الشخص.'}
                  </span>
                ) : null}
              </>
            )
          }
        ]}
      />

      {confirming ? (
        <Card title="تسجيل بدء العمل من جهة العمل">
          <Notice tone="warning" title="تأكيد طرف واحد ليس بدءًا">
            <p style={{ marginBlockEnd: 0 }}>
              تسجيلك يُحفظ كتأكيد الجهة. لا يُحتسب بدء العمل حتى يؤكد الشخص التاريخ نفسه. إن اختلف التاريخان انتقل التوظيف إلى «محل خلاف» وتنظر فيه مراجعة مستقلة.
            </p>
          </Notice>
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void act(async () => {
              await api(`/placements/${confirming.id}/start-confirmations`, 'POST', {
                startDate: String(form.get('startDate') ?? ''),
                evidenceRef: String(form.get('evidenceRef') ?? ''),
                asEmployer: true
              });
            }, 'سُجِّل تأكيد الجهة. راجع العمود لمعرفة ما إذا كان التوظيف قد بدأ فعلًا أم ما زال بانتظار الطرف الآخر.');
            setConfirming(null);
          }}>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="empStartDate">تاريخ أول يوم عمل فعلي</label>
                <span className="tmk-field__hint" id="emp-start-hint">يومٌ مضى. التاريخ المستقبلي مرفوض.</span>
                <input id="empStartDate" name="startDate" type="date" max={today} className="tmk-field__control" required aria-describedby="emp-start-hint" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="empEvidence">مرجع الدليل</label>
                <input id="empEvidence" name="evidenceRef" className="tmk-field__control" maxLength={200} />
              </div>
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>سجّل التأكيد</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setConfirming(null)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      {recording ? (
        <Card title={`تسجيل نتيجة المتابعة بعد ${recording.dayOffset} يومًا`}>
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const followup = recording.placement.followups.find(row => row.dayOffset === recording.dayOffset);
            if (!followup) return;
            const result = String(form.get('result') ?? 'unknown');
            void act(async () => {
              await api(`/placements/${recording.placement.id}/followups`, 'POST', {
                dayOffset: recording.dayOffset,
                result,
                ...(result === 'unknown' ? {} : { source: String(form.get('source') ?? '') }),
                evidenceRef: String(form.get('evidenceRef') ?? ''),
                note: String(form.get('note') ?? ''),
                selfFound: form.get('selfFound') === 'on',
                version: followup.version
              });
            }, result === 'unknown'
              ? 'سُجِّل عدم وجود جواب. تبقى النتيجة «غير معروف» وتُحتسب كذلك في التقرير، ولا تُحسب استمرارًا.'
              : 'سُجِّلت نتيجة المتابعة بمصدرها.');
            setRecording(null);
          }}>
            <fieldset className="tmk-fieldset">
              <legend>النتيجة</legend>
              <label className="tmk-choice" htmlFor="op-working">
                <input id="op-working" name="result" type="radio" value="working" defaultChecked />
                <span>ما زال على رأس العمل</span>
              </label>
              <label className="tmk-choice" htmlFor="op-ended">
                <input id="op-ended" name="result" type="radio" value="ended" />
                <span>انتهى العمل</span>
              </label>
              {/* JOB-02: offered plainly, with the same weight, and it writes no source. */}
              <label className="tmk-choice" htmlFor="op-unknown">
                <input id="op-unknown" name="result" type="radio" value="unknown" />
                <span>لم نحصل على جواب — تُسجَّل «غير معروف»</span>
              </label>
              <label className="tmk-choice" htmlFor="op-disputed">
                <input id="op-disputed" name="result" type="radio" value="disputed" />
                <span>محل خلاف</span>
              </label>
            </fieldset>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="opSource">مصدر الجواب</label>
              <span className="tmk-field__hint" id="op-source-hint">
                مطلوب لكل نتيجة عدا «غير معروف»: من قال هذا ومتى. الخادم يرفض نتيجة بلا مصدر، وكذلك قيد في قاعدة البيانات.
              </span>
              <input id="opSource" name="source" className="tmk-field__control" maxLength={120} aria-describedby="op-source-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="opEvidence">مرجع الدليل</label>
              <input id="opEvidence" name="evidenceRef" className="tmk-field__control" maxLength={200} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="opNote">ملاحظة</label>
              <textarea id="opNote" name="note" className="tmk-field__control" rows={2} maxLength={1000} />
            </div>
            <label className="tmk-choice" htmlFor="selfFound">
              <input id="selfFound" name="selfFound" type="checkbox" />
              <span>وجد هذا العمل بنفسه لا عبر البرنامج — يُذكر في التقرير منفصلًا</span>
            </label>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>سجّل النتيجة</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setRecording(null)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      {reviewing ? (
        <Card title="الفصل في الخلاف">
          <Notice tone="info" title="من يفصل">
            <p style={{ marginBlockEnd: 0 }}>
              هذا الإجراء يحتاج صلاحية placement.review، وهي ليست من صلاحيات المسؤول عن التوظيف: من سجّل الرقم لا يصادق عليه. ولا يفصل أحد في بدءٍ أكّده هو بنفسه.
            </p>
          </Notice>
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const outcome = String(form.get('outcome') ?? 'reject_start');
            void act(async () => {
              await api(`/placements/${reviewing.id}/review-decisions`, 'POST', {
                outcome,
                reason: String(form.get('reason') ?? ''),
                ...(outcome === 'confirm_start' ? { startDate: String(form.get('startDate') ?? ''), evidenceRef: String(form.get('evidenceRef') ?? '') } : {}),
                version: reviewing.version
              });
            }, 'سُجِّل القرار. سجل القرارات لا يُعدَّل ولا يُحذف.');
            setReviewing(null);
          }}>
            <fieldset className="tmk-fieldset">
              <legend>القرار</legend>
              <label className="tmk-choice" htmlFor="rv-confirm">
                <input id="rv-confirm" name="outcome" type="radio" value="confirm_start" />
                <span>أثبت بدء العمل بتاريخ ودليل</span>
              </label>
              <label className="tmk-choice" htmlFor="rv-reject">
                <input id="rv-reject" name="outcome" type="radio" value="reject_start" defaultChecked />
                <span>ارفض إثبات البدء — يعود إلى «بانتظار تأكيد البدء»</span>
              </label>
              <label className="tmk-choice" htmlFor="rv-end">
                <input id="rv-end" name="outcome" type="radio" value="confirm_end" />
                <span>أثبت انتهاء العمل</span>
              </label>
              <label className="tmk-choice" htmlFor="rv-reinstate">
                <input id="rv-reinstate" name="outcome" type="radio" value="reinstate" />
                <span>أعده إلى «بدأ العمل»</span>
              </label>
            </fieldset>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="rvStartDate">تاريخ البدء (لإثبات البدء)</label>
                <input id="rvStartDate" name="startDate" type="date" max={today} className="tmk-field__control" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="rvEvidence">مرجع الدليل (لإثبات البدء)</label>
                <input id="rvEvidence" name="evidenceRef" className="tmk-field__control" maxLength={200} />
              </div>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="rvReason">التعليل</label>
              <textarea id="rvReason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required />
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>سجّل القرار</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setReviewing(null)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      {/* PRG-09.A04. `report.read`, which a recruiter does not hold: the screen says so instead of
          rendering a button that would 403. */}
      <Card title="تقرير الأثر">
        <p className="tmk-field__hint">
          أرقام مجردة بلا أسماء ولا بيانات اتصال، ومع تعريف المقام مكتوبًا: نسبة الاستمرار تُحسب على من مضى على بدئهم الفعلي ٩٠ يومًا، لا على كل من قبل عرضًا.
        </p>
        <p className="tmk-row__actions">
          <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
            onClick={() => void (async () => {
              setBusy(true); setError(''); setExportUnavailable('');
              try { setSummary(await api(`/orgs/${orgId}/placement-exports`, 'POST') as PlacementSummary); }
              catch (e) {
                if (e instanceof Error && e.message.startsWith('لا تملك صلاحية')) setExportUnavailable('تقرير الأثر يحتاج صلاحية report.read. صلاحية التوظيف وحدها لا تكفي، وهذا مقصود: من يجمع الأرقام ليس بالضرورة من ينشرها.');
                else setError(e instanceof Error ? e.message : 'تعذر إنشاء التقرير.');
              }
              finally { setBusy(false); }
            })()}>
            اعرض التقرير
          </button>
        </p>
        {exportUnavailable ? <Notice tone="warning" title="التقرير غير متاح لك"><p style={{ marginBlockEnd: 0 }}>{exportUnavailable}</p></Notice> : null}
        {summary ? (
          <>
            <div className="tmk-grid tmk-grid--stats">
              <Stat label="عروض مقبولة" value={summary.offersAccepted} note="ليست توظيفًا" />
              <Stat label="بدء مؤكَّد" value={summary.startsConfirmed} note="بتاريخ فعلي مؤكد" />
              <Stat label="بانتظار تأكيد البدء" value={summary.startsPending} />
              <Stat label="انتهى" value={summary.ended} />
              <Stat label="محل خلاف" value={summary.disputed} />
              <Stat label="وجدوا العمل بأنفسهم" value={summary.selfFound} note="يُذكر منفصلًا" />
            </div>
            <Card title="الاستمرار بعد ٩٠ يومًا" headingLevel={3}>
              <dl className="tmk-definitions">
                {/* The server sends a machine code; the sentence a reader sees is written here, in
                    the language of the screen. An English definition on an Arabic page is the same
                    class of leak as an untranslated state name. */}
                <div>
                  <dt>المقام</dt>
                  <dd>
                    {summary.retention.denominator} — {denominatorText[summary.retention.denominatorDefinition] ?? summary.retention.denominatorDefinition}
                  </dd>
                </div>
                <div><dt>أجابوا</dt><dd>{summary.retention.answered}</dd></div>
                <div><dt>ما زالوا على رأس العمل</dt><dd>{summary.retention.working}</dd></div>
                <div><dt>لا جواب — غير معروف</dt><dd>{summary.retention.unknown}</dd></div>
              </dl>
              <p className="tmk-field__hint">
                «غير معروف» رقم قائم بذاته ولا يُضاف إلى أي من العمودين الآخرين. عدد الذين على رأس العمل ليس نسبة إلى من أجابوا بل إلى المقام أعلاه.
              </p>
            </Card>
          </>
        ) : null}
      </Card>
    </>
  );
}
