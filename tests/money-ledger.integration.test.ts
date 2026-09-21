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
import { SimulatedPaymentPort } from '../apps/api/dist/modules/money/payment-port.js';
import { OperationsService } from '../apps/api/dist/modules/operations/operations.service.js';
import { processExportBatch } from '../apps/worker/dist/exports.js';

/**
 * PART-06 acceptance: CH-01, CH-02, FIN-01, FIN-02, FIN-06, PRIV-01, the worked 100/3 example
 * from 08-FINANCIAL-SYSTEM, and the rule that no money value is ever a floating point number.
 */

const config = loadConfig(process.env);

test('contributions, the ledger, webhook idempotency and contributor privacy on real PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const identity = new IdentityService(db);
  const projects = new ProjectsService(db);
  const charity = new CharityService(db);
  const port = new SimulatedPaymentPort(config.sessionSecret);
  const money = new ContributionsService(db, port);
  const ledger = new LedgerService(db);
  const operations = new OperationsService(db);
  const prefix = randomUUID();
  const users: string[] = [];
  const organizations: string[] = [];

  const createUser = async (suffix: string, twoFactor = false) => {
    const user = await db.user.create({ data: { email: `${prefix}-${suffix}@example.test`, name: `Money ${suffix}`, emailVerified: true, twoFactorEnabled: twoFactor, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };
  /** Feeds a signed event through exactly the path a real provider would use. */
  const deliver = (reference: string, amountMinor: bigint, currency: string, options: { eventId?: string; occurredAt?: Date; type?: 'payment.succeeded' | 'payment.failed' | 'payment.settled' } = {}) => {
    const built = port.buildSignedEvent({
      eventType: options.type ?? 'payment.succeeded',
      providerReference: reference, amountMinor, currency,
      occurredAt: options.occurredAt ?? new Date(),
      ...(options.eventId ? { eventId: options.eventId } : {})
    });
    const parsed = port.parseEvent(built.body);
    assert.ok(parsed, 'the simulator must produce a parseable event');
    return money.receiveProviderEvent(parsed, built.body);
  };

  try {
    const owner = await createUser('owner');
    const reviewer = await createUser('reviewer', true);
    const donorA = await createUser('donor-a');
    const donorB = await createUser('donor-b');

    const org = await identity.createOrganization(owner.id, { legalName: `Money Legal ${prefix}`, displayName: `Money Org ${prefix}`, type: 'NGO', country: 'PS', city: 'Nablus' });
    organizations.push(org.id);
    await db.organization.update({ where: { id: org.id }, data: { verification: 'verified' } });
    await db.platformGrant.create({ data: { userId: reviewer.id, role: 'ContentReviewer', grantedBy: reviewer.id } });
    const city = await db.city.findFirstOrThrow({ where: { country: 'PS', nameEn: 'Nablus' } });

    // A published project with a goal of 100.00 ILS, so the worked example maps exactly.
    const project = await projects.create(owner.id, org.id, {
      type: 'charity', title: `Worked example ${prefix.slice(0, 8)}`,
      summary: 'A project used to verify the ledger against the worked example in the specification.',
      story: 'Story.', cityId: city.id, managerId: owner.id,
      publicLocationPrecision: 'city', latitude: null, longitude: null
    });
    let plan = await charity.plan(owner.id, org.id, project.id);
    await charity.saveCampaign(owner.id, org.id, project.id, { goalMinor: '10000', currency: 'ILS', policy: 'flexible', endsAt: '2027-12-31T00:00:00.000Z', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.reviseBudget(owner.id, org.id, project.id, { lines: [{ label: 'Delivery', amountMinor: '10000' }], reason: '', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.saveMilestones(owner.id, org.id, project.id, { milestones: [{ title: 'Stage one', budgetMinor: '10000', weight: 100 }], version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    const submission = await projects.submit(owner.id, org.id, project.id, plan.version);
    await charity.claim(reviewer.id, submission.id);
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.decide(reviewer.id, submission.id, { outcome: 'approved', publicReason: '', version: plan.version });
    plan = await charity.plan(owner.id, org.id, project.id);
    await charity.publish(reviewer.id, project.id, plan.version);

    // --- The quote states the fee before payment ------------------------------------------------
    const quote = await money.quote(project.slug, '10000');
    assert.equal(quote.amountMinor, '10000');
    // 3% of 100.00 is exactly 3.00, matching the specification's worked example.
    assert.equal(quote.feeMinor, '300');
    assert.equal(quote.netToProjectMinor, '9700');
    assert.equal(quote.remainingCapacityMinor, '10000');
    assert.equal(quote.simulated, true);

    // --- CH-02: two concurrent checkouts cannot both fill the same capacity ----------------------
    const attempts = await Promise.allSettled([
      money.createContribution(donorA.id, `key-a-${prefix}`, { projectSlug: project.slug, amountMinor: '10000', visibility: 'anonymous', showAmountPublicly: false, acceptedQuoteFeeMinor: '300' }),
      money.createContribution(donorB.id, `key-b-${prefix}`, { projectSlug: project.slug, amountMinor: '10000', visibility: 'named', showAmountPublicly: true, acceptedQuoteFeeMinor: '300' })
    ]);
    const accepted = attempts.filter(result => result.status === 'fulfilled');
    assert.equal(accepted.length, 1, 'exactly one checkout may hold the whole remaining capacity');

    const winner = (accepted[0] as PromiseFulfilledResult<Record<string, unknown>>).value;
    const contributionId = String(winner.contributionId);
    const reference = String(winner.providerRedirectPath).split('/').at(-1)!;
    assert.equal(winner.simulated, true);
    assert.equal(winner.status, 'awaiting_action', 'a created intent is not a payment');

    // A stale quote cannot be paid against.
    await assert.rejects(() => money.createContribution(donorA.id, `stale-${prefix}`, { projectSlug: project.slug, amountMinor: '10000', visibility: 'anonymous', showAmountPublicly: false, acceptedQuoteFeeMinor: '1' }), /conflict/);

    // --- Idempotency: the same key and body replays, a different body conflicts -------------------
    // Either donor may have won the race, so the holder is read back rather than assumed.
    const stored = await db.contribution.findUniqueOrThrow({ where: { id: contributionId }, include: { payer: true } });
    const holderId = stored.payer.userId!;
    const donorAWon = holderId === donorA.id;
    const originalKey = donorAWon ? `key-a-${prefix}` : `key-b-${prefix}`;
    const replayInput = { projectSlug: project.slug, amountMinor: '10000', visibility: (donorAWon ? 'anonymous' : 'named') as 'anonymous' | 'named', showAmountPublicly: !donorAWon, acceptedQuoteFeeMinor: '300' };
    const replayed = await money.createContribution(holderId, originalKey, replayInput);
    assert.equal(replayed.contributionId, contributionId, 'the same key and body returns the original result, not a second charge');
    await assert.rejects(() => money.createContribution(holderId, originalKey, { ...replayInput, amountMinor: '5000' }), /conflict/, 'the same key with a different body is a conflict');

    // --- Before confirmation nothing is raised ----------------------------------------------------
    const pool = await db.fundingPool.findFirstOrThrow({ where: { projectId: project.id } });
    let balances = await ledger.balances(pool.id);
    assert.equal(balances.netConfirmedMinor, '0', 'a pending contribution has raised nothing');
    assert.equal(balances.availableMinor, '0');
    assert.equal((await money.publicContributors(project.slug)).length, 0, 'a pending contribution is not a contributor');

    // --- FIN-01: ten deliveries of one event produce one posting ----------------------------------
    const sharedEventId = `evt-${prefix}`;
    const deliveries = await Promise.all(Array.from({ length: 10 }, () => deliver(reference, 10000n, 'ILS', { eventId: sharedEventId })));
    assert.equal(deliveries.filter(result => result.status === 'succeeded').length, 1, 'exactly one delivery is processed');
    assert.equal(deliveries.filter(result => result.status === 'duplicate').length, 9, 'the other nine are acknowledged as duplicates');
    assert.equal(await db.ledgerTransaction.count({ where: { poolId: pool.id, sourceType: 'contribution.confirmed' } }), 1, 'one ledger transaction, not ten');
    assert.equal(await db.outboxEvent.count({ where: { topic: 'contribution.receipt' } }) >= 1, true);
    const receipts = await db.outboxEvent.findMany({ where: { topic: 'contribution.receipt' } });
    assert.equal(receipts.filter(receipt => (receipt.payload as { contributionId?: string }).contributionId === contributionId).length, 1, 'one receipt, not ten');

    // --- The worked example, step by step ----------------------------------------------------------
    balances = await ledger.balances(pool.id);
    assert.equal(balances.grossReceivedMinor, '10000', 'confirmed receipt sits in provider clearing');
    assert.equal(balances.netConfirmedMinor, '10000');
    // Receiving money is not being able to spend it: nothing is available before settlement.
    assert.equal(balances.availableMinor, '0', 'confirmed is not the same as available');

    // Settlement is a second event on the same signed webhook, not something the product decides
    // for itself. It matters that this is the path under test: `settle` had no caller anywhere in
    // the running application, so money confirmed and never became spendable.
    const settlementOutcome = await deliver(reference, 10000n, 'ILS', { type: 'payment.settled' });
    assert.equal(settlementOutcome.status, 'settled', 'settlement arrives from the provider, on the webhook');
    // A replayed settlement posts nothing a second time.
    assert.equal((await deliver(reference, 10000n, 'ILS', { type: 'payment.settled' })).status, 'already_posted');
    assert.equal(await db.ledgerTransaction.count({ where: { poolId: pool.id, sourceType: 'contribution.settled' } }), 1, 'one settlement posting, not two');

    balances = await ledger.balances(pool.id);
    assert.equal(balances.availableMinor, '9700', 'after settlement 100.00 less a 3.00 fee leaves 97.00');
    assert.equal(balances.feesMinor, '300');
    assert.equal(balances.inProviderClearingMinor, '0', 'settlement empties provider clearing');
    // And the direct call demo scripts use is refused once the webhook has already settled it.
    await assert.rejects(() => money.settle(contributionId), /conflict/);

    // --- FIN-06: the books balance and the projection is derived, never stored ----------------------
    assert.equal(await ledger.isBalanced(pool.id), true, 'total debits equal total credits');
    const first = await ledger.balances(pool.id);
    const second = await ledger.balances(pool.id);
    assert.deepEqual(first, second, 're-deriving the projection gives the same answer');
    // Nothing anywhere stores a running balance that could drift from the entries.
    const columns = await db.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name IN ('funding_pools', 'projects', 'campaigns')
        AND (column_name LIKE '%balance%' OR column_name LIKE '%raised%' OR column_name LIKE '%total_received%')
    `;
    assert.deepEqual(columns, [], 'no cached balance column may exist; the ledger is the only source');

    // --- The ledger is append-only ------------------------------------------------------------------
    const anyEntry = await db.ledgerEntry.findFirstOrThrow({ where: { transaction: { poolId: pool.id } } });
    await assert.rejects(() => db.ledgerEntry.update({ where: { id: anyEntry.id }, data: { debitMinor: 1n } }), /append-only/);
    await assert.rejects(() => db.ledgerEntry.deleteMany({ where: { id: anyEntry.id } }), /append-only/);

    // An unbalanced transaction is refused at COMMIT by the database, not only by the service.
    await assert.rejects(() => db.$transaction(async tx => {
      const account = await tx.ledgerAccount.findFirstOrThrow({ where: { poolId: pool.id, code: 'BankCash' } });
      const transaction = await tx.ledgerTransaction.create({ data: { poolId: pool.id, currency: 'ILS', sourceType: 'test.unbalanced', sourceId: randomUUID() } });
      await tx.ledgerEntry.create({ data: { transactionId: transaction.id, accountId: account.id, debitMinor: 500n } });
    }), /does not balance/, 'SQL refuses a transaction whose debits and credits differ');

    // --- FIN-02: a late or out-of-order event does not move the state backwards -----------------------
    // An event the provider stamped *earlier* than the one already applied is rejected as stale.
    const stale = await deliver(reference, 10000n, 'ILS', { eventId: `stale-${prefix}`, occurredAt: new Date(Date.now() - 60_000), type: 'payment.failed' });
    assert.equal(stale.status, 'stale_event', 'an out-of-order event does not move the state backwards');

    // And a *newer* failure on an already-succeeded payment is refused because the state is final:
    // a success the provider gave is not undone by a later contradictory event without a dispute.
    const contradiction = await deliver(reference, 10000n, 'ILS', { eventId: `contradiction-${prefix}`, occurredAt: new Date(Date.now() + 60_000), type: 'payment.failed' });
    assert.equal(contradiction.status, 'already_final');

    assert.equal((await db.contribution.findUniqueOrThrow({ where: { id: contributionId } })).state, 'succeeded');
    assert.equal(await db.ledgerTransaction.count({ where: { poolId: pool.id } }), 2, 'still one confirmation and one settlement');

    // An event whose amount does not match what we issued is refused, not trusted.
    const mismatch = await deliver(reference, 99999n, 'ILS', { eventId: `mismatch-${prefix}` });
    assert.equal(mismatch.status, 'amount_mismatch');
    // An event for a reference we never issued is isolated for review.
    const unknown = await deliver('sim_does_not_exist', 10000n, 'ILS', { eventId: `unknown-${prefix}` });
    assert.equal(unknown.status, 'unknown_reference');

    // A forged signature is rejected before anything is parsed.
    assert.equal(port.verifyWebhook({ rawBody: '{}', signature: 'f'.repeat(64), timestamp: String(Date.now()) }), false);
    // A correctly signed but stale capture cannot be replayed later.
    const old = port.buildSignedEvent({ eventType: 'payment.succeeded', providerReference: reference, amountMinor: 10000n, currency: 'ILS', occurredAt: new Date() });
    assert.equal(port.verifyWebhook({ rawBody: old.rawBody, signature: old.signature, timestamp: String(Date.now() - 10 * 60_000) }), false);

    // --- CH-01 and PRIV-01: contributor identity follows the contributor's choice ---------------------
    const contribution = await db.contribution.findUniqueOrThrow({ where: { id: contributionId } });
    const contributorList = await money.publicContributors(project.slug);
    assert.equal(contributorList.length, 1);
    const entry = contributorList[0]!;
    if (contribution.visibility === 'anonymous') {
      assert.equal(entry.name, null, 'an anonymous contributor has no name in the public projection');
      assert.equal(entry.anonymous, true);
      assert.equal(entry.amountMinor, null, 'nor an amount');
    }

    // The contributor always sees their own record in full.
    const mine = await money.myContributions(holderId);
    const receipt = await money.receipt(holderId, contributionId);
    assert.match(receipt.filename, /^contribution-receipt-/);
    assert.match(receipt.content, /"amountMinor":"10000"/);
    await assert.rejects(() => money.receipt(donorAWon ? donorB.id : donorA.id, contributionId), /not_found/);
    assert.equal(mine.length, 1);
    assert.equal(mine[0]!.amountMinor, '10000');

    // Switching to named, with consent to show the amount, publishes both.
    const named = await money.updatePrivacy(holderId, contributionId, { visibility: 'named', showAmountPublicly: true, version: mine[0]!.version });
    let publicView = await money.publicContributors(project.slug);
    assert.equal(publicView[0]!.anonymous, false);
    assert.ok(publicView[0]!.name, 'a named contributor appears by name');
    assert.equal(publicView[0]!.amountMinor, '10000');

    // PRIV-01: switching back to anonymous removes the name from every public projection at once.
    await money.updatePrivacy(holderId, contributionId, { visibility: 'anonymous', showAmountPublicly: true, version: named.version });
    publicView = await money.publicContributors(project.slug);
    assert.equal(publicView[0]!.name, null, 'the name is gone from the public list immediately');
    assert.equal(publicView[0]!.amountMinor, null, 'and so is the amount');
    assert.equal(JSON.stringify(publicView).includes(`Money ${donorAWon ? 'donor-a' : 'donor-b'}`), false, 'no trace of the contributor remains in the payload');

    // Another person cannot change someone else's privacy.
    const others = await db.contribution.findUniqueOrThrow({ where: { id: contributionId } });
    await assert.rejects(() => money.updatePrivacy(owner.id, contributionId, { visibility: 'named', showAmountPublicly: true, version: others.version }), /not_found/);

    // --- Capacity is now full -------------------------------------------------------------------------
    await assert.rejects(() => money.quote(project.slug, '10000').then(q => {
      assert.equal(q.remainingCapacityMinor, '0');
      assert.equal(q.exceedsCapacity, true);
      throw new Error('capacity-full');
    }), /capacity-full/);

    // --- PUB-06: the public page reports what the ledger says, and says so as money -----------------
    const publicDetail = await projects.publicProject(project.slug);
    assert.equal(publicDetail.funding.available, true, 'a published project with a campaign publishes its figures');
    if (publicDetail.funding.available) {
      assert.equal(publicDetail.funding.raisedMinor, '10000', 'the public figure is the confirmed contribution');
      assert.equal(publicDetail.funding.remainingMinor, '0');
      assert.equal(publicDetail.funding.percentOfGoal, 100);
      assert.equal(publicDetail.funding.acceptsContributions, false, 'a fully funded campaign takes no more money');
      assert.equal(publicDetail.funding.simulated, true, 'a simulated figure is never presented as a real one');
      // The public projection carries money as strings; a JSON number would be a double.
      for (const key of ['goalMinor', 'raisedMinor', 'remainingMinor'] as const) {
        assert.equal(typeof publicDetail.funding[key], 'string');
      }
    }
    // The public payload still carries no contributor identity, whatever the funding figures say.
    assert.equal(JSON.stringify(publicDetail).includes('Money donor'), false);

    // --- ORG-09 / ORG-10: finance.read is a separate grant, and the books balance ---------------------
    // The owner runs the organisation but does not hold finance.read: seeing the ledger is its own
    // decision (08-FINANCIAL-SYSTEM), so this must be refused rather than allowed by seniority.
    await assert.rejects(() => money.organizationFinance(owner.id, org.id, project.id), /forbidden/, 'running the organisation is not the same as reading its ledger');

    const financeStaff = await createUser('finance');
    await db.membership.create({ data: { userId: financeStaff.id, organizationId: org.id, roles: ['FinanceApprover'], status: 'active' } });
    const finance = await money.organizationFinance(financeStaff.id, org.id, project.id);
    assert.equal(finance.hasPool, true);
    assert.ok(finance.balances);
    assert.equal(finance.balances!.netConfirmedMinor, '10000');
    // Confirmed funding and spendable cash are deliberately different numbers: 3.00 went to the fee.
    assert.equal(finance.balances!.availableMinor, '9700');
    assert.equal(finance.balances!.feesMinor, '300');
    assert.equal(finance.journal.length, 2, 'one confirmation and one settlement');
    for (const transaction of finance.journal) {
      const debits = transaction.entries.reduce((total, entry) => total + BigInt(entry.debitMinor), 0n);
      const credits = transaction.entries.reduce((total, entry) => total + BigInt(entry.creditMinor), 0n);
      assert.equal(debits, credits, 'every transaction balances, entry by entry');
    }
    // The operational list carries amounts to reconcile but no identity, even for a named contributor.
    assert.equal(finance.contributors.length, 1);
    assert.equal(Object.hasOwn(finance.contributors[0]!, 'name'), false, 'a contributor identity is not part of a finance read');
    assert.equal(JSON.stringify(finance).includes('Money donor'), false);
    const contributionExport = await operations.requestOrganizationExport(financeStaff.id, org.id, project.id, 'organization_contributions_csv');
    const ledgerExport = await operations.requestOrganizationExport(financeStaff.id, org.id, project.id, 'organization_ledger_csv');
    assert.equal(await processExportBatch(db), 2);
    const contributionCsv = (await operations.downloadExport(financeStaff.id, contributionExport.id)).content ?? '';
    assert.match(contributionCsv, /amount_minor/);
    assert.equal(contributionCsv.includes('Money donor'), false, 'the finance export is redacted just like the screen');
    const ledgerCsv = (await operations.downloadExport(financeStaff.id, ledgerExport.id)).content ?? '';
    assert.match(ledgerCsv, /account_code/);
    assert.match(ledgerCsv, /ProviderClearing/);
    await assert.rejects(() => operations.downloadExport(owner.id, ledgerExport.id), /not_found/);

    // A member of another organisation reaches nothing here, and neither does an outsider.
    await assert.rejects(() => money.organizationFinance(donorA.id, org.id, project.id), /forbidden|not_found/);

    // --- No floating point anywhere in the money path ---------------------------------------------------
    const amounts = await db.$queryRaw<Array<{ table_name: string; column_name: string; data_type: string }>>`
      SELECT table_name, column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public'
        AND (column_name LIKE '%_minor' OR column_name LIKE '%amount%' OR column_name LIKE '%goal%')
    `;
    const floating = amounts.filter(column => ['double precision', 'real', 'numeric'].includes(column.data_type));
    assert.deepEqual(floating, [], 'every money column must be an integer type, never a float');
  } finally {
    await db.$transaction(async tx => {
      const projectIds = (await tx.project.findMany({ where: { organizationId: { in: organizations } }, select: { id: true } })).map(row => row.id);
      await tx.exportJob.deleteMany({ where: { ownerId: { in: users } } });
      for (const table of ['ledger_entries', 'ledger_transactions', 'project_review_decisions', 'budget_revisions', 'project_versions', 'webhook_inbox']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} DISABLE TRIGGER USER`);
      }
      const pools = await tx.fundingPool.findMany({ where: { projectId: { in: projectIds } }, select: { id: true } });
      const poolIds = pools.map(row => row.id);
      await tx.ledgerEntry.deleteMany({ where: { transaction: { poolId: { in: poolIds } } } });
      await tx.ledgerTransaction.deleteMany({ where: { poolId: { in: poolIds } } });
      await tx.settlement.deleteMany({ where: { intent: { contribution: { projectId: { in: projectIds } } } } });
      await tx.paymentIntent.deleteMany({ where: { contribution: { projectId: { in: projectIds } } } });
      await tx.contribution.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.ledgerAccount.deleteMany({ where: { poolId: { in: poolIds } } });
      await tx.fundingPool.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.webhookInbox.deleteMany({ where: { eventId: { contains: prefix } } });
      await tx.outboxEvent.deleteMany({});
      await tx.idempotencyRecord.deleteMany({ where: { actorId: { in: users } } });
      await tx.projectReviewDecision.deleteMany({ where: { projectVersion: { projectId: { in: projectIds } } } });
      await tx.projectVersion.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.budgetRevision.deleteMany({ where: { projectId: { in: projectIds } } });
      for (const table of ['webhook_inbox', 'project_versions', 'budget_revisions', 'project_review_decisions', 'ledger_transactions', 'ledger_entries']) {
        await tx.$executeRawUnsafe(`ALTER TABLE ${table} ENABLE TRIGGER USER`);
      }
      await tx.milestone.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.budgetLine.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.campaign.deleteMany({ where: { projectId: { in: projectIds } } });
      await tx.project.deleteMany({ where: { id: { in: projectIds } } });
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
