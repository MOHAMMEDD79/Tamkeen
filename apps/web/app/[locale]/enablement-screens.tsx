'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Notice, PageHeader,
  Skeleton, StatusBadge, formatDate, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';

/**
 * PART-12, the individual's side: assistance (PER-15), ideas and incubation (PER-16) and
 * volunteering (PER-17).
 *
 * What these screens have to get right, because each one is about somebody's standing:
 *
 *  - **An assistance case is processed only while the person consents**, and withdrawing that
 *    consent is a real control on their own screen, not a support request. The screen states what
 *    withdrawing will do *before* the button, including the part people assume wrongly: the record
 *    of what already happened is kept.
 *  - **A recorded delivery is a claim.** The person confirms it or objects, and objecting takes the
 *    case out of every count until somebody settles it.
 *  - **An idea costs no share.** Every screen that shows incubation terms shows that the grant buys
 *    nothing, because that is the assumption 07 exists to prevent.
 *  - **Volunteering is unpaid and is not employment**, said on the page rather than left implied.
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

/** Written for the person in front of the screen, naming this part's own conflicts. */
function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء. إن كنت قد سحبت موافقتك على معالجة طلب مساعدة، فلا يمكن متابعته حتى تُعطى موافقة جديدة على طلب جديد.',
    not_found: 'المورد غير موجود، أو ليس لك.',
    conflict: 'تغيّرت الحالة: قد تكون النسخة التي بين يديك قديمة، أو انتهت مهلة، أو لم تعد الحالة تقبل هذا الإجراء. أعد التحميل واقرأ ما تغيّر.',
    invalid_input: 'تحقق من الحقول: الأسباب تحتاج عشرة أحرف على الأقل، والتواريخ أيامًا مضت لا أيامًا قادمة.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const assistanceStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة', tone: 'neutral' },
  submitted: { text: 'أُرسل', tone: 'info' },
  in_review: { text: 'قيد الدراسة', tone: 'info' },
  awaiting_info: { text: 'بانتظار مستند منك', tone: 'warning' },
  approved: { text: 'مقبول — بانتظار التسليم', tone: 'success' },
  rejected: { text: 'غير مقبول', tone: 'danger' },
  delivered: { text: 'سُلِّم', tone: 'success' },
  closed: { text: 'مغلق', tone: 'neutral' },
  disputed: { text: 'محل خلاف — بانتظار مراجعة', tone: 'danger' },
  withdrawn: { text: 'أُوقفت المعالجة بسحب الموافقة', tone: 'neutral' }
};

const proposalStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة خاصة', tone: 'neutral' },
  submitted: { text: 'أُرسلت للحاضنة', tone: 'info' },
  review: { text: 'قيد الدراسة', tone: 'info' },
  accepted: { text: 'مقبولة', tone: 'success' },
  rejected: { text: 'غير مقبولة', tone: 'danger' },
  active: { text: 'احتضان جارٍ', tone: 'success' },
  closed: { text: 'مغلق', tone: 'neutral' },
  withdrawn: { text: 'مسحوبة', tone: 'neutral' }
};

const incubationStates: Record<string, { text: string; tone: Tone }> = {
  draft: { text: 'مسودة لدى الحاضنة', tone: 'neutral' },
  offered: { text: 'بانتظار ردك', tone: 'warning' },
  accepted: { text: 'قبلتَها', tone: 'success' },
  declined: { text: 'رفضتَها', tone: 'neutral' },
  withdrawn: { text: 'سحبتها الحاضنة', tone: 'danger' },
  closed: { text: 'منتهية', tone: 'neutral' }
};

const milestoneStates: Record<string, { text: string; tone: Tone }> = {
  planned: { text: 'مخططة', tone: 'neutral' },
  evidence_submitted: { text: 'قدّمت الدليل — بانتظار المراجعة', tone: 'info' },
  approved: { text: 'معتمدة', tone: 'success' },
  changes_requested: { text: 'مطلوب تعديل', tone: 'warning' }
};

const volunteerAssignmentStates: Record<string, { text: string; tone: Tone }> = {
  offered: { text: 'مهمة معروضة — بانتظار قبولك', tone: 'warning' },
  accepted: { text: 'قبلتَها', tone: 'success' },
  declined: { text: 'رفضتَها', tone: 'neutral' },
  active: { text: 'جارية', tone: 'success' },
  ended: { text: 'انتهت', tone: 'neutral' }
};

const hoursStates: Record<string, { text: string; tone: Tone }> = {
  submitted: { text: 'بانتظار الاعتماد', tone: 'warning' },
  approved: { text: 'معتمدة', tone: 'success' },
  rejected: { text: 'مرفوضة', tone: 'danger' }
};

const money = (minor: string | null, currency: string | null) =>
  minor === null || currency === null ? null : `${(Number(minor) / 100).toLocaleString('ar', { minimumFractionDigits: 2 })} ${currency}`;

const hoursText = (minutes: number) => `${Math.floor(minutes / 60)} ساعة و${minutes % 60} دقيقة`;

/** Repeated wherever incubation terms are shown, because it is the assumption 07 forbids. */
function GrantIsNotEquity() {
  return (
    <Notice tone="info" title="المنحة ليست حصة">
      <p style={{ marginBlockEnd: 0 }}>
        المنحة دعم لا يشتري شيئًا من شركتك. لا تأخذ المنصة ولا الحاضنة أي نسبة مقابل التقديم أو القبول أو المنحة،
        وأي حصة تحتاج اتفاق استثمار صريح ومنفصل على مسار آخر تمامًا. ما تقرؤه هنا لا ينشئ شركة ولا يحوّل منحة إلى رأس مال.
      </p>
    </Notice>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-15 — assistance
// ---------------------------------------------------------------------------------------------

interface AssistanceCase {
  id: string; reference: string; category: string; state: string; stateReason: string;
  submittedAt: string | null; decidedAt: string | null; closedAt: string | null; version: number;
  needSummary: string; consentGiven: boolean; consentScope: string;
  organization: { slug: string; displayName: string };
  consentHistory: Array<{ action: string; at: string; reason: string }>;
  messages: Array<{ id: string; author: string; body: string; documentRef: string; at: string }>;
  decisions: Array<{ outcome: string; reason: string; at: string }>;
  deliveries: Array<{
    id: string; description: string; fundingSource: string; amountMinor: string | null;
    currency: string | null; deliveredAt: string; confirmedAt: string | null;
    disputedAt: string | null; disputeReason: string; countsAsDelivered: boolean; version: number;
  }>;
}

export function MyAssistance({ locale, caseId }: { locale: Locale; caseId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [cases, setCases] = useState<AssistanceCase[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [disputing, setDisputing] = useState<string | null>(null);

  const load = useCallback(async () => setCases(await api('/me/assistance') as AssistanceCase[]), []);

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

  const path = caseId ? `/app/assistance/${caseId}` : '/app/assistance';
  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={path} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(path))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!cases) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const detail = caseId ? cases.find(row => row.id === caseId) ?? null : null;
  if (caseId && !detail) return shell(<ErrorState title="غير موجود">هذا الطلب ليس لك، أو لم يعد موجودًا.</ErrorState>);

  if (detail) {
    return shell(
      <>
        <PageHeader dashboard eyebrow={detail.organization.displayName} title={`طلب مساعدة ${detail.reference}`}
          actions={<StatusBadge tone={assistanceStates[detail.state]?.tone ?? 'neutral'}>{assistanceStates[detail.state]?.text ?? detail.state}</StatusBadge>}
          lead="هذه صفحتك أنت: كل ما كتبته وكل ما سُجِّل عن طلبك، ومن يستطيع رؤيته." />

        <Card title="طلبك">
          <dl className="tmk-definitions">
            <div><dt>النوع</dt><dd>{detail.category}</dd></div>
            <div><dt>الجهة</dt><dd>{detail.organization.displayName}</dd></div>
            <div><dt>أُرسل في</dt><dd>{detail.submittedAt ? formatDate(detail.submittedAt, locale) : '—'}</dd></div>
          </dl>
          <p style={{ whiteSpace: 'pre-wrap' }}>{detail.needSummary}</p>
        </Card>

        {/* PER-15.A05. The control, and what it actually does, stated before the button. */}
        <Card title="الموافقة على المعالجة">
          {detail.consentGiven ? (
            <>
              <p className="tmk-field__hint">{detail.consentScope}</p>
              <Notice tone="warning" title="ماذا يحدث إن سحبتَ موافقتك">
                <ul style={{ marginBlockEnd: 0 }}>
                  <li>تتوقف معالجة الطلب فورًا: لا تستطيع الجهة بعدها مراسلتك ولا اتخاذ قرار ولا تسجيل تسليم.</li>
                  <li>يختفي عن الجهة محتوى طلبك واسمك، ويبقى لديها أن الطلب كان موجودًا وأنه توقف.</li>
                  <li><strong>لا يُحذف سجل ما جرى فعلًا</strong>: القرارات التي اتُّخذت والتسليمات التي سُجِّلت تبقى محفوظة، لأن ذلك سجل ما حدث لك وليس بيانات إضافية عنك.</li>
                  <li>يبقى طلبك كاملًا ظاهرًا لك أنت في هذه الصفحة.</li>
                  <li>يمكنك دائمًا تقديم طلب جديد بموافقة جديدة.</li>
                </ul>
              </Notice>
              <p className="tmk-row__actions">
                <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setRevoking(value => !value)}>
                  اسحب موافقتي على المعالجة
                </button>
              </p>
              {revoking ? (
                <form onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void act(async () => {
                    await api(`/assistance/${detail.id}/consent-revocations`, 'POST', { reason: String(form.get('reason') ?? ''), version: detail.version });
                  }, 'سُحبت موافقتك وتوقفت المعالجة. سجل ما جرى محفوظ، وطلبك ما زال ظاهرًا لك كاملًا.');
                  setRevoking(false);
                }}>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="revokeReason">السبب (اختياري)</label>
                    <textarea id="revokeReason" name="reason" className="tmk-field__control" rows={2} maxLength={1000} />
                  </div>
                  <p className="tmk-row__actions">
                    <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>أكّد سحب الموافقة</button>
                    <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setRevoking(false)}>تراجع</button>
                  </p>
                </form>
              ) : null}
            </>
          ) : (
            <Notice tone="info" title="المعالجة متوقفة">
              <p style={{ marginBlockEnd: 0 }}>
                سحبتَ موافقتك، فلا تستطيع الجهة متابعة هذا الطلب. سجل ما جرى قبل ذلك محفوظ ويظهر لك أدناه.
                لبدء من جديد قدّم طلبًا جديدًا؛ لا تُستأنف الموافقة على طلب توقف.
              </p>
            </Notice>
          )}
          <dl className="tmk-definitions">
            {detail.consentHistory.map(entry => (
              <div key={entry.at}>
                <dt>{entry.action === 'granted' ? 'أعطيت الموافقة' : 'سحبت الموافقة'}</dt>
                <dd>{formatDate(entry.at, locale)}{entry.reason ? ` — ${entry.reason}` : ''}</dd>
              </div>
            ))}
          </dl>
        </Card>

        <Card title="المراسلات">
          {detail.messages.length ? (
            <>
              {detail.messages.map(msg => (
                <div key={msg.id} className="tmk-row">
                  <div>
                    <strong>{msg.author === 'operator' ? 'الجهة' : 'أنت'}</strong>
                    <span className="tmk-field__hint"> — {formatDate(msg.at, locale)}</span>
                    <p style={{ whiteSpace: 'pre-wrap' }}>{msg.body}</p>
                    {msg.documentRef ? <span className="tmk-field__hint">مرجع المستند: {msg.documentRef}</span> : null}
                  </div>
                </div>
              ))}
              {detail.consentGiven && ['submitted', 'in_review', 'awaiting_info', 'approved'].includes(detail.state) ? (
                <form onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  const target = event.currentTarget;
                  void act(async () => {
                    await api(`/assistance/${detail.id}/replies`, 'POST', {
                      body: String(form.get('body') ?? ''), documentRef: String(form.get('documentRef') ?? '')
                    });
                  }, 'أُرسل ردك إلى مسؤول الحالة.');
                  target.reset();
                }}>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="replyBody">ردّك</label>
                    <textarea id="replyBody" name="body" className="tmk-field__control" rows={3} minLength={2} maxLength={4000} required />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="documentRef">مرجع المستند</label>
                    <span className="tmk-field__hint" id="doc-hint">رفع الملفات غير متاح هنا بعد: اكتب اسم المستند أو مكانه، ولا يُرفع شيء إلى المنصة.</span>
                    <input id="documentRef" name="documentRef" className="tmk-field__control" maxLength={200} aria-describedby="doc-hint" />
                  </div>
                  <p className="tmk-row__actions">
                    <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>أرسل</button>
                  </p>
                </form>
              ) : null}
            </>
          ) : (
            <EmptyState title="لا مراسلات">لم تصلك رسالة من مسؤول الحالة بعد.</EmptyState>
          )}
        </Card>

        {detail.decisions.length ? (
          <Card title="القرارات">
            <dl className="tmk-definitions">
              {detail.decisions.map(decision => (
                <div key={decision.at}>
                  <dt>{decision.outcome === 'approved' ? 'قُبل' : decision.outcome === 'rejected' ? 'لم يُقبل' : decision.outcome}</dt>
                  <dd>{decision.reason} <span className="tmk-field__hint">({formatDate(decision.at, locale)})</span></dd>
                </div>
              ))}
            </dl>
          </Card>
        ) : null}

        {/* PER-15.A03 and A04. The operator's record is a claim; this is where it becomes a fact. */}
        <Card title="ما سُلِّم">
          {detail.deliveries.length ? (
            detail.deliveries.map(delivery => (
              <div key={delivery.id} className="tmk-row">
                <div>
                  <strong>{delivery.description}</strong>
                  <span className="tmk-field__hint">
                    في {formatDate(delivery.deliveredAt, locale)} · المصدر المعلن: {delivery.fundingSource}
                    {money(delivery.amountMinor, delivery.currency) ? ` · ${money(delivery.amountMinor, delivery.currency)}` : ''}
                  </span>
                  <StatusBadge tone={delivery.confirmedAt ? 'success' : delivery.disputedAt ? 'danger' : 'warning'}>
                    {delivery.confirmedAt ? 'أكّدتَ استلامه' : delivery.disputedAt ? 'اعترضتَ عليه' : 'بانتظار تأكيدك'}
                  </StatusBadge>
                  {delivery.disputeReason ? <span className="tmk-field__hint">{delivery.disputeReason}</span> : null}
                </div>
                {!delivery.confirmedAt && !delivery.disputedAt ? (
                  <>
                    <p className="tmk-row__actions">
                      <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                        onClick={() => void act(async () => {
                          await api(`/assistance/${detail.id}/deliveries/${delivery.id}/confirm`, 'POST', { confirmed: true, version: delivery.version });
                        }, 'أكّدت الاستلام. هذا تأكيد وصول، لا قبض مال عبر المنصة.')}>
                        أكّد أنني استلمته
                      </button>
                      <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                        onClick={() => setDisputing(disputing === delivery.id ? null : delivery.id)}>
                        اعترض
                      </button>
                    </p>
                    {disputing === delivery.id ? (
                      <form onSubmit={event => {
                        event.preventDefault();
                        const form = new FormData(event.currentTarget);
                        void act(async () => {
                          await api(`/assistance/${detail.id}/deliveries/${delivery.id}/confirm`, 'POST', {
                            confirmed: false, reason: String(form.get('reason') ?? ''), version: delivery.version
                          });
                        }, 'سُجِّل اعتراضك، وانتقل الطلب إلى «محل خلاف» فلا يُحسب مسلَّمًا حتى تفصل فيه مراجعة.');
                        setDisputing(null);
                      }}>
                        <div className="tmk-field">
                          <label className="tmk-field__label" htmlFor={`dispute-${delivery.id}`}>ما الذي تعترض عليه؟</label>
                          <textarea id={`dispute-${delivery.id}`} name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required />
                        </div>
                        <p className="tmk-row__actions">
                          <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>سجّل الاعتراض</button>
                        </p>
                      </form>
                    ) : null}
                  </>
                ) : null}
              </div>
            ))
          ) : (
            <EmptyState title="لم يُسجَّل تسليم بعد">لن يُحتسب شيء مسلَّمًا قبل أن تؤكده أنت.</EmptyState>
          )}
        </Card>

        <p className="tmk-row__actions">
          <a className="tmk-button tmk-button--quiet" href={L('/app/assistance')}>عد إلى طلباتي</a>
        </p>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="طلبات المساعدة"
        actions={<button type="button" className="tmk-button tmk-button--primary" onClick={() => setCreating(value => !value)}>طلب جديد</button>}
        lead="طلباتك أنت. لا يراها أحد خارج الجهة التي أرسلتها إليها، ولا تظهر في أي تقرير لممول ولا في أي صفحة عامة." />

      {creating ? (
        <Card title="طلب جديد">
          <Notice tone="info" title="ما الذي توافق عليه بالإرسال">
            <p style={{ marginBlockEnd: 0 }}>
              بالإرسال توافق على مشاركة تفاصيل حاجتك ومستنداتك مع مسؤول الحالة في هذه الجهة وحدها، لغرض دراسة الطلب وتقديم الدعم.
              يمكنك سحب هذه الموافقة في أي وقت من صفحة الطلب، وعندها تتوقف المعالجة.
            </p>
          </Notice>
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void act(async () => {
              await api('/assistance', 'POST', {
                organizationId: String(form.get('organizationId') ?? ''),
                category: String(form.get('category') ?? ''),
                needSummary: String(form.get('needSummary') ?? ''),
                householdSize: form.get('householdSize') ? Number(form.get('householdSize')) : null,
                submit: true
              });
            }, 'أُرسل طلبك مع موافقتك على معالجته.');
            setCreating(false);
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="organizationId">معرّف الجهة</label>
              <span className="tmk-field__hint" id="org-hint">
                البحث عن الجهات بالاسم من هذه الصفحة ليس في هذه المرحلة: انسخ المعرّف من صفحة الجهة. لا يُقبل الطلب إلا لجهة موثقة.
              </span>
              <input id="organizationId" name="organizationId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby="org-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="category">نوع الحاجة</label>
              <input id="category" name="category" className="tmk-field__control" required minLength={2} maxLength={60} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="needSummary">وصف الحاجة</label>
              <span className="tmk-field__hint" id="need-hint">اكتب ما يلزم لدراسة الطلب فقط. لا تكتب أرقام هوية ولا تفاصيل لا علاقة لها بالحاجة.</span>
              <textarea id="needSummary" name="needSummary" className="tmk-field__control" rows={5} required minLength={20} maxLength={4000} aria-describedby="need-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="householdSize">عدد أفراد الأسرة (اختياري)</label>
              <input id="householdSize" name="householdSize" type="number" min={1} max={50} className="tmk-field__control" />
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>أرسل الطلب وأوافق على معالجته</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setCreating(false)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      <DataTable
        caption="طلبات المساعدة"
        rows={cases}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا طلبات">لم تقدم طلب مساعدة حتى الآن.</EmptyState>}
        columns={[
          { key: 'reference', header: 'المرجع', cell: row => <a href={L(`/app/assistance/${row.id}`)}>{row.reference}</a> },
          { key: 'org', header: 'الجهة', cell: row => row.organization.displayName },
          { key: 'category', header: 'النوع', cell: row => row.category },
          { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={assistanceStates[row.state]?.tone ?? 'neutral'}>{assistanceStates[row.state]?.text ?? row.state}</StatusBadge> },
          { key: 'consent', header: 'الموافقة', cell: row => row.consentGiven ? 'قائمة' : <span className="tmk-field__hint">مسحوبة — المعالجة متوقفة</span> },
          {
            key: 'pending', header: 'بانتظارك', numeric: true,
            cell: row => row.deliveries.filter(delivery => !delivery.confirmedAt && !delivery.disputedAt).length || <span className="tmk-field__hint">—</span>
          }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-16 — ideas and incubation
// ---------------------------------------------------------------------------------------------

interface MyProposal {
  id: string; reference: string; title: string; state: string; stateReason: string;
  stage: string; sector: string; city: string; sharingConsent: boolean;
  submittedAt: string | null; closeOutcome: string; closeNote: string;
  startupOrgId: string | null; version: number;
  incubator: { id: string; slug: string; displayName: string } | null;
  startup: { id: string; slug: string; displayName: string } | null;
  latestDecision: { outcome: string; reason: string; at: string } | null;
  mentors: Array<{ name: string; note: string; since: string }>;
  agreements: Array<{
    id: string; sequence: number; title: string; terms: string; ipTerms: string;
    grantMinor: string | null; currency: string | null; grantConditions: string;
    durationMonths: number | null; checksum: string; state: string; declineReason: string;
    version: number; grantsEquity: boolean; equityPercent: number;
  }>;
  milestones: Array<{ id: string; sequence: number; title: string; description: string; dueAt: string; state: string; evidenceRef: string; version: number }>;
}

export function MyProposals({ locale, proposalId }: { locale: Locale; proposalId?: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [rows, setRows] = useState<MyProposal[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState(false);
  const [evidencing, setEvidencing] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async () => setRows(await api('/me/proposals') as MyProposal[]), []);

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

  const path = proposalId ? `/app/proposals/${proposalId}` : '/app/proposals';
  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={path} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(path))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!rows) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const detail = proposalId ? rows.find(row => row.id === proposalId) ?? null : null;
  if (proposalId && !detail) return shell(<ErrorState title="غير موجود">هذه الفكرة ليست لك، أو لم تعد موجودة.</ErrorState>);

  if (detail) {
    const liveOffer = detail.agreements.find(agreement => agreement.state === 'offered');
    return shell(
      <>
        <PageHeader dashboard eyebrow={detail.incubator?.displayName ?? 'فكرة خاصة'} title={detail.title}
          actions={<StatusBadge tone={proposalStates[detail.state]?.tone ?? 'neutral'}>{proposalStates[detail.state]?.text ?? detail.state}</StatusBadge>}
          lead="فكرتك وما جرى عليها. لا تأخذ المنصة ولا الحاضنة أي حصة مقابل أي خطوة هنا." />

        <GrantIsNotEquity />

        {detail.state === 'draft' ? (
          <Card title="أرسل الفكرة إلى حاضنة">
            <p className="tmk-field__hint">
              ما دامت مسودة فلا يراها أحد غيرك. بالإرسال توافق صراحة على مشاركتها مع الحاضنة التي تختارها وحدها.
            </p>
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => setSending(value => !value)}>أرسلها</button>
            </p>
            {sending ? (
              <form onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void act(async () => {
                  await api(`/proposals/${detail.id}/submit`, 'POST', {
                    organizationId: String(form.get('organizationId') ?? ''), sharingConsent: true, version: detail.version
                  });
                }, 'أُرسلت فكرتك مع موافقتك على مشاركتها مع هذه الحاضنة وحدها.');
                setSending(false);
              }}>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="incubatorId">معرّف الحاضنة</label>
                  <span className="tmk-field__hint" id="inc-hint">انسخه من صفحة الجهة. لا تُقبل الفكرة إلا لدى جهة موثقة.</span>
                  <input id="incubatorId" name="organizationId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby="inc-hint" />
                </div>
                <p className="tmk-row__actions">
                  <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>أرسل وأوافق على المشاركة</button>
                  <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setSending(false)}>تراجع</button>
                </p>
              </form>
            ) : null}
          </Card>
        ) : null}

        {detail.latestDecision ? (
          <Card title="قرار الحاضنة">
            <p>
              <StatusBadge tone={detail.latestDecision.outcome === 'accepted' ? 'success' : 'danger'}>
                {detail.latestDecision.outcome === 'accepted' ? 'قُبلت' : 'لم تُقبل'}
              </StatusBadge>
            </p>
            <p>{detail.latestDecision.reason}</p>
            <span className="tmk-field__hint">{formatDate(detail.latestDecision.at, locale)}</span>
          </Card>
        ) : null}

        {detail.mentors.length ? (
          <Card title="الإرشاد">
            <dl className="tmk-definitions">
              {detail.mentors.map(person => (
                <div key={person.since}><dt>{person.name}</dt><dd>{person.note || '—'}</dd></div>
              ))}
            </dl>
            <p className="tmk-field__hint">المرشد يرى فكرتك ويعلّق عليها، ولا يملك قرارًا فيها.</p>
          </Card>
        ) : null}

        {/* PER-16.A03. Terms, with the part 07 names specifically shown as its own field. */}
        {detail.agreements.length ? (
          <Card title="اتفاق الاحتضان">
            {detail.agreements.map(agreement => (
              <div key={agreement.id} className="tmk-row">
                <div>
                  <strong>{agreement.title} <span className="tmk-field__hint">(النسخة {agreement.sequence})</span></strong>
                  <StatusBadge tone={incubationStates[agreement.state]?.tone ?? 'neutral'}>{incubationStates[agreement.state]?.text ?? agreement.state}</StatusBadge>
                  <dl className="tmk-definitions">
                    <div><dt>المنحة</dt><dd>{money(agreement.grantMinor, agreement.currency) ?? 'لا منحة نقدية'}</dd></div>
                    <div><dt>الحصة التي تأخذها الحاضنة</dt><dd>لا شيء — {agreement.equityPercent}%</dd></div>
                    <div><dt>المدة</dt><dd>{agreement.durationMonths ? `${agreement.durationMonths} شهرًا` : '—'}</dd></div>
                  </dl>
                  <h3>الشروط</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{agreement.terms}</p>
                  <h3>الملكية الفكرية</h3>
                  <p style={{ whiteSpace: 'pre-wrap' }}>{agreement.ipTerms}</p>
                  {agreement.grantConditions ? <><h3>شروط المنحة</h3><p>{agreement.grantConditions}</p></> : null}
                  {agreement.declineReason ? <span className="tmk-field__hint">سبب الرفض: {agreement.declineReason}</span> : null}
                </div>
                {agreement.state === 'offered' ? (
                  <p className="tmk-row__actions">
                    <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                      onClick={() => void act(async () => {
                        await api(`/incubation-agreements/${agreement.id}/accept`, 'POST', { checksum: agreement.checksum, version: agreement.version });
                      }, 'قبلتَ الاتفاق. لم تُنشأ شركة ولم تُمنح حصة ولم ينتقل مال.')}>
                      أقبل هذه الشروط
                    </button>
                    <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                      onClick={() => {
                        const el = document.getElementById(`decline-${agreement.id}`);
                        if (el) el.hidden = !el.hidden;
                      }}>
                      أرفض
                    </button>
                  </p>
                ) : null}
                {agreement.state === 'offered' ? (
                  <form id={`decline-${agreement.id}`} hidden onSubmit={event => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    void act(async () => {
                      await api(`/incubation-agreements/${agreement.id}/decline`, 'POST', { reason: String(form.get('reason') ?? ''), version: agreement.version });
                    }, 'سُجِّل رفضك مع سببه.');
                  }}>
                    <div className="tmk-field">
                      <label className="tmk-field__label" htmlFor={`declineReason-${agreement.id}`}>سبب الرفض</label>
                      <textarea id={`declineReason-${agreement.id}`} name="reason" className="tmk-field__control" rows={2} minLength={10} maxLength={1000} required />
                    </div>
                    <p className="tmk-row__actions">
                      <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>أكّد الرفض</button>
                    </p>
                  </form>
                ) : null}
              </div>
            ))}
            {liveOffer ? (
              <p className="tmk-field__hint">
                نص العرض مجمّد منذ إرساله: أي تعديل من الحاضنة يصلك كنسخة جديدة برقم جديد، فما تقرؤه هو بالضبط ما ستوافق عليه.
              </p>
            ) : null}
          </Card>
        ) : null}

        {detail.milestones.length ? (
          <Card title="المراحل">
            <DataTable
              caption="مراحل الاحتضان"
              rows={detail.milestones}
              rowKey={row => row.id}
              emptyState={<EmptyState title="لا مراحل">لم تُحدد مراحل بعد.</EmptyState>}
              columns={[
                { key: 'title', header: 'المرحلة', cell: row => row.title },
                { key: 'due', header: 'تستحق في', cell: row => formatDate(row.dueAt, locale) },
                { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={milestoneStates[row.state]?.tone ?? 'neutral'}>{milestoneStates[row.state]?.text ?? row.state}</StatusBadge> },
                {
                  key: 'action', header: 'الإجراء',
                  cell: row => ['planned', 'changes_requested'].includes(row.state)
                    ? <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setEvidencing(evidencing === row.id ? null : row.id)}>قدّم دليلًا</button>
                    : <span className="tmk-field__hint">—</span>
                }
              ]}
            />
            {evidencing ? (
              <form onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                const milestone = detail.milestones.find(row => row.id === evidencing);
                if (!milestone) return;
                void act(async () => {
                  await api(`/incubation-milestones/${milestone.id}/evidence`, 'POST', {
                    evidenceRef: String(form.get('evidenceRef') ?? ''),
                    evidenceNote: String(form.get('evidenceNote') ?? ''),
                    version: milestone.version
                  });
                }, 'قُدِّم الدليل. المراجعة على الحاضنة، ولا يترتب على اعتمادها صرف مال تلقائي.');
                setEvidencing(null);
              }}>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="evidenceRef">مرجع الدليل</label>
                  <input id="evidenceRef" name="evidenceRef" className="tmk-field__control" required minLength={3} maxLength={200} />
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor="evidenceNote">شرح</label>
                  <textarea id="evidenceNote" name="evidenceNote" className="tmk-field__control" rows={3} maxLength={4000} />
                </div>
                <p className="tmk-row__actions">
                  <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>قدّم</button>
                  <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setEvidencing(null)}>إلغاء</button>
                </p>
              </form>
            ) : null}
          </Card>
        ) : null}

        {/* PER-16.A05. The founder creates the company; this only records which idea it came from. */}
        <Card title="الشركة">
          {detail.startup ? (
            <p>
              مرتبطة بـ <a href={L(`/organizations/${detail.startup.slug}`)}>{detail.startup.displayName}</a>.
              <span className="tmk-field__hint"> أنشأتَها أنت، وتملكها أنت، ولا تحمل أي حصة للحاضنة.</span>
            </p>
          ) : ['active', 'accepted'].includes(detail.state) ? (
            <>
              <p className="tmk-field__hint">
                تأسيس الشركة خطوتك أنت: تنشئها من نموذج الجهات العادي وتملكها كاملة، ثم تربطها بالفكرة هنا.
                الربط تسجيل لما حدث، لا يُنشئ حسابًا ولا يمنح أحدًا حصة ولا يحوّل المنحة إلى رأس مال.
              </p>
              <p className="tmk-row__actions">
                <a className="tmk-button tmk-button--primary" href={`${L('/app/organizations/new')}?proposal=${detail.id}`}>أنشئ شركة</a>
                <button type="button" className="tmk-button tmk-button--secondary" onClick={() => setLinking(value => !value)}>اربط شركة أنشأتها</button>
              </p>
              {linking ? (
                <form onSubmit={event => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void act(async () => {
                    await api(`/proposals/${detail.id}/startup-link`, 'POST', { organizationId: String(form.get('organizationId') ?? ''), version: detail.version });
                  }, 'رُبطت الشركة بالفكرة. لم تُصدر أي حصة لأحد.');
                  setLinking(false);
                }}>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor="startupOrgId">معرّف الشركة</label>
                    <span className="tmk-field__hint" id="startup-hint">يجب أن تكون مالكها. لا يمكن ربط شركة جهة أخرى بفكرتك.</span>
                    <input id="startupOrgId" name="organizationId" className="tmk-field__control" required pattern="[0-9a-fA-F-]{36}" aria-describedby="startup-hint" />
                  </div>
                  <p className="tmk-row__actions">
                    <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>اربط</button>
                  </p>
                </form>
              ) : null}
            </>
          ) : (
            <p className="tmk-field__hint">ربط شركة متاح بعد قبول الاحتضان.</p>
          )}
        </Card>

        <p className="tmk-row__actions">
          <a className="tmk-button tmk-button--quiet" href={L('/app/proposals')}>عد إلى أفكاري</a>
        </p>
      </>
    );
  }

  return shell(
    <>
      <PageHeader dashboard title="أفكاري واحتضاني"
        actions={<button type="button" className="tmk-button tmk-button--primary" onClick={() => setCreating(value => !value)}>فكرة جديدة</button>}
        lead="فكرتك ملكك. تبقى خاصة حتى ترسلها بنفسك، ولا يأخذ أحد حصة منها مقابل التقديم أو القبول." />

      {creating ? (
        <Card title="فكرة جديدة">
          <form onSubmit={event => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            void act(async () => {
              await api('/proposals', 'POST', {
                title: String(form.get('title') ?? ''),
                summary: String(form.get('summary') ?? ''),
                problem: String(form.get('problem') ?? ''),
                stage: String(form.get('stage') ?? ''),
                sector: String(form.get('sector') ?? ''),
                city: String(form.get('city') ?? ''),
                supportSought: String(form.get('supportSought') ?? '')
              });
            }, 'حُفظت الفكرة كمسودة خاصة. لا يراها أحد حتى ترسلها.');
            setCreating(false);
          }}>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="title">العنوان</label>
              <input id="title" name="title" className="tmk-field__control" required minLength={4} maxLength={200} />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="summary">وصف الفكرة</label>
              <span className="tmk-field__hint" id="summary-hint">٥٠ حرفًا على الأقل قبل الإرسال: هذا ما تُقرأ به الفكرة.</span>
              <textarea id="summary" name="summary" className="tmk-field__control" rows={4} maxLength={4000} aria-describedby="summary-hint" />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="problem">المشكلة التي تحلها</label>
              <textarea id="problem" name="problem" className="tmk-field__control" rows={3} maxLength={4000} />
            </div>
            <div className="tmk-grid tmk-grid--stats">
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="stage">المرحلة</label>
                <input id="stage" name="stage" className="tmk-field__control" maxLength={60} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="sector">القطاع</label>
                <input id="sector" name="sector" className="tmk-field__control" maxLength={100} />
              </div>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="city">المدينة</label>
                <input id="city" name="city" className="tmk-field__control" maxLength={100} />
              </div>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="supportSought">ما الدعم الذي تطلبه؟</label>
              <textarea id="supportSought" name="supportSought" className="tmk-field__control" rows={3} maxLength={2000} />
            </div>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>احفظ كمسودة خاصة</button>
              <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setCreating(false)}>تراجع</button>
            </p>
          </form>
        </Card>
      ) : null}

      <DataTable
        caption="أفكاري"
        rows={rows}
        rowKey={row => row.id}
        emptyState={<EmptyState title="لا أفكار بعد">ابدأ بمسودة خاصة لا يراها أحد.</EmptyState>}
        columns={[
          { key: 'title', header: 'الفكرة', cell: row => <a href={L(`/app/proposals/${row.id}`)}>{row.title}</a> },
          { key: 'incubator', header: 'الحاضنة', cell: row => row.incubator?.displayName ?? <span className="tmk-field__hint">لم تُرسل بعد</span> },
          { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={proposalStates[row.state]?.tone ?? 'neutral'}>{proposalStates[row.state]?.text ?? row.state}</StatusBadge> },
          {
            key: 'offer', header: 'اتفاق', cell: row => {
              const offered = row.agreements.find(agreement => agreement.state === 'offered');
              return offered ? <StatusBadge tone="warning">بانتظار ردك</StatusBadge> : <span className="tmk-field__hint">—</span>;
            }
          },
          { key: 'equity', header: 'الحصة المأخوذة منك', cell: row => <span>لا شيء{row.agreements[0] ? ` — ${row.agreements[0].equityPercent}%` : ''}</span> }
        ]}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-17 — volunteering
// ---------------------------------------------------------------------------------------------

interface MyVolunteering {
  applications: Array<{
    id: string; state: string; decisionReason: string; version: number;
    opportunity: { slug: string; title: string; state: string };
    organization: string; withdrawalPolicy: string;
  }>;
  assignments: Array<{
    id: string; task: string; startsAt: string; endsAt: string | null; state: string;
    acceptedAt: string | null; version: number;
    opportunity: { slug: string; title: string }; organization: string;
    hours: Array<{ id: string; workedOn: string; minutes: number; state: string; decisionReason: string; counted: boolean }>;
    minutesApproved: number; minutesAwaiting: number;
  }>;
}

export function MyVolunteering({ locale }: { locale: Locale }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [data, setData] = useState<MyVolunteering | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [logging, setLogging] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState<string | null>(null);

  const load = useCallback(async () => setData(await api('/me/volunteering') as MyVolunteering), []);

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
    <AppShell locale={locale} path="/app/volunteering" signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/volunteer')}>فرص التطوع</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L('/app/volunteering'))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!data) return shell(<ErrorState title="تعذر التحميل">أعد المحاولة.</ErrorState>);

  const today = new Date().toISOString().slice(0, 10);

  return shell(
    <>
      <PageHeader dashboard title="تطوعي" lead="طلباتك ومهامك وساعاتك. التطوع عمل غير مدفوع وليس توظيفًا، والساعات لا تُحتسب قبل أن يعتمدها غيرك." />

      <Card title="طلباتي">
        <DataTable
          caption="طلبات التطوع"
          rows={data.applications}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا طلبات" action={<a className="tmk-button tmk-button--primary" href={L('/volunteer')}>تصفّح الفرص</a>}>لم تتقدم لفرصة تطوع بعد.</EmptyState>}
          columns={[
            { key: 'opportunity', header: 'الفرصة', cell: row => <a href={L(`/volunteer/${row.opportunity.slug}`)}>{row.opportunity.title}</a> },
            { key: 'org', header: 'الجهة', cell: row => row.organization },
            {
              key: 'state', header: 'الحالة', cell: row => (
                <>
                  <StatusBadge tone={row.state === 'accepted' ? 'success' : row.state === 'rejected' ? 'danger' : row.state === 'withdrawn' ? 'neutral' : 'info'}>
                    {row.state === 'submitted' ? 'قيد النظر' : row.state === 'accepted' ? 'مقبول' : row.state === 'rejected' ? 'غير مقبول' : 'مسحوب'}
                  </StatusBadge>
                  {row.decisionReason ? <span className="tmk-field__hint">{row.decisionReason}</span> : null}
                </>
              )
            },
            {
              key: 'action', header: 'الإجراء',
              cell: row => ['submitted', 'accepted'].includes(row.state)
                ? <button type="button" className="tmk-button tmk-button--quiet" disabled={busy} onClick={() => setWithdrawing(withdrawing === row.id ? null : row.id)}>اسحب الطلب</button>
                : <span className="tmk-field__hint">—</span>
            }
          ]}
        />
        {withdrawing ? (() => {
          const application = data.applications.find(row => row.id === withdrawing);
          if (!application) return null;
          return (
            <form onSubmit={event => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              void act(async () => {
                await api(`/volunteer-applications/${application.id}/withdraw`, 'POST', { reason: String(form.get('reason') ?? ''), version: application.version });
              }, 'سُحب طلبك.');
              setWithdrawing(null);
            }}>
              <Notice tone="info" title="سياسة الانسحاب المعلنة">
                <p style={{ marginBlockEnd: 0 }}>{application.withdrawalPolicy || 'لم تعلن الجهة سياسة انسحاب لهذه الفرصة.'}</p>
              </Notice>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="withdrawReason">السبب</label>
                <textarea id="withdrawReason" name="reason" className="tmk-field__control" rows={2} minLength={10} maxLength={1000} required />
              </div>
              <p className="tmk-row__actions">
                <button type="submit" className="tmk-button tmk-button--danger" disabled={busy}>أكّد السحب</button>
                <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setWithdrawing(null)}>تراجع</button>
              </p>
            </form>
          );
        })() : null}
      </Card>

      <Card title="مهامي وساعاتي">
        {data.assignments.length ? data.assignments.map(assignment => (
          <div key={assignment.id} className="tmk-row">
            <div>
              <strong>{assignment.opportunity.title}</strong>
              <span className="tmk-field__hint">{assignment.organization} · من {formatDate(assignment.startsAt, locale)}</span>
              <StatusBadge tone={volunteerAssignmentStates[assignment.state]?.tone ?? 'neutral'}>
                {volunteerAssignmentStates[assignment.state]?.text ?? assignment.state}
              </StatusBadge>
              <p>{assignment.task}</p>
              <dl className="tmk-definitions">
                <div><dt>ساعات معتمدة</dt><dd>{hoursText(assignment.minutesApproved)}</dd></div>
                <div><dt>بانتظار الاعتماد</dt><dd>{hoursText(assignment.minutesAwaiting)}</dd></div>
              </dl>
              {assignment.hours.length ? (
                <DataTable
                  caption={`ساعات ${assignment.opportunity.title}`}
                  rows={assignment.hours}
                  rowKey={row => row.id}
                  emptyState={<EmptyState title="لا ساعات">لم تسجل ساعات بعد.</EmptyState>}
                  columns={[
                    { key: 'day', header: 'اليوم', cell: row => formatDate(row.workedOn, locale) },
                    { key: 'minutes', header: 'المدة', numeric: true, cell: row => hoursText(row.minutes) },
                    {
                      key: 'state', header: 'الحالة', cell: row => (
                        <>
                          <StatusBadge tone={hoursStates[row.state]?.tone ?? 'neutral'}>{hoursStates[row.state]?.text ?? row.state}</StatusBadge>
                          {row.decisionReason ? <span className="tmk-field__hint">{row.decisionReason}</span> : null}
                        </>
                      )
                    }
                  ]}
                />
              ) : null}
            </div>
            <p className="tmk-row__actions">
              {assignment.state === 'offered' ? (
                <>
                  <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                    onClick={() => void act(async () => {
                      await api(`/volunteer-assignments/${assignment.id}/accept`, 'POST', { accept: true, version: assignment.version });
                    }, 'قبلتَ المهمة.')}>
                    أقبل المهمة
                  </button>
                  <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
                    onClick={() => void act(async () => {
                      await api(`/volunteer-assignments/${assignment.id}/accept`, 'POST', { accept: false, reason: 'لا أستطيع الالتزام بهذه المهمة في هذا الوقت.', version: assignment.version });
                    }, 'رفضتَ المهمة.')}>
                    أعتذر
                  </button>
                </>
              ) : null}
              {['accepted', 'active'].includes(assignment.state) ? (
                <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => setLogging(logging === assignment.id ? null : assignment.id)}>
                  سجّل ساعات
                </button>
              ) : null}
            </p>
            {logging === assignment.id ? (
              <form onSubmit={event => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                void act(async () => {
                  await api('/volunteer-hours', 'POST', {
                    assignmentId: assignment.id,
                    workedOn: String(form.get('workedOn') ?? ''),
                    minutes: Number(form.get('hours') ?? 0) * 60 + Number(form.get('minutes') ?? 0),
                    note: String(form.get('note') ?? '')
                  });
                }, 'سُجِّلت ساعاتك. لا تُحتسب حتى يعتمدها شخص آخر — لا تعتمد ساعاتك بنفسك.');
                setLogging(null);
              }}>
                <div className="tmk-grid tmk-grid--stats">
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor={`workedOn-${assignment.id}`}>اليوم</label>
                    <input id={`workedOn-${assignment.id}`} name="workedOn" type="date" max={today} className="tmk-field__control" required />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor={`hours-${assignment.id}`}>ساعات</label>
                    <input id={`hours-${assignment.id}`} name="hours" type="number" min={0} max={23} defaultValue={0} className="tmk-field__control" />
                  </div>
                  <div className="tmk-field">
                    <label className="tmk-field__label" htmlFor={`minutes-${assignment.id}`}>دقائق</label>
                    <input id={`minutes-${assignment.id}`} name="minutes" type="number" min={0} max={59} defaultValue={0} className="tmk-field__control" />
                  </div>
                </div>
                <div className="tmk-field">
                  <label className="tmk-field__label" htmlFor={`note-${assignment.id}`}>ملاحظة</label>
                  <input id={`note-${assignment.id}`} name="note" className="tmk-field__control" maxLength={1000} />
                </div>
                <p className="tmk-row__actions">
                  <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>سجّل</button>
                  <button type="button" className="tmk-button tmk-button--quiet" onClick={() => setLogging(null)}>إلغاء</button>
                </p>
              </form>
            ) : null}
          </div>
        )) : (
          <EmptyState title="لا مهام">لم تُسند إليك مهمة بعد.</EmptyState>
        )}
      </Card>
    </>
  );
}
