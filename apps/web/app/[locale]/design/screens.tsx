import {
  Card, DataTable, EmptyState, Ltr, MoneyAmount, Notice, PageHeader,
  ProgressWithLabel, Stat, StatusBadge, Timeline, formatDate, translator, type Locale
} from '@tamkeen/ui';
import {
  charityDashboard, charityProject, exploreResults, investorPortfolio,
  offering, trainingProgramme, type DesignScreen
} from './fixtures';

/**
 * The six screens 03-DESIGN-SYSTEM names as the design acceptance gate. They are layout studies
 * over declared synthetic data, not implemented features: no screen here calls an API, and the
 * shell renders a standing demo banner above every one of them.
 */

const minorToNumber = (minor: string) => Number(minor.replace(/\D/g, ''));
const pick = <T,>(value: Record<Locale, T>, locale: Locale): T => value[locale];

function Money({ minor, currency, locale, label }: { minor: string; currency: string; locale: Locale; label?: string }) {
  return <MoneyAmount minor={minor} currency={currency} locale={locale} {...(label ? { label } : {})} />;
}

/** A definition rendered beside its number, because 14-ANALYTICS requires every figure to say what it counts. */
function Defined({ term, children }: { term: string; children: React.ReactNode }) {
  return <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}><strong>{term}</strong> — {children}</p>;
}

function Explore({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  return (
    <>
      <PageHeader
        eyebrow={ar ? 'استكشف' : 'Explore'}
        title={ar ? 'مشاريع وفرص مفتوحة' : 'Open projects and opportunities'}
        lead={ar
          ? 'كل بطاقة تذكر الجهة المنفذة والهدف والأثر المتحقق حتى الآن، لا شريط تمويل وحده.'
          : 'Every card names the delivering organisation, the goal and the impact verified so far — not a funding bar alone.'}
      />

      <Card title={ar ? 'تصفية' : 'Filters'} id="filters">
        <div className="tmk-toolbar">
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-track">{ar ? 'المسار' : 'Track'}</label>
            <select id="filter-track" className="tmk-field__control" defaultValue="all">
              <option value="all">{ar ? 'كل المسارات' : 'All tracks'}</option>
              <option value="charity">{ar ? 'خيري' : 'Charity'}</option>
              <option value="investment">{ar ? 'استثمار' : 'Investment'}</option>
              <option value="enablement">{ar ? 'تمكين' : 'Enablement'}</option>
            </select>
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-city">{ar ? 'المدينة' : 'City'}</label>
            <select id="filter-city" className="tmk-field__control" defaultValue="all">
              <option value="all">{ar ? 'كل المدن' : 'All cities'}</option>
              <option value="nablus">{ar ? 'نابلس' : 'Nablus'}</option>
              <option value="jenin">{ar ? 'جنين' : 'Jenin'}</option>
              <option value="tulkarm">{ar ? 'طولكرم' : 'Tulkarm'}</option>
            </select>
          </div>
          <div className="tmk-field">
            <label className="tmk-field__label" htmlFor="filter-state">{ar ? 'الحالة' : 'Status'}</label>
            <select id="filter-state" className="tmk-field__control" defaultValue="open">
              <option value="open">{ar ? 'يقبل التمويل' : 'Accepting funding'}</option>
              <option value="closed">{ar ? 'أُغلق الجمع' : 'Fundraising closed'}</option>
            </select>
          </div>
          <button type="button" className="tmk-button tmk-button--secondary">{ar ? 'عرض على الخريطة' : 'Show on map'}</button>
        </div>
        <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'تُحفظ الفلاتر في الرابط، فيعيد زر الرجوع النتائج وموضع التمرير نفسه.'
            : 'Filters live in the URL, so the back button restores the same results and scroll position.'}
        </p>
      </Card>

      <h2>{ar ? `${exploreResults.length} نتيجة` : `${exploreResults.length} results`}</h2>
      <div className="tmk-grid tmk-grid--cards">
        {exploreResults.map(result => {
          const raised = minorToNumber(result.raisedMinor);
          const goal = minorToNumber(result.goalMinor);
          return (
            <article key={result.id} className="tmk-card">
              <p className="tmk-page-header__eyebrow">{pick(result.track, locale)}</p>
              <h3 style={{ marginBlockStart: 0 }}>{pick(result.title, locale)}</h3>
              <p style={{ color: 'var(--tmk-color-muted)', marginBlockEnd: 'var(--tmk-space-12)' }}>
                {pick(result.organisation, locale)} · {pick(result.city, locale)}{' '}
                {result.verified
                  ? <StatusBadge tone="success" label={ar ? 'حالة التوثيق' : 'Verification status'}>{ar ? 'موثقة' : 'Verified'}</StatusBadge>
                  : <StatusBadge tone="neutral" label={ar ? 'حالة التوثيق' : 'Verification status'}>{ar ? 'قيد التوثيق' : 'In verification'}</StatusBadge>}
              </p>
              <ProgressWithLabel
                id={`progress-${result.id}`}
                label={ar ? 'نسبة التمويل المحقق من الهدف' : 'Share of the goal raised'}
                valueNow={raised}
                valueMax={goal}
                startText={<Money minor={result.raisedMinor} currency={result.currency} locale={locale} label={ar ? 'المحقق' : 'Raised'} />}
                endText={<Money minor={result.goalMinor} currency={result.currency} locale={locale} label={ar ? 'الهدف' : 'Goal'} />}
              />
              <p style={{ marginBlock: 'var(--tmk-space-12) 0' }}>
                <StatusBadge tone={result.tone}>{pick(result.impact, locale)}</StatusBadge>
              </p>
            </article>
          );
        })}
      </div>
    </>
  );
}

function CharityProject({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const p = charityProject;
  return (
    <>
      <PageHeader
        eyebrow={`${pick(p.organisation, locale)} · ${pick(p.organisationType, locale)}`}
        title={pick(p.title, locale)}
        lead={pick(p.summary, locale)}
      />

      {/* Funding leads; the story sits below it, which is the 70/20/10 ordering rule. */}
      <Card title={ar ? 'التمويل' : 'Funding'} id="funding">
        <ProgressWithLabel
          id="project-funding"
          label={ar ? 'نسبة التمويل المحقق من الهدف' : 'Share of the goal raised'}
          valueNow={minorToNumber(p.netConfirmedMinor)}
          valueMax={minorToNumber(p.goalMinor)}
          startText={<Money minor={p.netConfirmedMinor} currency={p.currency} locale={locale} label={ar ? 'التمويل المحقق' : 'Confirmed funding'} />}
          endText={<Money minor={p.goalMinor} currency={p.currency} locale={locale} label={ar ? 'الهدف' : 'Goal'} />}
        />
        <div className="tmk-grid tmk-grid--stats" style={{ marginBlockStart: 'var(--tmk-space-24)' }}>
          <Stat
            label={ar ? 'التمويل المحقق' : 'Confirmed funding'}
            value={<Money minor={p.netConfirmedMinor} currency={p.currency} locale={locale} />}
            note={ar ? 'المقبوض المؤكد ناقص الاسترداد المؤكد' : 'Confirmed receipts minus confirmed refunds'}
          />
          <Stat
            label={ar ? 'المتاح للصرف' : 'Available to disburse'}
            value={<Money minor={p.availableMinor} currency={p.currency} locale={locale} />}
            note={ar ? 'بعد التسوية والرسوم والحجوزات — لا يساوي المحقق' : 'After settlement, fees and holds — not equal to confirmed funding'}
          />
          <Stat label={ar ? 'مصروف' : 'Disbursed'} value={<Money minor={p.spentMinor} currency={p.currency} locale={locale} />} note={ar ? 'بفواتير مراجَعة' : 'Against reviewed invoices'} />
          <Stat label={ar ? 'محجوز' : 'Held'} value={<Money minor={p.heldMinor} currency={p.currency} locale={locale} />} note={ar ? 'حجز صرف معتمد لم ينفذ' : 'Approved payout not yet executed'} />
          <Stat label={ar ? 'رسوم' : 'Fees'} value={<Money minor={p.feesMinor} currency={p.currency} locale={locale} />} note={ar ? 'تُخصم من الوعاء' : 'Charged to the pool'} />
          <Stat label={ar ? 'مسترد' : 'Refunded'} value={<Money minor={p.refundedMinor} currency={p.currency} locale={locale} />} note={ar ? 'استرداد مؤكد' : 'Confirmed refunds'} />
        </div>
        <p style={{ marginBlockStart: 'var(--tmk-space-16)' }}>
          <StatusBadge tone="info">{pick(p.policy, locale)}</StatusBadge>{' '}
          <StatusBadge tone="neutral">{ar ? 'ينتهي الجمع' : 'Fundraising ends'} {formatDate(p.endsAt, locale)}</StatusBadge>
        </p>
        <div className="tmk-page-header__actions">
          <button type="button" className="tmk-button tmk-button--primary">{ar ? 'ساهم في هذا المشروع' : 'Contribute to this project'}</button>
          <button type="button" className="tmk-button tmk-button--secondary">{ar ? 'تابع التحديثات' : 'Follow updates'}</button>
        </div>
      </Card>

      <Card title={ar ? 'المراحل والميزانية' : 'Stages and budget'}>
        <Timeline
          label={ar ? 'مراحل المشروع' : 'Project stages'}
          items={p.milestones.map(milestone => ({
            id: milestone.id,
            title: <>{pick(milestone.title, locale)} — <Money minor={milestone.budgetMinor} currency={p.currency} locale={locale} /></>,
            meta: pick(milestone.note, locale),
            state: milestone.state
          }))}
        />
      </Card>

      <Card title={ar ? 'الأثر' : 'Impact'}>
        <div className="tmk-grid tmk-grid--stats">
          <Stat label={ar ? 'مستفيدون موثقون' : 'Verified beneficiaries'} value={`${p.verifiedBeneficiaries} / ${p.plannedBeneficiaries}`} note={ar ? 'أشخاص فريدون بدعم مثبت' : 'Unique people with proven delivery'} />
          <Stat label={ar ? 'مساهمون' : 'Contributors'} value={String(p.contributors)} note={ar ? 'تُعرض الهوية بموافقة صاحبها فقط' : 'Identity shown only with the contributor’s consent'} />
          <Stat label={ar ? 'المسؤول' : 'Responsible'} value={pick(p.manager, locale)} note={pick(p.city, locale)} />
        </div>
        <Notice tone="info" title={ar ? 'كيف تُقرأ هذه الأرقام' : 'How to read these figures'}>
          <Defined term={ar ? 'إنجاز المشروع' : 'Project completion'}>
            {ar
              ? 'يُقاس بالمراحل المتحقق منها بأوزانها المعلنة، ولا يتبع نسبة المال المجموع.'
              : 'Measured by verified stages at their published weights; it does not track the share of money raised.'}
          </Defined>
        </Notice>
      </Card>
    </>
  );
}

function CharityDashboard({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const d = charityDashboard;
  return (
    <>
      <PageHeader
        dashboard
        eyebrow={pick(d.organisation, locale)}
        title={ar ? 'ما الذي يحتاج عملك الآن' : 'What needs your attention now'}
        lead={ar
          ? 'المطلوب تنفيذه أولًا، ثم السيولة والالتزامات، ثم نتائج المشاريع. كل رقم يفتح مصدره.'
          : 'Work first, then liquidity and obligations, then project results. Every figure opens its source.'}
      />

      <Card title={ar ? 'مهام عاجلة' : 'Urgent tasks'} id="tasks">
        {d.tasks.map(task => (
          <article className="tmk-row" key={task.id}>
            <div>
              <strong>{pick(task.label, locale)}</strong>
              <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}>{pick(task.meta, locale)}</p>
            </div>
            <div className="tmk-row__actions">
              <StatusBadge tone={task.tone}>{pick(task.due, locale)}</StatusBadge>
              <button type="button" className="tmk-button tmk-button--secondary">{ar ? 'افتح' : 'Open'}</button>
            </div>
          </article>
        ))}
      </Card>

      <Card title={ar ? 'السيولة والالتزامات' : 'Liquidity and obligations'}>
        <div className="tmk-grid tmk-grid--stats">
          <Stat label={ar ? 'المتاح للصرف' : 'Available to disburse'} value={<Money minor={d.availableMinor} currency={d.currency} locale={locale} />} note={ar ? 'رصيد مسوّى بعد الحجوزات' : 'Settled balance after holds'} />
          <Stat label={ar ? 'محجوز' : 'Held'} value={<Money minor={d.heldMinor} currency={d.currency} locale={locale} />} note={ar ? 'اعتمادات لم تنفذ' : 'Approved, not executed'} />
          <Stat label={ar ? 'التزامات مرحلية' : 'Staged obligations'} value={<Money minor={d.obligationsMinor} currency={d.currency} locale={locale} />} note={ar ? 'مراحل مخططة لم تُموّل بالكامل' : 'Planned stages not yet fully funded'} />
        </div>
        <Notice tone="warning">
          <p style={{ marginBlockEnd: 0 }}>
            {ar
              ? 'الرصيد هنا مشتق من الدفتر ولا يُحرَّر يدويًا. أي فرق تسوية يبقى مفتوحًا بمسؤول حتى يُحسم.'
              : 'This balance is derived from the ledger and is never edited by hand. Any settlement difference stays open with an owner until it is resolved.'}
          </p>
        </Notice>
      </Card>

      <Card title={ar ? 'المشاريع' : 'Projects'}>
        <DataTable
          caption={ar ? 'مشاريع الجهة وحالتها' : 'Organisation projects and their status'}
          rows={d.projects}
          rowKey={row => row.id}
          emptyState={<EmptyState title={ar ? 'لا مشاريع بعد' : 'No projects yet'} />}
          columns={[
            { key: 'name', header: ar ? 'المشروع' : 'Project', cell: row => pick(row.name, locale) },
            { key: 'raised', header: ar ? 'المحقق' : 'Raised', numeric: true, cell: row => <Money minor={row.raisedMinor} currency={d.currency} locale={locale} /> },
            { key: 'goal', header: ar ? 'الهدف' : 'Goal', numeric: true, cell: row => <Money minor={row.goalMinor} currency={d.currency} locale={locale} /> },
            { key: 'state', header: ar ? 'الحالة' : 'Status', cell: row => <StatusBadge tone={row.tone}>{pick(row.state, locale)}</StatusBadge> }
          ]}
        />
      </Card>
    </>
  );
}

function Offering({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const o = offering;
  const postIssue = o.sharesBefore + o.sharesOffered;
  return (
    <>
      <PageHeader
        eyebrow={`${pick(o.company, locale)} · ${pick(o.stage, locale)}`}
        title={ar ? 'عرض تمويل بأسهم عادية' : 'An ordinary share offering'}
        lead={ar
          ? 'اقرأ الأداة والشروط ونسخة الإفصاح قبل أي التزام. الالتزام لا ينشئ ملكية.'
          : 'Read the instrument, the terms and the disclosure version before committing. A commitment does not create ownership.'}
      />

      <Notice tone="warning" title={ar ? 'تنبيه مخاطر' : 'Risk warning'}>
        <p style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'الاستثمار في شركة غير مدرجة قد يؤدي إلى خسارة رأس المال كاملًا. لا يوجد أي وعد بعائد، ولا سوق ثانوية لبيع الحصة.'
            : 'Investing in an unlisted company can mean losing the entire amount. No return is promised, and there is no secondary market for the stake.'}
        </p>
      </Notice>

      <Card title={ar ? 'شروط العرض' : 'Offering terms'} id="terms">
        <div className="tmk-grid tmk-grid--stats">
          <Stat label={ar ? 'الأداة' : 'Instrument'} value={pick(o.instrument, locale)} />
          <Stat label={ar ? 'سعر السهم' : 'Price per share'} value={<Money minor={o.pricePerShareMinor} currency={o.currency} locale={locale} />} />
          <Stat label={ar ? 'أسهم معروضة' : 'Shares offered'} value={o.sharesOffered.toLocaleString(locale === 'ar' ? 'ar-u-nu-latn' : 'en')} note={ar ? `من ${postIssue.toLocaleString('ar-u-nu-latn')} بعد الإصدار` : `of ${postIssue.toLocaleString('en')} post-issue`} />
          <Stat label={ar ? 'الحد الأدنى' : 'Minimum raise'} value={<Money minor={o.minimumRaiseMinor} currency={o.currency} locale={locale} />} note={ar ? 'دونه يُغلق العرض وتُعاد الأموال' : 'Below this the offering closes and funds return'} />
          <Stat label={ar ? 'ملتزم به' : 'Committed'} value={<Money minor={o.committedMinor} currency={o.currency} locale={locale} />} note={ar ? 'ليس مالًا مقبوضًا' : 'Not money received'} />
          <Stat label={ar ? 'مسوّى' : 'Settled'} value={<Money minor={o.settledMinor} currency={o.currency} locale={locale} />} note={ar ? 'مقبوض ومؤكد' : 'Received and confirmed'} />
        </div>
        <p style={{ marginBlockStart: 'var(--tmk-space-16)' }}>
          <StatusBadge tone="info">{ar ? 'نسخة الإفصاح' : 'Disclosure version'} {o.disclosureVersion}</StatusBadge>{' '}
          <StatusBadge tone="neutral">{ar ? 'يُغلق' : 'Closes'} {formatDate(o.closesAt, locale)}</StatusBadge>
        </p>
        <Notice tone="info">
          <Defined term={ar ? 'مثال حساب' : 'Worked example'}>
            {ar
              ? 'اكتتاب بـ10,000.00 ILS = 1,000 سهم = نحو 0.0909% من 1,100,000 سهم بعد الإصدار الكامل — وليس 1% من الشركة. النسبة تقديرية حتى التخصيص النهائي.'
              : 'A 10,000.00 ILS subscription = 1,000 shares ≈ 0.0909% of 1,100,000 shares post-issue — not 1% of the company. The percentage is indicative until final allocation.'}
          </Defined>
        </Notice>
      </Card>

      <Card title={ar ? 'استخدام التمويل' : 'Use of funds'}>
        <DataTable
          caption={ar ? 'بنود استخدام التمويل المعلنة' : 'Declared use of funds'}
          rows={o.useOfFunds}
          rowKey={row => row.id}
          emptyState={<EmptyState title={ar ? 'لم تُعلن بنود بعد' : 'No items declared yet'} />}
          columns={[
            { key: 'label', header: ar ? 'البند' : 'Item', cell: row => pick(row.label, locale) },
            { key: 'amount', header: ar ? 'المبلغ' : 'Amount', numeric: true, cell: row => <Money minor={row.minor} currency={o.currency} locale={locale} /> }
          ]}
        />
      </Card>

      <Card title={ar ? 'المخاطر المعلنة' : 'Declared risks'}>
        <ul>{o.risks.map((risk, index) => <li key={index} style={{ marginBlockEnd: 'var(--tmk-space-8)' }}>{pick(risk, locale)}</li>)}</ul>
      </Card>

      <Card title={ar ? 'غرفة البيانات' : 'Data room'}>
        {o.documents.map(document => (
          <article className="tmk-row" key={document.id}>
            <strong>{pick(document.label, locale)}</strong>
            <div className="tmk-row__actions">
              <StatusBadge tone={pick(document.access, 'en') === 'Public' ? 'neutral' : 'warning'}>{pick(document.access, locale)}</StatusBadge>
              <button type="button" className="tmk-button tmk-button--secondary">{ar ? 'اطلب الوصول' : 'Request access'}</button>
            </div>
          </article>
        ))}
      </Card>
    </>
  );
}

function InvestorPortfolio({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const p = investorPortfolio;
  return (
    <>
      <PageHeader
        dashboard
        eyebrow={ar ? 'محفظتي' : 'My portfolio'}
        title={ar ? 'الالتزامات والحصص المثبتة' : 'Commitments and proven holdings'}
        lead={ar
          ? 'تُعرض أربع حالات منفصلة: التزام، تسوية، تخصيص، وملكية مثبتة. لا تُحتسب قيمة سوقية من سعر الاكتتاب.'
          : 'Four states are kept apart: commitment, settlement, allocation and proven holding. No market value is inferred from the subscription price.'}
      />

      <Card title={ar ? 'الملخص' : 'Summary'} id="summary">
        <div className="tmk-grid tmk-grid--stats">
          <Stat label={ar ? 'ملتزم به' : 'Committed'} value={<Money minor={p.committedMinor} currency={p.currency} locale={locale} />} note={ar ? 'يحجز سعة ولا ينشئ ملكية' : 'Reserves capacity, creates no ownership'} />
          <Stat label={ar ? 'مسوّى' : 'Settled'} value={<Money minor={p.settledMinor} currency={p.currency} locale={locale} />} note={ar ? 'مقبوض ومؤكد' : 'Received and confirmed'} />
          <Stat label={ar ? 'أصل التكلفة' : 'Cost basis'} value={<Money minor={p.allocatedMinor} currency={p.currency} locale={locale} />} note={ar ? 'ما دُفع فعلًا مقابل الحصص' : 'What was actually paid for the units'} />
          <Stat label={ar ? 'وحدات مثبتة' : 'Proven units'} value={p.units.toLocaleString(locale === 'ar' ? 'ar-u-nu-latn' : 'en')} note={ar ? `من ${p.postIssueShares.toLocaleString('ar-u-nu-latn')} بعد الإصدار` : `of ${p.postIssueShares.toLocaleString('en')} post-issue`} />
          <Stat label={ar ? 'توزيعات مدفوعة' : 'Distributions paid'} value={<Money minor={p.distributionsPaidMinor} currency={p.currency} locale={locale} />} note={ar ? 'المقترح غير محتسب' : 'Proposed distributions excluded'} />
          <Stat label={ar ? 'مسترد' : 'Refunded'} value={<Money minor={p.refundedMinor} currency={p.currency} locale={locale} />} />
        </div>
        <Notice tone="warning">
          <p style={{ marginBlockEnd: 0 }}>
            {ar
              ? 'لا تعرض هذه الصفحة تقييمًا حاليًا ولا عائدًا محسوبًا. أي ROI يحتاج منهجًا وتدفقات وتاريخًا معلنًا.'
              : 'This page shows no current valuation and no computed return. Any ROI would need a stated method, cash flows and a date.'}
          </p>
        </Notice>
      </Card>

      <Card title={ar ? 'المراكز' : 'Positions'}>
        <DataTable
          caption={ar ? 'المراكز الاستثمارية وحالة كل منها' : 'Investment positions and their state'}
          rows={p.positions}
          rowKey={row => row.id}
          emptyState={<EmptyState title={ar ? 'لا مراكز بعد' : 'No positions yet'} />}
          columns={[
            { key: 'company', header: ar ? 'الشركة' : 'Company', cell: row => pick(row.company, locale) },
            { key: 'state', header: ar ? 'الحالة' : 'State', cell: row => <StatusBadge tone={row.tone}>{pick(row.state, locale)}</StatusBadge> },
            { key: 'units', header: ar ? 'وحدات مثبتة' : 'Proven units', numeric: true, cell: row => row.units ? row.units.toLocaleString(locale === 'ar' ? 'ar-u-nu-latn' : 'en') : '—' },
            { key: 'cost', header: ar ? 'أصل التكلفة' : 'Cost basis', numeric: true, cell: row => <Money minor={row.costBasisMinor} currency={p.currency} locale={locale} /> },
            { key: 'proof', header: ar ? 'الإثبات' : 'Proof', cell: row => <span className="tmk-field__hint">{pick(row.proof, locale)}</span> }
          ]}
        />
      </Card>
    </>
  );
}

function TrainingApplication({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const p = trainingProgramme;
  return (
    <>
      <PageHeader
        eyebrow={`${pick(p.operator, locale)} · ${ar ? 'برعاية' : 'sponsored by'} ${pick(p.sponsor, locale)}`}
        title={pick(p.title, locale)}
        lead={ar
          ? 'برنامج تدريب ممول يقود إلى فرص عمل. الأرقام أدناه تفصل ما هو متوقع عما هو ملزم.'
          : 'A funded training programme leading to work. The figures below separate what is expected from what is committed.'}
      />

      <Card title={ar ? 'ما الذي يقدمه البرنامج' : 'What the programme offers'} id="offer">
        <div className="tmk-grid tmk-grid--stats">
          <Stat label={ar ? 'المقاعد' : 'Seats'} value={String(p.seats)} note={pick(p.city, locale)} />
          <Stat label={ar ? 'المدة' : 'Duration'} value={ar ? `${p.weeks} أسابيع` : `${p.weeks} weeks`} note={ar ? `${p.hoursPerWeek} ساعة أسبوعيًا` : `${p.hoursPerWeek} hours a week`} />
          <Stat label={ar ? 'بدل شهري' : 'Monthly stipend'} value={<Money minor={p.stipendMinor} currency={p.currency} locale={locale} />} note={pick(p.stipendCondition, locale)} />
          <Stat label={ar ? 'وظائف ملزمة' : 'Committed roles'} value={String(p.committedRoles)} note={ar ? 'بوثيقة التزام من صاحب العمل' : 'Backed by an employer commitment document'} />
          <Stat label={ar ? 'وظائف مستهدفة' : 'Target roles'} value={String(p.expectedRoles)} note={ar ? 'هدف وليس وعدًا — لا يضمن التوظيف' : 'A target, not a promise — employment is not guaranteed'} />
          <Stat label={ar ? 'يغلق التقديم' : 'Applications close'} value={formatDate(p.applicationClosesAt, locale)} />
        </div>
        <Notice tone="warning" title={ar ? 'ما لا يعد به البرنامج' : 'What the programme does not promise'}>
          <p style={{ marginBlockEnd: 0 }}>
            {ar
              ? `${p.committedRoles} وظائف فقط ملزمة بوثيقة. البقية مستهدفة وتخضع لمعايير الاختيار المعلنة. إكمال التدريب لا يعني عرض عمل.`
              : `Only ${p.committedRoles} roles are contractually committed. The rest are targets, subject to the published selection criteria. Completing the training does not mean a job offer.`}
          </p>
        </Notice>
      </Card>

      <Card title={ar ? 'شروط التقديم' : 'Eligibility'}>
        <ul>{p.requirements.map((requirement, index) => <li key={index} style={{ marginBlockEnd: 'var(--tmk-space-8)' }}>{pick(requirement, locale)}</li>)}</ul>
      </Card>

      <Card title={ar ? 'مسار طلبك' : 'Your application path'}>
        <Timeline
          label={ar ? 'خطوات الطلب من التقديم إلى المتابعة' : 'Application steps from submission to follow-up'}
          items={p.steps.map(step => ({ id: step.id, title: pick(step.label, locale), meta: pick(step.meta, locale), state: step.state }))}
        />
        <div className="tmk-page-header__actions">
          <button type="button" className="tmk-button tmk-button--primary">{ar ? 'تأكيد حضور المقابلة' : 'Confirm interview attendance'}</button>
          <button type="button" className="tmk-button tmk-button--danger">{ar ? 'سحب الطلب' : 'Withdraw application'}</button>
        </div>
        <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}>
          {ar
            ? 'سحب الطلب نهائي لهذه الدفعة ويحرر مقعدك للتالي في قائمة الانتظار.'
            : 'Withdrawing is final for this cohort and releases your seat to the next person on the waiting list.'}
        </p>
      </Card>
    </>
  );
}

export function DesignScreenBody({ screen, locale }: { screen: DesignScreen; locale: Locale }) {
  const t = translator(locale);
  switch (screen) {
    case 'explore': return <Explore locale={locale} />;
    case 'charity-project': return <CharityProject locale={locale} />;
    case 'charity-dashboard': return <CharityDashboard locale={locale} />;
    case 'offering': return <Offering locale={locale} />;
    case 'investor-portfolio': return <InvestorPortfolio locale={locale} />;
    case 'training-application': return <TrainingApplication locale={locale} />;
    default: return <EmptyState title={t('notFoundTitle')}>{t('notFoundBody')}</EmptyState>;
  }
}

export function ltrSample() {
  // Referenced by the states gallery to show identifier isolation inside Arabic text.
  return <Ltr>PS92PALS000000000400123456702</Ltr>;
}
