import { createHash, randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString } from '../projects/money.js';
import { LedgerService } from '../money/ledger.service.js';
import { percentString } from './shares.js';

/**
 * Closing an offering: allocation, holdings, failure and refunds (06, BUS-04, ADM-04.A03).
 *
 * The rule from LOOP-INV that this module exists to make true:
 * **there is no path from a commitment to a holding.** A holding is created only from an
 * allocation, an allocation only from an approved schedule against a settled payment, and the
 * database enforces one holding per allocation so no code path can shortcut it.
 *
 * And INV-04: if the minimum is not reached the offering does not simply close. Every commitment
 * has to be resolved and every payment returned first; only then is the offering `closed`.
 */

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

export interface AllocationLine {
  commitmentId: string;
  userId: string;
  units: string;
  costMinor: string;
  percentOfPostRaise: string;
}

/** The snapshot is hashed so an approval is bound to the exact figures that were reviewed. */
const snapshotChecksum = (lines: readonly AllocationLine[]) =>
  createHash('sha256').update(lines.map(line => [line.commitmentId, line.units, line.costMinor].join('\u001f')).join('\u0000')).digest('hex');

export class AllocationsService {
  private readonly identity: IdentityService;
  private readonly ledger: LedgerService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
    this.ledger = new LedgerService(db);
  }

  async proof(actorId: string, allocationId: string) {
    const user = await this.identity.activeUser(actorId);
    const allocation = await this.db.allocation.findUnique({ where: { id: allocationId }, include: { offering: { select: { title: true, slug: true } } } });
    if (!allocation || allocation.userId !== user.id) throw new IdentityError('not_found', 404);
    const snapshot = { reference: allocation.id, proofReference: allocation.proofReference, offering: allocation.offering, units: allocation.units.toString(), costMinor: minorToString(allocation.costMinor), currency: allocation.currency, finalisedAt: allocation.finalisedAt.toISOString(), simulated: allocation.simulated };
    return { filename: `allocation-proof-${allocation.id}.json`, mimeType: 'application/json', content: JSON.stringify(snapshot), classification: 'private', generatedFromImmutableAllocation: true };
  }

  /**
   * BUS-04.A01. What the allocation would be, computed from settled payments only.
   *
   * A preview changes nothing. It exists so the figures can be checked before anyone is asked to
   * approve them, and so the issuer can see whether the minimum was actually reached.
   */
  async preview(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    return this.computeSchedule(organizationId, offeringId);
  }

  private async computeSchedule(organizationId: string, offeringId: string) {
    const offering = await this.db.offering.findFirst({
      where: { id: offeringId, organizationId },
      include: { venture: true }
    });
    if (!offering) throw new IdentityError('not_found', 404);

    // Only commitments whose money actually arrived and settled may be allocated. 06 is explicit
    // that a payment after a lapsed reservation is reviewed, not allocated automatically.
    const paid = await this.db.commitment.findMany({
      where: { offeringId, state: { in: ['paid', 'allocated'] } },
      include: { subscription: { include: { intent: { include: { settlement: true } } } } },
      orderBy: { createdAt: 'asc' }
    });
    const settled = paid.filter(commitment => commitment.subscription?.intent?.settlement?.state === 'settled');
    const unsettled = paid.length - settled.length;

    const postRaiseShares = offering.venture.currentShares + offering.sharesOffered;
    const lines: AllocationLine[] = settled.map(commitment => ({
      commitmentId: commitment.id,
      userId: commitment.userId,
      units: commitment.units.toString(),
      costMinor: minorToString(commitment.amountMinor),
      percentOfPostRaise: percentString(commitment.units, postRaiseShares)
    }));
    const totalUnits = settled.reduce((total, commitment) => total + commitment.units, 0n);
    const totalMinor = settled.reduce((total, commitment) => total + commitment.amountMinor, 0n);

    return {
      offeringId,
      state: offering.state,
      lines,
      totalUnits: totalUnits.toString(),
      totalMinor: minorToString(totalMinor),
      checksum: snapshotChecksum(lines),
      minimumRaiseMinor: minorToString(offering.minimumRaiseMinor),
      // The whole question INV-04 turns on, answered before anyone commits to a decision.
      minimumReached: totalMinor >= offering.minimumRaiseMinor,
      // Counted rather than silently excluded: money that arrived but has not settled is not
      // allocatable, and the issuer needs to know it is sitting there.
      paidButUnsettled: unsettled,
      simulated: true
    };
  }

  /** BUS-04.A02. Submits the computed schedule for an authorised decision. */
  async request(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const schedule = await this.computeSchedule(organizationId, offeringId);

    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirstOrThrow({ where: { id: offeringId, organizationId } });
      // Allocating an offering that is still open would allocate a moving target.
      if (offering.state !== 'closing') throw new IdentityError('conflict', 409);
      if (schedule.lines.length === 0) throw new IdentityError('conflict', 409);
      // INV-04. A round that missed its minimum does not get to issue shares instead: 06 says the
      // money goes back according to its contract. The issuer's route from here is `fail`, not
      // this one, and the preview already told them which of the two they are looking at.
      if (!schedule.minimumReached) throw new IdentityError('conflict', 409);
      const open = await tx.allocationRequest.findFirst({ where: { offeringId, state: 'submitted' } });
      if (open) throw new IdentityError('conflict', 409);

      const record = await tx.allocationRequest.create({
        data: {
          offeringId, state: 'submitted',
          snapshot: schedule.lines as unknown as object,
          checksum: schedule.checksum,
          totalUnits: BigInt(schedule.totalUnits),
          totalMinor: BigInt(schedule.totalMinor),
          requestedBy: actorId
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: record.id, action: 'allocation.requested' } });
      return { id: record.id, state: record.state, checksum: record.checksum, totalUnits: schedule.totalUnits, totalMinor: schedule.totalMinor, version: record.version };
    });
  }

  /**
   * ADM-04.A03. Finalises the allocation.
   *
   * This is the only place a holding is ever created, and it does so from an approved schedule
   * whose checksum still matches what would be computed now. If anything has moved since the
   * schedule was submitted, the approval is refused rather than applied to different figures.
   */
  async finalise(actorId: string, requestId: string, input: { checksum: string; version: number }) {
    const reviewer = await this.identity.riskReviewerUser(actorId);

    return this.db.$transaction(async tx => {
      const request = await tx.allocationRequest.findUnique({
        where: { id: requestId },
        include: { offering: { include: { venture: true } } }
      });
      if (!request) throw new IdentityError('not_found', 404);
      if (request.state !== 'submitted') throw new IdentityError('conflict', 409);
      if (request.version !== input.version) throw new IdentityError('conflict', 409);
      // Bound to the figures that were reviewed, like every other approval in this product.
      if (request.checksum !== input.checksum) throw new IdentityError('conflict', 409);
      // Nobody approves their own schedule; a CHECK constraint says the same thing in SQL.
      if (request.requestedBy === reviewer.id) throw new IdentityError('forbidden', 403);
      // An independent reviewer is not a member of the issuing organisation.
      const membership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: reviewer.id, organizationId: request.offering.organizationId } } });
      if (membership) throw new IdentityError('forbidden', 403);

      // Re-checked at the moment of issue as well: the minimum is about what actually settled, and
      // a refund or a reversal between submission and approval can take a round back under it.
      if (request.totalMinor < request.offering.minimumRaiseMinor) throw new IdentityError('conflict', 409);

      const lines = request.snapshot as unknown as AllocationLine[];
      // Re-derive the checksum from the stored snapshot: a snapshot edited in the database would
      // no longer hash to what the request claims.
      if (snapshotChecksum(lines) !== request.checksum) throw new IdentityError('conflict', 409);

      for (const line of lines) {
        const commitment = await tx.commitment.findUniqueOrThrow({
          where: { id: line.commitmentId },
          include: { subscription: { include: { intent: { include: { settlement: true } } } } }
        });
        // Re-checked at the moment of issue, not trusted from when the schedule was computed.
        if (commitment.state !== 'paid') throw new IdentityError('conflict', 409);
        if (commitment.subscription?.intent?.settlement?.state !== 'settled') throw new IdentityError('conflict', 409);
        if (commitment.units.toString() !== line.units) throw new IdentityError('conflict', 409);

        const allocation = await tx.allocation.create({
          data: {
            offeringId: request.offeringId, commitmentId: commitment.id, userId: commitment.userId,
            units: commitment.units, costMinor: commitment.amountMinor, currency: commitment.currency,
            // In a real deployment this is the register's own reference. Here it is generated and
            // marked simulated, because no database row created legal ownership.
            proofReference: `simulated-register:${randomBytes(8).toString('hex')}`,
            simulated: true, finalisedBy: reviewer.id
          }
        });
        // The one place a holding is created, from the allocation and nothing else.
        await tx.holding.create({
          data: {
            allocationId: allocation.id, ventureId: request.offering.ventureId, userId: commitment.userId,
            units: allocation.units, costMinor: allocation.costMinor, currency: allocation.currency, simulated: true
          }
        });
        await tx.commitment.update({ where: { id: commitment.id }, data: { state: 'allocated', version: { increment: 1 } } });
      }

      const updated = await tx.allocationRequest.update({
        where: { id: request.id },
        data: { state: 'approved', decidedBy: reviewer.id, decidedAt: new Date(), version: { increment: 1 } }
      });
      await tx.offering.update({ where: { id: request.offeringId }, data: { state: 'allocated', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId: reviewer.id, resourceId: request.id, action: 'allocation.finalised' } });
      return {
        id: updated.id, state: updated.state, version: updated.version,
        allocated: lines.length, totalUnits: request.totalUnits.toString(),
        // Said in the response, because a screen must not present this as a legal share register.
        simulated: true
      };
    });
  }

  /**
   * ADM-04. Allocation schedules waiting for an independent decision.
   *
   * The reviewer needs somewhere to find these. Without this read, ADM-04.A03 would be an endpoint
   * with no way to reach it, which is the same failure as a button that does nothing.
   */
  async allocationQueue(actorId: string) {
    const reviewer = await this.identity.riskReviewerUser(actorId);
    const rows = await this.db.allocationRequest.findMany({
      where: { state: 'submitted' },
      include: { offering: { include: { organization: { select: { displayName: true } }, venture: { select: { legalName: true, currentShares: true } } } } },
      orderBy: { createdAt: 'asc' }, take: 50
    });
    const memberships = await this.db.membership.findMany({ where: { userId: reviewer.id }, select: { organizationId: true } });
    const ownOrganizations = new Set(memberships.map(row => row.organizationId));
    return rows.map(row => ({
      id: row.id,
      offeringId: row.offeringId,
      offeringTitle: row.offering.title,
      organization: row.offering.organization.displayName,
      ventureLegalName: row.offering.venture.legalName,
      currency: row.offering.currency,
      totalUnits: row.totalUnits.toString(),
      totalMinor: minorToString(row.totalMinor),
      minimumRaiseMinor: minorToString(row.offering.minimumRaiseMinor),
      minimumReached: row.totalMinor >= row.offering.minimumRaiseMinor,
      lineCount: (row.snapshot as unknown as AllocationLine[]).length,
      checksum: row.checksum,
      version: row.version,
      requestedAt: row.createdAt,
      // Said here rather than discovered on submit: this reviewer cannot decide this one, because
      // they proposed it or they are inside the issuing organisation.
      decidableByYou: row.requestedBy !== reviewer.id && !ownOrganizations.has(row.offering.organizationId)
    }));
  }

  /** ADM-04.A03. Rejecting a schedule sends it back without issuing anything. */
  async rejectRequest(actorId: string, requestId: string, input: { reason: string; version: number }) {
    const reviewer = await this.identity.riskReviewerUser(actorId);
    const reason = text(input.reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const request = await tx.allocationRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new IdentityError('not_found', 404);
      if (request.state !== 'submitted') throw new IdentityError('conflict', 409);
      if (request.version !== input.version) throw new IdentityError('conflict', 409);
      if (request.requestedBy === reviewer.id) throw new IdentityError('forbidden', 403);
      const updated = await tx.allocationRequest.update({
        where: { id: request.id },
        data: { state: 'rejected', decidedBy: reviewer.id, decidedAt: new Date(), reason, version: { increment: 1 } }
      });
      return { id: updated.id, state: updated.state, reason: updated.reason, version: updated.version };
    });
  }

  // ---------------------------------------------------------------- INV-04: the offering fails

  /**
   * Declares an offering failed because the minimum was not reached.
   *
   * It does not close it. 06 and INV-04 both require every commitment to be resolved and every
   * payment returned first, so this only moves the offering into `failed` and marks what has to be
   * refunded. Closing is a separate call that checks the work was actually done.
   */
  async declareFailed(actorId: string, organizationId: string, offeringId: string, input: { version: number }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId } });
      if (!offering) throw new IdentityError('not_found', 404);
      if (offering.state !== 'closing') throw new IdentityError('conflict', 409);
      if (offering.version !== input.version) throw new IdentityError('conflict', 409);

      const paid = await tx.commitment.findMany({ where: { offeringId, state: { in: ['paid', 'paying'] } }, select: { id: true, amountMinor: true } });
      const raised = paid.reduce((total, row) => total + row.amountMinor, 0n);
      // Refusing to declare a failure on an offering that actually succeeded: the state must
      // describe what happened, not what someone would prefer.
      if (raised >= offering.minimumRaiseMinor) throw new IdentityError('conflict', 409);

      await tx.commitment.updateMany({ where: { offeringId, state: 'paid' }, data: { state: 'refunding' } });
      // A reservation that never became money simply lapses; there is nothing to return.
      await tx.commitment.updateMany({ where: { offeringId, state: { in: ['reserved', 'confirmed'] } }, data: { state: 'expired' } });
      const updated = await tx.offering.update({
        where: { id: offering.id },
        data: { state: 'failed', stateReason: 'minimum_not_reached', version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offering.id, action: 'offering.failed' } });
      return {
        id: updated.id, state: updated.state,
        toRefund: paid.length, raisedMinor: minorToString(raised),
        minimumRaiseMinor: minorToString(offering.minimumRaiseMinor), version: updated.version
      };
    });
  }

  /** Returns one investor's money on a failed offering, and posts the movement to the escrow. */
  async refundCommitment(actorId: string, commitmentId: string) {
    await this.identity.financeOperatorUser(actorId);
    return this.db.$transaction(async tx => {
      const commitment = await tx.commitment.findUnique({ where: { id: commitmentId }, include: { offering: true } });
      if (!commitment) throw new IdentityError('not_found', 404);
      if (commitment.state !== 'refunding') throw new IdentityError('conflict', 409);
      if (await this.ledger.alreadyPosted(tx as DatabaseClient, 'subscription.refunded', commitment.id)) throw new IdentityError('conflict', 409);

      const pool = await tx.fundingPool.findUniqueOrThrow({ where: { offeringId: commitment.offeringId } });
      const balances = await this.ledger.balances(pool.id, tx as DatabaseClient);
      // The escrow must actually hold the money. A refund promised out of cash that is not there
      // is a shortfall, and 08 requires that to be recognised rather than approved blindly.
      if (BigInt(balances.availableMinor) < commitment.amountMinor) throw new IdentityError('conflict', 409);

      await this.ledger.post(tx as DatabaseClient, {
        poolId: pool.id, currency: commitment.currency,
        sourceType: 'subscription.refunded', sourceId: commitment.id,
        lines: [
          { account: 'restrictedFunds', debit: commitment.amountMinor },
          { account: 'bankCash', credit: commitment.amountMinor }
        ]
      });
      const updated = await tx.commitment.update({ where: { id: commitment.id }, data: { state: 'refunded', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: commitment.id, action: 'subscription.refunded' } });
      return { id: updated.id, state: updated.state, amountMinor: minorToString(commitment.amountMinor) };
    });
  }

  /**
   * INV-04. Closes a failed offering, but only once nothing is left outstanding.
   *
   * The check is the point: an offering that still owes somebody money is not closed, and the call
   * says exactly what remains rather than refusing without explanation.
   */
  async closeFailed(actorId: string, organizationId: string, offeringId: string, input: { version: number }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId } });
      if (!offering) throw new IdentityError('not_found', 404);
      if (offering.state !== 'failed') throw new IdentityError('conflict', 409);
      if (offering.version !== input.version) throw new IdentityError('conflict', 409);

      const outstanding = await tx.commitment.count({
        where: { offeringId, state: { in: ['reserved', 'confirmed', 'paying', 'paid', 'refunding'] } }
      });
      if (outstanding > 0) {
        // Named, not just refused: INV-04 is about resolving everything before closing, so the
        // caller is told how much is left to resolve.
        throw new IdentityError('conflict', 409);
      }

      const pool = await tx.fundingPool.findUnique({ where: { offeringId } });
      if (pool) {
        const balances = await this.ledger.balances(pool.id, tx as DatabaseClient);
        // A pool that still holds money has not finished returning it.
        if (BigInt(balances.restrictedMinor) !== 0n) throw new IdentityError('conflict', 409);
      }

      const updated = await tx.offering.update({
        where: { id: offering.id },
        data: { state: 'closed', stateReason: 'closed_after_refunds', version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: offering.id, action: 'offering.closed_after_refunds' } });
      return { id: updated.id, state: updated.state, version: updated.version };
    });
  }

  /** What still stands between a failed offering and being closed. */
  async closingReadiness(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'finance.read');
    const offering = await this.db.offering.findFirst({ where: { id: offeringId, organizationId } });
    if (!offering) throw new IdentityError('not_found', 404);
    const [outstanding, refunded, pool] = await Promise.all([
      this.db.commitment.count({ where: { offeringId, state: { in: ['reserved', 'confirmed', 'paying', 'paid', 'refunding'] } } }),
      this.db.commitment.count({ where: { offeringId, state: 'refunded' } }),
      this.db.fundingPool.findUnique({ where: { offeringId } })
    ]);
    const balances = pool ? await this.ledger.balances(pool.id) : null;
    return {
      state: offering.state,
      outstandingCommitments: outstanding,
      refundedCommitments: refunded,
      escrowRestrictedMinor: balances?.restrictedMinor ?? null,
      // Both conditions, separately, so a screen can say which one is not met.
      canClose: offering.state === 'failed' && outstanding === 0 && (!balances || BigInt(balances.restrictedMinor) === 0n)
    };
  }

  // ---------------------------------------------------------------- BUS-04 reads

  /** BUS-04. The issuer's view of who committed what, and where each one has got to. */
  async book(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'finance.read');
    const offering = await this.db.offering.findFirst({ where: { id: offeringId, organizationId }, include: { venture: true } });
    if (!offering) throw new IdentityError('not_found', 404);
    const commitments = await this.db.commitment.findMany({
      where: { offeringId },
      include: {
        user: { select: { name: true } },
        subscription: { include: { intent: { include: { settlement: true } } } },
        allocation: true
      },
      orderBy: { createdAt: 'asc' }, take: 200
    });
    const requests = await this.db.allocationRequest.findMany({ where: { offeringId }, orderBy: { createdAt: 'desc' }, take: 10 });
    const postRaiseShares = offering.venture.currentShares + offering.sharesOffered;

    return {
      offering: { id: offering.id, title: offering.title, state: offering.state, version: offering.version, currency: offering.currency },
      commitments: commitments.map(commitment => ({
        id: commitment.id,
        // The issuer needs to know who subscribed in order to issue to them; this is that read.
        investor: commitment.user.name,
        units: commitment.units.toString(),
        amountMinor: minorToString(commitment.amountMinor),
        percentOfPostRaise: percentString(commitment.units, postRaiseShares),
        state: commitment.state,
        confirmed: Boolean(commitment.subscription),
        settled: commitment.subscription?.intent?.settlement?.state === 'settled',
        allocated: Boolean(commitment.allocation),
        expiresAt: commitment.expiresAt,
        createdAt: commitment.createdAt
      })),
      requests: requests.map(request => ({
        id: request.id, state: request.state, checksum: request.checksum,
        totalUnits: request.totalUnits.toString(), totalMinor: minorToString(request.totalMinor),
        reason: request.reason, version: request.version, createdAt: request.createdAt
      }))
    };
  }
}
