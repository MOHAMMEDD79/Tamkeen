/**
 * Makes the public organisations directory show real organisations only.
 *
 * It adds the real organisations below (with their logo, through the same inspect-and-publish check
 * an uploaded logo goes through) and unlists every other organisation. Unlisting is not deletion:
 * the test and demo organisations keep their members, projects and profile pages, so the test
 * accounts still work; they are only left out of the directory. Safe to run again.
 *
 *   pnpm orgs:real
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { LocalLogoStorage } from '../apps/api/src/modules/identity/logo-storage.js';

const config = loadConfig(process.env);
if (!['demo', 'test'].includes(config.environment)) throw new Error(`orgs:real refuses to run in ${config.environment}.`);

/**
 * Public facts from each organisation's own site. `verification` is the platform admin's decision:
 * 'verified' only where the admin approved the organisation; the rest start unverified.
 */
const REAL_ORGANIZATIONS = [
  {
    slug: 'bayt-mal-al-quds',
    legalName: 'وكالة بيت مال القدس الشريف',
    displayName: 'وكالة بيت مال القدس الشريف',
    type: 'Institution' as const,
    // Approved by the platform admin on 2026-09-22.
    verification: 'verified' as const,
    country: 'MA',
    city: 'الرباط',
    publicDescription: 'مؤسسة عربية إسلامية تابعة للجنة القدس، أُنشئت عام 1995 وبدأت عملها عام 1998، ومقرها الرباط. تنفذ مشاريع اجتماعية في مدينة القدس للمساهمة في حماية المدينة المقدسة والحفاظ على موروثها الديني والحضاري ودعم صمود سكانها، في مجالات التعليم والصحة والإسكان وترميم المباني التاريخية والشباب والرياضة والثقافة والمساعدة الاجتماعية.',
    sectors: ['التعليم', 'الصحة', 'الإسكان والترميم', 'الشباب والثقافة', 'المساعدة الاجتماعية'],
    websiteUrl: 'https://www.bmaq.org/',
    contactEmail: 'contact@bmaq.org',
    contactAddress: 'الرباط، المملكة المغربية',
    logo: 'scripts/assets/bmaq-logo.jpg'
  },
  {
    slug: "taawon",
    legalName: "مؤسسة التعاون",
    displayName: "مؤسسة التعاون",
    type: 'Foundation' as const,
    verification: 'not_started' as const,
    country: "PS",
    city: "القدس",
    publicDescription: "مؤسسة التعاون مؤسسة أهلية فلسطينية غير ربحية، انطلقت في جنيف عام 1983 بمبادرة من مجموعة من الشخصيات الاقتصادية والفكرية الفلسطينية والعربية. تعمل على تمكين الأفراد ومؤسسات المجتمع المدني الفلسطيني اقتصادياً واجتماعياً وتعزيز الهوية الفلسطينية، عبر برامج في التعليم والثقافة والتنمية المجتمعية وإعمار البلدات القديمة، ومنها برنامج القدس لإعمار البلدات القديمة. تنشط في فلسطين ومخيمات اللاجئين في لبنان، ولها مكاتب في القدس ورام الله وغزة وعمّان وبيروت ولندن وجنيف.",
    sectors: ["التعليم", "الثقافة", "التنمية المجتمعية", "إعمار البلدات القديمة"],
    websiteUrl: "https://www.taawon.org",
    contactEmail: "info@taawon.org",
    contactAddress: "شعفاط، القدس",
    logo: 'scripts/assets/taawon.png'
  },
  {
    slug: "prcs",
    legalName: "جمعية الهلال الأحمر الفلسطيني",
    displayName: "جمعية الهلال الأحمر الفلسطيني",
    type: 'NGO' as const,
    verification: 'not_started' as const,
    country: "PS",
    city: "البيرة",
    publicDescription: "جمعية الهلال الأحمر الفلسطيني جمعية وطنية ذات شخصية اعتبارية مستقلة، تأسست رسمياً في 26 كانون الأول 1968، وتعود جذور أول هيئة للهلال الأحمر في فلسطين إلى عام 1910. حصلت عام 2006 على العضوية الكاملة في الاتحاد الدولي لجمعيات الصليب الأحمر والهلال الأحمر، وتقدّم الخدمات الإنسانية والصحية والاجتماعية والإغاثية للشعب الفلسطيني في الأرض الفلسطينية المحتلة وأماكن تجمعاته، من الإسعاف والطوارئ وإدارة مخاطر الكوارث إلى التأهيل والصحة النفسية والدعم النفسي الاجتماعي وبرامج الشباب والتطوع.",
    sectors: ["الإسعاف والطوارئ", "الرعاية الصحية", "التأهيل", "الصحة النفسية والدعم النفسي", "الإغاثة الإنسانية"],
    websiteUrl: "https://www.palestinercs.org",
    contactEmail: "info@palestinercs.org",
    contactAddress: "الإدارة العامة، البيرة",
    logo: 'scripts/assets/prcs.png'
  },
  {
    slug: "pif",
    legalName: "صندوق الاستثمار الفلسطيني",
    displayName: "صندوق الاستثمار الفلسطيني",
    type: 'Company' as const,
    verification: 'not_started' as const,
    country: "PS",
    city: "رام الله",
    publicDescription: "صندوق الاستثمار الفلسطيني شركة مساهمة عامة تأسست عام 2003 ومسجلة لدى وزارة الاقتصاد الوطني، ومقرها رام الله. يستثمر الصندوق في مشاريع استراتيجية بهدف تحقيق أثر إيجابي في المؤشرات الاقتصادية وتعزيز النمو الاقتصادي المستدام، في قطاعات الطاقة التقليدية والمتجددة والرعاية الصحية والاتصالات والاقتصاد الرقمي والبنية التحتية والصناعة والتجارة والزراعة. ويدير محفظة للاستثمار المجتمعي تشمل برنامج إبداع لتمويل المشاريع الصغيرة والمتوسطة وبرنامج منح الطاقة الخضراء في القدس.",
    sectors: ["الاستثمار", "الطاقة المتجددة", "البنية التحتية", "الاقتصاد الرقمي", "تمويل المشاريع الصغيرة والمتوسطة"],
    websiteUrl: "https://www.pif.ps",
    contactEmail: "info@pif.ps",
    contactAddress: "شارع الإرسال، رام الله",
    logo: 'scripts/assets/pif.png'
  },
  {
    slug: "parc",
    legalName: "الإغاثة الزراعية الفلسطينية",
    displayName: "الإغاثة الزراعية الفلسطينية",
    type: 'NGO' as const,
    verification: 'not_started' as const,
    country: "PS",
    city: "رام الله",
    publicDescription: "الإغاثة الزراعية الفلسطينية مؤسسة وطنية تنموية تعمل منذ عام 1983 على تنمية القطاع الزراعي وتعزيز صمود المزارعين، وتسعى إلى ريف فلسطيني قوي محصّن بقطاعه الزراعي. تعمل عبر برامج إدارة الموارد الطبيعية والتمكين الاجتماعي والاقتصادي والصمود والتعبئة والمناصرة، ونفّذت شبكات ري وخطوط مياه وطرقاً زراعية واستصلاح أراضٍ وزراعة ملايين الأشجار وبرامج تدريب زراعي. مقرها رام الله، ولها فروع في القدس ومحافظات الضفة الغربية وقطاع غزة.",
    sectors: ["الزراعة", "إدارة الموارد الطبيعية", "التمكين الاقتصادي", "التدريب الزراعي", "صمود المزارعين"],
    websiteUrl: "https://pal-arc.org",
    contactEmail: "info@pal-arc.org",
    contactAddress: "شارع المعاهد، رام الله",
    logo: 'scripts/assets/parc.png'
  },
  {
    slug: "alnayzak",
    legalName: "مؤسسة النيزك",
    displayName: "مؤسسة النيزك",
    type: 'NGO' as const,
    verification: 'not_started' as const,
    country: "PS",
    city: "رام الله",
    publicDescription: "مؤسسة النيزك مؤسسة فلسطينية غير ربحية وغير حزبية تأسست في القدس عام 2003، تعمل على تمكين الشباب الفلسطيني عبر التعليم التطبيقي في مجالات العلوم والتكنولوجيا والهندسة والرياضيات، وتنمية قدرات الريادة والابتكار، وتوفير فرص اجتماعية واقتصادية من خلال برامج متخصصة. تقوم أعمالها على ثلاث ركائز: العلم والمجتمع، والابتكار في التعليم، والابتكار في الاقتصاد، وتخدم أكثر من 32 ألف مستفيد سنوياً عبر شبكة من المراكز والشركاء، ومقرها في رام الله.",
    sectors: ["ريادة الأعمال", "العلوم والتكنولوجيا", "التعليم التطبيقي", "تمكين الشباب", "الابتكار"],
    websiteUrl: "https://alnayzak.org",
    contactEmail: "info@alnayzak.org",
    contactAddress: "الماصيون، رام الله",
    logo: 'scripts/assets/alnayzak.png'
  }
];

const db = createDatabase(config.databaseUrl);
// The API runs from apps/api and keeps logos under its own .local folder; publish where it reads.
const logoFiles = REAL_ORGANIZATIONS.map(organization => resolve(organization.logo));
process.chdir(resolve('apps', 'api'));
const storage = new LocalLogoStorage();
try {
  // An active organisation must have an owner. Until the organisation's own staff join, the first
  // platform admin holds it; ownership then moves to them through the ownership-transfer flow.
  const admin = await db.platformGrant.findFirst({ where: { role: 'PlatformAdmin', revokedAt: null }, select: { userId: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('No platform admin yet. Run pnpm demo:accounts or pnpm admin:grant first.');

  for (const [index, entry] of REAL_ORGANIZATIONS.entries()) {
    const { logo, ...organization } = entry;
    void logo; // read above, before the working directory changed
    const existing = await db.organization.findUnique({ where: { slug: organization.slug }, select: { id: true, currentLogoId: true } });
    const record = existing ?? await db.$transaction(async tx => {
      const created = await tx.organization.create({ data: { ...organization, createdBy: admin.userId, publiclyListed: true }, select: { id: true, currentLogoId: true } });
      await tx.party.create({ data: { organizationId: created.id } });
      await tx.membership.create({ data: { userId: admin.userId, organizationId: created.id, roles: ['Owner'] } });
      return created;
    });
    if (existing) await db.organization.update({ where: { id: existing.id }, data: { ...organization, publiclyListed: true, status: 'active' } });

    if (!record.currentLogoId) {
      const bytes = await readFile(logoFiles[index]!);
      const contentType = logoFiles[index]!.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const assetId = randomUUID();
      const storageKey = `logos/${record.id}/${assetId}.bin`;
      const quarantined = resolve(process.cwd(), '.local', 'organization-logos', 'quarantine', ...storageKey.split('/'));
      await mkdir(dirname(quarantined), { recursive: true });
      await writeFile(quarantined, bytes);
      const current = await db.organization.findUniqueOrThrow({ where: { id: record.id }, select: { version: true } });
      await db.organizationLogoAsset.create({ data: { id: assetId, organizationId: record.id, organizationVersion: current.version, fileName: `logo.${contentType === 'image/png' ? 'png' : 'jpg'}`, storageKey, contentType, expectedSize: (await stat(quarantined)).size } });
      const result = await storage.inspectAndPublish(storageKey, contentType);
      if (!result.clean) throw new Error(`The logo for ${organization.displayName} failed the image check: ${result.reason}.`);
      await db.$transaction([
        db.organizationLogoAsset.update({ where: { id: assetId }, data: { scanState: 'clean', checksum: result.checksum, actualSize: result.actualSize, finalizedAt: new Date() } }),
        db.organization.update({ where: { id: record.id }, data: { currentLogoId: assetId, version: { increment: 1 } } })
      ]);
    }
    console.log(`${existing ? 'Updated' : 'Added'}: ${organization.displayName}`);
  }

  const unlisted = await db.organization.updateMany({
    where: { slug: { notIn: REAL_ORGANIZATIONS.map(organization => organization.slug) }, publiclyListed: true },
    data: { publiclyListed: false }
  });
  console.log(`Unlisted ${unlisted.count} test or demo organisation(s). They still work; they are just not in the public directory.`);
} finally {
  await db.$disconnect();
}
