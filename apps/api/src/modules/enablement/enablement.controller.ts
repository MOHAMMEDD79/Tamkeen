import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, HttpCode } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { IdentityError } from '../identity/policy.js';
import { AgreementsService } from './agreements.service.js';
import { StipendsService } from './stipends.service.js';
import { IncubationService } from './incubation.service.js';
import { AssistanceService } from './assistance.service.js';
import { VolunteeringService } from './volunteering.service.js';

const uuid = z.string().uuid();
const version = z.number().int().positive();
const reason = z.string().trim().min(10).max(1000);
const longReason = z.string().trim().min(10).max(2000);
const minor = z.string().regex(/^[0-9]{1,16}$/);
const currency = z.string().regex(/^[A-Za-z]{3}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const checksum = z.string().regex(/^[0-9a-f]{64}$/);
const deliveryMode = z.enum(['in_person', 'remote', 'hybrid']);

const agreementInput = z.object({
  operatorOrgId: uuid,
  title: z.string().trim().min(4).max(200),
  kind: z.enum(['cash', 'in_kind', 'mixed']).optional(),
  amountMinor: minor.nullable().optional(),
  currency: currency.nullable().optional(),
  inKindDescription: z.string().trim().max(2000).optional(),
  inKindValueMinor: minor.nullable().optional(),
  purpose: z.string().trim().min(20).max(4000),
  obligations: z.string().trim().max(4000).optional(),
  reportingTerms: z.string().trim().max(2000).optional(),
  surplusTerms: z.string().trim().max(1000).optional(),
  programId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  startsAt: z.string().min(4).nullable().optional(),
  endsAt: z.string().min(4).nullable().optional()
}).strict();

const opportunityInput = z.object({
  title: z.string().trim().min(4).max(200),
  summary: z.string().trim().min(20).max(2000),
  tasks: z.string().trim().min(10).max(4000),
  requirements: z.string().trim().max(2000).optional(),
  supervisorId: uuid,
  city: z.string().trim().max(100).optional(),
  deliveryMode: deliveryMode.optional(),
  capacity: z.number().int().min(1).max(10000).optional(),
  hoursPerWeek: z.number().int().min(0).max(80).optional(),
  startsAt: day.nullable().optional(),
  endsAt: day.nullable().optional(),
  withdrawalPolicy: z.string().trim().max(1000).optional()
}).strict();

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) throw new IdentityError('invalid_input', 422);
  return result.data;
};

/**
 * PART-12: programme funding, stipends and certificates, incubation, assistance and volunteering.
 *
 * The prefixes say who decides, as everywhere else in this API. `/orgs/...` is the organisation,
 * the bare resource routes are the individual's own, `/me/...` is their list, and the two public
 * surfaces — verifying a certificate and browsing volunteering — take no session at all.
 *
 * Nothing here creates a share, and nothing here moves money. A grant, a stipend request and an
 * assistance delivery are three different kinds of record, and all three say in their replies what
 * they did not do.
 */
@Controller()
export class EnablementController {
  private readonly agreements: AgreementsService;
  private readonly stipends: StipendsService;
  private readonly incubation: IncubationService;
  private readonly assistance: AssistanceService;
  private readonly volunteering: VolunteeringService;

  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) {
    this.agreements = new AgreementsService(runtime.db);
    this.stipends = new StipendsService(runtime.db);
    this.incubation = new IncubationService(runtime.db);
    this.assistance = new AssistanceService(runtime.db);
    this.volunteering = new VolunteeringService(runtime.db);
  }

  private async session(req: IncomingMessage) {
    return sessionFrom(this.runtime, req);
  }

  /**
   * The organisation on one side of an agreement, resolved from the resource.
   *
   * The screen contract puts these actions on `/agreements/:id`, without an organisation in the
   * path. Resolving it and then asserting membership is stricter than trusting a path segment: an
   * actor who belongs to neither party is refused by the permission check that follows.
   */
  private async agreementSide(agreementId: string, side: 'sponsor' | 'operator' | 'either') {
    const agreement = await this.runtime.db.agreement.findUnique({
      where: { id: agreementId }, select: { sponsorOrgId: true, operatorOrgId: true }
    });
    if (!agreement) throw new IdentityError('not_found', 404);
    return side === 'sponsor' ? agreement.sponsorOrgId : side === 'operator' ? agreement.operatorOrgId : agreement.sponsorOrgId;
  }

  // ---- BUS-06: agreements ------------------------------------------------------------------------

  @Get('orgs/:id/agreements') async listAgreements(@Req() req: IncomingMessage, @Param('id') id: string, @Query('role') role?: string, @Query('state') state?: string) {
    const session = await this.session(req);
    const parsed = parse(z.object({ role: z.enum(['sponsor', 'operator']).optional(), state: z.string().max(30).optional() }).strict(),
      { ...(role ? { role } : {}), ...(state ? { state } : {}) });
    return { data: await this.agreements.listForOrganization(session.user.id, id, parsed) };
  }

  @Post('orgs/:id/agreements') async createAgreement(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.agreements.create(session.user.id, id, parse(agreementInput, body)) };
  }

  @Get('orgs/:id/agreements/:aid') async getAgreement(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string) {
    const session = await this.session(req);
    return { data: await this.agreements.get(session.user.id, id, aid) };
  }

  @Patch('orgs/:id/agreements/:aid') async updateAgreement(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.agreements.update(session.user.id, id, aid, parse(agreementInput.extend({ version }), body)) };
  }

  /** BUS-06.A02. The terms become a numbered revision with a checksum, and both acceptances reset. */
  @Post('agreements/:id/submit') @HttpCode(200) async submitAgreement(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ terms: z.string().trim().min(50).max(8000), version }).strict(), body);
    return { data: await this.agreements.send(session.user.id, await this.agreementSide(id, 'sponsor'), id, input) };
  }

  /** BUS-06.A03. Accepting as one named party, on one named version. */
  @Post('agreements/:id/accept') @HttpCode(200) async acceptAgreement(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ organizationId: uuid, checksum, version }).strict(), body);
    return { data: await this.agreements.accept(session.user.id, input.organizationId, id, { checksum: input.checksum, version: input.version }) };
  }

  @Post('orgs/:id/agreements/:aid/milestones') async addAgreementMilestone(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      title: z.string().trim().min(4).max(200),
      description: z.string().trim().max(2000).optional(),
      dueAt: day,
      amountMinor: minor.nullable().optional()
    }).strict(), body);
    return { data: await this.agreements.addMilestone(session.user.id, id, aid, input) };
  }

  @Post('orgs/:id/agreement-milestones/:mid/evidence') async submitAgreementEvidence(@Req() req: IncomingMessage, @Param('id') id: string, @Param('mid') mid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ evidenceRef: z.string().trim().min(3).max(200), evidenceNote: z.string().trim().max(2000).optional(), version }).strict(), body);
    return { data: await this.agreements.submitMilestoneEvidence(session.user.id, id, mid, input) };
  }

  /** BUS-06.A04. Judging a deliverable. It releases no money, and the reply says so. */
  @Post('orgs/:id/agreement-milestones/:mid/decision') @HttpCode(200) async decideAgreementMilestone(@Req() req: IncomingMessage, @Param('id') id: string, @Param('mid') mid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      outcome: z.enum(['approved', 'changes_requested']), reason, evidenceRef: z.string().trim().max(200).optional(), version
    }).strict(), body);
    return { data: await this.agreements.decideMilestone(session.user.id, id, mid, input) };
  }

  @Post('orgs/:id/agreements/:aid/reports') async createAgreementReport(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      periodStart: day, periodEnd: day,
      narrative: z.string().trim().max(8000).optional(),
      spentMinor: minor.optional(),
      participantsReached: z.number().int().min(0).max(1000000).optional(),
      outcomesNote: z.string().trim().max(4000).optional(),
      varianceNote: z.string().trim().max(2000).optional()
    }).strict(), body);
    return { data: await this.agreements.createReport(session.user.id, id, aid, input) };
  }

  @Post('orgs/:id/agreement-reports/:rid/submit') @HttpCode(200) async submitAgreementReport(@Req() req: IncomingMessage, @Param('id') id: string, @Param('rid') rid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ version }).strict(), body);
    return { data: await this.agreements.submitReport(session.user.id, id, rid, input.version) };
  }

  /** PRG-11.A02. The sponsor's judgement on a report. */
  @Post('orgs/:id/agreement-reports/:rid/decision') @HttpCode(200) async decideAgreementReport(@Req() req: IncomingMessage, @Param('id') id: string, @Param('rid') rid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ outcome: z.enum(['approved', 'changes_requested']), reason, version }).strict(), body);
    return { data: await this.agreements.decideReport(session.user.id, id, rid, input) };
  }

  /** PRG-11.A01. Funding. It creates no share, and no money moves in this build. */
  @Post('agreements/:id/funding-intents') async fundAgreement(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ organizationId: uuid, amountMinor: minor, currency, note: z.string().trim().max(1000).optional() }).strict(), body);
    const { organizationId, ...rest } = input;
    return { data: await this.agreements.fund(session.user.id, organizationId, id, rest) };
  }

  /** PRG-11.A04. Counts and money only: 12 keeps beneficiary records out of a sponsor view. */
  @Post('orgs/:id/sponsor-exports') @HttpCode(200) async exportSponsor(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.agreements.exportForSponsor(session.user.id, id) };
  }

  // ---- PRG-06: stipends and certificates ----------------------------------------------------------

  @Get('orgs/:id/cohorts/:cid/stipend-preview') async previewStipend(@Req() req: IncomingMessage, @Param('id') id: string, @Param('cid') cid: string, @Query('from') from?: string, @Query('to') to?: string) {
    const session = await this.session(req);
    const input = parse(z.object({ periodStart: day, periodEnd: day }).strict(), { periodStart: from, periodEnd: to });
    return { data: await this.stipends.preview(session.user.id, id, cid, input) };
  }

  @Get('orgs/:id/cohorts/:cid/stipend-batches') async listStipendBatches(@Req() req: IncomingMessage, @Param('id') id: string, @Param('cid') cid: string) {
    const session = await this.session(req);
    return { data: await this.stipends.listBatches(session.user.id, id, cid) };
  }

  /** PRG-06.A01. The entitlement lines. No payout, no money, no state on the enrolment. */
  @Post('orgs/:id/cohorts/:cid/stipend-batches') async createStipendBatch(@Req() req: IncomingMessage, @Param('id') id: string, @Param('cid') cid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ periodStart: day, periodEnd: day }).strict(), body);
    return { data: await this.stipends.createBatch(session.user.id, id, cid, input) };
  }

  /** PRG-06.A02. Sending it to finance. The payout chain itself is PART-07's, unchanged. */
  @Post('orgs/:id/stipend-batches/:bid/payout-request') @HttpCode(200) async requestStipendPayout(@Req() req: IncomingMessage, @Param('id') id: string, @Param('bid') bid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ projectId: uuid, reason, invoiceReference: z.string().trim().max(120).optional(), version }).strict(), body);
    return { data: await this.stipends.requestPayout(session.user.id, id, bid, input) };
  }

  @Post('orgs/:id/stipend-batches/:bid/cancel') @HttpCode(200) async cancelStipendBatch(@Req() req: IncomingMessage, @Param('id') id: string, @Param('bid') bid: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.stipends.cancelBatch(session.user.id, id, bid, parse(z.object({ reason, version }).strict(), body)) };
  }

  @Get('orgs/:id/enrollments/:eid/certificate-readiness') async certificateReadiness(@Req() req: IncomingMessage, @Param('id') id: string, @Param('eid') eid: string) {
    const session = await this.session(req);
    return { data: await this.stipends.certificateReadiness(session.user.id, id, eid) };
  }

  /** PRG-06.A03. Issuing. It pays nothing and promises nothing about work. */
  @Post('orgs/:id/enrollments/:eid/certificate') async issueCertificate(@Req() req: IncomingMessage, @Param('id') id: string, @Param('eid') eid: string) {
    const session = await this.session(req);
    return { data: await this.stipends.issueCertificate(session.user.id, id, eid) };
  }

  /** PRG-06.A04. Revoking. The reason is private; the public reference keeps resolving. */
  @Post('orgs/:id/certificates/:cid/revoke') @HttpCode(200) async revokeCertificate(@Req() req: IncomingMessage, @Param('id') id: string, @Param('cid') cid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ reason, evidenceRef: z.string().trim().max(200).optional(), version }).strict(), body);
    return { data: await this.stipends.revokeCertificate(session.user.id, id, cid, input) };
  }

  /** The public check. No session, and no identifier beyond a display name. */
  @Get('certificates/:publicId/verify') async verifyCertificate(@Param('publicId') publicId: string) {
    return { data: await this.stipends.verifyCertificate(publicId) };
  }

  @Get('me/certificates') async myCertificates(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.stipends.myCertificates(session.user.id) };
  }

  @Get('me/stipends') async myStipends(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.stipends.myStipends(session.user.id) };
  }

  // ---- PER-16 / PRG-10: incubation -----------------------------------------------------------------

  @Get('me/proposals') async myProposals(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.incubation.mine(session.user.id) };
  }

  /** PER-16.A01. A private draft, attached to no incubator. */
  @Post('proposals') async saveProposal(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      proposalId: uuid.optional(),
      title: z.string().trim().min(4).max(200),
      summary: z.string().trim().max(4000).optional(),
      problem: z.string().trim().max(4000).optional(),
      stage: z.string().trim().max(60).optional(),
      sector: z.string().trim().max(100).optional(),
      city: z.string().trim().max(100).optional(),
      supportSought: z.string().trim().max(2000).optional(),
      version: version.optional()
    }).strict(), body);
    return { data: await this.incubation.saveDraft(session.user.id, input) };
  }

  /** PER-16.A02. Sending it, with the consent given in the same act. */
  @Post('proposals/:id/submit') @HttpCode(200) async submitProposal(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ organizationId: uuid, sharingConsent: z.boolean(), version }).strict(), body);
    return { data: await this.incubation.submit(session.user.id, id, input) };
  }

  @Post('proposals/:id/withdraw') @HttpCode(200) async withdrawProposal(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.incubation.withdraw(session.user.id, id, parse(z.object({ reason, version }).strict(), body)) };
  }

  /** PER-16.A03. Accepting incubation terms. It creates no company and issues no share. */
  @Post('incubation-agreements/:id/accept') @HttpCode(200) async acceptIncubation(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.incubation.acceptAgreement(session.user.id, id, parse(z.object({ checksum, version }).strict(), body)) };
  }

  @Post('incubation-agreements/:id/decline') @HttpCode(200) async declineIncubation(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.incubation.declineAgreement(session.user.id, id, parse(z.object({ reason, version }).strict(), body)) };
  }

  /** PER-16.A04. Evidence from the founder. */
  @Post('incubation-milestones/:id/evidence') async submitIncubationEvidence(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ evidenceRef: z.string().trim().min(3).max(200), evidenceNote: z.string().trim().max(4000).optional(), version }).strict(), body);
    return { data: await this.incubation.submitMilestoneEvidence(session.user.id, id, input) };
  }

  /** PER-16.A05, the server's half: recording a company the founder created themselves. */
  @Post('proposals/:id/startup-link') @HttpCode(200) async linkStartup(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.incubation.linkStartup(session.user.id, id, parse(z.object({ organizationId: uuid, version }).strict(), body)) };
  }

  @Get('orgs/:id/proposals') async listProposals(@Req() req: IncomingMessage, @Param('id') id: string, @Query('state') state?: string) {
    const session = await this.session(req);
    return { data: await this.incubation.listForOrganization(session.user.id, id, { ...(state ? { state } : {}) }) };
  }

  @Get('orgs/:id/proposals/:pid') async getProposal(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string) {
    const session = await this.session(req);
    return { data: await this.incubation.get(session.user.id, id, pid) };
  }

  /** PRG-10.A01. A mentor does not reach this: they comment, they do not decide. */
  @Post('orgs/:id/proposals/:pid/decision') @HttpCode(200) async decideProposal(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ outcome: z.enum(['accepted', 'rejected']), reason: longReason, criteria: z.string().trim().max(2000).optional(), version }).strict(), body);
    return { data: await this.incubation.decide(session.user.id, id, pid, input) };
  }

  /** PRG-10.A02. The assignment is what gives a mentor any reach at all. */
  @Post('orgs/:id/proposals/:pid/mentor-assignments') async assignMentor(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ mentorId: uuid, note: z.string().trim().max(1000).optional() }).strict(), body);
    return { data: await this.incubation.assignMentor(session.user.id, id, pid, input) };
  }

  @Post('orgs/:id/mentor-assignments/:aid/end') @HttpCode(200) async endMentorAssignment(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.incubation.endMentorAssignment(session.user.id, id, aid, parse(z.object({ reason }).strict(), body)) };
  }

  /** PRG-10.A03. Rights, money and limits, each a required field. */
  @Post('orgs/:id/proposals/:pid/incubation-agreements') async proposeIncubation(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      title: z.string().trim().min(4).max(200),
      terms: z.string().trim().min(20).max(8000),
      ipTerms: z.string().trim().min(20).max(4000),
      responsibilities: z.string().trim().max(4000).optional(),
      grantMinor: minor.nullable().optional(),
      currency: currency.nullable().optional(),
      grantConditions: z.string().trim().max(2000).optional(),
      durationMonths: z.number().int().min(1).max(120).nullable().optional()
    }).strict(), body);
    return { data: await this.incubation.proposeAgreement(session.user.id, id, pid, input) };
  }

  @Post('orgs/:id/incubation-agreements/:aid/offer') @HttpCode(200) async offerIncubation(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ version }).strict(), body);
    return { data: await this.incubation.offerAgreement(session.user.id, id, aid, input.version) };
  }

  @Post('orgs/:id/proposals/:pid/milestones') async addIncubationMilestone(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ title: z.string().trim().min(4).max(200), description: z.string().trim().max(2000).optional(), dueAt: day }).strict(), body);
    return { data: await this.incubation.addMilestone(session.user.id, id, pid, input) };
  }

  /** PRG-10.A04. Evidence and a review, and nothing is released by it. */
  @Post('orgs/:id/incubation-milestones/:mid/decision') @HttpCode(200) async decideIncubationMilestone(@Req() req: IncomingMessage, @Param('id') id: string, @Param('mid') mid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ outcome: z.enum(['approved', 'changes_requested']), reason: longReason, evidenceRef: z.string().trim().max(200).optional(), version }).strict(), body);
    return { data: await this.incubation.decideMilestone(session.user.id, id, mid, input) };
  }

  /** PRG-10.A05. An outcome, what it cost and what happens next. */
  @Post('orgs/:id/proposals/:pid/close') @HttpCode(200) async closeProposal(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      outcome: z.enum(['graduated', 'company_created', 'employment', 'ended']),
      note: z.string().trim().min(20).max(2000), version
    }).strict(), body);
    return { data: await this.incubation.close(session.user.id, id, pid, input) };
  }

  // ---- PER-15 / PRG-12: assistance -------------------------------------------------------------------

  @Get('me/assistance') async myAssistance(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.assistance.mine(session.user.id) };
  }

  /** PER-15.A01. The least that has to be said to assess it. */
  @Post('assistance') async createAssistance(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      organizationId: uuid,
      category: z.string().trim().min(2).max(60),
      needSummary: z.string().trim().min(20).max(4000),
      householdSize: z.number().int().min(1).max(50).nullable().optional(),
      requestedMinor: minor.nullable().optional(),
      currency: currency.nullable().optional(),
      submit: z.boolean().optional()
    }).strict(), body);
    return { data: await this.assistance.create(session.user.id, input) };
  }

  @Post('assistance/:id/submit') @HttpCode(200) async submitAssistance(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.assistance.submit(session.user.id, id, parse(z.object({ consent: z.boolean(), version }).strict(), body)) };
  }

  /** PER-15.A02. A document or an answer, private to the case. */
  @Post('assistance/:id/replies') async replyAssistance(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ body: z.string().trim().min(2).max(4000), documentRef: z.string().trim().max(200).optional() }).strict(), body);
    return { data: await this.assistance.reply(session.user.id, id, input) };
  }

  /** PER-15.A03 and A04. Confirming receipt, or objecting to what was recorded. */
  @Post('assistance/:id/deliveries/:did/confirm') @HttpCode(200) async confirmDelivery(@Req() req: IncomingMessage, @Param('id') id: string, @Param('did') did: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ confirmed: z.boolean(), reason: z.string().trim().max(1000).optional(), version }).strict(), body);
    void id;
    return { data: await this.assistance.confirmDelivery(session.user.id, did, input) };
  }

  /** PER-15.A05. Withdrawing the consent stops the processing without erasing the record. */
  @Post('assistance/:id/consent-revocations') async revokeConsent(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ reason: z.string().trim().max(1000).optional(), version }).strict(), body);
    return { data: await this.assistance.revokeConsent(session.user.id, id, input) };
  }

  @Get('orgs/:id/assistance') async listAssistance(@Req() req: IncomingMessage, @Param('id') id: string, @Query('state') state?: string, @Query('mine') mine?: string) {
    const session = await this.session(req);
    return { data: await this.assistance.listForOrganization(session.user.id, id, { ...(state ? { state } : {}), mine: mine === 'true' }) };
  }

  @Get('orgs/:id/assistance/:caseId') async getAssistance(@Req() req: IncomingMessage, @Param('id') id: string, @Param('caseId') caseId: string) {
    const session = await this.session(req);
    return { data: await this.assistance.get(session.user.id, id, caseId) };
  }

  @Post('orgs/:id/assistance/:caseId/claim') @HttpCode(200) async claimAssistance(@Req() req: IncomingMessage, @Param('id') id: string, @Param('caseId') caseId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ version }).strict(), body);
    return { data: await this.assistance.claim(session.user.id, id, caseId, input.version) };
  }

  /** PRG-12.A01. A private message, never a public note. */
  @Post('orgs/:id/assistance/:caseId/clarifications') async requestClarification(@Req() req: IncomingMessage, @Param('id') id: string, @Param('caseId') caseId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ body: z.string().trim().min(10).max(4000), version }).strict(), body);
    return { data: await this.assistance.requestClarification(session.user.id, id, caseId, input) };
  }

  /** PRG-12.A02. Never published, and the internal criteria stay internal. */
  @Post('orgs/:id/assistance/:caseId/decisions') async decideAssistance(@Req() req: IncomingMessage, @Param('id') id: string, @Param('caseId') caseId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ outcome: z.enum(['approved', 'rejected']), reason: longReason, criteria: z.string().trim().max(2000).optional(), version }).strict(), body);
    return { data: await this.assistance.decide(session.user.id, id, caseId, input) };
  }

  /** PRG-12.A03. The funding source is required: no delivery arrives from nowhere. */
  @Post('orgs/:id/assistance/:caseId/deliveries') async recordDelivery(@Req() req: IncomingMessage, @Param('id') id: string, @Param('caseId') caseId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      description: z.string().trim().min(5).max(1000),
      fundingSource: z.string().trim().min(3).max(200),
      amountMinor: minor.nullable().optional(),
      currency: currency.nullable().optional(),
      evidenceRef: z.string().trim().max(200).optional(),
      deliveredAt: day,
      version
    }).strict(), body);
    return { data: await this.assistance.recordDelivery(session.user.id, id, caseId, input) };
  }

  @Post('orgs/:id/assistance-deliveries/:did/dispute-decision') @HttpCode(200) async resolveAssistanceDispute(@Req() req: IncomingMessage, @Param('id') id: string, @Param('did') did: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ outcome: z.enum(['upheld', 'dismissed']), reason, version }).strict(), body);
    return { data: await this.assistance.resolveDispute(session.user.id, id, did, input) };
  }

  /** PRG-12.A04. Refused while anything is unconfirmed or disputed. */
  @Post('orgs/:id/assistance/:caseId/close') @HttpCode(200) async closeAssistance(@Req() req: IncomingMessage, @Param('id') id: string, @Param('caseId') caseId: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.assistance.close(session.user.id, id, caseId, parse(z.object({ note: reason, version }).strict(), body)) };
  }

  // ---- PER-17 / PRG-13: volunteering ------------------------------------------------------------------

  @Get('volunteer-opportunities') async browseVolunteering(@Query('city') city?: string) {
    return { data: await this.volunteering.browse({ ...(city ? { city } : {}) }) };
  }

  @Get('volunteer-opportunities/:slug') async publicOpportunity(@Param('slug') slug: string) {
    return { data: await this.volunteering.publicOpportunity(slug) };
  }

  @Get('me/volunteering') async myVolunteering(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.volunteering.mine(session.user.id) };
  }

  /** PER-17.A01. One application per person per opportunity. */
  @Post('volunteer-applications') async applyVolunteer(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      opportunityId: uuid,
      motivation: z.string().trim().max(2000).optional(),
      availability: z.string().trim().max(500).optional()
    }).strict(), body);
    return { data: await this.volunteering.apply(session.user.id, input) };
  }

  @Post('volunteer-applications/:id/withdraw') @HttpCode(200) async withdrawVolunteerApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.volunteering.withdrawApplication(session.user.id, id, parse(z.object({ reason, version }).strict(), body)) };
  }

  /** PER-17.A02. Nobody is placed without agreeing to the task. */
  @Post('volunteer-assignments/:id/accept') @HttpCode(200) async respondToAssignment(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ accept: z.boolean(), reason: z.string().trim().max(1000).optional(), version }).strict(), body);
    return { data: await this.volunteering.respondToAssignment(session.user.id, id, input) };
  }

  /** PER-17.A03. Hours are a claim until somebody else approves them. */
  @Post('volunteer-hours') async logHours(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      assignmentId: uuid, workedOn: day,
      minutes: z.number().int().min(1).max(1440),
      note: z.string().trim().max(1000).optional()
    }).strict(), body);
    return { data: await this.volunteering.logHours(session.user.id, input) };
  }

  @Get('orgs/:id/volunteering') async volunteerBoard(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.volunteering.board(session.user.id, id) };
  }

  @Post('orgs/:id/volunteer-opportunities') async createOpportunity(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.volunteering.createOpportunity(session.user.id, id, parse(opportunityInput, body)) };
  }

  @Patch('orgs/:id/volunteer-opportunities/:oid') async updateOpportunity(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.volunteering.updateOpportunity(session.user.id, id, oid, parse(opportunityInput.extend({ version }), body)) };
  }

  @Post('orgs/:id/volunteer-opportunities/:oid/validate') @HttpCode(200) async validateOpportunity(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string) {
    const session = await this.session(req);
    return { data: await this.volunteering.validateOpportunity(session.user.id, id, oid) };
  }

  /** PRG-13.A01. Publishing. Refused unless everything a volunteer decides on is stated. */
  @Post('orgs/:id/volunteer-opportunities/:oid/publish') @HttpCode(200) async publishOpportunity(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ version }).strict(), body);
    return { data: await this.volunteering.publishOpportunity(session.user.id, id, oid, input.version) };
  }

  @Post('orgs/:id/volunteer-opportunities/:oid/close') @HttpCode(200) async closeOpportunity(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ reason: z.string().trim().min(10).max(200), version }).strict(), body);
    return { data: await this.volunteering.closeOpportunity(session.user.id, id, oid, input) };
  }

  /** PRG-13.A02. Decided against the places actually left. */
  @Post('orgs/:id/volunteer-applications/:aid/decision') @HttpCode(200) async decideVolunteerApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ outcome: z.enum(['accepted', 'rejected']), reason: z.string().trim().max(1000).optional(), version }).strict(), body);
    return { data: await this.volunteering.decideApplication(session.user.id, id, aid, { ...input, reason: input.reason ?? '' }) };
  }

  /** PRG-13.A03. A task for somebody the organisation accepted, which they still have to accept. */
  @Post('orgs/:id/volunteer-assignments') async assignVolunteer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      opportunityId: uuid, userId: uuid,
      task: z.string().trim().min(5).max(1000),
      startsAt: day, endsAt: day.nullable().optional()
    }).strict(), body);
    return { data: await this.volunteering.assign(session.user.id, id, input) };
  }

  @Post('orgs/:id/volunteer-assignments/:aid/end') @HttpCode(200) async endVolunteerAssignment(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.volunteering.endAssignment(session.user.id, id, aid, parse(z.object({ reason, version }).strict(), body)) };
  }

  /** PRG-13.A04. Never the volunteer themselves — refused here and by a trigger underneath. */
  @Post('orgs/:id/volunteer-hours/:hid/decision') @HttpCode(200) async decideVolunteerHours(@Req() req: IncomingMessage, @Param('id') id: string, @Param('hid') hid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ outcome: z.enum(['approved', 'rejected']), reason: z.string().trim().max(1000).optional(), version }).strict(), body);
    return { data: await this.volunteering.decideHours(session.user.id, id, hid, input) };
  }
}
