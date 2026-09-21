'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Button, Card, DataTable, EmptyState, ErrorState, Ltr, MoneyAmount, Notice, PageHeader,
  Skeleton, Stat, StatusBadge, TextField, formatDate, formatMinorUnits, localePath, translator, type Locale
} from '@tamkeen/ui';
import './workspace.css';
import { DownloadButton } from './download-button';

/**
 * PART-06 screens: PER-04 checkout, PER-05 payment result, PER-02/PER-03 the contributor's own
 * record, and ORG-09/ORG-10 the organisation's contributions and ledger.
 *
 * Three rules from 00-MASTER-PROMPT and 08-FINANCIAL-SYSTEM shape all of them:
 *
 *  1. No money arithmetic happens in the browser. The quote, the fee and every balance are read
 *     from the server, which recomputes them at submission; the amount box is the only number the
 *     browser produces, and it is converted to integer minor units before it leaves.
 *  2. Returning from a payment page is not proof of payment. PER-05 reads the intent status from
 *     our own record and says "awaiting confirmation" until a signed provider event arrives.
 *  3. Nothing simulated is presented as real. Every screen here states that the payment path is a
 *     simulator, because there is no provider in this build.
 */

class UnauthenticatedError extends Error {}

const api = async (path: string, method: 'GET' | 'POST' | 'PATCH' = 'GET', body?: unknown, headers: Record<string, string> = {}) => {
  const response = await fetch(`/api/v1${path}`, {
    method, credentials: 'include',
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
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
    not_found: 'المورد غير موجود، أو ليس لك.',
    conflict: 'تغيّرت الحالة أو السعر منذ آخر عرض. حمّل الأحدث وأعد المحاولة.',
    invalid_input: 'تحقق من المبلغ: يجب أن يكون رقمًا موجبًا بوحدات صحيحة.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

/** Two decimal places is the assumption for ILS/JOD/USD in this build. */
const toMinor = (major: string) => {
  const cleaned = major.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('أدخل مبلغًا صحيحًا مثل 100 أو 100.50.');
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (minor === '0') throw new Error('المبلغ يجب أن يكون أكبر من صفر.');
  return minor;
};

const contributionStates: Record<string, { text: string; tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' }> = {
  pending: { text: 'بانتظار تأكيد الدفع', tone: 'warning' },
  succeeded: { text: 'مؤكدة', tone: 'success' },
  failed: { text: 'فشل الدفع', tone: 'danger' },
  expired: { text: 'انتهت مهلة الحجز', tone: 'neutral' },
  refunded: { text: 'مستردة بالكامل', tone: 'neutral' },
  partially_refunded: { text: 'مستردة جزئيًا', tone: 'info' }
};

// ---------------------------------------------------------------------------------------------
// PER-04 — checkout
// ---------------------------------------------------------------------------------------------

interface Quote {
  projectSlug: string; projectTitle: string; organization: string; currency: string;
  amountMinor: string; feeMinor: string; netToProjectMinor: string;
  goalMinor: string; remainingCapacityMinor: string; policy: string;
  exceedsCapacity: boolean; simulated: true;
}

/** A fresh key per checkout attempt, so a double submit is one contribution, not two. */
const newIdempotencyKey = () => (globalThis.crypto?.randomUUID?.() ?? `key-${Date.now()}-${Math.random().toString(16).slice(2)}`);

export function Checkout({ locale, slug }: { locale: Locale; slug: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [amount, setAmount] = useState('100');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState('');
  // Held across re-renders: retrying a failed submit must reuse the key, not mint a new one.
  const idempotencyKey = useRef(newIdempotencyKey());

  const priceIt = useCallback(async (major: string) => {
    const minor = toMinor(major);
    return await api(`/projects/${encodeURIComponent(slug)}/quote?amountMinor=${minor}`) as Quote;
  }, [slug]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await api('/me');
        if (active) setSignedIn(true);
      } catch (e) {
        if (active) setSignedIn(!(e instanceof UnauthenticatedError));
      }
      try {
        const first = await priceIt('100');
        if (active) setQuote(first);
      } catch (e) {
        // A 409 here means the campaign is closed or the project stopped accepting money.
        if (active) setClosed(e instanceof Error ? e.message : 'هذا المشروع لا يقبل مساهمات الآن.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [priceIt]);

  /** PER-04.A02. Re-pricing is a server call: the fee is never computed in the browser. */
  const reprice = async (major: string) => {
    if (busy) return;
    setBusy(true); setError('');
    try { setQuote(await priceIt(major)); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر تسعير المبلغ.'); }
    finally { setBusy(false); }
  };

  /** PER-04.A01. Creates a reservation and an intent; it does not pay. */
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !quote) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError('');
    try {
      // Re-price immediately before submitting so the accepted fee is the current one; the server
      // recomputes it again regardless and refuses a stale quote with a 409.
      const fresh = await priceIt(amount);
      setQuote(fresh);
      const created = await api('/contributions', 'POST', {
        projectSlug: slug,
        amountMinor: fresh.amountMinor,
        visibility: data.get('visibility') === 'anonymous' ? 'anonymous' : 'named',
        showAmountPublicly: data.get('showAmount') === 'on',
        acceptedQuoteFeeMinor: fresh.feeMinor
      }, { 'idempotency-key': idempotencyKey.current }) as { paymentIntentId: string; providerRedirectPath: string };
      window.location.href = L(created.providerRedirectPath);
    } catch (e) {
      if (e instanceof UnauthenticatedError) { window.location.href = `${L('/login')}?returnTo=${encodeURIComponent(L(`/checkout/${slug}`))}`; return; }
      setError(e instanceof Error ? e.message : 'تعذر إنشاء المساهمة.');
      setBusy(false);
    }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/checkout/${slug}`} signedIn={Boolean(signedIn)}>
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={L('/explore')}>استكشف</a></li>
          <li><a href={L(`/projects/${slug}`)}>{quote?.projectTitle ?? 'المشروع'}</a></li>
          <li><span aria-current="page">المساهمة</span></li>
        </ol>
      </nav>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={5} label={t('loading')} />);
  if (closed || !quote) {
    return shell(
      <ErrorState
        title="هذا المشروع لا يقبل مساهمات الآن"
        onRetry={<a className="tmk-button tmk-button--primary" href={L(`/projects/${slug}`)}>العودة إلى المشروع</a>}
      >
        {closed || 'قد تكون الحملة انتهت أو أُغلق الجمع. صفحة المشروع تعرض حالته الحالية.'}
      </ErrorState>
    );
  }

  return shell(
    <>
      <PageHeader
        eyebrow={quote.organization}
        title={`المساهمة في: ${quote.projectTitle}`}
        lead="ستُحجز السعة عند المتابعة، ولا تُحتسب المساهمة مؤكدة إلا بعد تأكيد مزود الدفع."
      />

      {/* 00-MASTER-PROMPT: a simulator is named as one, on the screen where money is decided. */}
      <Notice tone="warning" title="بيئة عرض — لا يوجد مزود دفع حقيقي">
        <p style={{ marginBlockEnd: 0 }}>
          لن تُخصم أي أموال. المتابعة تنقلك إلى صفحة محاكاة محلية تُصدر حدثًا موقّعًا عبر نفس مسار
          التأكيد الذي سيستخدمه مزود حقيقي لاحقًا.
        </p>
      </Notice>

      {signedIn === false ? (
        <Notice tone="info" title="تحتاج إلى تسجيل الدخول لإتمام المساهمة">
          <p style={{ marginBlockEnd: 0 }}>
            يمكنك مراجعة المبلغ والرسوم الآن. عند المتابعة سيُطلب منك تسجيل الدخول ثم تعود إلى هذه الصفحة.
          </p>
        </Notice>
      ) : null}

      <form onSubmit={submit} autoComplete="off">
        <Card title="المبلغ">
          <div className="tmk-field">
            {/* The currency code is isolated: an unisolated Latin run inside Arabic reorders unpredictably. */}
            <label className="tmk-field__label" htmlFor="checkout-amount">المبلغ (<Ltr>{quote.currency}</Ltr>)</label>
            <p className="tmk-field__hint" id="checkout-amount-hint">
              أدخل المبلغ ثم اضغط «أعد الحساب» ليُسعّره الخادم. لا يُحتسب أي رقم في المتصفح.
            </p>
            <input
              id="checkout-amount" name="amount" className="tmk-input" inputMode="decimal"
              value={amount} onChange={event => setAmount(event.target.value)}
              aria-describedby="checkout-amount-hint" required autoComplete="off"
            />
          </div>
          <p className="tmk-row__actions">
            <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void reprice(amount)}>
              أعد الحساب
            </button>
          </p>
        </Card>

        <Card title="ما الذي سيُخصم وما الذي يصل للمشروع">
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="تدفع" value={<MoneyAmount minor={quote.amountMinor} currency={quote.currency} locale={locale} />} note="المبلغ المطلوب من وسيلة الدفع" />
            <Stat label="رسوم المعالجة" value={<MoneyAmount minor={quote.feeMinor} currency={quote.currency} locale={locale} />} note="جدول رسوم محاكى ومعلن قبل الدفع" />
            <Stat label="يصل للمشروع" value={<MoneyAmount minor={quote.netToProjectMinor} currency={quote.currency} locale={locale} />} note="المبلغ ناقص الرسوم" />
            <Stat label="المتبقي في الحملة" value={<MoneyAmount minor={quote.remainingCapacityMinor} currency={quote.currency} locale={locale} />} note="بعد خصم المؤكد والحجوزات الجارية" />
          </div>
          <p className="tmk-field__hint">
            {quote.policy === 'all_or_nothing'
              ? 'سياسة الحملة: الكل أو لا شيء. إن لم يبلغ الهدف تُرد المساهمات.'
              : 'سياسة الحملة: تمويل مرن. يُنفَّذ المشروع جزئيًا وفق ميزانية مرحلية.'}
          </p>
          {quote.exceedsCapacity ? (
            <Notice tone="danger" title="المبلغ أكبر من المتبقي في الحملة">
              <p style={{ marginBlockEnd: 0 }}>
                لا يُقبل التمويل الزائد افتراضيًا. خفّض المبلغ إلى المتبقي أو أقل، ثم أعد الحساب.
              </p>
            </Notice>
          ) : null}
        </Card>

        <Card title="الظهور العام">
          <p className="tmk-field__hint">
            خياران منفصلان: أن يظهر اسمك، وأن يظهر مبلغك. يمكنك تغييرهما لاحقًا من صفحة مساهماتك،
            ويسري التغيير فورًا على كل ما يراه الجمهور.
          </p>
          <fieldset className="tmk-fieldset">
            <legend className="tmk-fieldset__legend">اسمك</legend>
            <div className="tmk-choice">
              <input className="tmk-choice__control" type="radio" id="visibility-named" name="visibility" value="named" defaultChecked />
              <label className="tmk-choice__label" htmlFor="visibility-named">اعرض اسمي في قائمة المساهمين</label>
            </div>
            <div className="tmk-choice">
              <input className="tmk-choice__control" type="radio" id="visibility-anonymous" name="visibility" value="anonymous" />
              <label className="tmk-choice__label" htmlFor="visibility-anonymous">ساهم دون ذكر اسمي</label>
            </div>
          </fieldset>
          <div className="tmk-choice">
            <input className="tmk-choice__control" type="checkbox" id="showAmount" name="showAmount" />
            <label className="tmk-choice__label" htmlFor="showAmount">اعرض مبلغي أيضًا (لا يُعرض المبلغ إطلاقًا مع المساهمة المجهولة)</label>
          </div>
        </Card>

        <p className="tmk-row__actions">
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy || quote.exceedsCapacity}>
            {busy ? 'جارٍ المتابعة…' : 'متابعة للدفع'}
          </button>
          <a className="tmk-button tmk-button--quiet" href={L(`/projects/${slug}`)}>رجوع للمشروع دون مساهمة</a>
        </p>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// The local simulate page — demo only, standing in for a provider's hosted page
// ---------------------------------------------------------------------------------------------

export function SimulatePayment({ locale, providerReference }: { locale: Locale; providerReference: string }) {
  const L = (path: string) => localePath(locale, path);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const [intentId, setIntentId] = useState('');

  const send = async (outcome: 'succeeded' | 'failed' | 'settled') => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const result = await api(`/payments/simulate/${encodeURIComponent(providerReference)}`, 'POST', { outcome }) as { status: string; paymentIntentId: string };
      setDone(result.status);
      setIntentId(result.paymentIntentId);
    } catch (e) {
      if (e instanceof UnauthenticatedError) { window.location.href = L('/login'); return; }
      setError(e instanceof Error ? e.message : 'تعذر إرسال الحدث.');
    } finally { setBusy(false); }
  };

  return (
    <AppShell locale={locale} path={`/payments/simulate/${providerReference}`} signedIn>
      <PageHeader
        eyebrow="محاكاة"
        title="صفحة دفع محاكاة"
        lead="هذه ليست صفحة مزود دفع. لا تُدخل هنا أي بيانات بطاقة، ولن تُطلب منك."
      />
      <Notice tone="warning" title="لماذا توجد هذه الصفحة">
        <p style={{ marginBlockEnd: 0 }}>
          لا يوجد مزود دفع في هذه النسخة. يُصدر الزر أدناه حدثًا موقّعًا يمر عبر نفس مسار الـwebhook
          الذي سيستخدمه مزود حقيقي، حتى يكون المسار المُختبَر هو مسار الإنتاج نفسه.
        </p>
      </Notice>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {done ? (
        <Notice tone={['succeeded', 'settled'].includes(done) ? 'success' : 'info'} title="أُرسل الحدث" live="polite">
          <p>نتيجة المعالجة: <code>{done}</code>. الحالة المعتمدة تُقرأ من سجلنا، لا من هذه الصفحة.</p>
          <p className="tmk-row__actions" style={{ marginBlockEnd: 0 }}>
            <a className="tmk-button tmk-button--primary" href={L(`/payments/${intentId}`)}>اعرض نتيجة الدفع</a>
            {done === 'succeeded' ? (
              <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void send('settled')}>
                محاكاة وصول المال إلى الحساب
              </button>
            ) : null}
          </p>
        </Notice>
      ) : (
        <Card title="اختر نتيجة الدفع">
          <p className="tmk-row__actions">
            <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void send('succeeded')}>محاكاة دفع ناجح</button>
            <button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void send('failed')}>محاكاة دفع فاشل</button>
          </p>
          <p className="tmk-field__hint">
            نجاح الدفع والتسوية حدثان منفصلان عمدًا: وصول المال إلينا ليس هو صيرورته قابلًا للصرف، والمزود الحقيقي
            يخبر بالثاني بعد ساعات أو أيام. يظهر زر التسوية بعد نجاح الدفع.
          </p>
        </Card>
      )}
    </AppShell>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-05 — payment result
// ---------------------------------------------------------------------------------------------

interface IntentStatus {
  id: string; state: string; contributionId: string; contributionState: string;
  amountMinor: string; currency: string; expiresAt: string;
  project: { slug: string; title: string };
  awaitingProvider: boolean; simulated: boolean;
}

export function PaymentResult({ locale, intentId }: { locale: Locale; intentId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [status, setStatus] = useState<IntentStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState('');

  /** PER-05.A01. The authority is our own record, never a `?success=true` in the URL. */
  const check = useCallback(async () => {
    const loaded = await api(`/payment-intents/${encodeURIComponent(intentId)}/status`) as IntentStatus;
    setStatus(loaded);
    setCheckedAt(new Date().toISOString());
    return loaded;
  }, [intentId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await check(); }
      catch (e) { if (active && !(e instanceof UnauthenticatedError)) setError(e instanceof Error ? e.message : 'تعذر قراءة حالة الدفع.'); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [check]);

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/payments/${intentId}`} signedIn={Boolean(status)}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={4} label={t('loading')} />);
  if (!status) {
    return shell(
      <ErrorState title={t('notFoundTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/app/contributions')}>مساهماتي</a>}>
        لا توجد عملية دفع بهذا المعرّف تخصك.
      </ErrorState>
    );
  }

  const settled = status.state === 'succeeded';
  const failed = status.state === 'failed' || status.state === 'expired';

  return shell(
    <>
      <PageHeader
        eyebrow={status.project.title}
        title={settled ? 'تم تأكيد مساهمتك' : failed ? 'لم يكتمل الدفع' : 'بانتظار تأكيد مزود الدفع'}
        lead={settled
          ? 'وصل تأكيد موقّع من مزود الدفع وسُجّلت المساهمة في الدفتر.'
          : failed
            ? 'لم يصل تأكيد ناجح. لم يُسجَّل أي مبلغ، والسعة المحجوزة أُعيدت للحملة.'
            : 'العودة من صفحة الدفع ليست دليلًا على الدفع. تُعرض هنا الحالة المسجّلة عندنا فقط.'}
      />

      <Card title="الحالة">
        <div className="tmk-grid tmk-grid--stats">
          <Stat label="المبلغ" value={<MoneyAmount minor={status.amountMinor} currency={status.currency} locale={locale} />} />
          <Stat
            label="حالة الدفع"
            value={<StatusBadge tone={settled ? 'success' : failed ? 'danger' : 'warning'}>{
              settled ? 'مؤكد' : failed ? 'فشل أو انتهت المهلة' : 'قيد الانتظار'
            }</StatusBadge>}
          />
          <Stat
            label="حالة المساهمة"
            value={<StatusBadge tone={contributionStates[status.contributionState]?.tone ?? 'neutral'}>{contributionStates[status.contributionState]?.text ?? status.contributionState}</StatusBadge>}
          />
          <Stat label="آخر تحقق" value={checkedAt ? formatDate(checkedAt, locale, true) : '—'} note="وقت آخر قراءة من الخادم" />
        </div>

        {status.awaitingProvider ? (
          <Notice tone="warning" title="بانتظار تأكيد خارجي" live="polite">
            <p style={{ marginBlockEnd: 0 }}>
              قد يستغرق التأكيد لحظات. اضغط «تحقق من الحالة» لإعادة القراءة؛ الصفحة لا تفترض النجاح
              ولا تُحدّث نفسها تلقائيًا لتوحي بأن شيئًا حدث.
            </p>
          </Notice>
        ) : null}

        <p className="tmk-row__actions">
          <button type="button" className="tmk-button tmk-button--secondary" onClick={() => void check().catch(e => setError(e instanceof Error ? e.message : 'تعذر التحقق.'))}>
            تحقق من الحالة
          </button>
          {settled ? (
            <a className="tmk-button tmk-button--primary" href={L('/app/contributions')}>عرض الإيصال في مساهماتي</a>
          ) : (
            // PER-05.A02: the receipt link exists only after a confirmed success.
            <span className="tmk-field__hint">يظهر الإيصال بعد تأكيد الدفع فقط.</span>
          )}
          <a className="tmk-button tmk-button--quiet" href={L(`/projects/${status.project.slug}`)}>صفحة المشروع</a>
        </p>

        {status.simulated ? (
          <p className="tmk-field__hint">هذه العملية محاكاة: لم تنتقل أي أموال حقيقية.</p>
        ) : null}
      </Card>

      {/* A blind financial retry remains unavailable; support is a real private ticket workflow. */}
      <Card title="إجراءات غير متاحة بعد">
        <ul>
          <li><strong>إعادة محاولة الدفع:</strong> غير متاحة بعد، حتى لا تتكرر عملية نجحت من قبل. ابدأ مساهمة جديدة من صفحة المشروع.</li>
          <li><strong>طلب مساعدة:</strong> <a href={L('/contact')}>افتح تذكرة دعم خاصة</a> وأرفق مرجع المساهمة. التذكرة لا تعيد محاولة الدفع ولا تغيّر الدفتر.</li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-02 / PER-03 — the contributor's own record
// ---------------------------------------------------------------------------------------------

interface MyContribution {
  id: string;
  project: { slug: string; title: string };
  state: string;
  amountMinor: string; feeMinor: string; refundedMinor: string; currency: string;
  visibility: 'named' | 'anonymous'; showAmountPublicly: boolean;
  confirmedAt: string | null; createdAt: string; version: number;
  intent: { id: string; state: string } | null;
  simulated: boolean;
}

export function MyContributions({ locale }: { locale: Locale }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [rows, setRows] = useState<MyContribution[] | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refundFor, setRefundFor] = useState<MyContribution | null>(null);

  const load = useCallback(async () => setRows(await api('/me/contributions') as MyContribution[]), []);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل المساهمات.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  /** PER-03.A02. Visibility is the contributor's to change, and it takes effect immediately. */
  const setPrivacy = async (row: MyContribution, next: { visibility: 'named' | 'anonymous'; showAmountPublicly: boolean }) => {
    if (busy) return;
    setBusy(row.id); setError(''); setNotice('');
    try {
      await api(`/me/contributions/${row.id}/privacy`, 'PATCH', { ...next, version: row.version });
      await load();
      setNotice('حُدِّث الظهور العام. يسري التغيير فورًا على صفحة المشروع.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تحديث الظهور.');
    } finally { setBusy(''); }
  };

  /**
   * PER-03.A03. The server decides eligibility and the refundable remainder; this form only turns a
   * typed amount into integer minor units by string arithmetic, never through a float.
   */
  const requestRefund = async (row: MyContribution, data: FormData) => {
    if (busy) return;
    const typed = String(data.get('amount') ?? '').trim();
    const match = /^(\d{1,14})(?:\.(\d{1,2}))?$/.exec(typed);
    if (!match) { setError('اكتب المبلغ بالأرقام، مع خانتين عشريتين على الأكثر.'); return; }
    const amountMinor = `${match[1]}${(match[2] ?? '').padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
    setBusy(`refund-${row.id}`); setError(''); setNotice('');
    try {
      await api(`/contributions/${row.id}/refund-requests`, 'POST', { amountMinor, reason: String(data.get('reason') ?? '') });
      setRefundFor(null);
      await load();
      setNotice('أُرسل طلب الاسترداد. يراجعه فريق المالية، ولا يتغير رصيد المشروع حتى يُعتمد الاسترداد ويُقيَّد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال طلب الاسترداد.');
    } finally { setBusy(''); }
  };

  const requestStatement = async () => {
    if (busy) return;
    setBusy('export'); setError(''); setNotice('');
    try {
      const job = await api('/me/contribution-exports', 'POST') as { id: string };
      window.location.assign(L(`/app/exports/${job.id}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إنشاء الكشف.'); }
    finally { setBusy(''); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path="/app/contributions" signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={5} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L('/app/contributions'))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }

  return shell(
    <>
      <PageHeader
        dashboard
        title="مساهماتي"
        lead="سجلك الكامل: يظهر لك اسمك ومبلغك دائمًا مهما كان اختيارك للظهور العام."
        actions={<button type="button" className="tmk-button tmk-button--secondary" disabled={Boolean(busy)} onClick={() => void requestStatement()}>أنشئ كشف CSV</button>}
      />

      {!rows?.length ? (
        <EmptyState title="لا مساهمات بعد" action={<a className="tmk-button tmk-button--primary" href={L('/explore')}>تصفح المشاريع</a>}>
          لم تبدأ أي مساهمة حتى الآن.
        </EmptyState>
      ) : (
        <Card title="السجل">
          <DataTable
            caption="مساهماتك، أحدثها أولًا"
            rows={rows}
            rowKey={row => row.id}
            columns={[
              { key: 'project', header: 'المشروع', cell: row => <a href={L(`/projects/${row.project.slug}`)}>{row.project.title}</a> },
              {
                key: 'amount', header: 'المبلغ', numeric: true,
                cell: row => (
                  <>
                    <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} />
                    {row.refundedMinor !== '0'
                      ? <span className="tmk-field__hint"> مسترد: {formatMinorUnits(row.refundedMinor)}</span>
                      : null}
                  </>
                )
              },
              {
                key: 'state', header: 'الحالة',
                cell: row => <StatusBadge tone={contributionStates[row.state]?.tone ?? 'neutral'}>{contributionStates[row.state]?.text ?? row.state}</StatusBadge>
              },
              { key: 'createdAt', header: 'التاريخ', cell: row => formatDate(row.confirmedAt ?? row.createdAt, locale) },
              {
                key: 'visibility', header: 'الظهور العام',
                cell: row => (
                  <>
                    <span>{row.visibility === 'anonymous' ? 'مجهول' : row.showAmountPublicly ? 'الاسم والمبلغ' : 'الاسم فقط'}</span>
                    <span className="tmk-row__actions" style={{ marginBlockStart: 'var(--tmk-space-8)' }}>
                      {row.visibility === 'named' ? (
                        <>
                          <button type="button" className="tmk-button tmk-button--quiet" disabled={busy === row.id}
                            onClick={() => void setPrivacy(row, { visibility: 'anonymous', showAmountPublicly: false })}>
                            اجعلها مجهولة
                          </button>
                          <button type="button" className="tmk-button tmk-button--quiet" disabled={busy === row.id}
                            onClick={() => void setPrivacy(row, { visibility: 'named', showAmountPublicly: !row.showAmountPublicly })}>
                            {row.showAmountPublicly ? 'أخفِ المبلغ' : 'اعرض المبلغ'}
                          </button>
                        </>
                      ) : (
                        <button type="button" className="tmk-button tmk-button--quiet" disabled={busy === row.id}
                          onClick={() => void setPrivacy(row, { visibility: 'named', showAmountPublicly: false })}>
                          اعرض اسمي
                        </button>
                      )}
                    </span>
                  </>
                )
              },
              {
                key: 'payment', header: 'الدفع',
                cell: row => row.intent
                  ? <a href={L(`/payments/${row.intent.id}`)}>{row.state === 'pending' ? 'أكمل أو تحقق' : 'تفاصيل الدفع'}</a>
                  : <span className="tmk-field__hint">—</span>
              }
              ,{
                key: 'refund', header: 'الاسترداد',
                cell: row => ['succeeded', 'partially_refunded'].includes(row.state)
                  ? <button type="button" className="tmk-button tmk-button--quiet" disabled={Boolean(busy)} onClick={() => { setError(''); setNotice(''); setRefundFor(row); }}>طلب استرداد</button>
                  : <span className="tmk-field__hint">—</span>
              }
              ,{
                key: 'receipt', header: 'الإيصال',
                cell: row => ['succeeded', 'partially_refunded', 'refunded'].includes(row.state) ? <DownloadButton endpoint={`/contributions/${row.id}/receipt`} label="نزّل الإيصال" /> : <span className="tmk-field__hint">بعد التأكيد</span>
              }
            ]}
            emptyState={null}
          />
          <p className="tmk-field__hint">
            كل المبالغ أعلاه نتجت عن مسار دفع محاكى في هذه النسخة؛ لم تنتقل أي أموال حقيقية.
          </p>
        </Card>
      )}

      {refundFor ? (() => {
        const remaining = (BigInt(refundFor.amountMinor) - BigInt(refundFor.refundedMinor || '0')).toString();
        return (
          <Card title={`طلب استرداد: ${refundFor.project.title}`} id="refund-request">
            <p className="tmk-field__hint">
              يمكن استرداد حتى <MoneyAmount minor={remaining} currency={refundFor.currency} locale={locale} />. يراجع فريق المالية الطلب قبل تنفيذه، ويُقيَّد الاسترداد بقيد عكسي في الدفتر.
            </p>
            <form onSubmit={event => { event.preventDefault(); void requestRefund(refundFor, new FormData(event.currentTarget)); }}>
              <TextField id="refund-amount" name="amount" label={`المبلغ (${refundFor.currency})`} defaultValue={formatMinorUnits(remaining).replace(/,/g, '')} inputMode="text" required />
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="refund-reason">سبب الطلب</label>
                <span className="tmk-field__hint" id="refund-reason-hint">عشرة أحرف على الأقل. يراه فريق المالية فقط.</span>
                <textarea id="refund-reason" name="reason" className="tmk-field__control" required minLength={10} maxLength={1000} aria-describedby="refund-reason-hint" />
              </div>
              <div className="tmk-row__actions">
                <Button type="submit" variant="primary" busy={busy === `refund-${refundFor.id}`} busyLabel="جارٍ الإرسال…">أرسل الطلب</Button>
                <Button type="button" variant="secondary" onClick={() => setRefundFor(null)}>إلغاء</Button>
              </div>
            </form>
          </Card>
        );
      })() : null}

      <Card title="إجراءات أخرى">
        <ul>
          <li><strong>المستندات:</strong> كشف CSV المؤرخ يشمل السجل كاملًا، ولكل مساهمة مؤكدة إيصال خاص مشتق من تأكيدها غير القابل لإعادة الكتابة.</li>
          <li><strong>طلب استرداد:</strong> من عمود «الاسترداد» في الجدول أعلاه، لأي مساهمة مكتملة لم تُسترد بالكامل.</li>
          <li><strong>مشكلة في الدفع:</strong> <a href={L('/contact')}>افتح تذكرة دعم خاصة</a> مع مرجع المساهمة.</li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// ORG-09 / ORG-10 — the organisation's contributions and ledger
// ---------------------------------------------------------------------------------------------

interface Balances {
  currency: string;
  grossReceivedMinor: string; feesMinor: string; refundedMinor: string;
  netConfirmedMinor: string; availableMinor: string; heldMinor: string;
  inProviderClearingMinor: string; restrictedMinor: string;
}
interface LedgerEntry { account: string; type: string; debitMinor: string; creditMinor: string }
interface LedgerTransaction {
  id: string; sourceType: string; sourceId: string | null; reversalOf: string | null;
  postedAt: string; currency: string; entries: LedgerEntry[];
}
interface Finance {
  hasPool: boolean;
  balances: Balances | null;
  journal: LedgerTransaction[];
  contributors: Array<{ id: string; state: string; amountMinor: string; feeMinor: string; currency: string; anonymous: boolean; confirmedAt: string | null; createdAt: string }>;
}
interface Context { organization: { id: string; displayName: string }; permissions: string[] }
interface Me { contexts: Context[] }

/** Keyed by the ledger account codes in ACCOUNT_CODES; an unmapped code falls back to itself. */
const accountLabels: Record<string, string> = {
  BankCash: 'نقد بنكي',
  ProviderClearing: 'تحت التسوية لدى المزود',
  RestrictedFundsLiability: 'أموال مقيدة بالغرض',
  RefundPayable: 'استرداد مستحق',
  PayoutPayable: 'صرف مستحق',
  ProcessorFeeExpense: 'رسوم معالجة'
};
const transactionLabels: Record<string, string> = {
  'contribution.confirmed': 'تأكيد مساهمة',
  'contribution.settled': 'تسوية مساهمة'
};

export function OrgFinance({ locale, orgId, projectId }: { locale: Locale; orgId: string; projectId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [me, setMe] = useState<Me | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState('');
  const [forbidden, setForbidden] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const current = await api('/me') as Me;
        if (active) setMe(current);
        const loaded = await api(`/orgs/${orgId}/projects/${projectId}/finance`) as Finance;
        if (active) setFinance(loaded);
      } catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setForbidden(true);
        else if (e instanceof Error && e.message.startsWith('لا تملك صلاحية')) setForbidden(true);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل المالية.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [orgId, projectId]);

  const context = me?.contexts.find(item => item.organization.id === orgId);

  const shell = (children: ReactNode) => (
    <AppShell
      locale={locale} path={`/org/${orgId}/projects/${projectId}/finance`} signedIn={Boolean(me)}
      {...(context ? { activeContextName: context.organization.displayName } : {})}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}
    >
      <nav className="tmk-breadcrumbs" aria-label={t('breadcrumb')}>
        <ol>
          <li><a href={L(`/org/${orgId}`)}>{context?.organization.displayName ?? '—'}</a></li>
          <li><a href={L(`/org/${orgId}/projects`)}>المشاريع</a></li>
          <li><a href={L(`/org/${orgId}/projects/${projectId}`)}>المشروع</a></li>
          <li><span aria-current="page">المالية والدفتر</span></li>
        </ol>
      </nav>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (forbidden || !finance) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/projects/${projectId}`)}>العودة للمشروع</a>}>
        قراءة الدفتر تحتاج صلاحية <code>finance.read</code>. هذه الصلاحية منفصلة عن إدارة المشروع
        ولا يحملها المالك تلقائيًا، لأن الفصل بين إدارة المشروع والاطلاع على المال مقصود.
      </ErrorState>
    );
  }

  if (!finance.hasPool || !finance.balances) {
    return shell(
      <>
        <PageHeader dashboard title="المالية والدفتر" lead="لا يوجد وعاء تمويل لهذا المشروع بعد." />
        <EmptyState title="لا يوجد وعاء تمويل">
          يُنشأ وعاء التمويل عند أول مساهمة. لا توجد أرصدة ولا قيود لعرضها، وهذا ليس رصيدًا صفريًا.
        </EmptyState>
      </>
    );
  }

  const b = finance.balances;
  const requestExport = async (kind: 'contributions' | 'ledger') => {
    if (exporting) return;
    setExporting(kind); setError(''); setNotice('');
    try {
      const job = await api(`/orgs/${orgId}/${kind === 'contributions' ? 'contribution-exports' : 'ledger-exports'}`, 'POST', { projectId }) as { id: string };
      window.location.assign(L(`/app/exports/${job.id}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إنشاء التصدير.'); }
    finally { setExporting(''); }
  };

  return shell(
    <>
      <PageHeader
        dashboard
        title="المالية والدفتر"
        lead="كل رقم هنا مشتق من قيود الدفتر عند كل قراءة. لا يوجد رصيد مخزَّن يمكن أن يختلف عن القيود."
        actions={context?.permissions.includes('finance.export') ? <><button type="button" className="tmk-button tmk-button--secondary" disabled={Boolean(exporting)} onClick={() => void requestExport('contributions')}>صدّر المساهمات</button><button type="button" className="tmk-button tmk-button--secondary" disabled={Boolean(exporting)} onClick={() => void requestExport('ledger')}>صدّر الدفتر</button></> : undefined}
      />

      <Notice tone="warning" title="بيئة عرض — لا أموال حقيقية">
        <p style={{ marginBlockEnd: 0 }}>
          نتجت كل القيود أدناه عن مسار دفع محاكى. لا يوجد مزود دفع ولا حساب بنكي حقيقي في هذه النسخة.
        </p>
      </Notice>

      {/* ORG-10. Confirmed funding and available cash are deliberately two different numbers. */}
      <Card title={`الأرصدة — ${b.currency}`}>
        <div className="tmk-grid tmk-grid--stats">
          <Stat label="التمويل المؤكد" value={<MoneyAmount minor={b.netConfirmedMinor} currency={b.currency} locale={locale} />} note="مقبوض مؤكد ناقص استرداد مؤكد" />
          <Stat label="المتاح للصرف" value={<MoneyAmount minor={b.availableMinor} currency={b.currency} locale={locale} />} note="نقد مسوّى ناقص الحجوزات — لا يساوي التمويل المؤكد" />
          <Stat label="تحت التسوية" value={<MoneyAmount minor={b.inProviderClearingMinor} currency={b.currency} locale={locale} />} note="أكّده المزود ولم يصل الحساب البنكي بعد" />
          <Stat label="محجوز" value={<MoneyAmount minor={b.heldMinor} currency={b.currency} locale={locale} />} note="صرف معتمد لم يُنفَّذ" />
          <Stat label="إجمالي المقبوض" value={<MoneyAmount minor={b.grossReceivedMinor} currency={b.currency} locale={locale} />} note="قبل الرسوم والاسترداد" />
          <Stat label="رسوم المعالجة" value={<MoneyAmount minor={b.feesMinor} currency={b.currency} locale={locale} />} note="جدول رسوم محاكى" />
          <Stat label="المسترد" value={<MoneyAmount minor={b.refundedMinor} currency={b.currency} locale={locale} />} note="استرداد مؤكد" />
          <Stat label="مقيّد بالغرض" value={<MoneyAmount minor={b.restrictedMinor} currency={b.currency} locale={locale} />} note="التزام تجاه غرض المشروع، وليس إيرادًا" />
        </div>
      </Card>

      {/* ORG-09. Amounts to reconcile, without identities: reaching one needs a separate permission. */}
      <Card title="المساهمات">
        <p className="tmk-field__hint">
          هذه قائمة تشغيلية للمطابقة. لا تحتوي هوية أي مساهم — لا اسمًا ولا بريدًا — حتى لمن اختار
          الظهور العام، لأن كشف الهوية إجراء منفصل ومدقَّق.
        </p>
        <DataTable
          caption="مساهمات هذا المشروع، أحدثها أولًا"
          rows={finance.contributors}
          rowKey={row => row.id}
          columns={[
            { key: 'ref', header: 'المرجع', cell: row => <Ltr><code>{row.id.slice(0, 8)}</code></Ltr> },
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} /> },
            { key: 'fee', header: 'الرسوم', numeric: true, cell: row => <MoneyAmount minor={row.feeMinor} currency={row.currency} locale={locale} /> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={contributionStates[row.state]?.tone ?? 'neutral'}>{contributionStates[row.state]?.text ?? row.state}</StatusBadge> },
            { key: 'public', header: 'الظهور العام', cell: row => row.anonymous ? 'مجهول' : 'معلن' },
            { key: 'date', header: 'التاريخ', cell: row => formatDate(row.confirmedAt ?? row.createdAt, locale) }
          ]}
          emptyState={<EmptyState title="لا مساهمات بعد">لم تُسجَّل أي مساهمة لهذا المشروع حتى الآن.</EmptyState>}
        />
      </Card>

      {/* ORG-10.A01. Append-only: a correction is a reversal, never an edit. */}
      <Card title="الدفتر">
        <p className="tmk-field__hint">
          قيد مزدوج: مجموع المدين يساوي مجموع الدائن في كل معاملة، وتفرض قاعدة البيانات ذلك.
          لا يُعدَّل قيد ولا يُحذف؛ التصحيح يكون بقيد عكسي مرتبط بالأصل.
        </p>
        {finance.journal.length === 0 ? (
          <EmptyState title="لا قيود بعد">يُسجَّل أول قيد عند أول دفعة مؤكدة.</EmptyState>
        ) : (
          finance.journal.map(transaction => (
            <article key={transaction.id} className="tmk-row" style={{ display: 'block' }}>
              <p>
                <strong>{transactionLabels[transaction.sourceType] ?? transaction.sourceType}</strong>{' · '}
                {formatDate(transaction.postedAt, locale, true)}
                {transaction.reversalOf ? <> {' · '}<StatusBadge tone="warning">قيد عكسي</StatusBadge></> : null}
              </p>
              <DataTable
                caption={`قيود المعاملة ${transaction.id.slice(0, 8)}`}
                rows={transaction.entries}
                rowKey={entry => `${transaction.id}-${entry.account}-${entry.debitMinor}-${entry.creditMinor}`}
                columns={[
                  { key: 'account', header: 'الحساب', cell: entry => accountLabels[entry.account] ? <>{accountLabels[entry.account]} <span className="tmk-field__hint"><Ltr>{entry.account}</Ltr></span></> : <Ltr>{entry.account}</Ltr> },
                  { key: 'debit', header: 'مدين', numeric: true, cell: entry => entry.debitMinor === '0' ? '—' : <MoneyAmount minor={entry.debitMinor} currency={transaction.currency} locale={locale} /> },
                  { key: 'credit', header: 'دائن', numeric: true, cell: entry => entry.creditMinor === '0' ? '—' : <MoneyAmount minor={entry.creditMinor} currency={transaction.currency} locale={locale} /> }
                ]}
                emptyState={null}
              />
            </article>
          ))
        )}
      </Card>

      <Card title="إجراءات أخرى">
        <ul>
          <li><strong>التصدير المنقح وكشف الدفتر:</strong> الزران أعلاه ينشئان لقطتين مؤرختين تنتهيان بعد 24 ساعة. تصدير المساهمات لا يحتوي اسمًا أو بريدًا لأي مساهم.</li>
          <li><strong>كشف هوية مساهم مجهول:</strong> غير متاح بعد. سيحتاج صلاحية خاصة وسببًا مسجَّلًا يخضع للتدقيق.</li>
          <li><strong>طلب صرف:</strong> من صفحة «الصرف» في مساحة الجهة، ويمر بفصل ثلاثي للصلاحيات قبل التنفيذ.</li>
        </ul>
      </Card>
    </>
  );
}
