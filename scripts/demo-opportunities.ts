/**
 * More demo training programmes and jobs, so the opportunities page shows a realistic spread.
 *
 * It drives the real services like the other demo scripts: each programme is reviewed by an
 * independent content reviewer and then opened by its operator, and each job is published by its
 * employer. Everything is demonstration data under the two demo organisations. Run it after
 * pnpm db:seed; it is idempotent (a title that already exists is skipped).
 *
 *   pnpm demo:opportunities
 */

import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { ProgramsService } from '../apps/api/dist/modules/programs/programs.service.js';
import { JobsService } from '../apps/api/dist/modules/employment/jobs.service.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:opportunities refuses to run in ${config.environment}.`);
}

const SEED_TAG = 'seed-demo-2026';
const day = 86_400_000;
const db = createDatabase(config.databaseUrl);
const programs = new ProgramsService(db);
const jobs = new JobsService(db);

type OrgKey = 'ufuq' | 'nabta';

const PROGRAMS: Array<{ org: OrgKey; title: string; summary: string; skills: string[]; level: string; city: string; capacity: number; weeks: number; hours: number; closesIn: number; jobs: { kind: 'none' | 'expected'; count: number; terms: string } }> = [
  { org: 'ufuq', title: 'تطوير مواقع الويب من الصفر', summary: 'برنامج مكثف في HTML وCSS وJavaScript يبني فيه كل متدرب ثلاثة مواقع حقيقية لجمعيات محلية، مع إرشاد من مطورين عاملين.', skills: ['HTML', 'CSS', 'JavaScript'], level: 'مبتدئ', city: 'نابلس', capacity: 20, weeks: 12, hours: 15, closesIn: 14, jobs: { kind: 'expected', count: 5, terms: 'خمس فرص تدريب مدفوع لدى شركات برمجة شريكة، غير ملزمة، ومعاييرها تُعلن قبل نهاية البرنامج.' } },
  { org: 'nabta', title: 'تركيب وصيانة أنظمة الطاقة الشمسية', summary: 'تدريب عملي على تركيب الألواح الشمسية والعواكس وفحص الأنظمة وصيانتها، بجلسات ميدانية على أسطح مبانٍ في طولكرم.', skills: ['الطاقة الشمسية', 'الكهرباء', 'السلامة المهنية'], level: 'متوسط', city: 'طولكرم', capacity: 15, weeks: 10, hours: 18, closesIn: 21, jobs: { kind: 'expected', count: 4, terms: 'أربع وظائف فني تركيب مستهدفة لدى مقاولي طاقة شركاء، غير ملزمة.' } },
  { org: 'ufuq', title: 'التصميم الجرافيكي للهوية التجارية', summary: 'من الفكرة إلى الشعار والهوية الكاملة: أساسيات التصميم والألوان والخطوط العربية، وتطبيق عملي على مشاريع صغيرة من المجتمع المحلي.', skills: ['التصميم', 'الهوية البصرية', 'الخط العربي'], level: 'مبتدئ', city: 'نابلس', capacity: 18, weeks: 8, hours: 10, closesIn: 10, jobs: { kind: 'none', count: 0, terms: '' } },
  { org: 'ufuq', title: 'المحاسبة وإدارة المشاريع الصغيرة', summary: 'مسك الدفاتر وإعداد الموازنات والتسعير والتدفق النقدي، موجّه لأصحاب المشاريع المنزلية والصغيرة والراغبين في بدء مشروعهم.', skills: ['المحاسبة', 'التسعير', 'إدارة المشاريع'], level: 'مبتدئ', city: 'رام الله', capacity: 25, weeks: 6, hours: 8, closesIn: 18, jobs: { kind: 'none', count: 0, terms: '' } },
  { org: 'nabta', title: 'الزراعة المائية والبيوت الذكية', summary: 'تصميم وتشغيل وحدات الزراعة المائية ومراقبة المناخ داخل البيوت البلاستيكية بالحساسات، مع مشروع تخرج لكل مجموعة.', skills: ['الزراعة المائية', 'الحساسات', 'إدارة المياه'], level: 'متوسط', city: 'جنين', capacity: 12, weeks: 9, hours: 14, closesIn: 25, jobs: { kind: 'expected', count: 3, terms: 'ثلاث وظائف مستهدفة لدى مزارع شريكة، غير ملزمة.' } }
];

const JOBS: Array<{ org: OrgKey; title: string; summary: string; requirements: string; skills: string[]; contract: 'full_time' | 'part_time' | 'fixed_term' | 'apprenticeship' | 'temporary'; months?: number; mode: 'in_person' | 'remote' | 'hybrid'; city: string; hours: number; pay?: [string, string]; reason?: string; closesIn: number; openings: number }> = [
  { org: 'ufuq', title: 'مطوّر واجهات أمامية', summary: 'تطوير واجهات مواقع الجمعية ومنصات التبرع وتحسين سرعتها وسهولة استخدامها على الهاتف.', requirements: 'خبرة سنة في React أو ما يعادلها، ومعرض أعمال.', skills: ['React', 'CSS', 'التصميم المتجاوب'], contract: 'full_time', mode: 'hybrid', city: 'نابلس', hours: 40, pay: ['450000', '600000'], closesIn: 20, openings: 2 },
  { org: 'nabta', title: 'فني تركيب طاقة شمسية', summary: 'تركيب أنظمة الطاقة الشمسية للمنازل والمزارع وفحصها وتسليمها للعملاء مع شرح التشغيل.', requirements: 'شهادة في الكهرباء أو إكمال برنامج تدريب معتمد، والقدرة على العمل على الأسطح.', skills: ['الطاقة الشمسية', 'الكهرباء'], contract: 'full_time', mode: 'in_person', city: 'طولكرم', hours: 42, pay: ['380000', '480000'], closesIn: 15, openings: 3 },
  { org: 'ufuq', title: 'محاسب مشاريع', summary: 'متابعة موازنات المشاريع والصرف على المراحل وإعداد التقارير المالية للمانحين.', requirements: 'بكالوريوس محاسبة، وخبرة سنتين في المؤسسات الأهلية.', skills: ['المحاسبة', 'التقارير المالية', 'Excel'], contract: 'fixed_term', months: 12, mode: 'in_person', city: 'رام الله', hours: 40, pay: ['500000', '650000'], closesIn: 12, openings: 1 },
  { org: 'ufuq', title: 'مصمم جرافيك', summary: 'تصميم مواد الحملات والمنشورات وتقارير الأثر المرئية للجمعية وشركائها.', requirements: 'معرض أعمال، وإتقان أدوات التصميم، والكتابة العربية الجيدة.', skills: ['التصميم', 'Illustrator', 'الهوية البصرية'], contract: 'part_time', mode: 'remote', city: 'نابلس', hours: 20, reason: 'الأجر يُحدد حسب الخبرة ومعرض الأعمال، ويُعلن في المقابلة الأولى قبل أي عرض.', closesIn: 25, openings: 1 },
  { org: 'nabta', title: 'مشرف بيوت زراعية', summary: 'الإشراف على تشغيل البيوت البلاستيكية الذكية ومتابعة قراءات الحساسات والري وجداول العمال.', requirements: 'خبرة زراعية ميدانية، والقدرة على قراءة بيانات الحساسات.', skills: ['الزراعة', 'الحساسات', 'الإشراف'], contract: 'full_time', mode: 'in_person', city: 'جنين', hours: 45, pay: ['400000', '470000'], closesIn: 18, openings: 1 },
  { org: 'ufuq', title: 'مدرّب حاسوب ومهارات رقمية', summary: 'تدريب الشباب والنساء على المهارات الرقمية الأساسية واستخدام الحاسوب في العمل.', requirements: 'خبرة في التدريب، وصبر، ومهارات تواصل ممتازة.', skills: ['التدريب', 'المهارات الرقمية'], contract: 'apprenticeship', months: 6, mode: 'in_person', city: 'نابلس', hours: 25, pay: ['250000', '250000'], closesIn: 9, openings: 2 }
];

const ensureUser = async (email: string, name: string) => {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({ data: { email, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
};

try {
  const reviewer = await ensureUser(`${SEED_TAG}-content-reviewer@example.test`, 'مراجع محتوى (حساب تجريبي)');
  if (!reviewer.twoFactorEnabled) await db.user.update({ where: { id: reviewer.id }, data: { twoFactorEnabled: true } });
  if (!await db.platformGrant.findFirst({ where: { userId: reviewer.id, role: 'ContentReviewer', revokedAt: null } })) {
    await db.platformGrant.create({ data: { userId: reviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id } });
  }

  const orgs = new Map<OrgKey, { id: string; ownerId: string }>();
  for (const key of ['ufuq', 'nabta'] as const) {
    const org = await db.organization.findFirst({ where: { slug: `${SEED_TAG}-${key}` } });
    if (!org) throw new Error('Run pnpm db:seed first.');
    // Publishing jobs needs a verified employer; these are demo organisations.
    if (org.verification !== 'verified') await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    const owner = await db.user.findUniqueOrThrow({ where: { email: `${SEED_TAG}-${key}-owner@example.test` } });
    const membership = await db.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } } });
    const roles = [...new Set([...membership.roles, 'ProgramManager', 'Recruiter'])];
    if (roles.length !== membership.roles.length) await db.membership.update({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } }, data: { roles } });
    orgs.set(key, { id: org.id, ownerId: owner.id });
  }

  for (const item of PROGRAMS) {
    const { id: orgId, ownerId } = orgs.get(item.org)!;
    if (await db.program.findFirst({ where: { organizationId: orgId, title: item.title } })) continue;
    const created = await programs.create(ownerId, orgId, {
      title: item.title,
      summary: `${item.summary} بيانات تجريبية.`,
      skills: item.skills, level: item.level, city: item.city, capacity: item.capacity,
      applyClosesAt: new Date(Date.now() + item.closesIn * day).toISOString(),
      durationWeeks: item.weeks, hoursPerWeek: item.hours,
      schedule: 'جلسات أسبوعية ثابتة يُعلن جدولها التفصيلي عند القبول.',
      attendancePolicy: 'الحضور دون 80% من الجلسات ينهي أهلية الإكمال. الغياب بعذر يحتاج سببًا مكتوبًا.',
      assessmentPolicy: 'تقييم عملي بمعايير معلنة في نهاية كل وحدة.',
      selectionMethod: 'تُقيَّم الطلبات بمعايير معلنة، ويُفصل التعادل بترتيب وصول الطلبات.',
      withdrawalPolicy: 'للمتدرب أن يطلب الانسحاب في أي وقت، وتقيّمه الجهة خلال خمسة أيام عمل.',
      accessibilityNote: 'قاعات التدريب متاحة لمستخدمي الكراسي المتحركة.',
      privacyNote: 'لا تُشارك بيانات المتدربين مع أي جهة أخرى دون موافقة منفصلة.',
      complaintsContact: `complaints@${item.org}.example.test`,
      jobCommitmentKind: item.jobs.kind,
      jobCount: item.jobs.count,
      jobCommitmentTerms: item.jobs.terms
    });
    await programs.addCohort(ownerId, orgId, created.id, {
      name: 'الدفعة الأولى', capacity: item.capacity,
      startAt: new Date(Date.now() + (item.closesIn + 10) * day).toISOString(),
      endAt: new Date(Date.now() + (item.closesIn + 10 + item.weeks * 7) * day).toISOString(),
      acceptanceWindowHours: 72
    });
    let current = await programs.getForOrganization(ownerId, orgId, created.id);
    if (!current.readiness.ready) { console.log(`Not ready: ${item.title}: ${current.readiness.blockers.join(', ')}`); continue; }
    await programs.submit(ownerId, orgId, created.id, current.version);
    await programs.claim(reviewer.id, created.id);
    current = await programs.getForOrganization(ownerId, orgId, created.id);
    await programs.decide(reviewer.id, created.id, { outcome: 'approved', publicReason: '', version: current.version });
    current = await programs.getForOrganization(ownerId, orgId, created.id);
    await programs.publish(ownerId, orgId, created.id, current.version);
    console.log(`Programme published: ${item.title}`);
  }

  for (const item of JOBS) {
    const { id: orgId, ownerId } = orgs.get(item.org)!;
    if (await db.job.findFirst({ where: { organizationId: orgId, title: item.title } })) continue;
    const created = await jobs.create(ownerId, orgId, {
      title: item.title,
      summary: `${item.summary} بيانات تجريبية.`,
      responsibilities: item.summary,
      requirements: item.requirements,
      skills: item.skills,
      contractType: item.contract,
      ...(item.months ? { contractMonths: item.months } : {}),
      deliveryMode: item.mode, city: item.city, hoursPerWeek: item.hours,
      ...(item.pay
        ? { salaryDisclosed: true, salaryMinMinor: item.pay[0], salaryMaxMinor: item.pay[1], salaryCurrency: 'ILS', salaryPeriod: 'شهريًا' }
        : { salaryDisclosed: false, salaryUndisclosedReason: item.reason! }),
      closesAt: new Date(Date.now() + item.closesIn * day).toISOString(),
      openings: item.openings
    });
    await jobs.publish(ownerId, orgId, created.id, created.version);
    console.log(`Job published: ${item.title}`);
  }
  console.log('All of the above is demonstration data.');
} finally {
  await db.$disconnect();
}
