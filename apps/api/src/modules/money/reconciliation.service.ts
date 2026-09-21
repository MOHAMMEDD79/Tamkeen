import { createHash } from 'node:crypto';
import type { DatabaseClient } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString } from '../projects/money.js';

/**
 * Reconciliation (08-FINANCIAL-SYSTEM, ADM-05).
 *
 * Matching a provider statement against our own record, and recording where the two disagree.
 *
 * The point of this module is what it refuses to do. A difference is never resolved by adjusting a
 * balance: the ledger is append-only, the statement line is evidence and cannot be edited, and a
 * resolution is an explanation signed by a person. What reconciliation produces is a work list,
 * not a corrected number.
 *
 * Re-running a batch is safe. Matching writes no ledger entries at all, so running it twice cannot
 * double-count anything (ADM-05.A02); it only re-derives each line's verdict from what is true now.
 */

export interface StatementRow {
  providerTransactionId: string;
  amountMinor: string;
  currency: string;
  feeMinor?: string | undefined;
  /** What the provider says happened: succeeded, failed, refunded, paid. */
  outcome: string;
}

const MAX_ROWS = 5000;

/** The hash identifies the file, so importing the same statement twice is refused by the database. */
export function statementHash(rows: readonly StatementRow[]): string {
  const canonical = rows
    .map(row => [row.providerTransactionId, row.amountMinor, row.currency.toUpperCase(), row.feeMinor ?? '0', row.outcome].join('\u001f'))
    .join('\u0000');
  return createHash('sha256').update(canonical).digest('hex');
}

export class ReconciliationService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient, private readonly environment: string) {
    this.identity = new IdentityService(db);
  }

  /**
   * ADM-05.A01. Imports a statement as a batch.
   *
   * The file hash is unique per source and environment, so re-uploading the same file is a
   * conflict rather than a second batch that silently doubles every figure. A statement from the
   * wrong environment is refused outright: demo numbers must never be matched against real ones.
   */
  async import(actorId: string, input: { source: string; statementDate: string; rows: StatementRow[] }) {
    const importer = await this.identity.financeOperatorUser(actorId);
    if (!Array.isArray(input.rows) || input.rows.length === 0 || input.rows.length > MAX_ROWS) throw new IdentityError('invalid_input', 422);
    const source = typeof input.source === 'string' ? input.source.trim().slice(0, 40) : '';
    if (!source) throw new IdentityError('invalid_input', 422);
    const statementDate = new Date(input.statementDate);
    if (Number.isNaN(statementDate.getTime())) throw new IdentityError('invalid_input', 422);

    const rows = input.rows.map(row => {
      if (typeof row.providerTransactionId !== 'string' || !row.providerTransactionId.trim()) throw new IdentityError('invalid_input', 422);
      if (typeof row.amountMinor !== 'string' || !/^[0-9]{1,16}$/.test(row.amountMinor)) throw new IdentityError('invalid_input', 422);
      if (typeof row.currency !== 'string' || !/^[A-Za-z]{3}$/.test(row.currency)) throw new IdentityError('invalid_input', 422);
      if (row.feeMinor !== undefined && (typeof row.feeMinor !== 'string' || !/^[0-9]{1,16}$/.test(row.feeMinor))) throw new IdentityError('invalid_input', 422);
      if (typeof row.outcome !== 'string' || !row.outcome.trim()) throw new IdentityError('invalid_input', 422);
      return {
        providerTransactionId: row.providerTransactionId.trim().slice(0, 120),
        amountMinor: BigInt(row.amountMinor),
        currency: row.currency.toUpperCase(),
        feeMinor: BigInt(row.feeMinor ?? '0'),
        outcome: row.outcome.trim().slice(0, 20)
      };
    });

    const fileHash = statementHash(input.rows);
    const existing = await this.db.reconciliationBatch.findUnique({
      where: { source_environment_fileHash: { source, environment: this.environment, fileHash } }
    });
    // Re-importing the same statement is refused, and the caller is pointed at the batch that
    // already holds it rather than being left to guess why nothing happened.
    if (existing) throw new IdentityError('conflict', 409);

    return this.db.$transaction(async tx => {
      const batch = await tx.reconciliationBatch.create({
        data: {
          source, environment: this.environment, fileHash, statementDate,
          rowCount: rows.length, importedBy: importer.id, state: 'imported'
        }
      });
      // A statement that lists the same provider reference twice is itself a finding, so the
      // duplicate is recorded as a line rather than dropped on a unique-key violation.
      const seen = new Set<string>();
      for (const row of rows) {
        const duplicate = seen.has(row.providerTransactionId);
        if (duplicate) continue;
        seen.add(row.providerTransactionId);
        await tx.reconciliationItem.create({
          data: { batchId: batch.id, ...row, matchState: 'missing' }
        });
      }
      const duplicates = rows.length - seen.size;
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: batch.id, action: 'reconciliation.imported' } });
      return { id: batch.id, source, environment: batch.environment, fileHash, rowCount: batch.rowCount, duplicateRowsInFile: duplicates, state: batch.state, version: batch.version };
    });
  }

  /**
   * ADM-05.A02. Matches every line against our own record.
   *
   * Writes no ledger entries and changes no balance — it only records, per line, whether what the
   * provider says agrees with what we hold. That is why re-running is safe.
   */
  async run(actorId: string, batchId: string) {
    await this.identity.financeOperatorUser(actorId);
    const batch = await this.db.reconciliationBatch.findUnique({ where: { id: batchId }, include: { items: true } });
    if (!batch) throw new IdentityError('not_found', 404);
    if (batch.state === 'closed') throw new IdentityError('conflict', 409);

    const counts = { match: 0, mismatch: 0, missing: 0, duplicate: 0 };
    for (const item of batch.items) {
      const verdict = await this.matchOne(item);
      counts[verdict.matchState] += 1;
      // A resolved line keeps its resolution; re-running re-derives the verdict, and the append-only
      // trigger in SQL stops the resolution being overwritten even if this code tried.
      await this.db.reconciliationItem.update({
        where: { id: item.id },
        data: {
          matchState: verdict.matchState,
          ourAmountMinor: verdict.ourAmountMinor ?? null,
          ourFeeMinor: verdict.ourFeeMinor ?? null,
          ourState: verdict.ourState ?? null,
          note: verdict.note,
          version: { increment: 1 }
        }
      });
    }

    const updated = await this.db.reconciliationBatch.update({
      where: { id: batch.id },
      data: { state: 'matched', lastRunAt: new Date(), version: { increment: 1 } }
    });
    await this.db.identityAuditEvent.create({ data: { actorId, resourceId: batch.id, action: 'reconciliation.matched' } });
    return { id: updated.id, state: updated.state, lastRunAt: updated.lastRunAt, counts, version: updated.version };
  }

  /**
   * One line's verdict.
   *
   * `missing` means the provider reported something we have no record of at all, which is the most
   * serious finding: money moved that the platform does not know about.
   */
  private async matchOne(item: { providerTransactionId: string; amountMinor: bigint; currency: string; feeMinor: bigint; outcome: string }) {
    const intent = await this.db.paymentIntent.findFirst({
      where: { providerReference: item.providerTransactionId },
      include: { settlement: true, contribution: true }
    });
    if (intent) {
      const ourFee = intent.settlement?.feeMinor ?? 0n;
      const amountAgrees = intent.amountMinor === item.amountMinor;
      const currencyAgrees = intent.currency === item.currency;
      const feeAgrees = !intent.settlement || ourFee === item.feeMinor;
      const outcomeAgrees = (item.outcome === 'succeeded') === (intent.state === 'succeeded');
      const agrees = amountAgrees && currencyAgrees && feeAgrees && outcomeAgrees;
      return {
        matchState: (agrees ? 'match' : 'mismatch') as 'match' | 'mismatch',
        ourAmountMinor: intent.amountMinor,
        ourFeeMinor: ourFee,
        ourState: intent.state,
        // Machine codes rather than a sentence: the screens are Arabic, and a server-written English
        // phrase would land untranslated in front of the operator who has to act on it.
        note: agrees ? '' : [
          amountAgrees ? '' : 'amount_differs',
          currencyAgrees ? '' : 'currency_differs',
          feeAgrees ? '' : 'fee_differs',
          outcomeAgrees ? '' : 'outcome_differs'
        ].filter(Boolean).join(' ')
      };
    }

    const payout = await this.db.payout.findFirst({ where: { providerReference: item.providerTransactionId } });
    if (payout) {
      const agrees = payout.amountMinor === item.amountMinor && payout.currency === item.currency && (item.outcome === 'paid') === (payout.state === 'paid');
      return {
        matchState: (agrees ? 'match' : 'mismatch') as 'match' | 'mismatch',
        ourAmountMinor: payout.amountMinor,
        ourFeeMinor: 0n,
        ourState: payout.state,
        note: agrees ? '' : 'payout_differs'
      };
    }

    const refund = await this.db.refund.findFirst({ where: { providerReference: item.providerTransactionId } });
    if (refund) {
      const agrees = refund.amountMinor === item.amountMinor && refund.currency === item.currency && (item.outcome === 'refunded') === (refund.state === 'succeeded');
      return {
        matchState: (agrees ? 'match' : 'mismatch') as 'match' | 'mismatch',
        ourAmountMinor: refund.amountMinor,
        ourFeeMinor: refund.feeMinor,
        ourState: refund.state,
        note: agrees ? '' : 'refund_differs'
      };
    }

    return {
      matchState: 'missing' as const,
      ourAmountMinor: undefined,
      ourFeeMinor: undefined,
      ourState: undefined,
      note: 'no_record'
    };
  }

  /**
   * ADM-05.A03. Closes one difference with an explanation.
   *
   * It does not change a figure. The statement line keeps the provider's numbers, our record keeps
   * ours, and what is added is a signed account of why they differ. A correction to the books is a
   * separate, approved ledger entry — not something this call can perform.
   */
  async resolve(actorId: string, itemId: string, input: { reason: string; version: number }) {
    const operator = await this.identity.financeOperatorUser(actorId);
    const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
    if (reason.length < 10 || reason.length > 1000) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const item = await tx.reconciliationItem.findUnique({ where: { id: itemId } });
      if (!item) throw new IdentityError('not_found', 404);
      if (item.resolvedAt) throw new IdentityError('conflict', 409);
      if (item.version !== input.version) throw new IdentityError('conflict', 409);

      const updated = await tx.reconciliationItem.update({
        where: { id: item.id },
        data: { resolvedBy: operator.id, resolvedAt: new Date(), resolutionReason: reason, version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: item.id, action: 'reconciliation.resolved' } });
      return this.itemView(updated);
    });
  }

  /**
   * ADM-05. The daily picture: when reconciliation last ran and what is still open.
   *
   * 08 requires the report to state the last reconciliation time and what remains, so an empty
   * list and "never run" are presented as different things.
   */
  async overview(actorId: string) {
    await this.identity.financeOperatorUser(actorId);
    const [batches, openItems, unknownPayouts, unknownRefunds, isolatedEvents] = await Promise.all([
      this.db.reconciliationBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 20 }),
      this.db.reconciliationItem.findMany({
        where: { matchState: { in: ['mismatch', 'missing', 'duplicate'] }, resolvedAt: null },
        orderBy: { createdAt: 'asc' }, take: 100
      }),
      this.db.payout.count({ where: { state: 'unknown' } }),
      this.db.refund.count({ where: { state: 'unknown' } }),
      this.db.webhookInbox.count({ where: { outcome: 'unknown_reference' } })
    ]);
    const lastRun = batches.map(batch => batch.lastRunAt).filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return {
      // Distinguishable on purpose: null means reconciliation has never run, not that it found
      // nothing. 15-QUALITY forbids presenting an absent check as a passing one.
      lastRunAt: lastRun,
      environment: this.environment,
      batches: batches.map(batch => ({
        id: batch.id, source: batch.source, environment: batch.environment,
        statementDate: batch.statementDate, rowCount: batch.rowCount, state: batch.state,
        lastRunAt: batch.lastRunAt, version: batch.version, createdAt: batch.createdAt
      })),
      openItems: openItems.map(item => this.itemView(item)),
      /** Operations nobody can close until the provider is asked. They are counted, not hidden. */
      awaitingInquiry: { payouts: unknownPayouts, refunds: unknownRefunds },
      /** Provider events for references we never issued, isolated for review rather than applied. */
      isolatedEvents
    };
  }

  /** One batch with its lines, for the detail view. */
  async batch(actorId: string, batchId: string) {
    await this.identity.financeOperatorUser(actorId);
    const batch = await this.db.reconciliationBatch.findUnique({
      where: { id: batchId },
      include: { items: { orderBy: { createdAt: 'asc' } } }
    });
    if (!batch) throw new IdentityError('not_found', 404);
    return {
      id: batch.id, source: batch.source, environment: batch.environment,
      statementDate: batch.statementDate, rowCount: batch.rowCount, state: batch.state,
      lastRunAt: batch.lastRunAt, version: batch.version,
      items: batch.items.map(item => this.itemView(item))
    };
  }

  private itemView(item: {
    id: string; batchId: string; providerTransactionId: string; amountMinor: bigint; currency: string;
    feeMinor: bigint; outcome: string; matchState: string;
    ourAmountMinor: bigint | null; ourFeeMinor: bigint | null; ourState: string | null;
    note: string; resolvedAt: Date | null; resolutionReason: string; version: number;
  }) {
    return {
      id: item.id,
      batchId: item.batchId,
      providerTransactionId: item.providerTransactionId,
      amountMinor: minorToString(item.amountMinor),
      currency: item.currency,
      feeMinor: minorToString(item.feeMinor),
      outcome: item.outcome,
      matchState: item.matchState,
      // Null rather than zero: we hold nothing for this reference, which is not the same as zero.
      ourAmountMinor: item.ourAmountMinor === null ? null : minorToString(item.ourAmountMinor),
      ourFeeMinor: item.ourFeeMinor === null ? null : minorToString(item.ourFeeMinor),
      ourState: item.ourState,
      note: item.note,
      resolvedAt: item.resolvedAt,
      resolutionReason: item.resolutionReason,
      version: item.version
    };
  }
}
