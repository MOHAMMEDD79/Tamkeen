/**
 * A lived-in Jerusalem dataset for the public surface.
 *
 * Everything here hangs off the real organisations that `pnpm orgs:real` publishes, and it is
 * driven through the same services the product uses: a job is published by its employer, a
 * programme is approved by an independent content reviewer before its operator opens it, a
 * volunteer opportunity passes the same readiness check, and every contribution goes through the
 * contributions service and is confirmed by a signed event from the simulated payment port. No row
 * of money is written directly, so every public figure has a ledger behind it.
 *
 * The content is realistic for Jerusalem and the West Bank — restoration in the Old City, schools
 * behind the wall, clinics in Kufr Aqab — but the people are invented and every address ends in
 * .test. Amounts are in shekels.
 *
 * Run after: pnpm db:seed, pnpm demo:accounts, pnpm orgs:real.
 * Idempotent: anything it already created is skipped.
 *
 *   pnpm demo:jerusalem
 */

import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { ContributionsService } from '../apps/api/dist/modules/money/contributions.service.js';
import { SimulatedPaymentPort } from '../apps/api/dist/modules/money/payment-port.js';
import { JobsService } from '../apps/api/dist/modules/employment/jobs.service.js';
import { ProgramsService } from '../apps/api/dist/modules/programs/programs.service.js';
import { ApplicationsService } from '../apps/api/dist/modules/programs/applications.service.js';
import { VolunteeringService } from '../apps/api/dist/modules/enablement/volunteering.service.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:jerusalem refuses to run in ${config.environment}.`);
}

const TAG = 'quds-2026';
const day = 86_400_000;
const ago = (days: number) => new Date(Date.now() - days * day);
const ahead = (days: number) => new Date(Date.now() + days * day);
const minor = (major: number) => BigInt(major) * 100n;

const db = createDatabase(config.databaseUrl);
const port = new SimulatedPaymentPort(config.sessionSecret);
const money = new ContributionsService(db, port);
const jobs = new JobsService(db);
const programs = new ProgramsService(db);
const applications = new ApplicationsService(db);
const volunteering = new VolunteeringService(db);

type OrgKey = 'bmaq' | 'taawon' | 'prcs' | 'parc' | 'alnayzak';
const ORG_SLUG: Record<OrgKey, string> = {
  bmaq: 'bayt-mal-al-quds',
  taawon: 'taawon',
  prcs: 'prcs',
  parc: 'parc',
  alnayzak: 'alnayzak'
};

/** Invented people. Ordinary Jerusalem and West Bank names; every address is .test. */
const PEOPLE = [
  { key: 'lina', name: 'لينا عبد الهادي', city: 'القدس', headline: 'مهندسة معمارية — ترميم المباني التاريخية', skills: ['الترميم', 'AutoCAD', 'التوثيق المعماري'], education: 'بكالوريوس هندسة معمارية، جامعة بيرزيت' },
  { key: 'yousef', name: 'يوسف النتشة', city: 'القدس', headline: 'مسعف ومدرب إسعاف أولي', skills: ['الإسعاف الأولي', 'الاستجابة للطوارئ', 'التدريب'], education: 'دبلوم إسعاف طبي، كلية الأمة' },
  { key: 'ruba', name: 'ربى الجعبري', city: 'القدس', headline: 'أخصائية دعم نفسي اجتماعي', skills: ['الإرشاد النفسي', 'العمل مع الأطفال', 'إدارة الحالة'], education: 'ماجستير علم نفس مجتمعي، جامعة القدس' },
  { key: 'adam', name: 'آدم شويكي', city: 'القدس', headline: 'مطوّر ويب', skills: ['React', 'TypeScript', 'Node.js'], education: 'بكالوريوس علم حاسوب، جامعة القدس' },
  { key: 'nour', name: 'نور الدجاني', city: 'القدس', headline: 'معلمة علوم', skills: ['تدريس العلوم', 'المختبرات المدرسية', 'STEM'], education: 'بكالوريوس أحياء وأساليب تدريس' },
  { key: 'majd', name: 'مجد العباسي', city: 'القدس', headline: 'فني ترميم وحجر', skills: ['الحجر المقدسي', 'الترميم اليدوي', 'القصارة الجيرية'], education: 'تدريب مهني في الترميم، مركز البلدة القديمة' },
  { key: 'dima', name: 'ديمة قرعان', city: 'رام الله', headline: 'محاسبة مشاريع', skills: ['المحاسبة', 'التقارير للمانحين', 'Excel'], education: 'بكالوريوس محاسبة، جامعة بيرزيت' },
  { key: 'khaled', name: 'خالد أبو غوش', city: 'القدس', headline: 'منسق ميداني', skills: ['إدارة المشاريع', 'العمل المجتمعي', 'التنسيق'], education: 'بكالوريوس خدمة اجتماعية' },
  { key: 'sireen', name: 'سيرين الخطيب', city: 'القدس', headline: 'مصورة وموثقة تراث', skills: ['التصوير', 'التوثيق', 'الأرشفة الرقمية'], education: 'بكالوريوس إعلام، جامعة بيرزيت' },
  { key: 'omar', name: 'عمر صلاح الدين', city: 'بيت لحم', headline: 'مرشد زراعي', skills: ['الإرشاد الزراعي', 'الري', 'الزراعة العضوية'], education: 'بكالوريوس زراعة، جامعة الخليل' },
  { key: 'hanin', name: 'حنين زحايكة', city: 'القدس', headline: 'ممرضة', skills: ['التمريض', 'رعاية المسنين', 'الصحة المجتمعية'], education: 'بكالوريوس تمريض، جامعة القدس' },
  { key: 'tareq', name: 'طارق عليان', city: 'القدس', headline: 'مهندس مدني', skills: ['الإشراف الهندسي', 'الكميات', 'السلامة'], education: 'بكالوريوس هندسة مدنية، جامعة النجاح' },
  { key: 'aya', name: 'آية بشارات', city: 'القدس', headline: 'منسقة إعلام رقمي', skills: ['إدارة المحتوى', 'التصميم', 'وسائل التواصل'], education: 'بكالوريوس علاقات عامة' },
  { key: 'bashar', name: 'بشار إدكيدك', city: 'القدس', headline: 'طالب هندسة — متطوع', skills: ['التطوع', 'العمل الجماعي'], education: 'سنة ثالثة هندسة، جامعة القدس' },
  { key: 'salma', name: 'سلمى الرشق', city: 'القدس', headline: 'أخصائية تربية خاصة', skills: ['التربية الخاصة', 'صعوبات التعلم'], education: 'بكالوريوس تربية خاصة' },
  { key: 'raed', name: 'رائد الترهي', city: 'القدس', headline: 'فني كهرباء', skills: ['الكهرباء', 'الصيانة', 'السلامة المهنية'], education: 'دبلوم كهرباء، كلية الأيتام الصناعية' }
];

/**
 * Charity projects. Written as db rows the way the seed writes them, because a published
 * project's plan is frozen once it is public and the services refuse to add one afterwards.
 */
const PROJECTS: Array<{ key: string; org: OrgKey; title: string; summary: string; story: string; city: 'القدس' | 'بيت لحم'; state: 'published' | 'executing'; publishedDaysAgo: number; goal: number; policy: 'flexible' | 'all_or_nothing'; lines: Array<[string, number]>; milestones: Array<[string, number, number]> }> = [
  {
    key: 'old-city-homes', org: 'bmaq', title: 'ترميم منازل مقدسية في البلدة القديمة',
    summary: 'ترميم اثني عشر منزلاً مأهولاً داخل أسوار البلدة القديمة: معالجة الرطوبة والأسقف المتضررة وشبكات المياه، مع الحفاظ على الطابع المعماري للحجر المقدسي.',
    story: 'كثير من منازل البلدة القديمة قائمة منذ قرون، ويعيش فيها اليوم أهلها الذين لا يستطيعون ترميمها بسبب كلفة الأعمال وقيود التراخيص.\nيبدأ العمل بمسح هندسي لكل منزل، ثم معالجة الأسقف والرطوبة، ثم شبكات المياه والكهرباء.\nالأولوية للمنازل التي تسكنها عائلات كبيرة أو كبار سن.',
    city: 'القدس', state: 'executing', publishedDaysAgo: 96, goal: 300_000, policy: 'flexible',
    lines: [['أعمال الترميم الإنشائي', 165_000], ['معالجة الأسقف والعزل', 80_000], ['شبكات المياه والكهرباء', 55_000]],
    milestones: [['المسح الهندسي وترميم أربعة منازل', 110_000, 35], ['ترميم أربعة منازل إضافية', 110_000, 35], ['إنجاز المنازل الأربعة الأخيرة والتسليم', 80_000, 30]]
  },
  {
    key: 'school-steadfastness', org: 'bmaq', title: 'دعم صمود طلبة مدارس القدس',
    summary: 'تغطية المواصلات والزي والقرطاسية لثلاثمئة طالب وطالبة في مدارس القدس، وخاصة الأحياء التي يفصلها الجدار عن مدارسها.',
    story: 'الطالب في كفر عقب أو مخيم شعفاط قد يقضي ساعة ونصفاً في الطريق إلى مدرسته، وكلفة المواصلات وحدها ترهق الأسرة.\nيغطي المشروع بدل المواصلات لسنة دراسية كاملة، مع الزي والقرطاسية لمن تحددهم المدارس.',
    city: 'القدس', state: 'executing', publishedDaysAgo: 74, goal: 180_000, policy: 'flexible',
    lines: [['بدل المواصلات', 95_000], ['الزي المدرسي', 45_000], ['القرطاسية والحقائب', 40_000]],
    milestones: [['الفصل الدراسي الأول', 95_000, 50], ['الفصل الدراسي الثاني', 85_000, 50]]
  },
  {
    key: 'mobile-clinic', org: 'bmaq', title: 'عيادة متنقلة لأحياء خلف الجدار',
    summary: 'تجهيز وتشغيل عيادة متنقلة تخدم كفر عقب ومخيم شعفاط وضواحي القدس التي تفصلها الحواجز عن مستشفياتها.',
    story: 'الأحياء الواقعة خلف الجدار تتبع بلدية القدس إدارياً، لكن الوصول إلى مستشفياتها يمر بحاجز.\nتوفر العيادة المتنقلة طب الأسرة وصحة الأم والطفل والفحوصات الأساسية بجولات أسبوعية ثابتة.',
    city: 'القدس', state: 'published', publishedDaysAgo: 41, goal: 220_000, policy: 'all_or_nothing',
    lines: [['تجهيز المركبة الطبية', 120_000], ['المعدات والأجهزة', 60_000], ['تشغيل ستة أشهر', 40_000]],
    milestones: [['تجهيز المركبة', 120_000, 50], ['المعدات وبدء الجولات', 100_000, 50]]
  },
  {
    key: 'old-city-alleys', org: 'taawon', title: 'إحياء أزقة البلدة القديمة',
    summary: 'إعادة تأهيل ثلاثة أزقة في حارة السعدية: البلاط الحجري والإنارة وتصريف المياه، مع إعادة تشغيل محال حرفية مغلقة.',
    story: 'الزقاق المهمل يفرغ الحارة من أهلها قبل أن يفرغها أي شيء آخر.\nيشمل العمل البلاط الحجري وتصريف مياه الشتاء والإنارة، ثم دعم أصحاب المحال الحرفية لإعادة فتحها.',
    city: 'القدس', state: 'published', publishedDaysAgo: 58, goal: 400_000, policy: 'flexible',
    lines: [['البلاط الحجري وتصريف المياه', 230_000], ['الإنارة والبنية التحتية', 90_000], ['دعم المحال الحرفية', 80_000]],
    milestones: [['الزقاق الأول', 140_000, 35], ['الزقاق الثاني والثالث', 180_000, 40], ['إعادة تشغيل المحال', 80_000, 25]]
  },
  {
    key: 'children-library', org: 'taawon', title: 'مكتبة الطفل المقدسي',
    summary: 'تجهيز مكتبة ومركز نشاطات للأطفال في حي وادي الجوز، بثلاثة آلاف عنوان بالعربية وبرنامج قراءة أسبوعي.',
    story: 'لا تملك أحياء كثيرة في القدس مكاناً عاماً يقرأ فيه الأطفال بعد المدرسة.\nيجهّز المشروع قاعة قراءة ومسرحاً صغيراً، ويشغّل برنامجاً أسبوعياً بإشراف أخصائيات.',
    city: 'القدس', state: 'executing', publishedDaysAgo: 120, goal: 120_000, policy: 'flexible',
    lines: [['تجهيز القاعة والأثاث', 55_000], ['الكتب والمقتنيات', 40_000], ['تشغيل البرنامج سنة', 25_000]],
    milestones: [['تجهيز القاعة', 55_000, 45], ['الكتب وافتتاح المكتبة', 65_000, 55]]
  },
  {
    key: 'silwan-ambulance', org: 'prcs', title: 'تجهيز نقطة إسعاف في سلوان',
    summary: 'نقطة إسعاف ثابتة في سلوان بسيارة إسعاف مجهزة وطاقم على مدار الساعة، لتقصير زمن الوصول في حي يسكنه أكثر من خمسين ألفاً.',
    story: 'زمن وصول الإسعاف إلى داخل سلوان يطول بسبب ضيق الطرق وإغلاقها المتكرر.\nتضع النقطة الثابتة سيارة وطاقماً داخل الحي نفسه بدل انتظار قدومهما من خارجه.',
    city: 'القدس', state: 'published', publishedDaysAgo: 33, goal: 260_000, policy: 'all_or_nothing',
    lines: [['سيارة إسعاف مجهزة', 170_000], ['تجهيز النقطة', 50_000], ['تدريب الطاقم', 40_000]],
    milestones: [['تجهيز النقطة والتدريب', 90_000, 40], ['سيارة الإسعاف والتشغيل', 170_000, 60]]
  },
  {
    key: 'home-gardens', org: 'parc', title: 'حدائق منزلية في أحياء القدس',
    summary: 'إنشاء مئة حديقة منزلية في بيت حنينا وصور باهر والعيسوية، مع شتلات وأنظمة ري موفرة وإرشاد زراعي لسنة.',
    story: 'الحديقة المنزلية لا تطعم عائلة بالكامل، لكنها تخفض فاتورة الخضار وتبقي الأرض مستعملة.\nيحصل كل بيت على شتلات وحوض ري موفر وزيارتي إرشاد في الموسم.',
    city: 'القدس', state: 'published', publishedDaysAgo: 27, goal: 95_000, policy: 'flexible',
    lines: [['الشتلات والتربة', 38_000], ['أنظمة الري', 37_000], ['الإرشاد الزراعي', 20_000]],
    milestones: [['خمسون حديقة', 47_000, 50], ['الخمسون الأخرى والمتابعة', 48_000, 50]]
  },
  {
    key: 'mobile-lab', org: 'alnayzak', title: 'مختبر علوم متنقل لمدارس القدس',
    summary: 'حافلة مجهزة كمختبر علوم تزور عشرين مدرسة في القدس وضواحيها، لتشغيل تجارب عملية في المدارس التي لا مختبر فيها.',
    story: 'كثير من مدارس القدس تدرّس العلوم دون مختبر صالح للاستعمال.\nيصل المختبر المتنقل إلى المدرسة بجدول ثابت، ويشغّل حصصاً عملية بإشراف مدربين.',
    city: 'القدس', state: 'published', publishedDaysAgo: 52, goal: 150_000, policy: 'flexible',
    lines: [['تجهيز الحافلة', 85_000], ['أجهزة ومواد المختبر', 45_000], ['تشغيل الجولة الأولى', 20_000]],
    milestones: [['تجهيز الحافلة', 85_000, 55], ['الأجهزة وبدء الجولات', 65_000, 45]]
  }
];

/** Salaries are monthly shekels, written in minor units the way the money code expects. */
const JOBS: Array<{ org: OrgKey; title: string; summary: string; responsibilities: string; requirements: string; skills: string[]; contract: 'full_time' | 'part_time' | 'fixed_term' | 'apprenticeship'; months?: number; mode: 'in_person' | 'remote' | 'hybrid'; city: string; hours: number; pay?: [number, number]; reason?: string; postedDaysAgo: number; closesIn: number; openings: number }> = [
  {
    org: 'bmaq', title: 'منسق/ة مشاريع ميداني — القدس',
    summary: 'متابعة تنفيذ مشاريع الترميم والدعم التعليمي داخل أحياء القدس، والتنسيق مع العائلات والمدارس والمقاولين.',
    responsibilities: 'زيارات ميدانية أسبوعية، وإعداد تقارير التقدم، والتنسيق مع المقاولين والمدارس، ومتابعة شكاوى المستفيدين.',
    requirements: 'بكالوريوس في الخدمة الاجتماعية أو إدارة المشاريع أو ما يعادلها، وخبرة سنتين في العمل الميداني، وهوية مقدسية أو تصريح عمل ساري، ورخصة سياقة.',
    skills: ['إدارة المشاريع', 'العمل المجتمعي', 'التقارير'], contract: 'full_time', mode: 'in_person', city: 'القدس', hours: 40, pay: [4800, 6200], postedDaysAgo: 22, closesIn: 12, openings: 2
  },
  {
    org: 'bmaq', title: 'محاسب/ة مشاريع',
    summary: 'إدارة موازنات المشاريع والصرف على المراحل وإعداد التقارير المالية للمانحين.',
    responsibilities: 'مسك دفاتر المشاريع، ومطابقة المصروفات بالموازنات، وإعداد التقارير الدورية للمانحين، والتحضير للتدقيق السنوي.',
    requirements: 'بكالوريوس محاسبة، وخبرة ثلاث سنوات في مؤسسة أهلية، وإتقان Excel وأحد أنظمة المحاسبة.',
    skills: ['المحاسبة', 'التقارير المالية', 'Excel'], contract: 'full_time', mode: 'hybrid', city: 'القدس', hours: 40, pay: [5500, 7000], postedDaysAgo: 16, closesIn: 18, openings: 1
  },
  {
    org: 'bmaq', title: 'فني/ة ترميم وحجر — البلدة القديمة',
    summary: 'تنفيذ أعمال الترميم اليدوي في منازل البلدة القديمة: الحجر والقصارة الجيرية ومعالجة الرطوبة.',
    responsibilities: 'أعمال الحجر والقصارة، ومعالجة الرطوبة والأسقف، والعمل ضمن فريق داخل منازل مأهولة.',
    requirements: 'خبرة عملية في الترميم أو البناء الحجري، والقدرة على العمل في مساحات ضيقة، والالتزام بمعايير السلامة.',
    skills: ['الحجر المقدسي', 'الترميم', 'القصارة الجيرية'], contract: 'full_time', mode: 'in_person', city: 'القدس', hours: 42, pay: [4200, 5000], postedDaysAgo: 9, closesIn: 20, openings: 3
  },
  {
    org: 'taawon', title: 'مهندس/ة مدني للإشراف على الترميم',
    summary: 'الإشراف الهندسي على مشاريع إعمار البلدة القديمة، من المسح حتى التسليم.',
    responsibilities: 'إعداد المخططات وجداول الكميات، والإشراف اليومي على المقاولين، وضبط الجودة، وتوثيق مراحل العمل.',
    requirements: 'بكالوريوس هندسة مدنية أو معمارية، وخبرة ثلاث سنوات في الترميم أو الإشراف، ومزاولة مهنة سارية.',
    skills: ['الإشراف الهندسي', 'جداول الكميات', 'الترميم'], contract: 'fixed_term', months: 18, mode: 'in_person', city: 'القدس', hours: 40, pay: [6500, 8000], postedDaysAgo: 28, closesIn: 8, openings: 1
  },
  {
    org: 'taawon', title: 'أخصائي/ة توثيق تراثي',
    summary: 'توثيق المباني التاريخية في البلدة القديمة بالصور والقياسات وبناء أرشيف رقمي متاح للباحثين.',
    responsibilities: 'المسح الميداني والتصوير، وإدخال البيانات في الأرشيف الرقمي، وكتابة البطاقات الوصفية لكل مبنى.',
    requirements: 'خلفية في العمارة أو الآثار أو التوثيق، وإتقان التصوير المعماري، والدقة في إدخال البيانات.',
    skills: ['التوثيق', 'التصوير المعماري', 'الأرشفة الرقمية'], contract: 'part_time', mode: 'hybrid', city: 'القدس', hours: 22,
    reason: 'الأجر يُحدد بعدد المباني الموثقة حسب جدول معلن، ويُشرح بالكامل في المقابلة الأولى قبل أي عرض.', postedDaysAgo: 13, closesIn: 22, openings: 2
  },
  {
    org: 'prcs', title: 'مسعف/ة — القدس',
    summary: 'العمل ضمن طاقم الإسعاف في القدس على مدار نوبات، والاستجابة لبلاغات الطوارئ داخل الأحياء.',
    responsibilities: 'الاستجابة للبلاغات، وتقديم الإسعاف الأولي والنقل، وتعبئة تقارير الحالات، وصيانة تجهيزات المركبة.',
    requirements: 'دبلوم إسعاف طبي أو تمريض، ورخصة مزاولة سارية، ورخصة سياقة، والاستعداد للعمل بنظام النوبات.',
    skills: ['الإسعاف الأولي', 'الاستجابة للطوارئ'], contract: 'full_time', mode: 'in_person', city: 'القدس', hours: 45, pay: [4500, 5400], postedDaysAgo: 19, closesIn: 15, openings: 4
  },
  {
    org: 'prcs', title: 'ممرض/ة عيادة — كفر عقب',
    summary: 'العمل في عيادة كفر عقب: الفحوصات الأولية ومتابعة الأمراض المزمنة وصحة الأم والطفل.',
    responsibilities: 'استقبال المرضى وقياس المؤشرات، ومتابعة المزمنين، وتنفيذ برنامج التطعيم، وحفظ السجلات.',
    requirements: 'بكالوريوس تمريض ومزاولة سارية، وخبرة سنة في العيادات، والقدرة على الوصول إلى كفر عقب يومياً.',
    skills: ['التمريض', 'الصحة المجتمعية'], contract: 'full_time', mode: 'in_person', city: 'القدس', hours: 40, pay: [4800, 5800], postedDaysAgo: 11, closesIn: 17, openings: 2
  },
  {
    org: 'prcs', title: 'أخصائي/ة دعم نفسي اجتماعي',
    summary: 'تقديم الدعم النفسي الاجتماعي للأطفال والعائلات في أحياء القدس، بجلسات فردية وجماعية.',
    responsibilities: 'إدارة الحالات، وجلسات فردية وجماعية في المدارس والمراكز، والتحويل إلى الخدمات المتخصصة عند الحاجة.',
    requirements: 'ماجستير في علم النفس أو الإرشاد، وخبرة سنتين مع الأطفال، والقدرة على العمل داخل المدارس.',
    skills: ['الإرشاد النفسي', 'إدارة الحالة', 'العمل مع الأطفال'], contract: 'fixed_term', months: 12, mode: 'in_person', city: 'القدس', hours: 35, pay: [5200, 6400], postedDaysAgo: 6, closesIn: 24, openings: 1
  },
  {
    org: 'parc', title: 'مرشد/ة زراعي — القدس وضواحيها',
    summary: 'متابعة الحدائق المنزلية وإرشاد الأسر في بيت حنينا وصور باهر والعيسوية.',
    responsibilities: 'زيارات إرشادية دورية، وتدريب الأسر على الري والتسميد، وتوثيق إنتاج الحدائق.',
    requirements: 'بكالوريوس زراعة، وخبرة في الإرشاد الميداني، ورخصة سياقة.',
    skills: ['الإرشاد الزراعي', 'الري', 'الزراعة العضوية'], contract: 'full_time', mode: 'in_person', city: 'القدس', hours: 40, pay: [4300, 5200], postedDaysAgo: 14, closesIn: 19, openings: 1
  },
  {
    org: 'alnayzak', title: 'مدرب/ة علوم وتكنولوجيا',
    summary: 'تشغيل حصص المختبر المتنقل في مدارس القدس وتدريب المعلمين على التجارب العملية.',
    responsibilities: 'تنفيذ الحصص العملية داخل المدارس، وتحضير المواد، وتدريب معلمي المدرسة على تكرار التجربة.',
    requirements: 'بكالوريوس في العلوم أو الهندسة أو التربية، وخبرة في التدريب، ومهارات تواصل ممتازة مع الطلبة.',
    skills: ['تدريس العلوم', 'STEM', 'التدريب'], contract: 'part_time', mode: 'in_person', city: 'القدس', hours: 24, pay: [3200, 3800], postedDaysAgo: 8, closesIn: 21, openings: 3
  },
  {
    org: 'alnayzak', title: 'منسق/ة برامج شبابية',
    summary: 'تنسيق برامج الريادة والابتكار للشباب المقدسي، من التسجيل حتى مشاريع التخرج.',
    responsibilities: 'فتح التسجيل وفرز الطلبات، وجدولة الجلسات والمرشدين، ومتابعة مشاريع التخرج وقياس الأثر.',
    requirements: 'بكالوريوس في أي تخصص، وخبرة سنتين في إدارة البرامج، وتنظيم عالٍ.',
    skills: ['إدارة البرامج', 'تمكين الشباب', 'التنسيق'], contract: 'full_time', mode: 'hybrid', city: 'القدس', hours: 40, pay: [4600, 5600], postedDaysAgo: 4, closesIn: 26, openings: 1
  },
  {
    org: 'bmaq', title: 'فني/ة كهرباء وصيانة',
    summary: 'صيانة الشبكات الكهربائية في المنازل المرممة والمرافق التابعة للوكالة في القدس.',
    responsibilities: 'تمديد وصيانة الشبكات، وفحص السلامة الكهربائية، والاستجابة لأعطال المرافق.',
    requirements: 'دبلوم كهرباء ورخصة فني سارية، وخبرة سنتين، والالتزام بمعايير السلامة.',
    skills: ['الكهرباء', 'الصيانة', 'السلامة المهنية'], contract: 'full_time', mode: 'in_person', city: 'القدس', hours: 42, pay: [4000, 4800], postedDaysAgo: 25, closesIn: 10, openings: 2
  }
];

const PROGRAMS: Array<{ org: OrgKey; title: string; summary: string; skills: string[]; level: string; city: string; capacity: number; weeks: number; hours: number; closesIn: number; jobs: { kind: 'none' | 'expected'; count: number; terms: string } }> = [
  {
    org: 'taawon', title: 'الترميم والحرف التقليدية في البلدة القديمة',
    summary: 'تدريب عملي على الحجر المقدسي والقصارة الجيرية ومعالجة الرطوبة، داخل ورش ترميم حقيقية في البلدة القديمة بإشراف حرفيين.',
    skills: ['الحجر المقدسي', 'القصارة الجيرية', 'الترميم'], level: 'مبتدئ', city: 'القدس', capacity: 16, weeks: 16, hours: 20, closesIn: 11,
    jobs: { kind: 'expected', count: 6, terms: 'ست فرص عمل مستهدفة لدى مقاولي الترميم الشركاء عند إنجاز المشروع، غير ملزمة، ومعاييرها تُعلن قبل نهاية البرنامج.' }
  },
  {
    org: 'alnayzak', title: 'STEM للفتيات — القدس',
    summary: 'برنامج علوم وهندسة وبرمجة للطالبات من الصف العاشر إلى الثاني عشر في القدس، بمشروع تخرج تطبيقي لكل مجموعة ومرشدة من المجال.',
    skills: ['البرمجة', 'الإلكترونيات', 'حل المشكلات'], level: 'مبتدئ', city: 'القدس', capacity: 25, weeks: 12, hours: 8, closesIn: 16,
    jobs: { kind: 'none', count: 0, terms: '' }
  },
  {
    org: 'prcs', title: 'الإسعاف الأولي المجتمعي',
    summary: 'تأهيل متطوعين من الأحياء على الإسعاف الأولي والإنعاش القلبي الرئوي والتعامل مع الإصابات، بتمارين ميدانية وشهادة معتمدة.',
    skills: ['الإسعاف الأولي', 'الإنعاش القلبي الرئوي', 'إدارة الإصابات'], level: 'مبتدئ', city: 'القدس', capacity: 30, weeks: 6, hours: 6, closesIn: 9,
    jobs: { kind: 'none', count: 0, terms: '' }
  },
  {
    org: 'bmaq', title: 'المهارات الرقمية وريادة الأعمال للشباب المقدسي',
    summary: 'من المهارات الرقمية الأساسية إلى بناء نموذج عمل وعرضه على لجنة، مع مرافقة فردية لأصحاب الأفكار الجاهزة للتنفيذ.',
    skills: ['المهارات الرقمية', 'نموذج العمل', 'العرض والإقناع'], level: 'مبتدئ', city: 'القدس', capacity: 22, weeks: 10, hours: 12, closesIn: 20,
    jobs: { kind: 'expected', count: 4, terms: 'أربع فرص تدريب مدفوع لدى شركات شريكة في القدس ورام الله، غير ملزمة.' }
  }
];

const VOLUNTEERING: Array<{ org: OrgKey; title: string; summary: string; tasks: string; requirements: string; city: string; capacity: number; hours: number; startsInDays: number; weeks: number }> = [
  {
    org: 'prcs', title: 'متطوع/ة إسعاف ميداني',
    summary: 'الانضمام إلى فرق الإسعاف التطوعية في القدس لتغطية الفعاليات والجولات المجتمعية والدعم أثناء الذروة.',
    tasks: 'المشاركة في نوبة أسبوعية مع طاقم مؤهل، وتجهيز حقائب الإسعاف، والمساعدة في تغطية الفعاليات العامة، وتعبئة تقرير النوبة.',
    requirements: 'إتمام دورة الإسعاف الأولي المجتمعي أو ما يعادلها، والعمر فوق ثمانية عشر عاماً، والالتزام بنوبة أسبوعية ثابتة.',
    city: 'القدس', capacity: 25, hours: 6, startsInDays: 12, weeks: 26
  },
  {
    org: 'bmaq', title: 'مرافقة طلبة المدارس في البلدة القديمة',
    summary: 'مرافقة مجموعات الطلبة في طريقهم بين بوابات البلدة القديمة ومدارسهم صباحاً وبعد الدوام، ضمن فرق ثابتة معروفة للأهالي.',
    tasks: 'التواجد عند نقطة التجمع قبل الدوام، ومرافقة المجموعة حتى باب المدرسة، والإبلاغ عن أي حادث للمنسق، وتعبئة سجل الحضور.',
    requirements: 'العمر فوق عشرين عاماً، والمعرفة بأزقة البلدة القديمة، والالتزام بثلاثة صباحات أسبوعياً خلال العام الدراسي.',
    city: 'القدس', capacity: 18, hours: 6, startsInDays: 7, weeks: 30
  },
  {
    org: 'taawon', title: 'توثيق المباني التاريخية بالتصوير',
    summary: 'المساهمة في بناء أرشيف رقمي لمباني البلدة القديمة: التصوير الميداني وتعبئة البطاقات الوصفية لكل مبنى موثق.',
    tasks: 'تصوير واجهات المباني وتفاصيلها حسب دليل التصوير، وتعبئة بطاقة وصفية لكل مبنى، ورفع الملفات إلى الأرشيف أسبوعياً.',
    requirements: 'كاميرا أو هاتف بجودة جيدة، ومعرفة أساسية بالتصوير، والالتزام بأربع ساعات أسبوعياً لثلاثة أشهر.',
    city: 'القدس', capacity: 12, hours: 4, startsInDays: 15, weeks: 12
  },
  {
    org: 'parc', title: 'حملة تشجير في أحياء القدس',
    summary: 'المشاركة في أيام تشجير جماعية في بيت حنينا وصور باهر والعيسوية، بزراعة الشتلات ومتابعة ريّها في الأسابيع الأولى.',
    tasks: 'حفر الجور وزراعة الشتلات في أيام الحملة، ومتابعة الري خلال الأسابيع الأربعة الأولى، وتسجيل حالة الشتلات في النموذج.',
    requirements: 'لا خبرة مطلوبة، واللياقة للعمل في الهواء الطلق، والالتزام بيومين في الشهر.',
    city: 'القدس', capacity: 40, hours: 5, startsInDays: 20, weeks: 10
  }
];

/** [person, amount in shekels, visibility, show the amount, days ago]. */
const CONTRIBUTIONS: Record<string, Array<[string, number, 'named' | 'anonymous', boolean, number]>> = {
  'old-city-homes': [['lina', 50_000, 'named', true, 88], ['tareq', 35_000, 'anonymous', false, 81], ['dima', 25_000, 'named', true, 70], ['khaled', 20_000, 'named', false, 63], ['donor', 18_000, 'named', true, 55], ['majd', 12_000, 'anonymous', false, 44], ['sireen', 10_000, 'named', true, 31], ['aya', 7_500, 'named', false, 22], ['raed', 5_000, 'anonymous', false, 12], ['bashar', 2_500, 'named', true, 4]],
  'school-steadfastness': [['nour', 30_000, 'named', true, 68], ['salma', 20_000, 'named', true, 59], ['ruba', 15_000, 'anonymous', false, 47], ['donor', 10_000, 'named', false, 36], ['hanin', 6_000, 'named', true, 25], ['adam', 3_000, 'named', false, 16], ['omar', 1_500, 'anonymous', false, 8], ['bashar', 900, 'named', true, 2]],
  'mobile-clinic': [['hanin', 20_000, 'named', true, 37], ['yousef', 12_000, 'named', true, 29], ['ruba', 8_000, 'anonymous', false, 20], ['donor', 4_000, 'named', false, 13], ['salma', 1_500, 'named', true, 6], ['bashar', 700, 'anonymous', false, 1]],
  'old-city-alleys': [['tareq', 80_000, 'named', true, 54], ['lina', 60_000, 'named', true, 45], ['majd', 40_000, 'anonymous', false, 36], ['khaled', 20_000, 'named', false, 27], ['sireen', 12_000, 'named', true, 18], ['aya', 5_000, 'named', true, 9], ['adam', 3_000, 'anonymous', false, 3]],
  'children-library': [['salma', 30_000, 'named', true, 110], ['nour', 25_000, 'named', true, 95], ['ruba', 15_000, 'anonymous', false, 78], ['dima', 10_000, 'named', false, 60], ['aya', 5_000, 'named', true, 40], ['sireen', 1_600, 'named', true, 21], ['bashar', 1_000, 'anonymous', false, 5]],
  'silwan-ambulance': [['yousef', 15_000, 'named', true, 29], ['hanin', 10_000, 'named', true, 21], ['donor', 4_000, 'named', false, 14], ['khaled', 1_500, 'anonymous', false, 7], ['bashar', 700, 'named', true, 2]],
  'home-gardens': [['omar', 12_000, 'named', true, 24], ['raed', 9_000, 'named', false, 18], ['dima', 6_000, 'anonymous', false, 12], ['lina', 3_000, 'named', true, 7], ['adam', 1_500, 'named', true, 3], ['bashar', 800, 'anonymous', false, 1]],
  'mobile-lab': [['nour', 25_000, 'named', true, 48], ['adam', 15_000, 'named', true, 38], ['tareq', 10_000, 'anonymous', false, 27], ['donor', 6_000, 'named', false, 17], ['sireen', 3_000, 'named', true, 9], ['bashar', 1_000, 'named', true, 2]]
};

/** Who applied to what, so the boards are not empty. */
const JOB_APPLICANTS: Record<string, string[]> = {
  'منسق/ة مشاريع ميداني — القدس': ['khaled', 'aya', 'jobseeker'],
  'محاسب/ة مشاريع': ['dima', 'jobseeker'],
  'فني/ة ترميم وحجر — البلدة القديمة': ['majd', 'raed', 'bashar'],
  'مهندس/ة مدني للإشراف على الترميم': ['tareq', 'lina'],
  'أخصائي/ة توثيق تراثي': ['sireen', 'lina', 'aya'],
  'مسعف/ة — القدس': ['yousef', 'bashar', 'hanin'],
  'ممرض/ة عيادة — كفر عقب': ['hanin', 'ruba'],
  'أخصائي/ة دعم نفسي اجتماعي': ['ruba', 'salma'],
  'مرشد/ة زراعي — القدس وضواحيها': ['omar'],
  'مدرب/ة علوم وتكنولوجيا': ['nour', 'adam', 'bashar'],
  'منسق/ة برامج شبابية': ['aya', 'khaled'],
  'فني/ة كهرباء وصيانة': ['raed', 'majd']
};

const PROGRAM_APPLICANTS: Record<string, string[]> = {
  'الترميم والحرف التقليدية في البلدة القديمة': ['majd', 'raed', 'bashar', 'jobseeker'],
  'STEM للفتيات — القدس': ['nour', 'salma', 'aya', 'sireen'],
  'الإسعاف الأولي المجتمعي': ['bashar', 'hanin', 'khaled', 'omar', 'volunteer'],
  'المهارات الرقمية وريادة الأعمال للشباب المقدسي': ['adam', 'aya', 'bashar', 'jobseeker']
};

/** [person, accepted, hours logged]. An accepted volunteer with hours is what makes a board look worked. */
const VOLUNTEERS: Record<string, Array<[string, boolean, number[]]>> = {
  'متطوع/ة إسعاف ميداني': [['bashar', true, [6, 6, 5]], ['yousef', true, [6, 6]], ['hanin', true, [5]], ['volunteer', true, [6, 4]], ['khaled', false, []]],
  'مرافقة طلبة المدارس في البلدة القديمة': [['majd', true, [6, 6, 6, 6]], ['salma', true, [6, 6]], ['volunteer', true, [6]], ['aya', false, []]],
  'توثيق المباني التاريخية بالتصوير': [['sireen', true, [4, 4, 4]], ['lina', true, [4]], ['adam', false, []]],
  'حملة تشجير في أحياء القدس': [['omar', true, [5, 5]], ['bashar', true, [5]], ['raed', true, [5]], ['volunteer', false, []]]
};

const ensureUser = async (email: string, name: string) => {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({ data: { email, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
};

const counts = { people: 0, projects: 0, contributions: 0, jobs: 0, jobApplications: 0, programs: 0, programApplications: 0, opportunities: 0, volunteers: 0, hours: 0 };

try {
  // --- the ground the rest stands on -------------------------------------------------------------
  const jerusalem = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Jerusalem' } });
  const bethlehem = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Bethlehem' } });
  const cityId = { 'القدس': jerusalem.id, 'بيت لحم': bethlehem.id };

  const admin = await db.platformGrant.findFirst({ where: { role: 'PlatformAdmin', revokedAt: null }, select: { userId: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('No platform admin. Run pnpm demo:accounts first.');

  const reviewer = await db.user.findUnique({ where: { email: 'content-reviewer@tamkeen.test' } });
  if (!reviewer) throw new Error('No content reviewer. Run pnpm demo:accounts first.');

  const orgs = new Map<OrgKey, string>();
  for (const [key, slug] of Object.entries(ORG_SLUG) as Array<[OrgKey, string]>) {
    const org = await db.organization.findUnique({ where: { slug } });
    if (!org) throw new Error(`Organisation ${slug} is missing. Run pnpm orgs:real first.`);
    // Publishing a job, a programme or an opportunity all require a verified employer.
    if (org.verification !== 'verified') await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    // Owner alone does not carry job, programme or volunteer management; the holder needs the
    // operating roles too until the organisation's own staff take them over.
    const membership = await db.membership.findUnique({ where: { userId_organizationId: { userId: admin.userId, organizationId: org.id } } });
    if (membership) {
      const roles = [...new Set([...membership.roles, 'Recruiter', 'ProgramManager', 'VolunteerCoordinator'])];
      if (roles.length !== membership.roles.length) await db.membership.update({ where: { userId_organizationId: { userId: admin.userId, organizationId: org.id } }, data: { roles } });
    }
    orgs.set(key, org.id);
  }

  // --- the people ---------------------------------------------------------------------------------
  const userIds = new Map<string, string>();
  for (const person of PEOPLE) {
    const user = await ensureUser(`${TAG}-${person.key}@quds.test`, person.name);
    if (!userIds.has(person.key)) counts.people += 1;
    userIds.set(person.key, user.id);
    // A candidate profile is what makes an application submittable at all.
    if (!await db.candidateProfile.findUnique({ where: { userId: user.id } })) {
      await applications.saveProfile(user.id, {
        headline: person.headline, city: person.city, skills: person.skills, education: person.education,
        summary: `${person.headline}. مقيم/ة في ${person.city}. حساب تجريبي.`,
        availability: 'متاح/ة للعمل خلال شهر', shareWithOperators: true, shareContact: false
      });
    }
  }
  // The signed-in test accounts take part too, so a role that logs in finds its own history.
  for (const email of ['donor', 'jobseeker', 'volunteer']) {
    const user = await db.user.findUnique({ where: { email: `${email}@tamkeen.test` } });
    if (!user) continue;
    userIds.set(email, user.id);
    if (!await db.candidateProfile.findUnique({ where: { userId: user.id } })) {
      await applications.saveProfile(user.id, {
        headline: 'حساب اختبار', city: 'القدس', skills: ['التطوع'], summary: 'حساب اختبار للمنصة.',
        availability: 'متاح', shareWithOperators: true, shareContact: false
      });
    }
  }

  // --- projects, with the plan a charity project needs before it can take money -------------------
  for (const project of PROJECTS) {
    const organizationId = orgs.get(project.org)!;
    const slug = `${TAG}-${project.key}`;
    const existing = await db.project.findUnique({ where: { slug } });
    const record = existing ?? await db.project.create({
      data: {
        organizationId, type: 'charity', slug, title: project.title, summary: project.summary, story: project.story,
        state: project.state, managerId: admin.userId, createdBy: admin.userId, cityId: cityId[project.city],
        publicLocationPrecision: 'city', latitude: null, longitude: null,
        publishedAt: ago(project.publishedDaysAgo), createdAt: ago(project.publishedDaysAgo + 14)
      }
    });
    if (!existing) counts.projects += 1;
    if (!await db.campaign.findUnique({ where: { projectId: record.id } })) {
      await db.campaign.create({ data: { projectId: record.id, goalMinor: minor(project.goal), currency: 'ILS', policy: project.policy, endsAt: ahead(90), createdAt: ago(project.publishedDaysAgo) } });
      await db.budgetLine.createMany({ data: project.lines.map(([label, amount], index) => ({ projectId: record.id, label, amountMinor: minor(amount), sortOrder: index })) });
      await db.milestone.createMany({ data: project.milestones.map(([title, amount, weight], index) => ({ projectId: record.id, sequence: index + 1, title, budgetMinor: minor(amount), weight })) });
    }
  }

  // --- money, through the contributions service and a signed provider event ----------------------
  for (const [key, entries] of Object.entries(CONTRIBUTIONS)) {
    const slug = `${TAG}-${key}`;
    const project = await db.project.findUnique({ where: { slug }, select: { id: true } });
    if (!project) continue;
    for (const [personKey, amount, visibility, showAmount, daysAgo] of entries) {
      const userId = userIds.get(personKey);
      if (!userId) continue;
      const idempotencyKey = `${TAG}-${key}-${personKey}-${amount}`;
      // The contribution row carries no key of its own, so a re-run is recognised by this payer
      // already having a good contribution on this project, exactly as demo:money does it.
      if (await db.contribution.findFirst({ where: { projectId: project.id, payer: { userId }, state: { in: ['succeeded', 'partially_refunded'] } } })) continue;
      try {
        const quote = await money.quote(slug, String(amount * 100));
        const contribution = await money.createContribution(userId, idempotencyKey, {
          projectSlug: slug, amountMinor: quote.amountMinor, visibility,
          showAmountPublicly: showAmount, acceptedQuoteFeeMinor: quote.feeMinor
        });
        const reference = contribution.providerRedirectPath.split('/').at(-1)!;
        const event = port.buildSignedEvent({ eventType: 'payment.succeeded', providerReference: reference, amountMinor: BigInt(quote.amountMinor), currency: quote.currency, occurredAt: ago(daysAgo) });
        const parsed = port.parseEvent(event.body);
        if (!parsed) throw new Error('the simulator produced an event it cannot parse');
        const outcome = await money.receiveProviderEvent(parsed, event.body);
        if (outcome.status !== 'succeeded') throw new Error(`confirmation failed: ${outcome.status}`);
        await money.settle(contribution.contributionId);
        // Backdated so the public page reads as months of giving rather than one afternoon.
        await db.contribution.update({ where: { id: contribution.contributionId }, data: { createdAt: ago(daysAgo), confirmedAt: ago(daysAgo) } });
        counts.contributions += 1;
      } catch (error) {
        console.log(`  contribution skipped (${key}/${personKey}): ${(error as Error).message}`);
      }
    }
  }

  // --- jobs --------------------------------------------------------------------------------------
  for (const item of JOBS) {
    const organizationId = orgs.get(item.org)!;
    let job = await db.job.findFirst({ where: { organizationId, title: item.title } });
    if (!job) {
      const created = await jobs.create(admin.userId, organizationId, {
        title: item.title, summary: item.summary, responsibilities: item.responsibilities,
        requirements: item.requirements, skills: item.skills, contractType: item.contract,
        ...(item.months ? { contractMonths: item.months } : {}),
        deliveryMode: item.mode, city: item.city, hoursPerWeek: item.hours,
        ...(item.pay
          ? { salaryDisclosed: true, salaryMinMinor: String(item.pay[0] * 100), salaryMaxMinor: String(item.pay[1] * 100), salaryCurrency: 'ILS', salaryPeriod: 'شهريًا' }
          : { salaryDisclosed: false, salaryUndisclosedReason: item.reason! }),
        closesAt: ahead(item.closesIn).toISOString(), openings: item.openings
      });
      await jobs.publish(admin.userId, organizationId, created.id, created.version);
      await db.job.update({ where: { id: created.id }, data: { createdAt: ago(item.postedDaysAgo + 3), publishedAt: ago(item.postedDaysAgo) } });
      job = await db.job.findUniqueOrThrow({ where: { id: created.id } });
      counts.jobs += 1;
    }
    for (const personKey of JOB_APPLICANTS[item.title] ?? []) {
      const userId = userIds.get(personKey);
      if (!userId) continue;
      if (await db.jobApplication.findUnique({ where: { jobId_userId: { jobId: job.id, userId } } })) continue;
      try {
        const draft = await jobs.saveDraft(userId, { jobId: job.id, coverNote: `أتقدم لهذه الوظيفة لخبرتي في المجال ورغبتي في العمل ضمن فريق في القدس. طلب تجريبي.` });
        await jobs.submit(userId, draft.id, { sharingConsent: true, version: draft.version });
        const when = ago(Math.max(1, item.postedDaysAgo - 2 - Math.floor(Math.random() * 5)));
        await db.jobApplication.update({ where: { id: draft.id }, data: { createdAt: when, submittedAt: when } });
        counts.jobApplications += 1;
      } catch (error) {
        console.log(`  job application skipped (${item.title}/${personKey}): ${(error as Error).message}`);
      }
    }
  }

  // --- training programmes, each approved by an independent reviewer before it opens --------------
  for (const item of PROGRAMS) {
    const organizationId = orgs.get(item.org)!;
    let program = await db.program.findFirst({ where: { organizationId, title: item.title }, include: { cohorts: true } });
    if (!program) {
      const created = await programs.create(admin.userId, organizationId, {
        title: item.title, summary: item.summary, skills: item.skills, level: item.level, city: item.city,
        capacity: item.capacity, applyClosesAt: ahead(item.closesIn).toISOString(),
        durationWeeks: item.weeks, hoursPerWeek: item.hours,
        schedule: 'جلسات أسبوعية ثابتة يُعلن جدولها التفصيلي عند القبول.',
        attendancePolicy: 'الحضور دون 80% من الجلسات ينهي أهلية الإكمال. الغياب بعذر يحتاج سببًا مكتوبًا.',
        assessmentPolicy: 'تقييم عملي بمعايير معلنة في نهاية كل وحدة.',
        selectionMethod: 'تُقيَّم الطلبات بمعايير معلنة، ويُفصل التعادل بترتيب وصول الطلبات.',
        withdrawalPolicy: 'للمتدرب أن يطلب الانسحاب في أي وقت، وتقيّمه الجهة خلال خمسة أيام عمل.',
        accessibilityNote: 'يرجى ذكر أي ترتيبات وصول يحتاجها المتقدم في الطلب، وتُرتب قبل بدء الدفعة.',
        privacyNote: 'لا تُشارك بيانات المتدربين مع أي جهة أخرى دون موافقة منفصلة.',
        complaintsContact: `complaints@${ORG_SLUG[item.org]}.test`,
        jobCommitmentKind: item.jobs.kind, jobCount: item.jobs.count, jobCommitmentTerms: item.jobs.terms
      });
      await programs.addCohort(admin.userId, organizationId, created.id, {
        name: 'الدفعة الأولى', capacity: item.capacity,
        startAt: ahead(item.closesIn + 14).toISOString(),
        endAt: ahead(item.closesIn + 14 + item.weeks * 7).toISOString(),
        acceptanceWindowHours: 72
      });
      let current = await programs.getForOrganization(admin.userId, organizationId, created.id);
      if (!current.readiness.ready) { console.log(`  programme not ready: ${item.title}: ${current.readiness.blockers.join(', ')}`); continue; }
      await programs.submit(admin.userId, organizationId, created.id, current.version);
      await programs.claim(reviewer.id, created.id);
      current = await programs.getForOrganization(admin.userId, organizationId, created.id);
      await programs.decide(reviewer.id, created.id, { outcome: 'approved', publicReason: '', version: current.version });
      current = await programs.getForOrganization(admin.userId, organizationId, created.id);
      await programs.publish(admin.userId, organizationId, created.id, current.version);
      counts.programs += 1;
      program = await db.program.findFirstOrThrow({ where: { id: created.id }, include: { cohorts: true } });
    }
    const cohort = program.cohorts[0];
    if (!cohort) continue;
    for (const personKey of PROGRAM_APPLICANTS[item.title] ?? []) {
      const userId = userIds.get(personKey);
      if (!userId) continue;
      if (await db.application.findFirst({ where: { cohortId: cohort.id, userId } })) continue;
      try {
        const draft = await applications.saveDraft(userId, { cohortId: cohort.id, motivation: 'أرغب في الالتحاق بهذا البرنامج لتطوير مهاراتي والعمل في مجاله. طلب تجريبي.', sharingConsent: true });
        await applications.submit(userId, draft.id, { sharingConsent: true, version: draft.version });
        counts.programApplications += 1;
      } catch (error) {
        console.log(`  programme application skipped (${item.title}/${personKey}): ${(error as Error).message}`);
      }
    }
  }

  // --- volunteering, with accepted assignments and hours actually logged -------------------------
  for (const item of VOLUNTEERING) {
    const organizationId = orgs.get(item.org)!;
    let opportunity = await db.volunteerOpportunity.findFirst({ where: { organizationId, title: item.title } });
    if (!opportunity) {
      const created = await volunteering.createOpportunity(admin.userId, organizationId, {
        title: item.title, summary: item.summary, tasks: item.tasks, requirements: item.requirements,
        supervisorId: admin.userId, city: item.city, deliveryMode: 'in_person',
        capacity: item.capacity, hoursPerWeek: item.hours,
        startsAt: ahead(item.startsInDays).toISOString().slice(0, 10),
        endsAt: ahead(item.startsInDays + item.weeks * 7).toISOString().slice(0, 10),
        withdrawalPolicy: 'للمتطوع أن ينسحب في أي وقت بإشعار المنسق، دون أثر على أي خدمة يتلقاها أو يتلقاها ذووه.'
      });
      await volunteering.publishOpportunity(admin.userId, organizationId, created.id, created.version);
      counts.opportunities += 1;
      opportunity = await db.volunteerOpportunity.findUniqueOrThrow({ where: { id: created.id } });
    }
    for (const [personKey, accepted, hours] of VOLUNTEERS[item.title] ?? []) {
      const userId = userIds.get(personKey);
      if (!userId) continue;
      try {
        // A re-run picks a half-finished volunteer back up rather than skipping them: the earlier
        // pass may have left an application submitted but never accepted.
        let application = await db.volunteerApplication.findUnique({ where: { opportunityId_userId: { opportunityId: opportunity.id, userId } } });
        if (!application) {
          const created = await volunteering.apply(userId, { opportunityId: opportunity.id, motivation: 'أرغب في التطوع ضمن هذا الفريق. طلب تجريبي.', availability: 'متاح/ة أيام الأسبوع بعد الثالثة عصرًا' });
          application = await db.volunteerApplication.findUniqueOrThrow({ where: { id: created.id } });
          counts.volunteers += 1;
        }
        if (!accepted) continue;
        if (application.state === 'submitted') {
          await volunteering.decideApplication(admin.userId, organizationId, application.id, { outcome: 'accepted', reason: 'مطابق/ة لمتطلبات الفرصة.', version: application.version });
        }
        let assignment = await db.volunteerAssignment.findFirst({ where: { opportunityId: opportunity.id, userId } });
        if (!assignment) {
          const offered = await volunteering.assign(admin.userId, organizationId, { opportunityId: opportunity.id, userId, task: `مهمة ميدانية ضمن فرصة: ${item.title}`, startsAt: ago(30).toISOString().slice(0, 10) });
          assignment = await db.volunteerAssignment.findUniqueOrThrow({ where: { id: offered.id } });
        }
        if (assignment.state === 'offered') {
          await volunteering.respondToAssignment(userId, assignment.id, { accept: true, version: assignment.version });
        }
        for (const [index, minutesWorked] of hours.entries()) {
          const workedOn = ago(21 - index * 7).toISOString().slice(0, 10);
          if (await db.volunteerHours.findFirst({ where: { assignmentId: assignment.id, workedOn: new Date(workedOn) } })) continue;
          const logged = await volunteering.logHours(userId, { assignmentId: assignment.id, workedOn, minutes: minutesWorked * 60, note: 'نوبة تطوع.' });
          const row = await db.volunteerHours.findUniqueOrThrow({ where: { id: logged.id } });
          await volunteering.decideHours(admin.userId, organizationId, logged.id, { outcome: 'approved', reason: '', version: row.version });
          counts.hours += minutesWorked;
        }
      } catch (error) {
        console.log(`  volunteer skipped (${item.title}/${personKey}): ${(error as Error).message}`);
      }
    }
  }

  // --- the placeholder projects from the plain seed ----------------------------------------------
  //
  // `pnpm orgs:real` takes the test organisations out of the public directory but leaves their
  // projects in Explore, where "جمعية الأفق التجريبية" sits next to real work and reads as clutter.
  // Hiding is the platform admin's own control and is not deletion: the rows, their owners and the
  // test accounts are untouched, and one UPDATE back to 'visible' undoes it.
  const hidden = await db.project.updateMany({
    where: { organization: { publiclyListed: false }, adminVisibility: 'visible' },
    data: { adminVisibility: 'hidden' }
  });
  if (hidden.count > 0) console.log(`Hid ${hidden.count} placeholder project(s) from the public surface (not deleted).`);

  console.log('');
  console.log(`People:                ${counts.people}`);
  console.log(`Projects:              ${counts.projects}`);
  console.log(`Contributions:         ${counts.contributions}`);
  console.log(`Jobs published:        ${counts.jobs}   (applications: ${counts.jobApplications})`);
  console.log(`Programmes published:  ${counts.programs}   (applications: ${counts.programApplications})`);
  console.log(`Volunteer roles:       ${counts.opportunities}   (volunteers: ${counts.volunteers}, hours approved: ${counts.hours})`);
  console.log('');
  console.log('All of it is demonstration data on a local build. Money is simulated end to end.');
} finally {
  await db.$disconnect();
}
