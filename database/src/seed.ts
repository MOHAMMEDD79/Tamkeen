import { loadConfig, CURRENT_TERMS_VERSION } from '@tamkeen/config';
import { createDatabase } from './client.js';

/**
 * Repeatable demo seed, restricted to demo/test.
 *
 * Creates the public surface PART-04 needs to be exercisable: two organisations and a few
 * published projects drawn from 17-SEED-SCENARIOS. It creates no money, no contributions and no
 * password credentials — these accounts cannot be signed into, they exist to own public records.
 * Names are fictional and every address is example.test.
 */

const config = loadConfig(process.env);
if (!['demo', 'test'].includes(config.environment)) throw new Error('Seed is restricted to demo/test');
const db = createDatabase(config.databaseUrl);

/** A stable marker so the seed can be re-run without duplicating anything it already made. */
const SEED_TAG = 'seed-demo-2026';
const seedEmail = (name: string) => `${SEED_TAG}-${name}@example.test`;

try {
  await db.runtimeMetadata.upsert({ where: { key: 'seed_profile' }, create: { key: 'seed_profile', value: 'public-demo' }, update: { value: 'public-demo' } });

  const nablus = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Nablus' } });
  const jenin = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Jenin' } });
  const tulkarm = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Tulkarm' } });

  const owners = [
    { key: 'ufuq-owner', name: 'مها — مديرة جمعية الأفق' },
    { key: 'nabta-owner', name: 'رامي — مدير شركة نبتة' },
    // PART-07. Requesting, approving and executing a disbursement are three different people by
    // design, so the demo needs three of them or the separation cannot be shown at all.
    { key: 'ufuq-finance-maker', name: 'سامي — مالية جمعية الأفق (طلب)' },
    { key: 'ufuq-finance-approver', name: 'ليان — مالية جمعية الأفق (اعتماد)' }
  ];
  const ownerIds = new Map<string, string>();
  for (const owner of owners) {
    const email = seedEmail(owner.key);
    const existing = await db.user.findUnique({ where: { email } });
    // The insert trigger creates the profile and party rows, so only the user is upserted here.
    const user = existing ?? await db.user.create({
      data: { email, name: owner.name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() }
    });
    ownerIds.set(owner.key, user.id);
  }

  const organizations = [
    { key: 'ufuq', ownerKey: 'ufuq-owner', slug: `${SEED_TAG}-ufuq`, legalName: 'جمعية الأفق التجريبية للتنمية', displayName: 'جمعية الأفق التجريبية', type: 'NGO' as const, city: 'نابلس', verification: 'verified' as const, description: 'جمعية تجريبية تعمل في التدريب المهني والتمكين الاقتصادي. بيانات هذه الجهة مصطنعة بالكامل.', sectors: ['التدريب المهني', 'التمكين الاقتصادي'] },
    { key: 'nabta', ownerKey: 'nabta-owner', slug: `${SEED_TAG}-nabta`, legalName: 'شركة نبتة التجريبية للزراعة الذكية', displayName: 'شركة نبتة التجريبية', type: 'Company' as const, city: 'طولكرم', verification: 'not_started' as const, description: 'شركة تجريبية في الزراعة الذكية. بيانات هذه الجهة مصطنعة بالكامل.', sectors: ['الزراعة', 'التقنية'] }
  ];
  const organizationIds = new Map<string, string>();
  for (const organization of organizations) {
    const ownerId = ownerIds.get(organization.ownerKey)!;
    const existing = await db.organization.findUnique({ where: { slug: organization.slug } });
    const record = existing ?? await db.$transaction(async tx => {
      const created = await tx.organization.create({
        data: {
          legalName: organization.legalName, displayName: organization.displayName, slug: organization.slug,
          type: organization.type, country: 'PS', city: organization.city, createdBy: ownerId,
          verification: organization.verification, publicDescription: organization.description, sectors: organization.sectors
        }
      });
      await tx.party.create({ data: { organizationId: created.id } });
      await tx.membership.create({ data: { userId: ownerId, organizationId: created.id, roles: ['Owner'] } });
      return created;
    });
    organizationIds.set(organization.key, record.id);
  }

  const projects = [
    {
      slug: `${SEED_TAG}-training-centre`, organizationKey: 'ufuq', ownerKey: 'ufuq-owner', type: 'charity' as const,
      title: 'تجهيز مركز تدريب مجتمعي',
      summary: 'تجهيز قاعتين ومختبر حاسوب في نابلس لتشغيل برامج تدريب مهني على مدار السنة لشباب المحافظة.',
      story: 'يهدف المشروع إلى تحويل مبنى قائم إلى مركز تدريب يعمل طوال العام.\nتشمل المراحل تجهيز القاعات، ثم مختبر الحاسوب، ثم تشغيل الدفعة الأولى.',
      cityId: nablus.id, precision: 'approximate' as const, latitude: 32.2244, longitude: 35.2588, state: 'published' as const,
      plan: {
        goalMajor: 2000, currency: 'ILS', policy: 'flexible' as const,
        lines: [{ label: 'تجهيز القاعتين', major: 1200 }, { label: 'مختبر الحاسوب', major: 800 }],
        milestones: [{ title: 'تجهيز القاعتين', major: 1200, weight: 60 }, { title: 'تشغيل مختبر الحاسوب', major: 800, weight: 40 }]
      }
    },
    {
      slug: `${SEED_TAG}-school-refurbishment`, organizationKey: 'ufuq', ownerKey: 'ufuq-owner', type: 'charity' as const,
      title: 'ترميم مدرسة قروية',
      summary: 'ترميم أربعة صفوف ومرافق صحية في مدرسة قروية بجنين، مع تحسين التهوية والإضاءة الطبيعية.',
      story: 'المدرسة قائمة وتخدم قرية واحدة.\nيشمل الترميم الصفوف والمرافق الصحية.',
      cityId: jenin.id, precision: 'city' as const, latitude: null, longitude: null, state: 'executing' as const,
      plan: {
        goalMajor: 1500, currency: 'ILS', policy: 'all_or_nothing' as const,
        lines: [{ label: 'ترميم الصفوف', major: 900 }, { label: 'المرافق الصحية', major: 600 }],
        milestones: [{ title: 'ترميم الصفوف', major: 900, weight: 60 }, { title: 'المرافق الصحية', major: 600, weight: 40 }]
      }
    },
    {
      slug: `${SEED_TAG}-smart-agriculture`, organizationKey: 'nabta', ownerKey: 'nabta-owner', type: 'enablement' as const,
      title: 'الزراعة الذكية إلى العمل',
      summary: 'برنامج تدريب عملي في الزراعة الذكية بطولكرم، يقود إلى فرص عمل لدى الشركة المشغّلة وشركاء آخرين.',
      story: 'يجمع البرنامج بين تدريب نظري وتطبيق ميداني.\nالوظائف الملزمة تُعلن بوثيقة التزام، وما عداها أهداف لا وعود.',
      cityId: tulkarm.id, precision: 'city' as const, latitude: null, longitude: null, state: 'published' as const
    },
    {
      slug: `${SEED_TAG}-line-expansion`, organizationKey: 'nabta', ownerKey: 'nabta-owner', type: 'venture' as const,
      title: 'توسعة خط الإنتاج',
      summary: 'توسعة خط إنتاج وحدات الزراعة الذكية لرفع الطاقة الإنتاجية وتلبية طلب متزايد من عملاء محليين.',
      story: 'مسودة لم تُنشر بعد. تُستخدم للتحقق من أن المسودات لا تظهر في الاستكشاف ولا في الخريطة.',
      cityId: tulkarm.id, precision: 'city' as const, latitude: null, longitude: null, state: 'draft' as const
    }
  ];

  /** Minor units as a BigInt. Two decimal places for ILS in this build. */
  const minor = (major: number) => BigInt(major) * 100n;

  for (const project of projects) {
    const organizationId = organizationIds.get(project.organizationKey)!;
    const managerId = ownerIds.get(project.ownerKey)!;
    const published = project.state !== 'draft';
    const record = await db.project.upsert({
      where: { slug: project.slug },
      create: {
        organizationId, type: project.type, slug: project.slug, title: project.title,
        summary: project.summary, story: project.story, state: project.state,
        managerId, cityId: project.cityId, createdBy: managerId,
        publicLocationPrecision: project.precision, latitude: project.latitude, longitude: project.longitude,
        publishedAt: published ? new Date('2026-09-01T09:00:00.000Z') : null
      },
      // Re-running the seed refreshes the description without disturbing state or history.
      update: { title: project.title, summary: project.summary, story: project.story }
    });

    // The plan a published charity project needs before it can accept money. These are planning
    // figures only: a goal is an intention and a budget line is a commitment to spend, neither is a
    // balance. Nothing here creates a contribution, a ledger entry or a raised total — money is
    // created only by scripts/demo-money.ts, and only through the real payment path.
    const plan = 'plan' in project ? project.plan : null;
    if (plan && !(await db.campaign.findUnique({ where: { projectId: record.id } }))) {
      await db.campaign.create({
        data: {
          projectId: record.id, goalMinor: minor(plan.goalMajor), currency: plan.currency, policy: plan.policy,
          // Far enough out that the demo campaign is open whenever someone runs the seed.
          endsAt: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000)
        }
      });
      await db.budgetLine.createMany({
        data: plan.lines.map((line, index) => ({ projectId: record.id, label: line.label, amountMinor: minor(line.major), sortOrder: index }))
      });
      await db.milestone.createMany({
        data: plan.milestones.map((milestone, index) => ({ projectId: record.id, sequence: index + 1, title: milestone.title, budgetMinor: minor(milestone.major), weight: milestone.weight }))
      });
    }
  }

  // The two finance roles are separate memberships because they must be separate people: the policy
  // layer and a CHECK constraint both refuse a payout approved by whoever requested it. Ensured
  // outside the organisation creation so a re-run adds them to an organisation that already exists.
  const ufuqOrgId = organizationIds.get('ufuq')!;
  for (const [key, role] of [['ufuq-finance-maker', 'FinanceMaker'], ['ufuq-finance-approver', 'FinanceApprover']] as const) {
    const userId = ownerIds.get(key)!;
    await db.membership.upsert({
      where: { userId_organizationId: { userId, organizationId: ufuqOrgId } },
      create: { userId, organizationId: ufuqOrgId, roles: [role], status: 'active' },
      update: { roles: [role], status: 'active' }
    });
  }

  // A verified bank account, because a payout may only ever go to one (08-FINANCIAL-SYSTEM).
  //
  // The stored identifier is a placeholder, not a real IBAN and not real ciphertext: nothing in the
  // demo ever decrypts it, and only the last four digits are shown anywhere in the product.
  const ufuqId = ufuqOrgId;
  if (!(await db.organizationBankAccount.findUnique({ where: { organizationId: ufuqId } }))) {
    const reviewerId = ownerIds.get('nabta-owner')!;
    const request = await db.organizationBankChangeRequest.create({
      data: {
        organizationId: ufuqId, organizationVersion: 1, requestedBy: ownerIds.get('ufuq-owner')!,
        bankName: 'بنك فلسطين (تجريبي)', accountHolder: 'جمعية الأفق التجريبية',
        accountIdentifierCiphertext: 'seed-placeholder', accountIdentifierHash: '0'.repeat(64),
        accountLast4: '6703', country: 'PS', currency: 'ILS',
        state: 'approved', reviewedBy: reviewerId, reviewedAt: new Date()
      }
    });
    await db.organizationBankAccount.create({
      data: {
        organizationId: ufuqId, sourceRequestId: request.id,
        bankName: 'بنك فلسطين (تجريبي)', accountHolder: 'جمعية الأفق التجريبية',
        accountIdentifierCiphertext: 'seed-placeholder', accountIdentifierHash: '0'.repeat(64),
        accountLast4: '6703', country: 'PS', currency: 'ILS'
      }
    });
  }

  console.log(`Public demo seed complete: ${organizations.length} organisations, ${projects.length} projects (one deliberately left as a draft).`);
  console.log('Two charity projects carry a campaign, a budget and milestones: a plan, not a balance.');
  console.log('No money, contributions or sign-in credentials were created. For demo contributions run pnpm demo:money.');
} finally { await db.$disconnect(); }
