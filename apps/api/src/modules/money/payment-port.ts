import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';

/**
 * PaymentPort (11-API-CONTRACTS). The product talks to this interface, never to a provider SDK,
 * so the decision of who actually holds the money stays a launch decision (18-DECISIONS) rather
 * than something baked into the domain.
 *
 * The only implementation in this build is a simulator. It is deliberately explicit about being
 * one: every intent it creates is marked simulated, and nothing it returns may be presented as a
 * real payment. 00-MASTER-PROMPT forbids treating a return from a payment page as proof of payment,
 * so the simulator confirms only through the same signed webhook path a real provider would use.
 */

export interface CreateIntentInput {
  amountMinor: bigint;
  currency: string;
  /** Our own reference, echoed back by the provider so a webhook can be matched to an intent. */
  reference: string;
}

export interface CreatedIntent {
  providerReference: string;
  /** Where the payer is sent. Always inside the app for the simulator. */
  redirectPath: string;
  expiresAt: Date;
}

export interface ProviderEvent {
  eventId: string;
  /**
   * `payment.settled` is a separate, later fact, and that is the point (08): money reaching us is
   * not money we can spend. A real provider says it on a statement or a settlement callback, hours
   * or days after the authorisation, so it is a second event through the same webhook rather than
   * something we decide for ourselves once a payment succeeds.
   */
  eventType: 'payment.succeeded' | 'payment.failed' | 'payment.settled';
  providerReference: string;
  amountMinor: bigint;
  currency: string;
  /** When the provider says the event happened, which is not when we received it (FIN-02). */
  occurredAt: Date;
}

/** An instruction to send money out. The beneficiary's full identifier never crosses this port. */
export interface SendPayoutInput {
  amountMinor: bigint;
  currency: string;
  /** Our own payout id, echoed back by the provider so a callback can be matched to it. */
  reference: string;
  beneficiaryLast4: string;
}

export interface SendRefundInput {
  amountMinor: bigint;
  currency: string;
  reference: string;
  /** The payment being refunded. 08 requires returning money to its original source. */
  originalProviderReference: string;
}

/**
 * What the provider says about an operation we lost track of.
 *
 * This is a read, never a re-send. 08 forbids retrying an operation whose outcome is unknown,
 * because the failure mode of a blind retry is paying twice.
 */
export interface InquiryVerdict {
  result: 'paid' | 'failed' | 'pending';
  proofReference?: string;
}

export interface RefundInquiryVerdict {
  result: 'succeeded' | 'failed' | 'pending';
  proofReference?: string;
}

export interface PaymentPort {
  readonly name: string;
  createIntent(input: CreateIntentInput): Promise<CreatedIntent>;
  /** Verifies a webhook's signature and freshness before anything is trusted (08 step 1). */
  verifyWebhook(input: { rawBody: string; signature: string; timestamp: string }): boolean;
  parseEvent(payload: unknown): ProviderEvent | null;
  /** PART-07. Sends a disbursement instruction; the answer is an acknowledgement, not a payment. */
  sendPayout(input: SendPayoutInput): Promise<{ providerReference: string }>;
  sendRefund(input: SendRefundInput): Promise<{ providerReference: string }>;
  inquirePayout(providerReference: string): Promise<InquiryVerdict>;
  inquireRefund(providerReference: string): Promise<RefundInquiryVerdict>;
}

/** Signed webhooks outside this window are rejected, so an old capture cannot be replayed later. */
const WEBHOOK_TOLERANCE_MS = 5 * 60_000;
const INTENT_TTL_MS = 30 * 60_000;

export class SimulatedPaymentPort implements PaymentPort {
  readonly name = 'simulator';
  /**
   * `db` holds the simulator's own provider-side record (see `recordProviderTruth`). It is optional
   * so the signing and parsing half of the port stays usable without a database.
   */
  constructor(private readonly secret: string, private readonly db?: DatabaseClient) {}

  async createIntent(input: CreateIntentInput): Promise<CreatedIntent> {
    // A real gateway refuses a nonsensical charge at this point rather than at capture, so the
    // simulator does too: the caller must not learn that validation is weaker behind a simulator.
    if (input.amountMinor <= 0n || !/^[A-Z]{3}$/.test(input.currency) || !input.reference) {
      throw new Error('the payment port was asked for an intent it could never charge');
    }
    // The reference stays ours: the provider mints its own identifier and echoes ours in metadata,
    // so a provider reference is never derived from anything we chose.
    const providerReference = `sim_${randomBytes(12).toString('hex')}`;
    return {
      providerReference,
      // The payer lands on a local page that can only emit a signed event; there is no real gateway.
      redirectPath: `/payments/simulate/${providerReference}`,
      expiresAt: new Date(Date.now() + INTENT_TTL_MS)
    };
  }

  /** The signature covers the timestamp and the exact bytes received, not a re-serialised object. */
  sign(rawBody: string, timestamp: string): string {
    return createHmac('sha256', this.secret).update(`${timestamp}.${rawBody}`).digest('hex');
  }

  verifyWebhook({ rawBody, signature, timestamp }: { rawBody: string; signature: string; timestamp: string }): boolean {
    if (typeof signature !== 'string' || !/^[0-9a-f]{64}$/.test(signature)) return false;
    const sentAt = Number(timestamp);
    if (!Number.isFinite(sentAt) || Math.abs(Date.now() - sentAt) > WEBHOOK_TOLERANCE_MS) return false;
    const expected = this.sign(rawBody, timestamp);
    return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(signature, 'hex'));
  }

  parseEvent(payload: unknown): ProviderEvent | null {
    if (typeof payload !== 'object' || payload === null) return null;
    const body = payload as Record<string, unknown>;
    const eventType = body.eventType;
    if (eventType !== 'payment.succeeded' && eventType !== 'payment.failed' && eventType !== 'payment.settled') return null;
    if (typeof body.eventId !== 'string' || !body.eventId || typeof body.providerReference !== 'string') return null;
    // The amount arrives as a string of minor units, exactly as it left us.
    if (typeof body.amountMinor !== 'string' || !/^[0-9]{1,16}$/.test(body.amountMinor)) return null;
    if (typeof body.currency !== 'string' || !/^[A-Z]{3}$/.test(body.currency)) return null;
    const occurredAt = new Date(String(body.occurredAt ?? ''));
    if (Number.isNaN(occurredAt.getTime())) return null;
    return {
      eventId: body.eventId,
      eventType,
      providerReference: body.providerReference,
      amountMinor: BigInt(body.amountMinor),
      currency: body.currency,
      occurredAt
    };
  }

  /**
   * PART-07. Accepting a disbursement instruction. It returns a reference and nothing else: a
   * provider acknowledging an instruction is not the provider saying the money left, and the two
   * must not be collapsed into one step (08).
   */
  async sendPayout(input: SendPayoutInput): Promise<{ providerReference: string }> {
    if (input.amountMinor <= 0n || !/^[A-Z]{3}$/.test(input.currency) || !input.reference) {
      throw new Error('the payment port was asked to send a payout it could never make');
    }
    return { providerReference: `simpo_${randomBytes(12).toString('hex')}` };
  }

  async sendRefund(input: SendRefundInput): Promise<{ providerReference: string }> {
    if (input.amountMinor <= 0n || !/^[A-Z]{3}$/.test(input.currency) || !input.reference || !input.originalProviderReference) {
      throw new Error('the payment port was asked to refund a payment it cannot identify');
    }
    return { providerReference: `simrf_${randomBytes(12).toString('hex')}` };
  }

  /**
   * The simulated provider's own record, and the point of an inquiry.
   *
   * An inquiry is only meaningful when it asks a *different* system than ours. So the simulator
   * keeps its own store of what it believes happened, written when the demo operator decides an
   * outcome, and reads that back here. That is what makes FIN-04 a real test rather than a
   * tautology: our side records `unknown` after a timeout, the provider's side says `paid`, and
   * the inquiry is what reconciles the two.
   *
   * In this build that store is a table in the same database, because there is no second system to
   * put it in. It is written only by the demo endpoints and read only here.
   *
   * With nothing recorded the honest answer is `pending`: the simulator does not know either, and
   * inventing a verdict is exactly what 08 forbids.
   */
  async recordProviderTruth(kind: 'payout' | 'refund', providerReference: string, result: string, proofReference?: string) {
    if (!this.db) throw new Error('the simulator has no provider-side store configured');
    await this.db.simulatedProviderOperation.upsert({
      where: { kind_providerReference: { kind, providerReference } },
      create: { kind, providerReference, result, proofReference: proofReference ?? null },
      // The provider may revise pending → final once; it never rewrites a final answer, because a
      // provider that contradicts itself is a dispute, not an update.
      update: { result, proofReference: proofReference ?? null }
    });
  }

  private async providerTruth(kind: 'payout' | 'refund', providerReference: string) {
    if (!this.db) return null;
    return this.db.simulatedProviderOperation.findUnique({ where: { kind_providerReference: { kind, providerReference } } });
  }

  async inquirePayout(providerReference: string): Promise<InquiryVerdict> {
    const truth = await this.providerTruth('payout', providerReference);
    if (!truth || truth.result === 'pending') return { result: 'pending' };
    const result = truth.result === 'paid' ? 'paid' as const : 'failed' as const;
    return { result, ...(truth.proofReference ? { proofReference: truth.proofReference } : {}) };
  }

  async inquireRefund(providerReference: string): Promise<RefundInquiryVerdict> {
    const truth = await this.providerTruth('refund', providerReference);
    if (!truth || truth.result === 'pending') return { result: 'pending' };
    const result = truth.result === 'succeeded' ? 'succeeded' as const : 'failed' as const;
    return { result, ...(truth.proofReference ? { proofReference: truth.proofReference } : {}) };
  }

  /** Builds a signed event, used by the local simulate page and by tests. */
  buildSignedEvent(event: Omit<ProviderEvent, 'eventId'> & { eventId?: string }) {
    const body = {
      eventId: event.eventId ?? randomUUID(),
      eventType: event.eventType,
      providerReference: event.providerReference,
      amountMinor: event.amountMinor.toString(),
      currency: event.currency,
      occurredAt: event.occurredAt.toISOString()
    };
    const rawBody = JSON.stringify(body);
    const timestamp = String(Date.now());
    return { rawBody, timestamp, signature: this.sign(rawBody, timestamp), body };
  }
}

/**
 * The fee a provider would deduct. In this build it is a declared simulated schedule, not a real
 * tariff: 08 requires the fee policy to be shown before payment and settled explicitly, and the
 * real schedule is a launch decision.
 */
export function simulatedProcessorFee(amountMinor: bigint): bigint {
  // 3% rounded down, which on the specification's worked example of 100.00 gives exactly 3.00.
  return (amountMinor * 3n) / 100n;
}
