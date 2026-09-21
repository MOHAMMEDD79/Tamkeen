import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseMinor } from '../projects/money.js';
import { LedgerService } from './ledger.service.js';
import type { PaymentPort } from './payment-port.js';

/**
 * Refunds and disputes (08-FINANCIAL-SYSTEM, PER-03.A03, ORG-09.A04, ADM-06.A02/A03).
 *
 * The rules that matter here:
 *
 *  - **Remaining refundable = received − confirmed refunded − reserved for pending refunds.** A
 *    refund that has only been requested still holds the money, so two concurrent requests cannot
 *    both be told the same amount is available (FIN-05).
 *  - **A lock on the source.** The contribution row is locked before the remaining amount is read,
 *    so the check and the write are one decision, not two.
 *  - **A full refund cannot come out of the net alone.** 100.00 arrived, 3.00 went to the
 *    processor, 97.00 is in the bank. Returning 100.00 needs someone to fund the 3.00 difference,
 *    and 08 requires that to be decided before execution rather than discovered during it.
 *  - **A chargeback does not rewrite history.** The original payment happened. A dispute is its
 *    own record, and where the money is already spent the shortfall is carried openly.
 */

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

/** States in which a refund still holds money that therefore cannot be refunded again. */
const PENDING_REFUND_STATES = ['requested', 'approved', 'processing', 'unknown'] as const;

export class RefundsService {
  private readonly identity: IdentityService;
  private readonly ledger: LedgerService;
  constructor(private readonly db: DatabaseClient, private readonly payments: PaymentPort) {
    this.identity = new IdentityService(db);
    this.ledger = new LedgerService(db);
  }

  /**
   * What is still refundable on one contribution, and what refunding it in full would cost.
   *
   * Exposed as a read so a screen can state the fee question before anyone commits to it, rather
   * than presenting a refund button that fails at execution.
   */
  async quote(client: DatabaseClient, contributionId: string) {
    const contribution = await client.contribution.findUnique({
      where: { id: contributionId },
      include: { intent: { include: { settlement: true } } }
    });
    if (!contribution) throw new IdentityError('not_found', 404);
    const pending = await client.refund.findMany({
      where: { contributionId, state: { in: [...PENDING_REFUND_STATES] } },
      select: { amountMinor: true }
    });
    const reserved = pending.reduce((total, row) => total + row.amountMinor, 0n);
    const remaining = contribution.amountMinor - contribution.refundedMinor - reserved;
    const settledFee = contribution.intent?.settlement?.feeMinor ?? 0n;
    return {
      contribution,
      receivedMinor: contribution.amountMinor,
      confirmedRefundedMinor: contribution.refundedMinor,
      reservedMinor: reserved,
      remainingRefundableMinor: remaining > 0n ? remaining : 0n,
      /** The processor keeps its fee on a refund, so a full return costs this much more than the net. */
      nonRefundableFeeMinor: settledFee,
      settled: Boolean(contribution.intent?.settlement)
    };
  }

  /** PER-03.A03 / ORG-09.A04. Requests a refund and reserves the amount against the contribution. */
  async request(actorId: string, contributionId: string, input: { amountMinor: string; reason: string; feeCoveredByPool?: boolean | undefined }) {
    const amountMinor = parseMinor(input.amountMinor);
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const scoped = new RefundsService(tx as DatabaseClient, this.payments);
      const contribution = await tx.contribution.findUnique({
        where: { id: contributionId },
        include: { payer: true, project: { select: { organizationId: true } } }
      });
      if (!contribution) throw new IdentityError('not_found', 404);

      // The contributor may ask for their own money back; anyone else needs refund.request in the
      // organisation that received it. A third party can do neither.
      const user = await scoped.identity.activeUser(actorId);
      const isContributor = contribution.payer.userId === user.id;
      if (!isContributor) await scoped.identity.access(actorId, contribution.project.organizationId, 'refund.request');

      if (!['succeeded', 'partially_refunded'].includes(contribution.state)) throw new IdentityError('conflict', 409);

      // Lock the source before reading what is left, so two concurrent requests cannot both be
      // told the same money is available (FIN-05).
      await tx.$queryRaw`SELECT id FROM contributions WHERE id = ${contributionId}::uuid FOR UPDATE`;
      const quote = await scoped.quote(tx as DatabaseClient, contributionId);
      if (amountMinor > quote.remainingRefundableMinor) throw new IdentityError('conflict', 409);

      // 08: the fee is not returned by the processor, so covering it is a decision taken now.
      const feeCoveredByPool = input.feeCoveredByPool ?? true;
      const feeMinor = amountMinor === quote.receivedMinor && quote.settled ? quote.nonRefundableFeeMinor : 0n;

      const refund = await tx.refund.create({
        data: {
          contributionId, poolId: contribution.poolId, amountMinor, currency: contribution.currency,
          reason, requestedBy: actorId, feeCoveredByPool, feeMinor, state: 'requested'
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: refund.id, action: 'refund.requested' } });
      return this.view(refund, quote.remainingRefundableMinor - amountMinor);
    });
  }

  /**
   * ADM-06.A02. An independent approver agrees. Approving reserves the cash in the ledger, because
   * from this point the money is promised to the contributor and is not available to spend.
   */
  async approve(actorId: string, refundId: string, input: { version: number }) {
    return this.db.$transaction(async tx => {
      const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { contribution: { include: { project: { select: { organizationId: true } } } } } });
      if (!refund) throw new IdentityError('not_found', 404);
      const scoped = new RefundsService(tx as DatabaseClient, this.payments);
      // Either an organisation approver who did not request it, or platform finance staff.
      const platformRoles = await scoped.identity.platformRoles(actorId);
      if (!platformRoles.includes('FinanceOperator')) {
        await scoped.identity.access(actorId, refund.contribution.project.organizationId, 'refund.approve', refund.requestedBy);
      } else if (actorId === refund.requestedBy) {
        // The separation of duties does not evaporate because the approver is platform staff.
        throw new IdentityError('forbidden', 403);
      }

      if (refund.state !== 'requested') throw new IdentityError('conflict', 409);
      if (refund.version !== input.version) throw new IdentityError('conflict', 409);

      // 08: the money must actually be there. A refund promised out of money that was already
      // disbursed is a shortfall, and it has to be recognised as one rather than approved blindly.
      const balances = await this.ledger.balances(refund.poolId, tx as DatabaseClient);
      const cost = refund.amountMinor + (refund.feeCoveredByPool ? refund.feeMinor : 0n);
      if (BigInt(balances.availableMinor) < cost) throw new IdentityError('conflict', 409);

      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: { state: 'approved', approverId: actorId, approvedAt: new Date(), version: { increment: 1 } }
      });
      await this.ledger.post(tx as DatabaseClient, {
        poolId: refund.poolId, currency: refund.currency,
        sourceType: 'refund.reserved', sourceId: refund.id,
        lines: [
          { account: 'restrictedFunds', debit: cost },
          { account: 'refundPayable', credit: cost }
        ]
      });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: refund.id, action: 'refund.approved' } });
      return this.view(updated, null);
    });
  }

  /** Rejecting releases nothing, because nothing was reserved in the ledger until approval. */
  async reject(actorId: string, refundId: string, input: { reason: string; version: number }) {
    const reason = text(input.reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { contribution: { include: { project: { select: { organizationId: true } } } } } });
      if (!refund) throw new IdentityError('not_found', 404);
      const scoped = new RefundsService(tx as DatabaseClient, this.payments);
      const platformRoles = await scoped.identity.platformRoles(actorId);
      if (!platformRoles.includes('FinanceOperator')) {
        await scoped.identity.access(actorId, refund.contribution.project.organizationId, 'refund.approve', refund.requestedBy);
      }
      if (refund.state !== 'requested') throw new IdentityError('conflict', 409);
      if (refund.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: { state: 'rejected', failureReason: reason, version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: refund.id, action: 'refund.rejected' } });
      return this.view(updated, null);
    });
  }

  /** ADM-06.A03. Platform finance staff send the instruction to the provider. */
  async execute(actorId: string, refundId: string, input: { version: number }) {
    await this.identity.financeOperatorUser(actorId);
    const sent = await this.db.$transaction(async tx => {
      const refund = await tx.refund.findUnique({ where: { id: refundId }, include: { contribution: { include: { intent: true } } } });
      if (!refund) throw new IdentityError('not_found', 404);
      if (refund.state !== 'approved') throw new IdentityError('conflict', 409);
      if (refund.version !== input.version) throw new IdentityError('conflict', 409);
      // 08: money goes back to where it came from, so the original payment must be identifiable.
      if (!refund.contribution.intent?.providerReference) throw new IdentityError('conflict', 409);
      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: { state: 'processing', executedBy: actorId, version: { increment: 1 } }
      });
      return { refund: updated, originalProviderReference: refund.contribution.intent.providerReference };
    });

    // Outside the transaction: a provider call must not hold database locks, and a rollback after
    // it would lose our record of an instruction the provider may already have accepted.
    const acknowledgement = await this.payments.sendRefund({
      amountMinor: sent.refund.amountMinor, currency: sent.refund.currency,
      reference: sent.refund.id, originalProviderReference: sent.originalProviderReference
    });
    const moved = await this.db.refund.update({
      where: { id: sent.refund.id },
      data: { provider: this.payments.name, providerReference: acknowledgement.providerReference, version: { increment: 1 } }
    });
    return this.view(moved, null);
  }

  /**
   * The provider's verdict. Success moves the cash and reduces what the contribution counts as
   * having raised; failure releases the reservation; a timeout waits for an inquiry.
   */
  async recordProviderOutcome(refundId: string, outcome: { result: 'succeeded' | 'failed' | 'unknown'; reason?: string }) {
    return this.db.$transaction(async tx => {
      const refund = await tx.refund.findUnique({ where: { id: refundId } });
      if (!refund) throw new IdentityError('not_found', 404);
      if (['succeeded', 'failed', 'rejected'].includes(refund.state)) return { status: 'already_final' as const, refund: this.view(refund, null) };
      if (!['processing', 'unknown', 'approved'].includes(refund.state)) throw new IdentityError('conflict', 409);

      const cost = refund.amountMinor + (refund.feeCoveredByPool ? refund.feeMinor : 0n);

      if (outcome.result === 'unknown') {
        const updated = await tx.refund.update({ where: { id: refund.id }, data: { state: 'unknown', version: { increment: 1 } } });
        // The reservation stays: the money may well have left, and releasing it would let the same
        // money be spent twice if it had.
        return { status: 'unknown' as const, refund: this.view(updated, null) };
      }

      if (outcome.result === 'failed') {
        const updated = await tx.refund.update({
          where: { id: refund.id },
          data: { state: 'failed', failureReason: outcome.reason ?? 'provider reported failure', version: { increment: 1 } }
        });
        if (!await this.ledger.alreadyPosted(tx as DatabaseClient, 'refund.failed', refund.id)) {
          await this.ledger.post(tx as DatabaseClient, {
            poolId: refund.poolId, currency: refund.currency,
            sourceType: 'refund.failed', sourceId: refund.id,
            lines: [
              { account: 'refundPayable', debit: cost },
              { account: 'restrictedFunds', credit: cost }
            ]
          });
        }
        return { status: 'failed' as const, refund: this.view(updated, null) };
      }

      const updated = await tx.refund.update({
        where: { id: refund.id },
        data: { state: 'succeeded', succeededAt: new Date(), version: { increment: 1 } }
      });
      if (!await this.ledger.alreadyPosted(tx as DatabaseClient, 'refund.succeeded', refund.id)) {
        await this.ledger.post(tx as DatabaseClient, {
          poolId: refund.poolId, currency: refund.currency,
          sourceType: 'refund.succeeded', sourceId: refund.id,
          lines: [
            { account: 'refundPayable', debit: cost },
            { account: 'bankCash', credit: cost }
          ]
        });
      }

      // The contribution now counts for less. `refunded` and `partially_refunded` are different
      // public facts, so the state follows the amount rather than being flattened to one value.
      const contribution = await tx.contribution.findUniqueOrThrow({ where: { id: refund.contributionId } });
      const refundedTotal = contribution.refundedMinor + refund.amountMinor;
      await tx.contribution.update({
        where: { id: contribution.id },
        data: {
          refundedMinor: refundedTotal,
          state: refundedTotal >= contribution.amountMinor ? 'refunded' : 'partially_refunded',
          version: { increment: 1 }
        }
      });
      await tx.outboxEvent.create({ data: { topic: 'refund.succeeded', payload: { refundId: refund.id } } });
      return { status: 'succeeded' as const, refund: this.view(updated, null) };
    });
  }

  /** ADM-05.A04 for refunds: ask the provider rather than re-sending (08). */
  async inquire(actorId: string, refundId: string) {
    await this.identity.financeOperatorUser(actorId);
    const refund = await this.db.refund.findUnique({ where: { id: refundId } });
    if (!refund) throw new IdentityError('not_found', 404);
    if (!refund.providerReference) throw new IdentityError('conflict', 409);
    if (!['unknown', 'processing'].includes(refund.state)) throw new IdentityError('conflict', 409);

    const verdict = await this.payments.inquireRefund(refund.providerReference);
    await this.db.refund.update({ where: { id: refund.id }, data: { lastInquiredAt: new Date() } });
    if (verdict.result === 'pending') {
      return { status: 'still_pending' as const, refund: this.view(await this.db.refund.findUniqueOrThrow({ where: { id: refund.id } }), null) };
    }
    return this.recordProviderOutcome(refund.id, { result: verdict.result, reason: 'resolved by provider inquiry' });
  }

  // ---------------------------------------------------------------- disputes

  /**
   * A chargeback after a successful payment. 08: the original payment is not rewritten, and where
   * the money has already gone out the shortfall is carried as an explicit obligation with a
   * coverage plan, never hidden by clamping a balance to zero.
   */
  async openDispute(actorId: string, contributionId: string, input: { amountMinor: string; reason: string; coveragePlan?: string | undefined }) {
    await this.identity.financeOperatorUser(actorId);
    const amountMinor = parseMinor(input.amountMinor);
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const contribution = await tx.contribution.findUnique({ where: { id: contributionId } });
      if (!contribution) throw new IdentityError('not_found', 404);
      if (!['succeeded', 'partially_refunded'].includes(contribution.state)) throw new IdentityError('conflict', 409);
      if (amountMinor > contribution.amountMinor) throw new IdentityError('conflict', 409);

      const dispute = await tx.dispute.create({
        data: {
          contributionId, poolId: contribution.poolId, amountMinor, currency: contribution.currency,
          reason, coveragePlan: input.coveragePlan ? text(input.coveragePlan, 10, 2000) : '',
          openedBy: actorId, state: 'opened'
        }
      });
      // The obligation is recognised immediately, against restricted funds. If that drives the pool
      // below what it holds, `shortfallMinor` reports the gap rather than the balance being clamped.
      await this.ledger.post(tx as DatabaseClient, {
        poolId: contribution.poolId, currency: contribution.currency,
        sourceType: 'dispute.opened', sourceId: dispute.id,
        lines: [
          { account: 'restrictedFunds', debit: amountMinor },
          { account: 'disputeReserve', credit: amountMinor }
        ]
      });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: dispute.id, action: 'dispute.opened' } });
      return this.disputeView(dispute);
    });
  }

  /** Resolving a dispute either takes the money (lost) or releases the reserve (won/withdrawn). */
  async resolveDispute(actorId: string, disputeId: string, input: { outcome: 'lost' | 'won' | 'withdrawn'; reason: string; version: number }) {
    await this.identity.financeOperatorUser(actorId);
    const reason = text(input.reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const dispute = await tx.dispute.findUnique({ where: { id: disputeId } });
      if (!dispute) throw new IdentityError('not_found', 404);
      if (!['opened', 'under_review'].includes(dispute.state)) throw new IdentityError('conflict', 409);
      if (dispute.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.dispute.update({
        where: { id: dispute.id },
        data: { state: input.outcome, resolvedBy: actorId, resolvedAt: new Date(), coveragePlan: reason, version: { increment: 1 } }
      });

      await this.ledger.post(tx as DatabaseClient, {
        poolId: dispute.poolId, currency: dispute.currency,
        sourceType: `dispute.${input.outcome}`, sourceId: dispute.id,
        lines: input.outcome === 'lost'
          // The money goes back to the card network: the reserve is cleared against cash, which is
          // where a pool that has already disbursed will show a negative balance and a shortfall.
          ? [{ account: 'disputeReserve', debit: dispute.amountMinor }, { account: 'bankCash', credit: dispute.amountMinor }]
          // We keep the money: the obligation was not real, so it returns to restricted funds.
          : [{ account: 'disputeReserve', debit: dispute.amountMinor }, { account: 'restrictedFunds', credit: dispute.amountMinor }]
      });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: dispute.id, action: `dispute.${input.outcome}` } });
      return this.disputeView(updated);
    });
  }

  // ---------------------------------------------------------------- reads

  /** The refunds on one contribution, for the contributor's own record and for finance staff. */
  async listForContribution(actorId: string, contributionId: string) {
    const contribution = await this.db.contribution.findUnique({
      where: { id: contributionId },
      include: { payer: true, project: { select: { organizationId: true } } }
    });
    if (!contribution) throw new IdentityError('not_found', 404);
    const user = await this.identity.activeUser(actorId);
    if (contribution.payer.userId !== user.id) {
      await this.identity.access(actorId, contribution.project.organizationId, 'finance.read');
    }
    const [refunds, quote] = await Promise.all([
      this.db.refund.findMany({ where: { contributionId }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.quote(this.db, contributionId)
    ]);
    return {
      remainingRefundableMinor: minorToString(quote.remainingRefundableMinor),
      nonRefundableFeeMinor: minorToString(quote.nonRefundableFeeMinor),
      refunds: refunds.map(refund => this.view(refund, null))
    };
  }

  /** ADM-06 queue: refunds and disputes the platform still has to act on. */
  async operationsQueue(actorId: string) {
    await this.identity.financeOperatorUser(actorId);
    const [refunds, disputes] = await Promise.all([
      this.db.refund.findMany({
        where: { state: { in: ['requested', 'approved', 'processing', 'unknown'] } },
        include: { contribution: { select: { id: true, projectId: true } } },
        orderBy: { createdAt: 'asc' }, take: 100
      }),
      this.db.dispute.findMany({ where: { state: { in: ['opened', 'under_review'] } }, orderBy: { createdAt: 'asc' }, take: 100 })
    ]);
    return {
      refunds: refunds.map(refund => ({ ...this.view(refund, null), projectId: refund.contribution.projectId })),
      disputes: disputes.map(dispute => this.disputeView(dispute))
    };
  }

  private view(refund: {
    id: string; contributionId: string; poolId: string; amountMinor: bigint; currency: string;
    reason: string; state: string; feeCoveredByPool: boolean; feeMinor: bigint;
    requestedBy: string; approverId: string | null; approvedAt: Date | null;
    providerReference: string | null; succeededAt: Date | null; failureReason: string;
    lastInquiredAt: Date | null; simulated: boolean; version: number; createdAt: Date;
  }, remainingAfter: bigint | null) {
    return {
      id: refund.id,
      contributionId: refund.contributionId,
      amountMinor: minorToString(refund.amountMinor),
      currency: refund.currency,
      reason: refund.reason,
      state: refund.state,
      feeCoveredByPool: refund.feeCoveredByPool,
      /** The processor's fee is not returned, so a full refund costs the pool this much extra. */
      feeMinor: minorToString(refund.feeMinor),
      requestedBy: refund.requestedBy,
      approverId: refund.approverId,
      approvedAt: refund.approvedAt,
      providerReference: refund.providerReference,
      succeededAt: refund.succeededAt,
      failureReason: refund.failureReason,
      lastInquiredAt: refund.lastInquiredAt,
      awaitingProvider: refund.state === 'processing',
      needsInquiry: refund.state === 'unknown',
      simulated: refund.simulated,
      version: refund.version,
      createdAt: refund.createdAt,
      ...(remainingAfter === null ? {} : { remainingRefundableMinor: minorToString(remainingAfter) })
    };
  }

  private disputeView(dispute: {
    id: string; contributionId: string; poolId: string; amountMinor: bigint; currency: string;
    state: string; reason: string; coveragePlan: string; resolvedAt: Date | null; version: number; createdAt: Date;
  }) {
    return {
      id: dispute.id,
      contributionId: dispute.contributionId,
      amountMinor: minorToString(dispute.amountMinor),
      currency: dispute.currency,
      state: dispute.state,
      reason: dispute.reason,
      coveragePlan: dispute.coveragePlan,
      resolvedAt: dispute.resolvedAt,
      version: dispute.version,
      createdAt: dispute.createdAt
    };
  }
}
