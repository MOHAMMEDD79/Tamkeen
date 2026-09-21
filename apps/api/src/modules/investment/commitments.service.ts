import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseMinor } from '../projects/money.js';
import { LedgerService } from '../money/ledger.service.js';
import type { PaymentPort, ProviderEvent } from '../money/payment-port.js';
import { simulatedProcessorFee } from '../money/payment-port.js';
import { EligibilityService } from './eligibility.service.js';
import { subscriptionMaths } from './shares.js';

/**
 * Commitments, subscriptions, payments and allocations (06-INVESTMENT-LIFECYCLE, PER-08, BUS-04).
 *
 * 06 keeps four things apart, and so does this module:
 *
 *  - an **interest** is nothing at all (PART-08);
 *  - a **commitment** reserves capacity until it expires;
 *  - a **subscription** is the contract, bound to the disclosure version that was agreed;
 *  - an **allocation** is proof that units were issued, and is the only thing that makes a holding.
 *
 * `LOOP-INV` states the rule this file exists to enforce: **there is no path from a commitment
 * straight to a holding.** Every step between them re-checks eligibility and the disclosure
 * version, because either can change while an investor is part-way through.
 */

/** How long a reservation holds capacity before it lapses on its own. */
const COMMITMENT_TTL_MS = 48 * 60 * 60 * 1000;

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

/** The material terms of the contract an investor confirms. */
const contractChecksum = (input: { commitmentId: string; units: bigint; amountMinor: bigint; currency: string; disclosureChecksum: string }) =>
  createHash('sha256').update([input.commitmentId, input.units.toString(), input.amountMinor.toString(), input.currency, input.disclosureChecksum].join('\u0000')).digest('hex');

/** Commitment states that still hold capacity against the offering. */
export const CAPACITY_HOLDING_STATES = ['reserved', 'confirmed', 'paying', 'paid', 'allocated'] as const;

export class CommitmentsService {
  private readonly identity: IdentityService;
  private readonly eligibility: EligibilityService;
  private readonly ledger: LedgerService;
  constructor(private readonly db: DatabaseClient, private readonly payments: PaymentPort) {
    this.identity = new IdentityService(db);
    this.eligibility = new EligibilityService(db);
    this.ledger = new LedgerService(db);
  }

  // ---------------------------------------------------------------- capacity

  /**
   * Units still available in an offering.
   *
   * Counts every commitment that is still holding capacity, and **excludes reservations that have
   * expired** — 06 says a commitment holds capacity only until `expires_at`, so a lapsed one frees
   * its units without anybody running a job.
   */
  private async remainingUnits(client: DatabaseClient, offering: { id: string; sharesOffered: bigint }) {
    const held = await client.commitment.findMany({
      where: {
        offeringId: offering.id,
        OR: [
          { state: { in: ['confirmed', 'paying', 'paid', 'allocated'] } },
          // A reservation counts only while it is still live.
          { state: 'reserved', expiresAt: { gt: new Date() } }
        ]
      },
      select: { units: true }
    });
    const taken = held.reduce((total, row) => total + row.units, 0n);
    return offering.sharesOffered - taken;
  }

  /** PUB-08/PER-08. What is left, for a page that must not invite an investor into a full offering. */
  async capacity(offeringId: string) {
    const offering = await this.db.offering.findUnique({ where: { id: offeringId }, include: { venture: true } });
    if (!offering) throw new IdentityError('not_found', 404);
    const remaining = await this.remainingUnits(this.db, offering);
    const committed = offering.sharesOffered - remaining;
    return {
      sharesOffered: offering.sharesOffered.toString(),
      remainingUnits: remaining.toString(),
      committedUnits: committed.toString(),
      committedMinor: minorToString(committed * offering.pricePerShareMinor),
      minimumRaiseMinor: minorToString(offering.minimumRaiseMinor),
      // Whether the offering would succeed if it closed right now. Stated, because an investor
      // deciding to put money in should know it may all come back.
      minimumReached: committed * offering.pricePerShareMinor >= offering.minimumRaiseMinor,
      simulated: true
    };
  }

  // ---------------------------------------------------------------- PER-08: the investor

  /**
   * PER-08.A01. Reserves capacity.
   *
   * The row lock on the offering is taken before the remaining units are read, inside the same
   * transaction that writes the reservation, so two investors cannot both be sold the last share.
   */
  async commit(actorId: string, offeringId: string, input: { amountMinor: string }) {
    const user = await this.identity.activeUser(actorId);
    const requested = parseMinor(input.amountMinor);

    // Eligibility is read before the transaction because it is a decision about the person, not
    // about the offering's capacity, and it is re-read at every later step regardless.
    const eligibility = await this.eligibility.isEligible(user.id);

    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findUnique({ where: { id: offeringId }, include: { venture: true, currentDisclosure: true } });
      if (!offering) throw new IdentityError('not_found', 404);
      if (offering.state !== 'open') throw new IdentityError('conflict', 409);
      if (!offering.currentDisclosure) throw new IdentityError('conflict', 409);
      if (offering.closesAt && offering.closesAt <= new Date()) throw new IdentityError('conflict', 409);
      // 06: eligibility gates the commitment, and choosing a capability is not eligibility.
      if (offering.requiresEligibility && !eligibility.eligible) throw new IdentityError('forbidden', 403);

      const maths = subscriptionMaths({
        currentShares: offering.venture.currentShares,
        sharesOffered: offering.sharesOffered,
        pricePerShareMinor: offering.pricePerShareMinor,
        minimumTicketMinor: offering.minimumTicketMinor,
        maximumTicketMinor: offering.maximumTicketMinor
      }, requested);

      if (maths.amountMinor < offering.minimumTicketMinor) throw new IdentityError('invalid_input', 422);
      if (offering.maximumTicketMinor !== null && maths.amountMinor > offering.maximumTicketMinor) throw new IdentityError('invalid_input', 422);

      // The lock, then the read, then the write: one decision rather than two.
      await tx.$queryRaw`SELECT id FROM offerings WHERE id = ${offering.id}::uuid FOR UPDATE`;
      const remaining = await this.remainingUnits(tx as DatabaseClient, offering);
      if (maths.units > remaining) throw new IdentityError('conflict', 409);

      const commitment = await tx.commitment.create({
        data: {
          offeringId: offering.id, userId: user.id,
          requestedMinor: requested, amountMinor: maths.amountMinor, units: maths.units,
          currency: offering.currency, disclosureId: offering.currentDisclosure.id,
          eligibleAtCommitment: eligibility.eligible,
          expiresAt: new Date(Date.now() + COMMITMENT_TTL_MS),
          state: 'reserved'
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: commitment.id, action: 'commitment.reserved' } });
      return this.view(commitment, maths.percentOfPostRaise);
    });
  }

  /**
   * PER-08.A02. Confirms the contract.
   *
   * This is where INV-03 bites: if the disclosure has been revised, or the investor's eligibility
   * has lapsed since they committed, they cannot continue until that is dealt with. The reservation
   * is not destroyed — it is simply not confirmable until the person catches up.
   */
  async confirm(actorId: string, commitmentId: string, input: { disclosureChecksum: string; acknowledgedRisk: boolean; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const eligibility = await this.eligibility.isEligible(user.id);

    return this.db.$transaction(async tx => {
      const commitment = await tx.commitment.findUnique({
        where: { id: commitmentId },
        include: { offering: { include: { currentDisclosure: true } } }
      });
      if (!commitment || commitment.userId !== user.id) throw new IdentityError('not_found', 404);
      if (commitment.state !== 'reserved') throw new IdentityError('conflict', 409);
      if (commitment.version !== input.version) throw new IdentityError('conflict', 409);
      if (commitment.expiresAt <= new Date()) throw new IdentityError('conflict', 409);
      if (!input.acknowledgedRisk) throw new IdentityError('invalid_input', 422);

      const current = commitment.offering.currentDisclosure;
      if (!current) throw new IdentityError('conflict', 409);
      // INV-03, first half: the offering must still be on the version this commitment was made
      // against, and the investor must be confirming that same version.
      if (current.id !== commitment.disclosureId) throw new IdentityError('conflict', 409);
      if (current.checksum !== input.disclosureChecksum) throw new IdentityError('conflict', 409);
      // INV-03, second half: an eligibility that has expired stops the purchase here, before money.
      if (commitment.offering.requiresEligibility && !eligibility.eligible) throw new IdentityError('forbidden', 403);

      const subscription = await tx.subscription.create({
        data: {
          commitmentId: commitment.id,
          disclosureId: current.id,
          disclosureChecksum: current.checksum,
          contractChecksum: contractChecksum({
            commitmentId: commitment.id, units: commitment.units,
            amountMinor: commitment.amountMinor, currency: commitment.currency,
            disclosureChecksum: current.checksum
          }),
          acknowledgedRisk: true
        }
      });
      const updated = await tx.commitment.update({ where: { id: commitment.id }, data: { state: 'confirmed', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: commitment.id, action: 'commitment.confirmed' } });
      return { commitment: this.view(updated), subscription: this.subscriptionView(subscription) };
    });
  }

  /**
   * PER-08.A03. Opens a payment intent against the confirmed contract.
   *
   * Reuses the charity payment path: same port, same signed webhook, same inbox. There is one
   * idempotency boundary in this product, and adding a second one for investments would be the
   * surest way to get one of them wrong.
   */
  async pay(actorId: string, commitmentId: string) {
    const user = await this.identity.activeUser(actorId);
    const eligibility = await this.eligibility.isEligible(user.id);

    const prepared = await this.db.$transaction(async tx => {
      const commitment = await tx.commitment.findUnique({
        where: { id: commitmentId },
        include: { subscription: true, offering: { include: { currentDisclosure: true } } }
      });
      if (!commitment || commitment.userId !== user.id) throw new IdentityError('not_found', 404);
      if (commitment.state !== 'confirmed' || !commitment.subscription) throw new IdentityError('conflict', 409);
      if (commitment.expiresAt <= new Date()) throw new IdentityError('conflict', 409);
      // Re-checked again: time passed between confirming and paying, and either may have changed.
      if (commitment.offering.currentDisclosure?.id !== commitment.disclosureId) throw new IdentityError('conflict', 409);
      if (commitment.offering.requiresEligibility && !eligibility.eligible) throw new IdentityError('forbidden', 403);
      if (!['open', 'closing'].includes(commitment.offering.state)) throw new IdentityError('conflict', 409);

      // Every offering has its own escrow pool, kept apart from any project's money.
      const pool = await this.ensureEscrow(tx as DatabaseClient, commitment.offering);
      await tx.commitment.update({ where: { id: commitment.id }, data: { state: 'paying', version: { increment: 1 } } });
      return { commitment, subscriptionId: commitment.subscription.id, poolId: pool.id };
    });

    const intent = await this.payments.createIntent({
      amountMinor: prepared.commitment.amountMinor,
      currency: prepared.commitment.currency,
      reference: prepared.subscriptionId
    });
    const created = await this.db.paymentIntent.create({
      data: {
        subscriptionId: prepared.subscriptionId,
        provider: this.payments.name, providerReference: intent.providerReference,
        state: 'awaiting_action',
        amountMinor: prepared.commitment.amountMinor, currency: prepared.commitment.currency,
        expiresAt: intent.expiresAt
      }
    });
    return {
      commitmentId: prepared.commitment.id,
      paymentIntentId: created.id,
      status: created.state,
      providerRedirectPath: intent.redirectPath,
      amountMinor: minorToString(prepared.commitment.amountMinor),
      currency: prepared.commitment.currency,
      expiresAt: created.expiresAt,
      simulated: true
    };
  }

  /** Creates the offering's escrow pool the first time money is expected. Idempotent. */
  private async ensureEscrow(tx: DatabaseClient, offering: { id: string; currency: string }) {
    const existing = await tx.fundingPool.findUnique({ where: { offeringId: offering.id } });
    if (existing) return existing;
    const pool = await tx.fundingPool.create({ data: { offeringId: offering.id, kind: 'offering_escrow', currency: offering.currency } });
    await this.ledger.createAccounts(tx, pool.id, offering.currency);
    return pool;
  }

  /** PER-08.A04. Cancelling frees the capacity and keeps the record of what happened. */
  async cancel(actorId: string, commitmentId: string, input: { reason: string; version: number }) {
    const user = await this.identity.activeUser(actorId);
    const reason = text(input.reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const commitment = await tx.commitment.findUnique({ where: { id: commitmentId } });
      if (!commitment || commitment.userId !== user.id) throw new IdentityError('not_found', 404);
      // Once money is in flight only the provider's answer can decide what happens to it.
      if (!['reserved', 'confirmed'].includes(commitment.state)) throw new IdentityError('conflict', 409);
      if (commitment.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.commitment.update({
        where: { id: commitment.id },
        data: { state: 'cancelled', cancelledReason: reason, version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId: user.id, resourceId: commitment.id, action: 'commitment.cancelled' } });
      // The commitment stays on the record: 06 asks for the capacity back, not for the history gone.
      return this.view(updated);
    });
  }

  // ---------------------------------------------------------------- the provider's answer

  /**
   * Applies a provider event for a subscription payment. Called from the same webhook handler as a
   * contribution, after the signature and the inbox have already done their work.
   */
  async applyProviderEvent(tx: DatabaseClient, event: ProviderEvent, intent: {
    id: string; subscriptionId: string | null; amountMinor: bigint; currency: string; state: string; lastEventAt: Date | null;
  }) {
    if (!intent.subscriptionId) throw new IdentityError('conflict', 409);
    if (intent.amountMinor !== event.amountMinor || intent.currency !== event.currency) return 'amount_mismatch' as const;
    if (intent.lastEventAt && event.occurredAt < intent.lastEventAt) return 'stale_event' as const;

    const subscription = await tx.subscription.findUniqueOrThrow({
      where: { id: intent.subscriptionId },
      include: { commitment: { include: { offering: true } } }
    });
    const commitment = subscription.commitment;

    // Settlement arrives after the intent is already final — that is what makes it a second fact
    // rather than a restatement of the first — so it is answered before the terminal-state guard.
    if (event.eventType === 'payment.settled') {
      if (commitment.state !== 'paid') return 'not_confirmed' as const;
      if (await this.ledger.alreadyPosted(tx, 'subscription.settled', commitment.id)) return 'already_posted' as const;
      await this.postSettlement(tx, commitment, intent.id);
      return 'settled' as const;
    }
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(intent.state)) return 'already_final' as const;

    if (event.eventType === 'payment.failed') {
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { state: 'failed', lastEventAt: event.occurredAt } });
      // The reservation goes back to confirmed so the investor can try again before it expires.
      await tx.commitment.update({ where: { id: commitment.id }, data: { state: 'confirmed', version: { increment: 1 } } });
      return 'failed' as const;
    }

    if (await this.ledger.alreadyPosted(tx, 'subscription.confirmed', commitment.id)) return 'already_posted' as const;

    const pool = await tx.fundingPool.findUniqueOrThrow({ where: { offeringId: commitment.offeringId } });
    // The same entry a confirmed contribution produces: money sits with the provider and is owed
    // to the offering until it is allocated or returned.
    await this.ledger.post(tx, {
      poolId: pool.id, currency: commitment.currency,
      sourceType: 'subscription.confirmed', sourceId: commitment.id,
      lines: [
        { account: 'providerClearing', debit: commitment.amountMinor },
        { account: 'restrictedFunds', credit: commitment.amountMinor }
      ]
    });
    await tx.paymentIntent.update({ where: { id: intent.id }, data: { state: 'succeeded', lastEventAt: event.occurredAt } });
    await tx.commitment.update({ where: { id: commitment.id }, data: { state: 'paid', version: { increment: 1 } } });
    await tx.outboxEvent.create({ data: { topic: 'subscription.paid', payload: { commitmentId: commitment.id } } });
    return 'succeeded' as const;
  }

  /**
   * The settlement posting. Shared by the `payment.settled` event path and by `settle` below, so
   * there is one description of what settling an escrow subscription means.
   */
  private async postSettlement(tx: DatabaseClient, commitment: { id: string; offeringId: string; currency: string; amountMinor: bigint }, paymentIntentId: string) {
    const pool = await tx.fundingPool.findUniqueOrThrow({ where: { offeringId: commitment.offeringId } });
    const fee = simulatedProcessorFee(commitment.amountMinor);
    const net = commitment.amountMinor - fee;
    await this.ledger.post(tx, {
      poolId: pool.id, currency: commitment.currency,
      sourceType: 'subscription.settled', sourceId: commitment.id,
      // This is where an escrow differs from a charity pool, and it has to. A contribution's fee
      // is borne by the pool, because nobody is owed that money back. A subscription's is not:
      // INV-04 says a failed offering returns the money "according to its contract", and the
      // contract names the amount subscribed, not the amount that survived the processor. So the
      // escrow holds the gross, the fee is still recognised as a real cost, and the platform
      // funds it — landing in an account that is visibly not the subscribers' money.
      lines: [
        { account: 'bankCash', debit: commitment.amountMinor },
        { account: 'providerClearing', credit: commitment.amountMinor },
        { account: 'processorFee', debit: fee },
        { account: 'platformFunding', credit: fee }
      ]
    });
    await tx.settlement.create({
      data: { paymentIntentId, state: 'settled', grossMinor: commitment.amountMinor, feeMinor: fee, netMinor: net, settledAt: new Date() }
    });
    return { fee, net };
  }

  /**
   * Settlement as an explicit call, for demo scripts and tests that drive the chain directly. The
   * product itself settles from a `payment.settled` event on the same webhook.
   */
  async settle(commitmentId: string) {
    return this.db.$transaction(async tx => {
      const commitment = await tx.commitment.findUnique({ where: { id: commitmentId }, include: { subscription: { include: { intent: true } } } });
      if (!commitment?.subscription?.intent) throw new IdentityError('not_found', 404);
      if (commitment.state !== 'paid') throw new IdentityError('conflict', 409);
      if (await this.ledger.alreadyPosted(tx as DatabaseClient, 'subscription.settled', commitment.id)) throw new IdentityError('conflict', 409);

      const { fee, net } = await this.postSettlement(tx as DatabaseClient, commitment, commitment.subscription.intent.id);
      return { commitmentId, grossMinor: minorToString(commitment.amountMinor), feeMinor: minorToString(fee), netMinor: minorToString(net) };
    });
  }

  // ---------------------------------------------------------------- reads

  /** PER-06/PER-08. The investor's own commitments, with what each one actually is right now. */
  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.commitment.findMany({
      where: { userId: user.id },
      include: {
        offering: { select: { id: true, slug: true, title: true, state: true, currentDisclosureId: true } },
        subscription: { include: { intent: { select: { id: true, state: true } } } },
        allocation: { include: { holding: true } }
      },
      orderBy: { createdAt: 'desc' }, take: 100
    });
    const now = new Date();
    return rows.map(row => ({
      ...this.view(row),
      offering: row.offering,
      // Named separately so a screen can never present a reservation as a holding.
      hasContract: Boolean(row.subscription),
      paymentIntentId: row.subscription?.intent?.id ?? null,
      paymentState: row.subscription?.intent?.state ?? null,
      allocation: row.allocation ? {
        id: row.allocation.id, units: row.allocation.units.toString(),
        proofReference: row.allocation.proofReference, simulated: row.allocation.simulated,
        finalisedAt: row.allocation.finalisedAt
      } : null,
      holdingId: row.allocation?.holding?.id ?? null,
      /** True when the reservation has lapsed, whatever the stored state still says. */
      reservationLapsed: row.state === 'reserved' && row.expiresAt <= now,
      /** Set when the offering has moved on from the version this commitment was made against. */
      disclosureSuperseded: row.offering.currentDisclosureId !== row.disclosureId
    }));
  }

  /** PER-06. The portfolio: only proven holdings, plus what is still on its way. */
  async portfolio(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const [holdings, inFlight] = await Promise.all([
      this.db.holding.findMany({
        where: { userId: user.id },
        include: {
          venture: { select: { id: true, legalName: true, currentShares: true, organizationId: true } },
          allocation: { select: { proofReference: true, finalisedAt: true, offeringId: true } }
        },
        orderBy: { createdAt: 'desc' }
      }),
      this.db.commitment.findMany({
        where: { userId: user.id, state: { in: ['reserved', 'confirmed', 'paying', 'paid'] } },
        include: { offering: { select: { slug: true, title: true } } },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const lines = await this.db.distributionLine.findMany({
      where: { holdingId: { in: holdings.map(holding => holding.id) }, distribution: { state: 'paid' } },
      select: { holdingId: true, amountMinor: true }
    });
    const paidByHolding = new Map<string, bigint>();
    for (const line of lines) paidByHolding.set(line.holdingId, (paidByHolding.get(line.holdingId) ?? 0n) + line.amountMinor);

    return {
      holdings: holdings.map(holding => ({
        id: holding.id,
        allocationId: holding.allocationId,
        venture: { id: holding.venture.id, legalName: holding.venture.legalName, organizationId: holding.venture.organizationId },
        units: holding.units.toString(),
        // 06 forbids presenting the subscription price as a current valuation, so only cost basis
        // and distributions actually received appear here. There is no market value field at all.
        costMinor: minorToString(holding.costMinor),
        distributionsReceivedMinor: minorToString(paidByHolding.get(holding.id) ?? 0n),
        currency: holding.currency,
        proofReference: holding.allocation.proofReference,
        allocatedAt: holding.allocation.finalisedAt,
        simulated: holding.simulated
      })),
      // Kept apart from holdings, because money committed is not a stake owned.
      inFlight: inFlight.map(row => ({
        id: row.id, offering: row.offering, state: row.state,
        amountMinor: minorToString(row.amountMinor), units: row.units.toString(),
        currency: row.currency, expiresAt: row.expiresAt
      })),
      /** Stated rather than implied: none of these figures is a valuation. */
      valuationAvailable: false,
      valuationUnavailableReason: 'no_valuation_source',
      simulated: true
    };
  }

  /** PER-09. One investment in full, for its owner only. */
  async one(actorId: string, commitmentId: string) {
    const user = await this.identity.activeUser(actorId);
    const commitment = await this.db.commitment.findUnique({
      where: { id: commitmentId },
      include: {
        offering: { include: { currentDisclosure: true, organization: { select: { displayName: true, slug: true } } } },
        disclosure: true,
        subscription: { include: { intent: { include: { settlement: true } } } },
        allocation: { include: { holding: true } }
      }
    });
    if (!commitment || commitment.userId !== user.id) throw new IdentityError('not_found', 404);
    return {
      ...this.view(commitment),
      offering: {
        id: commitment.offering.id, slug: commitment.offering.slug, title: commitment.offering.title,
        state: commitment.offering.state, organization: commitment.offering.organization,
        // The company, not the round. PER-09 reads investor relations by this, and an investment
        // detail page that cannot name the company it is about can only link to nothing.
        ventureId: commitment.offering.ventureId
      },
      // The version this commitment was made against, in full, alongside the one now in force.
      // The text itself, not only its checksum: the point of the record is that the investor can
      // re-read what they agreed to, not merely verify that a hash still matches.
      agreedDisclosure: {
        id: commitment.disclosure.id, sequence: commitment.disclosure.sequence, checksum: commitment.disclosure.checksum,
        summary: commitment.disclosure.summary, risks: commitment.disclosure.risks, useOfFunds: commitment.disclosure.useOfFunds
      },
      currentDisclosure: commitment.offering.currentDisclosure
        ? { id: commitment.offering.currentDisclosure.id, sequence: commitment.offering.currentDisclosure.sequence, checksum: commitment.offering.currentDisclosure.checksum }
        : null,
      disclosureSuperseded: commitment.offering.currentDisclosureId !== commitment.disclosureId,
      subscription: commitment.subscription ? this.subscriptionView(commitment.subscription) : null,
      payment: commitment.subscription?.intent
        ? {
            id: commitment.subscription.intent.id, state: commitment.subscription.intent.state,
            settled: Boolean(commitment.subscription.intent.settlement),
            settledAt: commitment.subscription.intent.settlement?.settledAt ?? null,
            feeMinor: commitment.subscription.intent.settlement ? minorToString(commitment.subscription.intent.settlement.feeMinor) : null
          }
        : null,
      allocation: commitment.allocation ? {
        id: commitment.allocation.id, units: commitment.allocation.units.toString(),
        costMinor: minorToString(commitment.allocation.costMinor),
        proofReference: commitment.allocation.proofReference,
        simulated: commitment.allocation.simulated,
        finalisedAt: commitment.allocation.finalisedAt
      } : null,
      holding: commitment.allocation?.holding ? {
        id: commitment.allocation.holding.id, units: commitment.allocation.holding.units.toString(), simulated: commitment.allocation.holding.simulated
      } : null
    };
  }

  private view(commitment: {
    id: string; offeringId: string; userId: string; requestedMinor: bigint; amountMinor: bigint;
    units: bigint; currency: string; state: string; disclosureId: string;
    eligibleAtCommitment: boolean; expiresAt: Date; cancelledReason: string;
    simulated: boolean; version: number; createdAt: Date;
  }, percentOfPostRaise?: string) {
    return {
      id: commitment.id,
      offeringId: commitment.offeringId,
      requestedMinor: minorToString(commitment.requestedMinor),
      amountMinor: minorToString(commitment.amountMinor),
      // The remainder that bought no whole share, reported rather than absorbed.
      remainderMinor: minorToString(commitment.requestedMinor - commitment.amountMinor),
      units: commitment.units.toString(),
      currency: commitment.currency,
      state: commitment.state,
      disclosureId: commitment.disclosureId,
      expiresAt: commitment.expiresAt,
      cancelledReason: commitment.cancelledReason,
      simulated: commitment.simulated,
      version: commitment.version,
      createdAt: commitment.createdAt,
      ...(percentOfPostRaise === undefined ? {} : { percentOfPostRaise, indicative: true })
    };
  }

  private subscriptionView(subscription: { id: string; disclosureId: string; disclosureChecksum: string; contractChecksum: string; signatureMethod: string; confirmedAt: Date }) {
    return {
      id: subscription.id,
      disclosureId: subscription.disclosureId,
      disclosureChecksum: subscription.disclosureChecksum,
      contractChecksum: subscription.contractChecksum,
      // Named plainly: this is a click in a demo, not a legal signature, and the DTO says so.
      signatureMethod: subscription.signatureMethod,
      signatureIsSimulated: true,
      confirmedAt: subscription.confirmedAt
    };
  }
}
