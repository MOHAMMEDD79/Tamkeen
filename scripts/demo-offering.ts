/**
 * A demo equity offering for PART-08.
 *
 * Uses the numbers from 06-INVESTMENT-LIFECYCLE's worked example on purpose — 1,000,000 shares in
 * issue, 100,000 offered at 10.00 — so the screens can be checked against the figure the
 * specification says people get wrong.
 *
 * Like every demo script here it drives the real services, so nothing on screen is a row that no
 * code path produced. It leaves both offerings in `draft`: review and opening are two other
 * people's decisions, and pnpm demo:subscription is what takes them through those.
 *
 * Two offerings, not one, and deliberately: demo:subscription carries the first all the way to
 * allocated, so without a second one there would be no open round left to subscribe to by hand.
 *
 *   pnpm demo:offering
 */

import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { OfferingsService } from '../apps/api/dist/modules/investment/offerings.service.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:offering refuses to run in ${config.environment}.`);
}

const SEED_TAG = 'seed-demo-2026';
const db = createDatabase(config.databaseUrl);
const offerings = new OfferingsService(db);

try {
  const org = await db.organization.findFirst({ where: { slug: `${SEED_TAG}-nabta` } });
  if (!org) throw new Error('Run pnpm db:seed first.');
  if (org.verification !== 'verified') {
    // An unverified company cannot raise from the public, so the demo company is verified here.
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
  }

  const owner = await db.user.findUniqueOrThrow({ where: { email: `${SEED_TAG}-nabta-owner@example.test` } });
  await db.membership.update({
    where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
    data: { roles: ['Owner', 'InvestmentManager'] }
  });

  const count = await db.offering.count({ where: { organizationId: org.id } });
  if (count >= 2) {
    const states = await db.offering.findMany({ where: { organizationId: org.id }, select: { state: true }, orderBy: { createdAt: 'asc' } });
    console.log(`Demo offerings already exist at ${states.map(row => row.state).join(', ')}; nothing added.`);
  } else {
    // Created once. Re-saving it would need its current version, and the share count cannot be
    // changed at all while a round is live — a re-basing of every percentage already quoted.
    const venture = await db.venture.findUnique({ where: { organizationId: org.id } });
    if (!venture) {
      await offerings.saveVenture(owner.id, org.id, {
        legalName: 'شركة نبتة التجريبية للزراعة الذكية',
        currentShares: '1000000',
        currency: 'ILS',
        summary: 'شركة تجريبية في الزراعة الذكية تسعى لتوسعة خط الإنتاج. كل البيانات مصطنعة بالكامل.'
      });
    }

    const offering = await offerings.create(owner.id, org.id, {
      title: 'جولة توسعة خط الإنتاج',
      currency: 'ILS',
      sharesOffered: '100000',
      pricePerShareMinor: '1000',
      minimumRaiseMinor: '50000000',
      minimumTicketMinor: '10000',
      useOfFunds: 'شراء خط إنتاج ثانٍ، وتركيبه، وتشغيل الأشهر الستة الأولى.',
      closesAt: new Date(Date.now() + 90 * 86_400_000).toISOString()
    });

    await offerings.addDisclosure(owner.id, org.id, offering.id, {
      summary: 'تسعى الشركة لتوسعة طاقتها الإنتاجية عبر خط ثانٍ يلبي طلبًا متزايدًا من عملاء محليين، على مراحل معلنة.',
      risks: 'قد لا يتحقق الطلب المتوقع، وقد تتأخر المعدات، وقد تخسر كامل المبلغ المستثمَر. هذه بيانات تجريبية ولا تمثل شركة حقيقية.',
      useOfFunds: 'معدات خط الإنتاج وتركيبها، ثم تشغيل الأشهر الستة الأولى.',
      version: offering.version
    });

    // A second round, small enough that one ordinary ticket clears its minimum, so the subscribe
    // path can be walked by hand against a round that can actually succeed.
    const second = await offerings.create(owner.id, org.id, {
      title: 'جولة تشغيل المشتل الصغير',
      currency: 'ILS',
      sharesOffered: '20000',
      pricePerShareMinor: '1000',
      minimumRaiseMinor: '1000000',
      minimumTicketMinor: '10000',
      useOfFunds: 'تجهيز مشتل صغير للشتلات، وتشغيل الموسم الأول منه.',
      closesAt: new Date(Date.now() + 120 * 86_400_000).toISOString()
    });

    await offerings.addDisclosure(owner.id, org.id, second.id, {
      summary: 'جولة أصغر لتجهيز مشتل للشتلات وتشغيل موسمه الأول، بحد أدنى يمكن بلوغه من عدد قليل من المكتتبين.',
      risks: 'الموسم الزراعي قد لا يأتي كما هو متوقع، وقد تخسر كامل المبلغ. هذه بيانات تجريبية ولا تمثل شركة حقيقية.',
      useOfFunds: 'تجهيز المشتل وتشغيل موسمه الأول.',
      version: second.version
    });

    // Both are left in draft on purpose: review and opening are two other people's decisions, and
    // doing them here would produce an open offering nobody approved.
    console.log(`Two demo offerings created at draft: ${offering.title}; ${second.title}`);
    console.log('Each still needs an independent RiskReviewer to approve it, and the issuer to open it.');
  }
  console.log('Every figure is simulated: no payment provider, no share register, no legal ownership.');
} finally {
  await db.$disconnect();
}
