import type { DatabaseClient, CorporateEventKind } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { minorToString, parseMinor } from '../projects/money.js';

/**
 * Company reports, distributions and corporate events (BUS-05, PER-09, 06-INVESTMENT-LIFECYCLE).
 *
 * The rules that shape this module:
 *
 *  - **A distribution is computed from a snapshot of the register**, taken when it is proposed, so
 *    an approval applies to the holdings that were actually reviewed.
 *  - **Nothing here edits a holding.** 06 forbids adjusting shares by hand; a corporate event is a
 *    record and a trigger for a process, and a database trigger refuses the edit regardless.
 *  - **No valuation, ever.** A report says what happened. It does not price anybody's stake, because
 *    there is no source for that price.
 */

const KINDS: readonly CorporateEventKind[] = ['report', 'distribution', 'buyback', 'exit', 'loss', 'liquidation'] as const;

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

export class InvestorRelationsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  private async ventureFor(organizationId: string) {
    const venture = await this.db.venture.findUnique({ where: { organizationId } });
    if (!venture) throw new IdentityError('conflict', 409);
    return venture;
  }

  /** BUS-05. Everything the issuer's investor-relations screen shows. */
  async overview(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'organization.read');
    const venture = await this.db.venture.findUnique({ where: { organizationId } });
    if (!venture) {
      // Absent rather than empty: no venture is not a venture with no investors.
      return { hasVenture: false as const, holders: 0, allocatedUnits: '0', reports: [], distributions: [], events: [] };
    }
    const [holdings, reports, distributions, events] = await Promise.all([
      this.db.holding.findMany({ where: { ventureId: venture.id }, select: { units: true, userId: true } }),
      this.db.companyReport.findMany({ where: { ventureId: venture.id }, orderBy: { sequence: 'desc' }, take: 20 }),
      this.db.distribution.findMany({ where: { ventureId: venture.id }, orderBy: { createdAt: 'desc' }, take: 20, include: { _count: { select: { lines: true } } } }),
      this.db.corporateEvent.findMany({ where: { ventureId: venture.id }, orderBy: { effectiveAt: 'desc' }, take: 20 })
    ]);
    const allocatedUnits = holdings.reduce((total, holding) => total + holding.units, 0n);
    return {
      hasVenture: true as const,
      currency: venture.currency,
      currentShares: venture.currentShares.toString(),
      allocatedUnits: allocatedUnits.toString(),
      // Holders, not holdings: one person may hold from more than one offering.
      holders: new Set(holdings.map(holding => holding.userId)).size,
      reports: reports.map(report => ({ id: report.id, sequence: report.sequence, title: report.title, periodStart: report.periodStart, periodEnd: report.periodEnd, publishedAt: report.publishedAt })),
      distributions: distributions.map(distribution => ({
        id: distribution.id, state: distribution.state,
        totalMinor: minorToString(distribution.totalMinor), currency: distribution.currency,
        reason: distribution.reason, snapshotUnits: distribution.snapshotUnits.toString(),
        lineCount: distribution._count.lines, version: distribution.version, createdAt: distribution.createdAt
      })),
      events: events.map(event => ({ id: event.id, kind: event.kind, title: event.title, effectiveAt: event.effectiveAt, documentRef: event.documentRef }))
    };
  }

  /** BUS-05.A01. A report to investors, frozen as a numbered version. */
  async publishReport(actorId: string, organizationId: string, input: { title: string; body: string; periodStart: string; periodEnd: string }) {
    await this.identity.access(actorId, organizationId, 'report.publish');
    const title = text(input.title, 4, 200);
    const body = text(input.body, 50, 20000);
    const periodStart = new Date(input.periodStart);
    const periodEnd = new Date(input.periodEnd);
    if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime()) || periodEnd < periodStart) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const venture = await tx.venture.findUnique({ where: { organizationId } });
      if (!venture) throw new IdentityError('conflict', 409);
      const last = await tx.companyReport.findFirst({ where: { ventureId: venture.id }, orderBy: { sequence: 'desc' } });
      const report = await tx.companyReport.create({
        data: { ventureId: venture.id, sequence: (last?.sequence ?? 0) + 1, title, body, periodStart, periodEnd, publishedBy: actorId }
      });
      // Investors are told a report exists; delivery is decoupled so a failed notification cannot
      // undo a published report.
      await tx.outboxEvent.create({ data: { topic: 'company.report_published', payload: { reportId: report.id } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: report.id, action: 'company.report_published' } });
      return { id: report.id, sequence: report.sequence, title: report.title, publishedAt: report.publishedAt };
    });
  }

  /**
   * BUS-05.A02. Proposes a distribution and computes every holder's line from the register as it
   * stands right now.
   *
   * The arithmetic is integer throughout: each line is `total × units / totalUnits`, truncated, so
   * no line is ever rounded up beyond what the pot holds. Whatever cannot be divided evenly is
   * reported as an undistributed remainder rather than being handed to somebody arbitrarily.
   */
  async proposeDistribution(actorId: string, organizationId: string, input: { totalMinor: string; reason: string }) {
    await this.identity.access(actorId, organizationId, 'payout.request');
    const totalMinor = parseMinor(input.totalMinor);
    const reason = text(input.reason, 10, 1000);

    return this.db.$transaction(async tx => {
      const venture = await tx.venture.findUnique({ where: { organizationId } });
      if (!venture) throw new IdentityError('conflict', 409);
      const holdings = await tx.holding.findMany({ where: { ventureId: venture.id } });
      // A distribution to nobody has no denominator. Refused rather than dividing by zero.
      if (holdings.length === 0) throw new IdentityError('conflict', 409);
      const snapshotUnits = holdings.reduce((total, holding) => total + holding.units, 0n);

      const distribution = await tx.distribution.create({
        data: {
          ventureId: venture.id, totalMinor, currency: venture.currency, reason,
          snapshotUnits, requestedBy: actorId, state: 'requested'
        }
      });
      let allocated = 0n;
      for (const holding of holdings) {
        // Integer division, truncating: nobody is paid a fraction of a minor unit, and the sum of
        // the lines can never exceed the pot.
        const amountMinor = (totalMinor * holding.units) / snapshotUnits;
        allocated += amountMinor;
        await tx.distributionLine.create({ data: { distributionId: distribution.id, holdingId: holding.id, units: holding.units, amountMinor } });
      }
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: distribution.id, action: 'distribution.requested' } });
      return {
        id: distribution.id, state: distribution.state,
        totalMinor: minorToString(totalMinor), currency: venture.currency,
        snapshotUnits: snapshotUnits.toString(), lines: holdings.length,
        // The part that does not divide evenly. Declared, not quietly absorbed or handed out.
        undistributedRemainderMinor: minorToString(totalMinor - allocated),
        version: distribution.version
      };
    });
  }

  /** BUS-05.A03. An independent approval, against the snapshot that was proposed. */
  async approveDistribution(actorId: string, distributionId: string, input: { version: number }) {
    return this.db.$transaction(async tx => {
      const distribution = await tx.distribution.findUnique({ where: { id: distributionId }, include: { venture: true } });
      if (!distribution) throw new IdentityError('not_found', 404);
      const scoped = new InvestorRelationsService(tx as DatabaseClient);
      // Either an organisation approver who did not propose it, or platform finance staff.
      const platformRoles = await scoped.identity.platformRoles(actorId);
      if (!platformRoles.includes('FinanceOperator')) {
        await scoped.identity.access(actorId, distribution.venture.organizationId, 'payout.approve', distribution.requestedBy);
      } else if (actorId === distribution.requestedBy) {
        throw new IdentityError('forbidden', 403);
      }
      if (distribution.state !== 'requested') throw new IdentityError('conflict', 409);
      if (distribution.version !== input.version) throw new IdentityError('conflict', 409);

      // The register must not have moved since the lines were computed, or the approval would
      // apply to a different set of holders than the one that was reviewed.
      const holdings = await tx.holding.findMany({ where: { ventureId: distribution.ventureId }, select: { units: true } });
      const unitsNow = holdings.reduce((total, holding) => total + holding.units, 0n);
      if (unitsNow !== distribution.snapshotUnits) throw new IdentityError('conflict', 409);

      const updated = await tx.distribution.update({
        where: { id: distribution.id },
        data: { state: 'approved', approverId: actorId, approvedAt: new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: distribution.venture.organizationId, resourceId: distribution.id, action: 'distribution.approved' } });
      return { id: updated.id, state: updated.state, version: updated.version };
    });
  }

  /**
   * Marks an approved distribution as paid.
   *
   * In this build no money actually moves to investors: there is no payout rail to a person, only
   * to an organisation's verified bank account (PART-07). The record says `simulated` and the
   * response says so too, rather than implying anybody received anything.
   */
  async markDistributionPaid(actorId: string, distributionId: string, input: { version: number }) {
    await this.identity.financeOperatorUser(actorId);
    return this.db.$transaction(async tx => {
      const distribution = await tx.distribution.findUnique({ where: { id: distributionId } });
      if (!distribution) throw new IdentityError('not_found', 404);
      if (distribution.state !== 'approved') throw new IdentityError('conflict', 409);
      if (distribution.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.distribution.update({ where: { id: distribution.id }, data: { state: 'paid', version: { increment: 1 } } });
      await tx.outboxEvent.create({ data: { topic: 'distribution.paid', payload: { distributionId: distribution.id } } });
      return {
        id: updated.id, state: updated.state, version: updated.version,
        simulated: true,
        /** Said plainly: the record moved, the money did not. */
        note: 'no_investor_payout_rail'
      };
    });
  }

  /** BUS-05.A04. Records a company event from a document. It changes no holding by itself. */
  async recordEvent(actorId: string, organizationId: string, input: { kind: string; title: string; body: string; documentRef?: string | undefined; effectiveAt: string }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    if (!KINDS.includes(input.kind as CorporateEventKind)) throw new IdentityError('invalid_input', 422);
    const effectiveAt = new Date(input.effectiveAt);
    if (Number.isNaN(effectiveAt.getTime())) throw new IdentityError('invalid_input', 422);
    const venture = await this.ventureFor(organizationId);

    const event = await this.db.corporateEvent.create({
      data: {
        ventureId: venture.id, kind: input.kind as CorporateEventKind,
        title: text(input.title, 4, 200), body: text(input.body, 20, 10000),
        documentRef: input.documentRef ? text(input.documentRef, 1, 200) : '',
        effectiveAt, recordedBy: actorId
      }
    });
    await this.db.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: event.id, action: 'corporate.event_recorded' } });
    return {
      id: event.id, kind: event.kind, title: event.title, effectiveAt: event.effectiveAt,
      // 06: an event is a record and a trigger for a process, never an adjustment to the register.
      holdingsChanged: false,
      note: 'recorded_for_review'
    };
  }

  /** PER-09. What an investor may read about a company they hold in. */
  async investorView(actorId: string, ventureId: string) {
    const user = await this.identity.activeUser(actorId);
    const holdings = await this.db.holding.findMany({ where: { ventureId, userId: user.id } });
    // Someone who holds nothing in this company has no investor relations to read.
    if (holdings.length === 0) throw new IdentityError('not_found', 404);

    const [reports, lines, events] = await Promise.all([
      this.db.companyReport.findMany({ where: { ventureId }, orderBy: { sequence: 'desc' }, take: 20 }),
      this.db.distributionLine.findMany({
        where: { holdingId: { in: holdings.map(holding => holding.id) } },
        include: { distribution: { select: { id: true, state: true, reason: true, currency: true, approvedAt: true } } },
        orderBy: { createdAt: 'desc' }, take: 50
      }),
      this.db.corporateEvent.findMany({ where: { ventureId }, orderBy: { effectiveAt: 'desc' }, take: 20 })
    ]);
    return {
      units: holdings.reduce((total, holding) => total + holding.units, 0n).toString(),
      reports: reports.map(report => ({ id: report.id, sequence: report.sequence, title: report.title, body: report.body, periodStart: report.periodStart, periodEnd: report.periodEnd, publishedAt: report.publishedAt })),
      // Only this investor's own lines: another holder's amount is none of their business.
      distributions: lines.map(line => ({
        id: line.id, distributionId: line.distribution.id, state: line.distribution.state,
        reason: line.distribution.reason, amountMinor: minorToString(line.amountMinor),
        currency: line.distribution.currency, approvedAt: line.distribution.approvedAt
      })),
      events: events.map(event => ({ id: event.id, kind: event.kind, title: event.title, body: event.body, effectiveAt: event.effectiveAt })),
      simulated: true
    };
  }
}
