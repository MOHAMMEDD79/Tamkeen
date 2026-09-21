import { randomBytes } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseCurrency, parseMinor } from '../projects/money.js';

/**
 * Assistance cases (PRG-12, PER-15) — the most sensitive record in the product.
 *
 * Three rules shape every method here:
 *
 *  - **It is processed only while the person consents.** Consent is two append-only rows, not a
 *    flag, so "they agreed" and "they later withdrew" stay separate facts. Withdrawing it stops
 *    every operator action immediately; it does not erase what was already done, because 12 keeps
 *    the audit record and a person is entitled to know what happened to their own case.
 *  - **Nothing about a case reaches a sponsor, a report or an export.** 12 forbids naming an
 *    assistance applicant anywhere a funder reads, and small aggregates can re-identify somebody,
 *    so this module publishes nothing at all.
 *  - **A delivery recorded is a claim; a delivery confirmed is a fact.** The same shape PART-11
 *    uses for a start date, and for the same reason: the person on the receiving end is the one who
 *    knows whether it arrived.
 */

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

const optionalText = (value: unknown, max: number) => {
  if (value === undefined || value === null) return '';
  return text(value, 0, max);
};

const plainDate = (value: unknown) => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new IdentityError('invalid_input', 422);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new IdentityError('invalid_input', 422);
  return date;
};

const reference = () => `AID-${randomBytes(4).toString('hex').toUpperCase()}`;

/** What the applicant is told the consent covers, in the words they are shown. */
const CONSENT_SCOPE = 'مشاركة تفاصيل الحاجة والمستندات المرفقة مع مسؤول الحالة في هذه الجهة وحدها، لغرض دراسة الطلب وتقديم الدعم.';

/** States in which an operator is still working on a case. */
const LIVE = ['submitted', 'in_review', 'awaiting_info', 'approved'] as const;

export class AssistanceService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  // ---------------------------------------------------------------- PER-15: the applicant

  /** PER-15.A01. A request, with the least that has to be said to assess it. */
  async create(actorId: string, input: {
    organizationId: string; category: string; needSummary: string;
    householdSize?: number | null | undefined; requestedMinor?: string | null | undefined;
    currency?: string | null | undefined; submit?: boolean | undefined;
  }) {
    const user = await this.identity.activeUser(actorId);
    const category = text(input.category, 2, 60);
    const needSummary = text(input.needSummary, 20, 4000);
    const householdSize = input.householdSize === undefined || input.householdSize === null ? null : Number(input.householdSize);
    if (householdSize !== null && (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 50)) throw new IdentityError('invalid_input', 422);
    const requestedMinor = input.requestedMinor ? parseMinor(input.requestedMinor) : null;
    const currency = requestedMinor === null ? null : parseCurrency(String(input.currency ?? ''));

    return this.db.$transaction(async tx => {
      const organization = await tx.organization.findUnique({ where: { id: input.organizationId } });
      if (!organization || organization.status !== 'active') throw new IdentityError('not_found', 404);
      // A case goes to a verified organisation, because it hands over the most sensitive data a
      // person has. An unverified one has no standing to hold it.
      if (organization.verification !== 'verified') throw new IdentityError('conflict', 409);

      const submit = input.submit ?? false;
      const created = await tx.assistanceCase.create({
        data: {
          applicantId: user.id,
          organizationId: organization.id,
          reference: reference(),
          category, needSummary, householdSize, requestedMinor, currency,
          state: submit ? 'submitted' : 'draft',
          ...(submit ? { submittedAt: new Date() } : {})
        }
      });
      if (submit) {
        // Submitting is the moment the consent is given, in the same act, with its scope recorded
        // in the words the applicant was shown.
        await tx.assistanceConsent.create({
          data: { caseId: created.id, action: 'granted', scope: CONSENT_SCOPE, actorId: user.id }
        });
        await tx.outboxEvent.create({ data: { topic: 'assistance.submitted', payload: { caseId: created.id } } });
      }
      return { ...this.applicantView(created), consentGiven: submit, consentScope: submit ? CONSENT_SCOPE : '' };
    });
  }

  async submit(actorId: string, caseId: string, input: { consent: boolean; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const record = await tx.assistanceCase.findUnique({ where: { id: caseId } });
      if (!record || record.applicantId !== user.id) throw new IdentityError('not_found', 404);
      if (record.state !== 'draft') throw new IdentityError('conflict', 409);
      if (record.version !== input.version) throw new IdentityError('conflict', 409);
      if (!input.consent) throw new IdentityError('invalid_input', 422);

      await tx.assistanceConsent.create({ data: { caseId, action: 'granted', scope: CONSENT_SCOPE, actorId: user.id } });
      const updated = await tx.assistanceCase.update({
        where: { id: caseId }, data: { state: 'submitted', submittedAt: new Date(), version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'assistance.submitted', payload: { caseId } } });
      return { ...this.applicantView(updated), consentGiven: true, consentScope: CONSENT_SCOPE };
    });
  }

  /** PER-15.A02. Answering a request for a document or a clarification. */
  async reply(actorId: string, caseId: string, input: { body: string; documentRef?: string | undefined }) {
    const user = await this.identity.activeUser(actorId);
    const body = text(input.body, 2, 4000);

    return this.db.$transaction(async tx => {
      const record = await tx.assistanceCase.findUnique({ where: { id: caseId } });
      if (!record || record.applicantId !== user.id) throw new IdentityError('not_found', 404);
      if (!(LIVE as readonly string[]).includes(record.state)) throw new IdentityError('conflict', 409);
      await this.requireConsent(tx as DatabaseClient, caseId);

      const message = await tx.assistanceMessage.create({
        data: { caseId, author: 'applicant', body, documentRef: optionalText(input.documentRef, 200), authorId: user.id }
      });
      if (record.state === 'awaiting_info') {
        await tx.assistanceCase.update({ where: { id: caseId }, data: { state: 'in_review', version: { increment: 1 } } });
      }
      return { id: message.id, createdAt: message.createdAt, caseState: record.state === 'awaiting_info' ? 'in_review' : record.state };
    });
  }

  /**
   * PER-15.A03. The applicant confirming something arrived.
   *
   * Confirming receipt is not receiving money: this build moves none, and the reply says so where
   * somebody might otherwise read a confirmation as a payment.
   */
  async confirmDelivery(actorId: string, deliveryId: string, input: { confirmed: boolean; reason?: string | undefined; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const delivery = await tx.assistanceDelivery.findUnique({ where: { id: deliveryId }, include: { case: true } });
      if (!delivery || delivery.case.applicantId !== user.id) throw new IdentityError('not_found', 404);
      if (delivery.confirmedAt || delivery.disputedAt) throw new IdentityError('conflict', 409);
      if (delivery.version !== input.version) throw new IdentityError('conflict', 409);

      if (input.confirmed) {
        const updated = await tx.assistanceDelivery.update({
          where: { id: delivery.id }, data: { confirmedAt: new Date(), version: { increment: 1 } }
        });
        return { ...this.deliveryView(updated), confirmed: true as const, moneyReceivedThroughPlatform: false as const };
      }
      // Disputing is not a complaint into the void: it moves the case out of every counted state
      // until somebody settles it, exactly as a disputed placement does in PART-11.
      const reason = text(input.reason, 10, 1000);
      const updated = await tx.assistanceDelivery.update({
        where: { id: delivery.id }, data: { disputedAt: new Date(), disputeReason: reason, version: { increment: 1 } }
      });
      await tx.assistanceCase.update({ where: { id: delivery.caseId }, data: { state: 'disputed', stateReason: reason, version: { increment: 1 } } });
      await tx.outboxEvent.create({ data: { topic: 'assistance.delivery_disputed', payload: { deliveryId } } });
      return { ...this.deliveryView(updated), confirmed: false as const, caseState: 'disputed' as const, countedAsDelivered: false as const };
    });
  }

  /**
   * PER-15.A05. Withdrawing the consent.
   *
   * It stops the processing at once: every operator method below re-checks the latest consent row
   * and refuses. It does not delete the case — 12 keeps the record of what was already done, and
   * the reply says exactly that, so the person is not told their data vanished when it did not.
   */
  async revokeConsent(actorId: string, caseId: string, input: { reason?: string | undefined; version: number }) {
    const user = await this.identity.activeUser(actorId);

    return this.db.$transaction(async tx => {
      const record = await tx.assistanceCase.findUnique({ where: { id: caseId }, include: { deliveries: { select: { id: true } }, decisions: { select: { id: true } } } });
      if (!record || record.applicantId !== user.id) throw new IdentityError('not_found', 404);
      if (record.version !== input.version) throw new IdentityError('conflict', 409);
      const latest = await tx.assistanceConsent.findFirst({ where: { caseId }, orderBy: { createdAt: 'desc' } });
      if (!latest || latest.action !== 'granted') throw new IdentityError('conflict', 409);

      await tx.assistanceConsent.create({
        data: { caseId, action: 'revoked', scope: CONSENT_SCOPE, reason: optionalText(input.reason, 1000), actorId: user.id }
      });
      const updated = (LIVE as readonly string[]).includes(record.state)
        ? await tx.assistanceCase.update({
            where: { id: caseId },
            data: { state: 'withdrawn', stateReason: 'سُحبت الموافقة على المعالجة', version: { increment: 1 } }
          })
        : record;
      await tx.outboxEvent.create({ data: { topic: 'assistance.consent_revoked', payload: { caseId } } });

      return {
        ...this.applicantView(updated),
        consentGiven: false,
        /** What withdrawing actually did, in the same reply, rather than in a help page. */
        processingStopped: true as const,
        operatorAccessEnded: true as const,
        recordRetained: true as const,
        retainedBecause: 'record_of_what_already_happened',
        retainedItems: { decisions: record.decisions.length, deliveries: record.deliveries.length },
        reversible: true as const,
        note: 'consent_can_be_given_again_on_a_new_request'
      };
    });
  }

  /** PER-15. The applicant's own cases, in full. It is their record. */
  async mine(actorId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.assistanceCase.findMany({
      where: { applicantId: user.id },
      include: {
        organization: { select: { slug: true, displayName: true } },
        consents: { orderBy: { createdAt: 'desc' } },
        messages: { orderBy: { createdAt: 'asc' } },
        decisions: { orderBy: { createdAt: 'desc' } },
        deliveries: { orderBy: { createdAt: 'desc' } }
      },
      orderBy: { createdAt: 'desc' }
    });
    return rows.map(row => {
      const latest = row.consents[0];
      return {
        ...this.applicantView(row),
        organization: row.organization,
        needSummary: row.needSummary,
        consentGiven: latest?.action === 'granted',
        consentScope: latest?.scope ?? '',
        consentHistory: row.consents.map(consent => ({ action: consent.action, at: consent.createdAt, reason: consent.reason })),
        messages: row.messages.map(message => ({ id: message.id, author: message.author, body: message.body, documentRef: message.documentRef, at: message.createdAt })),
        /** The applicant is shown the reason they were given, never the internal criteria. */
        decisions: row.decisions.map(decision => ({ outcome: decision.outcome, reason: decision.reason, at: decision.createdAt })),
        deliveries: row.deliveries.map(delivery => this.deliveryView(delivery))
      };
    });
  }

  // ---------------------------------------------------------------- PRG-12: the case worker

  /**
   * The organisation's cases.
   *
   * Assignment decides which ones, the same way a CohortTrainer row decides a trainer's cohorts.
   * A case whose consent was withdrawn keeps its reference and its state and loses its contents:
   * the operator can see that it existed and that it stopped, and nothing else.
   */
  async listForOrganization(actorId: string, organizationId: string, filters: { state?: string | undefined; mine?: boolean | undefined }) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    const rows = await this.db.assistanceCase.findMany({
      where: {
        organizationId,
        state: filters.state ? (filters.state as 'submitted') : { not: 'draft' },
        ...(filters.mine ? { caseWorkerId: membership.user.id } : {})
      },
      include: {
        applicant: { select: { id: true, name: true } },
        caseWorker: { select: { id: true, name: true } },
        consents: { orderBy: { createdAt: 'desc' }, take: 1 },
        deliveries: { select: { id: true, confirmedAt: true, disputedAt: true } },
        _count: { select: { messages: true, decisions: true } }
      },
      orderBy: { submittedAt: 'asc' },
      take: 200
    });
    return rows.map(row => this.operatorView(row));
  }

  async get(actorId: string, organizationId: string, caseId: string) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    const record = await this.db.assistanceCase.findFirst({
      where: { id: caseId, organizationId, state: { not: 'draft' } },
      include: {
        applicant: { select: { id: true, name: true } },
        caseWorker: { select: { id: true, name: true } },
        consents: { orderBy: { createdAt: 'desc' } },
        messages: { orderBy: { createdAt: 'asc' } },
        decisions: { orderBy: { createdAt: 'desc' } },
        deliveries: { orderBy: { createdAt: 'desc' } },
        _count: { select: { messages: true, decisions: true } }
      }
    });
    if (!record) throw new IdentityError('not_found', 404);
    const consented = record.consents[0]?.action === 'granted';
    void membership;

    return {
      ...this.operatorView({ ...record, consents: record.consents.slice(0, 1) }),
      /**
       * Everything below is behind the consent. When it has been withdrawn the operator sees the
       * shape of the case and none of its contents — which is what "stop processing" has to mean
       * in a screen, not only in a policy document.
       */
      needSummary: consented ? record.needSummary : '',
      householdSize: consented ? record.householdSize : null,
      requestedMinor: consented && record.requestedMinor !== null ? minorToString(record.requestedMinor) : null,
      currency: consented ? record.currency : null,
      messages: consented
        ? record.messages.map(message => ({ id: message.id, author: message.author, body: message.body, documentRef: message.documentRef, at: message.createdAt }))
        : [],
      decisions: record.decisions.map(decision => ({
        outcome: decision.outcome, reason: decision.reason,
        criteria: consented ? decision.criteria : '', at: decision.createdAt
      })),
      deliveries: record.deliveries.map(delivery => this.deliveryView(delivery)),
      consentHistory: record.consents.map(consent => ({ action: consent.action, at: consent.createdAt })),
      withheldReason: consented ? '' : 'consent_revoked'
    };
  }

  /** Taking a case. 22: no pending item without an owner. */
  async claim(actorId: string, organizationId: string, caseId: string, version: number) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    return this.db.$transaction(async tx => {
      const record = await tx.assistanceCase.findFirst({ where: { id: caseId, organizationId } });
      if (!record) throw new IdentityError('not_found', 404);
      await this.requireConsent(tx as DatabaseClient, caseId);
      if (record.caseWorkerId) throw new IdentityError('conflict', 409);
      if (record.version !== version) throw new IdentityError('conflict', 409);
      const updated = await tx.assistanceCase.update({
        where: { id: caseId },
        data: { caseWorkerId: membership.user.id, state: record.state === 'submitted' ? 'in_review' : record.state, version: { increment: 1 } }
      });
      return { id: updated.id, state: updated.state, caseWorkerId: updated.caseWorkerId, version: updated.version };
    });
  }

  /** PRG-12.A01. Asking the applicant for something. A private message, never a public note. */
  async requestClarification(actorId: string, organizationId: string, caseId: string, input: { body: string; version: number }) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    const body = text(input.body, 10, 4000);

    return this.db.$transaction(async tx => {
      const record = await this.assignedCase(tx as DatabaseClient, organizationId, caseId, membership.user.id);
      // Consent first, so a refusal after a withdrawal names the withdrawal rather than whatever
      // state the case happens to have been moved to.
      await this.requireConsent(tx as DatabaseClient, caseId);
      if (!(LIVE as readonly string[]).includes(record.state)) throw new IdentityError('conflict', 409);
      if (record.version !== input.version) throw new IdentityError('conflict', 409);

      const message = await tx.assistanceMessage.create({ data: { caseId, author: 'operator', body, authorId: membership.user.id } });
      const updated = await tx.assistanceCase.update({
        where: { id: caseId }, data: { state: 'awaiting_info', version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'assistance.clarification_requested', payload: { caseId } } });
      return { id: message.id, caseState: updated.state, version: updated.version, private: true as const };
    });
  }

  /** PRG-12.A02. The eligibility decision. Never published, and the criteria stay internal. */
  async decide(actorId: string, organizationId: string, caseId: string, input: {
    outcome: 'approved' | 'rejected'; reason: string; criteria?: string | undefined; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    const reason = text(input.reason, 10, 2000);
    if (!['approved', 'rejected'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const record = await this.assignedCase(tx as DatabaseClient, organizationId, caseId, membership.user.id);
      await this.requireConsent(tx as DatabaseClient, caseId);
      if (!['in_review', 'awaiting_info'].includes(record.state)) throw new IdentityError('conflict', 409);
      if (record.version !== input.version) throw new IdentityError('conflict', 409);

      await tx.assistanceDecision.create({
        data: { caseId, reviewerId: membership.user.id, outcome: input.outcome, reason, criteria: optionalText(input.criteria, 2000) }
      });
      const updated = await tx.assistanceCase.update({
        where: { id: caseId }, data: { state: input.outcome, decidedAt: new Date(), version: { increment: 1 } }
      });
      await tx.outboxEvent.create({ data: { topic: 'assistance.decided', payload: { caseId, outcome: input.outcome } } });
      return {
        ...this.applicantView(updated),
        /** 12: an assistance decision is never published, and never reaches a sponsor report. */
        published: false as const,
        sharedWithSponsor: false as const
      };
    });
  }

  /**
   * PRG-12.A03. Recording that something was handed over.
   *
   * The funding source is required: 22 forbids an unexplained balance, and support that arrived
   * from nowhere in particular is the same problem one step earlier. It waits for the applicant.
   */
  async recordDelivery(actorId: string, organizationId: string, caseId: string, input: {
    description: string; fundingSource: string; amountMinor?: string | null | undefined;
    currency?: string | null | undefined; evidenceRef?: string | undefined; deliveredAt: string; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    const description = text(input.description, 5, 1000);
    const fundingSource = text(input.fundingSource, 3, 200);
    const deliveredAt = plainDate(input.deliveredAt);
    if (deliveredAt.getTime() > Date.now()) throw new IdentityError('invalid_input', 422);
    const amountMinor = input.amountMinor ? parseMinor(input.amountMinor) : null;
    const currency = amountMinor === null ? null : parseCurrency(String(input.currency ?? ''));

    return this.db.$transaction(async tx => {
      const record = await this.assignedCase(tx as DatabaseClient, organizationId, caseId, membership.user.id);
      await this.requireConsent(tx as DatabaseClient, caseId);
      if (record.state !== 'approved') throw new IdentityError('conflict', 409);
      if (record.version !== input.version) throw new IdentityError('conflict', 409);

      const delivery = await tx.assistanceDelivery.create({
        data: {
          caseId, description, fundingSource, amountMinor, currency,
          evidenceRef: optionalText(input.evidenceRef, 200), deliveredAt, recordedBy: membership.user.id
        }
      });
      await tx.outboxEvent.create({ data: { topic: 'assistance.delivery_recorded', payload: { deliveryId: delivery.id } } });
      return {
        ...this.deliveryView(delivery),
        /** An operator's record is a claim. The person receiving it is the one who confirms. */
        confirmed: false as const,
        awaitingApplicantConfirmation: true as const,
        moneyMovedThroughPlatform: false as const
      };
    });
  }

  /**
   * PRG-12.A04. Closing a case.
   *
   * Refused while anything is unfinished: an undecided case, a delivery nobody confirmed, an open
   * dispute. 22's close definition is that nothing is left pending without an owner, and closing
   * over the top of an unconfirmed delivery is exactly that.
   */
  async close(actorId: string, organizationId: string, caseId: string, input: { note: string; version: number }) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    const note = text(input.note, 10, 1000);

    return this.db.$transaction(async tx => {
      const record = await this.assignedCase(tx as DatabaseClient, organizationId, caseId, membership.user.id);
      if (record.version !== input.version) throw new IdentityError('conflict', 409);
      if (!['approved', 'rejected', 'delivered', 'disputed', 'withdrawn'].includes(record.state)) throw new IdentityError('conflict', 409);

      const deliveries = await tx.assistanceDelivery.findMany({ where: { caseId } });
      const unconfirmed = deliveries.filter(delivery => !delivery.confirmedAt && !delivery.disputedAt);
      const disputed = deliveries.filter(delivery => delivery.disputedAt && !delivery.confirmedAt);
      if (unconfirmed.length > 0) throw new IdentityError('conflict', 409);
      if (disputed.length > 0) throw new IdentityError('conflict', 409);
      // An approved case that delivered nothing is not a closed case; it is an unpaid promise.
      if (record.state === 'approved' && deliveries.length === 0) throw new IdentityError('conflict', 409);

      const updated = await tx.assistanceCase.update({
        where: { id: caseId },
        data: { state: 'closed', stateReason: note, closedAt: new Date(), version: { increment: 1 } }
      });
      return { ...this.applicantView(updated), deliveriesConfirmed: deliveries.filter(delivery => delivery.confirmedAt).length };
    });
  }

  /** Settling a disputed delivery, by somebody who did not record it. */
  async resolveDispute(actorId: string, organizationId: string, deliveryId: string, input: {
    outcome: 'upheld' | 'dismissed'; reason: string; version: number;
  }) {
    const membership = await this.identity.access(actorId, organizationId, 'assistance.manage');
    const reason = text(input.reason, 10, 1000);
    if (!['upheld', 'dismissed'].includes(input.outcome)) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const delivery = await tx.assistanceDelivery.findFirst({ where: { id: deliveryId, case: { organizationId } }, include: { case: true } });
      if (!delivery || !delivery.disputedAt) throw new IdentityError('not_found', 404);
      if (delivery.version !== input.version) throw new IdentityError('conflict', 409);
      // The person who recorded the delivery does not also rule on the objection to it.
      if (delivery.recordedBy === membership.user.id) throw new IdentityError('forbidden', 403);

      const updated = input.outcome === 'dismissed'
        ? await tx.assistanceDelivery.update({
            where: { id: delivery.id },
            data: { disputedAt: null, disputeReason: '', confirmedAt: new Date(), version: { increment: 1 } }
          })
        : await tx.assistanceDelivery.update({
            where: { id: delivery.id },
            data: { disputeReason: `${delivery.disputeReason} — ${reason}`, version: { increment: 1 } }
          });
      await tx.assistanceDecision.create({
        data: { caseId: delivery.caseId, reviewerId: membership.user.id, outcome: `dispute_${input.outcome}`, reason }
      });
      const caseState = input.outcome === 'dismissed' ? 'delivered' : 'approved';
      await tx.assistanceCase.update({ where: { id: delivery.caseId }, data: { state: caseState, stateReason: reason, version: { increment: 1 } } });
      return { ...this.deliveryView(updated), caseState, resolvedBySomeoneElse: true as const };
    });
  }

  // ---------------------------------------------------------------- guards and shaping

  /**
   * The consent gate.
   *
   * Every operator write passes through it. Consent withdrawn means the processing stops, and
   * "stops" has to include the paths nobody thought about, which is why it is one function rather
   * than a condition repeated in each method.
   */
  private async requireConsent(db: DatabaseClient, caseId: string) {
    const latest = await db.assistanceConsent.findFirst({ where: { caseId }, orderBy: { createdAt: 'desc' } });
    if (!latest || latest.action !== 'granted') throw new IdentityError('forbidden', 403);
  }

  /** A case reaches the worker it was assigned to, or one nobody has taken yet. */
  private async assignedCase(db: DatabaseClient, organizationId: string, caseId: string, userId: string) {
    const record = await db.assistanceCase.findFirst({ where: { id: caseId, organizationId } });
    if (!record) throw new IdentityError('not_found', 404);
    if (record.caseWorkerId && record.caseWorkerId !== userId) throw new IdentityError('forbidden', 403);
    return record;
  }

  private applicantView(record: {
    id: string; reference: string; category: string; state: string; stateReason: string;
    submittedAt: Date | null; decidedAt: Date | null; closedAt: Date | null;
    version: number; createdAt: Date;
  }) {
    return {
      id: record.id,
      reference: record.reference,
      category: record.category,
      state: record.state,
      stateReason: record.stateReason,
      submittedAt: record.submittedAt,
      decidedAt: record.decidedAt,
      closedAt: record.closedAt,
      version: record.version,
      createdAt: record.createdAt,
      /** Stated on every projection: this record never reaches a sponsor or a public page. */
      private: true as const
    };
  }

  private operatorView(row: {
    id: string; reference: string; category: string; state: string; stateReason: string;
    submittedAt: Date | null; decidedAt: Date | null; closedAt: Date | null; version: number; createdAt: Date;
    applicant: { id: string; name: string };
    caseWorker?: { id: string; name: string } | null | undefined;
    consents: Array<{ action: string; createdAt: Date }>;
    deliveries?: Array<{ id: string; confirmedAt: Date | null; disputedAt: Date | null }> | undefined;
    _count?: { messages: number; decisions: number } | undefined;
  }) {
    const consented = row.consents[0]?.action === 'granted';
    return {
      ...this.applicantView(row),
      /** The applicant's name is behind the consent like everything else about them. */
      applicantName: consented ? row.applicant.name : null,
      consentGiven: consented,
      withheldReason: consented ? '' : 'consent_revoked',
      caseWorker: row.caseWorker ?? null,
      unassigned: !row.caseWorker,
      messageCount: row._count?.messages ?? 0,
      decisionCount: row._count?.decisions ?? 0,
      deliveriesAwaitingConfirmation: (row.deliveries ?? []).filter(delivery => !delivery.confirmedAt && !delivery.disputedAt).length,
      deliveriesDisputed: (row.deliveries ?? []).filter(delivery => delivery.disputedAt && !delivery.confirmedAt).length
    };
  }

  private deliveryView(delivery: {
    id: string; caseId: string; description: string; fundingSource: string;
    amountMinor: bigint | null; currency: string | null; evidenceRef: string;
    deliveredAt: Date; confirmedAt: Date | null; disputedAt: Date | null;
    disputeReason: string; version: number; createdAt: Date;
  }) {
    return {
      id: delivery.id,
      caseId: delivery.caseId,
      description: delivery.description,
      /** Where it came from. Required, so no delivery is unattributed. */
      fundingSource: delivery.fundingSource,
      amountMinor: delivery.amountMinor === null ? null : minorToString(delivery.amountMinor),
      currency: delivery.currency,
      evidenceRef: delivery.evidenceRef,
      deliveredAt: delivery.deliveredAt,
      confirmedAt: delivery.confirmedAt,
      disputedAt: delivery.disputedAt,
      disputeReason: delivery.disputeReason,
      version: delivery.version,
      createdAt: delivery.createdAt,
      /** Only a confirmed delivery counts as one. A recorded one is a claim awaiting an answer. */
      countsAsDelivered: delivery.confirmedAt !== null
    };
  }
}
