'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, MoneyAmount, Notice, PageHeader, Skeleton, Stat, StatusBadge,
  formatDate, formatMinorUnits, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';
import { ProjectLocationEditor } from './maps';

/**
 * ORG-07 (plan editor) and ORG-08 (project management) for PART-05.
 *
 * Amounts are entered in major units for the person and converted to minor units before they leave
 * the browser, because the API only accepts integer minor units as strings (08-FINANCIAL-SYSTEM).
 * The server re-validates everything; this conversion is a convenience, not a check.
 */

interface Context { organization: { id: string; displayName: string }; permissions: string[] }
interface Me { user: { id: string }; contexts: Context[] }
interface Plan {
  id: string; slug: string; title: string; state: string; stateReason: string; version: number;
  publishedAt: string | null;
  campaign: { goalMinor: string; currency: string; policy: string; endsAt: string; version: number } | null;
  budget: { lines: Array<{ id: string; label: string; amountMinor: string }>; totalMinor: string; revisions: Array<{ id: string; sequence: number; reason: string; totalMinor: string; createdAt: string }> };
  milestones: Array<{ id: string; sequence: number; title: string; budgetMinor: string; weight: number; state: string; evidenceNote: string }>;
  milestoneTotalMinor: string;
  readiness: { ready: boolean; blockers: string[] };
  versions: Array<{ id: string; sequence: number; submittedAt: string; decision: { outcome: string; publicReason: string; decidedAt: string } | null }>;
  reports: Array<{ id: string; sequence: number; title: string; state: string; version: number; publishedAt: string | null }>;
  funding:
    | { available: true; currency: string; goalMinor: string; grossMinor: string; refundedMinor: string; netMinor: string; contributionCount: number; simulated: true }
    | { available: false; reason: string };
}

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' = 'GET', body?: unknown) => {
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
    forbidden: 'لا تملك صلاحية هذا الإجراء في هذه الجهة.',
    not_found: 'المورد غير موجود ضمن هذه الجهة.',
    conflict: 'تغيّرت البيانات أو حالة المشروع لا تسمح بهذا الإجراء. حمّل النسخة الأحدث وأعد المحاولة.',
    invalid_input: 'تحقق من الحقول: المبالغ بوحدات صحيحة، ومجموع أوزان المراحل 100، والسبب مطلوب عند تعديل ميزانية منشورة.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

const stateLabels: Record<string, string> = {
  draft: 'مسودة', submitted: 'قيد المراجعة', in_review: 'تحت المراجعة', changes_requested: 'طلب تعديلات',
  approved: 'معتمد — لم يُنشر بعد', published: 'منشور', executing: 'قيد التنفيذ', paused: 'موقوف',
  impact_review: 'مراجعة أثر', completed: 'مكتمل', rejected: 'مرفوض', funding_closed: 'أُغلق الجمع'
};
const blockerLabels: Record<string, string> = {
  summary_too_short: 'الملخص العام أقل من 30 حرفًا.',
  campaign_missing: 'لم تُحدَّد الحملة: الهدف والعملة وسياسة التمويل وتاريخ الانتهاء.',
  campaign_end_in_past: 'تاريخ انتهاء الحملة في الماضي.',
  budget_missing: 'لا توجد بنود ميزانية.',
  milestones_missing: 'لا توجد مراحل.',
  milestone_budget_mismatch: 'مجموع ميزانيات المراحل لا يساوي مجموع بنود الميزانية.',
  milestone_weights_not_100: 'مجموع أوزان المراحل يجب أن يساوي 100.',
  goal_budget_mismatch: 'هدف الحملة لا يساوي مجموع بنود الميزانية.'
};

/** Two decimal places is the assumption for ILS/JOD/USD in this build. */
const toMinor = (major: string) => {
  const cleaned = major.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('أدخل مبلغًا صحيحًا مثل 1000 أو 1000.50.');
  const [whole = '0', fraction = ''] = cleaned.split('.');
  return `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
};
const toMajor = (minorValue: string) => formatMinorUnits(minorValue);

export function OrgProjectDetail({ locale, orgId, projectId }: { locale: Locale; orgId: string; projectId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [me, setMe] = useState<Me | null>(null);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const reload = async () => setPlan(await api(`/orgs/${orgId}/projects/${projectId}/plan`) as Plan);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await api('/me') as Me;
        if (!active) return;
        setMe(current);
        const loaded = await api(`/orgs/${orgId}/projects/${projectId}/plan`) as Plan;
        if (active) setPlan(loaded);
      } catch (e) { if (active && !(e instanceof UnauthenticatedError)) setError(e instanceof Error ? e.message : 'تعذر تحميل المشروع.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [orgId, projectId]);

  const context = me?.contexts.find(item => item.organization.id === orgId);
  const can = (permission: string) => context?.permissions.includes(permission) ?? false;

  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  }
  const onSubmit = (work: (data: FormData) => Promise<void>) => (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void action(() => work(data));
  };

  const shell = (children: ReactNode) => (
    <AppShell
      locale={locale} path={`/org/${orgId}/projects/${projectId}`} signedIn={Boolean(me)}
      {...(context ? { activeContextName: context.organization.displayName } : {})}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}
    >
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={L(`/org/${orgId}`)}>{context?.organization.displayName ?? '—'}</a></li>
          <li><a href={L(`/org/${orgId}/projects`)}>المشاريع</a></li>
          <li><span aria-current="page">{plan?.title ?? '—'}</span></li>
        </ol>
      </nav>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!me || !context) return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  if (!plan) return shell(<ErrorState title={t('notFoundTitle')}>{t('notFoundBody')}</ErrorState>);

  const editable = ['draft', 'changes_requested'].includes(plan.state);
  const published = Boolean(plan.publishedAt);
  const currency = plan.campaign?.currency ?? 'ILS';
  const latestDecision = plan.versions.find(version => version.decision)?.decision;

  return shell(
    <>
      <PageHeader
        dashboard
        eyebrow={`${stateLabels[plan.state] ?? plan.state}${published ? ' · عام' : ''}`}
        title={plan.title}
        lead={published
          ? 'المشروع منشور. تعديل الميزانية بعد النشر يحتاج سببًا مسجلًا، ولا تتغير سياسة التمويل ولا العملة.'
          : 'المشروع غير منشور. لا يظهر للجمهور قبل أن يعتمده مراجع محتوى مستقل وينشره.'}
        actions={published ? <a className="tmk-button tmk-button--secondary" href={L(`/projects/${plan.slug}`)}>الصفحة العامة</a> : undefined}
      />

      {plan.stateReason ? (
        <Notice tone={plan.state === 'rejected' ? 'danger' : 'warning'} title={plan.state === 'changes_requested' ? 'طلب المراجع تعديلات' : 'سبب الحالة'}>
          <p style={{ marginBlockEnd: 0 }}>{plan.stateReason}</p>
        </Notice>
      ) : null}

      {/* A plan is not a balance. When a campaign exists the two are shown side by side, never merged. */}
      {!plan.funding.available ? (
        <Notice tone="info" title="الأرقام هنا خطة لا رصيد">
          <p style={{ marginBlockEnd: 0 }}>
            لا توجد حملة تمويل لهذا المشروع بعد، فلا يوجد مقبوض. المبالغ أدناه ميزانية مخططة فقط.
          </p>
        </Notice>
      ) : (
        <Card title="المقبوض المؤكد" id="raised">
          <p className="tmk-field__hint">
            المبالغ أدناه مساهمات مؤكدة فعليًا، لا ميزانية مخططة. «المتاح للصرف» رقم مختلف يظهر في صفحة المالية،
            لأنه يخصم الرسوم والحجوزات ولا يشمل ما لم تتم تسويته بعد.
          </p>
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="إجمالي المؤكد" value={<MoneyAmount minor={plan.funding.grossMinor} currency={plan.funding.currency} locale={locale} />} note="قبل خصم الاسترداد" />
            <Stat label="المسترد المؤكد" value={<MoneyAmount minor={plan.funding.refundedMinor} currency={plan.funding.currency} locale={locale} />} note="استرداد اكتمل تأكيده" />
            <Stat label="الصافي" value={<MoneyAmount minor={plan.funding.netMinor} currency={plan.funding.currency} locale={locale} />} note="المؤكد ناقص المسترد" />
            <Stat label="عدد المساهمات" value={String(plan.funding.contributionCount)} note="مساهمات لا مساهمين" />
          </div>
          <p className="tmk-row__actions">
            {can('finance.read')
              ? <a className="tmk-button tmk-button--secondary" href={L(`/org/${orgId}/projects/${projectId}/finance`)}>المالية والدفتر</a>
              : <span className="tmk-field__hint">عرض الدفتر والأرصدة يحتاج صلاحية <code>finance.read</code>، وهي منفصلة عن إدارة المشروع عمدًا.</span>}
          </p>
          <Notice tone="warning" title="بيئة عرض — لا أموال حقيقية">
            <p style={{ marginBlockEnd: 0 }}>
              لا يوجد مزود دفع حقيقي في هذه النسخة. كل مبلغ أعلاه نتج عن مسار دفع محاكى.
            </p>
          </Notice>
        </Card>
      )}

      {/* ---- readiness ---- */}
      <Card title="جاهزية الإرسال للمراجعة" id="readiness">
        {plan.readiness.ready
          ? <p className="status ready">الخطة مكتملة ويمكن إرسالها للمراجعة.</p>
          : <>
              <p>لا يمكن الإرسال قبل معالجة ما يلي:</p>
              <ul>{plan.readiness.blockers.map(blocker => <li key={blocker}>{blockerLabels[blocker] ?? blocker}</li>)}</ul>
            </>}
        {editable && can('project.submit') ? (
          <button type="button" className="tmk-button tmk-button--primary" disabled={busy || !plan.readiness.ready} onClick={() => void action(async () => {
            await api(`/orgs/${orgId}/projects/${projectId}/submit`, 'POST', { version: plan.version });
            await reload();
            setNotice('أُرسلت الخطة للمراجعة. لا يمكن تعديلها أثناء المراجعة.');
          })}>إرسال للمراجعة</button>
        ) : null}
      </Card>

      {/* ---- campaign ---- */}
      <Card title="الحملة وسياسة التمويل" id="campaign">
        <p className="tmk-field__hint">
          سياسة التمويل والعملة تثبتان عند النشر، لأن المساهم يقرر بناءً على ما يحدث إن لم يبلغ الهدف.
        </p>
        {editable && can('project.update') ? (
          <form key={`campaign-${plan.version}`} onSubmit={onSubmit(async data => {
            await api(`/orgs/${orgId}/projects/${projectId}/campaign`, 'PUT', {
              goalMinor: toMinor(String(data.get('goal') ?? '')),
              currency: data.get('currency'),
              policy: data.get('policy'),
              endsAt: new Date(`${String(data.get('endsAt'))}T00:00:00.000Z`).toISOString(),
              version: plan.version
            });
            await reload();
            setNotice('حُفظت الحملة.');
          })}>
            <label className="field">هدف التمويل<input name="goal" required inputMode="decimal" defaultValue={plan.campaign ? toMajor(plan.campaign.goalMinor) : ''} /></label>
            <label className="field">العملة
              <select name="currency" defaultValue={currency}><option value="ILS">ILS</option><option value="JOD">JOD</option><option value="USD">USD</option></select>
            </label>
            <label className="field">سياسة التمويل
              <select name="policy" defaultValue={plan.campaign?.policy ?? 'flexible'}>
                <option value="flexible">مرنة — يُنفذ جزئيًا وفق ميزانية مرحلية</option>
                <option value="all_or_nothing">الكل أو لا شيء — تُعاد الأموال إن لم يبلغ الهدف</option>
              </select>
            </label>
            <label className="field">ينتهي الجمع<input name="endsAt" type="date" required defaultValue={plan.campaign?.endsAt.slice(0, 10) ?? ''} /></label>
            <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الحملة'}</button>
          </form>
        ) : plan.campaign ? (
          <dl>
            <div><dt>الهدف</dt><dd><span className="tmk-money">{toMajor(plan.campaign.goalMinor)} {plan.campaign.currency}</span></dd></div>
            <div><dt>السياسة</dt><dd>{plan.campaign.policy === 'flexible' ? 'مرنة' : 'الكل أو لا شيء'}</dd></div>
            <div><dt>ينتهي</dt><dd>{formatDate(plan.campaign.endsAt, locale)}</dd></div>
          </dl>
        ) : <EmptyState title="لم تُحدَّد الحملة بعد" />}
      </Card>

      {/* ---- location: any member who can update the project, in any state ---- */}
      {can('project.update') ? <ProjectLocationEditor orgId={orgId} projectId={projectId} /> : null}

      {/* ---- budget ---- */}
      <Card title="الميزانية" id="budget">
        <p className="tmk-field__hint">تعديل الميزانية ينشئ نسخة جديدة ولا يستبدل السابقة. النسخ السابقة محفوظة ولا تُحذف.</p>
        <DataTable
          caption={`بنود الميزانية — المجموع ${toMajor(plan.budget.totalMinor)} ${currency}`}
          rows={plan.budget.lines}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا بنود ميزانية بعد" />}
          columns={[
            { key: 'label', header: 'البند', cell: row => row.label },
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <span className="tmk-money">{toMajor(row.amountMinor)} {currency}</span> }
          ]}
        />
        {can('project.update') && (editable || published) ? (
          <form key={`budget-${plan.version}`} onSubmit={onSubmit(async data => {
            const labels = data.getAll('lineLabel').map(String);
            const amounts = data.getAll('lineAmount').map(String);
            const lines = labels.map((label, index) => ({ label, amountMinor: toMinor(amounts[index] ?? '') })).filter(line => line.label.trim());
            if (!lines.length) throw new Error('أضف بندًا واحدًا على الأقل.');
            await api(`/orgs/${orgId}/projects/${projectId}/budget`, 'PUT', { lines, reason: String(data.get('reason') ?? ''), version: plan.version });
            await reload();
            setNotice('حُفظت الميزانية وسُجّلت النسخة السابقة كمراجعة.');
          })}>
            <p className="note">أدخل حتى ستة بنود. البنود الفارغة تُتجاهل.</p>
            {Array.from({ length: 6 }, (_, index) => {
              const line = plan.budget.lines[index];
              return (
                <div className="member-actions" key={index}>
                  <label className="field">بند {index + 1}<input name="lineLabel" defaultValue={line?.label ?? ''} maxLength={140} /></label>
                  <label className="field">المبلغ<input name="lineAmount" inputMode="decimal" defaultValue={line ? toMajor(line.amountMinor) : ''} /></label>
                </div>
              );
            })}
            <label className="field">سبب التعديل {published ? '— مطلوب بعد النشر' : '— اختياري قبل النشر'}
              <textarea name="reason" rows={2} maxLength={1000} defaultValue="" />
            </label>
            <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ الميزانية'}</button>
          </form>
        ) : null}
        {plan.budget.revisions.length ? (
          <>
            <h3>نسخ الميزانية السابقة</h3>
            {plan.budget.revisions.map(revision => (
              <article className="tmk-row" key={revision.id}>
                <div>
                  <strong>النسخة {revision.sequence} — <span className="tmk-money">{toMajor(revision.totalMinor)} {currency}</span></strong>
                  <p className="tmk-field__hint">{formatDate(revision.createdAt, locale)}{revision.reason ? ` · ${revision.reason}` : ''}</p>
                </div>
              </article>
            ))}
          </>
        ) : null}
      </Card>

      {/* ---- milestones ---- */}
      <Card title="المراحل" id="milestones">
        <p className="tmk-field__hint">
          إنجاز المشروع يُقاس بأوزان المراحل المتحقق منها، لا بنسبة المال المجموع. مجموع الأوزان 100.
        </p>
        <DataTable
          caption={`المراحل — مجموع الميزانية ${toMajor(plan.milestoneTotalMinor)} ${currency}`}
          rows={plan.milestones}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا مراحل بعد" />}
          columns={[
            { key: 'title', header: 'المرحلة', cell: row => row.title },
            { key: 'budget', header: 'الميزانية', numeric: true, cell: row => <span className="tmk-money">{toMajor(row.budgetMinor)} {currency}</span> },
            { key: 'weight', header: 'الوزن', numeric: true, cell: row => `${row.weight}%` },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={row.state === 'verified' ? 'success' : row.state === 'evidence_submitted' ? 'info' : 'neutral'}>{row.state === 'verified' ? 'متحقق منها' : row.state === 'evidence_submitted' ? 'بانتظار مراجعة الأثر' : 'مخططة'}</StatusBadge> },
            {
              key: 'evidence', header: 'إثبات', cell: row => published && can('project.update') && ['planned', 'active'].includes(row.state)
                ? <form style={{ margin: 0 }} onSubmit={onSubmit(async data => {
                    await api(`/orgs/${orgId}/projects/${projectId}/milestones/${row.id}/evidence`, 'POST', { note: data.get('note') });
                    await reload();
                    setNotice('سُجّل إثبات المرحلة وأُرسل لمراجعة الأثر. لا تتحقق الجهة من مرحلتها بنفسها.');
                  })}>
                    <label className="field"><span className="tmk-visually-hidden">وصف الإثبات</span><input name="note" required minLength={10} maxLength={2000} placeholder="فواتير وصور التسليم" /></label>
                    <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>تقديم إثبات</button>
                  </form>
                : row.evidenceNote || '—'
            }
          ]}
        />
        {editable && can('project.update') ? (
          <form key={`milestones-${plan.version}`} onSubmit={onSubmit(async data => {
            const titles = data.getAll('msTitle').map(String);
            const budgets = data.getAll('msBudget').map(String);
            const weights = data.getAll('msWeight').map(String);
            const milestones = titles
              .map((title, index) => ({ title, budgetMinor: budgets[index] ? toMinor(budgets[index]!) : '0', weight: Number(weights[index] ?? 0) }))
              .filter(milestone => milestone.title.trim());
            if (!milestones.length) throw new Error('أضف مرحلة واحدة على الأقل.');
            await api(`/orgs/${orgId}/projects/${projectId}/milestones`, 'PUT', { milestones, version: plan.version });
            await reload();
            setNotice('حُفظت المراحل.');
          })}>
            {Array.from({ length: 5 }, (_, index) => {
              const milestone = plan.milestones[index];
              return (
                <div className="member-actions" key={index}>
                  <label className="field">مرحلة {index + 1}<input name="msTitle" defaultValue={milestone?.title ?? ''} maxLength={140} /></label>
                  <label className="field">الميزانية<input name="msBudget" inputMode="decimal" defaultValue={milestone ? toMajor(milestone.budgetMinor) : ''} /></label>
                  <label className="field">الوزن %<input name="msWeight" type="number" min={1} max={100} defaultValue={milestone?.weight ?? ''} /></label>
                </div>
              );
            })}
            <button type="submit" disabled={busy}>{busy ? 'جارٍ الحفظ…' : 'حفظ المراحل'}</button>
          </form>
        ) : null}
      </Card>

      {/* ---- lifecycle ---- */}
      {published || plan.state === 'paused' ? (
        <Card title="دورة حياة المشروع" id="lifecycle">
          <div className="member-actions">
            {plan.state === 'paused' && can('project.pause') ? (
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => {
                await api(`/orgs/${orgId}/projects/${projectId}/resume`, 'POST', { version: plan.version });
                await reload(); setNotice('استؤنف المشروع.');
              })}>استئناف الجمع</button>
            ) : null}
          </div>
          {plan.state !== 'paused' && can('project.pause') ? (
            <form onSubmit={onSubmit(async data => {
              await api(`/orgs/${orgId}/projects/${projectId}/pause`, 'POST', { reason: data.get('reason'), version: plan.version });
              await reload(); setNotice('أُوقف الجمع. الالتزامات القائمة لا تتأثر.');
            })}>
              <label className="field">سبب إيقاف الجمع<textarea name="reason" rows={2} required minLength={10} maxLength={1000} /></label>
              <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>إيقاف الجمع</button>
            </form>
          ) : null}
          {can('project.close') && plan.state !== 'impact_review' ? (
            <form onSubmit={onSubmit(async data => {
              await api(`/orgs/${orgId}/projects/${projectId}/close`, 'POST', { reason: data.get('reason'), version: plan.version });
              await reload(); setNotice('أُرسل طلب الإغلاق إلى مراجعة الأثر. لا يُعد المشروع مكتملًا بهذا الطلب.');
            })}>
              <label className="field">سبب طلب الإغلاق<textarea name="reason" rows={2} required minLength={10} maxLength={1000} /></label>
              <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>طلب إغلاق المشروع</button>
            </form>
          ) : null}
          <p className="note">طلب الإغلاق ينقل المشروع إلى مراجعة الأثر. الإكمال قرار مراجع، لا ضغطة زر من مدير المشروع.</p>
        </Card>
      ) : null}

      {/* ---- review history ---- */}
      <Card title="سجل المراجعة" id="reviews">
        {!plan.versions.length ? <EmptyState title="لم تُرسل نسخة للمراجعة بعد" /> : plan.versions.map(version => (
          <article className="tmk-row" key={version.id}>
            <div>
              <strong>النسخة {version.sequence}</strong>
              <p className="tmk-field__hint">أُرسلت {formatDate(version.submittedAt, locale, true)}</p>
              {version.decision ? <p>{version.decision.publicReason || 'لا ملاحظة عامة.'}</p> : null}
            </div>
            <StatusBadge tone={version.decision?.outcome === 'approved' ? 'success' : version.decision?.outcome === 'rejected' ? 'danger' : version.decision ? 'warning' : 'info'}>
              {version.decision
                ? version.decision.outcome === 'approved' ? 'معتمدة' : version.decision.outcome === 'rejected' ? 'مرفوضة' : 'طلب تعديلات'
                : 'بانتظار المراجعة'}
            </StatusBadge>
          </article>
        ))}
        {latestDecision && plan.state === 'approved' ? (
          <Notice tone="info">
            <p style={{ marginBlockEnd: 0 }}>اعتُمد المشروع ولم يُنشر بعد. النشر إجراء مراجع المحتوى، ويُعاد عنده فحص توثيق الجهة واكتمال الخطة.</p>
          </Notice>
        ) : null}
      </Card>

      {/* ---- reports ---- */}
      <Card title="التقارير" id="reports">
        <p className="tmk-field__hint">التقرير المنشور لقطة مجمدة بتاريخها. التصحيح يكون بتقرير جديد لا بتعديل المنشور.</p>
        <DataTable
          caption="تقارير المشروع"
          rows={plan.reports}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا تقارير بعد" />}
          columns={[
            { key: 'title', header: 'التقرير', cell: row => row.title },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={row.state === 'published' ? 'success' : row.state === 'submitted' ? 'info' : 'neutral'}>{row.state === 'published' ? 'منشور' : row.state === 'submitted' ? 'بانتظار النشر' : 'مسودة'}</StatusBadge> },
            {
              key: 'actions', header: 'إجراءات', cell: row => (
                <span className="tmk-row__actions">
                  {row.state === 'draft' && can('report.submit') ? (
                    <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => {
                      await api(`/orgs/${orgId}/reports/${row.id}/submit`, 'POST', { version: row.version });
                      await reload(); setNotice('أُرسل التقرير للمراجعة الداخلية.');
                    })}>إرسال</button>
                  ) : null}
                  {row.state === 'submitted' && can('report.publish') ? (
                    <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
                      await api(`/orgs/${orgId}/reports/${row.id}/publish`, 'POST', { version: row.version });
                      await reload(); setNotice('نُشر التقرير كلقطة مجمدة. كاتب التقرير لا ينشره بنفسه.');
                    })}>نشر</button>
                  ) : null}
                </span>
              )
            }
          ]}
        />
        {can('report.create') ? (
          <form onSubmit={onSubmit(async data => {
            await api(`/orgs/${orgId}/projects/${projectId}/reports`, 'POST', {
              title: data.get('title'), periodStart: data.get('periodStart'),
              periodEnd: data.get('periodEnd'), body: data.get('body')
            });
            await reload(); setNotice('أُنشئت مسودة تقرير.');
          })}>
            <label className="field">عنوان التقرير<input name="title" required minLength={5} maxLength={140} /></label>
            <div className="member-actions">
              <label className="field">من<input name="periodStart" type="date" required /></label>
              <label className="field">إلى<input name="periodEnd" type="date" required /></label>
            </div>
            <label className="field">نص التقرير — 50 حرفًا على الأقل قبل الإرسال<textarea name="body" rows={5} maxLength={40000} /></label>
            <button type="submit" disabled={busy}>{busy ? 'جارٍ الإنشاء…' : 'أنشئ مسودة تقرير'}</button>
          </form>
        ) : null}
      </Card>
    </>
  );
}
