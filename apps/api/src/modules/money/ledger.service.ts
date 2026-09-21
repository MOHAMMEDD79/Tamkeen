import type { DatabaseClient, LedgerAccountType } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { minorToString } from '../projects/money.js';

/**
 * The double-entry ledger (08-FINANCIAL-SYSTEM).
 *
 * Every balance the product shows is derived from these entries. Nothing here stores a running
 * total: a cached balance is a second source of truth, and the first thing to go wrong. The
 * ledger is append-only in SQL, so a mistake is corrected by a reversing transaction that points
 * at the original, never by an edit.
 */

/** The chart of accounts for a charity pool (08). */
export const ACCOUNT_CODES = {
  /** Money the provider holds on our behalf, before settlement. */
  providerClearing: { code: 'ProviderClearing', type: 'asset' as LedgerAccountType },
  /** Money actually in the bank after settlement. */
  bankCash: { code: 'BankCash', type: 'asset' as LedgerAccountType },
  /** What we owe the project: restricted funds, not platform income. */
  restrictedFunds: { code: 'RestrictedFundsLiability', type: 'liability' as LedgerAccountType },
  /**
   * Processor fees the platform absorbs. Under the declared policy the pool bears the fee instead,
   * so settlement reduces the restricted liability directly (08's worked table) and this account
   * stays at zero. It exists because the fee-bearer is a launch decision, and the day the platform
   * absorbs a fee it must land somewhere that is visibly not the project's money.
   */
  processorFee: { code: 'ProcessorFeeExpense', type: 'expense' as LedgerAccountType },
  /** Refunds owed but not yet executed. */
  refundPayable: { code: 'RefundPayable', type: 'liability' as LedgerAccountType },
  /** Approved disbursements not yet paid. A reservation is a transfer of obligation, not a payment. */
  payoutPayable: { code: 'PayoutPayable', type: 'liability' as LedgerAccountType },
  /**
   * A chargeback after the money was already disbursed. 08 forbids forcing the balance to zero,
   * so the shortfall is carried here as an explicit obligation with a coverage plan behind it.
   */
  disputeReserve: { code: 'DisputeReserve', type: 'liability' as LedgerAccountType },
  /**
   * Money the platform itself put into a pool (PART-09).
   *
   * An offering escrow must be able to return every subscriber the amount their contract names, so
   * the processor fee cannot come out of what is owed to them. The platform funds that gap, and
   * this account is where it lands: visibly not the investors' money, and never folded into it.
   */
  platformFunding: { code: 'PlatformFundingLiability', type: 'liability' as LedgerAccountType }
} as const;

export type AccountKey = keyof typeof ACCOUNT_CODES;

export interface PostingLine { account: AccountKey; debit?: bigint; credit?: bigint }

export interface PoolBalances {
  currency: string;
  /** Confirmed receipts minus confirmed refunds. What the campaign has actually raised. */
  netConfirmedMinor: string;
  /** Settled money, minus fees and active holds. Deliberately not equal to the line above (05). */
  availableMinor: string;
  grossReceivedMinor: string;
  /** Processor fees charged, whoever bore them. The project report states this, not the net. */
  feesMinor: string;
  /** Non-zero only where the platform absorbed a fee instead of charging it to the pool. */
  feesAbsorbedByPlatformMinor: string;
  /** Money actually returned to contributors, not money a refund has merely been approved for. */
  refundedMinor: string;
  /** Approved refunds holding cash that is therefore no longer available to spend. */
  refundsPendingMinor: string;
  heldMinor: string;
  inProviderClearingMinor: string;
  /**
   * Owed to the project’s declared purpose. A liability, never income.
   *
   * Under the declared fee policy this tracks spendable money: reserving a payout moves the
   * obligation from here to payout payable, so once everything has settled `restrictedMinor` and
   * `availableMinor` are the same figure seen from the two sides of the books.
   */
  restrictedMinor: string;
  /** Money owed back on a chargeback that the pool can no longer cover from its own cash. */
  disputedMinor: string;
  /** What the platform has put into this pool out of its own funds, rather than a contributor. */
  platformFundedMinor: string;
  /**
   * Set when the pool owes more than it holds. 08 forbids hiding this by clamping a balance, so it
   * is reported as its own figure and the caller must show it rather than round it away.
   */
  shortfallMinor: string;
}

export class LedgerService {
  constructor(private readonly db: DatabaseClient) {}

  /** Creates the pool and its chart of accounts. Idempotent: a pool is created once per project. */
  async ensurePool(tx: DatabaseClient, projectId: string, currency: string) {
    const existing = await tx.fundingPool.findUnique({ where: { projectId_kind: { projectId, kind: 'charity_campaign' } } });
    if (existing) {
      // A pool holds one currency only; money in different currencies is never added (08).
      if (existing.currency !== currency) throw new IdentityError('conflict', 409);
      return existing;
    }
    const pool = await tx.fundingPool.create({ data: { projectId, kind: 'charity_campaign', currency } });
    await this.createAccounts(tx, pool.id, currency);
    return pool;
  }

  /**
   * Gives a pool its chart of accounts. Separate from `ensurePool` because PART-09's offering
   * escrow is created by its own module but must have exactly the same accounts: one chart, so a
   * balance means the same thing whichever kind of pool it belongs to.
   */
  async createAccounts(tx: DatabaseClient, poolId: string, currency: string) {
    await tx.ledgerAccount.createMany({
      data: Object.values(ACCOUNT_CODES).map(account => ({ poolId, code: account.code, type: account.type, currency }))
    });
  }

  /**
   * Posts one balanced transaction.
   *
   * `sourceType`/`sourceId` are unique together, which is what makes a replayed provider event a
   * no-op rather than a second set of entries (FIN-01). A caller that races itself gets a conflict
   * from the database, not a duplicate posting.
   */
  async post(tx: DatabaseClient, input: { poolId: string; currency: string; sourceType: string; sourceId: string; reversalOf?: string; lines: PostingLine[] }) {
    const debits = input.lines.reduce((total, line) => total + (line.debit ?? 0n), 0n);
    const credits = input.lines.reduce((total, line) => total + (line.credit ?? 0n), 0n);
    // Checked here for a clear error, and again by a deferred constraint trigger at COMMIT.
    if (debits !== credits || debits === 0n) throw new IdentityError('invalid_input', 422);

    const accounts = await tx.ledgerAccount.findMany({ where: { poolId: input.poolId } });
    const byCode = new Map(accounts.map(account => [account.code, account.id]));

    const transaction = await tx.ledgerTransaction.create({
      data: {
        poolId: input.poolId, currency: input.currency,
        sourceType: input.sourceType, sourceId: input.sourceId,
        ...(input.reversalOf ? { reversalOf: input.reversalOf } : {})
      }
    });
    await tx.ledgerEntry.createMany({
      data: input.lines.map(line => {
        const accountId = byCode.get(ACCOUNT_CODES[line.account].code);
        if (!accountId) throw new IdentityError('invalid_input', 422);
        return { transactionId: transaction.id, accountId, debitMinor: line.debit ?? 0n, creditMinor: line.credit ?? 0n };
      })
    });
    return transaction;
  }

  /** True when this business event has already been posted, so a replay can stop early. */
  async alreadyPosted(tx: DatabaseClient, sourceType: string, sourceId: string) {
    return Boolean(await tx.ledgerTransaction.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId } } }));
  }

  /**
   * Derives every balance from the entries, in SQL, with no cached column anywhere.
   *
   * This is what FIN-06 rebuilds: because nothing is stored, "rebuilding the projection" and
   * "reading it" are the same operation and cannot disagree.
   */
  async balances(poolId: string, client: DatabaseClient = this.db): Promise<PoolBalances> {
    const pool = await client.fundingPool.findUnique({ where: { id: poolId } });
    if (!pool) throw new IdentityError('not_found', 404);
    const rows = await client.$queryRaw<Array<{ code: string; debit: bigint | null; credit: bigint | null }>>`
      SELECT a."code" AS code,
             COALESCE(SUM(e."debit_minor"), 0) AS debit,
             COALESCE(SUM(e."credit_minor"), 0) AS credit
      FROM "ledger_accounts" a
      LEFT JOIN "ledger_entries" e ON e."account_id" = a."id"
      WHERE a."pool_id" = ${poolId}::uuid
      GROUP BY a."code"
    `;
    const totals = new Map(rows.map(row => [row.code, { debit: BigInt(row.debit ?? 0), credit: BigInt(row.credit ?? 0) }]));
    const side = (code: string) => totals.get(code) ?? { debit: 0n, credit: 0n };

    // Asset accounts carry a debit balance; liability and revenue carry a credit balance.
    const providerClearing = side(ACCOUNT_CODES.providerClearing.code);
    const bankCash = side(ACCOUNT_CODES.bankCash.code);
    const restricted = side(ACCOUNT_CODES.restrictedFunds.code);
    const fee = side(ACCOUNT_CODES.processorFee.code);
    const disputed = side(ACCOUNT_CODES.disputeReserve.code);
    const refundPayable = side(ACCOUNT_CODES.refundPayable.code);
    const payoutPayable = side(ACCOUNT_CODES.payoutPayable.code);
    const platformFunding = side(ACCOUNT_CODES.platformFunding.code);

    const grossReceived = providerClearing.debit;
    // Fees charged, whoever ends up bearing them. Under the declared policy the pool bears the fee,
    // so the expense is charged straight back to restricted funds and the net expense is zero; the
    // gross debit is what the project report must state, not the net.
    const feesCharged = fee.debit;
    const feesAbsorbed = fee.debit - fee.credit;
    // A refund is reserved when it is approved (credit) and cleared when it is executed (debit),
    // so money actually returned is the debit side. Counting the credit would report a refund that
    // has only been promised as one that has been paid.
    const refunded = refundPayable.debit;
    const refundsPending = refundPayable.credit - refundPayable.debit;
    const held = payoutPayable.credit - payoutPayable.debit;
    const cash = bankCash.debit - bankCash.credit;
    const restrictedBalance = restricted.credit - restricted.debit;
    const disputedBalance = disputed.credit - disputed.debit;
    const available = cash - held - refundsPending;

    return {
      currency: pool.currency,
      grossReceivedMinor: minorToString(grossReceived),
      feesMinor: minorToString(feesCharged),
      feesAbsorbedByPlatformMinor: minorToString(feesAbsorbed),
      refundedMinor: minorToString(refunded),
      refundsPendingMinor: minorToString(refundsPending),
      // 14-ANALYTICS: net confirmed funding is gross confirmed minus confirmed refunds.
      netConfirmedMinor: minorToString(grossReceived - refunded),
      // Available is settled cash minus what is already promised out, to a payout or to a refund.
      // It is not net funding, and 05 requires both to be shown rather than treated as one number.
      availableMinor: minorToString(available),
      heldMinor: minorToString(held),
      inProviderClearingMinor: minorToString(providerClearing.debit - providerClearing.credit),
      // What the pool still owes to the project's declared purpose. 05 treats restricted funds as a
      // liability rather than as income, so it is reported next to cash and never folded into it.
      restrictedMinor: minorToString(restrictedBalance),
      disputedMinor: minorToString(disputedBalance),
      // Stated on its own, so that cash a pool holds because the platform paid for it is never
      // read as money a contributor or subscriber put in.
      platformFundedMinor: minorToString(platformFunding.credit - platformFunding.debit),
      // 08 forbids forcing a balance to zero. When a chargeback lands after the money was already
      // disbursed the pool owes more than it holds, and that gap is reported rather than hidden.
      shortfallMinor: minorToString(disputedBalance > cash - held ? disputedBalance - (cash - held) : 0n)
    };
  }

  /**
   * Proves the whole pool balances: total debits equal total credits across every transaction.
   * A ledger that fails this is not a reporting problem, it is a corrupt record.
   */
  async isBalanced(poolId: string, client: DatabaseClient = this.db): Promise<boolean> {
    const [row] = await client.$queryRaw<Array<{ debit: bigint | null; credit: bigint | null }>>`
      SELECT COALESCE(SUM(e."debit_minor"), 0) AS debit, COALESCE(SUM(e."credit_minor"), 0) AS credit
      FROM "ledger_entries" e
      JOIN "ledger_accounts" a ON a."id" = e."account_id"
      WHERE a."pool_id" = ${poolId}::uuid
    `;
    return BigInt(row?.debit ?? 0) === BigInt(row?.credit ?? 0);
  }

  /** The entry-level journal an organisation's finance reader sees (ORG-10). */
  async journal(poolId: string, client: DatabaseClient = this.db) {
    const transactions = await client.ledgerTransaction.findMany({
      where: { poolId },
      include: { entries: { include: { account: { select: { code: true, type: true } } } } },
      orderBy: { postedAt: 'asc' },
      take: 200
    });
    return transactions.map(transaction => ({
      id: transaction.id,
      sourceType: transaction.sourceType,
      sourceId: transaction.sourceId,
      reversalOf: transaction.reversalOf,
      postedAt: transaction.postedAt,
      currency: transaction.currency,
      entries: transaction.entries.map(entry => ({
        account: entry.account.code,
        type: entry.account.type,
        debitMinor: minorToString(entry.debitMinor),
        creditMinor: minorToString(entry.creditMinor)
      }))
    }));
  }
}
