'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Ltr, MoneyAmount, Notice, PageHeader,
  Skeleton, Stat, StatusBadge, formatDate, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * PART-08 screens: PER-07 investor eligibility, BUS-01/02 the offering list and editor, BUS-03 the
 * data room, and ADM-04 the independent review.
 *
 * What these screens must get right, because getting it wrong misleads someone about money:
 *
 *  - **A capability is not eligibility.** PER-07 shows both facts separately and never lets the
 *    first look like the second.
 *  - **Two percentages, never one.** A subscription is a share of the *offering* and a much smaller
 *    share of the *company*. Both are labelled; the second is the one in the larger type.
 *  - **Nothing here takes money.** Interest reserves nothing, and the page says so in words rather
 *    than leaving the reader to infer it.
 */

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' | 'PATCH' | 'PUT' = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) => {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'include',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...extraHeaders },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const payload = await response.json().catch(() => ({}));
  if (response.status === 401) throw new UnauthenticatedError('unauthenticated');
  if (!response.ok) throw new Error(message(payload?.error?.code, response.status));
  return payload.data;
};

function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء.',
    not_found: 'المورد غير موجود ضمن نطاقك.',
    conflict: 'تغيّرت الحالة أو البيانات: قد يكون العرض قيد المراجعة، أو الإفصاح تغيّر، أو النسخة قديمة.',
    invalid_input: 'تحقق من الحقول: الأعداد صحيحة موجبة، والحد الأدنى للاكتتاب يشتري سهمًا كاملًا على الأقل.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

const offeringStates: Record<string, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  submitted: { text: 'أُرسل للمراجعة', tone: 'warning' },
  due_diligence: { text: 'تحت العناية الواجبة', tone: 'info' },
  changes_requested: { text: 'طلب تعديلات', tone: 'warning' },
  rejected: { text: 'مرفوض', tone: 'danger' },
  approved: { text: 'معتمد — لم يُفتح بعد', tone: 'info' },
  open: { text: 'مفتوح للاكتتاب', tone: 'success' },
  suspended: { text: 'موقوف', tone: 'warning' },
  closing: { text: 'أُغلق الاكتتاب', tone: 'neutral' },
  failed: { text: 'لم يبلغ الحد الأدنى', tone: 'danger' },
  allocated: { text: 'مُخصَّص', tone: 'success' },
  reporting: { text: 'مرحلة التقارير', tone: 'info' },
  closed: { text: 'مغلق', tone: 'neutral' }
};

const eligibilityStates: Record<string, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  not_started: { text: 'لم تبدأ', tone: 'neutral' },
  draft: { text: 'مسودة', tone: 'neutral' },
  submitted: { text: 'قيد المراجعة', tone: 'warning' },
  in_review: { text: 'تحت المراجعة', tone: 'info' },
  changes_requested: { text: 'طلب استكمال', tone: 'warning' },
  approved: { text: 'مؤهَّل', tone: 'success' },
  rejected: { text: 'مرفوض', tone: 'danger' },
  expired: { text: 'انتهت صلاحية الأهلية', tone: 'danger' }
};

const blockerLabels: Record<string, string> = {
  current_shares_missing: 'عدد أسهم الشركة الحالية غير محدد.',
  shares_offered_missing: 'عدد الأسهم المعروضة غير محدد.',
  price_missing: 'سعر السهم غير محدد.',
  minimum_raise_missing: 'الحد الأدنى للجمع غير محدد.',
  minimum_above_maximum: 'الحد الأدنى للجمع يتجاوز ما يمكن جمعه لو بيعت كل الأسهم — لا يمكن بلوغه أبدًا.',
  ticket_below_share_price: 'الحد الأدنى للاكتتاب أقل من سعر سهم واحد، ولا توجد أسهم كسرية.',
  ticket_not_whole_shares: 'الحد الأدنى للاكتتاب ليس مضاعفًا لسعر السهم، فسيتبقى مبلغ لا يشتري سهمًا في كل مرة.',
  ticket_range_inverted: 'الحد الأقصى للاكتتاب أقل من الحد الأدنى.',
  ticket_above_offering: 'الحد الأقصى للاكتتاب يتجاوز حجم العرض كله.',
  disclosure_missing: 'لا يوجد إفصاح منشور.',
  deadline_missing: 'تاريخ إغلاق العرض غير محدد.',
  deadline_in_past: 'تاريخ الإغلاق في الماضي.',
  use_of_funds_missing: 'أوجه استخدام التمويل غير محددة.'
};

/** ADM-04.A03. A schedule waiting for the decision that is the only thing that issues a share. */
interface AllocationRequestRow {
  id: string; offeringId: string; offeringTitle: string; organization: string; ventureLegalName: string;
  currency: string; totalUnits: string; totalMinor: string; minimumRaiseMinor: string;
  minimumReached: boolean; lineCount: number; checksum: string; version: number;
  requestedAt: string; decidableByYou: boolean;
}

interface Context { organization: { id: string; displayName: string }; permissions: string[] }
interface Me { user: { id: string }; contexts: Context[]; platformRoles: string[] }

const toMinor = (major: string) => {
  const cleaned = major.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('أدخل مبلغًا صحيحًا مثل 10 أو 10.50.');
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (minor === '0') throw new Error('المبلغ يجب أن يكون أكبر من صفر.');
  return minor;
};
const digits = (value: string) => {
  const cleaned = value.trim().replace(/,/g, '');
  if (!/^\d{1,16}$/.test(cleaned)) throw new Error('أدخل عددًا صحيحًا من الأسهم.');
  return cleaned.replace(/^0+(?=\d)/, '');
};

// ---------------------------------------------------------------------------------------------
// PER-07 — investor eligibility
// ---------------------------------------------------------------------------------------------

interface Eligibility {
  state: string; draft: Record<string, unknown> | null; expiresAt: string | null; reason: string;
  version: number; capabilityChosen: boolean; eligible: boolean;
  submissions: Array<{ id: string; sequence: number; checksum: string; submittedAt: string }>;
  decisions: Array<{ id: string; outcome: string; reason: string; expiresAt: string | null; reviewer: string; at: string }>;
}

export function InvestorEligibility({ locale }: { locale: Locale }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [record, setRecord] = useState<Eligibility | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => setRecord(await api('/me/investor-eligibility') as Eligibility), []);

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

  async function action(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await work()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  }

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path="/app/investor/eligibility" signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn || !record) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L('/app/investor/eligibility'))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }

  const state = eligibilityStates[record.state] ?? { text: record.state, tone: 'neutral' as const };
  const editable = ['not_started', 'draft', 'changes_requested', 'rejected', 'expired'].includes(record.state);
  const draft = (record.draft ?? {}) as Record<string, unknown>;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const answers = {
      investorType: data.get('investorType') === 'institution' ? 'institution' : 'individual',
      hasPriorExperience: data.get('hasPriorExperience') === 'on',
      acknowledgesTotalLossRisk: data.get('acknowledgesTotalLossRisk') === 'on',
      declaration: String(data.get('declaration') ?? '')
    };
    const isDraft = (event.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'draft';
    void action(async () => {
      if (isDraft) {
        await api('/me/investor-eligibility', 'PATCH', answers);
        return 'حُفظت المسودة. لم تُرسل للمراجعة.';
      }
      if (!answers.acknowledgesTotalLossRisk) throw new Error('الإقرار بإمكانية خسارة كامل المبلغ شرط للإرسال.');
      await api('/me/investor-eligibility/submissions', 'POST', answers);
      return 'أُرسل الطلب للمراجعة. الأهلية قرار مراجع مستقل، لا نتيجة تلقائية.';
    });
  };

  return shell(
    <>
      <PageHeader
        dashboard
        title="الأهلية الاستثمارية"
        lead="الأهلية قرار مراجعة مستقل بمدة صلاحية. اختيارك لقدرة «مستثمر» في ملفك شيء آخر تمامًا."
        actions={<StatusBadge tone={state.tone}>{state.text}</StatusBadge>}
      />

      {/* The whole point of PART-08's first acceptance criterion, said plainly. */}
      <Card title="حقيقتان منفصلتان">
        <div className="tmk-grid tmk-grid--stats">
          <Stat
            label="قدرة «مستثمر» في ملفك"
            value={record.capabilityChosen ? 'مُفعَّلة' : 'غير مفعّلة'}
            note="اختيار شخصي يقول ما تريد فعله. لا يمنح أهلية."
          />
          <Stat
            label="الأهلية"
            value={<StatusBadge tone={record.eligible ? 'success' : 'warning'}>{record.eligible ? 'مؤهَّل' : 'غير مؤهَّل'}</StatusBadge>}
            note="قرار مراجع مستقل، وهو وحده ما يُعتد به"
          />
          <Stat
            label="تنتهي في"
            value={record.expiresAt ? formatDate(record.expiresAt, locale) : '—'}
            note={record.expiresAt ? 'بانتهائها تتوقف الأهلية دون أي إجراء' : 'لا تاريخ انتهاء بعد'}
          />
        </div>
        {record.capabilityChosen && !record.eligible ? (
          <Notice tone="info" title="تفعيل القدرة لا يعني الأهلية">
            <p style={{ marginBlockEnd: 0 }}>
              فعّلت قدرة «مستثمر» في ملفك، وهذا يخبرنا باهتمامك فقط. الأهلية تحتاج طلبًا تُقدِّمه هنا
              ويبتّ فيه مراجع مستقل، ولها تاريخ انتهاء.
            </p>
          </Notice>
        ) : null}
        {record.reason ? (
          <Notice tone={record.state === 'rejected' ? 'danger' : 'warning'} title="ملاحظة المراجع">
            <p style={{ marginBlockEnd: 0 }}>{record.reason}</p>
          </Notice>
        ) : null}
      </Card>

      {editable ? (
        <form onSubmit={submit} autoComplete="off">
          <Card title="الطلب">
            <fieldset className="tmk-fieldset">
              <legend className="tmk-fieldset__legend">الصفة</legend>
              <div className="tmk-choice">
                <input className="tmk-choice__control" type="radio" id="type-individual" name="investorType" value="individual" defaultChecked={draft.investorType !== 'institution'} />
                <label className="tmk-choice__label" htmlFor="type-individual">فرد</label>
              </div>
              <div className="tmk-choice">
                <input className="tmk-choice__control" type="radio" id="type-institution" name="investorType" value="institution" defaultChecked={draft.investorType === 'institution'} />
                <label className="tmk-choice__label" htmlFor="type-institution">جهة</label>
              </div>
            </fieldset>
            <div className="tmk-choice">
              <input className="tmk-choice__control" type="checkbox" id="prior" name="hasPriorExperience" defaultChecked={draft.hasPriorExperience === true} />
              <label className="tmk-choice__label" htmlFor="prior">سبق لي الاستثمار في شركات غير مدرجة</label>
            </div>
            <div className="tmk-choice">
              <input className="tmk-choice__control" type="checkbox" id="risk" name="acknowledgesTotalLossRisk" defaultChecked={draft.acknowledgesTotalLossRisk === true} />
              <label className="tmk-choice__label" htmlFor="risk">أُقرّ بأنني قد أخسر كامل المبلغ المستثمَر</label>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="declaration">إقرار</label>
              <p className="tmk-field__hint" id="declaration-hint">مصدر الأموال، وأي شيء تريد أن يأخذه المراجع بعين الاعتبار. يقرأه المراجع وحده.</p>
              <textarea id="declaration" name="declaration" className="tmk-input" rows={4} minLength={20} maxLength={2000} required
                defaultValue={typeof draft.declaration === 'string' ? draft.declaration : ''} aria-describedby="declaration-hint" />
            </div>
          </Card>
          <p className="tmk-row__actions">
            <button type="submit" name="intent" value="submit" className="tmk-button tmk-button--primary" disabled={busy}>
              {record.state === 'changes_requested' ? 'أرسل الاستكمال' : 'أرسل للمراجعة'}
            </button>
            <button type="submit" name="intent" value="draft" className="tmk-button tmk-button--secondary" disabled={busy}>احفظ مسودة</button>
          </p>
        </form>
      ) : (
        <Card title="الطلب">
          <p className="tmk-field__hint">
            {record.state === 'approved'
              ? 'طلبك معتمد. لا يمكن تعديله؛ إن انتهت صلاحيته يمكنك تقديم طلب جديد حينها.'
              : 'طلبك لدى المراجع الآن. لا يمكن تعديله أثناء المراجعة حتى لا يتغيّر ما يُنظر فيه.'}
          </p>
        </Card>
      )}

      {record.decisions.length > 0 ? (
        <Card title="سجل القرارات">
          <DataTable
            caption="قرارات الأهلية"
            rows={record.decisions}
            rowKey={row => row.id}
            columns={[
              { key: 'outcome', header: 'القرار', cell: row => row.outcome === 'approved' ? 'اعتماد' : row.outcome === 'rejected' ? 'رفض' : 'طلب استكمال' },
              { key: 'reviewer', header: 'المراجع', cell: row => row.reviewer },
              { key: 'reason', header: 'السبب', cell: row => row.reason || '—' },
              { key: 'expires', header: 'تنتهي', cell: row => row.expiresAt ? formatDate(row.expiresAt, locale) : '—' },
              { key: 'at', header: 'الوقت', cell: row => formatDate(row.at, locale, true) }
            ]}
            emptyState={null}
          />
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// BUS-01 / BUS-02 / BUS-03 — the issuer
// ---------------------------------------------------------------------------------------------

interface Offering {
  id: string; organizationId: string; slug: string; title: string; instrument: string;
  currency: string; state: string; stateReason: string;
  sharesOffered: string; pricePerShareMinor: string; maximumRaiseMinor: string;
  minimumRaiseMinor: string; minimumTicketMinor: string; maximumTicketMinor: string | null;
  useOfFunds: string; oversubscriptionPolicy: string;
  requiresEligibility: boolean; requiresNda: boolean;
  currentShares: string; postRaiseShares: string; offeringPercentOfPostRaise: string;
  opensAt: string | null; closesAt: string | null; hasDisclosure: boolean;
  simulated: boolean; version: number; createdAt: string;
  disclosure?: { id: string; sequence: number; summary: string; risks: string; useOfFunds: string; checksum: string; material: boolean; publishedAt: string } | null;
  disclosureHistory?: Array<{ id: string; sequence: number; checksum: string; material: boolean; reason: string; publishedAt: string }>;
  decisions?: Array<{ id: string; outcome: string; reviewer: string; publicReason: string; at: string; matchesCurrentDisclosure: boolean }>;
  interest?: { count: number; indicativeTotalMinor: string; reservesCapacity: boolean };
}

export function OrgOfferings({ locale, orgId, offeringId, mode }: { locale: Locale; orgId: string; offeringId?: string; mode: 'list' | 'new' | 'detail' | 'dataroom' }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<Offering[] | null>(null);
  const [offering, setOffering] = useState<Offering | null>(null);
  const [venture, setVenture] = useState<{ id: string; legalName: string; summary: string; currentShares: string; currency: string; version: number } | null>(null);
  const [check, setCheck] = useState<{ ready: boolean; blockers: string[]; maximumRaiseMinor: string; postRaiseShares: string; fullRaisePercent: string } | null>(null);
  const [room, setRoom] = useState<{ documents: Array<{ id: string; title: string; category: string; classification: string; downloadAvailable: boolean; scanState: string }>; withheld: number } | null>(null);
  const [grants, setGrants] = useState<{ grants: Array<{ id: string; name: string; expiresAt: string; revokedAt: string | null; revokeReason: string; live: boolean }>; requests: Array<{ id: string; name: string; state: string; reason: string; userId: string }> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setMe(await api('/me') as Me);
    setVenture(await api(`/orgs/${orgId}/venture`) as typeof venture);
    if (mode === 'list' || mode === 'new') setRows(await api(`/orgs/${orgId}/offerings`) as Offering[]);
    if ((mode === 'detail' || mode === 'dataroom') && offeringId) {
      const record = await api(`/orgs/${orgId}/offerings/${offeringId}`) as Offering;
      setOffering(record);
      if (mode === 'detail') {
        setCheck(await api(`/orgs/${orgId}/offerings/${offeringId}/validate`, 'POST') as typeof check);
      } else {
        setRoom(await api(`/offerings/${offeringId}/dataroom`) as typeof room);
        setGrants(await api(`/orgs/${orgId}/offerings/${offeringId}/grants`) as typeof grants);
      }
    }
  }, [orgId, offeringId, mode]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) { if (active && !(e instanceof UnauthenticatedError)) setError(e instanceof Error ? e.message : 'تعذر التحميل.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const context = me?.contexts.find(item => item.organization.id === orgId);
  const can = (permission: string) => context?.permissions.includes(permission) ?? false;

  async function action(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await work()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  }

  const path = mode === 'list' ? `/org/${orgId}/offerings`
    : mode === 'new' ? `/org/${orgId}/offerings/new`
    : mode === 'dataroom' ? `/org/${orgId}/offerings/${offeringId}/dataroom`
    : `/org/${orgId}/offerings/${offeringId}`;

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={path} signedIn={Boolean(me)}
      {...(context ? { activeContextName: context.organization.displayName } : {})}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={L(`/org/${orgId}`)}>{context?.organization.displayName ?? '—'}</a></li>
          <li><a href={L(`/org/${orgId}/offerings`)}>العروض</a></li>
          {mode !== 'list' ? <li><span aria-current="page">{mode === 'new' ? 'عرض جديد' : mode === 'dataroom' ? 'غرفة البيانات' : offering?.title ?? '—'}</span></li> : null}
        </ol>
      </nav>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!me || !context) {
    return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  }

  // ---- BUS-03: the data room -------------------------------------------------------------------
  if (mode === 'dataroom') {
    if (!offering) return shell(<ErrorState title={t('notFoundTitle')}>{t('notFoundBody')}</ErrorState>);
    return shell(
      <>
        <PageHeader dashboard eyebrow={offering.title} title="غرفة البيانات" lead="الوصول ممنوح لكل عرض على حدة: منح في عرض لا يفتح عرضًا آخر." />
        <Card title="المستندات">
          <DataTable
            caption="مستندات غرفة البيانات"
            rows={room?.documents ?? []}
            rowKey={row => row.id}
            columns={[
              { key: 'title', header: 'العنوان', cell: row => row.title },
              { key: 'category', header: 'التصنيف', cell: row => categoryLabels[row.category] ?? row.category },
              { key: 'access', header: 'الوصول', cell: row => classificationLabels[row.classification] ?? row.classification },
              { key: 'download', header: 'الملف', cell: row => row.downloadAvailable ? <a className="tmk-button tmk-button--quiet" href={`/api/v1/dataroom-documents/${row.id}/download`}>تنزيل</a> : <StatusBadge tone="warning">{row.scanState === 'rejected' ? 'مرفوض' : 'قيد الفحص'}</StatusBadge> }
            ]}
            emptyState={<EmptyState title="لا مستندات بعد">أضف مستندًا ليظهر لمن تمنحه الوصول.</EmptyState>}
          />
          <p className="tmk-field__hint">كل تنزيل يخضع لمستوى الوصول الحالي ويُسجَّل في سجل التدقيق.</p>
        </Card>

        {can('offering.manage') ? (
          <Card title="أضف مستندًا">
            <form onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void action(async () => {
                const file = data.get('file');
                if (!(file instanceof File) || file.size < 1) throw new Error('اختر ملفًا صالحًا.');
                const intent = await api(`/orgs/${orgId}/offerings/${offeringId}/documents/upload-intents`, 'POST', {
                  title: String(data.get('title') ?? ''),
                  category: String(data.get('category') ?? 'company_profile'),
                  classification: String(data.get('classification') ?? 'granted'),
                  fileName: file.name, contentType: file.type, size: file.size
                });
                const received = await fetch(`/api/v1/orgs/${orgId}/offerings/${offeringId}/documents/${intent.id}/content`, { method: 'PUT', credentials: 'include', headers: { 'x-upload-token': intent.token, 'content-type': 'application/octet-stream' }, body: file });
                if (!received.ok) throw new Error('تعذر رفع الملف كاملًا.');
                await api(`/orgs/${orgId}/offerings/${offeringId}/documents/${intent.id}/finalize`, 'POST', undefined, { 'x-upload-token': intent.token });
                return 'رُفع المستند وفُحص وحُسبت بصمته.';
              });
            }} autoComplete="off">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="doc-title">العنوان</label>
                <input id="doc-title" name="title" className="tmk-input" required minLength={2} maxLength={200} autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="doc-category">التصنيف</label>
                <select id="doc-category" name="category" className="tmk-input" required>
                  {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="doc-classification">مستوى الوصول</label>
                <select id="doc-classification" name="classification" className="tmk-input" required defaultValue="granted">
                  {Object.entries(classificationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="doc-file">الملف</label>
                <p className="tmk-field__hint" id="doc-file-hint">PDF حتى 20MB، أو PNG/JPEG حتى 10MB. يُعزل الملف ويفحص قبل إتاحته.</p>
                <input id="doc-file" name="file" className="tmk-input" type="file" accept="application/pdf,image/png,image/jpeg" required aria-describedby="doc-file-hint" />
              </div>
              <p className="tmk-row__actions">
                <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>أضف المستند</button>
              </p>
            </form>
          </Card>
        ) : null}

        {can('dataroom.manage') ? (
          <>
            <Card title="من في الغرفة">
              <DataTable
                caption="منح الوصول"
                rows={grants?.grants ?? []}
                rowKey={row => row.id}
                columns={[
                  { key: 'name', header: 'الشخص', cell: row => row.name },
                  { key: 'expires', header: 'تنتهي', cell: row => formatDate(row.expiresAt, locale) },
                  {
                    key: 'state', header: 'الحالة',
                    // Expired and revoked are different facts about why someone is out of the room.
                    cell: row => row.revokedAt
                      ? <StatusBadge tone="danger">مسحوب</StatusBadge>
                      : row.live ? <StatusBadge tone="success">ساري</StatusBadge> : <StatusBadge tone="neutral">منتهٍ</StatusBadge>
                  },
                  { key: 'why', header: 'سبب السحب', cell: row => row.revokeReason || '—' },
                  {
                    key: 'act', header: 'إجراء',
                    cell: row => row.live ? (
                      <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                        const why = window.prompt('سبب سحب الوصول (عشرة أحرف على الأقل):') ?? '';
                        if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                        await api(`/dataroom-grants/${row.id}/revoke`, 'POST', { reason: why });
                        return 'سُحب الوصول، وبقي المنح السابق مسجّلًا بسببه.';
                      })}>اسحب الوصول</button>
                    ) : <span className="tmk-field__hint">—</span>
                  }
                ]}
                emptyState={<EmptyState title="لا أحد في الغرفة">امنح وصولًا لمستثمر ليظهر هنا.</EmptyState>}
              />
            </Card>
            <Card title="طلبات الوصول">
              <DataTable
                caption="طلبات دخول غرفة البيانات"
                rows={grants?.requests ?? []}
                rowKey={row => row.id}
                columns={[
                  { key: 'name', header: 'الشخص', cell: row => row.name },
                  { key: 'reason', header: 'السبب', cell: row => row.reason },
                  { key: 'state', header: 'الحالة', cell: row => row.state === 'approved' ? 'مُنح' : row.state === 'rejected' ? 'مرفوض' : 'قيد النظر' },
                  {
                    key: 'act', header: 'إجراء',
                    cell: row => row.state === 'requested' ? (
                      <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                        const days = window.prompt('مدة الوصول بالأيام:', '30') ?? '';
                        const count = Number(days);
                        if (!Number.isInteger(count) || count < 1 || count > 365) throw new Error('أدخل عدد أيام بين 1 و365.');
                        await api(`/orgs/${orgId}/offerings/${offeringId}/grants`, 'POST', {
                          userId: row.userId,
                          expiresAt: new Date(Date.now() + count * 86_400_000).toISOString()
                        });
                        return `مُنح الوصول لمدة ${count} يومًا. المنح محدد المدة دائمًا.`;
                      })}>امنح الوصول</button>
                    ) : <span className="tmk-field__hint">—</span>
                  }
                ]}
                emptyState={<EmptyState title="لا طلبات">لم يطلب أحد الدخول بعد.</EmptyState>}
              />
            </Card>
          </>
        ) : (
          <Card title="إدارة الوصول">
            <p className="tmk-field__hint">
              منح الوصول وسحبه يحتاج صلاحية <code>dataroom.manage</code>، وهي منفصلة عن تحرير شروط العرض عمدًا.
            </p>
          </Card>
        )}
      </>
    );
  }

  // ---- BUS-02: the editor ------------------------------------------------------------------------
  if (mode === 'new' || mode === 'detail') {
    if (mode === 'new' && !can('offering.manage')) {
      return shell(<ErrorState title={t('forbiddenTitle')}>إنشاء عرض يحتاج صلاحية <code>offering.manage</code>.</ErrorState>);
    }
    if (mode === 'new' && !venture) {
      return shell(
        <>
          <PageHeader dashboard title="عرض جديد" lead="قبل أي عرض، تحتاج الشركة إلى بيانات أسهمها." />
          <Notice tone="warning" title="لا توجد بيانات شركة">
            <p style={{ marginBlockEnd: 0 }}>
              النسبة التي يشتريها المستثمر تُحسب من أسهم الشركة الحالية زائد المعروضة، فلا يمكن عرض
              شيء قبل تسجيل عدد الأسهم الحالية.
            </p>
          </Notice>
          <Card title="بيانات الشركة">
            <form onSubmit={event => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              void action(async () => {
                await api(`/orgs/${orgId}/venture`, 'PUT', {
                  legalName: String(data.get('legalName') ?? ''),
                  summary: String(data.get('summary') ?? ''),
                  currentShares: digits(String(data.get('currentShares') ?? '')),
                  currency: String(data.get('currency') ?? 'ILS')
                });
                return 'سُجّلت بيانات الشركة. يمكنك الآن إنشاء عرض.';
              });
            }} autoComplete="off">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="v-name">الاسم القانوني</label>
                <input id="v-name" name="legalName" className="tmk-input" required minLength={2} maxLength={200} autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="v-shares">عدد الأسهم الحالية</label>
                <p className="tmk-field__hint" id="v-shares-hint">عدد صحيح. لا توجد أسهم كسرية في هذا الإصدار.</p>
                <input id="v-shares" name="currentShares" className="tmk-input" inputMode="numeric" required aria-describedby="v-shares-hint" autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="v-currency">العملة</label>
                <input id="v-currency" name="currency" className="tmk-input" defaultValue="ILS" required pattern="[A-Za-z]{3}" dir="ltr" autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="v-summary">نبذة</label>
                <textarea id="v-summary" name="summary" className="tmk-input" rows={3} minLength={30} maxLength={2000} required />
              </div>
              <p className="tmk-row__actions">
                <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>احفظ بيانات الشركة</button>
              </p>
            </form>
          </Card>
        </>
      );
    }

    const editable = mode === 'new' || (offering ? ['draft', 'changes_requested'].includes(offering.state) : false);
    const saveOffering = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void action(async () => {
        const payload = {
          title: String(data.get('title') ?? ''),
          currency: venture?.currency ?? 'ILS',
          sharesOffered: digits(String(data.get('sharesOffered') ?? '')),
          pricePerShareMinor: toMinor(String(data.get('pricePerShare') ?? '')),
          minimumRaiseMinor: toMinor(String(data.get('minimumRaise') ?? '')),
          minimumTicketMinor: toMinor(String(data.get('minimumTicket') ?? '')),
          useOfFunds: String(data.get('useOfFunds') ?? ''),
          closesAt: String(data.get('closesAt') ?? '') ? new Date(String(data.get('closesAt'))).toISOString() : null
        };
        if (mode === 'new') {
          const created = await api(`/orgs/${orgId}/offerings`, 'POST', payload) as Offering;
          window.location.href = L(`/org/${orgId}/offerings/${created.id}`);
          return 'أُنشئ العرض كمسودة. لا يظهر للجمهور ولا يقبل شيئًا.';
        }
        await api(`/orgs/${orgId}/offerings/${offeringId}`, 'PATCH', { ...payload, version: offering!.version });
        return 'حُفظت الشروط.';
      });
    };

    return shell(
      <>
        <PageHeader
          dashboard
          title={mode === 'new' ? 'عرض جديد' : offering?.title ?? ''}
          lead={mode === 'new'
            ? 'المستثمر يشتري نسبة من الشركة بعد الإصدار، لا نسبة من العرض. الشاشة تعرض الرقمين معًا.'
            : offering?.stateReason || 'شروط العرض وإفصاحه وحالته.'}
          actions={offering ? <StatusBadge tone={(offeringStates[offering.state] ?? { tone: 'neutral' as const }).tone}>{(offeringStates[offering.state] ?? { text: offering.state }).text}</StatusBadge> : undefined}
        />

        {offering ? (
          <Card title="الأرقام">
            <div className="tmk-grid tmk-grid--stats">
              <Stat label="أسهم الشركة الحالية" value={<Ltr>{Number(offering.currentShares).toLocaleString('en')}</Ltr>} />
              <Stat label="الأسهم المعروضة" value={<Ltr>{Number(offering.sharesOffered).toLocaleString('en')}</Ltr>} />
              <Stat label="سعر السهم" value={<MoneyAmount minor={offering.pricePerShareMinor} currency={offering.currency} locale={locale} />} />
              <Stat label="أقصى ما يمكن جمعه" value={<MoneyAmount minor={offering.maximumRaiseMinor} currency={offering.currency} locale={locale} />} note="لو بيعت كل الأسهم المعروضة" />
              <Stat
                label="العرض كله من الشركة"
                value={<Ltr>{offering.offeringPercentOfPostRaise}%</Ltr>}
                note="نسبة العرض بالكامل من أسهم الشركة بعد الإصدار — ليست 100%"
              />
              <Stat label="أسهم الشركة بعد الإصدار" value={<Ltr>{Number(offering.postRaiseShares).toLocaleString('en')}</Ltr>} />
            </div>
          </Card>
        ) : null}

        {check && mode === 'detail' ? (
          <Card title="فحص الحسابات">
            {check.ready
              ? <p>الشروط متسقة والعرض جاهز للإرسال للمراجعة.</p>
              : <>
                  <p>لا يمكن الإرسال قبل معالجة ما يلي:</p>
                  <ul>{check.blockers.map(code => <li key={code}>{blockerLabels[code] ?? code}</li>)}</ul>
                </>}
          </Card>
        ) : null}

        {editable ? (
          <form onSubmit={saveOffering} autoComplete="off">
            <Card title="الشروط">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="o-title">العنوان</label>
                <input id="o-title" name="title" className="tmk-input" required minLength={4} maxLength={200} defaultValue={offering?.title ?? ''} autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="o-shares">الأسهم المعروضة</label>
                <input id="o-shares" name="sharesOffered" className="tmk-input" inputMode="numeric" required defaultValue={offering?.sharesOffered ?? ''} autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="o-price">سعر السهم</label>
                <input id="o-price" name="pricePerShare" className="tmk-input" inputMode="decimal" required autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="o-minimum">الحد الأدنى للجمع</label>
                <p className="tmk-field__hint" id="o-minimum-hint">إن لم يبلغه العرض يفشل وتُعاد الأموال وفق عقده.</p>
                <input id="o-minimum" name="minimumRaise" className="tmk-input" inputMode="decimal" required aria-describedby="o-minimum-hint" autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="o-ticket">الحد الأدنى للاكتتاب</label>
                <p className="tmk-field__hint" id="o-ticket-hint">يجب أن يشتري سهمًا كاملًا على الأقل، وأن يكون مضاعفًا لسعر السهم.</p>
                <input id="o-ticket" name="minimumTicket" className="tmk-input" inputMode="decimal" required aria-describedby="o-ticket-hint" autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="o-closes">تاريخ الإغلاق</label>
                <input id="o-closes" name="closesAt" className="tmk-input" type="date" required autoComplete="off" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="o-use">أوجه استخدام التمويل</label>
                <textarea id="o-use" name="useOfFunds" className="tmk-input" rows={3} minLength={20} maxLength={4000} required defaultValue={offering?.useOfFunds ?? ''} />
              </div>
            </Card>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>{mode === 'new' ? 'أنشئ المسودة' : 'احفظ'}</button>
            </p>
          </form>
        ) : offering ? (
          <Card title="الشروط">
            <p className="tmk-field__hint">
              {['submitted', 'due_diligence'].includes(offering.state)
                ? 'العرض لدى المراجع الآن ولا يمكن تعديله، حتى يكون ما يُحكم عليه هو ما أُرسل.'
                : 'لا يمكن تعديل شروط عرض غادر مرحلة المسودة.'}
            </p>
          </Card>
        ) : null}

        {mode === 'detail' && offering ? (
          <>
            <Card title="الإفصاح">
              {offering.disclosure ? (
                <>
                  <p className="tmk-field__hint">
                    النسخة {offering.disclosure.sequence} — بصمتها <Ltr><code>{offering.disclosure.checksum.slice(0, 16)}…</code></Ltr>،
                    وهي ما يوافق عليه المستثمر بالضبط. تعديل نسخة منشورة مستحيل؛ التغيير ينشئ نسخة جديدة.
                  </p>
                  <div className="tmk-prose"><p>{offering.disclosure.summary}</p></div>
                </>
              ) : (
                <EmptyState title="لا إفصاح منشور">لا يمكن إرسال العرض للمراجعة قبل نشر إفصاح.</EmptyState>
              )}
              {can('offering.manage') ? (
                <form onSubmit={event => {
                  event.preventDefault();
                  const data = new FormData(event.currentTarget);
                  void action(async () => {
                    await api(`/orgs/${orgId}/offerings/${offeringId}/disclosure-revisions`, 'POST', {
                      summary: String(data.get('summary') ?? ''),
                      risks: String(data.get('risks') ?? ''),
                      useOfFunds: String(data.get('duf') ?? ''),
                      material: data.get('material') === 'on',
                      ...(String(data.get('dreason') ?? '') ? { reason: String(data.get('dreason')) } : {}),
                      version: offering.version
                    });
                    return 'نُشرت نسخة إفصاح جديدة. النسخة السابقة باقية كما هي.';
                  });
                }} autoComplete="off">
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="d-summary">الملخص</label>
                    <textarea id="d-summary" name="summary" className="tmk-input" rows={3} minLength={50} maxLength={4000} required />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="d-risks">المخاطر</label>
                    <p className="tmk-field__hint" id="d-risks-hint">إفصاح بلا قسم مخاطر ليس إفصاحًا. تفرض قاعدة البيانات وجوده.</p>
                    <textarea id="d-risks" name="risks" className="tmk-input" rows={3} minLength={20} maxLength={6000} required aria-describedby="d-risks-hint" />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="d-use">أوجه استخدام التمويل</label>
                    <textarea id="d-use" name="duf" className="tmk-input" rows={2} minLength={20} maxLength={4000} required />
                  </div>
                  <div className="tmk-choice">
                    <input className="tmk-choice__control" type="checkbox" id="d-material" name="material" defaultChecked />
                    <label className="tmk-choice__label" htmlFor="d-material">تعديل جوهري (يوقف العرض المفتوح ويستلزم إقرارًا جديدًا)</label>
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="d-reason">سبب التعديل</label>
                    <p className="tmk-field__hint" id="d-reason-hint">مطلوب بعد مغادرة المسودة، لأن أحدهم حكم على النص القديم.</p>
                    <input id="d-reason" name="dreason" className="tmk-input" maxLength={1000} aria-describedby="d-reason-hint" autoComplete="off" />
                  </div>
                  <p className="tmk-row__actions">
                    <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>انشر نسخة إفصاح</button>
                  </p>
                </form>
              ) : null}
            </Card>

            <Card title="الإجراءات">
              <p className="tmk-row__actions">
                {can('offering.manage') && ['draft', 'changes_requested'].includes(offering.state) ? (
                  <button type="button" className="tmk-button tmk-button--primary" disabled={busy || !check?.ready} onClick={() => void action(async () => {
                    await api(`/orgs/${orgId}/offerings/${offeringId}/submit`, 'POST', { version: offering.version });
                    return 'أُرسل العرض لمراجع مستقل. لا يمكن تعديله أثناء المراجعة.';
                  })}>أرسل للعناية الواجبة</button>
                ) : null}
                {can('offering.manage') && ['approved', 'suspended'].includes(offering.state) ? (
                  <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
                    await api(`/orgs/${orgId}/offerings/${offeringId}/open`, 'POST', { version: offering.version });
                    return 'فُتح العرض للاكتتاب.';
                  })}>افتح للاكتتاب</button>
                ) : null}
                {can('offering.manage') && ['open', 'suspended'].includes(offering.state) ? (
                  <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => {
                    await api(`/orgs/${orgId}/offerings/${offeringId}/close`, 'POST', { version: offering.version });
                    return 'أُغلق الاكتتاب. التخصيص إجراء منفصل: يُحسب، ثم يُعتمد من مراجع مستقل.';
                  })}>أغلق للاكتتاب</button>
                ) : null}
                <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/offerings/${offeringId}/dataroom`)}>غرفة البيانات</a>
                {['open', 'suspended', 'closing', 'failed', 'allocated', 'reporting', 'closed'].includes(offering.state)
                  ? <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/offerings/${offeringId}/allocations`)}>الاكتتابات والتخصيص</a>
                  : null}
                <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/investor-relations`)}>علاقات المستثمرين</a>
                {['open', 'suspended', 'closing'].includes(offering.state)
                  ? <a className="tmk-button tmk-button--quiet" href={L(`/invest/${offering.slug}`)}>الصفحة العامة</a>
                  : null}
              </p>
              {offering.state === 'approved' ? (
                <p className="tmk-field__hint">الاعتماد ليس نشرًا: المراجع أجاز البيع، وأنت تقرر متى يُفتح.</p>
              ) : null}
              {offering.state === 'closing' ? (
                <p className="tmk-field__hint">
                  الإغلاق يوقف المال الجديد فقط. التخصيص وإثبات الحصص من شاشة «الاكتتابات والتخصيص»، ولا تصدره جهتك لنفسها.
                </p>
              ) : null}
            </Card>

            {offering.interest ? (
              <Card title="الاهتمام">
                <div className="tmk-grid tmk-grid--stats">
                  <Stat label="عدد المهتمين" value={String(offering.interest.count)} note="اهتمام لا يحجز سعة ولا يُعد تمويلًا" />
                  <Stat label="المبالغ الاسترشادية" value={<MoneyAmount minor={offering.interest.indicativeTotalMinor} currency={offering.currency} locale={locale} />} note="تقدير للتخطيط فقط، ولا يلزم أحدًا" />
                </div>
              </Card>
            ) : null}

            {offering.decisions?.length ? (
              <Card title="قرارات المراجعة">
                <DataTable
                  caption="قرارات المراجع المستقل"
                  rows={offering.decisions}
                  rowKey={row => row.id}
                  columns={[
                    { key: 'outcome', header: 'القرار', cell: row => row.outcome === 'approved' ? 'اعتماد' : row.outcome === 'rejected' ? 'رفض' : 'طلب تعديلات' },
                    { key: 'reviewer', header: 'المراجع', cell: row => row.reviewer },
                    { key: 'reason', header: 'السبب', cell: row => row.publicReason || '—' },
                    { key: 'at', header: 'الوقت', cell: row => formatDate(row.at, locale, true) },
                    {
                      key: 'match', header: 'على الإفصاح الحالي',
                      cell: row => row.matchesCurrentDisclosure
                        ? <StatusBadge tone="success">نعم</StatusBadge>
                        : <StatusBadge tone="warning">نسخة أقدم</StatusBadge>
                    }
                  ]}
                  emptyState={null}
                />
              </Card>
            ) : null}
          </>
        ) : null}
      </>
    );
  }

  // ---- BUS-01: the list ---------------------------------------------------------------------------
  return shell(
    <>
      <PageHeader
        dashboard
        title="العروض"
        lead="عروض هذه الجهة، بما فيها المسودات التي لا يراها أحد غيرها."
        actions={can('offering.manage') ? <a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/offerings/new`)}>عرض جديد</a> : undefined}
      />
      {!rows?.length ? (
        <EmptyState title="لا عروض بعد" action={can('offering.manage') ? <a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/offerings/new`)}>عرض جديد</a> : undefined}>
          لم تُنشئ هذه الجهة أي عرض استثماري.
        </EmptyState>
      ) : (
        <Card title="القائمة">
          <DataTable
            caption="عروض الجهة"
            rows={rows}
            rowKey={row => row.id}
            columns={[
              { key: 'title', header: 'العرض', cell: row => <a href={L(`/org/${orgId}/offerings/${row.id}`)}>{row.title}</a> },
              { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={(offeringStates[row.state] ?? { tone: 'neutral' as const }).tone}>{(offeringStates[row.state] ?? { text: row.state }).text}</StatusBadge> },
              { key: 'raise', header: 'أقصى جمع', numeric: true, cell: row => <MoneyAmount minor={row.maximumRaiseMinor} currency={row.currency} locale={locale} /> },
              { key: 'share', header: 'نسبة العرض من الشركة', numeric: true, cell: row => <Ltr>{row.offeringPercentOfPostRaise}%</Ltr> },
              { key: 'closes', header: 'الإغلاق', cell: row => row.closesAt ? formatDate(row.closesAt, locale) : '—' }
            ]}
            emptyState={null}
          />
        </Card>
      )}
    </>
  );
}

const categoryLabels: Record<string, string> = {
  company_profile: 'تعريف الشركة',
  historical_performance: 'الأداء التاريخي',
  use_of_funds: 'استخدام التمويل',
  current_ownership: 'الملكية الحالية',
  contracts: 'العقود',
  risks: 'المخاطر',
  due_diligence_report: 'تقرير العناية الواجبة'
};
const classificationLabels: Record<string, string> = {
  public: 'عام — على صفحة العرض',
  nda: 'بعد قبول الإفصاح',
  granted: 'بمنح وصول محدد المدة'
};

// ---------------------------------------------------------------------------------------------
// ADM-04 — the independent reviewer
// ---------------------------------------------------------------------------------------------

export function InvestmentReviews({ locale, offeringId }: { locale: Locale; offeringId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [queue, setQueue] = useState<{ offerings: Offering[]; eligibility: Array<{ id: string; applicant: string; state: string; version: number; submittedAt: string | null }>; allocations: AllocationRequestRow[] } | null>(null);
  const [detail, setDetail] = useState<(Offering & { organization: { displayName: string; verification: string }; disclosure: { id: string; sequence: number; summary: string; risks: string; useOfFunds: string; checksum: string } | null; terms: { valid: boolean; problems: Array<{ code: string }>; fullRaisePercent: string }; decisions: Array<{ id: string; outcome: string; reviewer: string; publicReason: string; at: string }> }) | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setQueue(await api('/admin/investment-reviews') as typeof queue);
    if (offeringId) setDetail(await api(`/admin/investment-reviews/${offeringId}`) as typeof detail);
  }, [offeringId]);

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

  async function action(work: () => Promise<string>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await work()); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  }

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={offeringId ? `/admin/investment-reviews/${offeringId}` : '/admin/investment-reviews'} signedIn={Boolean(queue)}
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
        مراجعة الاستثمار والأهلية تحتاج منحة <code>RiskReviewer</code> مع تحقق بخطوتين، وهي مستقلة عن أي عضوية في جهة.
      </ErrorState>
    );
  }

  if (offeringId) {
    if (!detail) return shell(<ErrorState title={t('notFoundTitle')}>{t('notFoundBody')}</ErrorState>);
    return shell(
      <>
        <PageHeader
          dashboard
          eyebrow={detail.organization.displayName}
          title={detail.title}
          lead="القرار يرتبط بنسخة الإفصاح المعروضة أدناه، ولا يمكن لعضو في الجهة المصدِّرة أن يتخذه."
          actions={<StatusBadge tone={(offeringStates[detail.state] ?? { tone: 'neutral' as const }).tone}>{(offeringStates[detail.state] ?? { text: detail.state }).text}</StatusBadge>}
        />
        <Card title="الأرقام">
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="أقصى جمع" value={<MoneyAmount minor={detail.maximumRaiseMinor} currency={detail.currency} locale={locale} />} />
            <Stat label="الحد الأدنى" value={<MoneyAmount minor={detail.minimumRaiseMinor} currency={detail.currency} locale={locale} />} />
            <Stat label="نسبة العرض من الشركة" value={<Ltr>{detail.terms.fullRaisePercent}%</Ltr>} note="بعد الإصدار الكامل" />
            <Stat label="اتساق الشروط" value={detail.terms.valid ? 'متسقة' : 'بها مشكلات'} note={detail.terms.valid ? '' : detail.terms.problems.map(p => blockerLabels[p.code] ?? p.code).join('؛ ')} />
          </div>
          {detail.organization.verification !== 'verified' ? (
            <Notice tone="danger" title="الجهة غير موثقة">
              <p style={{ marginBlockEnd: 0 }}>لا يمكن فتح عرض لجهة غير موثقة، ويُعاد فحص التوثيق عند الفتح أيضًا.</p>
            </Notice>
          ) : null}
        </Card>
        {detail.disclosure ? (
          <Card title={`الإفصاح — النسخة ${detail.disclosure.sequence}`}>
            <p className="tmk-field__hint">بصمة النسخة: <Ltr><code>{detail.disclosure.checksum}</code></Ltr></p>
            <div className="tmk-prose">
              <p>{detail.disclosure.summary}</p>
              <p><strong>المخاطر:</strong> {detail.disclosure.risks}</p>
              <p><strong>استخدام التمويل:</strong> {detail.disclosure.useOfFunds}</p>
            </div>
          </Card>
        ) : null}
        <Card title="القرار">
          <p className="tmk-row__actions">
            {detail.state === 'submitted' ? (
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
                await api(`/admin/offerings/${offeringId}/claim`, 'POST');
                return 'استُلم للمراجعة. لا يمكن لمراجع آخر استلامه.';
              })}>استلم للمراجعة</button>
            ) : null}
            {detail.state === 'due_diligence' ? (
              <>
                <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
                  await api(`/admin/offerings/${offeringId}/decision`, 'POST', { outcome: 'approved', publicReason: '', version: detail.version });
                  return 'اعتُمد العرض. الاعتماد ليس نشرًا: الجهة تقرر متى يُفتح.';
                })}>اعتماد</button>
                <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => {
                  const why = window.prompt('ما المطلوب استكماله؟ (عشرة أحرف على الأقل)') ?? '';
                  if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                  await api(`/admin/offerings/${offeringId}/decision`, 'POST', { outcome: 'changes_requested', publicReason: why, version: detail.version });
                  return 'أُعيد العرض للجهة مع ملاحظات.';
                })}>طلب توضيح</button>
                <button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => void action(async () => {
                  const why = window.prompt('سبب الرفض (عشرة أحرف على الأقل):') ?? '';
                  if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                  await api(`/admin/offerings/${offeringId}/decision`, 'POST', { outcome: 'rejected', publicReason: why, version: detail.version });
                  return 'رُفض العرض بسبب مسجَّل.';
                })}>رفض</button>
              </>
            ) : null}
            <a className="tmk-button tmk-button--quiet" href={L('/admin/investment-reviews')}>عودة للطابور</a>
          </p>
          <p className="tmk-field__hint">
            اعتماد التخصيص يتم من قائمة مراجعة الاستثمار بعد إغلاق العرض وتسوية الالتزامات.
          </p>
        </Card>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="مراجعة الاستثمار والأهلية" lead="ما ينتظر قرار مراجع مستقل." />
      <Card title="العروض">
        <DataTable
          caption="عروض بانتظار المراجعة"
          rows={queue.offerings}
          rowKey={row => row.id}
          columns={[
            { key: 'title', header: 'العرض', cell: row => <a href={L(`/admin/investment-reviews/${row.id}`)}>{row.title}</a> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={(offeringStates[row.state] ?? { tone: 'neutral' as const }).tone}>{(offeringStates[row.state] ?? { text: row.state }).text}</StatusBadge> },
            { key: 'raise', header: 'أقصى جمع', numeric: true, cell: row => <MoneyAmount minor={row.maximumRaiseMinor} currency={row.currency} locale={locale} /> },
            { key: 'created', header: 'منذ', cell: row => formatDate(row.createdAt, locale) }
          ]}
          emptyState={<EmptyState title="لا عروض بانتظار المراجعة">لا يوجد عرض مُرسل الآن.</EmptyState>}
        />
      </Card>
      <Card title="طلبات الأهلية">
        <p className="tmk-field__hint">
          الأهلية قرار بمدة صلاحية. اعتمادها بلا تاريخ انتهاء مستحيل: تفرضه قاعدة البيانات.
        </p>
        <DataTable
          caption="طلبات أهلية بانتظار القرار"
          rows={queue.eligibility}
          rowKey={row => row.id}
          columns={[
            { key: 'applicant', header: 'مقدّم الطلب', cell: row => row.applicant },
            { key: 'state', header: 'الحالة', cell: row => (eligibilityStates[row.state] ?? { text: row.state }).text },
            { key: 'at', header: 'منذ', cell: row => row.submittedAt ? formatDate(row.submittedAt, locale) : '—' },
            {
              key: 'act', header: 'القرار',
              cell: row => (
                <span className="tmk-row__actions">
                  <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                    const days = window.prompt('مدة صلاحية الأهلية بالأيام:', '365') ?? '';
                    const count = Number(days);
                    if (!Number.isInteger(count) || count < 1 || count > 1095) throw new Error('أدخل عدد أيام بين 1 و1095.');
                    await api(`/admin/eligibility/${row.id}/decision`, 'POST', { outcome: 'approved', reason: '', validityDays: count, version: row.version });
                    return `اعتُمدت الأهلية لمدة ${count} يومًا، وتنتهي تلقائيًا بعدها.`;
                  })}>اعتماد</button>
                  <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                    const why = window.prompt('سبب الرفض أو الاستكمال (عشرة أحرف على الأقل):') ?? '';
                    if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                    await api(`/admin/eligibility/${row.id}/decision`, 'POST', { outcome: 'changes_requested', reason: why, version: row.version });
                    return 'أُعيد الطلب لمقدّمه مع ملاحظات.';
                  })}>طلب استكمال</button>
                </span>
              )
            }
          ]}
          emptyState={<EmptyState title="لا طلبات أهلية">لا يوجد طلب بانتظار القرار.</EmptyState>}
        />
      </Card>

      {/* ADM-04.A03. The only operation in the product that creates a holding. */}
      <Card title="جداول التخصيص">
        <p className="tmk-field__hint">
          الاعتماد هنا هو الشيء الوحيد الذي يُنشئ حصة. يرتبط ببصمة الأرقام التي رُوجعت، ويُعاد فحص كل التزام لحظة الإصدار:
          إن تحرّك شيء بعد الإرسال يُرفض الاعتماد بدل أن يُطبَّق على أرقام أخرى.
        </p>
        <DataTable
          caption="جداول تخصيص بانتظار مراجع مستقل"
          rows={queue.allocations}
          rowKey={row => row.id}
          columns={[
            { key: 'offering', header: 'العرض', cell: row => <>{row.offeringTitle}<span className="tmk-field__hint">{row.organization}</span></> },
            { key: 'holders', header: 'عدد المكتتبين', numeric: true, cell: row => <Ltr>{String(row.lineCount)}</Ltr> },
            { key: 'units', header: 'الأسهم', numeric: true, cell: row => <Ltr>{row.totalUnits}</Ltr> },
            {
              key: 'total', header: 'المبلغ', numeric: true,
              cell: row => (
                <>
                  <MoneyAmount minor={row.totalMinor} currency={row.currency} locale={locale} />
                  {row.minimumReached
                    ? null
                    : <span className="tmk-field__hint">دون الحد الأدنى — التخصيص ليس القرار الصحيح هنا.</span>}
                </>
              )
            },
            { key: 'checksum', header: 'البصمة', cell: row => <code><Ltr>{row.checksum.slice(0, 12)}…</Ltr></code> },
            { key: 'at', header: 'منذ', cell: row => formatDate(row.requestedAt, locale) },
            {
              key: 'act', header: 'القرار',
              cell: row => row.decidableByYou ? (
                <span className="tmk-row__actions">
                  <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                    await api(`/admin/allocation-requests/${row.id}/finalize`, 'POST', { checksum: row.checksum, version: row.version });
                    return 'ثُبِّت التخصيص وصدرت الحصص. المرجع محاكاة معلَّمة، ولا ينشئ سجل مساهمين قانونيًا.';
                  })}>ثبّت</button>
                  <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                    const why = window.prompt('سبب الرفض (عشرة أحرف على الأقل):') ?? '';
                    if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                    await api(`/admin/allocation-requests/${row.id}/reject`, 'POST', { reason: why, version: row.version });
                    return 'أُعيد الجدول إلى الجهة المصدرة دون إصدار أي سهم.';
                  })}>أعده</button>
                </span>
              ) : (
                <span className="tmk-field__hint">لست مستقلًا عن هذا الجدول: أنت من طلبه، أو أنت عضو في الجهة المصدرة.</span>
              )
            }
          ]}
          emptyState={<EmptyState title="لا جداول تخصيص">لا يوجد جدول بانتظار الاعتماد.</EmptyState>}
        />
      </Card>
    </>
  );
}
