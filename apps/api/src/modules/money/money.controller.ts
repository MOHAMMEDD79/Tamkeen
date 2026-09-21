import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Query, Req, HttpCode } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { IdentityError } from '../identity/policy.js';
import { ContributionsService } from './contributions.service.js';
import { SimulatedPaymentPort } from './payment-port.js';

const uuid = z.string().uuid();
const minor = z.string().regex(/^[0-9]{1,16}$/);

/**
 * The money surface. Writes require a session, a matching origin and — for the contribution
 * itself — an Idempotency-Key, because a retried checkout must never become a second charge.
 *
 * The webhook route is the one exception to the session rule: it is authenticated by the
 * provider's signature over the raw body, not by a cookie.
 */
@Controller()
export class MoneyController {
  private readonly service: ContributionsService;
  private readonly port: SimulatedPaymentPort;
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) {
    this.port = new SimulatedPaymentPort(runtime.config.sessionSecret);
    this.service = new ContributionsService(runtime.db, this.port);
  }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  // ---- public ---------------------------------------------------------------------------------

  @Get('projects/:slug/contributors') async contributors(@Param('slug') slug: string) {
    return { data: await this.service.publicContributors(slug) };
  }

  @Get('projects/:slug/quote') async quote(@Param('slug') slug: string, @Query('amountMinor') amountMinor: string) {
    return { data: await this.service.quote(slug, minor.parse(amountMinor)) };
  }

  // ---- contributor ----------------------------------------------------------------------------

  @Post('contributions') async contribute(@Req() req: IncomingMessage, @Headers('idempotency-key') key: string | undefined, @Body() body: unknown) {
    const session = await this.session(req);
    // 11-API-CONTRACTS: every financial mutation carries an Idempotency-Key.
    if (!key) throw new IdentityError('invalid_input', 422);
    const input = z.object({
      projectSlug: z.string().trim().min(1).max(120),
      amountMinor: minor,
      visibility: z.enum(['named', 'anonymous']),
      showAmountPublicly: z.boolean(),
      // The browser echoes the fee it displayed; the server recomputes and refuses a stale quote.
      acceptedQuoteFeeMinor: minor
    }).strict().parse(body);
    return { data: await this.service.createContribution(session.user.id, key, input) };
  }

  @Get('me/contributions') async myContributions(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.myContributions(session.user.id) };
  }

  @Get('contributions/:id/receipt') async receipt(@Req() req: IncomingMessage, @Param('id') id: string) { const session = await this.session(req); return { data: await this.service.receipt(session.user.id, uuid.parse(id)) }; }

  @Patch('me/contributions/:id/privacy') async updatePrivacy(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ visibility: z.enum(['named', 'anonymous']), showAmountPublicly: z.boolean(), version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.updatePrivacy(session.user.id, uuid.parse(id), input) };
  }

  @Get('payment-intents/:id/status') async intentStatus(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.intentStatus(session.user.id, uuid.parse(id)) };
  }

  // ---- organisation ---------------------------------------------------------------------------

  @Get('orgs/:id/projects/:projectId/finance') async finance(@Req() req: IncomingMessage, @Param('id') id: string, @Param('projectId') projectId: string) {
    const session = await this.session(req);
    return { data: await this.service.organizationFinance(session.user.id, uuid.parse(id), uuid.parse(projectId)) };
  }

  // ---- provider -------------------------------------------------------------------------------

  /**
   * 08's webhook protocol. The signature is verified over the exact bytes received, before any
   * parsing is trusted, and a duplicate event id is acknowledged without being processed again.
   * Acknowledgement is always 200 once the event is durably recorded, so the provider does not
   * retry forever over a processing decision.
   */
  @Post('webhooks/payments/simulator')
  @HttpCode(200)
  async webhook(@Req() req: IncomingMessage, @Headers('x-provider-signature') signature: string | undefined, @Headers('x-provider-timestamp') timestamp: string | undefined, @Body() body: unknown) {
    const rawBody = JSON.stringify(body ?? null);
    if (!signature || !timestamp || !this.port.verifyWebhook({ rawBody, signature, timestamp })) {
      // An unverified caller learns nothing about whether the reference exists.
      throw new IdentityError('forbidden', 403);
    }
    const event = this.port.parseEvent(body);
    if (!event) throw new IdentityError('invalid_input', 422);
    return { data: await this.service.receiveProviderEvent(event, body) };
  }

  /**
   * The local simulate page posts here to make a payment succeed, fail or settle. It exists only
   * because there is no real gateway; it signs an event and feeds it through the same webhook path,
   * so the confirmation route under test is the production one.
   *
   * `settled` is a separate choice rather than something `succeeded` does on its own, because 08 is
   * explicit that receiving money is not the same as being able to spend it: a real provider says
   * so hours or days later, and a build that collapsed the two would let a payout be made against
   * money that has not arrived.
   */
  @Post('payments/simulate/:providerReference')
  @HttpCode(200)
  async simulate(@Req() req: IncomingMessage, @Param('providerReference') providerReference: string, @Body() body: unknown) {
    await this.session(req);
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new IdentityError('forbidden', 403);
    const input = z.object({ outcome: z.enum(['succeeded', 'failed', 'settled']) }).strict().parse(body);
    const intent = await this.runtime.db.paymentIntent.findUnique({ where: { provider_providerReference: { provider: this.port.name, providerReference } } });
    if (!intent) throw new IdentityError('not_found', 404);
    const event = this.port.buildSignedEvent({
      eventType: input.outcome === 'succeeded' ? 'payment.succeeded' : input.outcome === 'settled' ? 'payment.settled' : 'payment.failed',
      providerReference,
      amountMinor: intent.amountMinor,
      currency: intent.currency,
      occurredAt: new Date()
    });
    const parsed = this.port.parseEvent(event.body);
    if (!parsed) throw new IdentityError('invalid_input', 422);
    const outcome = await this.service.receiveProviderEvent(parsed, event.body);
    // The intent id goes back so the page can send the payer to the result screen, which is where
    // a real provider would redirect them. The result screen still reads the state from our record.
    return { data: { ...outcome, paymentIntentId: intent.id } };
  }
}
