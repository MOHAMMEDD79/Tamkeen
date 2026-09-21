import { Body, Controller, Get, Inject, Param, Post, Req, HttpCode } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { IdentityError } from '../identity/policy.js';
import { PayoutsService } from './payouts.service.js';
import { RefundsService } from './refunds.service.js';
import { ReconciliationService } from './reconciliation.service.js';
import { SimulatedPaymentPort } from './payment-port.js';

const uuid = z.string().uuid();
const minor = z.string().regex(/^[0-9]{1,16}$/);
const version = z.number().int().positive();
const reason = z.string().trim().min(10).max(1000);

/**
 * PART-07: money leaving a pool, money going back, and checking both against the provider.
 *
 * The split of authority is the point. An organisation requests and approves a disbursement; the
 * platform executes it. Neither side can do the other's half, and the routes are grouped that way:
 * `/orgs/...` and `/payouts/...` for the organisation, `/admin/...` for platform finance.
 */
@Controller()
export class DisbursementsController {
  private readonly port: SimulatedPaymentPort;
  private readonly payouts: PayoutsService;
  private readonly refunds: RefundsService;
  private readonly reconciliation: ReconciliationService;

  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) {
    this.port = new SimulatedPaymentPort(runtime.config.sessionSecret, runtime.db);
    this.payouts = new PayoutsService(runtime.db, this.port);
    this.refunds = new RefundsService(runtime.db, this.port);
    this.reconciliation = new ReconciliationService(runtime.db, runtime.config.environment);
  }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  private demoOnly() {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new IdentityError('forbidden', 403);
  }

  // ---- ORG-11 / ORG-12: the organisation asks and approves -------------------------------------

  @Get('orgs/:id/payouts') async list(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.payouts.list(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/payouts') async request(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      projectId: uuid,
      milestoneId: uuid.nullable().optional(),
      amountMinor: minor,
      reason,
      invoiceReference: z.string().trim().max(120).optional()
    }).strict().parse(body);
    return { data: await this.payouts.request(session.user.id, uuid.parse(id), input) };
  }

  @Get('payouts/:id') async get(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.payouts.get(session.user.id, uuid.parse(id)) };
  }

  /**
   * ORG-12.A01. The body carries the request hash the approver was shown, so an approval can only
   * ever apply to the request that was actually on screen.
   */
  @Post('payouts/:id/approve') async approve(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ requestHash: z.string().regex(/^[0-9a-f]{64}$/), version }).strict().parse(body);
    return { data: await this.payouts.approve(session.user.id, uuid.parse(id), input) };
  }

  @Post('payouts/:id/reject') async reject(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, version }).strict().parse(body);
    return { data: await this.payouts.reject(session.user.id, uuid.parse(id), input) };
  }

  @Post('payouts/:id/withdraw') async withdraw(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.payouts.withdraw(session.user.id, uuid.parse(id), input) };
  }

  // ---- Refunds: requested by the contributor or the organisation, approved independently --------

  @Get('contributions/:id/refunds') async listRefunds(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.refunds.listForContribution(session.user.id, uuid.parse(id)) };
  }

  @Post('contributions/:id/refund-requests') async requestRefund(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ amountMinor: minor, reason, feeCoveredByPool: z.boolean().optional() }).strict().parse(body);
    return { data: await this.refunds.request(session.user.id, uuid.parse(id), input) };
  }

  @Post('refunds/:id/approve') async approveRefund(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.refunds.approve(session.user.id, uuid.parse(id), input) };
  }

  @Post('refunds/:id/reject') async rejectRefund(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, version }).strict().parse(body);
    return { data: await this.refunds.reject(session.user.id, uuid.parse(id), input) };
  }

  // ---- ADM-05 / ADM-06: the platform executes and checks ----------------------------------------

  @Get('admin/finance') async financeCentre(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    const [reconciliation, payoutQueue, refundQueue] = await Promise.all([
      this.reconciliation.overview(session.user.id),
      this.payouts.operationsQueue(session.user.id),
      this.refunds.operationsQueue(session.user.id)
    ]);
    return { data: { reconciliation, payouts: payoutQueue, refunds: refundQueue.refunds, disputes: refundQueue.disputes } };
  }

  @Post('admin/reconciliation/imports') async importStatement(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      source: z.string().trim().min(1).max(40),
      statementDate: z.string().min(4),
      rows: z.array(z.object({
        providerTransactionId: z.string().trim().min(1).max(120),
        amountMinor: minor,
        currency: z.string().regex(/^[A-Za-z]{3}$/),
        feeMinor: minor.optional(),
        outcome: z.string().trim().min(1).max(20)
      }).strict()).min(1).max(5000)
    }).strict().parse(body);
    return { data: await this.reconciliation.import(session.user.id, input) };
  }

  @Get('admin/reconciliation/:id') async batch(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.reconciliation.batch(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/reconciliation/:id/run')
  @HttpCode(200)
  async runBatch(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.reconciliation.run(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/reconciliation/items/:id/resolutions') async resolveItem(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, version }).strict().parse(body);
    return { data: await this.reconciliation.resolve(session.user.id, uuid.parse(id), input) };
  }

  @Post('admin/payouts/:id/execute') async executePayout(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.payouts.execute(session.user.id, uuid.parse(id), input) };
  }

  /**
   * ADM-06.A04 / ADM-05.A04. Asks the provider what happened. This is the only way out of
   * `unknown`: 08 forbids re-sending an instruction whose outcome we do not know, because the
   * failure mode of a blind retry is paying the same money twice.
   */
  @Post('admin/payouts/:id/inquire')
  @HttpCode(200)
  async inquirePayout(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.payouts.inquire(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/refunds/:id/execute') async executeRefund(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.refunds.execute(session.user.id, uuid.parse(id), input) };
  }

  @Post('admin/refunds/:id/inquire')
  @HttpCode(200)
  async inquireRefund(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.refunds.inquire(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/contributions/:id/disputes') async openDispute(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ amountMinor: minor, reason, coveragePlan: z.string().trim().max(2000).optional() }).strict().parse(body);
    return { data: await this.refunds.openDispute(session.user.id, uuid.parse(id), input) };
  }

  @Post('admin/disputes/:id/resolve') async resolveDispute(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ outcome: z.enum(['lost', 'won', 'withdrawn']), reason, version }).strict().parse(body);
    return { data: await this.refunds.resolveDispute(session.user.id, uuid.parse(id), input) };
  }

  // ---- Demo only: the simulated provider's own verdict ------------------------------------------

  /**
   * Stands in for the provider deciding what happened to a disbursement. It writes to the
   * simulator's own store, which is deliberately not our record: an inquiry has to ask a different
   * system than ours, or it proves nothing. Choosing `unknown` writes a `pending` provider answer
   * and leaves our side blocked, which is exactly the FIN-04 case an operator needs to practise.
   */
  @Post('payments/simulate/payout/:id')
  @HttpCode(200)
  async simulatePayout(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    this.demoOnly();
    await this.runtime.db.user.findUniqueOrThrow({ where: { id: session.user.id } });
    const input = z.object({ outcome: z.enum(['paid', 'failed', 'unknown']), tellProvider: z.enum(['paid', 'failed', 'pending']).optional() }).strict().parse(body);
    const payout = await this.runtime.db.payout.findUnique({ where: { id: uuid.parse(id) } });
    if (!payout?.providerReference) throw new IdentityError('not_found', 404);

    // The provider's own answer, which may deliberately differ from what reached us.
    const providerAnswer = input.tellProvider ?? (input.outcome === 'unknown' ? 'pending' : input.outcome);
    await this.port.recordProviderTruth('payout', payout.providerReference, providerAnswer,
      providerAnswer === 'paid' ? `${this.port.name}:proof:${payout.providerReference}` : undefined);

    return { data: await this.payouts.recordProviderOutcome(payout.id, { result: input.outcome }) };
  }

  @Post('payments/simulate/refund/:id')
  @HttpCode(200)
  async simulateRefund(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    await this.session(req);
    this.demoOnly();
    const input = z.object({ outcome: z.enum(['succeeded', 'failed', 'unknown']), tellProvider: z.enum(['succeeded', 'failed', 'pending']).optional() }).strict().parse(body);
    const refund = await this.runtime.db.refund.findUnique({ where: { id: uuid.parse(id) } });
    if (!refund?.providerReference) throw new IdentityError('not_found', 404);
    const providerAnswer = input.tellProvider ?? (input.outcome === 'unknown' ? 'pending' : input.outcome);
    await this.port.recordProviderTruth('refund', refund.providerReference, providerAnswer);
    return { data: await this.refunds.recordProviderOutcome(refund.id, { result: input.outcome }) };
  }
}
