import {
  Card, Choice, DataTable, EmptyState, ErrorState, Fieldset, Ltr, MoneyAmount, Notice,
  PageHeader, Pagination, ProgressWithLabel, SelectField, SensitiveField, Skeleton,
  Stat, StatusBadge, TextField, Timeline, translator, type Locale
} from '@tamkeen/ui';

/**
 * The states gallery. 03-DESIGN-SYSTEM requires every component to have default, loading, empty,
 * error, disabled and focus states, and composite components to have a story in Arabic and
 * English. This page is that story: it renders in whichever locale is in the URL, so switching
 * language at the top shows the same components in the other direction.
 *
 * Focus is not faked here — press Tab. The focus ring is defined once, globally, and every
 * control below is a real focusable element.
 */

export function StatesGallery({ locale }: { locale: Locale }) {
  const ar = locale === 'ar';
  const t = translator(locale);
  const label = (arabic: string, english: string) => (ar ? arabic : english);

  return (
    <>
      <PageHeader
        eyebrow={t('designReview')}
        title={label('معرض حالات المكونات', 'Component states gallery')}
        lead={label(
          'كل مكون في حالاته الإلزامية. جرّب Tab لرؤية حلقة التركيز الفعلية، وبدّل اللغة من أعلى الصفحة لرؤية الاتجاه المعاكس.',
          'Every component in its required states. Press Tab to see the real focus ring, and switch language at the top to see the opposite direction.'
        )}
      />

      <Card title={label('الأزرار', 'Buttons')}>
        <div className="tmk-row__actions">
          <button type="button" className="tmk-button tmk-button--primary">{label('إجراء رئيسي', 'Primary action')}</button>
          <button type="button" className="tmk-button tmk-button--secondary">{label('إجراء ثانوي', 'Secondary action')}</button>
          <button type="button" className="tmk-button tmk-button--quiet">{label('إجراء هادئ', 'Quiet action')}</button>
          <button type="button" className="tmk-button tmk-button--danger">{label('إجراء خطر', 'Destructive action')}</button>
          <button type="button" className="tmk-button tmk-button--primary" disabled>{label('معطل', 'Disabled')}</button>
          <button type="button" className="tmk-button tmk-button--primary" aria-busy="true" disabled>{label('جارٍ التنفيذ…', 'Working…')}</button>
        </div>
        <p className="tmk-field__hint" style={{ marginBlockStart: 'var(--tmk-space-16)', marginBlockEnd: 0 }}>
          {label(
            'الإجراء الخطر لا يأخذ مظهر الإجراء الرئيسي، ويبتعد عنه في الترتيب.',
            'A destructive action never takes the primary appearance, and is kept away from it in order.'
          )}
        </p>
      </Card>

      <Card title={label('حقول النماذج', 'Form fields')}>
        <TextField id="demo-name" name="demoName" label={label('الاسم المعروض', 'Display name')} hint={label('من حرفين إلى مئة حرف.', 'Between 2 and 100 characters.')} defaultValue={label('ليان', 'Layan')} />
        <TextField id="demo-email" name="demoEmail" type="email" label={label('البريد الإلكتروني', 'Email address')} defaultValue="layan@example.test" autoComplete="email" />
        <TextField
          id="demo-invalid"
          name="demoInvalid"
          label={label('رقم التسجيل', 'Registration number')}
          error={label('رقم التسجيل مطلوب لإرسال التوثيق.', 'A registration number is required before submitting for verification.')}
        />
        <TextField id="demo-disabled" name="demoDisabled" label={label('حقل معطل', 'Disabled field')} defaultValue={label('لا يمكن تعديله في هذه الحالة', 'Not editable in this state')} disabled />
        <SelectField
          id="demo-select"
          name="demoSelect"
          label={label('البلد', 'Country')}
          options={[{ value: 'PS', text: label('فلسطين', 'Palestine') }, { value: 'JO', text: label('الأردن', 'Jordan') }]}
        />
        <Fieldset legend={label('القدرات', 'Capabilities')}>
          <Choice id="demo-donor" name="demoCapability" value="Donor" label={label('متبرع', 'Donor')} defaultChecked />
          <Choice id="demo-jobseeker" name="demoCapability" value="JobSeeker" label={label('باحث عن عمل', 'Job seeker')} />
          <Choice id="demo-investor" name="demoCapability" value="Investor" label={label('مستثمر — لا يمنح أهلية مالية بذاته', 'Investor — does not itself grant financial eligibility')} />
        </Fieldset>
        <p className="tmk-field__hint" style={{ marginBlockEnd: 0 }}>
          {label('الحقل غير الصالح يحمل حدًا أثقل ورسالة نصية، لا لونًا وحده.', 'An invalid field carries a heavier border and a written message, never colour alone.')}
        </p>
      </Card>

      <Card title={label('الحالات والتنبيهات', 'Status and notices')}>
        <p className="tmk-row__actions">
          <StatusBadge tone="neutral">{label('مسودة', 'Draft')}</StatusBadge>
          <StatusBadge tone="info">{label('قيد المراجعة', 'In review')}</StatusBadge>
          <StatusBadge tone="success">{label('موثقة', 'Verified')}</StatusBadge>
          <StatusBadge tone="warning">{t('pendingExternal')}</StatusBadge>
          <StatusBadge tone="danger">{label('مرفوض', 'Rejected')}</StatusBadge>
        </p>
        <Notice tone="success">{label('حُفظت الإعدادات.', 'Settings saved.')}</Notice>
        <Notice tone="warning" title={t('pendingExternal')}>
          <p style={{ marginBlockEnd: 0 }}>{label('لم يؤكد المزود الدفع بعد. لا تُعد المحاولة؛ ستتحدث الحالة تلقائيًا.', 'The provider has not confirmed the payment yet. Do not retry; the status will update on its own.')}</p>
        </Notice>
        <Notice tone="danger" live="assertive" title={t('conflictTitle')}>
          <p style={{ marginBlockEnd: 0 }}>{t('conflictBody')}</p>
        </Notice>
      </Card>

      <Card title={label('حالات القراءة', 'Read states')}>
        <h3>{t('loading')}</h3>
        <Skeleton lines={3} label={t('loading')} />
        <h3>{label('فارغة', 'Empty')}</h3>
        <EmptyState
          title={t('emptyTitle')}
          action={<button type="button" className="tmk-button tmk-button--primary">{label('أنشئ أول مشروع', 'Create the first project')}</button>}
        >
          {label('لم تنشئ الجهة أي مشروع بعد. أول خطوة هي إنشاء مسودة مشروع.', 'This organisation has no projects yet. The first step is to create a project draft.')}
        </EmptyState>
        <h3>{label('خطأ قراءة', 'Read error')}</h3>
        <ErrorState
          title={t('readFailedTitle')}
          requestId="req_7f3a91c2"
          retryLabel={t('referenceLabel')}
          onRetry={<button type="button" className="tmk-button tmk-button--secondary">{t('retry')}</button>}
        >
          {t('readFailedBody')}
        </ErrorState>
        <h3>{label('ممنوع', 'Forbidden')}</h3>
        <ErrorState title={t('forbiddenTitle')}>{t('forbiddenBody')}</ErrorState>
      </Card>

      <Card title={label('المال والأرقام', 'Money and figures')}>
        <p>
          {label('مبلغ موجب: ', 'Positive amount: ')}
          <MoneyAmount minor="10000000" currency="ILS" locale={locale} label={label('الهدف', 'Goal')} />
          {label(' · مبلغ سالب: ', ' · negative amount: ')}
          <MoneyAmount minor="-150000" currency="ILS" locale={locale} label={label('مسترد', 'Refunded')} />
          {label(' · صفر: ', ' · zero: ')}
          <MoneyAmount minor="0" currency="ILS" locale={locale} />
        </p>
        <ProgressWithLabel
          id="demo-progress"
          label={label('نسبة التمويل المحقق من الهدف', 'Share of the goal raised')}
          valueNow={6420000}
          valueMax={10000000}
          startText={<MoneyAmount minor="6420000" currency="ILS" locale={locale} />}
          endText={<MoneyAmount minor="10000000" currency="ILS" locale={locale} />}
        />
        <div className="tmk-grid tmk-grid--stats" style={{ marginBlockStart: 'var(--tmk-space-16)' }}>
          <Stat label={label('المتاح للصرف', 'Available to disburse')} value={<MoneyAmount minor="3710000" currency="ILS" locale={locale} />} note={label('بعد التسوية والحجوزات', 'After settlement and holds')} />
          <Stat label={label('محجوز', 'Held')} value={<MoneyAmount minor="310000" currency="ILS" locale={locale} />} />
        </div>
        <p style={{ marginBlockStart: 'var(--tmk-space-16)' }}>
          {label('معرّف محايد الاتجاه داخل نص عربي: ', 'A direction-neutral identifier inside text: ')}
          <Ltr>PS92PALS000000000400123456702</Ltr>
        </p>
        <p style={{ marginBlockEnd: 0 }}>
          <SensitiveField label={label('الحساب البنكي', 'Bank account')} reason={label('محجوب — يتطلب إذن bank.manage', 'Redacted — requires bank.manage')} />
        </p>
      </Card>

      <Card title={label('الجداول', 'Tables')}>
        <DataTable
          caption={label('مساهمات حديثة — بيانات تجريبية', 'Recent contributions — demo data')}
          rows={[
            { id: 'c1', project: label('مركز التدريب', 'Training centre'), amount: '50000', state: label('مسوّاة', 'Settled'), tone: 'success' as const },
            { id: 'c2', project: label('سلال غذائية', 'Food parcels'), amount: '25000', state: t('pendingExternal'), tone: 'warning' as const },
            { id: 'c3', project: label('مركز التدريب', 'Training centre'), amount: '15000', state: label('مستردة', 'Refunded'), tone: 'neutral' as const }
          ]}
          rowKey={row => row.id}
          emptyState={<EmptyState title={t('emptyTitle')} />}
          columns={[
            { key: 'project', header: label('المشروع', 'Project'), cell: row => row.project },
            { key: 'amount', header: label('المبلغ', 'Amount'), numeric: true, cell: row => <MoneyAmount minor={row.amount} currency="ILS" locale={locale} /> },
            { key: 'state', header: label('الحالة', 'Status'), cell: row => <StatusBadge tone={row.tone}>{row.state}</StatusBadge> }
          ]}
        />
        <Pagination
          label={label('تصفح النتائج', 'Results pagination')}
          statusText={label('تعرض 3 من 42', 'Showing 3 of 42')}
          previous={<button type="button" className="tmk-button tmk-button--secondary" disabled>{t('previous')}</button>}
          next={<button type="button" className="tmk-button tmk-button--secondary">{t('next')}</button>}
        />
      </Card>

      <Card title={label('الخط الزمني', 'Timeline')}>
        <Timeline
          label={label('مراحل المشروع', 'Project stages')}
          items={[
            { id: 'a', title: label('تجهيز القاعة الأولى', 'First hall fitted out'), meta: label('اكتملت · صُرفت بفاتورة مراجعة', 'Complete · paid against a reviewed invoice'), state: 'done' },
            { id: 'b', title: label('مختبر الحاسوب', 'Computer lab'), meta: label('جارية · طلب صرف بانتظار اعتماد مستقل', 'In progress · payout awaiting independent approval'), state: 'active' },
            { id: 'c', title: label('التشغيل والتدريب الأول', 'Operations and first cohort'), meta: label('لم تبدأ', 'Not started'), state: 'pending' }
          ]}
        />
      </Card>
    </>
  );
}
