/**
 * Locale is part of the path (04-INFORMATION-ARCHITECTURE): every route is `/{locale}/...`.
 * Arabic is the default and the design target; English exists from the start so that direction is
 * a structural property, not a late retrofit.
 */

export const LOCALES = ['ar', 'en'] as const;
export type Locale = typeof LOCALES[number];
export const DEFAULT_LOCALE: Locale = 'ar';

export function isLocale(value: string | undefined): value is Locale {
  return value === 'ar' || value === 'en';
}

export function directionOf(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

/** Splits `/ar/app/settings` into its locale and the locale-free path used by route matching. */
export function splitLocale(pathname: string): { locale: Locale; path: string } {
  const [, first = '', ...rest] = pathname.split('/');
  if (isLocale(first)) return { locale: first, path: `/${rest.join('/')}`.replace(/\/$/, '') || '/' };
  return { locale: DEFAULT_LOCALE, path: pathname || '/' };
}

export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return clean === '/' ? `/${locale}` : `/${locale}${clean}`;
}

/**
 * Formats a UTC instant for display. Dates are stored in UTC and rendered per locale (03);
 * the calendar stays Gregorian in Arabic because financial records are matched against bank
 * statements and audit logs that use it.
 */
export function formatDate(value: string | Date, locale: Locale, withTime = false): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const tag = locale === 'ar' ? 'ar-u-ca-gregory-nu-latn' : 'en-GB';
  return new Intl.DateTimeFormat(tag, {
    year: 'numeric', month: 'short', day: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {})
  }).format(date);
}

/**
 * Formats integer minor units for display in both locales.
 *
 * Latin digits and Latin separators are used deliberately, in Arabic too. The Arabic decimal
 * separator U+066B and the Arabic thousands separator U+066C render as near-identical comma-like
 * glyphs in the system Arabic fonts this build falls back to, so `1000000` minor units appeared as
 * "1,000,000,00" with no way to tell the decimal point from a grouping mark. An amount that can be
 * misread by a factor of one hundred is not acceptable on a financial screen, and these figures are
 * also reconciled against bank statements that use Latin forms.
 *
 * The input is a string of integer minor units (08-FINANCIAL-SYSTEM); it is never parsed into a
 * JavaScript number, so no precision is lost and no arithmetic happens here.
 */
export function formatMinorUnits(minor: string, exponent = 2): string {
  const negative = typeof minor === 'string' && minor.trim().startsWith('-');
  const digits = (typeof minor === 'string' ? minor : '').replace(/\D/g, '') || '0';
  const padded = digits.padStart(exponent + 1, '0');
  const whole = padded.slice(0, padded.length - exponent) || '0';
  const fraction = exponent > 0 ? padded.slice(padded.length - exponent) : '';
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // U+2212 minus, not a hyphen, so a negative amount reads correctly at small sizes.
  return `${negative && digits !== '0' ? '−' : ''}${grouped}${fraction ? `.${fraction}` : ''}`;
}

type Dictionary = Record<string, { ar: string; en: string }>;

/**
 * Shared interface copy. Page-specific prose lives with its page; this covers the chrome and the
 * states every screen must be able to show.
 */
export const strings = {
  brand: { ar: 'تمكين', en: 'Tamkeen' },
  skipToContent: { ar: 'تخطَّ إلى المحتوى', en: 'Skip to content' },
  mainNavigation: { ar: 'التنقل الرئيسي', en: 'Main navigation' },
  breadcrumb: { ar: 'مسار التصفح', en: 'Breadcrumb' },
  changeLanguage: { ar: 'English', en: 'العربية' },
  changeLanguageLabel: { ar: 'تغيير اللغة إلى الإنجليزية', en: 'Switch language to Arabic' },
  signOut: { ar: 'تسجيل الخروج', en: 'Sign out' },
  signIn: { ar: 'تسجيل الدخول', en: 'Sign in' },
  notifications: { ar: 'الإشعارات', en: 'Notifications' },
  workspace: { ar: 'مساحة العمل', en: 'Workspace' },
  personalWorkspace: { ar: 'مساحتي الشخصية', en: 'My personal workspace' },
  switchContext: { ar: 'تبديل السياق', en: 'Switch context' },
  loading: { ar: 'جارٍ التحميل…', en: 'Loading…' },
  retry: { ar: 'إعادة المحاولة', en: 'Try again' },
  save: { ar: 'حفظ', en: 'Save' },
  saving: { ar: 'جارٍ الحفظ…', en: 'Saving…' },
  cancel: { ar: 'إلغاء', en: 'Cancel' },
  confirm: { ar: 'تأكيد', en: 'Confirm' },
  close: { ar: 'إغلاق', en: 'Close' },
  previous: { ar: 'السابق', en: 'Previous' },
  next: { ar: 'التالي', en: 'Next' },
  readFailedTitle: { ar: 'تعذر تحميل هذا القسم', en: 'This section could not be loaded' },
  readFailedBody: { ar: 'لم يصل رد من الخادم. البيانات المعروضة قد تكون ناقصة.', en: 'The server did not answer. What you see may be incomplete.' },
  referenceLabel: { ar: 'مرجع الطلب:', en: 'Request reference:' },
  forbiddenTitle: { ar: 'لا تملك صلاحية هذه الصفحة', en: 'You do not have access to this page' },
  forbiddenBody: { ar: 'صلاحياتك في هذا السياق لا تشمل هذا المورد. بدّل السياق أو اطلب الإذن من مدير الجهة.', en: 'Your permissions in this context do not cover this resource. Switch context or ask an organisation administrator.' },
  notFoundTitle: { ar: 'الصفحة غير موجودة', en: 'Page not found' },
  notFoundBody: { ar: 'تحقق من الرابط، أو ارجع إلى مساحتك.', en: 'Check the link, or return to your workspace.' },
  conflictTitle: { ar: 'تغيّرت البيانات أثناء عملك', en: 'The data changed while you were working' },
  conflictBody: { ar: 'حمّل النسخة الأحدث وراجع تغييراتك قبل الحفظ مرة أخرى.', en: 'Load the newer version and review your changes before saving again.' },
  emptyTitle: { ar: 'لا يوجد شيء هنا بعد', en: 'Nothing here yet' },
  pendingExternal: { ar: 'بانتظار تأكيد خارجي', en: 'Awaiting external confirmation' },
  demoDataTitle: { ar: 'بيانات تجريبية', en: 'Demo data' },
  demoDataBody: {
    ar: 'هذه الشاشة تعرض بيانات مصطنعة لمراجعة التصميم فقط. لا يوجد خلفها تنفيذ ولا أموال ولا سجلات حقيقية.',
    en: 'This screen shows synthetic data for design review only. There is no implementation, money or real record behind it.'
  },
  notImplemented: { ar: 'غير منفذ بعد', en: 'Not implemented yet' },
  designReview: { ar: 'مراجعة تصميم', en: 'Design review' },
  tagline: { ar: 'تمويل يصل، وأثر يُثبت', en: 'Funding that arrives, impact that is proven' },
  register: { ar: 'إنشاء حساب', en: 'Create account' },
  openMenu: { ar: 'القائمة', en: 'Menu' },
  navExplore: { ar: 'المشاريع الخيرية', en: 'Charity projects' },
  navOrganizations: { ar: 'الجهات', en: 'Organisations' },
  navInvest: { ar: 'استثمار ربحي', en: 'Invest' },
  navOpportunities: { ar: 'فرص تشغيل', en: 'Jobs & training' },
  navImpact: { ar: 'الأثر', en: 'Impact' },
  navAbout: { ar: 'من نحن', en: 'About us' },
  navContact: { ar: 'تواصل معنا', en: 'Contact us' },
  viewSite: { ar: 'زيارة الموقع', en: 'View the site' },
  navDashboard: { ar: 'لوحتي', en: 'Dashboard' },
  navContributions: { ar: 'مساهماتي', en: 'My contributions' },
  navInvestments: { ar: 'استثماراتي', en: 'My investments' },
  navApplications: { ar: 'طلباتي', en: 'My applications' },
  navJobs: { ar: 'وظائفي', en: 'My jobs' },
  navAssistance: { ar: 'طلبات المساعدة', en: 'Assistance' },
  navProposals: { ar: 'أفكاري', en: 'My ideas' },
  navVolunteering: { ar: 'التطوع', en: 'Volunteering' },
  navSupport: { ar: 'الدعم', en: 'Support' },
  navSettings: { ar: 'الحساب والأمان', en: 'Account & security' },
  navGroupActivity: { ar: 'نشاطي', en: 'My activity' },
  navGroupWork: { ar: 'العمل والمجتمع', en: 'Work & community' },
  navGroupAccount: { ar: 'الحساب', en: 'Account' },
  navGroupOrganizations: { ar: 'جهاتي', en: 'My organisations' },
  footerAbout: { ar: 'منصة تربط التمويل بالجهة المنفذة وبنتيجة موثقة، عبر العمل الخيري والاستثمار والتدريب إلى العمل.', en: 'A platform that links funding to the organisation delivering it and to a documented result, across charity, investment and training into work.' },
  footerExplore: { ar: 'استكشف', en: 'Explore' },
  footerAccount: { ar: 'حسابك', en: 'Your account' },
  footerRights: { ar: 'جميع الحقوق محفوظة', en: 'All rights reserved' },
  footerTerms: { ar: 'الشروط', en: 'Terms' },
  toggleTheme: { ar: 'تبديل المظهر بين الفاتح والداكن', en: 'Switch between light and dark appearance' },
  goodMorning: { ar: 'صباح الخير', en: 'Good morning' },
  goodEvening: { ar: 'مساء الخير', en: 'Good evening' }
} as const satisfies Dictionary;

export type StringKey = keyof typeof strings;

/** Returns a translator bound to one locale, so call sites read as `t('save')`. */
export function translator(locale: Locale) {
  return (key: StringKey): string => strings[key][locale];
}
