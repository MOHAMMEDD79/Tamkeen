'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Ltr, MoneyAmount, Notice, PageHeader,
  Skeleton, Stat, StatusBadge, formatDate, formatMinorUnits, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * PART-07 screens: ORG-11 (request a disbursement), ORG-12 (review and track it), and ADM-05/ADM-06
 * (the platform finance centre and the execution of one disbursement).
 *
 * The split of authority drives the layout. An organisation asks and approves; the platform sends
 * the money. Each screen shows only the half its reader can act on, and states the other half
 * rather than offering a control that would be refused.
 *
 * Three things these screens must never do:
 *  - present "approved" as "paid": they are different facts, shown as different rows;
 *  - offer a retry on an unknown outcome, because re-sending pays twice (08);
 *  - show a bank identifier. Only the last four digits ever reach the browser.
 */

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
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
    forbidden: 'لا تملك صلاحية هذا الإجراء. اعتماد الصرف وتنفيذه صلاحيتان منفصلتان عمدًا.',
    not_found: 'المورد غير موجود ضمن نطاقك.',
    conflict: 'تعذّر الإجراء: إمّا تغيّرت البيانات، أو لا يسمح الرصيد المتاح، أو تغيّر الطلب بعد اعتماده.',
    invalid_input: 'تحقق من الحقول: المبلغ بوحدات صحيحة موجبة، والسبب عشرة أحرف على الأقل.',
    mfa_unavailable: 'اعتماد الصرف يتطلب تفعيل التحقق بخطوتين على حسابك.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

const toMinor = (major: string) => {
  const cleaned = major.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('أدخل مبلغًا صحيحًا مثل 1000 أو 1000.50.');
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (minor === '0') throw new Error('المبلغ يجب أن يكون أكبر من صفر.');
  return minor;
};

const payoutStates: Record<string, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  requested: { text: 'بانتظار الاعتماد', tone: 'warning' },
  approved: { text: 'معتمد — لم يُنفّذ بعد', tone: 'info' },
  rejected: { text: 'مرفوض', tone: 'danger' },
  cancelled: { text: 'مسحوب', tone: 'neutral' },
  queued: { text: 'أُرسل للمزود', tone: 'info' },
  processing: { text: 'قيد التنفيذ لدى المزود', tone: 'info' },
  paid: { text: 'مدفوع بإثبات', tone: 'success' },
  failed: { text: 'فشل', tone: 'danger' },
  unknown: { text: 'نتيجة غير معلومة', tone: 'danger' }
};

const refundStates: Record<string, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  requested: { text: 'بانتظار الاعتماد', tone: 'warning' },
  approved: { text: 'معتمد', tone: 'info' },
  rejected: { text: 'مرفوض', tone: 'danger' },
  processing: { text: 'قيد التنفيذ', tone: 'info' },
  succeeded: { text: 'تم الاسترداد', tone: 'success' },
  failed: { text: 'فشل', tone: 'danger' },
  unknown: { text: 'نتيجة غير معلومة', tone: 'danger' }
};

interface Context { organization: { id: string; displayName: string }; permissions: string[] }
interface Me { user: { id: string }; contexts: Context[]; platformRoles: string[] }

interface Payout {
  id: string; projectId: string; organizationId: string; milestoneId: string | null;
  amountMinor: string; currency: string; reason: string; invoiceReference: string;
  state: string; requestHash: string;
  beneficiary: { bankName: string; holder: string; last4: string };
  makerId: string; approverId: string | null; approvedAt: string | null;
  providerReference: string | null; paidProofReference: string | null; paidAt: string | null;
  failureReason: string; lastInquiredAt: string | null;
  awaitingProvider: boolean; needsInquiry: boolean; simulated: boolean; version: number; createdAt: string;
  project?: { id: string; slug: string; title: string };
  milestone?: { id: string; title: string; sequence: number } | null;
  decisions?: Array<{ id: string; action: string; actor: string; reason: string; at: string; matchesCurrentRequest: boolean }>;
  organization?: { id: string; displayName: string };
}

const decisionLabels: Record<string, string> = {
  requested: 'طُلب', approved: 'اعتُمد', rejected: 'رُفض', withdrawn: 'سُحب', executed: 'أُرسل للمزود', inquired: 'استُعلم عن الحالة'
};

// ---------------------------------------------------------------------------------------------
// ORG-11 / ORG-12 — the organisation asks, then reviews
// ---------------------------------------------------------------------------------------------

export function OrgPayouts({ locale, orgId, payoutId, mode }: { locale: Locale; orgId: string; payoutId?: string; mode: 'list' | 'new' | 'detail' }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [me, setMe] = useState<Me | null>(null);
  const [rows, setRows] = useState<Payout[] | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [projects, setProjects] = useState<Array<{ id: string; title: string; state: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const current = await api('/me') as Me;
    setMe(current);
    if (mode === 'detail' && payoutId) {
      setPayout(await api(`/payouts/${payoutId}`) as Payout);
    } else {
      setRows(await api(`/orgs/${orgId}/payouts`) as Payout[]);
    }
    if (mode === 'new') {
      const list = await api(`/orgs/${orgId}/projects`) as Array<{ id: string; title: string; state: string }>;
      // Only a project that is actually running can receive a disbursement.
      setProjects(list.filter(project => ['published', 'executing', 'impact_review', 'funding_closed'].includes(project.state)));
    }
  }, [orgId, payoutId, mode]);

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

  const shell = (children: ReactNode) => (
    <AppShell
      locale={locale} path={mode === 'detail' ? `/org/${orgId}/payouts/${payoutId}` : mode === 'new' ? `/org/${orgId}/payouts/new` : `/org/${orgId}/payouts`}
      signedIn={Boolean(me)}
      {...(context ? { activeContextName: context.organization.displayName } : {})}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}
    >
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={L(`/org/${orgId}`)}>{context?.organization.displayName ?? '—'}</a></li>
          <li><a href={L(`/org/${orgId}/payouts`)}>الصرف</a></li>
          {mode !== 'list' ? <li><span aria-current="page">{mode === 'new' ? 'طلب جديد' : 'تفاصيل الطلب'}</span></li> : null}
        </ol>
      </nav>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!me || !context) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }

  // ---- ORG-11: the request form ----------------------------------------------------------------
  if (mode === 'new') {
    if (!can('payout.request')) {
      return shell(
        <ErrorState title={t('forbiddenTitle')}>
          طلب الصرف يحتاج صلاحية <code>payout.request</code>، وهي دور مالي منفصل عن إدارة المشروع.
        </ErrorState>
      );
    }
    const submit = (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      void action(async () => {
        const created = await api(`/orgs/${orgId}/payouts`, 'POST', {
          projectId: String(data.get('projectId') ?? ''),
          amountMinor: toMinor(String(data.get('amount') ?? '')),
          reason: String(data.get('reason') ?? ''),
          ...(data.get('invoiceReference') ? { invoiceReference: String(data.get('invoiceReference')) } : {})
        }) as Payout;
        window.location.href = L(`/org/${orgId}/payouts/${created.id}`);
        return 'أُنشئ الطلب وحُجز المبلغ. لم يُدفع شيء بعد.';
      });
    };
    return shell(
      <>
        <PageHeader
          dashboard
          title="طلب صرف"
          lead="يُحجز المبلغ فور الإرسال حتى لا يُطلب المال نفسه مرتين، ثم يعتمده شخص آخر، ثم تنفّذه المنصة."
        />
        <Notice tone="info" title="ثلاث خطوات بثلاثة أشخاص">
          <p style={{ marginBlockEnd: 0 }}>
            أنت تطلب، ويعتمد زميل يحمل <code>payout.approve</code> (ولا يمكن أن يكون أنت)، ثم تنفّذ
            المنصة التحويل. الحجز ليس دفعًا، والاعتماد ليس دفعًا: لا يُعدّ المبلغ مدفوعًا إلا بإثبات
            من المزود.
          </p>
        </Notice>
        <form onSubmit={submit} autoComplete="off">
          <Card title="الطلب">
            {projects.length === 0 ? (
              <EmptyState title="لا يوجد مشروع قابل للصرف">
                الصرف يكون من وعاء تمويل مشروع منشور. لا يوجد مشروع بهذه الحالة في هذه الجهة الآن.
              </EmptyState>
            ) : (
              <>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="payout-project">المشروع</label>
                  <select id="payout-project" name="projectId" className="tmk-input" required>
                    {projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}
                  </select>
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="payout-amount">المبلغ</label>
                  <p className="tmk-field__hint" id="payout-amount-hint">
                    لا يمكن أن يتجاوز المتاح للصرف — وهو النقد المسوّى بعد خصم الحجوزات، لا إجمالي ما جُمع.
                  </p>
                  <input id="payout-amount" name="amount" className="tmk-input" inputMode="decimal" required aria-describedby="payout-amount-hint" autoComplete="off" />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="payout-invoice">مرجع الفاتورة</label>
                  <input id="payout-invoice" name="invoiceReference" className="tmk-input" maxLength={120} autoComplete="off" />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="payout-reason">السبب</label>
                  <p className="tmk-field__hint" id="payout-reason-hint">
                    ما الذي يُصرف مقابله. يظهر للمعتمد، ويُثبّت في بصمة الطلب: تعديله لاحقًا يُبطل الاعتماد.
                  </p>
                  <textarea id="payout-reason" name="reason" className="tmk-input" rows={3} minLength={10} maxLength={1000} required aria-describedby="payout-reason-hint" />
                </div>
              </>
            )}
          </Card>
          <Card title="المستفيد">
            <p className="tmk-field__hint">
              يُحوَّل إلى الحساب البنكي الموثق للجهة فقط، ولا يمكن اختيار حساب آخر من هنا. يُلتقط الحساب
              كما هو الآن ضمن الطلب، وتغييره بعد الاعتماد يُبطل الاعتماد ويعيد الطلب للمراجعة.
            </p>
          </Card>
          <p className="tmk-row__actions">
            <button type="submit" className="tmk-button tmk-button--primary" disabled={busy || projects.length === 0}>
              {busy ? 'جارٍ الإرسال…' : 'أرسل للاعتماد'}
            </button>
            <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/payouts`)}>إلغاء قبل الإرسال</a>
          </p>
        </form>
      </>
    );
  }

  // ---- ORG-12: one request in detail ------------------------------------------------------------
  if (mode === 'detail') {
    if (!payout) return shell(<ErrorState title={t('notFoundTitle')}>{t('notFoundBody')}</ErrorState>);
    const state = payoutStates[payout.state] ?? { text: payout.state, tone: 'neutral' as const };
    const isMaker = payout.makerId === me.user.id;
    return shell(
      <>
        <PageHeader
          dashboard
          eyebrow={payout.project?.title ?? 'مشروع'}
          title={<>صرف <MoneyAmount minor={payout.amountMinor} currency={payout.currency} locale={locale} /></>}
          lead={payout.reason}
          actions={<StatusBadge tone={state.tone}>{state.text}</StatusBadge>}
        />

        {payout.needsInquiry ? (
          <Notice tone="danger" title="نتيجة التحويل غير معلومة">
            <p style={{ marginBlockEnd: 0 }}>
              انقطع الاتصال قبل أن نعرف ما حدث. <strong>لا تُعاد المحاولة</strong>: إعادة إرسال تحويل
              ربما نُفّذ فعلًا تدفع المبلغ مرتين. الحل الوحيد أن تستعلم المنصة من المزود، وحتى ذلك الحين
              يبقى المبلغ محجوزًا ولا يتحرك في أي اتجاه.
            </p>
          </Notice>
        ) : null}

        <Card title="الحالة">
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="المبلغ" value={<MoneyAmount minor={payout.amountMinor} currency={payout.currency} locale={locale} />} />
            <Stat
              label="الاعتماد"
              value={payout.approvedAt ? formatDate(payout.approvedAt, locale) : '—'}
              note={payout.approvedAt ? 'اعتماد ليس دفعًا' : 'لم يُعتمد بعد'}
            />
            <Stat
              label="إثبات الدفع"
              value={payout.paidProofReference ? <Ltr><code>{payout.paidProofReference}</code></Ltr> : '—'}
              note={payout.paidProofReference ? 'مرجع مستقل من المزود' : 'يظهر بعد تأكيد خروج المال فقط'}
            />
            <Stat
              label="المستفيد"
              value={<>{payout.beneficiary.bankName} <Ltr>····{payout.beneficiary.last4}</Ltr></>}
              note="لا يُعرض رقم الحساب كاملًا في أي شاشة"
            />
          </div>
          {payout.failureReason ? <Notice tone="warning" title="سبب عدم الإكمال"><p style={{ marginBlockEnd: 0 }}>{payout.failureReason}</p></Notice> : null}
          <p className="tmk-field__hint">
            بصمة الطلب: <Ltr><code>{payout.requestHash.slice(0, 16)}…</code></Ltr> — الاعتماد مرتبط بها،
            وأي تغيير في المبلغ أو المستفيد أو السبب يُبطله.
          </p>
        </Card>

        <Card title="الإجراءات">
          <p className="tmk-row__actions">
            {payout.state === 'requested' && can('payout.approve') && !isMaker ? (
              <>
                <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
                  await api(`/payouts/${payout.id}/approve`, 'POST', { requestHash: payout.requestHash, version: payout.version });
                  return 'اعتُمد الطلب. تنفيذ التحويل من مسؤولية المنصة، لا الجهة.';
                })}>اعتماد</button>
                <button type="button" className="tmk-button tmk-button--danger" disabled={busy} onClick={() => void action(async () => {
                  const reason = window.prompt('سبب الرفض (عشرة أحرف على الأقل):') ?? '';
                  if (reason.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                  await api(`/payouts/${payout.id}/reject`, 'POST', { reason, version: payout.version });
                  return 'رُفض الطلب وعاد المبلغ إلى رصيد المشروع.';
                })}>رفض</button>
              </>
            ) : null}

            {['requested', 'approved'].includes(payout.state) && isMaker && can('payout.request') ? (
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => {
                await api(`/payouts/${payout.id}/withdraw`, 'POST', { version: payout.version });
                return 'سُحب الطلب وعاد المبلغ إلى رصيد المشروع.';
              })}>سحب الطلب</button>
            ) : null}

            <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
              return 'حُدِّثت الحالة من الخادم.';
            })}>تحديث الحالة</button>
          </p>

          {/* 00-MASTER-PROMPT forbids a control that does nothing: where an action is unavailable the
              reason stands in its place instead of a button that would be refused. */}
          {payout.state === 'requested' && isMaker ? (
            <p className="tmk-field__hint">لا يمكنك اعتماد طلبك: من يطلب المال لا يعتمده، وهذا مفروض في قاعدة البيانات لا في الواجهة فقط.</p>
          ) : null}
          {payout.awaitingProvider ? (
            <p className="tmk-field__hint">أُرسل التحويل للمزود. لا يمكن سحبه الآن، ولا تُتاح إعادة إرسال، لأن المزود وحده يعرف ما حدث.</p>
          ) : null}
          {payout.needsInquiry ? (
            <p className="tmk-field__hint">الاستعلام من المزود إجراء تشغيلي على مستوى المنصة (<code>payment.inquire</code>)، وليس إجراءً للجهة.</p>
          ) : null}
        </Card>

        <Card title="سجل القرارات">
          <p className="tmk-field__hint">
            سجل غير قابل للتعديل أو الحذف. «يطابق الطلب الحالي» يعني أن القرار اتُّخذ على النسخة
            المعروضة أعلاه وليس على نسخة أقدم منها.
          </p>
          <DataTable
            caption="قرارات هذا الطلب بالترتيب"
            rows={payout.decisions ?? []}
            rowKey={row => row.id}
            columns={[
              { key: 'action', header: 'الإجراء', cell: row => decisionLabels[row.action] ?? row.action },
              { key: 'actor', header: 'الشخص', cell: row => row.actor },
              { key: 'at', header: 'الوقت', cell: row => formatDate(row.at, locale, true) },
              { key: 'reason', header: 'السبب', cell: row => row.reason || '—' },
              {
                key: 'match', header: 'يطابق الطلب الحالي',
                cell: row => row.matchesCurrentRequest
                  ? <StatusBadge tone="success">نعم</StatusBadge>
                  : <StatusBadge tone="warning">نسخة أقدم</StatusBadge>
              }
            ]}
            emptyState={<EmptyState title="لا قرارات بعد">لم يُسجَّل أي قرار على هذا الطلب.</EmptyState>}
          />
        </Card>

        {payout.simulated ? (
          <Notice tone="warning" title="بيئة عرض — لا أموال حقيقية">
            <p style={{ marginBlockEnd: 0 }}>لا يوجد مزود تحويل حقيقي في هذه النسخة؛ لم تنتقل أي أموال.</p>
          </Notice>
        ) : null}
      </>
    );
  }

  // ---- ORG-12 list --------------------------------------------------------------------------------
  return shell(
    <>
      <PageHeader
        dashboard
        title="الصرف"
        lead="طلبات الصرف من أوعية تمويل هذه الجهة، أحدثها أولًا."
        actions={can('payout.request') ? <a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/payouts/new`)}>طلب صرف</a> : undefined}
      />
      {!rows?.length ? (
        <EmptyState title="لا طلبات صرف بعد" action={can('payout.request') ? <a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/payouts/new`)}>طلب صرف</a> : undefined}>
          لم يُطلب أي صرف من أوعية هذه الجهة حتى الآن.
        </EmptyState>
      ) : (
        <Card title="الطلبات">
          <DataTable
            caption="طلبات الصرف"
            rows={rows}
            rowKey={row => row.id}
            columns={[
              { key: 'project', header: 'المشروع', cell: row => row.project?.title ?? '—' },
              { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} /> },
              { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={(payoutStates[row.state] ?? { tone: 'neutral' as const }).tone}>{(payoutStates[row.state] ?? { text: row.state }).text}</StatusBadge> },
              { key: 'beneficiary', header: 'المستفيد', cell: row => <Ltr>····{row.beneficiary.last4}</Ltr> },
              { key: 'createdAt', header: 'التاريخ', cell: row => formatDate(row.createdAt, locale) },
              { key: 'open', header: 'تفاصيل', cell: row => <a href={L(`/org/${orgId}/payouts/${row.id}`)}>افتح</a> }
            ]}
            emptyState={null}
          />
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// ADM-05 / ADM-06 — the platform finance centre
// ---------------------------------------------------------------------------------------------

interface ReconciliationItem {
  id: string; batchId: string; providerTransactionId: string; amountMinor: string; currency: string;
  feeMinor: string; outcome: string; matchState: string;
  ourAmountMinor: string | null; ourFeeMinor: string | null; ourState: string | null;
  note: string; resolvedAt: string | null; resolutionReason: string; version: number;
}
interface FinanceCentre {
  reconciliation: {
    lastRunAt: string | null; environment: string;
    batches: Array<{ id: string; source: string; environment: string; statementDate: string; rowCount: number; state: string; lastRunAt: string | null; version: number }>;
    openItems: ReconciliationItem[];
    awaitingInquiry: { payouts: number; refunds: number };
    isolatedEvents: number;
  };
  payouts: Payout[];
  refunds: Array<{ id: string; contributionId: string; amountMinor: string; currency: string; state: string; feeMinor: string; needsInquiry: boolean; version: number; createdAt: string }>;
  disputes: Array<{ id: string; contributionId: string; amountMinor: string; currency: string; state: string; reason: string; coveragePlan: string; version: number }>;
}

/**
 * Parses a pasted provider statement into rows.
 *
 * CSV rather than a file upload because there is no document store yet, and a paste box is honest
 * about that: the operator can see exactly what is being sent. Every field is checked here so a
 * malformed line is named by its line number instead of the whole import failing as one 422.
 */
function parseStatement(text: string) {
  const lines = text.split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  if (lines.length === 0) throw new Error('ألصق سطرًا واحدًا على الأقل من كشف المزود.');
  // A header row is accepted and skipped, because operators paste straight out of a spreadsheet.
  const body = /^[a-zA-Z_]+\s*,/.test(lines[0] ?? '') && !/^[a-zA-Z0-9_-]+\s*,\s*\d/.test(lines[0] ?? '') ? lines.slice(1) : lines;
  return body.map((line, index) => {
    const parts = line.split(',').map(part => part.trim());
    const [providerTransactionId, amountMinor, currency, feeMinor, outcome] = parts;
    const at = `السطر ${index + 1}`;
    if (parts.length < 4) throw new Error(`${at}: يحتاج على الأقل المرجع والمبلغ والعملة والنتيجة.`);
    if (!providerTransactionId) throw new Error(`${at}: مرجع المعاملة مفقود.`);
    if (!amountMinor || !/^[0-9]{1,16}$/.test(amountMinor)) throw new Error(`${at}: المبلغ يجب أن يكون وحدات صغرى صحيحة بلا فاصلة.`);
    if (!currency || !/^[A-Za-z]{3}$/.test(currency)) throw new Error(`${at}: رمز العملة يجب أن يكون ثلاثة أحرف.`);
    // The fee is optional, so a four-column line means the last value is the outcome.
    const hasFee = parts.length >= 5 && /^[0-9]{1,16}$/.test(feeMinor ?? '');
    const finalOutcome = (hasFee ? outcome : feeMinor) ?? '';
    if (!finalOutcome) throw new Error(`${at}: نتيجة العملية مفقودة.`);
    return {
      providerTransactionId,
      amountMinor,
      currency: currency.toUpperCase(),
      ...(hasFee ? { feeMinor } : {}),
      outcome: finalOutcome
    };
  });
}

/** The server reports differences as codes so the screen can name them in the reader's language. */
const noteLabels: Record<string, string> = {
  amount_differs: 'المبلغ مختلف',
  currency_differs: 'العملة مختلفة',
  fee_differs: 'الرسوم مختلفة',
  outcome_differs: 'النتيجة مختلفة',
  payout_differs: 'أرقام الصرف أو حالته تخالف الكشف',
  refund_differs: 'أرقام الاسترداد أو حالته تخالف الكشف',
  no_record: 'المزود أبلغ عن عملية لا نملك لها سجلًا'
};
const describeNote = (note: string) => {
  const codes = note.split(' ').filter(Boolean);
  // An unrecognised note is shown whole rather than chopped on its spaces: a row written by an
  // older build carries a sentence, and splitting it would render word salad.
  if (!codes.every(code => code in noteLabels)) return note;
  return codes.map(code => noteLabels[code]).join('، ');
};

const matchLabels: Record<string, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  match: { text: 'مطابق', tone: 'success' },
  mismatch: { text: 'اختلاف', tone: 'warning' },
  missing: { text: 'لا سجل لدينا', tone: 'danger' },
  duplicate: { text: 'مكرر', tone: 'warning' }
};

export function AdminFinance({ locale, payoutId }: { locale: Locale; payoutId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [centre, setCentre] = useState<FinanceCentre | null>(null);
  const [payout, setPayout] = useState<Payout | null>(null);
  const [allowed, setAllowed] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    if (payoutId) setPayout(await api(`/payouts/${payoutId}`) as Payout);
    setCentre(await api('/admin/finance') as FinanceCentre);
  }, [payoutId]);

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
    <AppShell locale={locale} path={payoutId ? `/admin/disbursements/${payoutId}` : '/admin/finance'} signedIn={Boolean(centre)}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={8} label={t('loading')} />);
  if (!allowed || !centre) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>
        مركز المدفوعات يحتاج منحة <code>FinanceOperator</code> مع تحقق بخطوتين. تنفيذ التحويلات
        مسؤولية المنصة، ولا تُمنح لأي دور داخل الجهات.
      </ErrorState>
    );
  }

  // ---- ADM-06: one disbursement -----------------------------------------------------------------
  if (payoutId) {
    if (!payout) return shell(<ErrorState title={t('notFoundTitle')}>{t('notFoundBody')}</ErrorState>);
    const state = payoutStates[payout.state] ?? { text: payout.state, tone: 'neutral' as const };
    return shell(
      <>
        <PageHeader
          dashboard
          eyebrow={payout.organization?.displayName ?? payout.project?.title ?? ''}
          title={<>تنفيذ صرف <MoneyAmount minor={payout.amountMinor} currency={payout.currency} locale={locale} /></>}
          lead={payout.reason}
          actions={<StatusBadge tone={state.tone}>{state.text}</StatusBadge>}
        />

        <Card title="ما يُعاد فحصه عند التنفيذ">
          <p className="tmk-field__hint">
            مر وقت منذ الاعتماد، فيُعاد الفحص لحظة الإرسال: أن الجهة غير موقوفة وما زالت موثقة، وأن
            الحساب البنكي هو نفسه الذي اعتُمد، وأن الحجز ما زال قائمًا. اختلاف أيٍّ منها يعني رفضًا
            وإعادة الطلب للمراجعة، لا تنفيذًا على اعتماد قديم.
          </p>
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="المستفيد" value={<>{payout.beneficiary.bankName} <Ltr>····{payout.beneficiary.last4}</Ltr></>} note="لا يُعرض رقم الحساب" />
            <Stat label="الاعتماد" value={payout.approvedAt ? formatDate(payout.approvedAt, locale, true) : '—'} />
            <Stat label="مرجع المزود" value={payout.providerReference ? <Ltr><code>{payout.providerReference}</code></Ltr> : '—'} />
            <Stat label="آخر استعلام" value={payout.lastInquiredAt ? formatDate(payout.lastInquiredAt, locale, true) : '—'} />
          </div>
        </Card>

        {payout.needsInquiry ? (
          <Notice tone="danger" title="نتيجة غير معلومة — لا إعادة إرسال">
            <p style={{ marginBlockEnd: 0 }}>
              لا نعرف إن كان المال قد خرج. إعادة الإرسال قد تدفع مرتين، لذا الإجراء الوحيد المتاح هو
              الاستعلام من المزود، وهو قراءة لا أمر دفع جديد.
            </p>
          </Notice>
        ) : null}

        <Card title="الإجراءات">
          <p className="tmk-row__actions">
            {payout.state === 'approved' ? (
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void action(async () => {
                await api(`/admin/payouts/${payout.id}/execute`, 'POST', { version: payout.version });
                return 'أُرسل التحويل للمزود. الحالة تبقى «قيد التنفيذ» حتى يصل إثبات.';
              })}>نفّذ الصرف</button>
            ) : null}
            {['unknown', 'queued', 'processing'].includes(payout.state) ? (
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void action(async () => {
                const result = await api(`/admin/payouts/${payout.id}/inquire`, 'POST') as { status: string };
                return result.status === 'still_pending'
                  ? 'المزود ما زال لا يملك نتيجة نهائية. لم يتغير شيء.'
                  : `حُسمت الحالة من المزود: ${result.status}.`;
              })}>استعلم من المزود</button>
            ) : null}
            <a className="tmk-button tmk-button--quiet" href={L('/admin/finance')}>عودة لمركز المدفوعات</a>
          </p>
          {payout.state === 'requested' ? (
            <p className="tmk-field__hint">لا يمكن التنفيذ قبل اعتماد الجهة. الاعتماد قرار الجهة، والتنفيذ قرار المنصة.</p>
          ) : null}
          {payout.state === 'paid' ? (
            <p className="tmk-field__hint">اكتمل الصرف بإثبات <Ltr><code>{payout.paidProofReference}</code></Ltr>. لا إجراء متبقٍ.</p>
          ) : null}
        </Card>
      </>
    );
  }

  // ---- ADM-05: the finance centre -----------------------------------------------------------------
  const r = centre.reconciliation;
  return shell(
    <>
      <PageHeader
        dashboard
        title="مركز المدفوعات والتسوية"
        lead="ما يحتاج إجراءً من المنصة، وما لا يمكن إغلاقه قبل سؤال المزود."
      />

      <Card title="حالة التسوية">
        <div className="tmk-grid tmk-grid--stats">
          <Stat
            label="آخر مطابقة"
            value={r.lastRunAt ? formatDate(r.lastRunAt, locale, true) : 'لم تُشغَّل بعد'}
            note={r.lastRunAt ? 'وقت آخر تشغيل فعلي' : 'لا يعني أن كل شيء مطابق'}
          />
          <Stat label="فروقات مفتوحة" value={String(r.openItems.length)} note="لكل فرق مسؤول وسبب؛ لا يُغلق بتعديل رصيد" />
          <Stat label="بانتظار استعلام" value={`${r.awaitingInquiry.payouts + r.awaitingInquiry.refunds}`} note="عمليات نتيجتها غير معلومة" />
          <Stat label="أحداث معزولة" value={String(r.isolatedEvents)} note="أحداث مزود لمراجع لم نُصدره" />
        </div>
        <p className="tmk-field__hint">البيئة: <Ltr><code>{r.environment}</code></Ltr> — لا تُطابق كشوف بيئة ببيانات بيئة أخرى.</p>
      </Card>

      {/* ADM-05.A01. A paste box rather than a file upload: there is no document store yet, and this
          is honest about it — the operator sees exactly what is sent, line by line. */}
      <Card title="استيراد كشف المزود">
        <form onSubmit={event => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          void action(async () => {
            const rows = parseStatement(String(data.get('statement') ?? ''));
            const result = await api('/admin/reconciliation/imports', 'POST', {
              source: String(data.get('source') ?? '').trim(),
              statementDate: new Date(String(data.get('statementDate') ?? '')).toISOString(),
              rows
            }) as { rowCount: number; duplicateRowsInFile: number };
            return result.duplicateRowsInFile > 0
              ? `استُورد الكشف: ${result.rowCount} سطرًا، و${result.duplicateRowsInFile} سطرًا مكررًا داخل الملف نفسه أُسقط.`
              : `استُورد الكشف: ${result.rowCount} سطرًا. شغّل المطابقة لتحصل على الأحكام.`;
          });
        }} autoComplete="off">
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="statement-source">المصدر</label>
            <p className="tmk-field__hint" id="statement-source-hint">
              اسم المزود كما يظهر في الكشف. الملف نفسه لا يُستورد مرتين لنفس المصدر والبيئة.
            </p>
            <input id="statement-source" name="source" className="tmk-input" defaultValue="simulator" maxLength={40} required aria-describedby="statement-source-hint" autoComplete="off" />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="statement-date">تاريخ الكشف</label>
            <input id="statement-date" name="statementDate" type="date" className="tmk-input" required autoComplete="off" />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="statement-rows">الأسطر</label>
            <p className="tmk-field__hint" id="statement-rows-hint">
              سطر لكل عملية، بالترتيب: المرجع، المبلغ بوحدات صغرى، العملة، الرسوم (اختياري)، النتيجة.
              مثال: <Ltr><code>sim_ab12,10000,ILS,300,succeeded</code></Ltr>. سطر العناوين يُتجاهل.
            </p>
            <textarea id="statement-rows" name="statement" className="tmk-input" rows={5} required aria-describedby="statement-rows-hint" dir="ltr" />
          </div>
          <p className="tmk-row__actions">
            <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>استورد الكشف</button>
          </p>
        </form>
      </Card>

      <Card title="الكشوف المستوردة">
        <DataTable
          caption="كشوف المزود"
          rows={r.batches}
          rowKey={row => row.id}
          columns={[
            { key: 'source', header: 'المصدر', cell: row => <Ltr>{row.source}</Ltr> },
            { key: 'date', header: 'تاريخ الكشف', cell: row => formatDate(row.statementDate, locale) },
            { key: 'rows', header: 'أسطر', numeric: true, cell: row => String(row.rowCount) },
            { key: 'state', header: 'الحالة', cell: row => row.state === 'matched' ? 'مُطابق' : row.state === 'closed' ? 'مغلق' : 'مستورد' },
            { key: 'lastRun', header: 'آخر مطابقة', cell: row => row.lastRunAt ? formatDate(row.lastRunAt, locale, true) : '—' },
            {
              key: 'run', header: 'إجراء',
              cell: row => (
                <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                  const result = await api(`/admin/reconciliation/${row.id}/run`, 'POST') as { counts: Record<string, number> };
                  return `تمت المطابقة: ${result.counts.match} مطابق، ${result.counts.mismatch} اختلاف، ${result.counts.missing} بلا سجل.`;
                })}>طابق</button>
              )
            }
          ]}
          emptyState={<EmptyState title="لا كشوف مستوردة">استيراد كشف المزود هو أول خطوة في التسوية.</EmptyState>}
        />
        <p className="tmk-field__hint">
          إعادة المطابقة آمنة: لا تكتب أي قيد في الدفتر، بل تعيد اشتقاق حكم كل سطر مما هو صحيح الآن.
        </p>
      </Card>

      <Card title="الفروقات المفتوحة">
        <p className="tmk-field__hint">
          الفرق قائمة عمل، لا رقم يُصحَّح. أرقام المزود أدلة لا تُعدَّل، وإغلاق الفرق يكون بسبب مكتوب
          موقّع؛ أي تصحيح للدفتر يكون بقيد عكسي معتمد منفصل.
        </p>
        <DataTable
          caption="فروقات التسوية التي لم تُغلق"
          rows={r.openItems}
          rowKey={row => row.id}
          columns={[
            { key: 'ref', header: 'مرجع المزود', cell: row => <Ltr><code>{row.providerTransactionId.slice(0, 18)}</code></Ltr> },
            { key: 'match', header: 'الحكم', cell: row => <StatusBadge tone={(matchLabels[row.matchState] ?? { tone: 'neutral' as const }).tone}>{(matchLabels[row.matchState] ?? { text: row.matchState }).text}</StatusBadge> },
            { key: 'theirs', header: 'لدى المزود', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} /> },
            {
              key: 'ours', header: 'لدينا', numeric: true,
              cell: row => row.ourAmountMinor === null
                ? <span className="tmk-field__hint">لا سجل</span>
                : <MoneyAmount minor={row.ourAmountMinor} currency={row.currency} locale={locale} />
            },
            { key: 'note', header: 'الملاحظة', cell: row => row.note ? describeNote(row.note) : '—' },
            {
              key: 'resolve', header: 'إغلاق',
              cell: row => (
                <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                  const why = window.prompt('سبب إغلاق الفرق (عشرة أحرف على الأقل):') ?? '';
                  if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                  await api(`/admin/reconciliation/items/${row.id}/resolutions`, 'POST', { reason: why, version: row.version });
                  return 'أُغلق الفرق بسبب مسجَّل. لم يتغير أي رقم.';
                })}>حل الفرق</button>
              )
            }
          ]}
          emptyState={<EmptyState title="لا فروقات مفتوحة">{r.lastRunAt ? 'كل سطر في آخر كشف مطابق أو مُغلق بسبب.' : 'لم تُشغَّل المطابقة بعد، فلا توجد أحكام تُعرض.'}</EmptyState>}
        />
      </Card>

      <Card title="طلبات الصرف">
        <DataTable
          caption="صرف بانتظار إجراء من المنصة"
          rows={centre.payouts}
          rowKey={row => row.id}
          columns={[
            { key: 'org', header: 'الجهة', cell: row => row.organization?.displayName ?? '—' },
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} /> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={(payoutStates[row.state] ?? { tone: 'neutral' as const }).tone}>{(payoutStates[row.state] ?? { text: row.state }).text}</StatusBadge> },
            { key: 'created', header: 'منذ', cell: row => formatDate(row.createdAt, locale) },
            { key: 'open', header: 'تفاصيل', cell: row => <a href={L(`/admin/disbursements/${row.id}`)}>افتح</a> }
          ]}
          emptyState={<EmptyState title="لا صرف بانتظار المنصة">لا يوجد طلب معتمد أو عالق الآن.</EmptyState>}
        />
      </Card>

      <Card title="الاسترداد">
        <DataTable
          caption="طلبات استرداد بانتظار إجراء"
          rows={centre.refunds}
          rowKey={row => row.id}
          columns={[
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} /> },
            { key: 'fee', header: 'رسوم غير مستردة', numeric: true, cell: row => row.feeMinor === '0' ? '—' : <span>{formatMinorUnits(row.feeMinor)}</span> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={(refundStates[row.state] ?? { tone: 'neutral' as const }).tone}>{(refundStates[row.state] ?? { text: row.state }).text}</StatusBadge> },
            {
              key: 'act', header: 'إجراء',
              cell: row => (
                <span className="tmk-row__actions">
                  {row.state === 'requested' ? (
                    <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                      await api(`/refunds/${row.id}/approve`, 'POST', { version: row.version });
                      return 'اعتُمد الاسترداد وحُجز المبلغ.';
                    })}>اعتماد</button>
                  ) : null}
                  {row.state === 'approved' ? (
                    <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                      await api(`/admin/refunds/${row.id}/execute`, 'POST', { version: row.version });
                      return 'أُرسل الاسترداد للمزود إلى مصدر الدفع الأصلي.';
                    })}>تنفيذ</button>
                  ) : null}
                  {row.needsInquiry ? (
                    <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                      const result = await api(`/admin/refunds/${row.id}/inquire`, 'POST') as { status: string };
                      return `نتيجة الاستعلام: ${result.status}.`;
                    })}>استعلم</button>
                  ) : null}
                </span>
              )
            }
          ]}
          emptyState={<EmptyState title="لا استرداد بانتظار إجراء">لا يوجد طلب استرداد مفتوح.</EmptyState>}
        />
      </Card>

      <Card title="النزاعات">
        <p className="tmk-field__hint">
          النزاع كيان مستقل بعد نجاح الدفع؛ لا يحوّل العملية الأصلية إلى «فشل لم يحدث». وإذا كان
          المال قد صُرف فعلًا، يظهر العجز رقمًا معلنًا ولا يُجبَر الرصيد على صفر.
        </p>
        <DataTable
          caption="نزاعات مفتوحة"
          rows={centre.disputes}
          rowKey={row => row.id}
          columns={[
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} /> },
            { key: 'reason', header: 'السبب', cell: row => row.reason },
            { key: 'plan', header: 'خطة التغطية', cell: row => row.coveragePlan || <span className="tmk-field__hint">لم تُسجَّل بعد</span> },
            {
              key: 'act', header: 'الحسم',
              cell: row => (
                <span className="tmk-row__actions">
                  {(['lost', 'won', 'withdrawn'] as const).map(outcome => (
                    <button key={outcome} type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => void action(async () => {
                      const why = window.prompt('سبب الحسم (عشرة أحرف على الأقل):') ?? '';
                      if (why.trim().length < 10) throw new Error('السبب مطلوب ولا يقل عن عشرة أحرف.');
                      await api(`/admin/disputes/${row.id}/resolve`, 'POST', { outcome, reason: why, version: row.version });
                      return outcome === 'lost' ? 'حُسم النزاع ضدنا وخرج المبلغ.' : 'حُسم النزاع لصالحنا وعاد المبلغ للمشروع.';
                    })}>{outcome === 'lost' ? 'خسارة' : outcome === 'won' ? 'كسب' : 'سحب'}</button>
                  ))}
                </span>
              )
            }
          ]}
          emptyState={<EmptyState title="لا نزاعات مفتوحة">لم يُفتح أي نزاع.</EmptyState>}
        />
      </Card>

      <Card title="قريبًا">
        <ul>
          <li><strong>إعادة معالجة حدث:</strong> تحتاج الاحتفاظ بحمولة الحدث وإعادة تمريرها عبر فحص التوقيع نفسه. الأحداث التي لم تُطبَّق معزولة ومعدودة أعلاه بالفعل.</li>
          <li><strong>تصدير الكشوف وتنزيلها:</strong> مستندات مولَّدة للتنزيل.</li>
        </ul>
      </Card>
    </>
  );
}
