import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req, HttpCode, StreamableFile } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { OfferingsService } from './offerings.service.js';
import { EligibilityService } from './eligibility.service.js';
import { DataRoomService } from './dataroom.service.js';
import { CommitmentsService } from './commitments.service.js';
import { AllocationsService } from './allocations.service.js';
import { InvestorRelationsService } from './investor-relations.service.js';
import { SimulatedPaymentPort } from '../money/payment-port.js';

const uuid = z.string().uuid();
const minor = z.string().regex(/^[0-9]{1,16}$/);
const version = z.number().int().positive();
const reason = z.string().trim().min(10).max(1000);

const offeringInput = z.object({
  title: z.string().trim().min(4).max(200),
  currency: z.string().regex(/^[A-Za-z]{3}$/),
  sharesOffered: minor,
  pricePerShareMinor: minor,
  minimumRaiseMinor: minor,
  minimumTicketMinor: minor,
  maximumTicketMinor: minor.nullable().optional(),
  useOfFunds: z.string().trim().min(20).max(4000),
  oversubscriptionPolicy: z.enum(['reject', 'pro_rata']).optional(),
  requiresEligibility: z.boolean().optional(),
  requiresNda: z.boolean().optional(),
  closesAt: z.string().min(4).nullable().optional()
}).strict();

const eligibilityAnswers = z.object({
  investorType: z.enum(['individual', 'institution']),
  hasPriorExperience: z.boolean(),
  acknowledgesTotalLossRisk: z.boolean(),
  declaration: z.string().trim().min(20).max(2000)
}).strict();

/**
 * PART-08: offerings, disclosures, eligibility and the data room.
 *
 * The route prefixes follow who decides. `/orgs/...` is the issuer running its own offering,
 * `/offerings/...` is what an investor can reach, and `/admin/...` is the independent reviewer.
 * Nothing in this controller takes money: commitments and allocations are PART-09, and the public
 * offering DTO says so rather than leaving a subscribe button that would fail.
 */
@Controller()
export class InvestmentController {
  private readonly offerings: OfferingsService;
  private readonly eligibility: EligibilityService;
  private readonly dataRoom: DataRoomService;
  private readonly commitments: CommitmentsService;
  private readonly allocations: AllocationsService;
  private readonly relations: InvestorRelationsService;

  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) {
    this.offerings = new OfferingsService(runtime.db);
    this.eligibility = new EligibilityService(runtime.db);
    this.dataRoom = new DataRoomService(runtime.db);
    // The same port the charity payments use, so a subscription goes through one webhook path.
    const port = new SimulatedPaymentPort(runtime.config.sessionSecret, runtime.db);
    this.commitments = new CommitmentsService(runtime.db, port);
    this.allocations = new AllocationsService(runtime.db);
    this.relations = new InvestorRelationsService(runtime.db);
  }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  // ---- PUB-07 / PUB-08: public ------------------------------------------------------------------

  @Get('offerings') async browse(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const page = await this.offerings.browse({
      ...(cursor ? { cursor: uuid.parse(cursor) } : {}),
      ...(limit ? { limit: Number(limit) } : {})
    });
    return { data: page.items, page: { nextCursor: page.nextCursor, hasMore: page.hasMore } };
  }

  @Get('offerings/:slug') async publicOffering(@Param('slug') slug: string) {
    return { data: await this.offerings.publicOffering(slug) };
  }

  @Get('offerings/:slug/quote') async quote(@Param('slug') slug: string, @Query('amountMinor') amountMinor: string) {
    return { data: await this.offerings.quote(slug, minor.parse(amountMinor)) };
  }

  @Post('offerings/:slug/interests') async interest(@Req() req: IncomingMessage, @Param('slug') slug: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ indicativeAmountMinor: minor.nullable().optional() }).strict().parse(body);
    return { data: await this.offerings.registerInterest(session.user.id, slug, input) };
  }

  // ---- PER-07: the investor's own eligibility ---------------------------------------------------

  @Get('me/investor-eligibility') async myEligibility(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.eligibility.mine(session.user.id) };
  }

  @Patch('me/investor-eligibility') async saveEligibilityDraft(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.eligibility.saveDraft(session.user.id, eligibilityAnswers.parse(body)) };
  }

  @Post('me/investor-eligibility/submissions') async submitEligibility(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.eligibility.submit(session.user.id, eligibilityAnswers.parse(body)) };
  }

  // ---- The data room, from the investor's side --------------------------------------------------

  @Get('offerings/:id/dataroom') async dataroom(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.dataRoom.read(session.user.id, uuid.parse(id)) };
  }

  @Get('dataroom-documents/:id/download') async downloadDocument(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    const file = await this.dataRoom.download(session.user.id, uuid.parse(id));
    return new StreamableFile(file.bytes, { type: file.contentType, disposition: `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}` });
  }

  @Post('offerings/:id/access-requests') async requestAccess(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason }).strict().parse(body);
    return { data: await this.dataRoom.requestAccess(session.user.id, uuid.parse(id), input.reason) };
  }

  @Post('offerings/:id/nda-acceptances') async acceptNda(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ disclosureId: uuid, checksum: z.string().regex(/^[0-9a-f]{64}$/) }).strict().parse(body);
    return { data: await this.dataRoom.acceptNda(session.user.id, uuid.parse(id), input) };
  }

  @Get('offerings/:id/nda-acceptances') async myAcceptances(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.dataRoom.myAcceptances(session.user.id, uuid.parse(id)) };
  }

  @Get('offerings/:id/questions') async questions(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.dataRoom.questions(session.user.id, uuid.parse(id)) };
  }

  @Post('offerings/:id/questions') async ask(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ body: z.string().trim().min(10).max(2000) }).strict().parse(body);
    return { data: await this.dataRoom.ask(session.user.id, uuid.parse(id), input.body) };
  }

  @Post('investor-questions/:id/replies') async reply(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ body: z.string().trim().min(10).max(4000) }).strict().parse(body);
    return { data: await this.dataRoom.reply(session.user.id, uuid.parse(id), input.body) };
  }

  // ---- BUS-01 / BUS-02 / BUS-03: the issuer -----------------------------------------------------

  @Get('orgs/:id/venture') async venture(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.offerings.venture(session.user.id, uuid.parse(id)) };
  }

  @Put('orgs/:id/venture') async saveVenture(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      legalName: z.string().trim().min(2).max(200),
      summary: z.string().trim().min(30).max(2000),
      currentShares: minor,
      currency: z.string().regex(/^[A-Za-z]{3}$/),
      version: version.optional()
    }).strict().parse(body);
    return { data: await this.offerings.saveVenture(session.user.id, uuid.parse(id), input) };
  }

  @Get('orgs/:id/offerings') async list(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.offerings.listForOrganization(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/offerings') async create(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.offerings.create(session.user.id, uuid.parse(id), offeringInput.parse(body)) };
  }

  @Get('orgs/:id/offerings/:oid') async get(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.offerings.getForOrganization(session.user.id, uuid.parse(id), uuid.parse(oid)) };
  }

  @Patch('orgs/:id/offerings/:oid') async update(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = offeringInput.extend({ version }).parse(body);
    return { data: await this.offerings.update(session.user.id, uuid.parse(id), uuid.parse(oid), input) };
  }

  @Post('orgs/:id/offerings/:oid/validate')
  @HttpCode(200)
  async validate(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.offerings.validate(session.user.id, uuid.parse(id), uuid.parse(oid)) };
  }

  @Post('orgs/:id/offerings/:oid/disclosure-revisions') async addDisclosure(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      summary: z.string().trim().min(50).max(4000),
      risks: z.string().trim().min(20).max(6000),
      useOfFunds: z.string().trim().min(20).max(4000),
      material: z.boolean().optional(),
      reason: z.string().trim().max(1000).optional(),
      version
    }).strict().parse(body);
    return { data: await this.offerings.addDisclosure(session.user.id, uuid.parse(id), uuid.parse(oid), input) };
  }

  @Post('orgs/:id/offerings/:oid/submit') async submit(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.offerings.submit(session.user.id, uuid.parse(id), uuid.parse(oid), input.version) };
  }

  @Post('orgs/:id/offerings/:oid/open') async open(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.offerings.open(session.user.id, uuid.parse(id), uuid.parse(oid), input.version) };
  }

  @Post('orgs/:id/offerings/:oid/close') async close(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.offerings.close(session.user.id, uuid.parse(id), uuid.parse(oid), input.version) };
  }

  @Post('orgs/:id/offerings/:oid/documents') async addDocument(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      title: z.string().trim().min(2).max(200),
      category: z.enum(['company_profile', 'historical_performance', 'use_of_funds', 'current_ownership', 'contracts', 'risks', 'due_diligence_report']),
      classification: z.enum(['public', 'nda', 'granted']),
      checksum: z.string().regex(/^[0-9a-f]{64}$/),
      byteSize: z.number().int().positive().max(50_000_000),
      contentType: z.string().trim().min(3).max(100),
      supersedesId: uuid.nullable().optional()
    }).strict().parse(body);
    return { data: await this.dataRoom.addDocument(session.user.id, uuid.parse(id), uuid.parse(oid), input) };
  }

  @Post('orgs/:id/offerings/:oid/documents/upload-intents') async createDocumentUpload(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ title: z.string().trim().min(2).max(200), category: z.enum(['company_profile', 'historical_performance', 'use_of_funds', 'current_ownership', 'contracts', 'risks', 'due_diligence_report']), classification: z.enum(['public', 'nda', 'granted']), fileName: z.string().min(1).max(255), contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']), size: z.number().int().positive(), supersedesId: uuid.nullable().optional() }).strict().parse(body);
    return { data: await this.dataRoom.createUploadIntent(session.user.id, uuid.parse(id), uuid.parse(oid), input) };
  }

  @Put('orgs/:id/offerings/:oid/documents/:documentId/content') async uploadDocument(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Param('documentId') documentId: string) {
    const session = await this.session(req);
    const token = String(req.headers['x-upload-token'] ?? '');
    return { data: await this.dataRoom.receiveUpload(session.user.id, uuid.parse(id), uuid.parse(oid), uuid.parse(documentId), token, req) };
  }

  @Post('orgs/:id/offerings/:oid/documents/:documentId/finalize') async finalizeDocument(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Param('documentId') documentId: string) {
    const session = await this.session(req);
    const token = String(req.headers['x-upload-token'] ?? '');
    return { data: await this.dataRoom.finalizeUpload(session.user.id, uuid.parse(id), uuid.parse(oid), uuid.parse(documentId), token) };
  }

  @Get('orgs/:id/offerings/:oid/grants') async grants(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.dataRoom.grants(session.user.id, uuid.parse(id), uuid.parse(oid)) };
  }

  @Post('orgs/:id/offerings/:oid/grants') async grant(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ userId: uuid, expiresAt: z.string().min(4) }).strict().parse(body);
    return { data: await this.dataRoom.grant(session.user.id, uuid.parse(id), uuid.parse(oid), input) };
  }

  @Post('dataroom-grants/:id/revoke') async revoke(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason }).strict().parse(body);
    return { data: await this.dataRoom.revoke(session.user.id, uuid.parse(id), input.reason) };
  }

  // ---- ADM-04: independent review ---------------------------------------------------------------

  @Get('admin/investment-reviews') async reviewQueue(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    const [offerings, eligibility, allocations] = await Promise.all([
      this.offerings.reviewQueue(session.user.id),
      this.eligibility.queue(session.user.id),
      // PART-09. Allocation schedules land in the same queue, because they are decided by the same
      // independent reviewer and an endpoint with no way to reach it is a button that does nothing.
      this.allocations.allocationQueue(session.user.id)
    ]);
    return { data: { offerings, eligibility, allocations } };
  }

  @Get('admin/investment-reviews/:id') async reviewOne(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.offerings.reviewOne(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/offerings/:id/claim') async claim(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.offerings.claim(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/offerings/:id/decision') async decideOffering(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      outcome: z.enum(['approved', 'changes_requested', 'rejected']),
      publicReason: z.string().trim().max(1000),
      version
    }).strict().parse(body);
    return { data: await this.offerings.decide(session.user.id, uuid.parse(id), input) };
  }

  @Get('admin/eligibility/:id') async eligibilityReview(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.eligibility.review(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/eligibility/:id/decision') async decideEligibility(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      outcome: z.enum(['approved', 'changes_requested', 'rejected']),
      reason: z.string().trim().max(1000),
      validityDays: z.number().int().positive().max(1095).optional(),
      version
    }).strict().parse(body);
    return { data: await this.eligibility.decide(session.user.id, uuid.parse(id), input) };
  }

  // ---- PART-09: PER-08 the investor commits, confirms and pays ---------------------------------

  @Get('offerings/:id/capacity') async capacity(@Param('id') id: string) {
    return { data: await this.commitments.capacity(uuid.parse(id)) };
  }

  @Post('offerings/:id/commitments') async commit(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ amountMinor: minor }).strict().parse(body);
    return { data: await this.commitments.commit(session.user.id, uuid.parse(id), input) };
  }

  @Post('commitments/:id/confirm') async confirmCommitment(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      disclosureChecksum: z.string().regex(/^[0-9a-f]{64}$/),
      acknowledgedRisk: z.boolean(),
      version
    }).strict().parse(body);
    return { data: await this.commitments.confirm(session.user.id, uuid.parse(id), input) };
  }

  @Post('commitments/:id/payment-intents') async payCommitment(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.commitments.pay(session.user.id, uuid.parse(id)) };
  }

  @Post('commitments/:id/cancel') async cancelCommitment(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, version }).strict().parse(body);
    return { data: await this.commitments.cancel(session.user.id, uuid.parse(id), input) };
  }

  // ---- PER-06 / PER-09: the investor's own record ------------------------------------------------

  @Get('me/investments') async myInvestments(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.commitments.portfolio(session.user.id) };
  }

  @Get('me/commitments') async myCommitments(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.commitments.mine(session.user.id) };
  }

  @Get('me/commitments/:id') async myCommitment(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.commitments.one(session.user.id, uuid.parse(id)) };
  }

  @Get('ventures/:id/investor-relations') async investorRelations(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.relations.investorView(session.user.id, uuid.parse(id)) };
  }

  // ---- BUS-04: the issuer closes and allocates ---------------------------------------------------

  @Get('orgs/:id/offerings/:oid/allocations') async allocationBook(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.allocations.book(session.user.id, uuid.parse(id), uuid.parse(oid)) };
  }

  @Get('allocations/:id/proof') async allocationProof(@Req() req: IncomingMessage, @Param('id') id: string) { const session = await this.session(req); return { data: await this.allocations.proof(session.user.id, uuid.parse(id)) }; }

  @Post('orgs/:id/offerings/:oid/allocations/preview')
  @HttpCode(200)
  async previewAllocation(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.allocations.preview(session.user.id, uuid.parse(id), uuid.parse(oid)) };
  }

  @Post('orgs/:id/offerings/:oid/allocations/requests') async requestAllocation(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.allocations.request(session.user.id, uuid.parse(id), uuid.parse(oid)) };
  }

  @Get('orgs/:id/offerings/:oid/closing') async closingReadiness(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.allocations.closingReadiness(session.user.id, uuid.parse(id), uuid.parse(oid)) };
  }

  @Post('orgs/:id/offerings/:oid/fail') async failOffering(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.allocations.declareFailed(session.user.id, uuid.parse(id), uuid.parse(oid), input) };
  }

  @Post('orgs/:id/offerings/:oid/close-after-refunds') async closeAfterRefunds(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.allocations.closeFailed(session.user.id, uuid.parse(id), uuid.parse(oid), input) };
  }

  // ---- BUS-05: investor relations ----------------------------------------------------------------

  @Get('orgs/:id/investor-relations') async relationsOverview(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.relations.overview(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/company-reports') async publishCompanyReport(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      title: z.string().trim().min(4).max(200),
      body: z.string().trim().min(50).max(20000),
      periodStart: z.string().min(4),
      periodEnd: z.string().min(4)
    }).strict().parse(body);
    return { data: await this.relations.publishReport(session.user.id, uuid.parse(id), input) };
  }

  @Post('orgs/:id/distributions') async proposeDistribution(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ totalMinor: minor, reason }).strict().parse(body);
    return { data: await this.relations.proposeDistribution(session.user.id, uuid.parse(id), input) };
  }

  @Post('distributions/:id/approve') async approveDistribution(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.relations.approveDistribution(session.user.id, uuid.parse(id), input) };
  }

  @Post('orgs/:id/corporate-events') async recordCorporateEvent(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      kind: z.enum(['report', 'distribution', 'buyback', 'exit', 'loss', 'liquidation']),
      title: z.string().trim().min(4).max(200),
      body: z.string().trim().min(20).max(10000),
      documentRef: z.string().trim().max(200).optional(),
      effectiveAt: z.string().min(4)
    }).strict().parse(body);
    return { data: await this.relations.recordEvent(session.user.id, uuid.parse(id), input) };
  }

  // ---- ADM-04.A03 and platform finance -----------------------------------------------------------

  @Post('admin/allocation-requests/:id/finalize') async finaliseAllocation(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ checksum: z.string().regex(/^[0-9a-f]{64}$/), version }).strict().parse(body);
    return { data: await this.allocations.finalise(session.user.id, uuid.parse(id), input) };
  }

  @Post('admin/allocation-requests/:id/reject') async rejectAllocation(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, version }).strict().parse(body);
    return { data: await this.allocations.rejectRequest(session.user.id, uuid.parse(id), input) };
  }

  @Post('admin/commitments/:id/refund') async refundCommitment(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.allocations.refundCommitment(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/distributions/:id/paid') async markDistributionPaid(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.relations.markDistributionPaid(session.user.id, uuid.parse(id), input) };
  }
}
