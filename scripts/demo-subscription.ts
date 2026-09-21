/**
 * LOOP-INV end to end for PART-09.
 *
 * This is the acceptance evidence for the loop, and it is deliberately NOT a set of INSERTs. Every
 * step runs the same service the product runs, the payment is confirmed only by an event the
 * simulator signed, and the allocation is approved by somebody who is neither the requester nor a
 * member of the issuing organisation. A row written by hand would put a shareholding on a screen
 * that no code path produced, which is exactly what 15-QUALITY forbids.
 *
 * It refuses to run outside demo/test/development, and it is idempotent: a second run adds nothing.
 *
 *   pnpm demo:offering && pnpm demo:subscription
 */

import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { AllocationsService } from '../apps/api/dist/modules/investment/allocations.service.js';
import { CommitmentsService } from '../apps/api/dist/modules/investment/commitments.service.js';
import { EligibilityService } from '../apps/api/dist/modules/investment/eligibility.service.js';
import { InvestorRelationsService } from '../apps/api/dist/modules/investment/investor-relations.service.js';
import { OfferingsService } from '../apps/api/dist/modules/investment/offerings.service.js';
import { ContributionsService } from '../apps/api/dist/modules/money/contributions.service.js';
import { SimulatedPaymentPort } from '../apps/api/dist/modules/money/payment-port.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:subscription refuses to run in ${config.environment}: it moves simulated money and issues simulated shares.`);
}

const SEED_TAG = 'seed-demo-2026';
const db = createDatabase(config.databaseUrl);
const port = new SimulatedPaymentPort(config.sessionSecret, db);
const offerings = new OfferingsService(db);
const eligibility = new EligibilityService(db);
const commitments = new CommitmentsService(db, port);
const allocations = new AllocationsService(db);
const relations = new InvestorRelationsService(db);
const money = new ContributionsService(db, port);

/**
 * Obviously demo investors, reused rather than duplicated on a re-run.
 *
 * Between them they clear the offering's 500,000.00 minimum on purpose. A round that misses its
 * minimum cannot be allocated at all — the money goes back — so a demo that under-subscribed would
 * stop at `failed` and show no holdings, which is not the loop this script exists to demonstrate.
 */
const investors = [
  { email: `${SEED_TAG}-investor-lina@example.test`, name: 'لينا (حساب تجريبي)', amountMinor: '30000000' },
  { email: `${SEED_TAG}-investor-omar@example.test`, name: 'عمر (حساب تجريبي)', amountMinor: '22000000' }
];

const ensureUser = async (email: string, name: string) => {
  const existing = await db.user.findUnique({ where: { email } });
  if (existing) return existing;
  return db.user.create({ data: { email, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
};

/** A platform reviewer who is independent of the issuing organisation, which the service checks. */
const ensureReviewer = async (email: string, name: string, role: 'RiskReviewer' | 'FinanceOperator') => {
  const user = await ensureUser(email, name);
  if (!user.twoFactorEnabled) await db.user.update({ where: { id: user.id }, data: { twoFactorEnabled: true } });
  const held = await db.platformGrant.findFirst({ where: { userId: user.id, role } });
  if (!held) await db.platformGrant.create({ data: { userId: user.id, role, grantedBy: user.id } });
  return user;
};

try {
  const org = await db.organization.findFirst({ where: { slug: `${SEED_TAG}-nabta` } });
  if (!org) throw new Error('Run pnpm db:seed and pnpm demo:offering first.');
  const offering = await db.offering.findFirst({ where: { organizationId: org.id }, orderBy: { createdAt: 'asc' } });
  if (!offering) throw new Error('Run pnpm demo:offering first: there is no offering to subscribe to.');

  const owner = await db.user.findUniqueOrThrow({ where: { email: `${SEED_TAG}-nabta-owner@example.test` } });
  const membership = await db.membership.findUniqueOrThrow({ where: { userId_organizationId: { userId: owner.id, organizationId: org.id } } });
  // BUS-05 needs a proposer with payout.request; the approval is somebody else's, as always.
  if (!membership.roles.includes('FinanceMaker')) {
    await db.membership.update({
      where: { userId_organizationId: { userId: owner.id, organizationId: org.id } },
      data: { roles: [...new Set([...membership.roles, 'FinanceMaker'])] }
    });
  }

  const reviewer = await ensureReviewer(`${SEED_TAG}-risk-reviewer@example.test`, 'مراجع مخاطر (حساب تجريبي)', 'RiskReviewer');
  const operator = await ensureReviewer(`${SEED_TAG}-finance-operator@example.test`, 'تشغيل مالي (حساب تجريبي)', 'FinanceOperator');

  // --- The offering reaches `open` through its own review, not by an UPDATE ----------------------
  if (['draft', 'changes_requested'].includes(offering.state)) {
    const current = await offerings.getForOrganization(owner.id, org.id, offering.id);
    await offerings.submit(owner.id, org.id, offering.id, current.version);
  }
  let state = (await db.offering.findUniqueOrThrow({ where: { id: offering.id } })).state;
  if (state === 'submitted') {
    await offerings.claim(reviewer.id, offering.id);
    const current = await offerings.getForOrganization(owner.id, org.id, offering.id);
    await offerings.decide(reviewer.id, offering.id, { outcome: 'approved', publicReason: '', version: current.version });
  }
  state = (await db.offering.findUniqueOrThrow({ where: { id: offering.id } })).state;
  if (state === 'approved') {
    const current = await offerings.getForOrganization(owner.id, org.id, offering.id);
    await offerings.open(owner.id, org.id, offering.id, current.version);
    console.log('The offering was approved by an independent reviewer and opened by its issuer.');
  }

  // Every other demo round is taken to `open` too, and left there. demo:offering makes two on
  // purpose: this script carries the first all the way to allocated, and without a second one
  // there would be no open round left for anyone to subscribe to by hand.
  const others = await db.offering.findMany({ where: { organizationId: org.id, id: { not: offering.id } }, orderBy: { createdAt: 'asc' } });
  for (const other of others) {
    if (['draft', 'changes_requested'].includes(other.state)) {
      const current = await offerings.getForOrganization(owner.id, org.id, other.id);
      await offerings.submit(owner.id, org.id, other.id, current.version);
    }
    let otherState = (await db.offering.findUniqueOrThrow({ where: { id: other.id } })).state;
    if (otherState === 'submitted') {
      await offerings.claim(reviewer.id, other.id);
      const current = await offerings.getForOrganization(owner.id, org.id, other.id);
      await offerings.decide(reviewer.id, other.id, { outcome: 'approved', publicReason: '', version: current.version });
    }
    otherState = (await db.offering.findUniqueOrThrow({ where: { id: other.id } })).state;
    if (otherState === 'approved') {
      const current = await offerings.getForOrganization(owner.id, org.id, other.id);
      await offerings.open(owner.id, org.id, other.id, current.version);
      console.log(`A second round is open and unsubscribed: ${other.title}`);
    }
  }

  // --- INV-01: interest → commitment → contract → payment → settlement ---------------------------
  let subscribed = 0;
  for (const investor of investors) {
    const user = await ensureUser(investor.email, investor.name);

    // 06: eligibility is a reviewed decision with an expiry. Choosing a capability is not eligibility.
    const record = await db.investorEligibility.findUnique({ where: { userId: user.id } });
    if (!record || record.state !== 'approved') {
      await eligibility.submit(user.id, {
        investorType: 'individual', hasPriorExperience: true, acknowledgesTotalLossRisk: true,
        declaration: 'مدخرات شخصية، وأقبل احتمال خسارة كامل المبلغ. هذا حساب تجريبي.'
      });
      const submitted = await db.investorEligibility.findUniqueOrThrow({ where: { userId: user.id } });
      await eligibility.decide(reviewer.id, submitted.id, { outcome: 'approved', reason: '', validityDays: 365, version: submitted.version });
    }

    const already = await db.commitment.findFirst({ where: { offeringId: offering.id, userId: user.id } });
    if (already) continue;

    const commitment = await commitments.commit(user.id, offering.id, { amountMinor: investor.amountMinor });
    const disclosure = await db.offeringDisclosure.findFirstOrThrow({ where: { offeringId: offering.id }, orderBy: { sequence: 'desc' } });
    await commitments.confirm(user.id, commitment.id, { disclosureChecksum: disclosure.checksum, acknowledgedRisk: true, version: commitment.version });

    const intent = await commitments.pay(user.id, commitment.id);
    const stored = await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.paymentIntentId } });
    // The same signed webhook and the same inbox a charity contribution goes through.
    const event = port.buildSignedEvent({
      eventType: 'payment.succeeded', providerReference: stored.providerReference,
      amountMinor: stored.amountMinor, currency: stored.currency, occurredAt: new Date()
    });
    const parsed = port.parseEvent(event.body);
    if (!parsed) throw new Error('the simulator produced an event it cannot parse');
    const outcome = await money.receiveProviderEvent(parsed, event.body);
    if (outcome.status !== 'succeeded') throw new Error(`the subscription payment did not confirm: ${outcome.status}`);
    await commitments.settle(commitment.id);
    subscribed += 1;
  }
  if (subscribed > 0) console.log(`${subscribed} demo subscription(s) paid and settled into the offering's escrow.`);

  // --- INV-01 continued: closing, then an allocation somebody else approves ----------------------
  const beforeClose = await db.offering.findUniqueOrThrow({ where: { id: offering.id } });
  if (beforeClose.state === 'open') {
    await offerings.close(owner.id, org.id, offering.id, beforeClose.version);
    console.log('Subscription closed. Closing stops new money; it issues nothing.');
  }

  const closing = await db.offering.findUniqueOrThrow({ where: { id: offering.id } });
  if (closing.state === 'closing') {
    const preview = await allocations.preview(owner.id, org.id, offering.id);
    console.log(`Allocation preview: ${preview.lines.length} subscriber(s), ${preview.totalUnits} shares, minimum ${preview.minimumReached ? 'reached' : 'NOT reached'}.`);
    if (preview.lines.length > 0) {
      const open = await db.allocationRequest.findFirst({ where: { offeringId: offering.id, state: 'submitted' } });
      const request = open
        ? { id: open.id, checksum: open.checksum, version: open.version }
        : await allocations.request(owner.id, org.id, offering.id);
      // The one decision that creates a holding, taken by someone outside the company raising.
      const finalised = await allocations.finalise(reviewer.id, request.id, { checksum: request.checksum, version: request.version });
      console.log(`${finalised.allocated} allocation(s) finalised, and only now do holdings exist. Every proof is marked simulated.`);
    }
  }

  // --- BUS-05: a report and a distribution, each approved by somebody who did not propose it -----
  const venture = await db.venture.findUnique({ where: { organizationId: org.id } });
  if (venture) {
    const reports = await db.companyReport.count({ where: { ventureId: venture.id } });
    if (reports === 0) {
      await relations.publishReport(owner.id, org.id, {
        title: 'تقرير الربع الأول للمستثمرين',
        body: 'رُكِّب خط الإنتاج الأول ويعمل، وطُلب الخط الثاني. هذه بيانات تجريبية بالكامل ولا تصف شركة حقيقية ولا نتائج حقيقية.',
        periodStart: '2026-07-01', periodEnd: '2026-09-30'
      });
      console.log('A numbered report was published to investors.');
    }

    const holders = await db.holding.count({ where: { ventureId: venture.id } });
    const distributions = await db.distribution.count({ where: { ventureId: venture.id } });
    if (holders > 0 && distributions === 0) {
      const proposed = await relations.proposeDistribution(owner.id, org.id, {
        totalMinor: '250000',
        reason: 'توزيع أول على المساهمين من فائض التشغيل. مبلغ تجريبي.'
      });
      console.log(`A distribution was proposed over ${proposed.lines} holder(s); undistributed remainder ${proposed.undistributedRemainderMinor}.`);
      const approved = await relations.approveDistribution(operator.id, proposed.id, { version: proposed.version });
      // Marked paid, and the reply says plainly that no money moved: there is no rail to a person.
      const paid = await relations.markDistributionPaid(operator.id, proposed.id, { version: approved.version });
      console.log(`The distribution record moved to ${paid.state} with note "${paid.note}". No money reached anybody.`);
    }
  }

  console.log('');
  console.log('Everything above is simulated: no payment provider, no share register, no legal ownership,');
  console.log('and no secondary trading. The screens say the same thing where the figures are read.');
} finally {
  await db.$disconnect();
}
