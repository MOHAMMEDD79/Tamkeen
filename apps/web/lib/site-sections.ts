/**
 * Every editable section of the public pages, with its default copy and photo.
 *
 * The admin edits sections on /admin/site/pages. A saved section is stored by the API under its
 * slot; any field left empty there falls back to the default here, so a page is never blank and
 * "reset" simply removes the saved row. Lists (the four steps, the values…) are one section per
 * entry, numbered `<page>.<list>.<n>`.
 *
 * Shared by the public pages (server) and the admin editor (client), so it must stay free of
 * server-only imports.
 */

export interface Text { ar: string; en: string }
export interface Link { label: Text; href: string }
export type SectionField = 'kicker' | 'title' | 'body' | 'cta' | 'cta2' | 'image';

export interface SectionDefaults {
  kicker?: Text; title?: Text; body?: Text; cta?: Link; cta2?: Link; image?: string;
}
export interface SectionDef {
  slot: string;
  page: PageKey;
  /** What the admin sees on the section card. */
  label: string;
  fields: SectionField[];
  defaults: SectionDefaults;
}

/** A section as the API returns it once saved; every field may be empty. */
export interface SavedSection {
  id: string; slot: string;
  kicker?: Text; title: Text; body: Text;
  cta: Link | null; cta2?: Link | null;
  imageUrl: string | null;
}

export interface ResolvedSection {
  kicker: Text; title: Text; body: Text; cta: Link | null; cta2: Link | null; image: string;
}

export type PageKey = 'home' | 'about' | 'contact' | 'invest' | 'explore' | 'opportunities' | 'organizations';
export const SITE_PAGES: Array<{ key: PageKey; label: string; path: string }> = [
  { key: 'home', label: 'الصفحة الرئيسية', path: '/' },
  { key: 'about', label: 'من نحن', path: '/about' },
  { key: 'contact', label: 'تواصل معنا', path: '/contact-us' },
  { key: 'explore', label: 'المشاريع الخيرية', path: '/explore' },
  { key: 'invest', label: 'استثمار ربحي', path: '/invest' },
  { key: 'opportunities', label: 'فرص تشغيل', path: '/opportunities' },
  { key: 'organizations', label: 'الجهات', path: '/organizations' }
];

const t = (ar: string, en: string): Text => ({ ar, en });
const photo = (name: string) => `/media/defaults/${name}.jpg`;

export const SECTIONS: SectionDef[] = [
  // ---------------------------------------------------------------- home
  { slot: 'home.tracks', page: 'home', label: 'عنوان قسم المسارات الثلاثة', fields: ['kicker', 'title', 'body'], defaults: {
    kicker: t('ثلاثة مسارات للأثر', 'Three tracks to impact'),
    title: t('اختر طريقتك في صنع الفرق', 'Choose how you make a difference'),
    body: t('تبرّع، أو استثمر، أو ابدأ طريقك المهني — كل ذلك بشفافية كاملة ومع جهات موثقة.', 'Give, invest or start your career — all with full transparency and verified organisations.') } },
  { slot: 'home.impact', page: 'home', label: 'شريط الأرقام', fields: ['kicker'], defaults: {
    kicker: t('أرقام حقيقية من المنصة', 'Real numbers from the platform') } },
  { slot: 'home.featured', page: 'home', label: 'قسم المشاريع المميزة', fields: ['kicker', 'title', 'body', 'cta'], defaults: {
    kicker: t('مشاريع تنتظر دعمك', 'Projects waiting for you'),
    title: t('كن جزءًا من قصة نجاح اليوم', 'Be part of a success story today'),
    body: t('مشاريع حقيقية بميزانيات معلنة ومراحل واضحة. اختر ما يلمس قلبك.', 'Real projects with published budgets and clear stages. Choose what moves you.'),
    cta: { label: t('تصفّح كل المشاريع', 'Browse all projects'), href: '/explore' } } },
  { slot: 'home.how', page: 'home', label: 'عنوان «كيف تعمل تمكين»', fields: ['kicker', 'title'], defaults: {
    kicker: t('كيف تعمل تمكين', 'How Tamkeen works'),
    title: t('من المساهمة إلى الأثر في أربع خطوات', 'From contribution to impact in four steps') } },
  ...([
    [t('اختر مشروعك', 'Choose a project'), t('تصفّح مشاريع جهات موثقة، واقرأ ميزانيتها ومراحلها قبل أن تقرر.', 'Browse projects by verified organisations and read their budget and stages first.')],
    [t('ساهم بأمان', 'Contribute safely'), t('كل مبلغ يُسجَّل في دفتر بقيد مزدوج، ويصلك إيصال رسمي.', 'Every amount is recorded in a double-entry ledger, and you get an official receipt.')],
    [t('تابع التنفيذ', 'Follow delivery'), t('تُصرف الأموال على مراحل، ولا تُغلق مرحلة دون دليل تنفيذ.', 'Money is released in stages, and no stage closes without evidence.')],
    [t('شاهد الأثر', 'See the impact'), t('تقرير إغلاق منشور يوضح ما تحقق بفضل مساهمتك.', 'A published closing report shows what your contribution achieved.')]
  ] as Array<[Text, Text]>).map(([title, body], index): SectionDef => ({ slot: `home.step.${index + 1}`, page: 'home', label: `الخطوة ${index + 1}`, fields: ['title', 'body'], defaults: { title, body } })),
  { slot: 'home.why', page: 'home', label: 'قسم «لماذا تمكين؟»', fields: ['kicker', 'title', 'body', 'image'], defaults: {
    kicker: t('لماذا تمكين؟', 'Why Tamkeen?'),
    title: t('الثقة لا تُطلب، بل تُبنى في كل خطوة', 'Trust is not asked for, it is built into every step'),
    body: t('صممنا المنصة بحيث لا يُصرف مبلغ دون اعتماد، ولا يُنشر رقم دون قيد يثبته.', 'We designed the platform so no amount is released without approval, and no figure is shown without an entry behind it.'),
    image: photo('about-village') } },
  ...([
    [t('جهات موثقة فقط', 'Verified organisations only'), t('مراجعة مستقلة لوثائق كل جهة قبل أن تجمع أي تمويل.', 'Independent review of every organisation’s documents before it raises anything.')],
    [t('شفافية كاملة', 'Full transparency'), t('ميزانية ومراحل وتقارير منشورة لكل مشروع.', 'A published budget, stages and reports for every project.')],
    [t('خصوصيتك بيدك', 'Your privacy, your choice'), t('اختر إظهار اسمك أو مبلغك، أو المساهمة دون أن يُعرف أحدهما.', 'Show your name or amount, or contribute without either being known.')]
  ] as Array<[Text, Text]>).map(([title, body], index): SectionDef => ({ slot: `home.check.${index + 1}`, page: 'home', label: `سبب ${index + 1} في «لماذا تمكين؟»`, fields: ['title', 'body'], defaults: { title, body } })),
  ...([
    [t('توثيق مستقل', 'Independent verification'), t('فريق مراجعة منفصل عن الجهات يفحص كل وثيقة.', 'A review team separate from organisations checks every document.')],
    [t('دفتر مالي دقيق', 'Accurate ledger'), t('قيود متوازنة لكل مبلغ يدخل أو يخرج، قابلة للتدقيق.', 'Balanced entries for every amount in or out, open to audit.')],
    [t('فصل الصلاحيات', 'Segregation of duties'), t('من يطلب الصرف لا يعتمده، ومن يراجع لا يملك الجهة.', 'Whoever requests a payout cannot approve it.')],
    [t('تقارير أثر', 'Impact reports'), t('لقطات مجمدة لما تحقق لا تتغير بعد نشرها.', 'Frozen snapshots of what was achieved, unchanged once published.')]
  ] as Array<[Text, Text]>).map(([title, body], index): SectionDef => ({ slot: `home.feature.${index + 1}`, page: 'home', label: `الميزة ${index + 1}`, fields: ['title', 'body'], defaults: { title, body } })),
  { slot: 'home.partners', page: 'home', label: 'شريط الجهات الشريكة', fields: ['kicker'], defaults: {
    kicker: t('جهات تثق بتمكين', 'Organisations that trust Tamkeen') } },
  { slot: 'home.cta', page: 'home', label: 'البانر الختامي', fields: ['title', 'body', 'cta', 'cta2', 'image'], defaults: {
    title: t('ابدأ رحلتك في صنع الأثر اليوم', 'Start your impact journey today'),
    body: t('أنشئ حسابك في دقيقة واحدة، وتابع كل مساهمة واستثمار وفرصة من مكان واحد.', 'Create your account in a minute and follow every contribution, investment and opportunity from one place.'),
    cta: { label: t('أنشئ حسابك مجانًا', 'Create your free account'), href: '/register' },
    cta2: { label: t('تعرّف علينا', 'Get to know us'), href: '/about' },
    image: photo('contact-team') } },

  // ---------------------------------------------------------------- about
  { slot: 'about.mission', page: 'about', label: 'رسالتنا', fields: ['title', 'body'], defaults: {
    title: t('رسالتنا', 'Our mission'),
    body: t('أن يصل كل مبلغ إلى حيث وُعد، وأن يرى صاحبه ما تحقق به، بلا وسطاء غامضين ولا أرقام بلا مصدر.', 'That every amount reaches where it was promised, and its owner sees what it achieved — no opaque middlemen, no figures without a source.') } },
  { slot: 'about.vision', page: 'about', label: 'رؤيتنا', fields: ['title', 'body'], defaults: {
    title: t('رؤيتنا', 'Our vision'),
    body: t('مجتمعات تموّل تنميتها بنفسها: متبرع يثق، ومستثمر يعرف، وشاب يجد عملًا حقيقيًا قرب بيته.', 'Communities that fund their own development: a donor who trusts, an investor who knows, and a young person who finds real work close to home.') } },
  { slot: 'about.story', page: 'about', label: 'قصتنا (افصل الفقرات بسطر فارغ)', fields: ['kicker', 'title', 'body', 'image'], defaults: {
    kicker: t('قصتنا', 'Our story'),
    title: t('بدأنا بسؤال بسيط: أين ذهب المال؟', 'We started with a simple question: where did the money go?'),
    body: t('كثيرون يرغبون في المساعدة أو الاستثمار في مجتمعهم، لكنهم يتوقفون لأنهم لا يعرفون من ينفّذ ولا ما الذي تحقق فعلًا.\n\nبنينا تمكين لتجيب عن هذا السؤال في كل مرة: جهة موثقة، ميزانية معلنة، صرف على مراحل بدليل، وتقرير إغلاق لا يتغير بعد نشره.',
      'Many people want to help or invest in their community, but stop because they cannot tell who delivers or what was actually achieved.\n\nWe built Tamkeen to answer that question every time: a verified organisation, a published budget, staged payouts backed by evidence, and a closing report that never changes once published.'),
    image: photo('about-jerusalem') } },
  { slot: 'about.tracks', page: 'about', label: 'عنوان «ما نقدمه»', fields: ['kicker', 'title'], defaults: {
    kicker: t('ما نقدمه', 'What we offer'), title: t('ثلاثة مسارات، هدف واحد', 'Three tracks, one goal') } },
  { slot: 'about.values', page: 'about', label: 'عنوان «قيمنا»', fields: ['kicker', 'title'], defaults: {
    kicker: t('قيمنا', 'Our values'), title: t('المبادئ التي لا نتنازل عنها', 'The principles we do not compromise on') } },
  ...([
    [t('الشفافية', 'Transparency'), t('كل رقم معروض له قيد مالي خلفه، وكل مشروع له ميزانية ومراحل منشورة.', 'Every figure shown has a ledger entry behind it, and every project a published budget and stages.')],
    [t('التوثيق', 'Verification'), t('لا تجمع جهة أي مبلغ قبل مراجعة مستقلة لوثائقها.', 'No organisation raises anything before an independent review of its documents.')],
    [t('العدالة', 'Fairness'), t('فصل الصلاحيات: من يطلب الصرف لا يعتمده، ومن يراجع لا يملك الجهة.', 'Segregated duties: whoever requests a payout cannot approve it.')],
    [t('الشراكة', 'Partnership'), t('نعمل مع الجهات المحلية لا بدلًا عنها، ونقيس النجاح بأثرها.', 'We work with local organisations, not instead of them, and measure success by their impact.')]
  ] as Array<[Text, Text]>).map(([title, body], index): SectionDef => ({ slot: `about.value.${index + 1}`, page: 'about', label: `القيمة ${index + 1}`, fields: ['title', 'body'], defaults: { title, body } })),
  { slot: 'about.verify', page: 'about', label: 'قسم «ماذا تعني موثقة؟»', fields: ['kicker', 'title', 'image'], defaults: {
    kicker: t('ماذا تعني شارة «موثقة»؟', 'What does “verified” mean?'),
    title: t('ثقة مبنية على فحص، لا على وعد', 'Trust built on checks, not promises'),
    image: photo('cover-charity-2') } },
  ...([
    [t('مراجعة مستقلة', 'Independent review'), t('فحص مراجع مستقل مستندات تسجيل الجهة في تاريخ محدد.', 'An independent reviewer checked the organisation’s registration documents on a given date.')],
    [t('صلاحية محدودة', 'Limited validity'), t('التوثيق المنتهي لا يُحتسب، وتتوقف العمليات التي تتطلبه حتى يُجدَّد.', 'An expired verification does not count, and operations that need it stop until it is renewed.')],
    [t('لا ضمان مبالغ فيه', 'No overpromising'), t('التوثيق يثبت هوية الجهة، ولا يضمن نجاح كل مشروع؛ لذلك نتابع التنفيذ بالدليل.', 'Verification proves who the organisation is, not that every project succeeds — so we follow delivery with evidence.')]
  ] as Array<[Text, Text]>).map(([title, body], index): SectionDef => ({ slot: `about.point.${index + 1}`, page: 'about', label: `نقطة ${index + 1} في «موثقة»`, fields: ['title', 'body'], defaults: { title, body } })),
  { slot: 'about.cta', page: 'about', label: 'البانر الختامي', fields: ['title', 'body', 'cta', 'cta2', 'image'], defaults: {
    title: t('انضم إلينا في بناء الثقة', 'Join us in building trust'),
    body: t('سواء كنت متبرعًا أو مستثمرًا أو جهة تنفّذ أو باحثًا عن فرصة، مكانك هنا.', 'Whether you give, invest, deliver projects or look for an opportunity, there is a place for you here.'),
    cta: { label: t('أنشئ حسابك', 'Create your account'), href: '/register' },
    cta2: { label: t('تواصل معنا', 'Contact us'), href: '/contact-us' },
    image: photo('contact-team') } },
  { slot: 'about.note', page: 'about', label: 'الملاحظة أسفل الصفحة', fields: ['body'], defaults: {
    body: t('المدفوعات على المنصة تعمل حاليًا بنظام تجريبي ولا تُحوَّل أموال حقيقية حتى ربط مزود الدفع.', 'Payments on the platform currently run in a test mode; no real money moves until a payment provider is connected.') } },

  // ---------------------------------------------------------------- contact
  { slot: 'contact.form', page: 'contact', label: 'عنوان نموذج المراسلة', fields: ['title', 'body'], defaults: {
    title: t('أرسل لنا رسالة', 'Send us a message'),
    body: t('املأ النموذج وسيصل مباشرة إلى فريق تمكين.', 'Fill in the form and it goes straight to the Tamkeen team.') } },
  ...([
    [t('دعم أصحاب الحسابات', 'Support for account holders'), t('مشكلة في مساهمة أو طلب؟ افتح تذكرة دعم خاصة من حسابك.', 'A problem with a contribution or request? Open a private support ticket from your account.'), '/contact'],
    [t('سجّل جهتك', 'Register your organisation'), t('جمعية أو شركة أو مؤسسة؟ أنشئ حساب جهتك وابدأ مسار التوثيق.', 'A charity, company or foundation? Create your organisation and start verification.'), '/app/organizations/new'],
    [t('الشراكات', 'Partnerships'), t('للشراكات والتمويل المؤسسي اكتب لنا في النموذج واختر موضوعًا واضحًا.', 'For partnerships and institutional funding, write to us using the form with a clear subject.'), '']
  ] as Array<[Text, Text, string]>).map(([title, body, href], index): SectionDef => ({ slot: `contact.card.${index + 1}`, page: 'contact', label: `البطاقة ${index + 1}`, fields: ['title', 'body', 'cta'], defaults: {
    title, body, ...(href ? { cta: { label: t('افتح', 'Open'), href } } : {}) } })),

  // ---------------------------------------------------------------- listing pages
  { slot: 'explore.header', page: 'explore', label: 'رأس الصفحة', fields: ['kicker', 'title', 'body', 'image'], defaults: {
    kicker: t('استكشف المشاريع', 'Explore projects'),
    title: t('مشاريع تصنع فرقًا حقيقيًا', 'Projects making a real difference'),
    body: t('كل مشروع هنا لجهة معروفة، بميزانية ومراحل معلنة. ابحث عما يلمسك وتابع أثره حتى النهاية.', 'Every project here belongs to a known organisation, with a published budget and stages. Find what moves you and follow its impact to the end.'),
    image: photo('track-charity') } },
  { slot: 'invest.header', page: 'invest', label: 'رأس الصفحة', fields: ['kicker', 'title', 'body', 'cta', 'image'], defaults: {
    kicker: t('استثمار ربحي', 'Profit investment'),
    title: t('استثمر في شركات تنمو مع مجتمعها', 'Invest in companies growing with their community'),
    body: t('عروض أسهم من شركات موثقة، لكل عرض إفصاح منشور وأداة واضحة. لا تُسجَّل ملكية قبل تخصيص يعتمده مراجع مستقل.', 'Equity offerings from verified companies, each with a published disclosure and a clear instrument. No ownership before an independently approved allocation.'),
    cta: { label: t('فعّل ملف المستثمر', 'Set up your investor profile'), href: '/app/investor/eligibility' },
    image: photo('track-invest') } },
  { slot: 'invest.offers', page: 'invest', label: 'عنوان قسم العروض', fields: ['kicker', 'title', 'body'], defaults: {
    kicker: t('العروض المتاحة', 'Available offerings'),
    title: t('فرص استثمار بإفصاح كامل', 'Investment opportunities with full disclosure'),
    body: t('كل بطاقة تذكر حجم العرض كله كنسبة من الشركة، لأن «1٪ من العرض» ليست «1٪ من الشركة».', 'Every card states the whole offering as a share of the company, because “1% of the offering” is not “1% of the company”.') } },
  { slot: 'invest.cta', page: 'invest', label: 'البانر الختامي', fields: ['title', 'body', 'cta', 'cta2', 'image'], defaults: {
    title: t('جاهز لتصبح مستثمرًا؟', 'Ready to become an investor?'),
    body: t('فعّل ملف المستثمر مرة واحدة، ثم اكتتب في العروض المفتوحة وتابع محفظتك وتقارير الشركات.', 'Set up your investor profile once, then subscribe to open offerings and follow your portfolio and company reports.'),
    cta: { label: t('فعّل ملف المستثمر', 'Set up your profile'), href: '/app/investor/eligibility' },
    cta2: { label: t('تعرّف على تمكين', 'About Tamkeen'), href: '/about' },
    image: photo('hero-business') } },
  { slot: 'opportunities.header', page: 'opportunities', label: 'رأس الصفحة', fields: ['kicker', 'title', 'body', 'image'], defaults: {
    kicker: t('فرص تشغيل', 'Jobs & training'),
    title: t('تدرّب، ثم اعمل', 'Train, then work'),
    body: t('برامج تدريب مجانية من جهات موثقة، ووظائف معلنة بأجرها وعقدها. البرنامج والوظيفة شيئان منفصلان: قبول التدريب ليس قبول وظيفة.', 'Free training from verified organisations, and jobs published with their pay and contract. A programme and a job are separate: being accepted onto training is not being hired.'),
    image: photo('track-work') } },
  { slot: 'opportunities.programs', page: 'opportunities', label: 'عنوان قسم البرامج', fields: ['kicker', 'title'], defaults: {
    kicker: t('التدريب', 'Training'), title: t('برامج التدريب', 'Training programmes') } },
  { slot: 'opportunities.jobs', page: 'opportunities', label: 'عنوان قسم الوظائف', fields: ['kicker', 'title', 'body'], defaults: {
    kicker: t('الوظائف', 'Jobs'), title: t('وظائف معلنة', 'Published jobs'),
    body: t('لكل إعلان نوع عقده ومكانه وأجره — أو سبب عدم إعلان الأجر مكتوبًا بنصه.', 'Each listing states its contract, location and pay — or the written reason the pay is not published.') } },
  { slot: 'organizations.header', page: 'organizations', label: 'رأس الصفحة', fields: ['kicker', 'title', 'body', 'image'], defaults: {
    kicker: t('الجهات', 'Organisations'),
    title: t('من ينفّذ على تمكين', 'Who delivers on Tamkeen'),
    body: t('جهات تعمل في مجتمعاتنا. شارة «موثقة» تعني قرار توثيق ساريًا، لا مجرد تسجيل.', 'Organisations working in our communities. A “verified” badge means a current verification decision, not merely a registration.'),
    image: photo('about-village') } }
];

export const SECTION_BY_SLOT = new Map(SECTIONS.map(section => [section.slot, section]));

const merge = (saved: Text | undefined, fallback: Text | undefined): Text => ({
  ar: saved?.ar || fallback?.ar || '',
  en: saved?.en || fallback?.en || ''
});
const mergeLink = (saved: Link | null | undefined, fallback: Link | undefined): Link | null => {
  if (saved && saved.href) return { href: saved.href, label: merge(saved.label, fallback?.label) };
  return fallback ?? null;
};

/** The section as the page shows it: the admin's saved fields over the defaults. */
export function resolveSection(slot: string, saved: SavedSection | undefined): ResolvedSection {
  const defaults = SECTION_BY_SLOT.get(slot)?.defaults ?? {};
  return {
    kicker: merge(saved?.kicker, defaults.kicker),
    title: merge(saved?.title, defaults.title),
    body: merge(saved?.body, defaults.body),
    cta: mergeLink(saved?.cta, defaults.cta),
    cta2: mergeLink(saved?.cta2, defaults.cta2),
    image: saved?.imageUrl || defaults.image || ''
  };
}

/** Body text as paragraphs: the admin separates them with a blank line. */
export const paragraphs = (value: string) => value.split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);

/** The contact details and social links the admin sets on /admin/site/settings. */
export const SETTING_FIELDS: Array<{ key: string; label: string; kind: 'email' | 'tel' | 'text' | 'url'; ltr?: boolean; hint?: string }> = [
  { key: 'contact.email', label: 'البريد الإلكتروني', kind: 'email', ltr: true },
  { key: 'contact.phone', label: 'رقم الهاتف', kind: 'tel', ltr: true, hint: 'مثل ‎+970 59 000 0000' },
  { key: 'contact.whatsapp', label: 'رقم واتساب', kind: 'tel', ltr: true },
  { key: 'contact.address.ar', label: 'العنوان بالعربية', kind: 'text' },
  { key: 'contact.address.en', label: 'العنوان بالإنجليزية', kind: 'text', ltr: true },
  { key: 'contact.hours.ar', label: 'ساعات العمل بالعربية', kind: 'text', hint: 'مثل: الأحد – الخميس، 9 صباحًا – 5 مساءً' },
  { key: 'contact.hours.en', label: 'ساعات العمل بالإنجليزية', kind: 'text', ltr: true },
  { key: 'social.facebook', label: 'فيسبوك', kind: 'url', ltr: true, hint: 'https://facebook.com/…' },
  { key: 'social.instagram', label: 'إنستغرام', kind: 'url', ltr: true, hint: 'https://instagram.com/…' },
  { key: 'social.x', label: 'إكس (تويتر)', kind: 'url', ltr: true, hint: 'https://x.com/…' },
  { key: 'social.linkedin', label: 'لينكدإن', kind: 'url', ltr: true, hint: 'https://linkedin.com/…' },
  { key: 'social.youtube', label: 'يوتيوب', kind: 'url', ltr: true, hint: 'https://youtube.com/…' }
];
