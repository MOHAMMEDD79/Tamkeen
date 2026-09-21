import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { IdentityService } from '../apps/api/dist/modules/identity/identity.service.js';
import { ProjectsService } from '../apps/api/dist/modules/projects/projects.service.js';
import { CharityService } from '../apps/api/dist/modules/projects/charity.service.js';
import { ContributionsService } from '../apps/api/dist/modules/money/contributions.service.js';
import { LedgerService } from '../apps/api/dist/modules/money/ledger.service.js';
import { PayoutsService } from '../apps/api/dist/modules/money/payouts.service.js';
import { RefundsService } from '../apps/api/dist/modules/money/refunds.service.js';
import { ReconciliationService, statementHash } from '../apps/api/dist/modules/money/reconciliation.service.js';
import { SimulatedPaymentPort } from '../apps/api/dist/modules/money/payment-port.js';

/**
 * PART-07 acceptance: FIN-03, FIN-04, FIN-05, the unknown-outcome inquiry, insufficient balance,
 * cancellation after execution, and the numeric worked example in 08-FINANCIAL-SYSTEM —
 * a contribution of 100.00, a fee of 3.00, a payout of 60.00, then 38.00 refused and 37.00 allowed.
 *
 * Everything runs against real PostgreSQL, because the guarantees being checked are transactional:
 * row locks, deferred constraint triggers and unique keys are the mechanism, not the service code.
 */

const config = loadConfig(process.env);
const ILS = 'ILS';

test('payouts, refunds, disputes and reconciliation on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const projects = new ProjectsService(db);
  const charity = new CharityService(db);
  const port = new SimulatedPaymentPort(config.sessionSecret, db);
  const money = new ContributionsService(db, port);
  const ledger = new LedgerService(db);
  const payouts = new PayoutsService(db, port);
  const refunds = new RefundsService(db, port);
  const reconciliation = new ReconciliationService(db, config.environment);

  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];
  const batches: string[] = [];

  const createUser = async (suffix: string, twoFactor = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Payout ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  /** Confirms a contribution through the real signed webhook path, then settles it. */
  const contribute = async (donorId: string, slug: string, amountMinor: string, key: string) => {
    const quote = await money.quote(slug, amountMinor);
    const created = await money.createContribution(donorId, key, {
      projectSlug: slug, amountMinor, visibility: 'named', showAmountPublicly: true, acceptedQuoteFeeMinor: quote.feeMinor
    });
    const reference = created.providerRedirectPath.split('/').at(-1)!;
    const event = port.buildSignedEvent({ eventType: 'payment.succeeded', providerReference: reference, amountMinor: BigInt(amountMinor), currency: ILS, occurredAt: new Date() });
    const parsed = port.parseEvent(event.body);
    assert.ok(parsed);
    const outcome = await money.receiveProviderEvent(parsed, event.body);
    assert.equal(outcome.status, 'succeeded');
    await money.settle(created.contributionId);
    return { contributionId: created.contributionId, providerReference: reference };
  };

  try {
    const owner = await createUser('owner');
    const reviewer = await createUser('reviewer', true);
    const maker = await createUser('maker');
    const approver = await createUser('approver', true);
    const operator = await createUser('operator', true);
    const donor = await createUser('donor');

    const org = await identity.createOrganization(owner.id, { legalName: `Payout Legal ${prefix}`, displayName: `Payout Org ${prefix}`, type: 'NGO', country: 'PS', city: 'Nablus' });
    organizations.push(org.id);
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    await db.platformGrant.create({ data: { userId: reviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id } });
    await db.platformGrant.create({ data: { userId: operator.id, role: 'FinanceOperator', grantedBy: operator.id } });
    await db.membership.create({ data: { userId: maker.id, organizationId: org.id, roles: ['FinanceMaker'], status: 'active' } });
    await db.membership.create({ data: { userId: approver.id, organizationId: org.id, roles: ['FinanceApprover'], status: 'active' } });

    // A verified bank account is the only thing a payout may be sent to (08).
    const bankRequest = await db.organizationBankChangeRequest.create({
      data: {
        organizationId: org.id, organizationVersion: 1, requestedBy: owner.id,
        bankName: 'Bank of Palestine', accountHolder: `Payout Org ${prefix}`,
        accountIdentifierCiphertext: 'x', accountIdentifierHash: 'a'.repeat(64),
        accountLast4: '6703', country: 'PS', currency: ILS,
        // The review state carries its reviewer, which a CHECK constraint enforces.
        state: 'approved', reviewedBy: reviewer.id, reviewedAt: new Date()
      }
    });
    await db.organizationBankAccount.create({
      data: {
        organizationId: org.id, sourceRequestId: bankRequest.id,
        bankName: 'Bank of Palestine', accountHolder: `Payout Org ${prefix}`,
        accountIdentifierCiphertext: 'x', accountIdentifierHash: 'a'.repeat(64),
        accountLast4: '6703', country: 'PS', currency: ILS
      }
    });

    const city = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Nablus' } });
    const project = await projects.create(owner.id, org.id, {
      type: 'charity', title: `Disbursement example ${prefix.slice(0, 8)}`,
      summary: 'A project used to verify payouts, refunds and reconciliation against the specification.',
      story: 'Story.', cityId: city.id, managerId: owner.id,
      publicLocationPrecision: 'city', latitude: null, longitude: null
    });
    let plan = await charity.plan(owner.id, org.id, project.id);
    await charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: '20000', currency: ILS, policy: 'flexible', endsAt: '2027-12-31T00:00:00.000Z', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.reviseBudget(owner.id, org.id, project.id, { lines: [{ label: 'Delivery', amountMinor: '20000' }], reason: '', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.saveMilestones(owner.id, org.id, project.id, { milestones: [{ title: 'Stage one', budgetMinor: '20000', weight: 100 }], version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    const submission = await projects.submit(owner.id, org.id, project.id, plan.version);
    await charity.claim(reviewer.id, submission.id);
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.decide(reviewer.id, submission.id, { outcome: 'approved', publicReason: '', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.publish(reviewer.id, project.id, plan.version);

    // --- The worked example in 08: 100.00 in, 3.00 fee, and 97.00 spendable ----------------------
    const contribution = await contribute(donor.id, project.slug, '10000', `key-${prefix}`);
    const pool = await db.fundingPool.findFirstOrThrow({ where: { projectId: project.id } });
    let balances = await ledger.balances(pool.id);
    assert.equal(balances.availableMinor, '9700', 'settled cash is the contribution less the processor fee');
    assert.equal(balances.feesMinor, '300', 'the fee charged is stated, not folded into the net');
    // The correction this part makes to PART-06: under the declared policy the pool bears the fee,
    // so what we owe the project equals what the project can actually spend.
    assert.equal(balances.restrictedMinor, '9700', 'restricted funds track spendable money, not gross receipts');

    // --- Insufficient balance: a payout larger than the settled cash is refused -------------------
    await assert.rejects(
      () => payouts.request(maker.id, org.id, { projectId: project.id, amountMinor: '9701', reason: 'More than the pool actually holds.' }),
      /conflict/, 'a payout cannot exceed the available settled balance'
    );

    // --- The 60.00 disbursement from the worked example -------------------------------------------
    const payout = await payouts.request(maker.id, org.id, { projectId: project.id, amountMinor: '6000', reason: 'Stage one delivery against invoice 41.', invoiceReference: 'INV-41' });
    assert.equal(payout.state, 'requested');
    assert.equal(payout.beneficiary.last4, '6703');
    // 12-SECURITY: the bank identifier is never in a payout payload, only the last four digits.
    assert.equal(JSON.stringify(payout).includes('accountIdentifier'), false);

    balances = await ledger.balances(pool.id);
    assert.equal(balances.heldMinor, '6000', 'a reservation is a transfer of obligation, not a payment');
    assert.equal(balances.availableMinor, '3700', 'and it reduces what is left to commit');
    // The money has not moved: reserving must not touch cash.
    const afterReserve = await db.ledgerTransaction.findFirstOrThrow({ where: { sourceType: 'payout.reserved', sourceId: payout.id }, include: { entries: { include: { account: true } } } });
    assert.equal(afterReserve.entries.some(entry => entry.account.code === 'BankCash'), false, 'reserving a payout does not move cash');

    // --- The maker cannot approve their own request -----------------------------------------------
    await assert.rejects(
      () => payouts.approve(maker.id, payout.id, { requestHash: payout.requestHash, version: payout.version }),
      /forbidden/, 'the person who asked for the money may never be the person who approves it'
    );
    // Nor may the database be talked into recording it, whatever the service does.
    await assert.rejects(
      () => db.payout.update({ where: { id: payout.id }, data: { approverId: payout.makerId, approvedAt: new Date() } }),
      /payouts_maker_is_not_approver|violates check constraint/, 'separation of duties is enforced in SQL too'
    );

    // An approver looking at a stale version of the request is refused.
    await assert.rejects(
      () => payouts.approve(approver.id, payout.id, { requestHash: 'f'.repeat(64), version: payout.version }),
      /conflict/, 'an approval is bound to the exact request it was given for'
    );

    const approved = await payouts.approve(approver.id, payout.id, { requestHash: payout.requestHash, version: payout.version });
    assert.equal(approved.state, 'approved');
    assert.equal(approved.paidProofReference, null, 'approved is not paid: there is no proof yet');

    // --- FIN-03: two concurrent payouts cannot both take the same remaining money ------------------
    // 37.00 is left. Two simultaneous requests of 25.00 each: the ledger must not go negative.
    const race = await Promise.allSettled([
      payouts.request(maker.id, org.id, { projectId: project.id, amountMinor: '2500', reason: 'Concurrent request one against remaining funds.' }),
      payouts.request(maker.id, org.id, { projectId: project.id, amountMinor: '2500', reason: 'Concurrent request two against remaining funds.' })
    ]);
    const acceptedRace = race.filter(result => result.status === 'fulfilled');
    // Both fit in 37.00 (25 + 25 = 50 does not), so exactly one may succeed.
    assert.equal(acceptedRace.length, 1, 'two concurrent payouts cannot both reserve money only one of them has');
    balances = await ledger.balances(pool.id);
    assert.equal(BigInt(balances.availableMinor) >= 0n, true, 'no unexplained negative balance');
    assert.equal(balances.availableMinor, '1200', '37.00 less the one 25.00 that got through');

    // Clear that reservation again so the worked example continues from 37.00.
    const racer = (acceptedRace[0] as PromiseFulfilledResult<{ id: string; version: number }>).value;
    await payouts.withdraw(maker.id, racer.id, { version: racer.version });
    balances = await ledger.balances(pool.id);
    assert.equal(balances.availableMinor, '3700', 'withdrawing a request returns the money to the pool');

    // --- Execution is the platform's half, and re-checks everything -------------------------------
    await assert.rejects(
      () => payouts.execute(approver.id, payout.id, { version: approved.version }),
      /forbidden/, 'an organisation approver cannot also execute the payment'
    );
    const executed = await payouts.execute(operator.id, payout.id, { version: approved.version });
    assert.equal(executed.state, 'processing');
    assert.equal(executed.awaitingProvider, true);

    // --- Cancelling after execution is refused ----------------------------------------------------
    await assert.rejects(
      () => payouts.withdraw(maker.id, payout.id, { version: executed.version }),
      /conflict/, 'once the instruction has left, only the provider can say what happened to it'
    );

    // --- FIN-04: a timeout leaves `unknown`, and only an inquiry resolves it ----------------------
    // Our side loses the answer, while the provider's own record says the money did leave.
    const lost = await payouts.recordProviderOutcome(payout.id, { result: 'unknown' });
    assert.equal(lost.status, 'unknown');
    assert.equal(lost.payout.needsInquiry, true);
    balances = await ledger.balances(pool.id);
    assert.equal(balances.heldMinor, '6000', 'an unknown outcome moves no money in either direction');
    assert.equal(balances.availableMinor, '3700');

    // The provider knows it succeeded. This is a different store from ours on purpose: an inquiry
    // that read our own record would prove nothing.
    await port.recordProviderTruth('payout', executed.providerReference!, 'paid', 'bank-ref-88213');
    const resolved = await payouts.inquire(operator.id, payout.id);
    assert.equal(resolved.status, 'paid', 'the inquiry establishes what actually happened');
    assert.equal(resolved.payout.paidProofReference, 'bank-ref-88213', 'paid carries the provider’s own proof');

    balances = await ledger.balances(pool.id);
    assert.equal(balances.heldMinor, '0', 'the reservation clears when the money actually leaves');
    // The worked example: 100.00 in, 3.00 fee, 60.00 out, 37.00 available.
    assert.equal(balances.availableMinor, '3700');
    // Restricted and available are the same figure from the two sides of the books once nothing is
    // reserved: what we owe the project is exactly what the project can still spend.
    assert.equal(balances.restrictedMinor, '3700');

    // A second inquiry does not pay twice: the posting is keyed by the payout.
    const again = await payouts.inquire(operator.id, payout.id).catch((error: Error) => error);
    assert.equal(again instanceof Error, true, 'a settled payout is not inquired about again');
    assert.equal(await db.ledgerTransaction.count({ where: { sourceType: 'payout.paid', sourceId: payout.id } }), 1);

    // --- 38.00 refused, 37.00 allowed --------------------------------------------------------------
    await assert.rejects(
      () => payouts.request(maker.id, org.id, { projectId: project.id, amountMinor: '3800', reason: 'One unit more than the pool has left to give.' }),
      /conflict/, '38.00 is more than the 37.00 that remains'
    );
    const lastPayout = await payouts.request(maker.id, org.id, { projectId: project.id, amountMinor: '3700', reason: 'Exactly the remaining balance, which must be allowed.' });
    assert.equal(lastPayout.state, 'requested', '37.00 is exactly what remains and must be accepted');
    await payouts.withdraw(maker.id, lastPayout.id, { version: lastPayout.version });

    // --- FIN-05: refunds never exceed what is left to refund ---------------------------------------
    const second = await contribute(donor.id, project.slug, '5000', `key2-${prefix}`);
    await assert.rejects(
      () => refunds.request(donor.id, second.contributionId, { amountMinor: '5001', reason: 'More than was ever contributed.' }),
      /conflict/, 'a refund larger than the contribution is refused'
    );

    // Two concurrent partial refunds that would together exceed the remainder.
    const refundRace = await Promise.allSettled([
      refunds.request(donor.id, second.contributionId, { amountMinor: '3000', reason: 'Concurrent partial refund one.' }),
      refunds.request(donor.id, second.contributionId, { amountMinor: '3000', reason: 'Concurrent partial refund two.' })
    ]);
    const acceptedRefunds = refundRace.filter(result => result.status === 'fulfilled');
    assert.equal(acceptedRefunds.length, 1, 'two concurrent refunds cannot both claim the same money');
    const partial = (acceptedRefunds[0] as PromiseFulfilledResult<{ id: string; version: number; amountMinor: string }>).value;

    // A requested refund already holds the money, so only 20.00 is still refundable.
    const view = await refunds.listForContribution(donor.id, second.contributionId);
    assert.equal(view.remainingRefundableMinor, '2000', 'a pending refund holds the money it asked for');

    // The requester cannot approve their own refund.
    await assert.rejects(() => refunds.approve(donor.id, partial.id, { version: partial.version }), /forbidden/);
    const approvedRefund = await refunds.approve(operator.id, partial.id, { version: partial.version });
    assert.equal(approvedRefund.state, 'approved');
    balances = await ledger.balances(pool.id);
    assert.equal(balances.refundsPendingMinor, '3000', 'an approved refund holds cash that is no longer available');

    const processing = await refunds.execute(operator.id, partial.id, { version: approvedRefund.version });
    const refundOutcome = await refunds.recordProviderOutcome(processing.id, { result: 'succeeded' });
    assert.equal(refundOutcome.status, 'succeeded');
    const refundedContribution = await db.contribution.findUniqueOrThrow({ where: { id: second.contributionId } });
    assert.equal(refundedContribution.state, 'partially_refunded', 'part of it came back, so it is not simply refunded');
    assert.equal(refundedContribution.refundedMinor, 3000n);

    balances = await ledger.balances(pool.id);
    assert.equal(balances.refundedMinor, '3000', 'money actually returned is counted, not money merely approved');
    assert.equal(balances.refundsPendingMinor, '0');

    // --- A refund with a non-refundable fee ---------------------------------------------------------
    // Refunding the first contribution in full costs 100.00 back plus the 3.00 the processor keeps.
    const fullRefund = await refunds.request(donor.id, contribution.contributionId, { amountMinor: '10000', reason: 'A full return, where the processor keeps its fee.' });
    assert.equal(fullRefund.feeMinor, '300', 'a full refund does not recover the processor fee');
    // 08: it cannot be paid out of the net alone, and here the pool no longer holds enough at all.
    await assert.rejects(
      () => refunds.approve(operator.id, fullRefund.id, { version: fullRefund.version }),
      /conflict/, 'a refund that the pool cannot actually fund is refused rather than approved on paper'
    );

    // --- A dispute after the money was disbursed ---------------------------------------------------
    const dispute = await refunds.openDispute(operator.id, contribution.contributionId, {
      amountMinor: '10000', reason: 'Chargeback raised by the card issuer after delivery.',
      coveragePlan: 'Covered from the reserve pending the outcome of the dispute.'
    });
    balances = await ledger.balances(pool.id);
    assert.equal(balances.disputedMinor, '10000', 'the obligation is recognised the moment it is raised');
    // The original payment still happened: a dispute does not rewrite it (08).
    assert.equal((await db.contribution.findUniqueOrThrow({ where: { id: contribution.contributionId } })).state, 'succeeded');

    const lostDispute = await refunds.resolveDispute(operator.id, dispute.id, { outcome: 'lost', reason: 'The issuer found for the cardholder.', version: dispute.version });
    assert.equal(lostDispute.state, 'lost');
    balances = await ledger.balances(pool.id);
    // The money was already disbursed, so the pool now owes more than it holds. 08 forbids hiding
    // that by clamping the balance: the gap is reported as a shortfall.
    assert.equal(BigInt(balances.availableMinor) < 0n, true, 'a real overdraft is shown as one');
    assert.equal(balances.shortfallMinor !== '0', true, 'and the gap is named rather than rounded away');

    // The books still balance, however unwelcome the numbers are.
    assert.equal(await ledger.isBalanced(pool.id), true, 'every transaction balances even in a shortfall');

    // --- Reconciliation ------------------------------------------------------------------------------
    const rows = [
      // Agrees with what we hold.
      { providerTransactionId: contribution.providerReference, amountMinor: '10000', currency: ILS, feeMinor: '300', outcome: 'succeeded' },
      // The provider says a different fee than we recorded.
      { providerTransactionId: second.providerReference, amountMinor: '5000', currency: ILS, feeMinor: '999', outcome: 'succeeded' },
      // Something the platform has no record of at all.
      { providerTransactionId: `ghost_${prefix.slice(0, 8)}`, amountMinor: '4200', currency: ILS, feeMinor: '0', outcome: 'succeeded' }
    ];
    const batch = await reconciliation.import(operator.id, { source: 'simulator', statementDate: '2026-09-19T00:00:00.000Z', rows });
    batches.push(batch.id);
    assert.equal(batch.rowCount, 3);
    assert.equal(batch.fileHash, statementHash(rows), 'the batch is identified by the statement it came from');

    // The same statement cannot be imported twice and counted twice.
    await assert.rejects(
      () => reconciliation.import(operator.id, { source: 'simulator', statementDate: '2026-09-19T00:00:00.000Z', rows }),
      /conflict/, 'the same statement file cannot be imported twice'
    );

    const firstRun = await reconciliation.run(operator.id, batch.id);
    assert.deepEqual(firstRun.counts, { match: 1, mismatch: 1, missing: 1, duplicate: 0 });

    // ADM-05.A02: re-running must not double anything. Nothing about the ledger changes at all.
    const ledgerCountBefore = await db.ledgerTransaction.count({ where: { poolId: pool.id } });
    const secondRun = await reconciliation.run(operator.id, batch.id);
    assert.deepEqual(secondRun.counts, firstRun.counts, 'a second run reaches the same verdicts');
    assert.equal(await db.ledgerTransaction.count({ where: { poolId: pool.id } }), ledgerCountBefore, 'reconciliation writes no ledger entries');

    const detail = await reconciliation.batch(operator.id, batch.id);
    const missing = detail.items.find(item => item.matchState === 'missing')!;
    assert.equal(missing.ourAmountMinor, null, 'holding no record is null, not a zero amount');
    const mismatch = detail.items.find(item => item.matchState === 'mismatch')!;
    // 3% of the 50.00 second contribution, against the 9.99 the statement claims.
    assert.equal(mismatch.ourFeeMinor, '150');
    // A machine code, so a screen can name the difference in the reader's language.
    assert.match(mismatch.note, /fee_differs/);

    // A difference is closed with a signed reason, and the statement figures are never edited.
    await assert.rejects(
      () => db.reconciliationItem.update({ where: { id: mismatch.id }, data: { amountMinor: 1n } }),
      /evidence and cannot be edited|23514/, 'an imported statement line cannot be edited to make a difference disappear'
    );
    const resolvedItem = await reconciliation.resolve(operator.id, mismatch.id, { reason: 'Provider re-stated the fee after a tariff correction; our figure stands.', version: mismatch.version });
    assert.ok(resolvedItem.resolvedAt);
    await assert.rejects(
      () => reconciliation.resolve(operator.id, mismatch.id, { reason: 'A second, contradictory explanation for the same line.', version: resolvedItem.version }),
      /conflict/, 'a resolution is written once'
    );

    // The overview distinguishes "never run" from "found nothing", and counts what is still open.
    const overview = await reconciliation.overview(operator.id);
    assert.ok(overview.lastRunAt, 'the last reconciliation time is reported');
    assert.equal(overview.openItems.some(item => item.matchState === 'missing'), true, 'an unexplained provider operation stays on the list');
    assert.equal(overview.environment, config.environment);

    // --- Nobody outside the organisation or the platform can see any of this ------------------------
    const outsider = await createUser('outsider');
    await assert.rejects(() => payouts.list(outsider.id, org.id), /forbidden/);
    await assert.rejects(() => payouts.get(outsider.id, payout.id), /forbidden/);
    await assert.rejects(() => reconciliation.overview(owner.id), /forbidden/, 'reconciliation is platform finance, not an organisation read');
  } finally {
    await db.$transaction(async tx => {
      const projectIds = (await tx.project.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      const pools = await tx.fundingPool.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
      const poolIds = pools.map(row => row.id);
      for (const table of ['ledger_entries', 'ledger_transactions', 'project_review_decisions', 'budget_revisions', 'project_versions', 'webhook_inbox', 'payout_decisions', 'reconciliation_items', 'identity_audit_events']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      await tx.reconciliationItem.deleteMany({ where: { batchId: { in: batches } } });
      await tx.reconciliationBatch.deleteMany({ where: { id: { in: batches } } });
      await tx.simulatedProviderOperation.deleteMany({});
      await tx.ledgerEntry.deleteMany({ where: { transaction: { poolId: { in: poolIds } } } });
      await tx.ledgerTransaction.deleteMany({ where: { poolId: { in: poolIds } } });
      await tx.payoutDecision.deleteMany({ where: { payout: { poolId: { in: poolIds } } } });
      await tx.payout.deleteMany({ where: { poolId: { in: poolIds } } });
      await tx.dispute.deleteMany({ where: { poolId: { in: poolIds } } });
      await tx.refund.deleteMany({ where: { poolId: { in: poolIds } } });
      await tx.settlement.deleteMany({ where: { intent: { contribution: { projectId: { in: projectIds } } } } });
      await tx.paymentIntent.deleteMany({ where: { contribution: { projectId: { in: projectIds } } } });
      await tx.contribution.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.ledgerAccount.deleteMany({ where: { poolId: { in: poolIds } } });
      await tx.fundingPool.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.webhookInbox.deleteMany({ where: { eventId: { contains: prefix } } });
      await tx.outboxEvent.deleteMany({});
      await tx.idempotencyRecord.deleteMany({ where: { actorId: { in: users } } });
      await tx.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } });
      await tx.projectReviewDecision.deleteMany({ where: { projectVersion: { projectId: { in: projectIds } } } });
      await tx.projectVersion.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.budgetRevision.deleteMany({ where: { projectId: { in: projectIds } } });
      for (const table of ['identity_audit_events', 'reconciliation_items', 'payout_decisions', 'webhook_inbox', 'project_versions', 'budget_revisions', 'project_review_decisions', 'ledger_transactions', 'ledger_entries']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await tx.milestone.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.budgetLine.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.campaign.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.project.deleteMany({ where: { id: { in: projectIds } } });
      await tx.organizationBankAccount.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.organizationBankChangeRequest.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.membership.deleteMany({ where: { organizationId: { in: organizations } } });
      await tx.party.deleteMany({ where: { OR: [{ userId: { in: users } }, { organizationId: { in: organizations } }] } });
      await tx.organization.deleteMany({ where: { id: { in: organizations } } });
      await tx.platformGrant.deleteMany({ where: { OR: [{ userId: { in: users } }, { grantedBy: { in: users } }] } });
      await tx.individualProfile.deleteMany({ where: { userId: { in: users } } });
      await tx.session.deleteMany({ where: { userId: { in: users } } });
      await tx.user.deleteMany({ where: { id: { in: users } } });
    });
    await db.$disconnect();
  }
});
