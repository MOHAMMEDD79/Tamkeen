'use client';

import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  AppShell, Card, DataTable, EmptyState, ErrorState, Ltr, MoneyAmount, Notice, PageHeader,
  Skeleton, Stat, StatusBadge, formatDate, formatMinorUnits, localePath, translator, type Locale
} from '@tamkeen/ui';
import { pathSegment } from '../../lib/path-segment';
import './workspace.css';
import { DownloadButton } from './download-button';

/**
 * PART-09 screens: PER-06 the portfolio, PER-08 subscribing, PER-09 one investment in full,
 * BUS-04 closing and allocating, BUS-05 investor relations.
 *
 * The one thing every screen here must get right, because getting it wrong is a lie about
 * somebody's money:
 *
 *  - **A reservation is not a contract, a contract is not a payment, and a payment is not a
 *    holding.** They are four different things and they are never shown in the same list. The
 *    portfolio has a holdings table and, separately, an "on its way" table.
 *  - **No valuation, anywhere.** Cost basis and distributions received are facts. A current value
 *    is not, and there is no source for one, so the screen says that in words rather than leaving
 *    an absent number to be read as zero.
 *  - **Simulated is said, not implied.** Nothing in this build issues a legal share, and every
 *    screen that shows a holding or an allocation says so where it is read, not in a footnote.
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

function message(code: string | undefined, status: number): string {
  const messages: Record<string, string> = {
    forbidden: 'لا تملك صلاحية هذا الإجراء، أو انتهت صلاحية أهليتك للاستثمار.',
    not_found: 'المورد غير موجود ضمن نطاقك.',
    conflict: 'تغيّرت الحالة: قد يكون الإفصاح صدر بنسخة جديدة، أو انتهى الحجز، أو نفدت السعة، أو النسخة التي بين يديك قديمة. أعد التحميل واقرأ ما تغيّر قبل المتابعة.',
    invalid_input: 'تحقق من الحقول: المبلغ عدد صحيح موجب، والإقرار بالمخاطر مطلوب.'
  };
  return messages[code ?? ''] ?? `تعذر إكمال العملية (${status}).`;
}

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const commitmentStates: Record<string, { text: string; tone: Tone }> = {
  reserved: { text: 'سعة محجوزة', tone: 'info' },
  confirmed: { text: 'عقد مؤكَّد — لم يُدفع', tone: 'warning' },
  paying: { text: 'الدفع جارٍ', tone: 'warning' },
  paid: { text: 'مدفوع — بانتظار التخصيص', tone: 'info' },
  allocated: { text: 'مُخصَّص', tone: 'success' },
  refunding: { text: 'قيد الاسترداد', tone: 'warning' },
  refunded: { text: 'مسترد', tone: 'neutral' },
  cancelled: { text: 'ملغى', tone: 'neutral' },
  expired: { text: 'انتهى الحجز', tone: 'neutral' },
  failed: { text: 'فشل', tone: 'danger' }
};

const distributionStates: Record<string, { text: string; tone: Tone }> = {
  requested: { text: 'مقترح', tone: 'warning' },
  approved: { text: 'معتمد', tone: 'info' },
  paid: { text: 'مسجَّل كمدفوع', tone: 'success' },
  rejected: { text: 'مرفوض', tone: 'danger' }
};

const eventKinds: Record<string, string> = {
  report: 'تقرير', distribution: 'توزيع', buyback: 'إعادة شراء',
  exit: 'خروج', loss: 'خسارة', liquidation: 'تصفية'
};

/** Why an offering will not accept a commitment. Machine codes from the server, worded here. */
const closedReasons: Record<string, string> = {
  disclosure_revised: 'صدر إفصاح جديد وأُوقف العرض حتى يُتعامل مع الالتزامات على النسخة السابقة.',
  closing: 'أُغلق باب الاكتتاب وبدأت مرحلة التخصيص.',
  round_ended: 'انتهت هذه الجولة.',
  not_open: 'لم يُفتح هذا العرض للاكتتاب بعد.',
  no_disclosure: 'لا يوجد إفصاح منشور، ولا التزام دون نص يُلتزم به.',
  closing_date_passed: 'مضى تاريخ الإغلاق المعلن.'
};
const closedReason = (code: string) => closedReasons[code] ?? `الاكتتاب غير متاح (${code}).`;

const toMinor = (major: string) => {
  const cleaned = major.trim().replace(/,/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) throw new Error('أدخل مبلغًا صحيحًا مثل 1000 أو 1000.50.');
  const [whole = '0', fraction = ''] = cleaned.split('.');
  const minor = `${whole}${fraction.padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  if (minor === '0') throw new Error('المبلغ يجب أن يكون أكبر من صفر.');
  return minor;
};

/** Every screen here repeats this, because a reader arrives at each one separately. */
function SimulatedNotice({ children }: { children?: ReactNode }) {
  return (
    <Notice tone="info" title="بيئة تجريبية">
      <p style={{ marginBlockEnd: 0 }}>
        {children ?? 'لا يصدر عن هذه النسخة سجل مساهمين قانوني ولا ملكية فعلية، ولا يوجد تداول ثانوي. كل حصة وكل إثبات هنا محاكاة معلَّمة بذلك.'}
      </p>
    </Notice>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-06 — the portfolio
// ---------------------------------------------------------------------------------------------

interface Holding {
  id: string;
  allocationId: string;
  venture: { id: string; legalName: string; organizationId: string };
  units: string; costMinor: string; distributionsReceivedMinor: string; currency: string;
  proofReference: string; allocatedAt: string; simulated: boolean;
}
interface InFlight {
  id: string; offering: { slug: string; title: string }; state: string;
  amountMinor: string; units: string; currency: string; expiresAt: string;
}
interface PortfolioData {
  holdings: Holding[]; inFlight: InFlight[];
  valuationAvailable: boolean; valuationUnavailableReason: string; simulated: boolean;
}

export function MyInvestments({ locale }: { locale: Locale }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [data, setData] = useState<PortfolioData | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try { const result = await api('/me/investments') as PortfolioData; if (active) setData(result); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل المحفظة.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, []);

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path="/app/investments" signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app')}>{t('personalWorkspace')}</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={5} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L('/app/investments'))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }

  // Summed as BigInt, never as a number: these are minor units and a float would quietly lose the
  // last digits of a large total. The literal form is avoided because the web target predates it.
  const sumMinor = (values: string[]) => values.reduce((total, value) => total + BigInt(value), BigInt(0)).toString();
  const totalCost = sumMinor((data?.holdings ?? []).map(holding => holding.costMinor));
  const totalReceived = sumMinor((data?.holdings ?? []).map(holding => holding.distributionsReceivedMinor));
  const currency = data?.holdings[0]?.currency ?? data?.inFlight[0]?.currency ?? 'ILS';
  const requestStatement = async () => {
    if (exporting) return;
    setExporting(true); setError('');
    try {
      const job = await api('/me/investment-exports', 'POST') as { id: string };
      window.location.assign(L(`/app/exports/${job.id}`));
    } catch (e) { setError(e instanceof Error ? e.message : 'تعذر إنشاء البيان.'); }
    finally { setExporting(false); }
  };

  return shell(
    <>
      <PageHeader
        dashboard
        title="محفظة الاستثمار"
        lead="حصصك المثبتة أولًا، ثم ما هو في الطريق. الاثنان ليسا شيئًا واحدًا: الالتزام يحجز سعة، والحصة لا تنشأ إلا من تخصيص مثبت."
        actions={<button type="button" className="tmk-button tmk-button--secondary" disabled={exporting} onClick={() => void requestStatement()}>أنشئ بيان CSV</button>}
      />

      <SimulatedNotice />

      {/* 06 forbids presenting a subscription price as a current value. The absence is stated. */}
      <Notice tone="warning" title="لا تقييم سوقي">
        <p style={{ marginBlockEnd: 0 }}>
          ما تراه أدناه هو <strong>الكلفة المدفوعة</strong> و<strong>التوزيعات المستلمة فعلًا</strong>. لا توجد جهة تقييم ولا سوق ثانوي
          لهذه الأسهم، فلا نعرض «قيمة حالية» ولا «عائدًا» — ليس لأن الرقم صفر، بل لأنه غير موجود.
        </p>
      </Notice>

      <div className="tmk-grid tmk-grid--stats">
        <Stat label="عدد الشركات" value={String(new Set((data?.holdings ?? []).map(holding => holding.venture.id)).size)} />
        <Stat label="إجمالي الكلفة" value={<MoneyAmount minor={totalCost} currency={currency} locale={locale} />} note="ما دفعته، لا ما تساويه." />
        <Stat label="التوزيعات المستلمة" value={<MoneyAmount minor={totalReceived} currency={currency} locale={locale} />} note="ما سُجِّل كمدفوع فقط." />
      </div>

      <Card title="الحصص المثبتة">
        <DataTable
          caption="حصصك، وكل واحدة منها ناتجة عن تخصيص مثبت"
          rows={data?.holdings ?? []}
          rowKey={holding => holding.id}
          emptyState={
            <EmptyState title="لا حصص بعد" action={<a className="tmk-button tmk-button--primary" href={L('/invest')}>استكشف العروض</a>}>
              لا تنشأ حصة عن التزام ولا عن دفعة، بل عن تخصيص مثبت بعد إغلاق الجولة. إن كان لديك التزام جارٍ فستجده في الجدول التالي.
            </EmptyState>
          }
          columns={[
            { key: 'venture', header: 'الشركة', cell: holding => holding.venture.legalName },
            { key: 'units', header: 'الأسهم', numeric: true, cell: holding => <Ltr>{holding.units}</Ltr> },
            { key: 'cost', header: 'الكلفة', numeric: true, cell: holding => <MoneyAmount minor={holding.costMinor} currency={holding.currency} locale={locale} /> },
            { key: 'distributions', header: 'توزيعات مستلمة', numeric: true, cell: holding => <MoneyAmount minor={holding.distributionsReceivedMinor} currency={holding.currency} locale={locale} /> },
            { key: 'allocatedAt', header: 'تاريخ التخصيص', cell: holding => formatDate(holding.allocatedAt, locale) },
            {
              key: 'proof', header: 'إثبات التخصيص',
              cell: holding => (
                <>
                  <code><Ltr>{holding.proofReference}</Ltr></code>
                  {holding.simulated ? <span className="tmk-field__hint">مرجع محاكاة، لا سجل مساهمين.</span> : null}
                  <DownloadButton endpoint={`/allocations/${holding.allocationId}/proof`} label="نزّل الإثبات" />
                </>
              )
            }
          ]}
        />
      </Card>

      <Card title="في الطريق">
        <p className="tmk-field__hint">
          هذه ليست حصصًا. الالتزام يحجز سعة لمدة محدودة، والعقد يثبت النص المتفق عليه، والدفع يسوّي المال — ولا شيء من ذلك يصدر سهمًا.
        </p>
        <DataTable
          caption="التزاماتك الجارية"
          rows={data?.inFlight ?? []}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا التزامات جارية">ليس لديك حجز أو عقد قيد التنفيذ الآن.</EmptyState>}
          columns={[
            { key: 'offering', header: 'العرض', cell: row => <a href={L(`/invest/${row.offering.slug}`)}>{row.offering.title}</a> },
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} /> },
            { key: 'units', header: 'الأسهم المحجوزة', numeric: true, cell: row => <Ltr>{row.units}</Ltr> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={commitmentStates[row.state]?.tone ?? 'neutral'}>{commitmentStates[row.state]?.text ?? row.state}</StatusBadge> },
            { key: 'expires', header: 'ينتهي الحجز', cell: row => formatDate(row.expiresAt, locale, true) },
            { key: 'open', header: '', cell: row => <a href={L(`/app/investments/${row.id}`)}>افتح</a> }
          ]}
        />
      </Card>

      <Card title="تنزيل بيان">
        <Notice tone="info" title="نسخة خاصة مؤقتة">
          <p style={{ marginBlockEnd: 0 }}>
            ينشئ الزر أعلاه لقطة CSV مؤرخة من التزاماتك وتخصيصاتك المثبتة فقط. يعاد فحص ملكيتك عند كل تنزيل وتنتهي النسخة بعد 24 ساعة.
          </p>
        </Notice>
      </Card>

      <p className="tmk-row__actions">
        <a className="tmk-button tmk-button--secondary" href={L('/invest')}>استكشف عروضًا</a>
        <a className="tmk-button tmk-button--quiet" href={L('/app/investor/eligibility')}>ملف الأهلية</a>
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-09 — one investment in full
// ---------------------------------------------------------------------------------------------

interface CommitmentDetail {
  id: string; state: string; amountMinor: string; requestedMinor: string; remainderMinor: string;
  units: string; currency: string; disclosureId: string; expiresAt: string; cancelledReason: string;
  version: number; createdAt: string; simulated: boolean;
  offering: { id: string; slug: string; title: string; state: string; ventureId: string; organization: { displayName: string; slug: string } };
  agreedDisclosure: { id: string; sequence: number; summary: string; risks: string; useOfFunds: string; checksum: string };
  currentDisclosure: { id: string; sequence: number; checksum: string } | null;
  subscription: { id: string; contractChecksum: string; disclosureChecksum: string; confirmedAt: string; signatureIsSimulated: boolean } | null;
  payment: { id: string; state: string; settled: boolean; settledAt: string | null; feeMinor: string | null } | null;
  allocation: { id: string; units: string; costMinor: string; proofReference: string; finalisedAt: string; simulated: boolean } | null;
  holding: { id: string; units: string; simulated: boolean } | null;
  disclosureSuperseded: boolean;
}

export function InvestmentDetail({ locale, commitmentId }: { locale: Locale; commitmentId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [row, setRow] = useState<CommitmentDetail | null>(null);
  const [relations, setRelations] = useState<InvestorRelationsData | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const detail = await api(`/me/commitments/${commitmentId}`) as CommitmentDetail;
    setRow(detail);
    return detail;
  }, [commitmentId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const detail = await load();
        if (!active) return;
        // Investor relations exist only once something was actually allocated, so it is read
        // separately and its absence is not an error.
        if (detail.allocation) {
          try {
            const venture = await api(`/ventures/${detail.offering.ventureId}/investor-relations`) as InvestorRelationsData;
            if (active) setRelations(venture);
          } catch { /* absent for this holder; the section simply does not render */ }
        }
      } catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل الاستثمار.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const ask = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !row) return;
    const form = event.currentTarget;
    const body = String(new FormData(form).get('body') ?? '');
    setBusy(true); setError(''); setNotice('');
    try {
      await api(`/offerings/${row.offering.id}/questions`, 'POST', { body });
      form.reset();
      setNotice('أُرسل سؤالك إلى الجهة المصدرة. الجواب يصلك وحدك ولا يُنشر.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إرسال السؤال.');
    } finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path="/app/investments" signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app/investments')}>المحفظة</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/app/investments/${commitmentId}`))}`}>{t('signIn')}</a>}>
        {t('forbiddenBody')}
      </ErrorState>
    );
  }
  if (!row) return shell(<ErrorState title="غير موجود">هذا الاستثمار غير موجود ضمن سجلك.</ErrorState>);

  return shell(
    <>
      <PageHeader
        dashboard
        eyebrow={row.offering.organization.displayName}
        title={row.offering.title}
        lead="كل خطوة على حدة: الحجز، والعقد، والدفع، والتخصيص. لا تُطوى واحدة في الأخرى."
      />

      <p className="tmk-row__actions">
        <StatusBadge tone={commitmentStates[row.state]?.tone ?? 'neutral'}>{commitmentStates[row.state]?.text ?? row.state}</StatusBadge>
        {row.simulated ? <StatusBadge tone="info">محاكاة</StatusBadge> : null}
      </p>

      {row.disclosureSuperseded ? (
        <Notice tone="warning" title="الإفصاح تغيّر بعد التزامك">
          <p style={{ marginBlockEnd: 0 }}>
            التزامك سُجِّل على نسخة إفصاح لم تعد هي النسخة السارية. لا يمكن إكمال التعاقد أو الدفع على نص لم تقرأه؛
            اقرأ النسخة الجديدة من صفحة العرض، ثم ابدأ التزامًا جديدًا إن أردت المتابعة.
          </p>
        </Notice>
      ) : null}

      <div className="tmk-grid tmk-grid--stats">
        <Stat label="المبلغ" value={<MoneyAmount minor={row.amountMinor} currency={row.currency} locale={locale} />} note={row.remainderMinor !== '0' ? `تبقّى ${formatMinorUnits(row.remainderMinor)} لم يشترِ سهمًا كاملًا.` : undefined} />
        <Stat label="الأسهم" value={<Ltr>{row.units}</Ltr>} note="لا أسهم كسرية في هذه النسخة." />
        <Stat label="ينتهي الحجز" value={formatDate(row.expiresAt, locale, true)} note="بعد هذا الوقت تتحرر السعة لغيرك." />
      </div>

      <Card title="ما الذي تم فعلًا">
        <ol className="tmk-timeline" aria-label="مراحل هذا الاستثمار">
          <li className="tmk-timeline__item">
            <span className="tmk-timeline__marker tmk-timeline__marker--done" aria-hidden="true" />
            <div>
              <strong>حجز سعة</strong>
              <p className="tmk-timeline__meta">{formatDate(row.createdAt, locale, true)} — حجز، لا شراء.</p>
            </div>
          </li>
          <li className="tmk-timeline__item">
            <span className={`tmk-timeline__marker${row.subscription ? ' tmk-timeline__marker--done' : ''}`} aria-hidden="true" />
            <div>
              <strong>عقد الاكتتاب</strong>
              {row.subscription ? (
                <>
                  <p className="tmk-timeline__meta">{formatDate(row.subscription.confirmedAt, locale, true)}</p>
                  <p className="tmk-field__hint">
                    بصمة النص المتفق عليه: <code><Ltr>{row.subscription.disclosureChecksum.slice(0, 16)}…</Ltr></code>
                  </p>
                  {row.subscription.signatureIsSimulated ? (
                    <p className="tmk-field__hint">التوقيع هنا نقرة في بيئة تجريبية، وليس توقيعًا قانونيًا.</p>
                  ) : null}
                </>
              ) : <p className="tmk-timeline__meta">لم يُوقَّع بعد.</p>}
            </div>
          </li>
          <li className="tmk-timeline__item">
            <span className={`tmk-timeline__marker${row.payment?.settled ? ' tmk-timeline__marker--done' : row.payment ? ' tmk-timeline__marker--active' : ''}`} aria-hidden="true" />
            <div>
              <strong>الدفع والتسوية</strong>
              {row.payment ? (
                <p className="tmk-timeline__meta">
                  {row.payment.settledAt ? `سُوِّي في ${formatDate(row.payment.settledAt, locale, true)}` : 'الدفع لم يُسوَّ بعد.'}
                  {' '}<a href={L(`/payments/${row.payment.id}`)}>تفاصيل الدفع</a>
                </p>
              ) : <p className="tmk-timeline__meta">لم يبدأ الدفع.</p>}
              <p className="tmk-field__hint">المال محفوظ في حساب ضمان خاص بهذا العرض، ولا يُصرف قبل نتيجة الجولة.</p>
            </div>
          </li>
          <li className="tmk-timeline__item">
            <span className={`tmk-timeline__marker${row.allocation ? ' tmk-timeline__marker--done' : ''}`} aria-hidden="true" />
            <div>
              <strong>التخصيص</strong>
              {row.allocation ? (
                <>
                  <p className="tmk-timeline__meta">{formatDate(row.allocation.finalisedAt, locale, true)} — <Ltr>{row.allocation.units}</Ltr> سهمًا.</p>
                  <p className="tmk-field__hint">
                    مرجع الإثبات: <code><Ltr>{row.allocation.proofReference}</Ltr></code>
                  </p>
                </>
              ) : <p className="tmk-timeline__meta">لم يُخصَّص بعد. لا تملك حصة قبل هذه الخطوة.</p>}
            </div>
          </li>
        </ol>
      </Card>

      <Card title={`الإفصاح الذي التزمت عليه — النسخة ${row.agreedDisclosure.sequence}`}>
        <p className="tmk-field__hint">
          هذا هو النص كما كان عند التزامك، لا كما هو الآن. بصمته: <code><Ltr>{row.agreedDisclosure.checksum.slice(0, 16)}…</Ltr></code>
          {row.currentDisclosure && row.currentDisclosure.id !== row.agreedDisclosure.id
            ? ` — النسخة السارية الآن هي ${row.currentDisclosure.sequence}.`
            : ''}
        </p>
        <div className="tmk-prose">
          <p>{row.agreedDisclosure.summary}</p>
          <h3>المخاطر</h3>
          <p>{row.agreedDisclosure.risks}</p>
          <h3>أوجه استخدام التمويل</h3>
          <p>{row.agreedDisclosure.useOfFunds}</p>
        </div>
      </Card>

      {/* PER-09.A04. A question reaches the issuer privately; it is never a broadcast. */}
      <Card title="اطرح سؤالًا على الجهة المصدرة">
        <form onSubmit={event => void ask(event)}>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="investor-question">سؤالك</label>
            <span className="tmk-field__hint" id="investor-question-hint">يصل إلى الجهة المصدرة وحدها، والجواب يصلك وحدك.</span>
            <textarea id="investor-question" name="body" className="tmk-field__control" rows={4} minLength={10} maxLength={4000} required aria-describedby="investor-question-hint" />
          </div>
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>أرسل السؤال</button>
        </form>
      </Card>

      {relations ? <InvestorRelationsPanel data={relations} locale={locale} /> : null}

      {/* Data-room files still await the classified document store; disputes use support. */}
      <Card title="ما لا تستطيع هذه الصفحة فعله بعد">
        <ul>
          <li>
            <strong>فتح مستندات غرفة البيانات.</strong> التنزيل المدقق غير مبني؛ العناوين والتصنيفات تظهر في صفحة العرض.
          </li>
          <li><strong>الاعتراض على بيان.</strong> <a href={L('/contact')}>افتح تذكرة دعم خاصة</a> مع مرجع التخصيص؛ التذكرة لا تعدّل الملكية أو التسوية تلقائيًا.</li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// PER-08 — subscribing
// ---------------------------------------------------------------------------------------------

interface PublicOffering {
  id: string; slug: string; title: string; currency: string; state: string;
  pricePerShareMinor: string; minimumTicketMinor: string; maximumTicketMinor: string | null;
  organization: { displayName: string; slug: string };
  disclosure: { id: string; sequence: number; summary: string; risks: string; useOfFunds: string; checksum: string } | null;
  acceptsCommitments: boolean; commitmentsUnavailableReason: string;
  requiresEligibility: boolean;
}
interface Capacity {
  sharesOffered: string; remainingUnits: string; committedUnits: string; committedMinor: string;
  minimumRaiseMinor: string; minimumReached: boolean;
}
interface Quote {
  currency: string; requestedMinor: string; amountMinor: string; remainderMinor: string; units: string;
  percentOfPostRaise: string; percentOfOffering: string;
  belowMinimumTicket: boolean; aboveMaximumTicket: boolean; indicative: boolean;
}
interface CommitmentView {
  id: string; state: string; amountMinor: string; remainderMinor: string; units: string;
  currency: string; expiresAt: string; version: number; percentOfPostRaise?: string;
}

export function Subscribe({ locale, slug }: { locale: Locale; slug: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [offering, setOffering] = useState<PublicOffering | null>(null);
  const [capacity, setCapacity] = useState<Capacity | null>(null);
  const [eligible, setEligible] = useState<{ eligible: boolean; state: string; expiresAt: string | null } | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [commitment, setCommitment] = useState<CommitmentView | null>(null);
  const [payment, setPayment] = useState<{ paymentIntentId: string; providerRedirectPath: string } | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Next hands a route parameter still percent-encoded, so `encodeURIComponent` here would encode
  // it twice and the API would answer 404 for an Arabic slug. `pathSegment` normalises either form.
  const path = pathSegment(slug);

  const refresh = useCallback(async () => {
    const detail = await api(`/offerings/${path}`) as PublicOffering;
    setOffering(detail);
    setCapacity(await api(`/offerings/${detail.id}/capacity`) as Capacity);
    return detail;
  }, [path]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await refresh();
        const mine = await api('/me/investor-eligibility') as { eligible: boolean; state: string; expiresAt: string | null };
        if (active) setEligible(mine);
      } catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل العرض.');
      } finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [refresh]);

  /** PUB-08. The maths before any decision. It commits to nothing and reserves nothing. */
  const priceIt = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const minor = toMinor(String(new FormData(event.currentTarget).get('amount') ?? ''));
      setQuote(await api(`/offerings/${path}/quote?amountMinor=${minor}`) as Quote);
    } catch (e) {
      setQuote(null);
      setError(e instanceof Error ? e.message : 'تعذر حساب الاكتتاب.');
    } finally { setBusy(false); }
  };

  /** PER-08.A01. */
  const reserve = async () => {
    if (busy || !offering || !quote) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const created = await api(`/offerings/${offering.id}/commitments`, 'POST', { amountMinor: quote.requestedMinor }) as CommitmentView;
      setCommitment(created);
      setNotice('حُجزت السعة. الحجز مؤقت: إن لم تُكمل قبل انتهائه تتحرر السعة لغيرك، ولا يُخصم منك شيء.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر حجز السعة.');
    } finally { setBusy(false); }
  };

  /** PER-08.A02. The contract names the exact disclosure version, by checksum. */
  const confirm = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !commitment || !offering?.disclosure) return;
    const acknowledged = new FormData(event.currentTarget).get('risk') === 'on';
    if (!acknowledged) { setError('الإقرار بإمكان خسارة كامل المبلغ شرط للتعاقد، وليس خيارًا.'); return; }
    setBusy(true); setError(''); setNotice('');
    try {
      const result = await api(`/commitments/${commitment.id}/confirm`, 'POST', {
        disclosureChecksum: offering.disclosure.checksum,
        acknowledgedRisk: true,
        version: commitment.version
      }) as { commitment: CommitmentView };
      setCommitment(result.commitment);
      setNotice('وُقِّع العقد على نسخة الإفصاح المعروضة. لم يُدفع شيء بعد.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر تأكيد العقد.');
    } finally { setBusy(false); }
  };

  /** PER-08.A03. */
  const pay = async () => {
    if (busy || !commitment) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const intent = await api(`/commitments/${commitment.id}/payment-intents`, 'POST') as { paymentIntentId: string; providerRedirectPath: string };
      setPayment(intent);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر فتح عملية الدفع.');
    } finally { setBusy(false); }
  };

  /** PER-08.A04. Frees the capacity and keeps the record of what happened. */
  const cancel = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy || !commitment) return;
    const reason = String(new FormData(event.currentTarget).get('reason') ?? '');
    setBusy(true); setError(''); setNotice('');
    try {
      const updated = await api(`/commitments/${commitment.id}/cancel`, 'POST', { reason, version: commitment.version }) as CommitmentView;
      setCommitment(updated);
      setNotice('أُلغي الالتزام وتحررت السعة. يبقى أثر ما حدث في سجلك.');
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'تعذر إلغاء الالتزام.');
    } finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/invest/${slug}`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L('/app/investments')}>المحفظة</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(
      <ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={`${L('/login')}?returnTo=${encodeURIComponent(L(`/invest/${slug}/subscribe`))}`}>{t('signIn')}</a>}>
        الاكتتاب يحتاج حسابًا، لأن العقد يُنسب إلى شخص بعينه.
      </ErrorState>
    );
  }
  if (!offering) return shell(<ErrorState title="غير موجود">هذا العرض غير متاح.</ErrorState>);

  const stage = !commitment ? 'quote'
    : commitment.state === 'reserved' ? 'confirm'
    : commitment.state === 'confirmed' ? 'pay'
    : 'done';

  return shell(
    <>
      <nav className="tmk-breadcrumbs" aria-label="مسار التصفح">
        <ol>
          <li><a href={L('/invest')}>الاستثمار</a></li>
          <li><a href={L(`/invest/${slug}`)}>{offering.title}</a></li>
          <li><span aria-current="page">الاكتتاب</span></li>
        </ol>
      </nav>

      <PageHeader
        eyebrow={offering.organization.displayName}
        title={`الاكتتاب في ${offering.title}`}
        lead="ثلاث خطوات منفصلة: احجز سعة، ثم وقّع العقد على نسخة الإفصاح هذه، ثم ادفع. لا تملك حصة إلا بعد تخصيص مثبت بعد إغلاق الجولة."
      />

      <SimulatedNotice />

      {!offering.acceptsCommitments ? (
        <Notice tone="warning" title="الاكتتاب مغلق الآن">
          <p style={{ marginBlockEnd: 0 }}>{closedReason(offering.commitmentsUnavailableReason)}</p>
        </Notice>
      ) : null}

      {offering.requiresEligibility && eligible && !eligible.eligible ? (
        <Notice tone="warning" title="أهليتك غير سارية">
          <p>
            {eligible.state === 'expired'
              ? 'انتهت صلاحية قرار أهليتك. الأهلية قرار مراجعة بمدة، وتجديدها مراجعة جديدة.'
              : 'لم يصدر قرار أهلية ساري المفعول لك بعد. اختيارك لقدرة «مستثمر» في ملفك ليس أهلية.'}
          </p>
          <p style={{ marginBlockEnd: 0 }}>
            <a className="tmk-button tmk-button--primary" href={L('/app/investor/eligibility')}>افتح ملف الأهلية</a>
          </p>
        </Notice>
      ) : null}

      {capacity ? (
        <div className="tmk-grid tmk-grid--stats">
          <Stat label="الأسهم المتبقية" value={<Ltr>{capacity.remainingUnits}</Ltr>} note={`من أصل ${capacity.sharesOffered}`} />
          <Stat label="المجموع الملتزم به" value={<MoneyAmount minor={capacity.committedMinor} currency={offering.currency} locale={locale} />} />
          <Stat
            label="الحد الأدنى للجولة"
            value={<MoneyAmount minor={capacity.minimumRaiseMinor} currency={offering.currency} locale={locale} />}
            note={capacity.minimumReached ? 'بلغته الجولة حتى الآن.' : 'لم يُبلغ بعد: إن لم يُبلغ، يُعاد المال.'}
          />
        </div>
      ) : null}

      {stage === 'quote' ? (
        <>
          <Card title="١ — احسب ما يشتريه مبلغك">
            <form onSubmit={event => void priceIt(event)}>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="subscribe-amount">المبلغ ({offering.currency})</label>
                <span className="tmk-field__hint" id="subscribe-amount-hint">
                  الحد الأدنى {formatMinorUnits(offering.minimumTicketMinor)}. لا أسهم كسرية: ما لا يشتري سهمًا كاملًا يُعاد إليك ولا يُحتجز.
                </span>
                <input id="subscribe-amount" name="amount" className="tmk-field__control" inputMode="decimal" required aria-describedby="subscribe-amount-hint" />
              </div>
              <button type="submit" className="tmk-button tmk-button--secondary" disabled={busy}>احسب</button>
            </form>

            {quote ? (
              <>
                <div className="tmk-grid tmk-grid--stats" style={{ marginBlockStart: 'var(--tmk-space-16)' }}>
                  <Stat label="الأسهم" value={<Ltr>{quote.units}</Ltr>} />
                  <Stat label="المبلغ الفعلي" value={<MoneyAmount minor={quote.amountMinor} currency={quote.currency} locale={locale} />} note={quote.remainderMinor !== '0' ? `يُعاد إليك ${formatMinorUnits(quote.remainderMinor)}` : undefined} />
                  {/* The larger figure is the one that matters: a share of the company, not of the round. */}
                  <Stat label="من الشركة بعد الإصدار" value={<Ltr>{quote.percentOfPostRaise}%</Ltr>} note={`من هذه الجولة: ${quote.percentOfOffering}%`} />
                </div>
                <p className="tmk-field__hint">النسبة تقديرية حتى التخصيص النهائي، وقد تتغير إن لم تُغطَّ الجولة بالكامل.</p>
                {quote.belowMinimumTicket ? <Notice tone="warning">المبلغ أقل من الحد الأدنى للاكتتاب.</Notice> : null}
                {quote.aboveMaximumTicket ? <Notice tone="warning">المبلغ يتجاوز الحد الأقصى المسموح للمكتتب الواحد.</Notice> : null}
                {offering.acceptsCommitments && !quote.belowMinimumTicket && !quote.aboveMaximumTicket ? (
                  <p className="tmk-row__actions">
                    <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void reserve()}>
                      احجز السعة
                    </button>
                  </p>
                ) : null}
              </>
            ) : null}
          </Card>
          <p className="tmk-field__hint">الحجز ليس شراءً ولا دفعًا. هو وقت محجوز لك لتقرأ وتقرر.</p>
        </>
      ) : null}

      {stage === 'confirm' && commitment ? (
        <Card title="٢ — وقّع العقد">
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="الأسهم المحجوزة" value={<Ltr>{commitment.units}</Ltr>} />
            <Stat label="المبلغ" value={<MoneyAmount minor={commitment.amountMinor} currency={commitment.currency} locale={locale} />} />
            <Stat label="ينتهي الحجز" value={formatDate(commitment.expiresAt, locale, true)} />
          </div>
          {offering.disclosure ? (
            <>
              <h3>الإفصاح — النسخة {offering.disclosure.sequence}</h3>
              <p className="tmk-field__hint">
                العقد يسمي هذه النسخة بعينها ببصمتها: <code><Ltr>{offering.disclosure.checksum.slice(0, 16)}…</Ltr></code>.
                إن صدرت نسخة جديدة قبل توقيعك، يُرفض التوقيع وتُطالَب بقراءة الجديد.
              </p>
              <div className="tmk-prose">
                <p>{offering.disclosure.summary}</p>
                <h4>المخاطر</h4>
                <p>{offering.disclosure.risks}</p>
                <h4>أوجه استخدام التمويل</h4>
                <p>{offering.disclosure.useOfFunds}</p>
              </div>
            </>
          ) : null}
          <form onSubmit={event => void confirm(event)}>
            <label className="tmk-choice" htmlFor="risk-ack">
              <input id="risk-ack" name="risk" type="checkbox" />
              <span>أقر بأنني قرأت الإفصاح أعلاه، وأنني قد أخسر كامل المبلغ، وأن هذه ليست وديعة ولا ضمان عائد.</span>
            </label>
            <p className="tmk-row__actions">
              <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>وقّع العقد</button>
            </p>
          </form>

          <details>
            <summary>ألغِ الحجز</summary>
            <form onSubmit={event => void cancel(event)}>
              <div className="tmk-field">
                <label className="tmk-field__label" htmlFor="cancel-reason">السبب</label>
                <span className="tmk-field__hint" id="cancel-reason-hint">يبقى في سجلك؛ السعة تتحرر فورًا لغيرك.</span>
                <textarea id="cancel-reason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required aria-describedby="cancel-reason-hint" />
              </div>
              <button type="submit" className="tmk-button tmk-button--quiet" disabled={busy}>ألغِ الالتزام</button>
            </form>
          </details>
        </Card>
      ) : null}

      {stage === 'pay' && commitment ? (
        <Card title="٣ — ادفع">
          <p>
            المبلغ يذهب إلى حساب ضمان خاص بهذا العرض، لا إلى الشركة مباشرة. إن لم تبلغ الجولة حدها الأدنى، يُعاد إليك
            كامل المبلغ المتعاقد عليه.
          </p>
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="المستحق" value={<MoneyAmount minor={commitment.amountMinor} currency={commitment.currency} locale={locale} />} />
            <Stat label="الأسهم" value={<Ltr>{commitment.units}</Ltr>} note="تُصدر بعد التخصيص، لا بعد الدفع." />
          </div>
          {payment ? (
            <p className="tmk-row__actions">
              <a className="tmk-button tmk-button--primary" href={L(payment.providerRedirectPath)}>أكمل الدفع في المحاكي</a>
              <a className="tmk-button tmk-button--quiet" href={L(`/payments/${payment.paymentIntentId}`)}>حالة الدفع</a>
            </p>
          ) : (
            <p className="tmk-row__actions">
              <button type="button" className="tmk-button tmk-button--primary" disabled={busy} onClick={() => void pay()}>ابدأ الدفع</button>
            </p>
          )}
          <p className="tmk-field__hint">لا توجد بوابة دفع حقيقية في هذه النسخة؛ الدفع يمر بمحاكٍ محلي معلَّم بذلك.</p>
        </Card>
      ) : null}

      {stage === 'done' && commitment ? (
        <Card title="ما بعد الدفع">
          <p className="tmk-row__actions">
            <StatusBadge tone={commitmentStates[commitment.state]?.tone ?? 'neutral'}>{commitmentStates[commitment.state]?.text ?? commitment.state}</StatusBadge>
          </p>
          <p>
            المال في حساب الضمان. لا تنشأ حصتك إلا بعد إغلاق الجولة وإقرار جدول التخصيص من مراجع مستقل، وعندها يظهر
            إثبات التخصيص في محفظتك.
          </p>
          <p className="tmk-row__actions">
            <a className="tmk-button tmk-button--secondary" href={L(`/app/investments/${commitment.id}`)}>تابع هذا الاستثمار</a>
            <a className="tmk-button tmk-button--quiet" href={L('/app/investments')}>المحفظة</a>
          </p>
        </Card>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// BUS-04 — closing and allocating
// ---------------------------------------------------------------------------------------------

interface BookRow {
  id: string; investor: string; units: string; amountMinor: string; state: string;
  settled: boolean; allocated: boolean; createdAt: string;
}
interface Book {
  offering: { id: string; title: string; state: string; version: number; currency: string };
  commitments: BookRow[];
  requests: Array<{ id: string; state: string; checksum: string; totalUnits: string; totalMinor: string; decidedAt: string | null; reason: string; version: number; createdAt: string }>;
}
interface Schedule {
  lines: Array<{ commitmentId: string; userId: string; units: string; costMinor: string; percentOfPostRaise: string }>;
  totalUnits: string; totalMinor: string; checksum: string;
  minimumRaiseMinor: string; minimumReached: boolean; paidButUnsettled: number; simulated: boolean;
}
interface Readiness {
  state: string; outstandingCommitments: number; refundedCommitments: number;
  escrowRestrictedMinor: string | null; canClose: boolean;
}

export function OrgAllocations({ locale, orgId, offeringId }: { locale: Locale; orgId: string; offeringId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [book, setBook] = useState<Book | null>(null);
  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    const [nextBook, nextReadiness] = await Promise.all([
      api(`/orgs/${orgId}/offerings/${offeringId}/allocations`) as Promise<Book>,
      api(`/orgs/${orgId}/offerings/${offeringId}/closing`) as Promise<Readiness>
    ]);
    setBook(nextBook);
    setReadiness(nextReadiness);
  }, [orgId, offeringId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل سجل المكتتبين.');
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
    <AppShell locale={locale} path={`/org/${orgId}/offerings`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/offerings`)}>العروض</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  }
  if (!book) return shell(<ErrorState title="غير موجود">هذا العرض غير موجود ضمن جهتك.</ErrorState>);

  const offering = book.offering;
  const openRequest = book.requests.find(request => request.state === 'submitted') ?? null;

  return shell(
    <>
      <PageHeader
        dashboard
        title={`الاكتتابات والتخصيص — ${offering.title}`}
        lead="من اكتتب، وكم سُوِّي فعلًا، وماذا سيصدر. الجدول يُحسب من المال المسوَّى وحده، ولا يصدره من يحسبه."
        actions={<button type="button" className="tmk-button tmk-button--secondary" disabled={busy} onClick={() => void run(async () => { const job = await api(`/orgs/${orgId}/offerings/${offeringId}/allocation-exports`, 'POST') as { id: string }; window.location.assign(L(`/app/exports/${job.id}`)); return 'أُنشئت مهمة التصدير.'; })}>صدّر سجل التخصيص</button>}
      />

      <SimulatedNotice>
        لا يصدر عن هذه النسخة سجل مساهمين قانوني. التخصيص هنا سجل داخلي معلَّم كمحاكاة، ولا يُنشئ ملكية قانونية ولا يسمح بتداول ثانوي.
      </SimulatedNotice>

      <Card title="سجل المكتتبين">
        <DataTable
          caption="من اكتتب في هذا العرض"
          rows={book.commitments}
          rowKey={row => row.id}
          emptyState={<EmptyState title="لا مكتتبين بعد">لم يُحجز أي التزام في هذا العرض.</EmptyState>}
          columns={[
            { key: 'investor', header: 'المكتتب', cell: row => row.investor },
            { key: 'units', header: 'الأسهم', numeric: true, cell: row => <Ltr>{row.units}</Ltr> },
            { key: 'amount', header: 'المبلغ', numeric: true, cell: row => <MoneyAmount minor={row.amountMinor} currency={offering.currency} locale={locale} /> },
            { key: 'state', header: 'الحالة', cell: row => <StatusBadge tone={commitmentStates[row.state]?.tone ?? 'neutral'}>{commitmentStates[row.state]?.text ?? row.state}</StatusBadge> },
            {
              key: 'settled', header: 'التسوية',
              cell: row => row.settled
                ? <StatusBadge tone="success">مسوَّى</StatusBadge>
                : <span className="tmk-field__hint">لم يُسوَّ — غير قابل للتخصيص</span>
            },
            { key: 'createdAt', header: 'التاريخ', cell: row => formatDate(row.createdAt, locale) }
          ]}
        />
      </Card>

      {/* BUS-04.A01. A preview changes nothing; it exists so the figures can be checked first. */}
      <Card title="معاينة التخصيص">
        <p className="tmk-field__hint">
          تُحسب من الالتزامات المسوَّاة وحدها. لا تكتب شيئًا ولا تصدر سهمًا، ويمكن إعادتها كما تشاء.
        </p>
        <p className="tmk-row__actions">
          <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
            onClick={() => void run(async () => {
              setSchedule(await api(`/orgs/${orgId}/offerings/${offeringId}/allocations/preview`, 'POST') as Schedule);
              return 'حُسبت المعاينة. لم يتغير شيء في السجل.';
            })}>
            احسب المعاينة
          </button>
        </p>

        {schedule ? (
          <>
            <div className="tmk-grid tmk-grid--stats">
              <Stat label="إجمالي الأسهم" value={<Ltr>{schedule.totalUnits}</Ltr>} />
              <Stat label="إجمالي المبلغ" value={<MoneyAmount minor={schedule.totalMinor} currency={offering.currency} locale={locale} />} />
              <Stat
                label="الحد الأدنى"
                value={<MoneyAmount minor={schedule.minimumRaiseMinor} currency={offering.currency} locale={locale} />}
                note={schedule.minimumReached ? 'بلغته الجولة.' : 'لم تبلغه الجولة: التخصيص ليس الخيار الصحيح هنا.'}
              />
            </div>
            {schedule.paidButUnsettled > 0 ? (
              <Notice tone="warning" title="دفعات لم تُسوَّ">
                <p style={{ marginBlockEnd: 0 }}>
                  {schedule.paidButUnsettled} التزام وصل ماله ولم يُسوَّ بعد، فهو خارج هذا الجدول. لا يُحذف ولا يُخصَّص: يُنتظر أو يُراجَع.
                </p>
              </Notice>
            ) : null}
            <DataTable
              caption="الجدول المقترح"
              rows={schedule.lines}
              rowKey={line => line.commitmentId}
              emptyState={<EmptyState title="لا شيء قابل للتخصيص">لا يوجد التزام مسوَّى في هذا العرض.</EmptyState>}
              columns={[
                { key: 'units', header: 'الأسهم', numeric: true, cell: line => <Ltr>{line.units}</Ltr> },
                { key: 'cost', header: 'الكلفة', numeric: true, cell: line => <MoneyAmount minor={line.costMinor} currency={offering.currency} locale={locale} /> },
                { key: 'percent', header: 'من الشركة بعد الإصدار', numeric: true, cell: line => <Ltr>{line.percentOfPostRaise}%</Ltr> }
              ]}
            />
            <p className="tmk-field__hint">
              بصمة الجدول: <code><Ltr>{schedule.checksum.slice(0, 16)}…</Ltr></code> — الاعتماد يرتبط بهذه الأرقام بعينها،
              فإن تغيّرت قبل الاعتماد يُرفض الاعتماد بدل أن يُطبَّق على أرقام أخرى.
            </p>
            {/* BUS-04.A02. */}
            {offering.state === 'closing' && !openRequest && schedule.lines.length > 0 ? (
              <p className="tmk-row__actions">
                <button type="button" className="tmk-button tmk-button--primary" disabled={busy}
                  onClick={() => void run(async () => {
                    await api(`/orgs/${orgId}/offerings/${offeringId}/allocations/requests`, 'POST');
                    return 'أُرسل الجدول لمراجع مستقل. لا تُصدر جهتك أسهمًا لنفسها.';
                  })}>
                  أرسل للاعتماد
                </button>
              </p>
            ) : null}
          </>
        ) : null}
      </Card>

      {book.requests.length > 0 ? (
        <Card title="طلبات التثبيت">
          <DataTable
            caption="جداول التخصيص المرسلة"
            rows={book.requests}
            rowKey={request => request.id}
            emptyState={<EmptyState title="لا طلبات">لم يُرسل جدول للاعتماد.</EmptyState>}
            columns={[
              { key: 'state', header: 'الحالة', cell: request => request.state },
              { key: 'units', header: 'الأسهم', numeric: true, cell: request => <Ltr>{request.totalUnits}</Ltr> },
              { key: 'checksum', header: 'البصمة', cell: request => <code><Ltr>{request.checksum.slice(0, 12)}…</Ltr></code> },
              { key: 'decidedAt', header: 'القرار', cell: request => request.decidedAt ? formatDate(request.decidedAt, locale) : <span className="tmk-field__hint">بانتظار مراجع مستقل</span> },
              { key: 'reason', header: 'السبب', cell: request => request.reason || <span className="tmk-field__hint">—</span> }
            ]}
          />
        </Card>
      ) : null}

      {/* BUS-04.A03 (INV-04). Failing is not closing, and the difference is the whole point. */}
      <Card title="إذا لم يبلغ الحد الأدنى">
        <p>
          إعلان فشل الجولة لا يغلقها. يُعلَّم كل التزام مدفوع للاسترداد، ولا تُغلق الجولة قبل أن يُسوّى كل التزام
          ويعود كل مبلغ فعلًا — لا مجرد أن يوضع عليه علامة.
        </p>
        {readiness ? (
          <div className="tmk-grid tmk-grid--stats">
            <Stat label="التزامات لم تُحسم" value={String(readiness.outstandingCommitments)} />
            <Stat label="استُردت" value={String(readiness.refundedCommitments)} />
            <Stat
              label="ما زال في حساب الضمان"
              value={readiness.escrowRestrictedMinor === null
                ? '—'
                : <MoneyAmount minor={readiness.escrowRestrictedMinor} currency={offering.currency} locale={locale} />}
              note={readiness.canClose ? 'لا شيء مستحق: يمكن الإغلاق.' : 'ما دام فيه مال، فالجولة لم تنتهِ من رد ما عليها.'}
            />
          </div>
        ) : null}
        <p className="tmk-row__actions">
          {offering.state === 'closing' ? (
            <button type="button" className="tmk-button tmk-button--secondary" disabled={busy}
              onClick={() => void run(async () => {
                await api(`/orgs/${orgId}/offerings/${offeringId}/fail`, 'POST', { version: offering.version });
                return 'أُعلن فشل بلوغ الحد الأدنى. لم تُغلق الجولة: الاسترداد أولًا.';
              })}>
              أعلن عدم بلوغ الحد الأدنى
            </button>
          ) : null}
          {offering.state === 'failed' ? (
            <button type="button" className="tmk-button tmk-button--primary" disabled={busy || !readiness?.canClose}
              onClick={() => void run(async () => {
                await api(`/orgs/${orgId}/offerings/${offeringId}/close-after-refunds`, 'POST', { version: offering.version });
                return 'أُغلقت الجولة بعد اكتمال الاسترداد.';
              })}>
              أغلق بعد اكتمال الاسترداد
            </button>
          ) : null}
        </p>
        {offering.state === 'failed' && !readiness?.canClose ? (
          <p className="tmk-field__hint">
            الإغلاق معطَّل لأن شيئًا ما زال مستحقًا. الاسترداد نفسه ينفذه تشغيل المنصة المالي، لا الجهة المصدرة.
          </p>
        ) : null}
      </Card>

      <Card title="إجراء إضافي">
        <ul>
          <li><strong>تنزيل السجل.</strong> الزر أعلى الصفحة ينشئ لقطة CSV خاصة ومؤرخة، ويعيد فحص صلاحية التصدير عند التنزيل.</li>
          <li><strong>فتح تعارض.</strong> <a href={L('/contact')}>افتح تذكرة مراجعة خاصة</a> مع مرجع الجدول. التذكرة لا تغيّر التخصيص تلقائيًا.</li>
        </ul>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// BUS-05 — investor relations
// ---------------------------------------------------------------------------------------------

interface InvestorRelationsData {
  units: string;
  reports: Array<{ id: string; sequence: number; title: string; body: string; periodStart: string; periodEnd: string; publishedAt: string }>;
  distributions: Array<{ id: string; distributionId: string; state: string; reason: string; amountMinor: string; currency: string; approvedAt: string | null }>;
  events: Array<{ id: string; kind: string; title: string; body: string; effectiveAt: string }>;
  simulated: boolean;
}

/** PER-09. The investor's own side of BUS-05, rendered inside the investment detail screen. */
function InvestorRelationsPanel({ data, locale }: { data: InvestorRelationsData; locale: Locale }) {
  return (
    <>
      <Card title="تقارير الشركة">
        {data.reports.length === 0 ? (
          <EmptyState title="لا تقارير بعد">لم تنشر الشركة تقريرًا للمستثمرين حتى الآن.</EmptyState>
        ) : (
          data.reports.map(report => (
            <section key={report.id} style={{ marginBlockEnd: 'var(--tmk-space-16)' }}>
              <h3>{report.sequence}. {report.title}</h3>
              <p className="tmk-field__hint">
                {formatDate(report.periodStart, locale)} — {formatDate(report.periodEnd, locale)} · نُشر {formatDate(report.publishedAt, locale)}
              </p>
              <div className="tmk-prose"><p>{report.body}</p></div>
            </section>
          ))
        )}
      </Card>

      <Card title="توزيعاتك">
        <p className="tmk-field__hint">سطرك أنت فقط. مبالغ غيرك من المساهمين ليست من شأنك ولا تظهر هنا.</p>
        <DataTable
          caption="التوزيعات المنسوبة إلى حصتك"
          rows={data.distributions}
          rowKey={line => line.id}
          emptyState={<EmptyState title="لا توزيعات">لم يُقترح توزيع يشملك بعد.</EmptyState>}
          columns={[
            { key: 'reason', header: 'السبب', cell: line => line.reason },
            { key: 'amount', header: 'حصتك', numeric: true, cell: line => <MoneyAmount minor={line.amountMinor} currency={line.currency} locale={locale} /> },
            { key: 'state', header: 'الحالة', cell: line => <StatusBadge tone={distributionStates[line.state]?.tone ?? 'neutral'}>{distributionStates[line.state]?.text ?? line.state}</StatusBadge> },
            { key: 'approvedAt', header: 'الاعتماد', cell: line => line.approvedAt ? formatDate(line.approvedAt, locale) : <span className="tmk-field__hint">—</span> }
          ]}
        />
        <Notice tone="info" title="«مسجَّل كمدفوع» ليس «وصل إليك»">
          <p style={{ marginBlockEnd: 0 }}>
            لا توجد في هذه النسخة قناة صرف إلى شخص، بل إلى حساب بنكي لجهة موثقة فقط. حالة «مدفوع» تعني أن السجل تحرّك،
            لا أن مالًا انتقل إليك.
          </p>
        </Notice>
      </Card>

      {data.events.length > 0 ? (
        <Card title="أحداث الشركة">
          {data.events.map(event => (
            <section key={event.id} style={{ marginBlockEnd: 'var(--tmk-space-16)' }}>
              <h3>{eventKinds[event.kind] ?? event.kind} — {event.title}</h3>
              <p className="tmk-field__hint">يسري من {formatDate(event.effectiveAt, locale)}</p>
              <p>{event.body}</p>
            </section>
          ))}
          <p className="tmk-field__hint">الحدث سجل ومُطلِق لإجراء، وليس تعديلًا على حصصك. لا تُعدَّل الحصص يدويًا أبدًا.</p>
        </Card>
      ) : null}
    </>
  );
}

interface IssuerRelations {
  hasVenture: boolean; currency?: string; currentShares?: string; allocatedUnits: string; holders: number;
  reports: Array<{ id: string; sequence: number; title: string; periodStart: string; periodEnd: string; publishedAt: string }>;
  distributions: Array<{ id: string; state: string; totalMinor: string; currency: string; reason: string; snapshotUnits: string; lineCount: number; version: number; createdAt: string }>;
  events: Array<{ id: string; kind: string; title: string; effectiveAt: string; documentRef: string }>;
}

export function OrgInvestorRelations({ locale, orgId }: { locale: Locale; orgId: string }) {
  const L = (path: string) => localePath(locale, path);
  const t = translator(locale);
  const [data, setData] = useState<IssuerRelations | null>(null);
  const [signedIn, setSignedIn] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => setData(await api(`/orgs/${orgId}/investor-relations`) as IssuerRelations), [orgId]);

  useEffect(() => {
    let active = true;
    (async () => {
      try { await load(); }
      catch (e) {
        if (!active) return;
        if (e instanceof UnauthenticatedError) setSignedIn(false);
        else setError(e instanceof Error ? e.message : 'تعذر تحميل علاقات المستثمرين.');
      }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [load]);

  const submit = async (event: FormEvent<HTMLFormElement>, action: (form: FormData) => Promise<string>) => {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setBusy(true); setError(''); setNotice('');
    try { setNotice(await action(new FormData(form))); form.reset(); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'تعذر إكمال العملية.'); }
    finally { setBusy(false); }
  };

  const shell = (children: ReactNode) => (
    <AppShell locale={locale} path={`/org/${orgId}/investor-relations`} signedIn={signedIn}
      userActions={<a className="tmk-button tmk-button--quiet" href={L(`/org/${orgId}/offerings`)}>العروض</a>}>
      {error ? <Notice tone="danger" live="assertive">{error}</Notice> : null}
      {notice ? <Notice tone="success" live="polite">{notice}</Notice> : null}
      {children}
    </AppShell>
  );

  if (loading) return shell(<Skeleton lines={6} label={t('loading')} />);
  if (!signedIn) {
    return shell(<ErrorState title={t('forbiddenTitle')} onRetry={<a className="tmk-button tmk-button--primary" href={L('/login')}>{t('signIn')}</a>}>{t('forbiddenBody')}</ErrorState>);
  }
  if (!data?.hasVenture) {
    return shell(
      <EmptyState title="لا توجد شركة مسجلة" action={<a className="tmk-button tmk-button--primary" href={L(`/org/${orgId}/offerings`)}>ابدأ من العروض</a>}>
        علاقات المستثمرين تبدأ من شركة لها رأس مال مسجل. لم تُسجَّل بعد لهذه الجهة.
      </EmptyState>
    );
  }
  const currency = data.currency ?? 'ILS';

  return shell(
    <>
      <PageHeader
        dashboard
        title="تقارير الشركة والتوزيعات"
        lead="ما تدين به لمن اكتتب: تقرير مرقَّم، وتوزيع محسوب من السجل كما هو، وحدث شركة مسجَّل من مستند."
      />

      <SimulatedNotice />

      <div className="tmk-grid tmk-grid--stats">
        <Stat label="عدد المساهمين" value={String(data.holders)} note="أشخاص، لا حصص: قد يملك الشخص من أكثر من جولة." />
        <Stat label="الأسهم المخصَّصة" value={<Ltr>{data.allocatedUnits}</Ltr>} note={`من ${data.currentShares ?? '—'} سهمًا قائمة`} />
        <Stat label="التقارير المنشورة" value={String(data.reports.length)} />
      </div>

      {/* BUS-05.A01 */}
      <Card title="انشر تقريرًا">
        <form onSubmit={event => void submit(event, async form => {
          await api(`/orgs/${orgId}/company-reports`, 'POST', {
            title: String(form.get('title') ?? ''),
            body: String(form.get('body') ?? ''),
            periodStart: String(form.get('periodStart') ?? ''),
            periodEnd: String(form.get('periodEnd') ?? '')
          });
          return 'نُشر التقرير برقم نسخة جديد. إشعار المستثمرين يُرسل على حدة، فلا يُلغي فشل الإشعار نشر التقرير.';
        })}>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="report-title">العنوان</label>
            <input id="report-title" name="title" className="tmk-field__control" minLength={4} maxLength={200} required />
          </div>
          <div className="tmk-grid tmk-grid--stats">
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="report-start">بداية الفترة</label>
              <input id="report-start" name="periodStart" type="date" className="tmk-field__control" required />
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="report-end">نهاية الفترة</label>
              <input id="report-end" name="periodEnd" type="date" className="tmk-field__control" required />
            </div>
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="report-body">النص</label>
            <span className="tmk-field__hint" id="report-body-hint">لا يمكن تعديل التقرير بعد نشره؛ التصحيح يكون بنسخة جديدة.</span>
            <textarea id="report-body" name="body" className="tmk-field__control" rows={6} minLength={50} maxLength={20000} required aria-describedby="report-body-hint" />
          </div>
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>انشر</button>
        </form>

        {data.reports.length > 0 ? (
          <DataTable
            caption="التقارير المنشورة"
            rows={data.reports}
            rowKey={report => report.id}
            emptyState={<EmptyState title="لا تقارير" />}
            columns={[
              { key: 'sequence', header: 'النسخة', numeric: true, cell: report => <Ltr>{String(report.sequence)}</Ltr> },
              { key: 'title', header: 'العنوان', cell: report => report.title },
              { key: 'period', header: 'الفترة', cell: report => `${formatDate(report.periodStart, locale)} — ${formatDate(report.periodEnd, locale)}` },
              { key: 'publishedAt', header: 'النشر', cell: report => formatDate(report.publishedAt, locale) }
            ]}
          />
        ) : null}
      </Card>

      {/* BUS-05.A02 */}
      <Card title="اقترح توزيعًا">
        <p className="tmk-field__hint">
          يُحسب سطر كل مساهم من السجل كما هو الآن، بحساب صحيح مقطوع: لا يُقرَّب سطر إلى أعلى، وما لا ينقسم يُعلن كباقٍ
          غير موزع بدل أن يُعطى لأحد اعتباطًا. ولا يعتمده من اقترحه.
        </p>
        <form onSubmit={event => void submit(event, async form => {
          const result = await api(`/orgs/${orgId}/distributions`, 'POST', {
            totalMinor: toMinor(String(form.get('total') ?? '')),
            reason: String(form.get('reason') ?? '')
          }) as { lines: number; undistributedRemainderMinor: string };
          return result.undistributedRemainderMinor === '0'
            ? `حُسب التوزيع على ${result.lines} مساهمًا دون باقٍ.`
            : `حُسب التوزيع على ${result.lines} مساهمًا، وبقي ${formatMinorUnits(result.undistributedRemainderMinor)} غير موزع لأنه لا ينقسم.`;
        })}>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="dist-total">المبلغ الإجمالي ({currency})</label>
            <input id="dist-total" name="total" className="tmk-field__control" inputMode="decimal" required />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="dist-reason">المصدر والسبب</label>
            <textarea id="dist-reason" name="reason" className="tmk-field__control" rows={3} minLength={10} maxLength={1000} required />
          </div>
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>احسب واقترح</button>
        </form>

        <DataTable
          caption="التوزيعات"
          rows={data.distributions}
          rowKey={distribution => distribution.id}
          emptyState={<EmptyState title="لا توزيعات">لم يُقترح توزيع بعد.</EmptyState>}
          columns={[
            { key: 'reason', header: 'السبب', cell: distribution => distribution.reason },
            { key: 'total', header: 'الإجمالي', numeric: true, cell: distribution => <MoneyAmount minor={distribution.totalMinor} currency={distribution.currency} locale={locale} /> },
            { key: 'lines', header: 'عدد المساهمين', numeric: true, cell: distribution => <Ltr>{String(distribution.lineCount)}</Ltr> },
            { key: 'snapshot', header: 'السجل وقت الحساب', numeric: true, cell: distribution => <Ltr>{distribution.snapshotUnits}</Ltr> },
            { key: 'state', header: 'الحالة', cell: distribution => <StatusBadge tone={distributionStates[distribution.state]?.tone ?? 'neutral'}>{distributionStates[distribution.state]?.text ?? distribution.state}</StatusBadge> },
            {
              // BUS-05.A03. The control is rendered for anyone; the server refuses the proposer.
              key: 'approve', header: '',
              cell: distribution => distribution.state === 'requested' ? (
                <button type="button" className="tmk-button tmk-button--quiet" disabled={busy}
                  onClick={() => void (async () => {
                    setBusy(true); setError(''); setNotice('');
                    try {
                      await api(`/distributions/${distribution.id}/approve`, 'POST', { version: distribution.version });
                      setNotice('اعتُمد التوزيع. لا يزال الصرف إلى الأشخاص غير مبني في هذه النسخة.');
                      await load();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : 'تعذر اعتماد التوزيع. من اقترح توزيعًا لا يعتمده.');
                    } finally { setBusy(false); }
                  })()}>
                  اعتمد
                </button>
              ) : <span className="tmk-field__hint">—</span>
            }
          ]}
        />
        <Notice tone="warning" title="لا قناة صرف إلى الأشخاص">
          <p style={{ marginBlockEnd: 0 }}>
            الصرف في هذه النسخة يصل إلى حساب بنكي لجهة موثقة فقط، لا إلى مساهم فرد. تعليم التوزيع «مدفوعًا» يحرّك السجل
            ولا يحرّك مالًا، وتشغيل المنصة المالي هو من يفعل ذلك من شاشة المالية.
          </p>
        </Notice>
      </Card>

      {/* BUS-05.A04 */}
      <Card title="سجّل حدث شركة">
        <p className="tmk-field__hint">
          خروج أو إعادة شراء أو خسارة أو تصفية: يُسجَّل من مستند معتمد ويُطلق مراجعة. لا يعدّل الحصص، ولا يمكن تعديلها يدويًا أصلًا.
        </p>
        <form onSubmit={event => void submit(event, async form => {
          await api(`/orgs/${orgId}/corporate-events`, 'POST', {
            kind: String(form.get('kind') ?? ''),
            title: String(form.get('title') ?? ''),
            body: String(form.get('body') ?? ''),
            documentRef: String(form.get('documentRef') ?? ''),
            effectiveAt: new Date(String(form.get('effectiveAt') ?? '')).toISOString()
          });
          return 'سُجِّل الحدث. لم تتغير أي حصة.';
        })}>
          <div className="tmk-grid tmk-grid--stats">
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="event-kind">النوع</label>
              <select id="event-kind" name="kind" className="tmk-field__control" required>
                {Object.entries(eventKinds).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
              </select>
            </div>
            <div className="tmk-field">
              <label className="tmk-field__label" htmlFor="event-date">تاريخ السريان</label>
              <input id="event-date" name="effectiveAt" type="date" className="tmk-field__control" required />
            </div>
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="event-title">العنوان</label>
            <input id="event-title" name="title" className="tmk-field__control" minLength={4} maxLength={200} required />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="event-ref">مرجع المستند</label>
            <input id="event-ref" name="documentRef" className="tmk-field__control" maxLength={200} />
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="event-body">الوصف والأثر</label>
            <textarea id="event-body" name="body" className="tmk-field__control" rows={4} minLength={20} maxLength={10000} required />
          </div>
          <button type="submit" className="tmk-button tmk-button--primary" disabled={busy}>سجّل الحدث</button>
        </form>

        {data.events.length > 0 ? (
          <DataTable
            caption="الأحداث المسجلة"
            rows={data.events}
            rowKey={event => event.id}
            emptyState={<EmptyState title="لا أحداث" />}
            columns={[
              { key: 'kind', header: 'النوع', cell: event => eventKinds[event.kind] ?? event.kind },
              { key: 'title', header: 'العنوان', cell: event => event.title },
              { key: 'effectiveAt', header: 'السريان', cell: event => formatDate(event.effectiveAt, locale) },
              { key: 'ref', header: 'المستند', cell: event => event.documentRef || <span className="tmk-field__hint">—</span> }
            ]}
          />
        ) : null}
      </Card>
    </>
  );
}
