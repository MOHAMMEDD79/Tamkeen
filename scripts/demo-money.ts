/**
 * Demo money for the public seed projects (PART-06).
 *
 * This is deliberately NOT a set of INSERTs. It drives the same service and the same signed
 * webhook path the product uses, so every figure the demo shows was produced by the code under
 * test: the contribution goes through the contributions service with an idempotency key, and it is
 * confirmed only by an event the simulated payment port signed. Writing rows directly would put
 * numbers on the public page that no ledger stands behind, which is what 15-QUALITY forbids.
 *
 * The campaign itself comes from pnpm db:seed, because a published project’s plan is frozen.
 *
 * It refuses to run outside demo/test, and it is idempotent: running it twice adds nothing.
 *
 *   pnpm demo:money
 */

import { loadConfig, CURRENT_TERMS_VERSION } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { ContributionsService } from '../apps/api/dist/modules/money/contributions.service.js';
import { PayoutsService } from '../apps/api/dist/modules/money/payouts.service.js';
import { SimulatedPaymentPort } from '../apps/api/dist/modules/money/payment-port.js';

const config = loadConfig(process.env);
if (!['demo', 'test', 'development'].includes(config.environment)) {
  throw new Error(`demo:money refuses to run in ${config.environment}: it creates contributions through a simulator.`);
}

const SEED_TAG = 'seed-demo-2026';
const db = createDatabase(config.databaseUrl);
const port = new SimulatedPaymentPort(config.sessionSecret);
const money = new ContributionsService(db, port);
const payouts = new PayoutsService(db, port);

/** Each donor is obviously a demo account, and is reused rather than duplicated on a re-run. */
const donors = [
  { email: `${SEED_TAG}-donor-rana@example.test`, name: 'رنا (حساب تجريبي)', amountMajor: 250, visibility: 'named' as const, showAmount: true },
  { email: `${SEED_TAG}-donor-samir@example.test`, name: 'سمير (حساب تجريبي)', amountMajor: 120, visibility: 'named' as const, showAmount: false },
  { email: `${SEED_TAG}-donor-anon@example.test`, name: 'مساهم تجريبي', amountMajor: 400, visibility: 'anonymous' as const, showAmount: false }
];

const toMinor = (major: number) => String(major * 100);

try {
  const project = await db.project.findFirst({
    where: { slug: `${SEED_TAG}-training-centre` },
    include: { campaign: true, organization: true }
  });
  if (!project) throw new Error('Run pnpm db:seed first: the demo project does not exist.');

  if (!project.campaign) {
    throw new Error('The demo project has no campaign. Run pnpm db:seed first: a published project cannot have one added, because its plan is frozen once it is public.');
  }

  // --- Contributions, each confirmed only by a signed provider event ----------------------------
  let created = 0;
  for (const donor of donors) {
    const existing = await db.user.findUnique({ where: { email: donor.email } });
    const user = existing ?? await db.user.create({
      data: { email: donor.email, name: donor.name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() }
    });

    const already = await db.contribution.findFirst({ where: { projectId: project.id, payer: { userId: user.id }, state: 'succeeded' } });
    if (already) continue;

    const quote = await money.quote(project.slug, toMinor(donor.amountMajor));
    const contribution = await money.createContribution(user.id, `demo-${SEED_TAG}-${donor.email}`, {
      projectSlug: project.slug,
      amountMinor: quote.amountMinor,
      visibility: donor.visibility,
      showAmountPublicly: donor.showAmount,
      acceptedQuoteFeeMinor: quote.feeMinor
    });

    // Confirmation goes through the real webhook path: the simulator signs an event, and the
    // contributions service verifies and posts it exactly as it would for a real provider.
    const reference = contribution.providerRedirectPath.split('/').at(-1)!;
    const event = port.buildSignedEvent({
      eventType: 'payment.succeeded', providerReference: reference,
      amountMinor: BigInt(quote.amountMinor), currency: quote.currency, occurredAt: new Date()
    });
    const parsed = port.parseEvent(event.body);
    if (!parsed) throw new Error('the simulator produced an event it cannot parse');
    const outcome = await money.receiveProviderEvent(parsed, event.body);
    if (outcome.status !== 'succeeded') throw new Error(`confirmation failed: ${outcome.status}`);
    await money.settle(contribution.contributionId);
    created += 1;
  }

  // --- PART-07: a disbursement waiting to be approved -------------------------------------------
  //
  // Left at `requested` on purpose. The next two steps belong to different people — an approver in
  // the organisation, then platform finance staff — and doing them here would produce a paid payout
  // nobody decided on, which is precisely the separation this part exists to enforce.
  const org = await db.organization.findUniqueOrThrow({ where: { id: project.organizationId }, include: { bankAccount: true } });
  if (!org.bankAccount) {
    console.log('No verified bank account on the demo organisation, so no demo payout was created.');
  } else {
    const existingPayout = await db.payout.findFirst({ where: { projectId: project.id } });
    if (existingPayout) {
      console.log('A demo payout already exists; nothing added.');
    } else {
      const maker = await db.membership.findFirst({
        where: { organizationId: org.id, status: 'active', roles: { has: 'FinanceMaker' } },
        select: { userId: true }
      });
      if (!maker) {
        console.log('No FinanceMaker in the demo organisation, so no demo payout was created.');
        console.log('Grant one a FinanceMaker role to exercise ORG-11 and ORG-12.');
      } else {
        const payout = await payouts.request(maker.userId, org.id, {
          projectId: project.id,
          amountMinor: toMinor(300),
          reason: 'تجهيز القاعة التدريبية الأولى، مقابل فاتورة المورّد.',
          invoiceReference: 'INV-2026-114'
        });
        console.log(`Demo payout created at ${payout.state}: it still needs an independent approval, then execution by platform finance.`);
      }
    }
  }

  console.log(`Demo money complete locally using a simulator: ${created} contribution(s) created and confirmed.`);
  console.log('No payment provider was contacted and no real money moved. Every figure is simulated.');
} finally {
  await db.$disconnect();
}
