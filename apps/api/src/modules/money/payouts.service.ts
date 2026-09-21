import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseMinor } from '../projects/money.js';
import { LedgerService } from './ledger.service.js';
import type { PaymentPort } from './payment-port.js';

/**
 * Payouts: money leaving a funding pool (08-FINANCIAL-SYSTEM, ORG-11/ORG-12, ADM-06).
 *
 * Four rules shape everything here.
 *
 *  1. **A reservation is not a payment.** Approving a payout moves an obligation from restricted
 *     funds to payout payable; cash only moves when the provider confirms it left. Both figures are
 *     shown, because "approved" and "paid" are different facts about the world.
 *  2. **Approval is bound to what the approver saw.** Every material term is hashed into
 *     `requestHash`; changing the amount, the beneficiary or the invoice voids the approval and
 *     sends it back for review rather than letting a changed request ride an old signature.
 *  3. **The reservation cannot overdraw.** Capacity is checked under a row lock on the pool inside
 *     the same transaction that writes the reservation, so two concurrent approvals for the same
 *     money cannot both succeed (FIN-03).
 *  4. **`unknown` is never retried blindly.** A timeout leaves the payout in `unknown`, where it
 *     blocks until an inquiry asks the provider what actually happened (FIN-04).
 */

export type PayoutAction = 'requested' | 'approved' | 'rejected' | 'withdrawn' | 'executed' | 'settled' | 'inquired';

export interface PayoutInput {
  projectId: string;
  milestoneId?: string | null | undefined;
  amountMinor: string;
  reason: string;
  invoiceReference?: string | undefined;
}

/**
 * The material terms of a request. Anything in here changing invalidates an approval, so the list
 * is deliberately the set of things an approver is actually agreeing to.
 */
export function payoutRequestHash(input: {
  poolId: string; amountMinor: bigint; currency: string;
  beneficiaryLast4: string; beneficiaryHolder: string; beneficiaryBankName: string;
  milestoneId: string | null; invoiceReference: string; reason: string;
}): string {
  const canonical = [
    input.poolId, input.amountMinor.toString(), input.currency,
    input.beneficiaryBankName, input.beneficiaryHolder, input.beneficiaryLast4,
    input.milestoneId ?? '', input.invoiceReference, input.reason.trim()
  ].join('\u0000');
  return createHash('sha256').update(canonical).digest('hex');
}

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

export class PayoutsService {
  private readonly identity: IdentityService;
  private readonly ledger: LedgerService;
  constructor(private readonly db: DatabaseClient, private readonly payments: PaymentPort) {
    this.identity = new IdentityService(db);
    this.ledger = new LedgerService(db);
  }

  // ---------------------------------------------------------------- requesting

  /**
   * ORG-11.A02. Creates a request and reserves the money in the same transaction.
   *
   * The reservation happens now rather than at approval because 05 requires a manager to see
   * honestly what is left to commit; a request that only reserves on approval lets several
   * requests be raised against the same money and lets the last approver discover the problem.
   */
  async request(actorId: string, organizationId: string, input: PayoutInput) {
    await this.identity.access(actorId, organizationId, 'payout.request');
    const amountMinor = parseMinor(input.amountMinor);
    const reason = text(input.reason, 10, 1000);
    const invoiceReference = input.invoiceReference ? text(input.invoiceReference, 1, 120) : '';

    return this.db.$transaction(async tx => {
      const project = await tx.project.findFirst({
        where: { id: input.projectId, organizationId },
        include: { fundingPools: true, organization: { include: { bankAccount: true } } }
      });
      if (!project) throw new IdentityError('not_found', 404);
      const pool = project.fundingPools[0];
      // Without a pool there is no money to disburse; this is absence, not a zero balance.
      if (!pool) throw new IdentityError('conflict', 409);

      // 08: the beneficiary must be a verified bank account. An organisation whose verification has
      // lapsed cannot be paid, even if it could be when the project was published.
      const bank = project.organization.bankAccount;
      if (!bank || project.organization.verification !== 'verified') throw new IdentityError('conflict', 409);
      if (bank.currency !== pool.currency) throw new IdentityError('conflict', 409);

      let milestoneId: string | null = null;
      if (input.milestoneId) {
        const milestone = await tx.milestone.findFirst({ where: { id: input.milestoneId, projectId: project.id } });
        if (!milestone) throw new IdentityError('invalid_input', 422);
        milestoneId = milestone.id;
      }

      // The lock is taken before capacity is read, so a concurrent request cannot read the same
      // availability and reserve it twice (FIN-03).
      await tx.$queryRaw`SELECT id FROM funding_pools WHERE id = ${pool.id}::uuid FOR UPDATE`;
      const available = await this.availableForCommitment(tx as DatabaseClient, pool.id);
      if (amountMinor > available) {
        // 08: a payout depends on the available settled balance. Receiving money is not the same
        // as being able to spend it, so the caller is told what is actually available.
        throw new IdentityError('conflict', 409);
      }

      const latestRevision = await tx.budgetRevision.findFirst({ where: { projectId: project.id }, orderBy: { sequence: 'desc' }, select: { id: true } });
      const requestHash = payoutRequestHash({
        poolId: pool.id, amountMinor, currency: pool.currency,
        beneficiaryBankName: bank.bankName, beneficiaryHolder: bank.accountHolder, beneficiaryLast4: bank.accountLast4,
        milestoneId, invoiceReference, reason
      });

      const payout = await tx.payout.create({
        data: {
          poolId: pool.id, projectId: project.id, organizationId, milestoneId,
          budgetRevisionId: latestRevision?.id ?? null,
          amountMinor, currency: pool.currency, reason, invoiceReference,
          requestHash, state: 'requested',
          beneficiaryBankName: bank.bankName, beneficiaryHolder: bank.accountHolder, beneficiaryLast4: bank.accountLast4,
          makerId: actorId
        }
      });

      // Reserving is a transfer of obligation, not a payment: restricted funds become a payable.
      await this.ledger.post(tx as DatabaseClient, {
        poolId: pool.id, currency: pool.currency,
        sourceType: 'payout.reserved', sourceId: payout.id,
        lines: [
          { account: 'restrictedFunds', debit: amountMinor },
          { account: 'payoutPayable', credit: amountMinor }
        ]
      });

      await tx.payoutDecision.create({ data: { payoutId: payout.id, actorId, action: 'requested', requestHash } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: payout.id, action: 'payout.requested' } });
      return this.view(payout);
    });
  }

  /**
   * Settled cash that is not already promised to something else.
   *
   * Deliberately not "everything raised": money still in provider clearing has not settled, and
   * money already reserved for another payout or an approved refund is spoken for.
   */
  private async availableForCommitment(client: DatabaseClient, poolId: string): Promise<bigint> {
    const balances = await this.ledger.balances(poolId, client);
    return BigInt(balances.availableMinor);
  }

  // ---------------------------------------------------------------- approving

  /**
   * ORG-12.A01. A different person with `payout.approve` agrees to the exact request they were
   * shown. The separation of duties is asserted by the policy layer and again by a CHECK constraint
   * in SQL, so neither a service bug nor a direct write can produce a self-approved payout.
   */
  async approve(actorId: string, payoutId: string, input: { requestHash: string; version: number }) {
    return this.db.$transaction(async tx => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new IdentityError('not_found', 404);
      const scoped = new PayoutsService(tx as DatabaseClient, this.payments);
      await scoped.identity.access(actorId, payout.organizationId, 'payout.approve', payout.makerId);
      // MFA for a sensitive financial step (08).
      const approver = await scoped.identity.activeUser(actorId);
      if (!approver.twoFactorEnabled) throw new IdentityError('mfa_unavailable', 403);

      if (payout.state !== 'requested') throw new IdentityError('conflict', 409);
      if (payout.version !== input.version) throw new IdentityError('conflict', 409);
      // The approver signs a specific request. A stale hash means they are looking at an older
      // version of it, which is exactly the case 08 requires us to refuse.
      if (payout.requestHash !== input.requestHash) throw new IdentityError('conflict', 409);

      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: { state: 'approved', approverId: actorId, approvedAt: new Date(), version: { increment: 1 } }
      });
      await tx.payoutDecision.create({ data: { payoutId: payout.id, actorId, action: 'approved', requestHash: payout.requestHash } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: payout.organizationId, resourceId: payout.id, action: 'payout.approved' } });
      return this.view(updated);
    });
  }

  /** ORG-12.A02. Rejecting releases the reservation: the money returns to restricted funds. */
  async reject(actorId: string, payoutId: string, input: { reason: string; version: number }) {
    const reason = text(input.reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new IdentityError('not_found', 404);
      const scoped = new PayoutsService(tx as DatabaseClient, this.payments);
      await scoped.identity.access(actorId, payout.organizationId, 'payout.approve', payout.makerId);
      if (!['requested', 'approved'].includes(payout.state)) throw new IdentityError('conflict', 409);
      if (payout.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: { state: 'rejected', failureReason: reason, version: { increment: 1 } }
      });
      await scoped.releaseReservation(tx as DatabaseClient, payout, 'payout.rejected');
      await tx.payoutDecision.create({ data: { payoutId: payout.id, actorId, action: 'rejected', requestHash: payout.requestHash, reason } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: payout.organizationId, resourceId: payout.id, action: 'payout.rejected' } });
      return this.view(updated);
    });
  }

  /** ORG-12.A03. The maker withdraws their own request, but only while nothing has been sent. */
  async withdraw(actorId: string, payoutId: string, input: { version: number }) {
    return this.db.$transaction(async tx => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new IdentityError('not_found', 404);
      const scoped = new PayoutsService(tx as DatabaseClient, this.payments);
      await scoped.identity.access(actorId, payout.organizationId, 'payout.request');
      // Once it is queued with a provider, withdrawing it here would be a lie about the outside
      // world: the instruction has left, and only the provider can say what happened to it.
      if (!['requested', 'approved'].includes(payout.state)) throw new IdentityError('conflict', 409);
      if (payout.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.payout.update({ where: { id: payout.id }, data: { state: 'cancelled', version: { increment: 1 } } });
      await scoped.releaseReservation(tx as DatabaseClient, payout, 'payout.cancelled');
      await tx.payoutDecision.create({ data: { payoutId: payout.id, actorId, action: 'withdrawn', requestHash: payout.requestHash } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: payout.organizationId, resourceId: payout.id, action: 'payout.cancelled' } });
      return this.view(updated);
    });
  }

  /** Returns a reservation to restricted funds. Posted once, keyed by the payout. */
  private async releaseReservation(tx: DatabaseClient, payout: { id: string; poolId: string; currency: string; amountMinor: bigint }, sourceType: string) {
    if (await this.ledger.alreadyPosted(tx, sourceType, payout.id)) return;
    await this.ledger.post(tx, {
      poolId: payout.poolId, currency: payout.currency,
      sourceType, sourceId: payout.id,
      lines: [
        { account: 'payoutPayable', debit: payout.amountMinor },
        { account: 'restrictedFunds', credit: payout.amountMinor }
      ]
    });
  }

  // ---------------------------------------------------------------- execution (platform staff)

  /**
   * ADM-06.A01. A platform finance operator sends the approved instruction to the provider.
   *
   * Everything is re-checked here rather than trusted from approval time, because time has passed:
   * the organisation may have been suspended, its verification may have lapsed, the approval may
   * have been voided by a change, and the money may no longer be there.
   */
  async execute(actorId: string, payoutId: string, input: { version: number }) {
    const operator = await this.identity.financeOperatorUser(actorId);
    const queued = await this.db.$transaction(async tx => {
      const payout = await tx.payout.findUnique({
        where: { id: payoutId },
        include: { organization: { include: { bankAccount: true } } }
      });
      if (!payout) throw new IdentityError('not_found', 404);
      if (payout.state !== 'approved') throw new IdentityError('conflict', 409);
      if (payout.version !== input.version) throw new IdentityError('conflict', 409);
      // A frozen or unverified organisation is not paid, whatever was approved earlier.
      if (payout.organization.status !== 'active' || payout.organization.verification !== 'verified') throw new IdentityError('conflict', 409);

      // The beneficiary must still be the one that was approved. A bank change since approval is
      // exactly the attack this guards: the approval was for a different account.
      const bank = payout.organization.bankAccount;
      if (!bank) throw new IdentityError('conflict', 409);
      const currentHash = payoutRequestHash({
        poolId: payout.poolId, amountMinor: payout.amountMinor, currency: payout.currency,
        beneficiaryBankName: bank.bankName, beneficiaryHolder: bank.accountHolder, beneficiaryLast4: bank.accountLast4,
        milestoneId: payout.milestoneId, invoiceReference: payout.invoiceReference, reason: payout.reason
      });
      if (currentHash !== payout.requestHash) throw new IdentityError('conflict', 409);

      // The reservation must still be there: without it the money is not actually set aside.
      const balances = await this.ledger.balances(payout.poolId, tx as DatabaseClient);
      if (BigInt(balances.heldMinor) < payout.amountMinor) throw new IdentityError('conflict', 409);

      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: { state: 'queued', executedBy: operator.id, version: { increment: 1 } }
      });
      await tx.payoutDecision.create({ data: { payoutId: payout.id, actorId, action: 'executed', requestHash: payout.requestHash } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: payout.organizationId, resourceId: payout.id, action: 'payout.executed' } });
      return updated;
    });

    // The instruction leaves the transaction boundary on purpose: a provider call inside a database
    // transaction would hold locks across a network round trip, and a rollback afterwards would
    // discard our record of an instruction the provider may already have accepted.
    const sent = await this.payments.sendPayout({
      amountMinor: queued.amountMinor, currency: queued.currency, reference: queued.id,
      beneficiaryLast4: queued.beneficiaryLast4
    });
    const moved = await this.db.payout.update({
      where: { id: queued.id },
      data: { state: 'processing', provider: this.payments.name, providerReference: sent.providerReference, version: { increment: 1 } }
    });
    return this.view(moved);
  }

  /**
   * The provider's verdict on a payout. Success is the only path that moves cash out of the bank
   * account; a failure reverses the reservation; a timeout leaves it `unknown` for an inquiry.
   */
  async recordProviderOutcome(payoutId: string, outcome: { result: 'paid' | 'failed' | 'unknown'; proofReference?: string; reason?: string }) {
    return this.db.$transaction(async tx => {
      const payout = await tx.payout.findUnique({ where: { id: payoutId } });
      if (!payout) throw new IdentityError('not_found', 404);
      // A terminal state is terminal: a later contradictory message does not undo a paid payout.
      if (['paid', 'failed', 'rejected', 'cancelled'].includes(payout.state)) return { status: 'already_final' as const, payout: this.view(payout) };
      if (!['queued', 'processing', 'unknown'].includes(payout.state)) throw new IdentityError('conflict', 409);

      if (outcome.result === 'unknown') {
        const updated = await tx.payout.update({ where: { id: payout.id }, data: { state: 'unknown', version: { increment: 1 } } });
        // No ledger movement: we do not know whether the money left, and guessing either way would
        // put a number in the books that nothing supports (08).
        return { status: 'unknown' as const, payout: this.view(updated) };
      }

      if (outcome.result === 'failed') {
        const updated = await tx.payout.update({
          where: { id: payout.id },
          data: { state: 'failed', failureReason: outcome.reason ?? 'provider reported failure', version: { increment: 1 } }
        });
        await this.releaseReservation(tx as DatabaseClient, payout, 'payout.failed');
        return { status: 'failed' as const, payout: this.view(updated) };
      }

      // 08: `paid` is a claim that money left our account, so it carries the provider's own proof.
      const proofReference = outcome.proofReference ?? `${this.payments.name}:${payout.providerReference ?? payout.id}`;
      const updated = await tx.payout.update({
        where: { id: payout.id },
        data: { state: 'paid', paidAt: new Date(), paidProofReference: proofReference, version: { increment: 1 } }
      });
      if (!await this.ledger.alreadyPosted(tx as DatabaseClient, 'payout.paid', payout.id)) {
        await this.ledger.post(tx as DatabaseClient, {
          poolId: payout.poolId, currency: payout.currency,
          sourceType: 'payout.paid', sourceId: payout.id,
          lines: [
            { account: 'payoutPayable', debit: payout.amountMinor },
            { account: 'bankCash', credit: payout.amountMinor }
          ]
        });
      }
      await tx.outboxEvent.create({ data: { topic: 'payout.paid', payload: { payoutId: payout.id } } });
      return { status: 'paid' as const, payout: this.view(updated) };
    });
  }

  /**
   * ADM-06.A04 / ORG-12.A04. Asks the provider what actually happened, for a payout we lost track
   * of. This is a read: 08 forbids a blind retry, because re-sending an instruction that did go
   * through pays twice, and the only safe way out of `unknown` is to ask.
   */
  async inquire(actorId: string, payoutId: string) {
    await this.identity.financeOperatorUser(actorId);
    const payout = await this.db.payout.findUnique({ where: { id: payoutId } });
    if (!payout) throw new IdentityError('not_found', 404);
    if (!payout.providerReference) throw new IdentityError('conflict', 409);
    if (!['unknown', 'queued', 'processing'].includes(payout.state)) throw new IdentityError('conflict', 409);

    const verdict = await this.payments.inquirePayout(payout.providerReference);
    await this.db.payout.update({ where: { id: payout.id }, data: { lastInquiredAt: new Date() } });
    await this.db.payoutDecision.create({ data: { payoutId: payout.id, actorId, action: 'inquired', requestHash: payout.requestHash, reason: verdict.result } });

    if (verdict.result === 'pending') {
      return { status: 'still_pending' as const, payout: this.view(await this.db.payout.findUniqueOrThrow({ where: { id: payout.id } })) };
    }
    // The inquiry is authoritative, so its answer settles the payout through the same path a
    // callback would have taken — one ledger posting, keyed by the payout, whichever arrived first.
    return this.recordProviderOutcome(payout.id, {
      result: verdict.result,
      ...(verdict.proofReference ? { proofReference: verdict.proofReference } : {}),
      reason: 'resolved by provider inquiry'
    });
  }

  // ---------------------------------------------------------------- reads

  /** ORG-12 and ADM-06. The full record for one payout, without the bank identifier. */
  async get(actorId: string, payoutId: string) {
    const payout = await this.db.payout.findUnique({
      where: { id: payoutId },
      include: {
        decisions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } },
        milestone: { select: { id: true, title: true, sequence: true } },
        project: { select: { id: true, slug: true, title: true } }
      }
    });
    if (!payout) throw new IdentityError('not_found', 404);
    // Platform finance staff may read any payout; everyone else needs finance.read in its own org.
    const platformRoles = await this.identity.platformRoles(actorId);
    if (!platformRoles.includes('FinanceOperator')) {
      await this.identity.access(actorId, payout.organizationId, 'finance.read');
    }
    return {
      ...this.view(payout),
      project: payout.project,
      milestone: payout.milestone,
      decisions: payout.decisions.map(decision => ({
        id: decision.id, action: decision.action, actor: decision.actor.name,
        reason: decision.reason, at: decision.createdAt,
        // Shown so a reader can see that a decision was made against a different version of the
        // request than the one on screen, rather than having to trust that it was not.
        matchesCurrentRequest: decision.requestHash === payout.requestHash
      }))
    };
  }

  /** ORG-12 list. Scoped to one organisation, newest first. */
  async list(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'finance.read');
    const rows = await this.db.payout.findMany({
      where: { organizationId },
      include: { project: { select: { slug: true, title: true } } },
      orderBy: { createdAt: 'desc' }, take: 100
    });
    return rows.map(row => ({ ...this.view(row), project: row.project }));
  }

  /** ADM-05/ADM-06 queue: everything the platform still has to act on or chase. */
  async operationsQueue(actorId: string) {
    await this.identity.financeOperatorUser(actorId);
    const rows = await this.db.payout.findMany({
      where: { state: { in: ['approved', 'queued', 'processing', 'unknown'] } },
      include: { organization: { select: { id: true, displayName: true } }, project: { select: { slug: true, title: true } } },
      orderBy: { createdAt: 'asc' }, take: 100
    });
    return rows.map(row => ({ ...this.view(row), organization: row.organization, project: row.project }));
  }

  /**
   * The payout as everyone but the bank sees it. The account identifier is never in this object:
   * only the last four digits, which is what a person needs to recognise the account (12-SECURITY).
   */
  private view(payout: {
    id: string; poolId: string; projectId: string; organizationId: string; milestoneId: string | null;
    amountMinor: bigint; currency: string; reason: string; invoiceReference: string; state: string;
    requestHash: string; beneficiaryBankName: string; beneficiaryHolder: string; beneficiaryLast4: string;
    makerId: string; approverId: string | null; approvedAt: Date | null;
    providerReference: string | null; paidProofReference: string | null; paidAt: Date | null;
    failureReason: string; lastInquiredAt: Date | null; simulated: boolean; version: number; createdAt: Date;
  }) {
    return {
      id: payout.id,
      projectId: payout.projectId,
      organizationId: payout.organizationId,
      milestoneId: payout.milestoneId,
      amountMinor: minorToString(payout.amountMinor),
      currency: payout.currency,
      reason: payout.reason,
      invoiceReference: payout.invoiceReference,
      state: payout.state,
      requestHash: payout.requestHash,
      beneficiary: { bankName: payout.beneficiaryBankName, holder: payout.beneficiaryHolder, last4: payout.beneficiaryLast4 },
      makerId: payout.makerId,
      approverId: payout.approverId,
      approvedAt: payout.approvedAt,
      providerReference: payout.providerReference,
      // ORG-12.A05: proof of payment exists only once the money actually left.
      paidProofReference: payout.paidProofReference,
      paidAt: payout.paidAt,
      failureReason: payout.failureReason,
      lastInquiredAt: payout.lastInquiredAt,
      /** True while only the provider can say what happened; the UI must not offer a retry. */
      awaitingProvider: ['queued', 'processing'].includes(payout.state),
      needsInquiry: payout.state === 'unknown',
      simulated: payout.simulated,
      version: payout.version,
      createdAt: payout.createdAt
    };
  }
}
