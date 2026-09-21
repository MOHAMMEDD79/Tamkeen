import { createHash } from 'node:crypto';
import type { ContributionVisibility, DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseMinor, sumMinor } from '../projects/money.js';
import { LedgerService } from './ledger.service.js';
import { simulatedProcessorFee, type PaymentPort, type ProviderEvent } from './payment-port.js';

/**
 * Contributions: checkout, provider confirmation, settlement and contributor privacy.
 *
 * Nothing here treats a browser returning from a payment page as proof of payment. A contribution
 * becomes `succeeded` only when a signed provider event arrives through the webhook path and is
 * posted to the ledger inside one transaction (00-MASTER-PROMPT, 08-FINANCIAL-SYSTEM).
 */

/** Capacity is held from checkout for this long, then released (05 overfunding rules). */
const RESERVATION_MS = 30 * 60_000;

const requestHash = (body: unknown) => createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');

export class ContributionsService {
  private readonly identity: IdentityService;
  private readonly ledger: LedgerService;
  constructor(private readonly db: DatabaseClient, private readonly payments: PaymentPort) {
    this.identity = new IdentityService(db);
    this.ledger = new LedgerService(db);
  }

  // ---------------------------------------------------------------- quote and capacity

  /**
   * What the payer is told before paying: the amount, the fee and what reaches the project.
   * 21-FORMS-VALIDATION requires the fee to be shown before confirmation, and the server
   * recalculates it at submission so a stale quote cannot be paid against.
   */
  async quote(projectSlug: string, amountMinorRaw: string) {
    const amountMinor = parseMinor(amountMinorRaw);
    const project = await this.db.project.findFirst({
      where: { slug: projectSlug },
      include: { campaign: true, organization: { select: { displayName: true, slug: true, status: true } } }
    });
    if (!project || !project.campaign) throw new IdentityError('not_found', 404);
    if (!this.acceptsFunding(project.state) || project.organization.status !== 'active') throw new IdentityError('conflict', 409);
    if (project.campaign.endsAt <= new Date()) throw new IdentityError('conflict', 409);

    const capacity = await this.remainingCapacity(this.db, project.id, project.campaign.goalMinor);
    const fee = simulatedProcessorFee(amountMinor);
    return {
      projectSlug: project.slug,
      projectTitle: project.title,
      organization: project.organization.displayName,
      currency: project.campaign.currency,
      amountMinor: minorToString(amountMinor),
      // The pool bears the processor fee under the declared policy, so this is what reaches the project.
      feeMinor: minorToString(fee),
      netToProjectMinor: minorToString(amountMinor - fee),
      goalMinor: minorToString(project.campaign.goalMinor),
      remainingCapacityMinor: minorToString(capacity),
      policy: project.campaign.policy,
      exceedsCapacity: amountMinor > capacity,
      // Every figure on this quote is simulated; no provider or money is real in this build.
      simulated: true
    };
  }

  private acceptsFunding(state: string) {
    // A paused project stops accepting new contributions without disturbing existing ones.
    return ['published', 'executing'].includes(state);
  }

  /**
   * Capacity left before the goal, counting confirmed money and live reservations.
   *
   * 05 forbids overfunding by default, so a checkout holds capacity until its reservation expires.
   * Two concurrent checkouts therefore cannot both be told there is room for the same money (CH-02).
   */
  private async remainingCapacity(client: DatabaseClient, projectId: string, goalMinor: bigint) {
    const rows = await client.contribution.findMany({
      where: {
        projectId,
        OR: [
          { state: { in: ['succeeded', 'partially_refunded'] } },
          { state: 'pending', reservedUntil: { gt: new Date() } }
        ]
      },
      select: { amountMinor: true, refundedMinor: true }
    });
    const committed = sumMinor(rows.map(row => row.amountMinor - row.refundedMinor));
    const remaining = goalMinor - committed;
    return remaining > 0n ? remaining : 0n;
  }

  // ---------------------------------------------------------------- checkout

  /**
   * PER-04.A01. Creates the contribution, reserves capacity and asks the provider for an intent.
   *
   * Idempotent by `Idempotency-Key`: the same key with the same body returns the original result,
   * a different body is a conflict (11-API-CONTRACTS). This is what makes a retried or
   * double-clicked checkout safe rather than a second charge.
   */
  async createContribution(actorId: string, idempotencyKey: string, input: { projectSlug: string; amountMinor: string; visibility: ContributionVisibility; showAmountPublicly: boolean; acceptedQuoteFeeMinor: string }) {
    const user = await this.identity.activeUser(actorId);
    if (typeof idempotencyKey !== 'string' || idempotencyKey.length < 8 || idempotencyKey.length > 120) throw new IdentityError('invalid_input', 422);
    if (!['named', 'anonymous'].includes(input.visibility)) throw new IdentityError('invalid_input', 422);
    const amountMinor = parseMinor(input.amountMinor);
    const hash = requestHash(input);
    const route = 'POST /contributions';

    const replay = await this.db.idempotencyRecord.findUnique({ where: { actorId_route_idempotencyKey: { actorId, route, idempotencyKey } } });
    if (replay) {
      // Same key, different body is a conflict: the caller is not retrying, they are asking for
      // something else under a key that already means something.
      if (replay.requestHash !== hash) throw new IdentityError('conflict', 409);
      return replay.response as Record<string, unknown>;
    }

    const created = await this.db.$transaction(async tx => {
      const project = await tx.project.findFirst({ where: { slug: input.projectSlug }, include: { campaign: true, organization: true } });
      if (!project || !project.campaign) throw new IdentityError('not_found', 404);
      // Serialise capacity decisions for this project so two checkouts cannot both fit (CH-02).
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${project.id}::uuid FOR UPDATE`;
      if (!this.acceptsFunding(project.state) || project.organization.status !== 'active') throw new IdentityError('conflict', 409);
      if (project.campaign.endsAt <= new Date()) throw new IdentityError('conflict', 409);

      // The fee is recomputed here; the quote the browser accepted is only checked for agreement.
      const fee = simulatedProcessorFee(amountMinor);
      if (input.acceptedQuoteFeeMinor !== minorToString(fee)) throw new IdentityError('conflict', 409);

      const capacity = await this.remainingCapacity(tx as DatabaseClient, project.id, project.campaign.goalMinor);
      // Overfunding is refused rather than accepted and refunded later (05 default policy).
      if (amountMinor > capacity) throw new IdentityError('conflict', 409);

      const party = await tx.party.findUnique({ where: { userId: user.id } });
      if (!party) throw new IdentityError('forbidden', 403);

      const pool = await this.ledger.ensurePool(tx as DatabaseClient, project.id, project.campaign.currency);
      const contribution = await tx.contribution.create({
        data: {
          poolId: pool.id, projectId: project.id, payerPartyId: party.id,
          amountMinor, currency: project.campaign.currency,
          visibility: input.visibility,
          // Showing the amount is a separate consent and is meaningless while anonymous is implied.
          showAmountPublicly: input.visibility === 'named' ? Boolean(input.showAmountPublicly) : false,
          reservedUntil: new Date(Date.now() + RESERVATION_MS)
        }
      });
      const intentDetails = await this.payments.createIntent({ amountMinor, currency: contribution.currency, reference: contribution.id });
      const intent = await tx.paymentIntent.create({
        data: {
          contributionId: contribution.id, provider: this.payments.name,
          providerReference: intentDetails.providerReference, state: 'awaiting_action',
          amountMinor, currency: contribution.currency, expiresAt: intentDetails.expiresAt
        }
      });
      const response = {
        contributionId: contribution.id,
        paymentIntentId: intent.id,
        status: intent.state,
        // The redirect stays inside the app: there is no external gateway in this build.
        providerRedirectPath: intentDetails.redirectPath,
        expiresAt: intent.expiresAt.toISOString(),
        amountMinor: minorToString(amountMinor),
        feeMinor: minorToString(fee),
        currency: contribution.currency,
        simulated: true
      };
      await tx.idempotencyRecord.create({ data: { actorId, route, idempotencyKey, requestHash: hash, response } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: contribution.id, action: 'contribution.created' } });
      return response;
    });
    return created;
  }

  // ---------------------------------------------------------------- provider events

  /**
   * 08's webhook protocol. Signature and freshness are verified by the port before this runs.
   *
   * The inbox insert is the idempotency boundary: a replayed event id is acknowledged and not
   * processed again, so ten deliveries of one event produce one ledger transaction and one
   * receipt (FIN-01).
   */
  async receiveProviderEvent(event: ProviderEvent, rawPayload: unknown) {
    const inserted = await this.db.webhookInbox.create({
      data: { provider: this.payments.name, eventId: event.eventId, eventType: event.eventType, payload: rawPayload as object }
    }).catch((error: { code?: string }) => {
      if (error.code === 'P2002') return null;
      throw error;
    });
    // A duplicate is acknowledged without reprocessing (08 step 7).
    if (!inserted) return { status: 'duplicate' as const };

    const outcome = await this.db.$transaction(async tx => {
      const intent = await tx.paymentIntent.findUnique({
        where: { provider_providerReference: { provider: this.payments.name, providerReference: event.providerReference } },
        include: { contribution: true }
      });
      // An event for something we never issued is isolated for review, not guessed at.
      if (!intent) return 'unknown_reference' as const;

      // PART-09: the same intent table, the same signed webhook and the same inbox serve both a
      // charity contribution and an investment subscription. One idempotency boundary, because two
      // would be two chances to get it wrong. Which kind it is decides who applies it from here.
      if (intent.subscriptionId) {
        return this.applySubscriptionEvent(tx as DatabaseClient, event, intent);
      }
      if (!intent.contributionId) return 'unknown_reference' as const;
      await tx.$queryRaw`SELECT id FROM contributions WHERE id = ${intent.contributionId}::uuid FOR UPDATE`;

      // Settlement is its own event, arriving after the intent is already final, so it is handled
      // before the terminal-state guard below rather than after it.
      if (event.eventType === 'payment.settled') {
        return this.applySettlement(tx as DatabaseClient, intent.contributionId);
      }

      // Never trust the metadata alone: the amount and currency must match what we issued (08 step 4).
      if (intent.amountMinor !== event.amountMinor || intent.currency !== event.currency) return 'amount_mismatch' as const;

      // FIN-02: an older event must not move the state backwards, and a terminal state is final.
      if (intent.lastEventAt && event.occurredAt < intent.lastEventAt) return 'stale_event' as const;
      if (['succeeded', 'failed', 'cancelled', 'expired'].includes(intent.state)) return 'already_final' as const;

      if (event.eventType === 'payment.failed') {
        await tx.paymentIntent.update({ where: { id: intent.id }, data: { state: 'failed', lastEventAt: event.occurredAt } });
        await tx.contribution.update({ where: { id: intent.contributionId! }, data: { state: 'failed', reservedUntil: null, version: { increment: 1 } } });
        return 'failed' as const;
      }

      const contribution = intent.contribution;
      if (!contribution) return 'unknown_reference' as const;
      // The ledger posting is keyed by the contribution, so it can only ever happen once.
      if (await this.ledger.alreadyPosted(tx as DatabaseClient, 'contribution.confirmed', contribution.id)) return 'already_posted' as const;

      // Step 1 of the worked example in 08: confirmed receipt sits with the provider and is owed
      // to the project. Debit ProviderClearing, credit RestrictedFunds.
      await this.ledger.post(tx as DatabaseClient, {
        poolId: contribution.poolId, currency: contribution.currency,
        sourceType: 'contribution.confirmed', sourceId: contribution.id,
        lines: [
          { account: 'providerClearing', debit: contribution.amountMinor },
          { account: 'restrictedFunds', credit: contribution.amountMinor }
        ]
      });
      await tx.paymentIntent.update({ where: { id: intent.id }, data: { state: 'succeeded', lastEventAt: event.occurredAt } });
      await tx.contribution.update({
        where: { id: contribution.id },
        data: { state: 'succeeded', confirmedAt: new Date(), reservedUntil: null, version: { increment: 1 } }
      });
      // Delivery of the receipt is decoupled: a failed notification cannot undo a confirmed payment.
      await tx.outboxEvent.create({ data: { topic: 'contribution.receipt', payload: { contributionId: contribution.id } } });
      return 'succeeded' as const;
    });

    await this.db.webhookInbox.update({ where: { id: inserted.id }, data: { processedAt: new Date(), outcome } });
    return { status: outcome };
  }

  /**
   * Hands a subscription payment to PART-09's module, from inside the same transaction and after
   * the same signature and inbox checks a contribution gets.
   *
   * Imported here rather than at the top of the file so the two modules do not form an import
   * cycle: the money module owns the webhook, and the investment module owns what a subscription
   * payment means.
   */
  private async applySubscriptionEvent(tx: DatabaseClient, event: ProviderEvent, intent: {
    id: string; subscriptionId: string | null; amountMinor: bigint; currency: string; state: string; lastEventAt: Date | null;
  }) {
    const { CommitmentsService } = await import('../investment/commitments.service.js');
    return new CommitmentsService(tx, this.payments).applyProviderEvent(tx, event, intent);
  }

  /**
   * Settlement driven by a `payment.settled` event, inside the webhook's own transaction.
   *
   * This exists because `settle` below was reachable only from scripts: nothing in the running
   * product ever called it, so in the live app money confirmed but never became spendable and no
   * payout or allocation was possible. Settlement is a fact the provider reports, so it belongs on
   * the same signed path as every other fact it reports.
   */
  private async applySettlement(tx: DatabaseClient, contributionId: string) {
    const contribution = await tx.contribution.findUnique({ where: { id: contributionId }, include: { intent: true } });
    if (!contribution?.intent) return 'unknown_reference' as const;
    if (contribution.state !== 'succeeded' || contribution.intent.state !== 'succeeded') return 'not_confirmed' as const;
    if (await this.ledger.alreadyPosted(tx, 'contribution.settled', contribution.id)) return 'already_posted' as const;
    await this.postSettlement(tx, contribution);
    return 'settled' as const;
  }

  /** The posting itself, shared by the event path and by `settle`. */
  private async postSettlement(tx: DatabaseClient, contribution: { id: string; poolId: string; currency: string; amountMinor: bigint; intent: { id: string } | null }) {
    const fee = simulatedProcessorFee(contribution.amountMinor);
    const net = contribution.amountMinor - fee;
    await this.ledger.post(tx, {
      poolId: contribution.poolId, currency: contribution.currency,
      sourceType: 'contribution.settled', sourceId: contribution.id,
      lines: [
        { account: 'bankCash', debit: net },
        // The fee is recognised as an expense and then charged straight back to the pool, because
        // the declared policy is that the pool bears it (08). Two lines rather than one, so the
        // report can state the fee that was charged while the restricted liability still tracks
        // what is actually spendable: after this, restricted equals the cash the project can use.
        { account: 'processorFee', debit: fee },
        { account: 'providerClearing', credit: contribution.amountMinor },
        { account: 'restrictedFunds', debit: fee },
        { account: 'processorFee', credit: fee }
      ]
    });
    await tx.settlement.create({
      data: { paymentIntentId: contribution.intent!.id, state: 'settled', grossMinor: contribution.amountMinor, feeMinor: fee, netMinor: net, settledAt: new Date() }
    });
    // The fee the contributor was quoted is now the fee that was actually charged.
    await tx.contribution.update({ where: { id: contribution.id }, data: { feeMinor: fee, version: { increment: 1 } } });
    return { fee, net };
  }

  /**
   * Settlement (08) as an explicit call, for demo scripts and tests that drive the chain directly.
   * The product itself settles from a `payment.settled` event; this is the same posting, reached
   * by name instead of by webhook.
   */
  async settle(contributionId: string) {
    return this.db.$transaction(async tx => {
      const contribution = await tx.contribution.findUnique({ where: { id: contributionId }, include: { intent: true } });
      if (!contribution?.intent) throw new IdentityError('not_found', 404);
      if (contribution.state !== 'succeeded' || contribution.intent.state !== 'succeeded') throw new IdentityError('conflict', 409);
      if (await this.ledger.alreadyPosted(tx as DatabaseClient, 'contribution.settled', contribution.id)) throw new IdentityError('conflict', 409);

      const { fee, net } = await this.postSettlement(tx as DatabaseClient, contribution);
      return { contributionId, grossMinor: minorToString(contribution.amountMinor), feeMinor: minorToString(fee), netMinor: minorToString(net) };
    });
  }

  // ---------------------------------------------------------------- reads

  /** PER-05.A01. The status comes from our own record, never from a query parameter. */
  async intentStatus(actorId: string, intentId: string) {
    const user = await this.identity.activeUser(actorId);
    const intent = await this.db.paymentIntent.findUnique({ where: { id: intentId }, include: { contribution: { include: { payer: true, project: { select: { slug: true, title: true } } } } } });
    // A subscription payment has its own screen (PER-08/PER-09); this route answers only about a
    // contribution, so one asked about the other kind is absent rather than partly answered.
    const contribution = intent?.contribution;
    if (!intent || !contribution || contribution.payer.userId !== user.id) throw new IdentityError('not_found', 404);
    return {
      id: intent.id,
      state: intent.state,
      contributionId: intent.contributionId,
      contributionState: contribution.state,
      amountMinor: minorToString(intent.amountMinor),
      currency: intent.currency,
      expiresAt: intent.expiresAt,
      project: contribution.project,
      // A pending intent is pending: the page must not imply success before the provider confirms.
      awaitingProvider: ['created', 'awaiting_action', 'processing'].includes(intent.state),
      simulated: contribution.simulated
    };
  }

  /** PER-02. The contributor's own record, which always shows their identity to themselves. */
  async myContributions(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const party = await this.db.party.findUnique({ where: { userId: user.id } });
    if (!party) return [];
    const rows = await this.db.contribution.findMany({
      where: { payerPartyId: party.id },
      include: { project: { select: { slug: true, title: true } }, intent: { select: { id: true, state: true } } },
      orderBy: { createdAt: 'desc' }, take: 100
    });
    return rows.map(row => ({
      id: row.id, project: row.project, state: row.state,
      amountMinor: minorToString(row.amountMinor), feeMinor: minorToString(row.feeMinor),
      refundedMinor: minorToString(row.refundedMinor), currency: row.currency,
      visibility: row.visibility, showAmountPublicly: row.showAmountPublicly,
      confirmedAt: row.confirmedAt, createdAt: row.createdAt, version: row.version,
      intent: row.intent, simulated: row.simulated
    }));
  }

  async receipt(actorId: string, contributionId: string) {
    const user = await this.identity.activeUser(actorId);
    const contribution = await this.db.contribution.findUnique({ where: { id: contributionId }, include: { payer: true, project: { select: { title: true, slug: true } } } });
    if (!contribution || contribution.payer.userId !== user.id) throw new IdentityError('not_found', 404);
    if (!['succeeded', 'partially_refunded', 'refunded'].includes(contribution.state) || !contribution.confirmedAt) throw new IdentityError('conflict', 409);
    const snapshot = { reference: contribution.id, project: contribution.project, amountMinor: minorToString(contribution.amountMinor), feeMinor: minorToString(contribution.feeMinor), refundedMinor: minorToString(contribution.refundedMinor), currency: contribution.currency, state: contribution.state, confirmedAt: contribution.confirmedAt.toISOString(), simulated: contribution.simulated };
    return { filename: `contribution-receipt-${contribution.id}.json`, mimeType: 'application/json', content: JSON.stringify(snapshot), classification: 'private', generatedFromImmutableConfirmation: true };
  }

  /**
   * PRIV-01. Changing visibility takes effect everywhere the public can read, immediately.
   * The public contributor list is derived from this column on every read, so there is no cached
   * copy that could keep showing a name after it was withdrawn.
   */
  async updatePrivacy(actorId: string, contributionId: string, input: { visibility: ContributionVisibility; showAmountPublicly: boolean; version: number }) {
    const user = await this.identity.activeUser(actorId);
    if (!['named', 'anonymous'].includes(input.visibility)) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      const contribution = await tx.contribution.findUnique({ where: { id: contributionId }, include: { payer: true } });
      if (!contribution || contribution.payer.userId !== user.id) throw new IdentityError('not_found', 404);
      if (contribution.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.contribution.update({
        where: { id: contributionId },
        data: {
          visibility: input.visibility,
          showAmountPublicly: input.visibility === 'named' ? Boolean(input.showAmountPublicly) : false,
          version: { increment: 1 }
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: contributionId, action: 'contribution.privacy_changed' } });
      return { id: updated.id, visibility: updated.visibility, showAmountPublicly: updated.showAmountPublicly, version: updated.version };
    });
  }

  /**
   * The public contributors list for a project (PUB-06). Identity appears only where the
   * contributor chose `named`, and the amount only where they separately consented to it.
   * 05 requires anonymity to be the default and to be honoured in every public projection.
   */
  async publicContributors(projectSlug: string) {
    const project = await this.db.project.findFirst({ where: { slug: projectSlug }, select: { id: true, state: true } });
    if (!project) throw new IdentityError('not_found', 404);
    const rows = await this.db.contribution.findMany({
      where: { projectId: project.id, state: { in: ['succeeded', 'partially_refunded'] } },
      select: {
        id: true, visibility: true, showAmountPublicly: true, amountMinor: true, currency: true, confirmedAt: true,
        payer: { select: { user: { select: { name: true } }, organization: { select: { displayName: true } } } }
      },
      orderBy: { confirmedAt: 'desc' }, take: 100
    });
    return rows.map(row => ({
      id: row.id,
      // Built field by field: an anonymous contributor's name is never placed in the object at all.
      name: row.visibility === 'named' ? (row.payer.user?.name ?? row.payer.organization?.displayName ?? null) : null,
      anonymous: row.visibility === 'anonymous',
      amountMinor: row.visibility === 'named' && row.showAmountPublicly ? minorToString(row.amountMinor) : null,
      currency: row.currency,
      confirmedAt: row.confirmedAt
    }));
  }

  /** ORG-09/ORG-10. The organisation's own view: totals, journal and a redacted contributor list. */
  async organizationFinance(actorId: string, organizationId: string, projectId: string) {
    await this.identity.access(actorId, organizationId, 'finance.read');
    const project = await this.db.project.findFirst({ where: { id: projectId, organizationId }, include: { fundingPools: true, campaign: true } });
    if (!project) throw new IdentityError('not_found', 404);
    const pool = project.fundingPools[0];
    if (!pool) {
      return { hasPool: false as const, balances: null, journal: [], contributors: [] };
    }
    const [balances, journal, contributions] = await Promise.all([
      this.ledger.balances(pool.id),
      this.ledger.journal(pool.id),
      this.db.contribution.findMany({
        where: { projectId },
        select: { id: true, state: true, amountMinor: true, feeMinor: true, currency: true, visibility: true, confirmedAt: true, createdAt: true },
        orderBy: { createdAt: 'desc' }, take: 100
      })
    ]);
    return {
      hasPool: true as const,
      balances,
      journal,
      // 05: operations staff see the amounts they must reconcile, but a contributor's identity is
      // not part of this read. Reaching an identity needs a separate, audited permission.
      contributors: contributions.map(row => ({
        id: row.id, state: row.state,
        amountMinor: minorToString(row.amountMinor), feeMinor: minorToString(row.feeMinor),
        currency: row.currency, anonymous: row.visibility === 'anonymous',
        confirmedAt: row.confirmedAt, createdAt: row.createdAt
      }))
    };
  }
}
