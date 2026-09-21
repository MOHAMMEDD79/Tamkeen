import type { Locale } from '@tamkeen/ui';

/**
 * Synthetic data for the PART-03 design review only.
 *
 * None of this is stored, fetched or computed by a service. It exists so the six review screens
 * can be judged as layouts, and 17-SEED-SCENARIOS supplies the shape. Every name is fictional and
 * every address is example.test. PART-03 explicitly forbids treating this as an implemented
 * backend, so each screen renders behind the shell's demo banner.
 *
 * Amounts follow 08-FINANCIAL-SYSTEM: integer minor units carried as strings, never as numbers.
 */

export const DESIGN_SCREENS = ['explore', 'charity-project', 'charity-dashboard', 'offering', 'investor-portfolio', 'training-application'] as const;
export type DesignScreen = typeof DESIGN_SCREENS[number];

export function isDesignScreen(value: string): value is DesignScreen {
  return (DESIGN_SCREENS as readonly string[]).includes(value);
}

type Bilingual = Record<Locale, string>;
const both = (ar: string, en: string): Bilingual => ({ ar, en });

export const screenTitles: Record<DesignScreen, Bilingual> = {
  explore: both('الاستكشاف', 'Explore'),
  'charity-project': both('مشروع خيري', 'Charity project'),
  'charity-dashboard': both('لوحة جمعية', 'Charity dashboard'),
  offering: both('عرض استثمار', 'Investment offering'),
  'investor-portfolio': both('لوحة مستثمر', 'Investor portfolio'),
  'training-application': both('طلب تدريب', 'Training application')
};

export const screenPurpose: Record<DesignScreen, Bilingual> = {
  explore: both(
    'يحكم على الكثافة: هل يفهم الزائر الجهة والهدف والأثر خلال عشر ثوانٍ؟',
    'Judges density: can a visitor grasp the organisation, the goal and the impact within ten seconds?'
  ),
  'charity-project': both(
    'يحكم على ترتيب التمويل مقابل القصة: لا يطغى الغلاف على بيانات المال.',
    'Judges funding-versus-story ordering: the hero must not overpower the funding data.'
  ),
  'charity-dashboard': both(
    'يحكم على أولوية العمل: المطلوب تنفيذه أولًا، ثم السيولة والالتزامات، ثم النتائج.',
    'Judges work priority: what needs doing first, then liquidity and obligations, then results.'
  ),
  offering: both(
    'يحكم على الإفصاح: الأداة والمخاطر والنسخة ظاهرة، وبلا أي وعد بعائد.',
    'Judges disclosure: instrument, risk and version are visible, with no promise of return.'
  ),
  'investor-portfolio': both(
    'يحكم على الفصل بين الالتزام والتسوية والتخصيص والملكية المثبتة.',
    'Judges the separation of commitment, settlement, allocation and proven holding.'
  ),
  'training-application': both(
    'يحكم على صدق الوعد: المتوقع مقابل الملزم، ومسار الطلب حتى المتابعة.',
    'Judges promise honesty: expected versus committed, and the path from application to follow-up.'
  )
};

/** Scenario A of 17-SEED-SCENARIOS: a community training centre in Nablus. */
export const charityProject = {
  slug: 'community-training-centre',
  title: both('تجهيز مركز تدريب مجتمعي', 'Equipping a community training centre'),
  summary: both(
    'تجهيز قاعتين ومختبر حاسوب في نابلس لتشغيل برامج تدريب مهني على مدار السنة.',
    'Fitting out two halls and a computer lab in Nablus to run vocational training year round.'
  ),
  organisation: both('جمعية الأفق التجريبية', 'Ufuq Demo Association'),
  organisationType: both('جمعية مسجلة · موثقة', 'Registered association · verified'),
  manager: both('مها — مديرة المشروع', 'Maha — project manager'),
  city: both('نابلس', 'Nablus'),
  currency: 'ILS',
  goalMinor: '10000000',
  /** Confirmed receipts minus confirmed refunds (14-ANALYTICS-IMPACT). */
  netConfirmedMinor: '6420000',
  /** Settled, minus fees and active holds. Deliberately not equal to the line above. */
  availableMinor: '3710000',
  feesMinor: '192600',
  spentMinor: '2400000',
  heldMinor: '310000',
  refundedMinor: '150000',
  policy: both('تمويل مرن — يُنفذ جزئيًا وفق ميزانية مرحلية', 'Flexible funding — delivered in stages against a staged budget'),
  endsAt: '2026-12-31T00:00:00.000Z',
  contributors: 184,
  milestones: [
    { id: 'm1', title: both('تجهيز القاعة الأولى', 'Fit out the first hall'), budgetMinor: '2000000', state: 'done' as const, note: both('صُرفت الدفعة بعد فاتورة مراجعة', 'Paid after a reviewed invoice') },
    { id: 'm2', title: both('مختبر الحاسوب', 'Computer lab'), budgetMinor: '5000000', state: 'active' as const, note: both('طلب صرف بانتظار اعتماد مستقل', 'A payout request is awaiting independent approval') },
    { id: 'm3', title: both('التشغيل والتدريب الأول', 'Operations and first cohort'), budgetMinor: '3000000', state: 'pending' as const, note: both('يبدأ بعد اكتمال المرحلة الثانية', 'Starts once stage two completes') }
  ],
  verifiedBeneficiaries: 18,
  plannedBeneficiaries: 30
};

export const exploreResults = [
  {
    id: 'p1', track: both('خيري', 'Charity'), tone: 'success' as const,
    title: both('تجهيز مركز تدريب مجتمعي', 'Equipping a community training centre'),
    organisation: both('جمعية الأفق التجريبية', 'Ufuq Demo Association'),
    city: both('نابلس', 'Nablus'), currency: 'ILS',
    goalMinor: '10000000', raisedMinor: '6420000',
    impact: both('تحقق 18 مستفيدًا من 30', '18 of 30 beneficiaries verified'),
    verified: true
  },
  {
    id: 'p2', track: both('خيري', 'Charity'), tone: 'warning' as const,
    title: both('ترميم مدرسة قروية', 'Rural school refurbishment'),
    organisation: both('مؤسسة فرصة التجريبية', 'Fursa Demo Foundation'),
    city: both('جنين', 'Jenin'), currency: 'ILS',
    goalMinor: '4500000', raisedMinor: '4500000',
    impact: both('اكتمل التمويل · بانتظار تقرير الأثر', 'Fully funded · impact report pending'),
    verified: true
  },
  {
    id: 'p3', track: both('تمكين', 'Enablement'), tone: 'info' as const,
    title: both('الزراعة الذكية إلى العمل', 'Smart agriculture into work'),
    organisation: both('شركة نبتة التجريبية', 'Nabta Demo Company'),
    city: both('طولكرم', 'Tulkarm'), currency: 'ILS',
    goalMinor: '12000000', raisedMinor: '9000000',
    impact: both('20 مقعدًا · 10 وظائف مستهدفة غير مضمونة', '20 seats · 10 target roles, not guaranteed'),
    verified: true
  },
  {
    id: 'p4', track: both('استثمار', 'Investment'), tone: 'neutral' as const,
    title: both('توسعة خط الإنتاج', 'Production line expansion'),
    organisation: both('مشروع سنابل التجريبي', 'Sanabel Demo Startup'),
    city: both('رام الله', 'Ramallah'), currency: 'ILS',
    goalMinor: '100000000', raisedMinor: '31000000',
    impact: both('أسهم عادية · نسخة إفصاح 3', 'Ordinary shares · disclosure version 3'),
    verified: false
  }
];

/** The worked example from 06-INVESTMENT-LIFECYCLE, kept exact so the maths can be checked on screen. */
export const offering = {
  company: both('شركة نبتة التجريبية', 'Nabta Demo Company'),
  stage: both('مرحلة النمو المبكر', 'Early growth'),
  instrument: both('أسهم عادية', 'Ordinary shares'),
  currency: 'ILS',
  pricePerShareMinor: '1000',
  sharesBefore: 1_000_000,
  sharesOffered: 100_000,
  minimumRaiseMinor: '40000000',
  maximumRaiseMinor: '100000000',
  committedMinor: '31000000',
  settledMinor: '24000000',
  disclosureVersion: 3,
  closesAt: '2026-11-30T00:00:00.000Z',
  useOfFunds: [
    { id: 'u1', label: both('معدات إنتاج', 'Production equipment'), minor: '55000000' },
    { id: 'u2', label: both('رأس مال عامل', 'Working capital'), minor: '30000000' },
    { id: 'u3', label: both('توظيف وتدريب', 'Hiring and training'), minor: '15000000' }
  ],
  risks: [
    both('تركز العملاء: ثلاثة عملاء يمثلون 61% من الإيراد.', 'Customer concentration: three customers account for 61% of revenue.'),
    both('اعتماد على مورد واحد للمادة الخام الأساسية.', 'Dependence on a single supplier for the main raw material.'),
    both('لا سوق ثانوية: لا يمكن بيع الحصة قبل حدث خروج موثق.', 'No secondary market: the stake cannot be sold before a documented exit event.')
  ],
  documents: [
    { id: 'd1', label: both('ملخص الشركة', 'Company overview'), access: both('عام', 'Public') },
    { id: 'd2', label: both('الأداء التاريخي', 'Historical performance'), access: both('يتطلب اتفاق سرية', 'Requires an NDA') },
    { id: 'd3', label: both('نسخة الإفصاح 3', 'Disclosure version 3'), access: both('عام', 'Public') }
  ]
};

export const investorPortfolio = {
  currency: 'ILS',
  committedMinor: '1000000',
  settledMinor: '1000000',
  allocatedMinor: '1000000',
  refundedMinor: '0',
  /** 10,000 ILS at 10 ILS per share = 1,000 units of 1,100,000 post-issue. */
  units: 1000,
  postIssueShares: 1_100_000,
  distributionsPaidMinor: '0',
  positions: [
    {
      id: 'h1', company: both('شركة نبتة التجريبية', 'Nabta Demo Company'),
      state: both('مخصص ومثبت', 'Allocated and proven'), tone: 'success' as const,
      units: 1000, costBasisMinor: '1000000', proof: both('عقد تخصيص 2026-10-04', 'Allocation deed 2026-10-04')
    },
    {
      id: 'h2', company: both('مشروع سنابل التجريبي', 'Sanabel Demo Startup'),
      state: both('التزام بانتظار التسوية', 'Committed, awaiting settlement'), tone: 'warning' as const,
      units: 0, costBasisMinor: '500000', proof: both('لا ملكية قبل التخصيص', 'No ownership before allocation')
    },
    {
      id: 'h3', company: both('مصنع الحصاد التجريبي', 'Harvest Demo Works'),
      state: both('عرض لم يبلغ حده الأدنى · جارٍ الاسترداد', 'Offering missed its minimum · refunding'), tone: 'danger' as const,
      units: 0, costBasisMinor: '0', proof: both('يعاد المبلغ وفق عقده', 'Funds return under its agreement')
    }
  ]
};

export const trainingProgramme = {
  title: both('الزراعة الذكية إلى العمل', 'Smart agriculture into work'),
  operator: both('شركة نبتة التجريبية', 'Nabta Demo Company'),
  sponsor: both('مؤسسة فرصة التجريبية', 'Fursa Demo Foundation'),
  city: both('طولكرم — حضوري', 'Tulkarm — in person'),
  currency: 'ILS',
  seats: 20,
  weeks: 8,
  hoursPerWeek: 20,
  stipendMinor: '150000',
  stipendCondition: both('يُصرف بعد تثبيت الحضور وحسم أي اعتراض', 'Paid once attendance is confirmed and any objection is resolved'),
  /** 07-INCUBATION-EMPLOYMENT: expected and committed roles must never be shown as one number. */
  expectedRoles: 10,
  committedRoles: 4,
  applicationClosesAt: '2026-10-15T00:00:00.000Z',
  requirements: [
    both('العمر 18–29 سنة عند بدء الدفعة.', 'Aged 18–29 at the start of the cohort.'),
    both('إقامة في طولكرم أو محافظة مجاورة.', 'Resident in Tulkarm or a neighbouring governorate.'),
    both('الالتزام بـ20 ساعة أسبوعيًا لمدة 8 أسابيع.', 'Able to commit 20 hours a week for 8 weeks.')
  ],
  steps: [
    { id: 's1', label: both('تقديم الطلب', 'Submit the application'), state: 'done' as const, meta: both('حُفظ رقم الطلب', 'Application reference saved') },
    { id: 's2', label: both('فرز بقواعد معلنة', 'Screening against published rules'), state: 'done' as const, meta: both('تم · وفق معايير منشورة', 'Complete · against published criteria') },
    { id: 's3', label: both('مقابلة', 'Interview'), state: 'active' as const, meta: both('موعد مقترح 2026-10-22', 'Proposed for 2026-10-22') },
    { id: 's4', label: both('قبول المقعد', 'Accept the seat'), state: 'pending' as const, meta: both('مهلة 5 أيام بعد القبول', 'Five days to respond after acceptance') },
    { id: 's5', label: both('التدريب والحضور', 'Training and attendance'), state: 'pending' as const, meta: both('8 أسابيع', 'Eight weeks') },
    { id: 's6', label: both('متابعة 30 و90 يومًا', '30 and 90 day follow-up'), state: 'pending' as const, meta: both('تُحتسب من بدء العمل الفعلي', 'Counted from the actual start date') }
  ]
};

export const charityDashboard = {
  organisation: both('جمعية الأفق التجريبية', 'Ufuq Demo Association'),
  currency: 'ILS',
  availableMinor: '3710000',
  heldMinor: '310000',
  obligationsMinor: '5600000',
  tasks: [
    { id: 't1', tone: 'danger' as const, label: both('طلب صرف بانتظار اعتمادك', 'A payout request awaits your approval'), meta: both('50,000.00 ILS · المرحلة 2 · أنشأه أحمد', '50,000.00 ILS · stage 2 · raised by Ahmad'), due: both('متأخر بيوم', 'One day overdue') },
    { id: 't2', tone: 'warning' as const, label: both('فرق تسوية غير محسوم', 'An unresolved settlement difference'), meta: both('100 وحدة صغرى · كشف 2026-10-02', '100 minor units · statement 2026-10-02'), due: both('اليوم', 'Today') },
    { id: 't3', tone: 'info' as const, label: both('تقرير أثر مستحق', 'An impact report is due'), meta: both('مشروع مركز التدريب', 'Training centre project'), due: both('خلال 4 أيام', 'In four days') }
  ],
  projects: [
    { id: 'pr1', name: both('تجهيز مركز تدريب مجتمعي', 'Equipping a community training centre'), raisedMinor: '6420000', goalMinor: '10000000', state: both('قيد التنفيذ', 'Executing'), tone: 'success' as const },
    { id: 'pr2', name: both('سلال غذائية شتوية', 'Winter food parcels'), raisedMinor: '1800000', goalMinor: '2000000', state: both('إيقاف مؤقت للجمع', 'Fundraising paused'), tone: 'warning' as const }
  ]
};
