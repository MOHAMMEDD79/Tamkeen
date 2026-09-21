'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Notice, PageHeader,
  Skeleton, Stat, StatusBadge, formatDate, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * PART-12, the organisation's side: BUS-06 agreements, PRG-06 outcomes, PRG-10 incubation,
 * PRG-11 the sponsor's portfolio, PRG-12 assistance and PRG-13 volunteering.
 *
 * The four things these screens exist to keep true, each of which is easy to break here because
 * this is where the numbers and the promises are made:
 *
 *  - **Approving is not paying.** A milestone decision, a report approval and a certificate all
 *    say, on the screen, that they released no money. Money leaves through the payout chain, with
 *    its own separate approver.
 *  - **A grant is not equity.** Every agreement and every incubation offer shows a stake of zero,
 *    because the reader's assumption is the thing being corrected.
 *  - **A period is not paid twice.** The stipend screen refuses to offer a batch for days already
 *    claimed, and names which days and whose.
 *  - **Consent is visible.** An assistance case whose consent was withdrawn shows its shape and
 *    none of its contents, and says which of the two it is.
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

/** Written for an operator, naming this part's own conflicts rather than "the state changed". */
function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء في هذه الجهة. الفصل مقصود: من يقدّم الدليل لا يعتمده، والمرشد يعلّق ولا يقرر، ومن سجّل التسليم لا يفصل في الاعتراض عليه، ولا أحد يعتمد ساعات تطوعه.',
    not_found: 'المورد غير موجود ضمن جهتك، أو أنت لست طرفًا فيه.',
    conflict: 'تغيّرت الحالة: قد تكون الفترة مطالبًا بها مسبقًا، أو الجلسات غير مقفلة، أو الاتفاق لم يُقبل بعد، أو النسخة التي بين يديك قديمة. أعد التحميل واقرأ ما تغيّر.',
    invalid_input: 'تحقق من الحقول: المبلغ النقدي يحتاج عملة، والمساهمة العينية تحتاج وصفًا وقيمة معلنة، وشروط الملكية الفكرية مطلوبة في أي اتفاق احتضان.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const agreementStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  pending_acceptance: { text: 'بانتظار القبول', tone: 'warning' },
  active: { text: 'نافذ', tone: 'success' },
  completed: { text: 'منتهٍ', tone: 'neutral' },
  terminated: { text: 'مُنهى', tone: 'danger' },
  disputed: { text: 'محل خلاف', tone: 'danger' }
};

const milestoneStates: Record<string, { text: string; tone: Tone }> = {
  planned: { text: 'مخططة', tone: 'neutral' },
  evidence_submitted: { text: 'دليل مقدَّم — بانتظار قرارك', tone: 'warning' },
  approved: { text: 'معتمدة', tone: 'success' },
  changes_requested: { text: 'مطلوب تعديل', tone: 'warning' }
};

const reportStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  submitted: { text: 'بانتظار مراجعتك', tone: 'warning' },
  approved: { text: 'معتمد', tone: 'success' },
  changes_requested: { text: 'مطلوب تعديل', tone: 'warning' }
};

const proposalStates: Record<string, { text: string; tone: Tone }> = {
  submitted: { text: 'جديدة', tone: 'info' },
  review: { text: 'قيد الدراسة', tone: 'info' },
  accepted: { text: 'مقبولة', tone: 'success' },
  rejected: { text: 'غير مقبولة', tone: 'danger' },
  active: { text: 'احتضان جارٍ', tone: 'success' },
  closed: { text: 'مغلقة', tone: 'neutral' },
  withdrawn: { text: 'سحبها صاحبها', tone: 'neutral' }
};

const assistanceStates: Record<string, { text: string; tone: Tone }> = {
  submitted: { text: 'جديد', tone: 'info' },
  in_review: { text: 'قيد الدراسة', tone: 'info' },
  awaiting_info: { text: 'بانتظار مستند', tone: 'warning' },
  approved: { text: 'مقبول', tone: 'success' },
  rejected: { text: 'مرفوض', tone: 'danger' },
  delivered: { text: 'سُلِّم', tone: 'success' },
  closed: { text: 'مغلق', tone: 'neutral' },
  disputed: { text: 'محل خلاف', tone: 'danger' },
  withdrawn: { text: 'سُحبت الموافقة', tone: 'neutral' }
};

const stipendStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  requested: { text: 'أُرسلت للمالية', tone: 'info' },
  approved: { text: 'معتمدة', tone: 'success' },
  paid: { text: 'مدفوعة', tone: 'success' },
  cancelled: { text: 'ملغاة', tone: 'neutral' }
};

const stipendBlockers: Record<string, string> = {
  programme_offers_no_stipend: 'البرنامج لا يعلن بدلًا أصلًا.',
  stipend_rate_not_set: 'لم تُحدد قيمة البدل وعملته في البرنامج.',
  no_sessions_in_period: 'لا جلسات في هذه الفترة.',
  sessions_not_closed: 'هناك جلسات لم يُقفل سجل حضورها. البدل لا يُبنى على سجل ما زال قابلًا للتغيير.',
  objections_open: 'هناك اعتراضات على الحضور لم تُحسم. لا يُصرف بدل على سجل متنازع عليه.',
  period_already_claimed: 'هذه الأيام مطالَب بها في دفعة قائمة. لا تُحتسب الفترة مرتين.'
};

const certificateBlockers: Record<string, string> = {
  enrolment_not_completed: 'لم يُسجَّل المتدرب كمكمل للبرنامج بعد.',
  no_sessions_held: 'لم تُعقد جلسات بعد.',
  attendance_below_policy: 'الحضور دون ما تشترطه سياسة البرنامج المعلنة.',
  certificate_already_exists: 'للمتدرب شهادة صادرة بالفعل.'
};

const volunteerBlockers: Record<string, string> = {
  summary_too_short: 'النبذة قصيرة: ٣٠ حرفًا على الأقل.',
  tasks_not_described: 'المهام غير موصوفة: ٢٠ حرفًا على الأقل.',
  withdrawal_policy_missing: 'سياسة الانسحاب غير معلنة، وهي تُعلن قبل أن يتقدم أحد.',
  capacity_invalid: 'السعة غير صالحة.'
};

const money = (minor: string | null | undefined, currency: string | null | undefined) =>
  minor === null || minor === undefined || !currency ? null : `${(Number(minor) / 100).toLocaleString('ar', { minimumFractionDigits: 2 })} ${currency}`;

const hoursText = (minutes: number) => `${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة`;

/** Shown wherever an approval might be read as a payment. */
function ApprovalIsNotPayment() {
  return (
    <Notice tone="info" title="الاعتماد ليس صرفًا">
      <p style={{ marginBlockEnd: 0 }}>
        اعتماد تسليم أو تقرير حكم على دليل، ولا يحرّك مالًا. صرف المال طلب صرف مستقل له طالب ومعتمد مختلف وإثبات دفع منفصل،
        ولا يُنشأ من هذه الأزرار.
      </p>
    </Notice>
  );
}

// ---------------------------------------------------------------------------------------------
// shared shell
// ---------------------------------------------------------------------------------------------

function useOperatorScreen<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => setData(await loader()), [loader]);

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

  return { data, signedIn, loading, busy, error, notice, act, setError, setNotice, reload: load };
}

// ---------------------------------------------------------------------------------------------
// BUS-06 — agreements
// ---------------------------------------------------------------------------------------------

interface OrgAgreement {
  id: string; reference: string; title: string; kind: string; state: string;
  amountMinor: string | null; currency: string | null; termsChecksum: string;
  myRole: string; acceptedBy: string[]; awaitingAcceptanceFrom: string[];
  fundedMinor: string; milestoneCount: number; reportCount: number;
  version: number; createsEquity: boolean;
  sponsor: { id: string; displayName: string };
  operator: { id: string; displayName: string };
  program: { id: string; title: string } | null;
}

export function OrgAgreements({ locale, orgId, agreementId }: { locale: Locale; orgId: string; agreementId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const loader = useCallback(async () => {
    const list = await api(`/orgs/${orgId}/agreements`) as OrgAgreement[];
    const detail = agreementId ? await api(`/orgs/${orgId}/agreements/${agreementId}`) as Record<string, unknown> : null;
    return { list, detail };
  }, [orgId, agreementId]);
  const screen = useOperatorScreen(loader);
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);

  const path = agreementId ? `/org/${orgId}/agreements/${agreementId}` : `/org/${orgId}/agreements`;
  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={path} signedIn={screen.signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/agreements`)}>الاتفاقات</a>}>
      {screen.error ? <Notice tone="danger" live="assertive">{screen.error}</Notice> : null}
      {screen.notice ? <Notice tone="success" live="polite">{screen.notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (screen.loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!screen.signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(path))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!screen.data) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const { list, detail } = screen.data;

  if (detail) {
    const agreement = detail as unknown as OrgAgreement & {
      purpose: string; obligations: string; reportingTerms: string; surplusTerms: string;
      currentTerms: { sequence: number; terms: string; checksum: string } | null;
      milestones: Array<{ id: string; sequence: number; title: string; dueAt: string; amountMinor: string | null; state: string; evidenceRef: string; version: number; latestDecision: { outcome: string; reason: string } | null }>;
      reports: Array<{ id: string; periodStart: string; periodEnd: string; state: string; spentMinor: string; participantsReached: number; narrative: string; version: number }>;
      funding: Array<{ id: string; amountMinor: string; currency: string; createdAt: string }>;
    };
    const isSponsor = agreement.myRole === 'sponsor';

    return shell(
      <>
        <PageHeader dashboard eyebrow={`${agreement.sponsor.displayName} ← ${agreement.operator.displayName}`} title={agreement.title}
          actions={<StatusBadge tone={agreementStates[agreement.state]?.tone ?? 'neutral'}>{agreementStates[agreement.state]?.text ?? agreement.state}</StatusBadge>}
          lead={`أنت الطرف ${isSponsor ? 'الممول' : 'المشغّل'} في هذا الاتفاق. المرجع ${agreement.reference}.`} />

        <Notice tone="info" title="المنحة ليست حصة">
          <p style={{ marginBlockEnd: 0 }}>
            هذا الاتفاق تمويل والتزامات. لا ينشئ أي حصة في أي من الجهتين، ولا يُحوَّل مالُه إلى رأس مال مسجل.
            أي استثمار بالأسهم مسار منفصل تمامًا بعرضه ومراجعته المستقلة.
          </p>
        </Notice>

        <Card title="الشروط">
          <dl className="tmk-definitions">
            <div><dt>النوع</dt><dd>{agreement.kind === 'cash' ? 'نقدي' : agreement.kind === 'in_kind' ? 'عيني' : 'نقدي وعيني'}</dd></div>
            <div><dt>المبلغ الملتزم به</dt><dd>{money(agreement.amountMinor, agreement.currency) ?? '—'}</dd></div>
            <div><dt>المموَّل حتى الآن</dt><dd>{money(agreement.fundedMinor, agreement.currency) ?? '—'}</dd></div>
            <div><dt>البرنامج</dt><dd>{agreement.program?.title ?? '—'}</dd></div>
            <div><dt>حصة أي طرف في الآخر</dt><dd>لا شيء</dd></div>
          </dl>
          <h3>الغرض</h3>
          <p>{agreement.purpose}</p>
          {agreement.obligations ? <><h3>الالتزامات</h3><p>{agreement.obligations}</p></> : null}
          {agreement.reportingTerms ? <><h3>شروط التقارير</h3><p>{agreement.reportingTerms}</p></> : null}
          {agreement.surplusTerms ? <><h3>الفائض</h3><p>{agreement.surplusTerms}</p></> : null}
          {agreement.currentTerms ? (
            <>
              <h3>النص الحالي (النسخة {agreement.currentTerms.sequence})</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{agreement.currentTerms.terms}</p>
            </>
          ) : null}
        </Card>

        <Card title="القبول">
          <dl className="tmk-definitions">
            <div><dt>قبل الطرف الممول</dt><dd>{agreement.acceptedBy.includes('sponsor') ? 'نعم' : 'لا'}</dd></div>
            <div><dt>قبل الطرف المشغّل</dt><dd>{agreement.acceptedBy.includes('operator') ? 'نعم' : 'لا'}</dd></div>
          </dl>
          {agreement.state === 'pending_acceptance' ? (
            <>
              <p className="tmk-field__hint">
                القبول يخص نسخة بعينها. أي تعديل يُرسل كنسخة جديدة، وقبول النسخة السابقة لا يسري عليها.
              </p>
              {agreement.awaitingAcceptanceFrom.includes(agreement.myRole) ? (
                <p className="tmk-row__actions">
                  <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy}
                    onClick={() => void screen.act(async () => {
                      await api(`/agreements/${agreement.id}/accept`, 'POST', { organizationId: orgId, checksum: agreement.termsChecksum, version: agreement.version });
                    }, 'سُجِّل قبولك لهذه النسخة. يصبح الاتفاق نافذًا حين يقبلها الطرف الآخر أيضًا.')}>
                    أقبل هذه النسخة
                  </button>
                </p>
              ) : (
                <p className="tmk-field__hint">قبلتَ هذه النسخة. الأمر بانتظار الطرف الآخر.</p>
              )}
            </>
          ) : null}
          {isSponsor && ['draft', 'pending_acceptance'].includes(agreement.state) ? (
            <>
              <p className="tmk-row__actions">
                <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy} onClick={() => setSending(value => !value)}>
                  {agreement.state === 'draft' ? 'أرسل للطرف الآخر' : 'أرسل نسخة معدّلة'}
                </button>
              </p>
              {sending ? (
                <form onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void screen.act(async () => {
                    await api(`/agreements/${agreement.id}/submit`, 'POST', { terms: String(form.get('terms') ?? ''), version: agreement.version });
                  }, 'أُرسلت النسخة. القبول السابق — إن وُجد — لم يعد ساريًا عليها.');
                  setSending(false);
                }}>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="terms">نص الاتفاق</label>
                    <span className="tmk-field__hint" id="terms-hint">٥٠ حرفًا على الأقل. هذا هو النص الذي سيوافق عليه الطرفان بالضبط.</span>
                    <textarea id="terms" name="terms" className="tmk-field__control" rows={8} minLength={50} maxLength={8000} required
                      defaultValue={agreement.currentTerms?.terms ?? ''} aria-describedby="terms-hint" />
                  </div>
                  <p className="tmk-row__actions">
                    <button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>أرسل</button>
                    <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setSending(false)}>تراجع</button>
                  </p>
                </form>
              ) : null}
            </>
          ) : null}
        </Card>

        <ApprovalIsNotPayment />

        <Card title="التسليمات">
          <DataTable
            caption="تسليمات الاتفاق"
            rows={agreement.milestones}
            rowKey={row => row.id}
            emptyState={<EmptyState title="لا تسليمات">لم تُحدد تسليمات لهذا الاتفاق.</EmptyState>}
            columns={[
              { key: 'title', header: 'التسليم', cell: row => row.title },
              { key: 'due', header: 'تستحق في', cell: row => formatDate(row.dueAt, locale) },
              { key: 'amount', header: 'الشريحة', cell: row => money(row.amountMinor, agreement.currency) ?? <span className="tmk-field__hint">—</span> },
              {
                key: 'state', header: 'الحالة', cell: row => (
                  <>
                    <StatusBadge tone={milestoneStates[row.state]?.tone ?? 'neutral'}>{milestoneStates[row.state]?.text ?? row.state}</StatusBadge>
                    {row.latestDecision ? <span className="tmk-field__hint">{row.latestDecision.reason}</span> : null}
                  </>
                )
              },
              {
                key: 'action', header: 'الإجراء', cell: row => {
                  if (!isSponsor && ['planned', 'changes_requested'].includes(row.state)) {
                    return (
                      <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy}
                        onClick={() => {
                          const el = document.getElementById(`evidence-${row.id}`);
                          if (el) el.hidden = !el.hidden;
                        }}>
                        قدّم دليلًا
                      </button>
                    );
                  }
                  if (isSponsor && row.state === 'evidence_submitted') {
                    return (
                      <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy}
                        onClick={() => {
                          const el = document.getElementById(`decide-${row.id}`);
                          if (el) el.hidden = !el.hidden;
                        }}>
                        اعتمد أو أعد
                      </button>
                    );
                  }
                  return <span className="tmk-field__hint">{isSponsor ? 'بانتظار دليل المشغّل' : 'بانتظار قرار الممول'}</span>;
                }
              }
            ]}
          />
          {agreement.milestones.map(row => (
            <div key={`forms-${row.id}`}>
              <form id={`evidence-${row.id}`} hidden onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void screen.act(async () => {
                  await api(`/orgs/${orgId}/agreement-milestones/${row.id}/evidence`, 'POST', {
                    evidenceRef: String(form.get('evidenceRef') ?? ''), evidenceNote: String(form.get('evidenceNote') ?? ''), version: row.version
                  });
                }, 'قُدِّم الدليل. القرار على الطرف الآخر، ولا يترتب عليه صرف.');
              }}>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor={`evref-${row.id}`}>مرجع الدليل — {row.title}</label>
                  <input id={`evref-${row.id}`} name="evidenceRef" className="tmk-field__control" required minLength={3} maxLength={200} />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor={`evnote-${row.id}`}>شرح</label>
                  <textarea id={`evnote-${row.id}`} name="evidenceNote" className="tmk-field__control" rows={2} maxLength={2000} />
                </div>
                <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>قدّم</button></p>
              </form>
              <form id={`decide-${row.id}`} hidden onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void screen.act(async () => {
                  await api(`/orgs/${orgId}/agreement-milestones/${row.id}/decision`, 'POST', {
                    outcome: String(form.get('outcome') ?? 'approved'), reason: String(form.get('reason') ?? ''), version: row.version
                  });
                }, 'سُجِّل قرارك. لم يُصرف أي مبلغ بهذا القرار.');
              }}>
                <fieldset className="tmk-fieldset">
                  <legend>قرارك في: {row.title}</legend>
                  <label className="tmk-choice" htmlFor={`ap-${row.id}`}>
                    <input id={`ap-${row.id}`} name="outcome" type="radio" value="approved" defaultChecked />
                    <span>اعتمد التسليم</span>
                  </label>
                  <label className="tmk-choice" htmlFor={`cr-${row.id}`}>
                    <input id={`cr-${row.id}`} name="outcome" type="radio" value="changes_requested" />
                    <span>أعده مع طلب تعديل</span>
                  </label>
                </fieldset>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor={`dr-${row.id}`}>التعليل</label>
                  <textarea id={`dr-${row.id}`} name="reason" className="tmk-field__control" rows={2} minLength={10} maxLength={1000} required />
                </div>
                <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>سجّل القرار</button></p>
              </form>
            </div>
          ))}
        </Card>

        <Card title="التقارير">
          <DataTable
            caption="تقارير الاتفاق"
            rows={agreement.reports}
            rowKey={row => row.id}
            emptyState={<EmptyState title="لا تقارير">لم يُقدَّم تقرير بعد.</EmptyState>}
            columns={[
              { key: 'period', header: 'الفترة', cell: row => `${formatDate(row.periodStart, locale)} — ${formatDate(row.periodEnd, locale)}` },
              { key: 'spent', header: 'المصروف', cell: row => money(row.spentMinor, agreement.currency) ?? '—' },
              { key: 'reached', header: 'عدد المستفيدين', numeric: true, cell: row => row.participantsReached },
              { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={reportStates[row.state]?.tone ?? 'neutral'}>{reportStates[row.state]?.text ?? row.state}</StatusBadge> },
              {
                key: 'action', header: 'الإجراء', cell: row => {
                  if (isSponsor && row.state === 'submitted') {
                    return (
                      <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy}
                        onClick={() => void screen.act(async () => {
                          await api(`/orgs/${orgId}/agreement-reports/${row.id}/decision`, 'POST', {
                            outcome: 'approved', reason: 'الأرقام مطابقة لما اطّلعنا عليه.', version: row.version
                          });
                        }, 'اعتُمد التقرير. لم يُصرف أي مبلغ بهذا الاعتماد.')}>
                        اعتمد
                      </button>
                    );
                  }
                  if (!isSponsor && ['draft', 'changes_requested'].includes(row.state)) {
                    return (
                      <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy}
                        onClick={() => void screen.act(async () => {
                          await api(`/orgs/${orgId}/agreement-reports/${row.id}/submit`, 'POST', { version: row.version });
                        }, 'أُرسل التقرير إلى الممول.')}>
                        أرسل
                      </button>
                    );
                  }
                  return <span className="tmk-field__hint">—</span>;
                }
              }
            ]}
          />
          <p className="tmk-field__hint">
            التقرير أرقام مجمّعة: لا يُذكر فيه اسم متدرب ولا صاحب طلب مساعدة، ولا يخرج منه ملف شخصي إلى الممول.
          </p>
        </Card>

        <p className="tmk-row__actions">
          <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/agreements`)}>عد إلى الاتفاقات</a>
        </p>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="الشراكات والمنح"
        actions={<button type="button" className="tmk-button tmk-button--primary" onClick={() => setCreating(value => !value)}>اقترح اتفاقًا</button>}
        lead="اتفاقات جهتك على الجانبين. كل اتفاق تمويل والتزامات، ولا ينشئ أي حصة في أي اتجاه." />

      {creating ? (
        <Card title="اتفاق جديد">
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            const kind = String(form.get('kind') ?? 'cash');
            const asMinor = (value: string) => value.trim() === '' ? null : String(Math.round(Number(value) * 100));
            void screen.act(async () => {
              await api(`/orgs/${orgId}/agreements`, 'POST', {
                operatorOrgId: String(form.get('operatorOrgId') ?? ''),
                title: String(form.get('title') ?? ''),
                kind,
                amountMinor: kind === 'in_kind' ? null : asMinor(String(form.get('amount') ?? '')),
                currency: kind === 'in_kind' ? null : String(form.get('currency') ?? 'ILS'),
                inKindDescription: kind === 'cash' ? '' : String(form.get('inKindDescription') ?? ''),
                inKindValueMinor: kind === 'cash' ? null : asMinor(String(form.get('inKindValue') ?? '')),
                purpose: String(form.get('purpose') ?? ''),
                obligations: String(form.get('obligations') ?? ''),
                reportingTerms: String(form.get('reportingTerms') ?? ''),
                surplusTerms: String(form.get('surplusTerms') ?? '')
              });
            }, 'أُنشئ الاتفاق كمسودة. لا يراه الطرف الآخر حتى ترسله.');
            setCreating(false);
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="operatorOrgId">معرّف الجهة المشغّلة</label>
              <span className="tmk-field__hint" id="op-hint">الطرف الآخر. لا يمكن أن يكون جهتك نفسها.</span>
              <input id="operatorOrgId" name="operatorOrgId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby="op-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="agTitle">العنوان</label>
              <input id="agTitle" name="title" className="tmk-field__control" required minLength={4} maxLength={200} />
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="kind">النوع</label>
                <select id="kind" name="kind" className="tmk-field__control" defaultValue="cash">
                  <option value="cash">نقدي</option>
                  <option value="in_kind">عيني</option>
                  <option value="mixed">نقدي وعيني</option>
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="amount">المبلغ النقدي</label>
                <input id="amount" name="amount" type="number" step="0.01" min="0" className="tmk-field__control" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="currency">العملة</label>
                <input id="currency" name="currency" className="tmk-field__control" maxLength={3} defaultValue="ILS" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="inKindValue">القيمة التقديرية للعيني</label>
                <span className="tmk-field__hint" id="inkind-hint">تُذكر منفصلة ولا تُجمع مع النقدي.</span>
                <input id="inKindValue" name="inKindValue" type="number" step="0.01" min="0" className="tmk-field__control" aria-describedby="inkind-hint" />
              </div>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="inKindDescription">وصف المساهمة العينية</label>
              <textarea id="inKindDescription" name="inKindDescription" className="tmk-field__control" rows={2} maxLength={2000} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="purpose">الغرض</label>
              <textarea id="purpose" name="purpose" className="tmk-field__control" rows={3} required minLength={20} maxLength={4000} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="obligations">الالتزامات</label>
              <textarea id="obligations" name="obligations" className="tmk-field__control" rows={3} maxLength={4000} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="reportingTerms">ما الذي يراه الممول عن المستفيدين</label>
              <span className="tmk-field__hint" id="rep-hint">الأصل أرقام مجمّعة. لا تُذكر أسماء متدربين ولا أصحاب طلبات مساعدة في أي تقرير.</span>
              <textarea id="reportingTerms" name="reportingTerms" className="tmk-field__control" rows={2} maxLength={2000} aria-describedby="rep-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="surplusTerms">ما يحدث للفائض</label>
              <textarea id="surplusTerms" name="surplusTerms" className="tmk-field__control" rows={2} maxLength={1000} />
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>أنشئ المسودة</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setCreating(false)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      <DataTable
        caption="الاتفاقات"
        rows={list}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا اتفاقات">لم تُنشئ أو تستلم اتفاقًا بعد.</EmptyState>}
        columns={[
          { key: 'title', header: 'الاتفاق', cell: row => <a href={L(`/org/${orgId}/agreements/${row.id}`)}>{row.title}</a> },
          { key: 'role', header: 'دورك', cell: row => row.myRole === 'sponsor' ? 'ممول' : 'مشغّل' },
          { key: 'other', header: 'الطرف الآخر', cell: row => row.myRole === 'sponsor' ? row.operator.displayName : row.sponsor.displayName },
          { key: 'amount', header: 'المبلغ', cell: row => money(row.amountMinor, row.currency) ?? <span className="tmk-field__hint">عيني</span> },
          {
            key: 'state', header: 'الحالة', cell: row => (
              <>
                <StatusBadge tone={agreementStates[row.state]?.tone ?? 'neutral'}>{agreementStates[row.state]?.text ?? row.state}</StatusBadge>
                {row.awaitingAcceptanceFrom.length ? (
                  <span className="tmk-field__hint">
                    بانتظار قبول: {row.awaitingAcceptanceFrom.map(role => role === 'sponsor' ? 'الممول' : 'المشغّل').join('، ')}
                  </span>
                ) : null}
              </>
            )
          },
          { key: 'equity', header: 'الحصة', cell: () => <span className="tmk-field__hint">لا شيء</span> }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-11 — the sponsor's portfolio
// ---------------------------------------------------------------------------------------------

interface SponsorExport {
  generatedAt: string;
  agreements: Array<{
    reference: string; title: string; programme: string | null; kind: string; state: string;
    committedCashMinor: string | null; inKindValueMinor: string | null; currency: string | null;
    fundingIntentsMinor: string; reportedSpentMinor: string; participantsReached: number;
    reportsApproved: number; reportsAwaitingReview: number; milestonesApproved: number; milestonesTotal: number;
  }>;
  containsPersonalData: boolean; redacted: boolean; equityHeld: number;
}

export function OrgSponsorships({ locale, orgId }: { locale: Locale; orgId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const loader = useCallback(async () => api(`/orgs/${orgId}/agreements?role=sponsor`) as Promise<OrgAgreement[]>, [orgId]);
  const screen = useOperatorScreen(loader);
  const [summary, setSummary] = useState<SponsorExport | null>(null);
  const [exportUnavailable, setExportUnavailable] = useState('');
  const [funding, setFunding] = useState<string | null>(null);

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/sponsorships`} signedIn={screen.signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/agreements`)}>الاتفاقات</a>}>
      {screen.error ? <Notice tone="danger" live="assertive">{screen.error}</Notice> : null}
      {screen.notice ? <Notice tone="success" live="polite">{screen.notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (screen.loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!screen.signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/org/${orgId}/sponsorships`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!screen.data) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  return shell(
    <>
      <PageHeader dashboard title="محفظة الراعي" lead="ما مولته جهتك، وما وصلها من تقارير عنه. الأرقام مجمّعة بلا أسماء، والتمويل لا يشتري حصة." />

      <Notice tone="info" title="ما لا يعطيه التمويل">
        <p style={{ marginBlockEnd: 0 }}>
          تمويل اتفاق لا ينشئ حصة ولا ملكية ولا حق تصويت في الجهة المشغّلة. وهذه النسخة لا تحرّك مالًا فعليًا:
          ما يُسجَّل هنا نية تمويل معلنة، وانتقال المال يحتاج مسارًا خارجيًا لم يُبنَ بعد.
        </p>
      </Notice>

      <DataTable
        caption="اتفاقات التمويل"
        rows={screen.data}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا اتفاقات تمويل">لم تموّل جهتك اتفاقًا بعد.</EmptyState>}
        columns={[
          { key: 'title', header: 'الاتفاق', cell: row => <a href={L(`/org/${orgId}/agreements/${row.id}`)}>{row.title}</a> },
          { key: 'operator', header: 'الجهة المشغّلة', cell: row => row.operator.displayName },
          { key: 'committed', header: 'الملتزم به', cell: row => money(row.amountMinor, row.currency) ?? <span className="tmk-field__hint">عيني</span> },
          { key: 'funded', header: 'المموَّل', cell: row => money(row.fundedMinor, row.currency) ?? '—' },
          { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={agreementStates[row.state]?.tone ?? 'neutral'}>{agreementStates[row.state]?.text ?? row.state}</StatusBadge> },
          {
            key: 'action', header: 'الإجراء', cell: row => row.state === 'active'
              ? <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy} onClick={() => setFunding(funding === row.id ? null : row.id)}>موّل</button>
              : <span className="tmk-field__hint">التمويل متاح للاتفاق النافذ فقط</span>
          }
        ]}
      />

      {funding ? (() => {
        const agreement = screen.data!.find(row => row.id === funding);
        if (!agreement) return null;
        return (
          <Card title={`تمويل: ${agreement.title}`}>
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void screen.act(async () => {
                await api(`/agreements/${agreement.id}/funding-intents`, 'POST', {
                  organizationId: orgId,
                  amountMinor: String(Math.round(Number(form.get('amount') ?? 0) * 100)),
                  currency: agreement.currency ?? 'ILS',
                  note: String(form.get('note') ?? '')
                });
              }, 'سُجِّلت نية التمويل. لم ينتقل مال، ولم تُنشأ أي حصة.');
              setFunding(null);
            }}>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="fundAmount">المبلغ</label>
                <span className="tmk-field__hint" id="fund-hint">
                  لا يتجاوز المتبقي من المبلغ الملتزم به. العملة عملة الاتفاق: لا جمع بين عملتين ولا تحويل في هذه النسخة.
                </span>
                <input id="fundAmount" name="amount" type="number" step="0.01" min="0.01" className="tmk-field__control" required aria-describedby="fund-hint" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="fundNote">ملاحظة</label>
                <input id="fundNote" name="note" className="tmk-field__control" maxLength={1000} />
              </div>
              <p className="tmk-row__actions">
                <button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>سجّل نية التمويل</button>
                <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setFunding(null)}>تراجع</button>
              </p>
            </form>
          </Card>
        );
      })() : null}

      <Card title="تقرير مجمّع">
        <p className="tmk-field__hint">
          أرقام بلا أسماء: لا ملفات متدربين ولا طلبات مساعدة ولا بيانات اتصال. النقدي والعيني رقمان منفصلان لا يُجمعان.
        </p>
        <p className="tmk-row__actions">
          <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy}
            onClick={() => void (async () => {
              setExportUnavailable('');
              try { setSummary(await api(`/orgs/${orgId}/sponsor-exports`, 'POST') as SponsorExport); }
              catch (e) {
                if (e instanceof Error && e.message.startsWith('لا تملك صلاحية')) setExportUnavailable('التقرير المجمّع يحتاج صلاحية report.read ضمن هذه الجهة.');
                else screen.setError(e instanceof Error ? e.message : 'تعذر إنشاء التقرير.');
              }
            })()}>
            اعرض التقرير
          </button>
        </p>
        {exportUnavailable ? <Notice tone="warning" title="التقرير غير متاح لك"><p style={{ marginBlockEnd: 0 }}>{exportUnavailable}</p></Notice> : null}
        {summary ? (
          <>
            <div className="tmk-grid tmk-grid--stats">
              <Stat label="اتفاقات" value={summary.agreements.length} />
              <Stat label="حصص مملوكة" value={summary.equityHeld} note="التمويل لا يشتري حصة" />
              <Stat label="مستفيدون (عدد)" value={summary.agreements.reduce((total, row) => total + row.participantsReached, 0)} note="من تقارير معتمدة فقط" />
              <Stat label="تقارير بانتظار مراجعتك" value={summary.agreements.reduce((total, row) => total + row.reportsAwaitingReview, 0)} />
            </div>
            <DataTable
              caption="تفصيل الاتفاقات"
              rows={summary.agreements}
              rowKey={row => row.reference}
              emptyState={<EmptyState title="لا بيانات">لا اتفاقات بعد.</EmptyState>}
              columns={[
                { key: 'ref', header: 'المرجع', cell: row => row.reference },
                { key: 'title', header: 'الاتفاق', cell: row => row.title },
                { key: 'cash', header: 'نقدي ملتزم', cell: row => money(row.committedCashMinor, row.currency) ?? '—' },
                { key: 'inkind', header: 'قيمة عينية', cell: row => money(row.inKindValueMinor, row.currency) ?? '—' },
                { key: 'spent', header: 'مصروف مُبلَّغ', cell: row => money(row.reportedSpentMinor, row.currency) ?? '—' },
                { key: 'milestones', header: 'تسليمات معتمدة', cell: row => `${row.milestonesApproved} من ${row.milestonesTotal}` }
              ]}
            />
            <p className="tmk-field__hint">
              «مصروف مُبلَّغ» من تقارير اعتمدتَها أنت فقط؛ الرقم غير المراجَع ليس دليلًا. ولا يحتوي هذا التقرير أي بيانات شخصية.
            </p>
          </>
        ) : null}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-06 — stipends and certificates
// ---------------------------------------------------------------------------------------------

interface StipendPreview {
  cohortId: string; periodStart: string; periodEnd: string; currency: string | null;
  rateMinor: string | null; conditions: string; sessionsHeld: number; totalMinor: string;
  ready: boolean; blockers: string[]; openObjections: number;
  openSessions: Array<{ id: string; title: string; startsAt: string }>;
  alreadyClaimed: Array<{ enrollmentId: string; from: string; to: string }>;
  lines: Array<{ enrollmentId: string; name: string; sessionsCounted: number; sessionsHeld: number; amountMinor: string; basis: string }>;
}

interface StipendBatchRow {
  id: string; periodStart: string; periodEnd: string; currency: string; totalMinor: string;
  state: string; stateReason: string; lineCount: number; version: number;
  payout: { id: string; state: string; paidAt: string | null } | null; paid: boolean;
}

export function OrgProgramOutcomes({ locale, orgId, programId }: { locale: Locale; orgId: string; programId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const loader = useCallback(async () => {
    const program = await api(`/orgs/${orgId}/programs/${programId}`) as { title: string; cohorts: Array<{ id: string; name: string }>; stipendOffered: boolean };
    const cohortId = program.cohorts[0]?.id ?? null;
    const batches = cohortId ? await api(`/orgs/${orgId}/cohorts/${cohortId}/stipend-batches`) as StipendBatchRow[] : [];
    return { program, cohortId, batches };
  }, [orgId, programId]);
  const screen = useOperatorScreen(loader);
  const [preview, setPreview] = useState<StipendPreview | null>(null);
  const [certificateFor, setCertificateFor] = useState('');
  const [readiness, setReadiness] = useState<{ eligible: boolean; blockers: string[]; holderName: string; attendanceRatio: number; requiredRatio: number; attendancePolicy: string } | null>(null);

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/programs/${programId}/outcomes`} signedIn={screen.signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/programs`)}>البرامج</a>}>
      {screen.error ? <Notice tone="danger" live="assertive">{screen.error}</Notice> : null}
      {screen.notice ? <Notice tone="success" live="polite">{screen.notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (screen.loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!screen.signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/org/${orgId}/programs/${programId}/outcomes`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!screen.data) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const { program, cohortId, batches } = screen.data;

  return shell(
    <>
      <PageHeader dashboard eyebrow={program.title} title="البدلات والشهادات"
        lead="البدل يُستحق بالحضور، ثم يُعتمد، ثم يُصرف — ثلاث خطوات منفصلة. والشهادة شهادة تعلّم: لا تدفع شيئًا ولا تَعِد بوظيفة." />

      <Notice tone="info" title="لا صرف من هذه الشاشة">
        <p style={{ marginBlockEnd: 0 }}>
          تكوين دفعة البدلات طلب، لا دفع. الصرف يمر بسلسلة الصرف المالية بطالبها ومعتمدها المستقل وإثبات دفعها،
          ولا يُنشأ من زر شهادة ولا من زر بدل.
        </p>
      </Notice>

      {!cohortId ? (
        <EmptyState title="لا دفعات في هذا البرنامج">أضف دفعة قبل تكوين بدلات أو إصدار شهادات.</EmptyState>
      ) : (
        <>
          <Card title="حساب فترة بدل">
            {!program.stipendOffered ? (
              <Notice tone="warning" title="البرنامج لا يعلن بدلًا">
                <p style={{ marginBlockEnd: 0 }}>لا يمكن تكوين دفعة بدلات لبرنامج لم يعلن بدلًا وقيمته وشروطه في صفحته العامة.</p>
              </Notice>
            ) : null}
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void (async () => {
                screen.setError(''); setPreview(null);
                try {
                  setPreview(await api(`/orgs/${orgId}/cohorts/${cohortId}/stipend-preview?from=${String(form.get('from'))}&to=${String(form.get('to'))}`) as StipendPreview);
                } catch (e) {
                  screen.setError(e instanceof Error ? e.message : 'تعذر الحساب.');
                }
              })();
            }}>
              <div className="tmk-grid tmk-grid--stats">
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="from">من</label>
                  <input id="from" name="from" type="date" className="tmk-field__control" required />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="to">إلى</label>
                  <input id="to" name="to" type="date" className="tmk-field__control" required />
                </div>
              </div>
              <p className="tmk-row__actions">
                <button type="submit" className="tmk-button tmk-button--secondary" disabled={screen.busy}>احسب الفترة</button>
              </p>
            </form>

            {preview ? (
              <>
                {preview.blockers.length ? (
                  <Notice tone="warning" title="ما يمنع تكوين الدفعة">
                    <ul>
                      {preview.blockers.map(code => <li key={code}>{stipendBlockers[code] ?? code}</li>)}
                    </ul>
                    {preview.openSessions.length ? (
                      <p style={{ marginBlockEnd: 0 }}>
                        جلسات غير مقفلة: {preview.openSessions.map(session => session.title).join('، ')}.
                      </p>
                    ) : null}
                    {preview.alreadyClaimed.length ? (
                      <p style={{ marginBlockEnd: 0 }}>
                        أيام مطالَب بها: {preview.alreadyClaimed.map(claim => `${claim.from} → ${claim.to}`).join('، ')}.
                      </p>
                    ) : null}
                  </Notice>
                ) : null}
                <p className="tmk-field__hint">شروط البدل المعلنة: {preview.conditions || '—'}</p>
                <DataTable
                  caption="الاستحقاقات في الفترة"
                  rows={preview.lines}
                  rowKey={row => row.enrollmentId}
                  emptyState={<EmptyState title="لا استحقاقات">لا أحد استحق بدلًا في هذه الفترة.</EmptyState>}
                  columns={[
                    { key: 'name', header: 'المتدرب', cell: row => row.name },
                    { key: 'sessions', header: 'الحضور', cell: row => `${row.sessionsCounted} من ${row.sessionsHeld}` },
                    { key: 'amount', header: 'المبلغ', cell: row => money(row.amountMinor, preview.currency) ?? '—' },
                    { key: 'basis', header: 'كيف حُسب', cell: row => <span className="tmk-field__hint">{row.basis}</span> }
                  ]}
                />
                <p className="tmk-row__actions">
                  <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy || !preview.ready}
                    onClick={() => void screen.act(async () => {
                      await api(`/orgs/${orgId}/cohorts/${cohortId}/stipend-batches`, 'POST', { periodStart: preview.periodStart.slice(0, 10), periodEnd: preview.periodEnd.slice(0, 10) });
                    }, 'كُوِّنت دفعة البدلات. لم يُصرف شيء: أرسلها إلى المالية لتبدأ سلسلة الاعتماد.')}>
                    كوّن دفعة بهذه الفترة
                  </button>
                </p>
                {!preview.ready ? <p className="tmk-field__hint">الزر معطّل لأن ما يمنعه مذكور أعلاه، لا لسبب مجهول.</p> : null}
              </>
            ) : null}
          </Card>

          <Card title="دفعات البدلات">
            <DataTable
              caption="دفعات البدلات"
              rows={batches}
              rowKey={row => row.id}
              emptyState={<EmptyState title="لا دفعات">لم تُكوَّن دفعة بدلات بعد.</EmptyState>}
              columns={[
                { key: 'period', header: 'الفترة', cell: row => `${formatDate(row.periodStart, locale)} — ${formatDate(row.periodEnd, locale)}` },
                { key: 'lines', header: 'المستحقون', numeric: true, cell: row => row.lineCount },
                { key: 'total', header: 'الإجمالي', cell: row => money(row.totalMinor, row.currency) ?? '—' },
                { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={stipendStates[row.state]?.tone ?? 'neutral'}>{stipendStates[row.state]?.text ?? row.state}</StatusBadge> },
                {
                  key: 'paid', header: 'الدفع', cell: row => row.paid
                    ? <span>مدفوعة{row.payout?.paidAt ? ` — ${formatDate(row.payout.paidAt, locale)}` : ''}</span>
                    : <span className="tmk-field__hint">لم يُصرف شيء بعد</span>
                },
                {
                  key: 'action', header: 'الإجراء', cell: row => row.state === 'draft'
                    ? (
                      <>
                        <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy}
                          onClick={() => {
                            const el = document.getElementById(`send-${row.id}`);
                            if (el) el.hidden = !el.hidden;
                          }}>
                          أرسل للصرف
                        </button>
                        <button type="button" className="tmk-button tmk-button--quiet" disabled={screen.busy}
                          onClick={() => void screen.act(async () => {
                            await api(`/orgs/${orgId}/stipend-batches/${row.id}/cancel`, 'POST', { reason: 'ألغيت الدفعة لإعادة تكوين الفترة.', version: row.version });
                          }, 'أُلغيت الدفعة، وتحررت أيامها فصارت قابلة للمطالبة من جديد.')}>
                          ألغِ
                        </button>
                      </>
                    )
                    : <span className="tmk-field__hint">—</span>
                }
              ]}
            />
            {batches.filter(row => row.state === 'draft').map(row => (
              <form key={`send-form-${row.id}`} id={`send-${row.id}`} hidden onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void screen.act(async () => {
                  await api(`/orgs/${orgId}/stipend-batches/${row.id}/payout-request`, 'POST', {
                    projectId: String(form.get('projectId') ?? ''),
                    reason: String(form.get('reason') ?? ''),
                    version: row.version
                  });
                }, 'أُرسلت الدفعة إلى المالية. طلب الصرف نفسه يُنشأ من شاشة الصرف بمعتمد مستقل، ولم يُدفع شيء بعد.');
              }}>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor={`project-${row.id}`}>معرّف المشروع الممول</label>
                  <span className="tmk-field__hint" id={`project-hint-${row.id}`}>الوعاء الذي يُصرف منه البدل. يُقرأ من صفحة المشروع.</span>
                  <input id={`project-${row.id}`} name="projectId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby={`project-hint-${row.id}`} />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor={`reason-${row.id}`}>سبب الصرف</label>
                  <input id={`reason-${row.id}`} name="reason" className="tmk-field__control" required minLength={10} maxLength={1000} />
                </div>
                <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>أرسل</button></p>
              </form>
            ))}
          </Card>
        </>
      )}

      {/* PRG-06.A03/A04. Issuing a certificate touches no money at all. */}
      <Card title="الشهادات">
        <p className="tmk-field__hint">
          الشهادة تُصدر عند تحقق متطلبات البرنامج المعلنة، وتحمل مرجع تحقق عامًا لا يتضمن رقم هوية. سحبها يُبقي المرجع صالحًا للاستعلام ويقول إنها لم تعد سارية.
        </p>
        <form onSubmit={event => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const enrollmentId = String(form.get('enrollmentId') ?? '');
          setCertificateFor(enrollmentId);
          void (async () => {
            screen.setError(''); setReadiness(null);
            try { setReadiness(await api(`/orgs/${orgId}/enrollments/${enrollmentId}/certificate-readiness`) as typeof readiness); }
            catch (e) { screen.setError(e instanceof Error ? e.message : 'تعذر الفحص.'); }
          })();
        }}>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="enrollmentId">معرّف الالتحاق</label>
            <span className="tmk-field__hint" id="enr-hint">يُنسخ من سجل الدفعة. البحث بالاسم من هذه الشاشة ليس في هذه المرحلة.</span>
            <input id="enrollmentId" name="enrollmentId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby="enr-hint" />
          </div>
          <p className="tmk-row__actions">
            <button type="submit" className="tmk-button tmk-button--secondary" disabled={screen.busy}>افحص الأهلية</button>
          </p>
        </form>
        {readiness ? (
          <>
            <dl className="tmk-definitions">
              <div><dt>المتدرب</dt><dd>{readiness.holderName}</dd></div>
              <div><dt>الحضور</dt><dd>{readiness.attendanceRatio}% — الحد المطلوب {readiness.requiredRatio}%</dd></div>
              <div><dt>سياسة الحضور المعلنة</dt><dd>{readiness.attendancePolicy || '—'}</dd></div>
            </dl>
            {readiness.blockers.length ? (
              <Notice tone="warning" title="ما يمنع الإصدار">
                <ul style={{ marginBlockEnd: 0 }}>
                  {readiness.blockers.map(code => <li key={code}>{certificateBlockers[code] ?? code}</li>)}
                </ul>
              </Notice>
            ) : null}
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy || !readiness.eligible}
                onClick={() => void screen.act(async () => {
                  await api(`/orgs/${orgId}/enrollments/${certificateFor}/certificate`, 'POST');
                }, 'صدرت الشهادة. لا تدفع شيئًا ولا تَعِد بوظيفة.')}>
                أصدر الشهادة
              </button>
            </p>
          </>
        ) : null}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-10 — incubation
// ---------------------------------------------------------------------------------------------

interface OrgProposal {
  id: string; reference: string; title: string; state: string; stage: string; sector: string;
  city: string; submittedAt: string | null; version: number;
  founder: { id: string; name: string };
  mentors: Array<{ id: string; name: string }>;
  milestonesApproved: number; milestonesTotal: number;
  latestDecision: { outcome: string; reason: string; at: string } | null;
  latestAgreement: { id: string; state: string; sequence: number; grantsEquity: boolean } | null;
  incubatorHoldsNoStake: boolean;
}

export function OrgProposals({ locale, orgId, proposalId }: { locale: Locale; orgId: string; proposalId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const loader = useCallback(async () => {
    const list = await api(`/orgs/${orgId}/proposals`) as OrgProposal[];
    const detail = proposalId ? await api(`/orgs/${orgId}/proposals/${proposalId}`) as Record<string, unknown> : null;
    return { list, detail };
  }, [orgId, proposalId]);
  const screen = useOperatorScreen(loader);
  const [deciding, setDeciding] = useState(false);
  const [offering, setOffering] = useState(false);

  const path = proposalId ? `/org/${orgId}/proposals/${proposalId}` : `/org/${orgId}/proposals`;
  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={path} signedIn={screen.signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/proposals`)}>الأفكار</a>}>
      {screen.error ? <Notice tone="danger" live="assertive">{screen.error}</Notice> : null}
      {screen.notice ? <Notice tone="success" live="polite">{screen.notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (screen.loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!screen.signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(path))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!screen.data) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const { list, detail } = screen.data;

  if (detail) {
    const proposal = detail as unknown as Omit<OrgProposal, 'mentors'> & {
      summary: string; problem: string; supportSought: string; canDecide: boolean; decisionUnavailableReason: string;
      mentors: Array<{ id: string; mentorId: string; name: string; note: string; endedAt: string | null }>;
      agreements: Array<{ id: string; sequence: number; title: string; state: string; grantMinor: string | null; currency: string | null; ipTerms: string; version: number; equityPercent: number }>;
      milestones: Array<{ id: string; title: string; dueAt: string; state: string; evidenceRef: string; version: number; latestDecision: { outcome: string; reason: string } | null }>;
      decisions: Array<{ outcome: string; reason: string; criteria: string; at: string }>;
    };

    return shell(
      <>
        <PageHeader dashboard eyebrow={`فكرة ${proposal.reference}`} title={proposal.title}
          actions={<StatusBadge tone={proposalStates[proposal.state]?.tone ?? 'neutral'}>{proposalStates[proposal.state]?.text ?? proposal.state}</StatusBadge>}
          lead={`صاحب الفكرة: ${proposal.founder.name}. لا تأخذ الجهة أي حصة مقابل القبول أو المنحة.`} />

        {!proposal.canDecide ? (
          <Notice tone="info" title="أنت مرشد على هذه الفكرة">
            <p style={{ marginBlockEnd: 0 }}>
              يمكنك قراءتها والتعليق عليها مع صاحبها. القرار فيها ليس لك: المرشد يرشد ولا يقرر، وهذا فصل مقصود لا نقص في الصلاحيات.
            </p>
          </Notice>
        ) : null}

        <Card title="الفكرة">
          <dl className="tmk-definitions">
            <div><dt>المرحلة</dt><dd>{proposal.stage || '—'}</dd></div>
            <div><dt>القطاع</dt><dd>{proposal.sector || '—'}</dd></div>
            <div><dt>المدينة</dt><dd>{proposal.city || '—'}</dd></div>
          </dl>
          <p style={{ whiteSpace: 'pre-wrap' }}>{proposal.summary}</p>
          {proposal.problem ? <><h3>المشكلة</h3><p>{proposal.problem}</p></> : null}
          {proposal.supportSought ? <><h3>الدعم المطلوب</h3><p>{proposal.supportSought}</p></> : null}
        </Card>

        {proposal.canDecide && ['submitted', 'review'].includes(proposal.state) ? (
          <Card title="القرار">
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy} onClick={() => setDeciding(value => !value)}>اقبل أو ارفض</button>
            </p>
            {deciding ? (
              <form onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void screen.act(async () => {
                  await api(`/orgs/${orgId}/proposals/${proposal.id}/decision`, 'POST', {
                    outcome: String(form.get('outcome') ?? 'accepted'),
                    reason: String(form.get('reason') ?? ''),
                    criteria: String(form.get('criteria') ?? ''),
                    version: proposal.version
                  });
                }, 'سُجِّل القرار. قبول الفكرة قبول للعمل عليها، لا اكتساب جزء منها.');
                setDeciding(false);
              }}>
                <fieldset className="tmk-fieldset">
                  <legend>القرار</legend>
                  <label className="tmk-choice" htmlFor="prop-accept">
                    <input id="prop-accept" name="outcome" type="radio" value="accepted" defaultChecked />
                    <span>اقبل الفكرة للاحتضان</span>
                  </label>
                  <label className="tmk-choice" htmlFor="prop-reject">
                    <input id="prop-reject" name="outcome" type="radio" value="rejected" />
                    <span>لا تقبلها</span>
                  </label>
                </fieldset>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="propReason">التعليل الذي يقرؤه صاحب الفكرة</label>
                  <textarea id="propReason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={2000} required />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="propCriteria">المعايير الداخلية</label>
                  <span className="tmk-field__hint" id="crit-hint">للسجل. لا تُعرض على صاحب الفكرة.</span>
                  <textarea id="propCriteria" name="criteria" className="tmk-field__control" rows={2} maxLength={2000} aria-describedby="crit-hint" />
                </div>
                <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>سجّل القرار</button></p>
              </form>
            ) : null}
          </Card>
        ) : null}

        <Card title="الإرشاد">
          {proposal.mentors.length ? (
            <dl className="tmk-definitions">
              {proposal.mentors.map(person => (
                <div key={person.id}>
                  <dt>{person.name}</dt>
                  <dd>{person.endedAt ? `انتهى الإسناد في ${formatDate(person.endedAt, locale)}` : person.note || 'مسند'}</dd>
                </div>
              ))}
            </dl>
          ) : <EmptyState title="لا مرشد">لم يُسند مرشد لهذه الفكرة.</EmptyState>}
          {proposal.canDecide ? (
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const target = event.currentTarget;
              void screen.act(async () => {
                await api(`/orgs/${orgId}/proposals/${proposal.id}/mentor-assignments`, 'POST', {
                  mentorId: String(form.get('mentorId') ?? ''), note: String(form.get('note') ?? '')
                });
              }, 'أُسند المرشد. الإسناد يمنحه الوصول إلى هذه الفكرة وحدها، ولا يمنحه قرارًا فيها.');
              target.reset();
            }}>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="mentorId">معرّف المرشد</label>
                <span className="tmk-field__hint" id="mentor-hint">عضو في هذه الجهة. الإسناد هو ما يمنحه الوصول، لا الدور وحده.</span>
                <input id="mentorId" name="mentorId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby="mentor-hint" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="mentorNote">مجال الإرشاد</label>
                <input id="mentorNote" name="note" className="tmk-field__control" maxLength={1000} />
              </div>
              <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--secondary" disabled={screen.busy}>أسند مرشدًا</button></p>
            </form>
          ) : null}
        </Card>

        <Card title="اتفاق الاحتضان">
          {proposal.agreements.length ? (
            <DataTable
              caption="اتفاقات الاحتضان"
              rows={proposal.agreements}
              rowKey={row => row.id}
              emptyState={<EmptyState title="لا اتفاق">لم يُقترح اتفاق بعد.</EmptyState>}
              columns={[
                { key: 'seq', header: 'النسخة', numeric: true, cell: row => row.sequence },
                { key: 'title', header: 'العنوان', cell: row => row.title },
                { key: 'grant', header: 'المنحة', cell: row => money(row.grantMinor, row.currency) ?? '—' },
                { key: 'equity', header: 'الحصة', cell: row => `${row.equityPercent}%` },
                { key: 'state', header: 'الحالة', cell: row => row.state },
                {
                  key: 'action', header: 'الإجراء', cell: row => row.state === 'draft' && proposal.canDecide
                    ? (
                      <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy}
                        onClick={() => void screen.act(async () => {
                          await api(`/orgs/${orgId}/incubation-agreements/${row.id}/offer`, 'POST', { version: row.version });
                        }, 'أُرسل الاتفاق لصاحب الفكرة. نصه مجمّد من الآن.')}>
                        أرسله لصاحب الفكرة
                      </button>
                    )
                    : <span className="tmk-field__hint">—</span>
                }
              ]}
            />
          ) : <EmptyState title="لا اتفاق">لم يُقترح اتفاق احتضان بعد.</EmptyState>}

          {proposal.canDecide && ['accepted', 'active'].includes(proposal.state) ? (
            <>
              <p className="tmk-row__actions">
                <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy} onClick={() => setOffering(value => !value)}>اقترح اتفاقًا</button>
              </p>
              {offering ? (
                <form onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const grant = String(form.get('grant') ?? '').trim();
                  void screen.act(async () => {
                    await api(`/orgs/${orgId}/proposals/${proposal.id}/incubation-agreements`, 'POST', {
                      title: String(form.get('title') ?? ''),
                      terms: String(form.get('terms') ?? ''),
                      ipTerms: String(form.get('ipTerms') ?? ''),
                      responsibilities: String(form.get('responsibilities') ?? ''),
                      grantMinor: grant === '' ? null : String(Math.round(Number(grant) * 100)),
                      currency: grant === '' ? null : String(form.get('currency') ?? 'ILS'),
                      grantConditions: String(form.get('grantConditions') ?? ''),
                      durationMonths: form.get('durationMonths') ? Number(form.get('durationMonths')) : null
                    });
                  }, 'أُنشئ الاتفاق كمسودة. أرسله حين يصبح جاهزًا.');
                  setOffering(false);
                }}>
                  <Notice tone="info" title="لا حصة">
                    <p style={{ marginBlockEnd: 0 }}>
                      لا يحتوي هذا النموذج حقل نسبة، لأن الاتفاق لا يمنح حصة. أي حصة تحتاج اتفاق استثمار صريح على مسار PART-08/09 المستقل.
                    </p>
                  </Notice>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="incTitle">العنوان</label>
                    <input id="incTitle" name="title" className="tmk-field__control" required minLength={4} maxLength={200} />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="incTerms">الشروط</label>
                    <textarea id="incTerms" name="terms" className="tmk-field__control" rows={5} required minLength={20} maxLength={8000} />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="ipTerms">الملكية الفكرية</label>
                    <span className="tmk-field__hint" id="ip-hint">حقل إلزامي: تركه مسكوتًا عنه هو ما يضيّع على المؤسس ما بناه.</span>
                    <textarea id="ipTerms" name="ipTerms" className="tmk-field__control" rows={3} required minLength={20} maxLength={4000} aria-describedby="ip-hint" />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="responsibilities">المسؤوليات</label>
                    <textarea id="responsibilities" name="responsibilities" className="tmk-field__control" rows={3} maxLength={4000} />
                  </div>
                  <div className="tmk-grid tmk-grid--stats">
                    <div className="tmk-field">
                      <label className="tmk-field__label" htmlFor="grant">المنحة</label>
                      <input id="grant" name="grant" type="number" step="0.01" min="0" className="tmk-field__control" />
                    </div>
                    <div className="tmk-field">
                      <label className="tmk-field__label" htmlFor="incCurrency">العملة</label>
                      <input id="incCurrency" name="currency" className="tmk-field__control" maxLength={3} defaultValue="ILS" />
                    </div>
                    <div className="tmk-field">
                      <label className="tmk-field__label" htmlFor="durationMonths">المدة بالأشهر</label>
                      <input id="durationMonths" name="durationMonths" type="number" min={1} max={120} className="tmk-field__control" />
                    </div>
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="grantConditions">شروط المنحة</label>
                    <textarea id="grantConditions" name="grantConditions" className="tmk-field__control" rows={2} maxLength={2000} />
                  </div>
                  <p className="tmk-row__actions">
                    <button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>أنشئ المسودة</button>
                    <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setOffering(false)}>تراجع</button>
                  </p>
                </form>
              ) : null}
            </>
          ) : null}
        </Card>

        <Card title="المراحل">
          <DataTable
            caption="مراحل الاحتضان"
            rows={proposal.milestones}
            rowKey={row => row.id}
            emptyState={<EmptyState title="لا مراحل">لم تُحدد مراحل بعد.</EmptyState>}
            columns={[
              { key: 'title', header: 'المرحلة', cell: row => row.title },
              { key: 'due', header: 'تستحق', cell: row => formatDate(row.dueAt, locale) },
              {
                key: 'state', header: 'الحالة', cell: row => (
                  <>
                    <StatusBadge tone={milestoneStates[row.state]?.tone ?? 'neutral'}>{milestoneStates[row.state]?.text ?? row.state}</StatusBadge>
                    {row.evidenceRef ? <span className="tmk-field__hint">الدليل: {row.evidenceRef}</span> : null}
                  </>
                )
              },
              {
                key: 'action', header: 'الإجراء', cell: row => proposal.canDecide && row.state === 'evidence_submitted'
                  ? (
                    <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy}
                      onClick={() => void screen.act(async () => {
                        await api(`/orgs/${orgId}/incubation-milestones/${row.id}/decision`, 'POST', {
                          outcome: 'approved', reason: 'الدليل يطابق ما نصّت عليه المرحلة.', version: row.version
                        });
                      }, 'اعتُمدت المرحلة. لم يُصرف بذلك أي مبلغ.')}>
                      اعتمد
                    </button>
                  )
                  : <span className="tmk-field__hint">{row.state === 'planned' ? 'بانتظار دليل صاحب الفكرة' : '—'}</span>
              }
            ]}
          />
          {proposal.canDecide && ['accepted', 'active'].includes(proposal.state) ? (
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const target = event.currentTarget;
              void screen.act(async () => {
                await api(`/orgs/${orgId}/proposals/${proposal.id}/milestones`, 'POST', {
                  title: String(form.get('title') ?? ''), description: String(form.get('description') ?? ''), dueAt: String(form.get('dueAt') ?? '')
                });
              }, 'أُضيفت المرحلة.');
              target.reset();
            }}>
              <div className="tmk-grid tmk-grid--stats">
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="msTitle">عنوان المرحلة</label>
                  <input id="msTitle" name="title" className="tmk-field__control" required minLength={4} maxLength={200} />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="msDue">تستحق في</label>
                  <input id="msDue" name="dueAt" type="date" className="tmk-field__control" required />
                </div>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="msDescription">الوصف</label>
                <input id="msDescription" name="description" className="tmk-field__control" maxLength={2000} />
              </div>
              <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--secondary" disabled={screen.busy}>أضف مرحلة</button></p>
            </form>
          ) : null}
        </Card>

        {proposal.canDecide && ['accepted', 'active'].includes(proposal.state) ? (
          <Card title="إغلاق الاحتضان">
            <p className="tmk-field__hint">الإغلاق يحتاج نتيجة وخطة متابعة. المراحل التي بقيت مفتوحة تُذكر في النتيجة ولا تُسقط بصمت.</p>
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void screen.act(async () => {
                await api(`/orgs/${orgId}/proposals/${proposal.id}/close`, 'POST', {
                  outcome: String(form.get('outcome') ?? 'ended'), note: String(form.get('note') ?? ''), version: proposal.version
                });
              }, 'أُغلق الاحتضان بنتيجته المسجّلة.');
            }}>
              <fieldset className="tmk-fieldset">
                <legend>النتيجة</legend>
                <label className="tmk-choice" htmlFor="cl-grad"><input id="cl-grad" name="outcome" type="radio" value="graduated" defaultChecked /><span>تخرّج من الاحتضان</span></label>
                <label className="tmk-choice" htmlFor="cl-comp"><input id="cl-comp" name="outcome" type="radio" value="company_created" /><span>أنشأ شركة</span></label>
                <label className="tmk-choice" htmlFor="cl-emp"><input id="cl-emp" name="outcome" type="radio" value="employment" /><span>انتقل إلى وظيفة</span></label>
                <label className="tmk-choice" htmlFor="cl-end"><input id="cl-end" name="outcome" type="radio" value="ended" /><span>أُنهي دون نتيجة</span></label>
              </fieldset>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="closeNote">النتيجة وخطة المتابعة</label>
                <textarea id="closeNote" name="note" className="tmk-field__control" rows={3} minLength={20} maxLength={2000} required />
              </div>
              <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--danger" disabled={screen.busy}>أغلق</button></p>
            </form>
          </Card>
        ) : null}

        <p className="tmk-row__actions">
          <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/proposals`)}>عد إلى الأفكار</a>
        </p>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="أفكار الاحتضان والإرشاد"
        lead="الأفكار التي أُرسلت إلى جهتك. لا تأخذ الجهة حصة مقابل القبول ولا مقابل المنحة، والمرشد يرى ما أُسند إليه فقط." />

      <DataTable
        caption="الأفكار"
        rows={list}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا أفكار">لم تصل فكرة إلى جهتك بعد.</EmptyState>}
        columns={[
          { key: 'title', header: 'الفكرة', cell: row => <a href={L(`/org/${orgId}/proposals/${row.id}`)}>{row.title}</a> },
          { key: 'founder', header: 'صاحبها', cell: row => row.founder.name },
          { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={proposalStates[row.state]?.tone ?? 'neutral'}>{proposalStates[row.state]?.text ?? row.state}</StatusBadge> },
          { key: 'mentors', header: 'المرشدون', cell: row => row.mentors.map(person => person.name).join('، ') || <span className="tmk-field__hint">—</span> },
          { key: 'milestones', header: 'المراحل', cell: row => `${row.milestonesApproved} من ${row.milestonesTotal}` },
          { key: 'equity', header: 'حصة الجهة', cell: () => <span className="tmk-field__hint">لا شيء</span> }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-12 — assistance
// ---------------------------------------------------------------------------------------------

interface OrgCase {
  id: string; reference: string; category: string; state: string; version: number;
  applicantName: string | null; consentGiven: boolean; withheldReason: string;
  caseWorker: { id: string; name: string } | null; unassigned: boolean;
  messageCount: number; decisionCount: number;
  deliveriesAwaitingConfirmation: number; deliveriesDisputed: number;
}

export function OrgAssistance({ locale, orgId, caseId }: { locale: Locale; orgId: string; caseId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const loader = useCallback(async () => {
    const list = await api(`/orgs/${orgId}/assistance`) as OrgCase[];
    const detail = caseId ? await api(`/orgs/${orgId}/assistance/${caseId}`) as Record<string, unknown> : null;
    return { list, detail };
  }, [orgId, caseId]);
  const screen = useOperatorScreen(loader);
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [delivering, setDelivering] = useState(false);

  const path = caseId ? `/org/${orgId}/assistance/${caseId}` : `/org/${orgId}/assistance`;
  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={path} signedIn={screen.signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/assistance`)}>الحالات</a>}>
      {screen.error ? <Notice tone="danger" live="assertive">{screen.error}</Notice> : null}
      {screen.notice ? <Notice tone="success" live="polite">{screen.notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (screen.loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!screen.signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(path))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!screen.data) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const { list, detail } = screen.data;

  if (detail) {
    const record = detail as unknown as OrgCase & {
      needSummary: string; householdSize: number | null; requestedMinor: string | null; currency: string | null;
      messages: Array<{ id: string; author: string; body: string; documentRef: string; at: string }>;
      decisions: Array<{ outcome: string; reason: string; criteria: string; at: string }>;
      deliveries: Array<{ id: string; description: string; fundingSource: string; deliveredAt: string; confirmedAt: string | null; disputedAt: string | null; disputeReason: string; version: number; countsAsDelivered: boolean }>;
      consentHistory: Array<{ action: string; at: string }>;
    };

    return shell(
      <>
        <PageHeader dashboard eyebrow={`حالة ${record.reference}`} title={record.applicantName ?? 'صاحب الطلب — محجوب'}
          actions={<StatusBadge tone={assistanceStates[record.state]?.tone ?? 'neutral'}>{assistanceStates[record.state]?.text ?? record.state}</StatusBadge>}
          lead="سجل خاص بالكامل: لا يظهر في أي تقرير لممول ولا في أي صفحة عامة ولا في أي تصدير." />

        {!record.consentGiven ? (
          <Notice tone="warning" title="سُحبت الموافقة على المعالجة">
            <p style={{ marginBlockEnd: 0 }}>
              سحب صاحب الطلب موافقته، فتوقفت المعالجة: لا مراسلة ولا قرار ولا تسجيل تسليم.
              يظهر لك أن الحالة كانت موجودة وأنها توقفت، ولا يظهر محتواها ولا اسم صاحبها. سجل ما جرى قبل السحب محفوظ وغير قابل للتعديل.
            </p>
          </Notice>
        ) : null}

        <Card title="الطلب">
          {record.consentGiven ? (
            <>
              <dl className="tmk-definitions">
                <div><dt>النوع</dt><dd>{record.category}</dd></div>
                <div><dt>أفراد الأسرة</dt><dd>{record.householdSize ?? '—'}</dd></div>
                <div><dt>المبلغ المطلوب</dt><dd>{money(record.requestedMinor, record.currency) ?? '—'}</dd></div>
                <div><dt>مسؤول الحالة</dt><dd>{record.caseWorker?.name ?? 'لم تُسند بعد'}</dd></div>
              </dl>
              <p style={{ whiteSpace: 'pre-wrap' }}>{record.needSummary}</p>
            </>
          ) : (
            <p className="tmk-field__hint">محتوى الطلب محجوب: {record.withheldReason === 'consent_revoked' ? 'سُحبت الموافقة على المعالجة.' : 'لا موافقة.'}</p>
          )}
          {record.unassigned && record.consentGiven ? (
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy}
                onClick={() => void screen.act(async () => {
                  await api(`/orgs/${orgId}/assistance/${record.id}/claim`, 'POST', { version: record.version });
                }, 'أسندت الحالة إلى نفسك. لا حالة بلا مسؤول.')}>
                استلم الحالة
              </button>
            </p>
          ) : null}
        </Card>

        {record.consentGiven ? (
          <>
            <Card title="المراسلات">
              {record.messages.length ? record.messages.map(msg => (
                <div key={msg.id} className="tmk-row">
                  <div>
                    <strong>{msg.author === 'operator' ? 'الجهة' : 'صاحب الطلب'}</strong>
                    <span className="tmk-field__hint"> — {formatDate(msg.at, locale)}</span>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</p>
                    {msg.documentRef ? <span className="tmk-field__hint">المستند: {msg.documentRef}</span> : null}
                  </div>
                </div>
              )) : <EmptyState title="لا مراسلات">لم تُرسل رسالة بعد.</EmptyState>}
              {['submitted', 'in_review', 'awaiting_info', 'approved'].includes(record.state) ? (
                <>
                  <p className="tmk-row__actions">
                    <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy} onClick={() => setAsking(value => !value)}>اطلب توضيحًا</button>
                  </p>
                  {asking ? (
                    <form onSubmit={event => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void screen.act(async () => {
                        await api(`/orgs/${orgId}/assistance/${record.id}/clarifications`, 'POST', { body: String(form.get('body') ?? ''), version: record.version });
                      }, 'أُرسل الطلب رسالة خاصة إلى صاحب الحالة.');
                      setAsking(false);
                    }}>
                      <div className="tmk-field">
                        <label className="tmk-field__label" htmlFor="askBody">ما الذي تطلبه؟</label>
                        <textarea id="askBody" name="body" className="tmk-field__control" rows={3} minLength={10} maxLength={4000} required />
                      </div>
                      <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>أرسل</button></p>
                    </form>
                  ) : null}
                </>
              ) : null}
            </Card>

            <Card title="القرار">
              {record.decisions.length ? (
                <dl className="tmk-definitions">
                  {record.decisions.map(decision => (
                    <div key={decision.at}>
                      <dt>{decision.outcome}</dt>
                      <dd>{decision.reason}{decision.criteria ? <span className="tmk-field__hint">المعايير الداخلية: {decision.criteria}</span> : null}</dd>
                    </div>
                  ))}
                </dl>
              ) : <p className="tmk-field__hint">لم يُتخذ قرار بعد.</p>}
              {['in_review', 'awaiting_info'].includes(record.state) ? (
                <>
                  <p className="tmk-row__actions">
                    <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy} onClick={() => setDeciding(value => !value)}>قرار أهلية</button>
                  </p>
                  {deciding ? (
                    <form onSubmit={event => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void screen.act(async () => {
                        await api(`/orgs/${orgId}/assistance/${record.id}/decisions`, 'POST', {
                          outcome: String(form.get('outcome') ?? 'approved'),
                          reason: String(form.get('reason') ?? ''),
                          criteria: String(form.get('criteria') ?? ''),
                          version: record.version
                        });
                      }, 'سُجِّل القرار. لا يُنشر ولا يصل أي ممول.');
                      setDeciding(false);
                    }}>
                      <fieldset className="tmk-fieldset">
                        <legend>القرار</legend>
                        <label className="tmk-choice" htmlFor="aid-approve"><input id="aid-approve" name="outcome" type="radio" value="approved" defaultChecked /><span>مؤهل</span></label>
                        <label className="tmk-choice" htmlFor="aid-reject"><input id="aid-reject" name="outcome" type="radio" value="rejected" /><span>غير مؤهل</span></label>
                      </fieldset>
                      <div className="tmk-field">
                        <label className="tmk-field__label" htmlFor="aidReason">التعليل الذي يقرؤه صاحب الطلب</label>
                        <textarea id="aidReason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={2000} required />
                      </div>
                      <div className="tmk-field">
                        <label className="tmk-field__label" htmlFor="aidCriteria">المعايير الداخلية</label>
                        <span className="tmk-field__hint" id="aid-crit-hint">لا تُعرض على صاحب الطلب ولا تخرج في أي تصدير.</span>
                        <textarea id="aidCriteria" name="criteria" className="tmk-field__control" rows={2} maxLength={2000} aria-describedby="aid-crit-hint" />
                      </div>
                      <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>سجّل القرار</button></p>
                    </form>
                  ) : null}
                </>
              ) : null}
            </Card>

            <Card title="التسليم">
              {record.deliveries.length ? record.deliveries.map(delivery => (
                <div key={delivery.id} className="tmk-row">
                  <div>
                    <strong>{delivery.description}</strong>
                    <span className="tmk-field__hint">المصدر: {delivery.fundingSource} · {formatDate(delivery.deliveredAt, locale)}</span>
                    <StatusBadge tone={delivery.confirmedAt ? 'success' : delivery.disputedAt ? 'danger' : 'warning'}>
                      {delivery.confirmedAt ? 'أكّده صاحب الطلب' : delivery.disputedAt ? 'اعترض عليه صاحب الطلب' : 'بانتظار تأكيد صاحب الطلب'}
                    </StatusBadge>
                    {delivery.disputeReason ? <span className="tmk-field__hint">{delivery.disputeReason}</span> : null}
                  </div>
                  {delivery.disputedAt && !delivery.confirmedAt ? (
                    <p className="tmk-row__actions">
                      <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy}
                        onClick={() => void screen.act(async () => {
                          await api(`/orgs/${orgId}/assistance-deliveries/${delivery.id}/dispute-decision`, 'POST', {
                            outcome: 'upheld', reason: 'قُبل الاعتراض وسيُعاد النظر في التسليم.', version: delivery.version
                          });
                        }, 'سُجِّل القرار في الاعتراض. من سجّل التسليم لا يفصل فيه.')}>
                        افصل في الاعتراض
                      </button>
                    </p>
                  ) : null}
                </div>
              )) : <p className="tmk-field__hint">لم يُسجَّل تسليم بعد.</p>}
              {record.state === 'approved' ? (
                <>
                  <p className="tmk-row__actions">
                    <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy} onClick={() => setDelivering(value => !value)}>سجّل تسليمًا</button>
                  </p>
                  {delivering ? (
                    <form onSubmit={event => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void screen.act(async () => {
                        await api(`/orgs/${orgId}/assistance/${record.id}/deliveries`, 'POST', {
                          description: String(form.get('description') ?? ''),
                          fundingSource: String(form.get('fundingSource') ?? ''),
                          evidenceRef: String(form.get('evidenceRef') ?? ''),
                          deliveredAt: String(form.get('deliveredAt') ?? ''),
                          version: record.version
                        });
                      }, 'سُجِّل التسليم. لا يُحتسب مسلَّمًا حتى يؤكده صاحب الطلب.');
                      setDelivering(false);
                    }}>
                      <div className="tmk-field">
                        <label className="tmk-field__label" htmlFor="delDescription">ما الذي سُلِّم</label>
                        <input id="delDescription" name="description" className="tmk-field__control" required minLength={5} maxLength={1000} />
                      </div>
                      <div className="tmk-field">
                        <label className="tmk-field__label" htmlFor="fundingSource">مصدر الدعم</label>
                        <span className="tmk-field__hint" id="src-hint">حقل إلزامي: لا يُسجَّل تسليم بلا مصدر معلوم.</span>
                        <input id="fundingSource" name="fundingSource" className="tmk-field__control" required minLength={3} maxLength={200} aria-describedby="src-hint" />
                      </div>
                      <div className="tmk-grid tmk-grid--stats">
                        <div className="tmk-field">
                          <label className="tmk-field__label" htmlFor="deliveredAt">تاريخ التسليم</label>
                          <input id="deliveredAt" name="deliveredAt" type="date" max={new Date().toISOString().slice(0, 10)} className="tmk-field__control" required />
                        </div>
                        <div className="tmk-field">
                          <label className="tmk-field__label" htmlFor="delEvidence">مرجع الدليل</label>
                          <input id="delEvidence" name="evidenceRef" className="tmk-field__control" maxLength={200} />
                        </div>
                      </div>
                      <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>سجّل</button></p>
                    </form>
                  ) : null}
                </>
              ) : null}
            </Card>
          </>
        ) : null}

        <Card title="الإغلاق">
          <p className="tmk-field__hint">
            لا يُغلق الطلب وفيه تسليم لم يؤكده صاحبه أو اعتراض لم يُحسم، ولا يُغلق طلب مقبول لم يُسلَّم فيه شيء: ذاك وعد غير منفّذ لا حالة مغلقة.
          </p>
          <p className="tmk-row__actions">
            <button type="button" className="tmk-button tmk-button--danger" disabled={screen.busy}
              onClick={() => void screen.act(async () => {
                await api(`/orgs/${orgId}/assistance/${record.id}/close`, 'POST', { note: 'أُغلقت الحالة بعد اكتمال التسليم وتأكيده.', version: record.version });
              }, 'أُغلقت الحالة.')}>
              أغلق الحالة
            </button>
          </p>
        </Card>

        <p className="tmk-row__actions">
          <a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/assistance`)}>عد إلى الحالات</a>
        </p>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="طلبات المساعدة" lead="حالات جهتك. سجل خاص بالكامل، لا يخرج منه شيء إلى تقرير ممول ولا إلى أي صفحة عامة." />
      <DataTable
        caption="حالات المساعدة"
        rows={list}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا حالات">لم يصل طلب مساعدة إلى جهتك بعد.</EmptyState>}
        columns={[
          { key: 'ref', header: 'المرجع', cell: row => <a href={L(`/org/${orgId}/assistance/${row.id}`)}>{row.reference}</a> },
          { key: 'applicant', header: 'صاحب الطلب', cell: row => row.applicantName ?? <span className="tmk-field__hint">محجوب — سُحبت الموافقة</span> },
          { key: 'category', header: 'النوع', cell: row => row.category },
          { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={assistanceStates[row.state]?.tone ?? 'neutral'}>{assistanceStates[row.state]?.text ?? row.state}</StatusBadge> },
          { key: 'worker', header: 'المسؤول', cell: row => row.caseWorker?.name ?? <span className="tmk-field__hint">لم تُسند</span> },
          {
            key: 'pending', header: 'بانتظار', cell: row => row.deliveriesDisputed
              ? <StatusBadge tone="danger">اعتراض</StatusBadge>
              : row.deliveriesAwaitingConfirmation
                ? <StatusBadge tone="warning">تأكيد صاحب الطلب</StatusBadge>
                : <span className="tmk-field__hint">—</span>
          }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PRG-13 — volunteering
// ---------------------------------------------------------------------------------------------

interface BoardOpportunity {
  id: string; slug: string; title: string; summary: string; tasks: string; state: string;
  capacity: number; placesTaken: number; placesLeft: number; version: number;
  withdrawalPolicy: string; supervisor: { id: string; name: string };
  readiness: { ready: boolean; blockers: string[] };
  applications: Array<{ id: string; state: string; version: number; motivation: string; volunteer: { id: string; name: string } }>;
  assignments: Array<{
    id: string; task: string; state: string; version: number;
    volunteer: { id: string; name: string };
    hours: Array<{ id: string; workedOn: string; minutes: number; state: string; version: number }>;
    minutesApproved: number; minutesAwaiting: number;
  }>;
}

export function OrgVolunteering({ locale, orgId }: { locale: Locale; orgId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const loader = useCallback(async () => api(`/orgs/${orgId}/volunteering`) as Promise<BoardOpportunity[]>, [orgId]);
  const screen = useOperatorScreen(loader);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null);

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/volunteering`} signedIn={screen.signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/volunteer')}>الصفحة العامة</a>}>
      {screen.error ? <Notice tone="danger" live="assertive">{screen.error}</Notice> : null}
      {screen.notice ? <Notice tone="success" live="polite">{screen.notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (screen.loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!screen.signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/org/${orgId}/volunteering`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!screen.data) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  return shell(
    <>
      <PageHeader dashboard title="إدارة التطوع"
        actions={<button type="button" className="tmk-button tmk-button--primary" onClick={() => setCreating(value => !value)}>فرصة جديدة</button>}
        lead="فرص جهتك ومتطوعوها وساعاتهم. إدارة التطوع لا تفتح أي ملف مستفيد، ولا يعتمد أحد ساعات تطوعه بنفسه." />

      {creating ? (
        <Card title="فرصة تطوع جديدة">
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void screen.act(async () => {
              await api(`/orgs/${orgId}/volunteer-opportunities`, 'POST', {
                title: String(form.get('title') ?? ''),
                summary: String(form.get('summary') ?? ''),
                tasks: String(form.get('tasks') ?? ''),
                requirements: String(form.get('requirements') ?? ''),
                supervisorId: String(form.get('supervisorId') ?? ''),
                city: String(form.get('city') ?? ''),
                capacity: Number(form.get('capacity') ?? 1),
                hoursPerWeek: Number(form.get('hoursPerWeek') ?? 0),
                withdrawalPolicy: String(form.get('withdrawalPolicy') ?? '')
              });
            }, 'أُنشئت الفرصة كمسودة لا يراها أحد. انشرها حين تكتمل.');
            setCreating(false);
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="volTitle">العنوان</label>
              <input id="volTitle" name="title" className="tmk-field__control" required minLength={4} maxLength={200} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="volSummary">النبذة</label>
              <textarea id="volSummary" name="summary" className="tmk-field__control" rows={3} required minLength={20} maxLength={2000} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="volTasks">المهام</label>
              <textarea id="volTasks" name="tasks" className="tmk-field__control" rows={3} required minLength={10} maxLength={4000} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="supervisorId">معرّف المسؤول عن المتطوعين</label>
              <span className="tmk-field__hint" id="sup-hint">عضو في جهتك يتحمل المسؤولية عن المتطوعين. شرط لا يُنشر الإعلان بدونه.</span>
              <input id="supervisorId" name="supervisorId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby="sup-hint" />
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="volCity">المدينة</label>
                <input id="volCity" name="city" className="tmk-field__control" maxLength={100} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="capacity">عدد الأماكن</label>
                <input id="capacity" name="capacity" type="number" min={1} max={10000} defaultValue={1} className="tmk-field__control" />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="volHours">ساعات أسبوعية</label>
                <input id="volHours" name="hoursPerWeek" type="number" min={0} max={80} defaultValue={0} className="tmk-field__control" />
              </div>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="requirements">المتطلبات</label>
              <textarea id="requirements" name="requirements" className="tmk-field__control" rows={2} maxLength={2000} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="withdrawalPolicy">سياسة الانسحاب</label>
              <span className="tmk-field__hint" id="wd-hint">تُعلن قبل أن يتقدم أحد: كيف يستطيع المتطوع التوقف وما الذي يترتب على ذلك.</span>
              <textarea id="withdrawalPolicy" name="withdrawalPolicy" className="tmk-field__control" rows={2} maxLength={1000} aria-describedby="wd-hint" />
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>أنشئ المسودة</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setCreating(false)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      {screen.data.length === 0 ? (
        <EmptyState title="لا فرص تطوع">لم تُنشئ فرصة تطوع بعد.</EmptyState>
      ) : screen.data.map(opportunity => (
        <Card key={opportunity.id} title={opportunity.title}>
          <p className="tmk-field__hint">
            المسؤول: {opportunity.supervisor.name} · الأماكن: {opportunity.placesTaken} من {opportunity.capacity} ·{' '}
            <StatusBadge tone={opportunity.state === 'open' ? 'success' : 'neutral'}>{opportunity.state === 'open' ? 'منشورة' : opportunity.state === 'draft' ? 'مسودة' : opportunity.state === 'paused' ? 'موقوفة' : 'مغلقة'}</StatusBadge>
          </p>

          {opportunity.state === 'draft' ? (
            <>
              {!opportunity.readiness.ready ? (
                <Notice tone="warning" title="ما يمنع النشر">
                  <ul style={{ marginBlockEnd: 0 }}>
                    {opportunity.readiness.blockers.map(code => <li key={code}>{volunteerBlockers[code] ?? code}</li>)}
                  </ul>
                </Notice>
              ) : null}
              <p className="tmk-row__actions">
                <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy || !opportunity.readiness.ready}
                  onClick={() => void screen.act(async () => {
                    await api(`/orgs/${orgId}/volunteer-opportunities/${opportunity.id}/publish`, 'POST', { version: opportunity.version });
                  }, 'نُشرت الفرصة.')}>
                  انشر
                </button>
              </p>
            </>
          ) : null}

          <DataTable
            caption={`طلبات ${opportunity.title}`}
            rows={opportunity.applications}
            rowKey={row => row.id}
            emptyState={<EmptyState title="لا طلبات">لم يتقدم أحد بعد.</EmptyState>}
            columns={[
              { key: 'volunteer', header: 'المتطوع', cell: row => row.volunteer.name },
              { key: 'motivation', header: 'الدافع', cell: row => <span className="tmk-field__hint">{row.motivation || '—'}</span> },
              { key: 'state', header: 'الحالة', cell: row => row.state === 'submitted' ? 'قيد النظر' : row.state === 'accepted' ? 'مقبول' : row.state === 'rejected' ? 'مرفوض' : 'مسحوب' },
              {
                key: 'action', header: 'الإجراء', cell: row => {
                  if (row.state !== 'submitted') return <span className="tmk-field__hint">—</span>;
                  const full = opportunity.placesLeft <= 0;
                  return (
                    <>
                      <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy || full}
                        onClick={() => void screen.act(async () => {
                          await api(`/orgs/${orgId}/volunteer-applications/${row.id}/decision`, 'POST', { outcome: 'accepted', version: row.version });
                        }, 'قُبل الطلب. القبول ليس إسنادًا: أسند مهمة بعده.')}>
                        اقبل
                      </button>
                      <button type="button" className="tmk-button tmk-button--quiet" disabled={screen.busy}
                        onClick={() => void screen.act(async () => {
                          await api(`/orgs/${orgId}/volunteer-applications/${row.id}/decision`, 'POST', {
                            outcome: 'rejected', reason: 'الأماكن المتاحة في هذه الفرصة استُكملت.', version: row.version
                          });
                        }, 'سُجِّل الرفض مع سببه.')}>
                        ارفض
                      </button>
                      {full ? <span className="tmk-field__hint">لا أماكن متبقية ({opportunity.capacity} مأخوذة كلها).</span> : null}
                    </>
                  );
                }
              }
            ]}
          />

          <p className="tmk-row__actions">
            <button type="button" className="tmk-button tmk-button--secondary" disabled={screen.busy || opportunity.state !== 'open'}
              onClick={() => setAssigning(assigning === opportunity.id ? null : opportunity.id)}>
              أسند مهمة
            </button>
            {opportunity.state !== 'open' ? <span className="tmk-field__hint">الإسناد متاح للفرصة المنشورة فقط.</span> : null}
          </p>
          {assigning === opportunity.id ? (
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void screen.act(async () => {
                await api(`/orgs/${orgId}/volunteer-assignments`, 'POST', {
                  opportunityId: opportunity.id,
                  userId: String(form.get('userId') ?? ''),
                  task: String(form.get('task') ?? ''),
                  startsAt: String(form.get('startsAt') ?? '')
                });
              }, 'أُسندت المهمة. لا يُوضع أحد في مهمة قبل أن يقبلها.');
              setAssigning(null);
            }}>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor={`assignee-${opportunity.id}`}>المتطوع</label>
                <span className="tmk-field__hint" id={`assignee-hint-${opportunity.id}`}>من قبلتَ طلبه فقط. لا تُسند مهمة لمن لم يتقدم ولم يُقبل.</span>
                <select id={`assignee-${opportunity.id}`} name="userId" className="tmk-field__control" required aria-describedby={`assignee-hint-${opportunity.id}`}>
                  <option value="">—</option>
                  {opportunity.applications.filter(row => row.state === 'accepted').map(row => (
                    <option key={row.id} value={row.volunteer.id}>{row.volunteer.name}</option>
                  ))}
                </select>
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor={`task-${opportunity.id}`}>المهمة</label>
                <input id={`task-${opportunity.id}`} name="task" className="tmk-field__control" required minLength={5} maxLength={1000} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor={`start-${opportunity.id}`}>تبدأ في</label>
                <input id={`start-${opportunity.id}`} name="startsAt" type="date" className="tmk-field__control" required />
              </div>
              <p className="tmk-row__actions"><button type="submit" className="tmk-button tmk-button--primary" disabled={screen.busy}>أسند</button></p>
            </form>
          ) : null}

          {opportunity.assignments.length ? opportunity.assignments.map(assignment => (
            <div key={assignment.id} className="tmk-row">
              <div>
                <strong>{assignment.volunteer.name}</strong>
                <span className="tmk-field__hint">{assignment.task}</span>
                <dl className="tmk-definitions">
                  <div><dt>معتمدة</dt><dd>{hoursText(assignment.minutesApproved)}</dd></div>
                  <div><dt>بانتظار الاعتماد</dt><dd>{hoursText(assignment.minutesAwaiting)}</dd></div>
                </dl>
                {assignment.hours.filter(entry => entry.state === 'submitted').map(entry => (
                  <p key={entry.id} className="tmk-row__actions">
                    <span>{formatDate(entry.workedOn, locale)} — {hoursText(entry.minutes)}</span>
                    <button type="button" className="tmk-button tmk-button--primary" disabled={screen.busy}
                      onClick={() => void screen.act(async () => {
                        await api(`/orgs/${orgId}/volunteer-hours/${entry.id}/decision`, 'POST', { outcome: 'approved', version: entry.version });
                      }, 'اعتُمدت الساعات. لا يعتمد أحد ساعات تطوعه بنفسه — لا أنت ولا غيرك.')}>
                      اعتمد
                    </button>
                    <button type="button" className="tmk-button tmk-button--quiet" disabled={screen.busy}
                      onClick={() => void screen.act(async () => {
                        await api(`/orgs/${orgId}/volunteer-hours/${entry.id}/decision`, 'POST', {
                          outcome: 'rejected', reason: 'الساعات لا تطابق سجل الحضور في الموقع.', version: entry.version
                        });
                      }, 'رُفضت الساعات مع سببها.')}>
                      ارفض
                    </button>
                  </p>
                ))}
              </div>
            </div>
          )) : null}
        </Card>
      ))}
    </>
  );
}
