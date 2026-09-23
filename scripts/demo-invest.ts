/**
 * The investment track: four companies raising, and enough subscribers for the screens to mean
 * something.
 *
 * The companies here are invented. That is on purpose and it is the one place this dataset will
 * not reuse the real organisations: attaching a fabricated share count and a fabricated round to
 * a real Palestinian institution would be inventing financial facts about a real business. These
 * four read like ordinary Palestinian SMEs and are nothing more than that.
 *
 * Every step runs the real service. An offering reaches `open` only by being submitted, claimed
 * and approved by a RiskReviewer who is outside the issuing company, and then opened by the issuer.
 * Every subscription is paid through the simulator's signed webhook and settled. The one round
 * that reaches `allocated` gets there through an allocation request finalised by somebody who is
 * neither the requester nor a member of the company.
 *
 * Run after: pnpm db:seed, pnpm demo:accounts.
 * Idempotent: a second run adds nothing.
 *
 *   pnpm demo:invest
 */

import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { OfferingsService } from '../apps/api/dist/modules/investment/offerings.service.js';
import { EligibilityService } from '../apps/api/dist/modules/investment/eligibility.service.js';
import { CommitmentsService } from '../apps/api/dist/modules/investment/commitments.service.js';
import { AllocationsService } from '../apps/api/dist/modules/investment/allocations.service.js';
import { InvestorRelationsService } from '../apps/api/dist/modules/investment/investor-relations.service.js';
import { ContributionsService } from '../apps/api/dist/modules/money/contributions.service.js';
import { SimulatedPaymentPort } from '../apps/api/dist/modules/money/payment-port.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:invest refuses to run in ${config.environment}.`);
}

const TAG = 'quds-2026';
const day = 86_400_000;
const ahead = (days: number) => new Date(Date.now() + days * day);
const ago = (days: number) => new Date(Date.now() - days * day);
/** Shekels to minor units, as a string, the way the money code wants them. */
const ils = (major: number) => String(Math.round(major * 100));

const db = createDatabase(config.databaseUrl);
const port = new SimulatedPaymentPort(config.sessionSecret, db);
const offerings = new OfferingsService(db);
const eligibility = new EligibilityService(db);
const commitments = new CommitmentsService(db, port);
const allocations = new AllocationsService(db);
const relations = new InvestorRelationsService(db);
const money = new ContributionsService(db, port);

/** `carry` is how far this round is taken: to an open book, or all the way to allocated shares. */
const COMPANIES = [
  {
    slug: `${TAG}-hajar-maqdisi`, displayName: 'شركة الحجر المقدسي للتصنيع', legalName: 'شركة الحجر المقدسي للتصنيع م.خ.م',
    city: 'بيت جالا', founder: 'زياد قمصية', founderKey: 'ziad',
    sectors: ['الحجر والرخام', 'مواد البناء', 'الترميم'],
    description: 'شركة تصنيع حجر ورخام في بيت جالا، تورّد الحجر المقصوص والمشغول لمشاريع الترميم في القدس والبلدات القديمة، ولمقاولي البناء في الضفة. تشغّل مقصبين ومشغلاً للنحت اليدوي، ويعمل فيها اثنان وأربعون موظفاً.',
    venture: 'شركة تصنيع حجر ورخام قائمة منذ 2009، تورّد لمشاريع الترميم والبناء في القدس والضفة، وتسعى لإضافة خط قص بالمنشار السلكي لرفع الطاقة ودقة القطع.',
    shares: '800000',
    rounds: [{
      title: 'جولة خط القص بالمنشار السلكي', sharesOffered: '80000', price: 25, minimumRaise: 1_200_000, minimumTicket: 2_500, closesIn: 34, openedDaysAgo: 62,
      useOfFunds: 'شراء منشار سلكي وتركيبه، وتأهيل المشغل، وتشغيل الأشهر الستة الأولى.',
      summary: 'تضيف الشركة خط قص بالمنشار السلكي لرفع الطاقة الإنتاجية ودقة القطع المطلوبة في أعمال الترميم، على مراحل معلنة.',
      risks: 'قد يتأخر توريد المعدات أو دخولها عبر المعابر، وقد لا يتحقق الطلب المتوقع من مشاريع الترميم، وقد تخسر كامل المبلغ المستثمَر. هذه شركة مُتخيَّلة وبيانات تجريبية.',
      // Short of its minimum on purpose: the money goes back, which is the more useful thing for
      // the screens to be able to show.
      carry: 'failed' as const,
      investors: [['lina', 320_000], ['tareq', 250_000], ['dima', 180_000], ['khaled', 120_000], ['majd', 95_000]] as Array<[string, number]>
    }, {
      title: 'جولة الخزانات ومشغل النحت', sharesOffered: '40000', price: 25, minimumRaise: 600_000, minimumTicket: 2_500, closesIn: 12, openedDaysAgo: 30,
      useOfFunds: 'خزانات ومخزن للكتل الحجرية، وتأهيل مشغل النحت اليدوي، ورأس مال عامل.',
      summary: 'جولة أصغر بعد أن لم تبلغ الجولة الأولى حدها الأدنى: نطاق أضيق يعالج اختناق التخزين والنحت اليدوي أولاً، بحد أدنى محسوب على اكتتاب فعلي سابق.',
      risks: 'ما زال توريد المعدات عرضة للتأخير عبر المعابر، وقد لا يتحقق الطلب المتوقع، وقد تخسر كامل المبلغ المستثمَر. هذه شركة مُتخيَّلة وبيانات تجريبية.',
      carry: 'allocated' as const,
      investors: [['lina', 200_000], ['tareq', 160_000], ['dima', 120_000], ['investor', 100_000], ['khaled', 80_000], ['majd', 60_000]] as Array<[string, number]>
    }],
    report: { title: 'تقرير الربع الثالث للمستثمرين', body: 'رُكّب المنشار السلكي ودخل التشغيل التجريبي في آب، وبدأ توريد الدفعات الأولى لمشروعي ترميم في البلدة القديمة. الطاقة الحالية أقل من المستهدف بنحو 12% ريثما يكتمل تدريب المشغّلين. هذه شركة مُتخيَّلة وكل الأرقام تجريبية.', periodStart: '2026-04-01', periodEnd: '2026-06-30' },
    distribution: { totalMajor: 48_000, reason: 'توزيع أول على المساهمين من فائض تشغيل النصف الأول. مبلغ تجريبي.' }
  },
  {
    slug: `${TAG}-shams-filastin`, displayName: 'شركة شمس فلسطين للطاقة المتجددة', legalName: 'شركة شمس فلسطين للطاقة المتجددة م.خ.م',
    city: 'رام الله', founder: 'هبة عوض', founderKey: 'heba',
    sectors: ['الطاقة المتجددة', 'الطاقة الشمسية', 'المقاولات'],
    description: 'شركة تصميم وتركيب أنظمة طاقة شمسية للمنازل والمنشآت الصغيرة في الضفة الغربية، مع عقود صيانة سنوية. ركّبت حتى الآن ما يزيد على ستمئة نظام منزلي، ويعمل فيها ثمانية وعشرون موظفاً بينهم فرق تركيب في ثلاث محافظات.',
    venture: 'شركة طاقة شمسية قائمة منذ 2016، تصمم وتركّب أنظمة للمنازل والمنشآت الصغيرة وتتعهد صيانتها، وتسعى لتمويل مخزون الألواح والعواكس لتقصير زمن التركيب.',
    shares: '1200000',
    rounds: [{
      title: 'جولة تمويل مخزون الألواح والعواكس', sharesOffered: '150000', price: 12, minimumRaise: 900_000, minimumTicket: 1_200, closesIn: 47, openedDaysAgo: 28,
      useOfFunds: 'شراء مخزون ألواح وعواكس وبطاريات، وتوسيع فريق التركيب، وتشغيل رأس المال العامل.',
      summary: 'يقصّر المخزون المحلي زمن التركيب من أسابيع إلى أيام ويحمي التسعير من تقلب أسعار الاستيراد وإغلاق المعابر.',
      risks: 'أسعار الألواح متقلبة عالمياً، وقد تتعطل سلاسل التوريد عبر المعابر، وقد ينخفض الطلب مع تغير أسعار الكهرباء، وقد تخسر كامل المبلغ. هذه شركة مُتخيَّلة وبيانات تجريبية.',
      carry: 'open' as const,
      investors: [['tareq', 180_000], ['omar', 96_000], ['investor', 72_000], ['raed', 48_000], ['dima', 36_000]] as Array<[string, number]>
    }],
    report: null, distribution: null
  },
  {
    slug: `${TAG}-zaytouna`, displayName: 'شركة زيتونة للزيوت والتعبئة', legalName: 'شركة زيتونة للزيوت والتعبئة م.خ.م',
    city: 'جنين', founder: 'أمجد عبد الله', founderKey: 'amjad',
    sectors: ['الأغذية', 'زيت الزيتون', 'التصدير'],
    description: 'معصرة ومعمل تعبئة لزيت الزيتون في جنين، يشتري من نحو أربعمئة مزارع في المحافظة ويعبّئ للسوق المحلي وللتصدير إلى الأردن ودول الخليج. حاصل على شهادة سلامة غذاء، ويشغّل خط تعبئة واحداً في الموسم.',
    venture: 'معصرة ومعمل تعبئة زيت زيتون في جنين قائم منذ 2012، يشتري من مزارعي المحافظة ويعبّئ للسوق المحلي والتصدير، ويسعى لإضافة خط تعبئة وخزانات فولاذية لاستيعاب موسم الذروة.',
    shares: '500000',
    rounds: [{
      title: 'جولة خط التعبئة وخزانات الموسم', sharesOffered: '60000', price: 15, minimumRaise: 500_000, minimumTicket: 1_500, closesIn: 52, openedDaysAgo: 16,
      useOfFunds: 'خط تعبئة ثانٍ، وخزانات فولاذية للتخزين، ورأس مال عامل لشراء محصول الموسم.',
      summary: 'يتركز الموسم في ستة أسابيع، والطاقة الحالية تجبر المعصرة على رد كميات من المزارعين. يعالج الخط الثاني والخزانات هذا الاختناق مباشرة.',
      risks: 'المحصول يتبدل سنة بعد سنة بشكل حاد، وقد تتعثر أسواق التصدير أو تُغلق المعابر، والأسعار تتأثر بالموسم الإقليمي كله، وقد تخسر كامل المبلغ. هذه شركة مُتخيَّلة وبيانات تجريبية.',
      carry: 'open' as const,
      investors: [['omar', 120_000], ['dima', 75_000], ['nour', 45_000], ['investor', 30_000]] as Array<[string, number]>
    }],
    report: null, distribution: null
  },
  {
    slug: `${TAG}-riwaq-digital`, displayName: 'شركة رواق للحلول الرقمية', legalName: 'شركة رواق للحلول الرقمية م.خ.م',
    city: 'رام الله', founder: 'سائد أبو ريالة', founderKey: 'saed',
    sectors: ['البرمجيات', 'التقنية', 'التصدير'],
    description: 'بيت برمجة في رام الله يبني أنظمة إدارة للمؤسسات الأهلية والشركات المتوسطة، ويعمل مع عملاء في فلسطين والأردن والخليج. يعمل فيه أربعة وثلاثون مطوراً ومصمماً، ونحو 60% من إيراده تصديري.',
    venture: 'بيت برمجة قائم منذ 2018 يبني أنظمة إدارة للمؤسسات والشركات المتوسطة محلياً وللتصدير، ويسعى لتحويل نظامه الداخلي لإدارة المنح إلى منتج مرخّص بالاشتراك.',
    shares: '1000000',
    rounds: [{
      title: 'جولة تحويل نظام إدارة المنح إلى منتج', sharesOffered: '100000', price: 18, minimumRaise: 1_000_000, minimumTicket: 1_800, closesIn: 61, openedDaysAgo: 9,
      useOfFunds: 'فريق منتج مخصص، وبناء نسخة متعددة المستأجرين، والتسويق للسنة الأولى.',
      summary: 'بُني النظام أصلاً لعميل واحد ويُستخدم اليوم لدى سبعة، ما يجعل تحويله إلى منتج مرخّص بالاشتراك خطوة قائمة على طلب قائم لا على تقدير.',
      risks: 'تحويل مشروع خدمات إلى منتج قد يستغرق أطول من المخطط، والمنافسة الإقليمية قائمة، وقد يتأخر تبني العملاء للاشتراك، وقد تخسر كامل المبلغ. هذه شركة مُتخيَّلة وبيانات تجريبية.',
      carry: 'open' as const,
      investors: [['adam', 90_000], ['investor', 54_000], ['aya', 36_000]] as Array<[string, number]>
    }],
    report: null, distribution: null
  }
];

const FOUNDERS: Record<string, string> = { ziad: 'زياد قمصية', heba: 'هبة عوض', amjad: 'أمجد عبد الله', saed: 'سائد أبو ريالة' };

const ensureUser = async (email: string, name: string) => {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({ data: { email, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
};

const counts = { companies: 0, offerings: 0, opened: 0, subscriptions: 0, allocated: 0, failed: 0, refunded: 0, reports: 0, distributions: 0 };

try {
  const admin = await db.platformGrant.findFirst({ where: { role: 'PlatformAdmin', revokedAt: null }, select: { userId: true }, orderBy: { createdAt: 'asc' } });
  if (!admin) throw new Error('No platform admin. Run pnpm demo:accounts first.');
  const reviewer = await db.user.findUnique({ where: { email: 'risk-reviewer@tamkeen.test' } });
  const operator = await db.user.findUnique({ where: { email: 'finance-operator@tamkeen.test' } });
  if (!reviewer || !operator) throw new Error('Run pnpm demo:accounts first: the risk reviewer and finance operator are missing.');

  for (const company of COMPANIES) {
    // --- the company ----------------------------------------------------------------------------
    const founder = await ensureUser(`${TAG}-${company.founderKey}@quds.test`, FOUNDERS[company.founderKey]!);
    let org = await db.organization.findUnique({ where: { slug: company.slug } });
    if (!org) {
      org = await db.$transaction(async tx => {
        const created = await tx.organization.create({
          data: {
            slug: company.slug, legalName: company.legalName, displayName: company.displayName, type: 'Company',
            country: 'PS', city: company.city, createdBy: founder.id, verification: 'verified', publiclyListed: true,
            publicDescription: company.description, sectors: company.sectors,
            // Registered a little before its first round opened.
            createdAt: ago((company.rounds[0]?.openedDaysAgo ?? 30) + 40)
          }
        });
        await tx.party.create({ data: { organizationId: created.id } });
        await tx.membership.create({ data: { userId: founder.id, organizationId: created.id, roles: ['Owner', 'InvestmentManager', 'FinanceMaker'] } });
        return created;
      });
      counts.companies += 1;
    }

    // --- the venture -----------------------------------------------------------------------------
    if (!await db.venture.findUnique({ where: { organizationId: org.id } })) {
      await offerings.saveVenture(founder.id, org.id, {
        legalName: company.legalName, currentShares: company.shares, currency: 'ILS', summary: company.venture
      });
    }

    for (const round of company.rounds) {
      let offering = await db.offering.findFirst({ where: { organizationId: org.id, title: round.title } });
      if (!offering) {
        const created = await offerings.create(founder.id, org.id, {
          title: round.title, currency: 'ILS',
          sharesOffered: round.sharesOffered,
          pricePerShareMinor: ils(round.price),
          minimumRaiseMinor: ils(round.minimumRaise),
          minimumTicketMinor: ils(round.minimumTicket),
          useOfFunds: round.useOfFunds,
          closesAt: ahead(round.closesIn).toISOString()
        });
        await offerings.addDisclosure(founder.id, org.id, created.id, {
          summary: round.summary, risks: round.risks, useOfFunds: round.useOfFunds, version: created.version
        });
        offering = await db.offering.findUniqueOrThrow({ where: { id: created.id } });
        counts.offerings += 1;
      }

      // --- draft → submitted → approved → open, each step by the person it belongs to -------------
      if (['draft', 'changes_requested'].includes(offering.state)) {
        const current = await offerings.getForOrganization(founder.id, org.id, offering.id);
        await offerings.submit(founder.id, org.id, offering.id, current.version);
      }
      if ((await db.offering.findUniqueOrThrow({ where: { id: offering.id } })).state === 'submitted') {
        await offerings.claim(reviewer.id, offering.id);
        const current = await offerings.getForOrganization(founder.id, org.id, offering.id);
        await offerings.decide(reviewer.id, offering.id, { outcome: 'approved', publicReason: '', version: current.version });
      }
      if ((await db.offering.findUniqueOrThrow({ where: { id: offering.id } })).state === 'approved') {
        const current = await offerings.getForOrganization(founder.id, org.id, offering.id);
        await offerings.open(founder.id, org.id, offering.id, current.version);
        await db.offering.update({ where: { id: offering.id }, data: { createdAt: ago(round.openedDaysAgo + 21) } });
        counts.opened += 1;
      }

      // --- subscriptions, each paid through the signed webhook -------------------------------------
      for (const [personKey, amountMajor] of round.investors) {
        const email = personKey === 'investor' ? 'investor@tamkeen.test' : `${TAG}-${personKey}@quds.test`;
        const user = await db.user.findUnique({ where: { email } });
        if (!user) continue;
        try {
          const held = await db.investorEligibility.findUnique({ where: { userId: user.id } });
          if (!held || held.state !== 'approved') {
            if (!held) {
              await eligibility.submit(user.id, {
                investorType: 'individual', hasPriorExperience: true, acknowledgesTotalLossRisk: true,
                declaration: 'مدخرات شخصية، وأقبل احتمال خسارة كامل المبلغ. هذا حساب تجريبي.'
              });
            }
            const submitted = await db.investorEligibility.findUniqueOrThrow({ where: { userId: user.id } });
            if (submitted.state !== 'approved') {
              await eligibility.decide(reviewer.id, submitted.id, { outcome: 'approved', reason: '', validityDays: 365, version: submitted.version });
            }
          }

          if (await db.commitment.findFirst({ where: { offeringId: offering.id, userId: user.id } })) continue;
          const commitment = await commitments.commit(user.id, offering.id, { amountMinor: ils(amountMajor) });
          const disclosure = await db.offeringDisclosure.findFirstOrThrow({ where: { offeringId: offering.id }, orderBy: { sequence: 'desc' } });
          await commitments.confirm(user.id, commitment.id, { disclosureChecksum: disclosure.checksum, acknowledgedRisk: true, version: commitment.version });
          const intent = await commitments.pay(user.id, commitment.id);
          const stored = await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.paymentIntentId } });
          const event = port.buildSignedEvent({
            eventType: 'payment.succeeded', providerReference: stored.providerReference,
            amountMinor: stored.amountMinor, currency: stored.currency, occurredAt: new Date()
          });
          const parsed = port.parseEvent(event.body);
          if (!parsed) throw new Error('the simulator produced an event it cannot parse');
          const outcome = await money.receiveProviderEvent(parsed, event.body);
          if (outcome.status !== 'succeeded') throw new Error(`payment did not confirm: ${outcome.status}`);
          await commitments.settle(commitment.id);
          counts.subscriptions += 1;
        } catch (error) {
          console.log(`  subscription skipped (${round.title}/${personKey}): ${(error as Error).message}`);
        }
      }

      if (round.carry === 'open') continue;

      // --- closing, then either an allocation or a refunded failure -------------------------------
      const live = await db.offering.findUniqueOrThrow({ where: { id: offering.id } });
      if (live.state === 'open') await offerings.close(founder.id, org.id, offering.id, live.version);

      const closing = await db.offering.findUniqueOrThrow({ where: { id: offering.id } });
      if (closing.state === 'closing') {
        const preview = await allocations.preview(founder.id, org.id, offering.id);
        if (preview.minimumReached && preview.lines.length > 0) {
          const open = await db.allocationRequest.findFirst({ where: { offeringId: offering.id, state: 'submitted' } });
          const request = open
            ? { id: open.id, checksum: open.checksum, version: open.version }
            : await allocations.request(founder.id, org.id, offering.id);
          // The one decision that creates a holding, taken outside the company raising.
          const finalised = await allocations.finalise(reviewer.id, request.id, { checksum: request.checksum, version: request.version });
          counts.allocated += finalised.allocated;
        } else {
          // The round missed its minimum, so it is declared failed and every subscriber is repaid
          // through the escrow — the same three steps the product would take.
          const failed = await allocations.declareFailed(founder.id, org.id, offering.id, { version: closing.version });
          for (const row of await db.commitment.findMany({ where: { offeringId: offering.id, state: 'refunding' }, select: { id: true } })) {
            await allocations.refundCommitment(operator.id, row.id);
            counts.refunded += 1;
          }
          const readiness = await allocations.closingReadiness(founder.id, org.id, offering.id);
          if (readiness.canClose) {
            const current = await db.offering.findUniqueOrThrow({ where: { id: offering.id } });
            await allocations.closeFailed(founder.id, org.id, offering.id, { version: current.version });
          }
          counts.failed += 1;
          console.log(`  ${round.title}: minimum not reached (${failed.raisedMinor} of ${failed.minimumRaiseMinor}); ${failed.toRefund} subscriber(s) repaid.`);
        }
      }
    }

    // --- a report and a distribution on whatever the company actually allocated --------------------
    const venture = await db.venture.findUnique({ where: { organizationId: org.id } });
    if (venture && company.report && await db.companyReport.count({ where: { ventureId: venture.id } }) === 0) {
      await relations.publishReport(founder.id, org.id, company.report);
      counts.reports += 1;
    }
    if (venture && company.distribution) {
      const holders = await db.holding.count({ where: { ventureId: venture.id } });
      const already = await db.distribution.count({ where: { ventureId: venture.id } });
      if (holders > 0 && already === 0) {
        const proposed = await relations.proposeDistribution(founder.id, org.id, {
          totalMinor: ils(company.distribution.totalMajor), reason: company.distribution.reason
        });
        const approved = await relations.approveDistribution(operator.id, proposed.id, { version: proposed.version });
        await relations.markDistributionPaid(operator.id, proposed.id, { version: approved.version });
        counts.distributions += 1;
      }
    }
  }

  console.log('');
  console.log(`Companies:      ${counts.companies}`);
  console.log(`Offerings:      ${counts.offerings}   (opened: ${counts.opened})`);
  console.log(`Subscriptions:  ${counts.subscriptions}`);
  console.log(`Allocations:    ${counts.allocated}   (reports: ${counts.reports}, distributions: ${counts.distributions})`);
  console.log(`Failed rounds:  ${counts.failed}   (subscribers repaid: ${counts.refunded})`);
  console.log('');
  console.log('The four companies are invented. No payment provider was contacted, no share register');
  console.log('exists, and nobody owns anything: every figure is simulated.');
} finally {
  await db.$disconnect();
}
