import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { OfferingsService } from '../apps/api/dist/modules/investment/offerings.service.js';
import { EligibilityService } from '../apps/api/dist/modules/investment/eligibility.service.js';
import { CommitmentsService } from '../apps/api/dist/modules/investment/commitments.service.js';
import { AllocationsService } from '../apps/api/dist/modules/investment/allocations.service.js';
import { OperationsService } from '../apps/api/dist/modules/operations/operations.service.js';
import { processExportBatch } from '../apps/worker/dist/exports.js';
import { InvestorRelationsService } from '../apps/api/dist/modules/investment/investor-relations.service.js';
import { ContributionsService } from '../apps/api/dist/modules/money/contributions.service.js';
import { LedgerService } from '../apps/api/dist/modules/money/ledger.service.js';
import { SimulatedPaymentPort } from '../apps/api/dist/modules/money/payment-port.js';

/**
 * PART-09 acceptance:
 *
 *   INV-01  interest → commitment → payment → allocation, and a holding **only** after a proven
 *           allocation;
 *   INV-02  the worked example's percentage through the whole chain;
 *   INV-03  a new disclosure or a lapsed eligibility stops the investor continuing;
 *   INV-04  the minimum is missed: every commitment resolved and every payment returned before the
 *           offering may close;
 *   plus capacity under concurrency, and LOOP-INV end to end with everything marked simulated.
 */

const config = loadConfig(process.env);
const ILS = 'ILS';

const answers = {
  investorType: 'individual' as const,
  hasPriorExperience: true,
  acknowledgesTotalLossRisk: true,
  declaration: 'Personal savings; I accept that the whole amount may be lost.'
};

const disclosureText = {
  summary: 'A venture raising to expand its production line, used to verify the subscription and allocation chain.',
  risks: 'Demand may not materialise and the whole investment may be lost. This is demonstration data.',
  useOfFunds: 'Production equipment, installation and the first six months of operating costs.'
};

test('commitments, subscriptions, allocations and holdings on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const offerings = new OfferingsService(db);
  const eligibility = new EligibilityService(db);
  const port = new SimulatedPaymentPort(config.sessionSecret, db);
  const commitments = new CommitmentsService(db, port);
  const allocations = new AllocationsService(db);
  const operations = new OperationsService(db);
  const relations = new InvestorRelationsService(db);
  const money = new ContributionsService(db, port);
  const ledger = new LedgerService(db);

  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];

  const createUser = async (suffix: string, twoFactor = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Sub ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  /** Makes someone eligible the only way that works: a reviewed decision. */
  const makeEligible = async (reviewerId: string, userId: string) => {
    await eligibility.submit(userId, answers);
    const record = await db.investorEligibility.findUniqueOrThrow({ where: { userId } });
    await eligibility.decide(reviewerId, record.id, { outcome: 'approved', reason: '', validityDays: 365, version: record.version });
  };

  /** Drives a subscription payment through the real signed webhook, then settles it. */
  const payAndSettle = async (commitmentId: string) => {
    const intent = await commitments.pay(
      (await db.commitment.findUniqueOrThrow({ where: { id: commitmentId } })).userId,
      commitmentId
    );
    const record = await db.paymentIntent.findUniqueOrThrow({ where: { id: intent.paymentIntentId } });
    const event = port.buildSignedEvent({
      eventType: 'payment.succeeded', providerReference: record.providerReference,
      amountMinor: record.amountMinor, currency: record.currency, occurredAt: new Date()
    });
    const parsed = port.parseEvent(event.body);
    assert.ok(parsed);
    // The same entry point a charity contribution uses: one webhook, one inbox, one idempotency.
    const outcome = await money.receiveProviderEvent(parsed, event.body);
    assert.equal(outcome.status, 'succeeded', 'a subscription payment confirms through the shared webhook');

    // Settlement is a second, later event rather than something the product decides for itself.
    // Nothing in the running app may call `settle` directly: if this path did not work, money
    // would confirm and never become allocatable, which is how it was before PART-09 found it.
    const settlement = port.buildSignedEvent({
      eventType: 'payment.settled', providerReference: record.providerReference,
      amountMinor: record.amountMinor, currency: record.currency, occurredAt: new Date()
    });
    const parsedSettlement = port.parseEvent(settlement.body);
    assert.ok(parsedSettlement);
    const settled = await money.receiveProviderEvent(parsedSettlement, settlement.body);
    assert.equal(settled.status, 'settled', 'settlement arrives on the same signed webhook');
    return record;
  };

  /** Takes an offering all the way to `open`, which PART-08 already proved works. */
  const openOffering = async (ownerId: string, reviewerId: string, orgId: string, overrides: Record<string, string> = {}) => {
    const offering = await offerings.create(ownerId, orgId, {
      title: `Round ${randomUUID().slice(0, 8)}`, currency: ILS,
      sharesOffered: '100000', pricePerShareMinor: '1000',
      // Low enough that a single worked-example ticket clears it, because INV-01 is about the
      // chain to a holding. The offering that misses its minimum is set up separately below.
      minimumRaiseMinor: '1000000', minimumTicketMinor: '10000',
      useOfFunds: 'Production equipment and the first six months of operating costs.',
      closesAt: new Date(Date.now() + 90 * 86_400_000).toISOString(),
      ...overrides
    });
    await offerings.addDisclosure(ownerId, orgId, offering.id, { ...disclosureText, version: offering.version });
    let current = await offerings.getForOrganization(ownerId, orgId, offering.id);
    await offerings.submit(ownerId, orgId, offering.id, current.version);
    await offerings.claim(reviewerId, offering.id);
    current = await offerings.getForOrganization(ownerId, orgId, offering.id);
    await offerings.decide(reviewerId, offering.id, { outcome: 'approved', publicReason: '', version: current.version });
    current = await offerings.getForOrganization(ownerId, orgId, offering.id);
    await offerings.open(ownerId, orgId, offering.id, current.version);
    return offering;
  };

  try {
    const founder = await createUser('founder');
    const reviewer = await createUser('reviewer', true);
    const secondReviewer = await createUser('reviewer-two', true);
    const operator = await createUser('operator', true);
    const investorA = await createUser('investor-a');
    const investorB = await createUser('investor-b');

    await db.platformGrant.createMany({
      data: [
        { userId: reviewer.id, role: 'RiskReviewer', grantedBy: reviewer.id },
        { userId: secondReviewer.id, role: 'RiskReviewer', grantedBy: reviewer.id },
        { userId: operator.id, role: 'FinanceOperator', grantedBy: operator.id },
        { userId: operator.id, role: 'RiskReviewer', grantedBy: operator.id }
      ]
    });

    const org = await identity.createOrganization(founder.id, { legalName: `Sub Co ${prefix}`, displayName: `Sub Co ${prefix}`, type: 'Company', country: 'PS', city: 'Tulkarm' });
    organizations.push(org.id);
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    await db.membership.update({ where: { userId_organizationId: { userId: founder.id, organizationId: org.id } }, data: { roles: ['Owner', 'InvestmentManager', 'FinanceMaker'] } });

    // 06's worked example: a million shares in issue, a hundred thousand offered at 10.00.
    await offerings.saveVenture(founder.id, org.id, {
      legalName: `Sub Co Ltd ${prefix}`, currentShares: '1000000', currency: ILS,
      summary: 'A company used to verify the subscription, allocation and holding chain end to end.'
    });

    await makeEligible(reviewer.id, investorA.id);
    await makeEligible(reviewer.id, investorB.id);

    // --- INV-01 and INV-02: the chain, and the percentage ------------------------------------------
    const offering = await openOffering(founder.id, reviewer.id, org.id);

    // An ineligible investor cannot even reserve.
    const outsider = await createUser('outsider');
    await assert.rejects(
      () => commitments.commit(outsider.id, offering.id, { amountMinor: '1000000' }),
      /forbidden/, 'eligibility gates the commitment, and nobody granted it to themselves'
    );

    // 10,000.00 buys 1,000 shares — 1% of the offering, 0.0909% of the company.
    const commitment = await commitments.commit(investorA.id, offering.id, { amountMinor: '1000000' });
    assert.equal(commitment.units, '1000');
    assert.equal(commitment.amountMinor, '1000000');
    assert.equal(commitment.percentOfPostRaise, '0.090909', 'INV-02: the share of the company, not of the offering');
    assert.equal(commitment.indicative, true, '06: indicative until final allocation');
    assert.equal(commitment.state, 'reserved');

    // **INV-01, the central rule**: a reservation is not a holding, and neither is a contract, and
    // neither is a payment. Nothing exists in the portfolio until an allocation is proven.
    let portfolio = await commitments.portfolio(investorA.id);
    assert.equal(portfolio.holdings.length, 0, 'a commitment creates no holding');
    assert.equal(portfolio.inFlight.length, 1, 'and is reported separately as in flight');
    assert.equal(portfolio.valuationAvailable, false, '06: no market value is shown from a subscription price');

    // Confirming needs the disclosure the commitment was made against, and the risk acknowledgement.
    const disclosure = await db.offeringDisclosure.findFirstOrThrow({ where: { offeringId: offering.id }, orderBy: { sequence: 'desc' } });
    await assert.rejects(
      () => commitments.confirm(investorA.id, commitment.id, { disclosureChecksum: disclosure.checksum, acknowledgedRisk: false, version: commitment.version }),
      /invalid_input/, 'the total-loss acknowledgement is not optional at the binding step'
    );
    await assert.rejects(
      () => commitments.confirm(investorA.id, commitment.id, { disclosureChecksum: 'f'.repeat(64), acknowledgedRisk: true, version: commitment.version }),
      /conflict/, 'the contract names the exact text that was agreed'
    );
    // And nobody else can confirm somebody else's commitment.
    await assert.rejects(
      () => commitments.confirm(investorB.id, commitment.id, { disclosureChecksum: disclosure.checksum, acknowledgedRisk: true, version: commitment.version }),
      /not_found/
    );

    const confirmed = await commitments.confirm(investorA.id, commitment.id, { disclosureChecksum: disclosure.checksum, acknowledgedRisk: true, version: commitment.version });
    assert.equal(confirmed.commitment.state, 'confirmed');
    assert.equal(confirmed.subscription.disclosureChecksum, disclosure.checksum);
    assert.equal(confirmed.subscription.signatureIsSimulated, true, 'a click in a demo is not a signature, and the DTO says so');

    // Still no holding after a signed contract.
    portfolio = await commitments.portfolio(investorA.id);
    assert.equal(portfolio.holdings.length, 0, 'a contract creates no holding either');

    // A subscription is what was agreed; the database refuses to let it be rewritten.
    const subscriptionRow = await db.subscription.findFirstOrThrow({ where: { commitmentId: commitment.id } });
    await assert.rejects(
      () => db.subscription.update({ where: { id: subscriptionRow.id }, data: { disclosureChecksum: 'a'.repeat(64) } }),
      /append-only|23514/, 'a contract is append-only'
    );

    await payAndSettle(commitment.id);
    assert.equal((await db.commitment.findUniqueOrThrow({ where: { id: commitment.id } })).state, 'paid');

    // Still no holding after the money has actually arrived and settled.
    portfolio = await commitments.portfolio(investorA.id);
    assert.equal(portfolio.holdings.length, 0, 'even a settled payment creates no holding');

    // The escrow is the offering's own pool, kept apart from any project's money.
    const pool = await db.fundingPool.findUniqueOrThrow({ where: { offeringId: offering.id } });
    assert.equal(pool.kind, 'offering_escrow');
    const balances = await ledger.balances(pool.id);
    // 10,000.00 in, and 10,000.00 held: unlike a charity pool, an escrow may owe back exactly what
    // the contract names, so the 300.00 processor fee is funded by the platform rather than taken
    // out of what the subscriber is owed.
    assert.equal(balances.restrictedMinor, '1000000');
    assert.equal(balances.availableMinor, '1000000');
    assert.equal(balances.feesMinor, '30000');
    assert.equal(balances.feesAbsorbedByPlatformMinor, '30000', 'the fee is real and someone bore it; the books say who');
    assert.equal(balances.platformFundedMinor, '30000');
    assert.equal(await ledger.isBalanced(pool.id), true);

    // --- Capacity under concurrency ------------------------------------------------------------------
    // 99,000 units are left. Two simultaneous commitments of 60,000 units each cannot both fit.
    await makeEligible(reviewer.id, outsider.id);
    const race = await Promise.allSettled([
      commitments.commit(investorB.id, offering.id, { amountMinor: '60000000' }),
      commitments.commit(outsider.id, offering.id, { amountMinor: '60000000' })
    ]);
    assert.equal(race.filter(result => result.status === 'fulfilled').length, 1, 'two commitments cannot both take capacity only one of them has');
    const racer = race.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<{ id: string; version: number }>;
    let capacity = await commitments.capacity(offering.id);
    assert.equal(capacity.remainingUnits, '39000');

    // A lapsed reservation frees its capacity with nobody running a job.
    await db.commitment.update({ where: { id: racer.value.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    capacity = await commitments.capacity(offering.id);
    assert.equal(capacity.remainingUnits, '99000', 'an expired reservation stops holding capacity by itself');

    // --- INV-03: a revised disclosure stops the investor continuing ----------------------------------
    const blocked = await commitments.commit(investorB.id, offering.id, { amountMinor: '1000000' });
    let currentOffering = await offerings.getForOrganization(founder.id, org.id, offering.id);
    const revised = await offerings.addDisclosure(founder.id, org.id, offering.id, {
      summary: `${disclosureText.summary} The equipment supplier changed after this round opened.`,
      risks: `${disclosureText.risks} The new supplier has no delivery record with this company.`,
      useOfFunds: disclosureText.useOfFunds,
      material: true, reason: 'The equipment supplier changed, which alters the delivery risk.',
      version: currentOffering.version
    });
    assert.equal(revised.offering.state, 'suspended');

    const stale = await db.commitment.findUniqueOrThrow({ where: { id: blocked.id } });
    await assert.rejects(
      () => commitments.confirm(investorB.id, blocked.id, { disclosureChecksum: disclosure.checksum, acknowledgedRisk: true, version: stale.version }),
      /conflict/, 'INV-03: a revised disclosure stops the purchase until it is dealt with'
    );
    // And the reservation is not destroyed by that — it is simply not confirmable.
    assert.equal((await db.commitment.findUniqueOrThrow({ where: { id: blocked.id } })).state, 'reserved');

    // --- INV-03: a lapsed eligibility stops it too ----------------------------------------------------
    // Put the offering back on the disclosure the commitment was made against, so only eligibility
    // is left as the reason it cannot continue.
    await db.offering.update({ where: { id: offering.id }, data: { currentDisclosureId: disclosure.id, state: 'open' } });
    await db.investorEligibility.update({ where: { userId: investorB.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    assert.equal((await eligibility.isEligible(investorB.id)).reason, 'expired');
    const stillReserved = await db.commitment.findUniqueOrThrow({ where: { id: blocked.id } });
    await assert.rejects(
      () => commitments.confirm(investorB.id, blocked.id, { disclosureChecksum: disclosure.checksum, acknowledgedRisk: true, version: stillReserved.version }),
      /forbidden/, 'INV-03: an eligibility that ran out stops the purchase before any money moves'
    );
    await db.investorEligibility.update({ where: { userId: investorB.id }, data: { expiresAt: new Date(Date.now() + 86_400_000) } });
    await commitments.cancel(investorB.id, blocked.id, { reason: 'No longer proceeding with this round.', version: stillReserved.version });
    // Cancelling frees the capacity and keeps the record of what happened (PER-08.A04).
    assert.equal((await db.commitment.findUniqueOrThrow({ where: { id: blocked.id } })).state, 'cancelled');

    // --- INV-01 completed: allocation is the only thing that makes a holding --------------------------
    currentOffering = await offerings.getForOrganization(founder.id, org.id, offering.id);
    await offerings.close(founder.id, org.id, offering.id, currentOffering.version);

    const preview = await allocations.preview(founder.id, org.id, offering.id);
    assert.equal(preview.lines.length, 1, 'only the settled commitment may be allocated');
    assert.equal(preview.totalUnits, '1000');
    assert.equal(preview.minimumReached, true, 'the single settled ticket clears this offering’s minimum');

    const request = await allocations.request(founder.id, org.id, offering.id);
    assert.equal(request.state, 'submitted');
    // Whoever computed the schedule does not approve it.
    await assert.rejects(
      () => allocations.finalise(founder.id, request.id, { checksum: request.checksum, version: request.version }),
      /forbidden/, 'the issuer does not finalise its own allocation'
    );
    // Nor does a stale checksum approve different figures.
    await assert.rejects(
      () => allocations.finalise(reviewer.id, request.id, { checksum: 'f'.repeat(64), version: request.version }),
      /conflict/, 'an approval is bound to the figures that were reviewed'
    );

    const finalised = await allocations.finalise(reviewer.id, request.id, { checksum: request.checksum, version: request.version });
    assert.equal(finalised.allocated, 1);
    assert.equal(finalised.simulated, true, 'nothing here claims a legal share register');

    // **Only now** does a holding exist.
    portfolio = await commitments.portfolio(investorA.id);
    assert.equal(portfolio.holdings.length, 1, 'INV-01: a holding appears only after a proven allocation');
    assert.equal(portfolio.holdings[0]!.units, '1000');
    assert.equal(portfolio.holdings[0]!.costMinor, '1000000', 'cost basis, which is not a valuation');
    assert.ok(portfolio.holdings[0]!.proofReference, 'and it carries the allocation proof');
    assert.equal(portfolio.holdings[0]!.simulated, true);
    const allocationProof = await allocations.proof(investorA.id, portfolio.holdings[0]!.allocationId);
    assert.match(allocationProof.filename, /^allocation-proof-/);
    assert.match(allocationProof.content, /"units":"1000"/);
    await assert.rejects(() => allocations.proof(investorB.id, portfolio.holdings[0]!.allocationId), /not_found/);
    const allocationExport = await operations.requestAllocationExport(founder.id, org.id, offering.id);
    assert.equal(await processExportBatch(db), 1);
    const allocationCsv = (await operations.downloadExport(founder.id, allocationExport.id)).content ?? '';
    assert.match(allocationCsv, /investor_email/);
    assert.match(allocationCsv, new RegExp(investorA.email.replace('.', '\\.')));
    await assert.rejects(() => operations.requestAllocationExport(investorA.id, org.id, offering.id), /forbidden/);
    // There is no market-value field anywhere in the payload.
    assert.equal(JSON.stringify(portfolio).includes('marketValue'), false);

    // A holding cannot be adjusted by hand, whatever a service might try (06).
    const holdingRow = await db.holding.findFirstOrThrow({ where: { userId: investorA.id } });
    await assert.rejects(
      () => db.holding.update({ where: { id: holdingRow.id }, data: { units: 999999n } }),
      /cannot be edited by hand|23514/, 'a holding follows from an allocation, never from an edit'
    );
    // And an allocation is append-only, so its proof cannot be rewritten.
    await assert.rejects(
      () => db.allocation.updateMany({ where: { commitmentId: commitment.id }, data: { proofReference: 'forged' } }),
      /append-only|23514/
    );

    // --- BUS-05: reports, distributions and events ------------------------------------------------------
    const venture = await db.venture.findUniqueOrThrow({ where: { organizationId: org.id } });
    await relations.publishReport(founder.id, org.id, {
      title: 'First quarter to investors',
      body: 'The first production line is installed and running; the second is ordered. This is demonstration data and describes no real company.',
      periodStart: '2026-07-01', periodEnd: '2026-09-30'
    });

    // A distribution is computed from the register as it stands, in integers.
    const distribution = await relations.proposeDistribution(founder.id, org.id, { totalMinor: '300000', reason: 'First distribution to holders from operating surplus.' });
    assert.equal(distribution.lines, 1);
    assert.equal(distribution.undistributedRemainderMinor, '0');
    // Whoever proposed it does not approve it.
    await assert.rejects(() => relations.approveDistribution(founder.id, distribution.id, { version: distribution.version }), /forbidden/);
    const approved = await relations.approveDistribution(operator.id, distribution.id, { version: distribution.version });
    assert.equal(approved.state, 'approved');
    const paidOut = await relations.markDistributionPaid(operator.id, distribution.id, { version: approved.version });
    assert.equal(paidOut.note, 'no_investor_payout_rail', 'the record moved; the money did not, and it says so');

    // The investor sees only their own line.
    const investorRelations = await relations.investorView(investorA.id, venture.id);
    assert.equal(investorRelations.units, '1000');
    assert.equal(investorRelations.distributions.length, 1);
    assert.equal(investorRelations.reports.length, 1);
    await assert.rejects(() => relations.investorView(investorB.id, venture.id), /not_found/, 'someone who holds nothing has no investor relations to read');

    // A corporate event records; it does not adjust the register.
    const event = await relations.recordEvent(founder.id, org.id, {
      kind: 'buyback', title: 'Board approved a partial buyback',
      body: 'The board approved a partial buyback, to be executed from the approved document.',
      effectiveAt: new Date().toISOString()
    });
    assert.equal(event.holdingsChanged, false, '06: shares are never adjusted by hand');
    assert.equal((await db.holding.findUniqueOrThrow({ where: { id: holdingRow.id } })).units, 1000n);

    // --- INV-04: the minimum is missed ------------------------------------------------------------------
    const failing = await openOffering(founder.id, reviewer.id, org.id, { minimumRaiseMinor: '90000000' });
    const smallCommitment = await commitments.commit(investorB.id, failing.id, { amountMinor: '1000000' });
    const failingDisclosure = await db.offeringDisclosure.findFirstOrThrow({ where: { offeringId: failing.id }, orderBy: { sequence: 'desc' } });
    await commitments.confirm(investorB.id, smallCommitment.id, { disclosureChecksum: failingDisclosure.checksum, acknowledgedRisk: true, version: smallCommitment.version });
    await payAndSettle(smallCommitment.id);

    let failingOffering = await offerings.getForOrganization(founder.id, org.id, failing.id);
    await offerings.close(founder.id, org.id, failing.id, failingOffering.version);
    failingOffering = await offerings.getForOrganization(founder.id, org.id, failing.id);

    // INV-04's first rule: a round that missed its minimum does not get to issue shares instead.
    // The preview says so, and the request is refused rather than leaving it to the reviewer.
    const failingPreview = await allocations.preview(founder.id, org.id, failing.id);
    assert.equal(failingPreview.minimumReached, false);
    await assert.rejects(
      () => allocations.request(founder.id, org.id, failing.id),
      /conflict/, 'a round below its minimum cannot be allocated; the money goes back'
    );

    const failed = await allocations.declareFailed(founder.id, org.id, failing.id, { version: failingOffering.version });
    assert.equal(failed.state, 'failed');
    assert.equal(failed.toRefund, 1);
    assert.equal((await db.commitment.findUniqueOrThrow({ where: { id: smallCommitment.id } })).state, 'refunding');

    // **The heart of INV-04**: it cannot close while somebody is still owed money.
    failingOffering = await offerings.getForOrganization(founder.id, org.id, failing.id);
    await assert.rejects(
      () => allocations.closeFailed(founder.id, org.id, failing.id, { version: failingOffering.version }),
      /conflict/, 'INV-04: an offering that still owes money is not closed'
    );
    let readiness = await allocations.closingReadiness(founder.id, org.id, failing.id);
    assert.equal(readiness.canClose, false);
    assert.equal(readiness.outstandingCommitments, 1);

    await allocations.refundCommitment(operator.id, smallCommitment.id);
    assert.equal((await db.commitment.findUniqueOrThrow({ where: { id: smallCommitment.id } })).state, 'refunded');

    readiness = await allocations.closingReadiness(founder.id, org.id, failing.id);
    assert.equal(readiness.outstandingCommitments, 0);
    // The escrow must also be empty of what it owed, not merely marked resolved.
    assert.equal(readiness.escrowRestrictedMinor, '0');
    assert.equal(readiness.canClose, true);

    failingOffering = await offerings.getForOrganization(founder.id, org.id, failing.id);
    const closed = await allocations.closeFailed(founder.id, org.id, failing.id, { version: failingOffering.version });
    assert.equal(closed.state, 'closed');

    const failedPool = await db.fundingPool.findUniqueOrThrow({ where: { offeringId: failing.id } });
    assert.equal(await ledger.isBalanced(failedPool.id), true, 'the escrow balances after the refunds');

    // --- Isolation --------------------------------------------------------------------------------------
    await assert.rejects(() => commitments.one(investorB.id, commitment.id), /not_found/, "another investor's commitment is absent");
    await assert.rejects(() => allocations.book(investorA.id, org.id, offering.id), /forbidden/, 'the subscriber book is not a public read');
  } finally {
    await db.$transaction(async tx => {
      const offeringIds = (await tx.offering.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      await tx.exportJob.deleteMany({ where: { ownerId: { in: users } } });
      const ventureIds = (await tx.venture.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      const pools = (await tx.fundingPool.findMany({ where: { offeringId: { in: offeringIds } }, select: { id: true } })).map(row => row.id);
      const eligibilityIds = (await tx.investorEligibility.findMany({ where: { userId: { in: users } }, select: { id: true } })).map(row => row.id);
      for (const table of ['offering_disclosures', 'offering_review_decisions', 'eligibility_decisions', 'nda_acceptances', 'investor_eligibility_submissions', 'identity_audit_events', 'ledger_entries', 'ledger_transactions', 'webhook_inbox', 'subscriptions', 'allocations', 'company_reports', 'corporate_events']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await tx.distributionLine.deleteMany({ where: { distribution: { ventureId: { in: ventureIds } } } });
      await tx.distribution.deleteMany({ where: { ventureId: { in: ventureIds } } });
      await tx.corporateEvent.deleteMany({ where: { ventureId: { in: ventureIds } } });
      await tx.companyReport.deleteMany({ where: { ventureId: { in: ventureIds } } });
      await tx.holding.deleteMany({ where: { ventureId: { in: ventureIds } } });
      await tx.allocation.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.allocationRequest.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.ledgerEntry.deleteMany({ where: { transaction: { poolId: { in: pools } } } });
      await tx.ledgerTransaction.deleteMany({ where: { poolId: { in: pools } } });
      await tx.settlement.deleteMany({ where: { intent: { subscription: { commitment: { offeringId: { in: offeringIds } } } } } });
      await tx.paymentIntent.deleteMany({ where: { subscription: { commitment: { offeringId: { in: offeringIds } } } } });
      await tx.subscription.deleteMany({ where: { commitment: { offeringId: { in: offeringIds } } } });
      await tx.commitment.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.ledgerAccount.deleteMany({ where: { poolId: { in: pools } } });
      await tx.fundingPool.deleteMany({ where: { id: { in: pools } } });
      await tx.offeringInterest.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.offeringReviewDecision.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.offering.updateMany({ where: { id: { in: offeringIds } }, data: { state: 'draft', currentDisclosureId: null } });
      await tx.offeringDisclosure.deleteMany({ where: { offeringId: { in: offeringIds } } });
      await tx.offering.deleteMany({ where: { id: { in: offeringIds } } });
      await tx.venture.deleteMany({ where: { id: { in: ventureIds } } });
      await tx.eligibilityDecision.deleteMany({ where: { eligibilityId: { in: eligibilityIds } } });
      await tx.investorEligibilitySubmission.deleteMany({ where: { eligibilityId: { in: eligibilityIds } } });
      await tx.investorEligibility.deleteMany({ where: { id: { in: eligibilityIds } } });
      await tx.webhookInbox.deleteMany({ where: { eventId: { contains: prefix } } });
      await tx.outboxEvent.deleteMany({});
      await tx.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } });
      for (const table of ['corporate_events', 'company_reports', 'allocations', 'subscriptions', 'webhook_inbox', 'ledger_transactions', 'ledger_entries', 'identity_audit_events', 'investor_eligibility_submissions', 'nda_acceptances', 'eligibility_decisions', 'offering_review_decisions', 'offering_disclosures']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.platformGrant.deleteMany({ where: { userId: { in: users } } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
