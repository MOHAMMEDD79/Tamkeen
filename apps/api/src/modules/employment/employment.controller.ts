import { Body, Controller, Get, Inject, Param, Patch, Post, Query, Req, HttpCode } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { IdentityError } from '../identity/policy.js';
import { JobsService } from './jobs.service.js';
import { OffersService } from './offers.service.js';
import { PlacementsService } from './placements.service.js';

const uuid = z.string().uuid();
const version = z.number().int().positive();
const reason = z.string().trim().min(10).max(1000);
const minor = z.string().regex(/^[0-9]{1,16}$/);
const currency = z.string().regex(/^[A-Za-z]{3}$/);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const deliveryMode = z.enum(['in_person', 'remote', 'hybrid']);
const contractType = z.enum(['full_time', 'part_time', 'fixed_term', 'apprenticeship', 'temporary']);

const jobInput = z.object({
  title: z.string().trim().min(4).max(200),
  summary: z.string().trim().min(20).max(2000),
  responsibilities: z.string().trim().max(4000).optional(),
  requirements: z.string().trim().max(4000).optional(),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  contractType: contractType.optional(),
  contractMonths: z.number().int().min(1).max(120).nullable().optional(),
  deliveryMode: deliveryMode.optional(),
  city: z.string().trim().max(100).optional(),
  hoursPerWeek: z.number().int().min(0).max(80).optional(),
  salaryDisclosed: z.boolean().optional(),
  salaryMinMinor: minor.nullable().optional(),
  salaryMaxMinor: minor.nullable().optional(),
  salaryCurrency: currency.nullable().optional(),
  salaryPeriod: z.string().trim().max(20).optional(),
  salaryUndisclosedReason: z.string().trim().max(200).optional(),
  closesAt: z.string().min(4).nullable().optional(),
  openings: z.number().int().min(1).max(10000).optional(),
  programId: uuid.nullable().optional()
}).strict();

const offerInput = z.object({
  jobApplicationId: uuid,
  title: z.string().trim().min(4).max(200),
  terms: z.string().trim().min(20).max(4000),
  contractType: contractType.optional(),
  contractMonths: z.number().int().min(1).max(120).nullable().optional(),
  salaryMinor: minor.nullable().optional(),
  salaryCurrency: currency.nullable().optional(),
  salaryPeriod: z.string().trim().max(20).optional(),
  proposedStartDate: day,
  respondByAt: z.string().min(4)
}).strict();

const parse = <T>(schema: z.ZodType<T>, body: unknown): T => {
  const result = schema.safeParse(body);
  if (!result.success) throw new IdentityError('invalid_input', 422);
  return result.data;
};

/**
 * PART-11: jobs, referrals, offers, placements and follow-up.
 *
 * The prefixes say who decides, as everywhere else in this API. `/jobs/...` is public, `/me/...`
 * and the bare resource routes are the candidate's own, and `/orgs/...` is the employer. The two
 * routes both sides share — confirming a start and answering a follow-up — are deliberately one
 * endpoint each, because a start confirmed by the employer and one confirmed by the candidate are
 * the same fact recorded by different people, and keeping them in one place is what lets the rule
 * "both sides, same date" be written once.
 *
 * Nothing here counts an accepted offer as employment. That is JOB-01, and it is enforced in the
 * service, in a CHECK constraint, and stated in every payload that could be misread.
 */
@Controller()
export class EmploymentController {
  private readonly jobs: JobsService;
  private readonly offers: OffersService;
  private readonly placements: PlacementsService;

  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) {
    this.jobs = new JobsService(runtime.db);
    this.offers = new OffersService(runtime.db);
    this.placements = new PlacementsService(runtime.db);
  }

  private async session(req: IncomingMessage) {
    return sessionFrom(this.runtime, req);
  }

  /**
   * The organisation that owns an offer.
   *
   * The screen contract puts offer actions on `/job-offers/:id`, without the organisation in the
   * path. Resolving it from the resource and then asserting membership is stricter than trusting a
   * path segment, not looser: an actor who is not a member of the owning organisation is refused by
   * the permission check that follows.
   */
  private async offerOrganization(offerId: string) {
    const offer = await this.runtime.db.jobOffer.findUnique({
      where: { id: offerId },
      select: { jobApplication: { select: { job: { select: { organizationId: true } } } } }
    });
    if (!offer) throw new IdentityError('not_found', 404);
    return offer.jobApplication.job.organizationId;
  }

  // ---- PUB-09 / PUB-11: the public surface ------------------------------------------------------

  @Get('jobs') async browse(@Query('skill') skill?: string, @Query('city') city?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const parsed = parse(z.object({
      skill: z.string().trim().min(1).max(60).optional(),
      city: z.string().trim().min(1).max(100).optional(),
      cursor: uuid.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional()
    }).strict(), { ...(skill ? { skill } : {}), ...(city ? { city } : {}), ...(cursor ? { cursor } : {}), ...(limit ? { limit } : {}) });
    return { data: await this.jobs.browse(parsed) };
  }

  @Get('jobs/:slug') async publicJob(@Param('slug') slug: string) {
    return { data: await this.jobs.publicJob(slug) };
  }

  // ---- PUB-11.A01 / PER-14: the candidate -------------------------------------------------------

  @Post('job-applications') async saveDraft(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      jobId: uuid,
      coverNote: z.string().trim().max(4000).optional(),
      applicationId: uuid.optional(),
      version: version.optional()
    }).strict(), body);
    return { data: await this.jobs.saveDraft(session.user.id, input) };
  }

  @Post('job-applications/:id/submit') @HttpCode(200) async submit(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ sharingConsent: z.boolean(), version }).strict(), body);
    return { data: await this.jobs.submit(session.user.id, id, input) };
  }

  @Post('job-applications/:id/withdrawals') @HttpCode(200) async withdrawApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.jobs.withdraw(session.user.id, id, parse(z.object({ reason, version }).strict(), body)) };
  }

  @Get('me/job-applications') async myApplications(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.jobs.mine(session.user.id) };
  }

  @Get('me/job-referrals') async myReferrals(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.jobs.myReferrals(session.user.id) };
  }

  @Post('job-referrals/:id/response') @HttpCode(200) async respondToReferral(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.jobs.respondToReferral(session.user.id, id, parse(z.object({ accept: z.boolean(), version }).strict(), body)) };
  }

  @Get('job-offers/:id') async offer(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.offers.offerForCandidate(session.user.id, id) };
  }

  /** PER-14.A01. JOB-01: this returns a `start_pending` placement, never an employment. */
  @Post('job-offers/:id/accept') @HttpCode(200) async acceptOffer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ termsChecksum: z.string().regex(/^[0-9a-f]{64}$/), version }).strict(), body);
    return { data: await this.offers.acceptOffer(session.user.id, id, input) };
  }

  @Post('job-offers/:id/decline') @HttpCode(200) async declineOffer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.offers.declineOffer(session.user.id, id, parse(z.object({ reason, version }).strict(), body)) };
  }

  @Get('me/placements') async myPlacements(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.placements.mine(session.user.id) };
  }

  /**
   * PER-14.A03 and PRG-08.A04. One endpoint, two callers.
   *
   * `asEmployer` is a request to be treated as the employer side; the service still asserts
   * `placement.verify` on the owning organisation before accepting it, so a candidate cannot
   * confirm their own start twice by flipping a flag.
   */
  @Post('placements/:id/start-confirmations') async confirmStart(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      startDate: day,
      evidenceRef: z.string().trim().max(200).optional(),
      asEmployer: z.boolean().optional()
    }).strict(), body);
    return { data: await this.placements.confirmStart(session.user.id, id, input) };
  }

  /** PER-14.A04 and PRG-09.A02. JOB-02: `unknown` is accepted and changes nothing. */
  @Post('placements/:id/followups') async recordFollowup(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      dayOffset: z.union([z.literal(30), z.literal(90)]),
      result: z.enum(['working', 'ended', 'unknown', 'disputed']),
      source: z.string().trim().min(3).max(120).optional(),
      evidenceRef: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1000).optional(),
      selfFound: z.boolean().optional(),
      version
    }).strict(), body);
    return { data: await this.placements.recordFollowup(session.user.id, id, input) };
  }

  /** PER-14.A05. The shared ticket queue is PART-13; this is the placement's own objection. */
  @Post('placements/:id/disputes') async dispute(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.placements.dispute(session.user.id, id, parse(z.object({ reason, version }).strict(), body)) };
  }

  // ---- PRG-07: the employer's jobs --------------------------------------------------------------

  @Get('orgs/:id/jobs') async listJobs(@Req() req: IncomingMessage, @Param('id') id: string, @Query('state') state?: string) {
    const session = await this.session(req);
    return { data: await this.jobs.listForOrganization(session.user.id, id, { ...(state ? { state } : {}) }) };
  }

  @Post('orgs/:id/jobs') async createJob(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.jobs.create(session.user.id, id, parse(jobInput, body)) };
  }

  @Get('orgs/:id/jobs/:jid') async getJob(@Req() req: IncomingMessage, @Param('id') id: string, @Param('jid') jid: string) {
    const session = await this.session(req);
    return { data: await this.jobs.getForOrganization(session.user.id, id, jid) };
  }

  @Patch('orgs/:id/jobs/:jid') async updateJob(@Req() req: IncomingMessage, @Param('id') id: string, @Param('jid') jid: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.jobs.update(session.user.id, id, jid, parse(jobInput.extend({ version }), body)) };
  }

  /** What a publish would refuse, field by field, so the screen never offers a button that fails. */
  @Post('orgs/:id/jobs/:jid/validate') @HttpCode(200) async validateJob(@Req() req: IncomingMessage, @Param('id') id: string, @Param('jid') jid: string) {
    const session = await this.session(req);
    return { data: await this.jobs.validate(session.user.id, id, jid) };
  }

  @Post('orgs/:id/jobs/:jid/publish') @HttpCode(200) async publishJob(@Req() req: IncomingMessage, @Param('id') id: string, @Param('jid') jid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ version }).strict(), body);
    return { data: await this.jobs.publish(session.user.id, id, jid, input.version) };
  }

  @Post('orgs/:id/jobs/:jid/close') @HttpCode(200) async closeJob(@Req() req: IncomingMessage, @Param('id') id: string, @Param('jid') jid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ reason: z.string().trim().min(10).max(200), version, rejectOpen: z.boolean().optional() }).strict(), body);
    return { data: await this.jobs.close(session.user.id, id, jid, input) };
  }

  @Post('orgs/:id/jobs/:jid/referrals') async refer(@Req() req: IncomingMessage, @Param('id') id: string, @Param('jid') jid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ userId: uuid, note: z.string().trim().max(1000).optional() }).strict(), body);
    return { data: await this.jobs.refer(session.user.id, id, jid, input) };
  }

  // ---- PRG-08: candidacies, interviews and offers ------------------------------------------------

  @Get('orgs/:id/job-applications') async listJobApplications(@Req() req: IncomingMessage, @Param('id') id: string, @Query('jobId') jobId?: string, @Query('pending') pending?: string) {
    const session = await this.session(req);
    return { data: await this.jobs.listApplications(session.user.id, id, { ...(jobId ? { jobId } : {}), pending: pending === 'true' }) };
  }

  @Get('orgs/:id/job-applications/:aid') async getJobApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string) {
    const session = await this.session(req);
    return { data: await this.jobs.getApplication(session.user.id, id, aid) };
  }

  @Post('orgs/:id/job-applications/:aid/decision') @HttpCode(200) async decideJobApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      outcome: z.enum(['screening', 'shortlisted', 'rejected']),
      reason: z.string().trim().max(1000).optional(),
      version
    }).strict(), body);
    return { data: await this.jobs.decide(session.user.id, id, aid, { ...input, reason: input.reason ?? '' }) };
  }

  @Post('orgs/:id/job-applications/:aid/interviews') async scheduleJobInterview(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      scheduledAt: z.string().min(4),
      durationMinutes: z.number().int().min(10).max(480).optional(),
      timezone: z.string().trim().min(3).max(60).optional(),
      mode: deliveryMode.optional(),
      location: z.string().trim().max(300).optional(),
      version
    }).strict(), body);
    return { data: await this.offers.scheduleInterview(session.user.id, id, aid, input) };
  }

  @Get('orgs/:id/job-offers') async listJobOffers(@Req() req: IncomingMessage, @Param('id') id: string, @Query('jobId') jobId?: string, @Query('state') state?: string) {
    const session = await this.session(req);
    return { data: await this.offers.listOffers(session.user.id, id, { ...(jobId ? { jobId } : {}), ...(state ? { state } : {}) }) };
  }

  @Post('orgs/:id/job-offers') async createJobOffer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.offers.createOffer(session.user.id, id, parse(offerInput, body)) };
  }

  @Patch('orgs/:id/job-offers/:oid') async updateJobOffer(@Req() req: IncomingMessage, @Param('id') id: string, @Param('oid') oid: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.offers.updateOffer(session.user.id, id, oid, parse(offerInput.extend({ version }), body)) };
  }

  @Post('job-offers/:id/send') @HttpCode(200) async sendJobOffer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ version }).strict(), body);
    return { data: await this.offers.sendOffer(session.user.id, await this.offerOrganization(id), id, input.version) };
  }

  @Post('job-offers/:id/withdraw') @HttpCode(200) async withdrawJobOffer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.offers.withdrawOffer(session.user.id, await this.offerOrganization(id), id, parse(z.object({ reason, version }).strict(), body)) };
  }

  // ---- PRG-09: placements and follow-up ----------------------------------------------------------

  @Get('orgs/:id/placements') async listPlacements(@Req() req: IncomingMessage, @Param('id') id: string, @Query('state') state?: string, @Query('due') due?: string) {
    const session = await this.session(req);
    return { data: await this.placements.listForOrganization(session.user.id, id, { ...(state ? { state } : {}), dueOnly: due === 'true' }) };
  }

  /** PRG-09.A01. Asks the question and writes no result. */
  @Post('placements/:id/followup-requests') async requestFollowup(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({ dayOffset: z.union([z.literal(30), z.literal(90)]) }).strict(), body);
    return { data: await this.placements.requestFollowup(session.user.id, id, input.dayOffset) };
  }

  /** PRG-09.A03. `placement.review`, which a recruiter does not have. */
  @Post('placements/:id/review-decisions') async reviewPlacement(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = parse(z.object({
      outcome: z.enum(['confirm_start', 'reject_start', 'confirm_end', 'reinstate']),
      reason,
      startDate: day.optional(),
      evidenceRef: z.string().trim().max(200).optional(),
      version
    }).strict(), body);
    return { data: await this.placements.review(session.user.id, id, input) };
  }

  /** PRG-09.A04. Counts only, with the denominator stated rather than implied. */
  @Post('orgs/:id/placement-exports') @HttpCode(200) async exportPlacements(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.placements.exportSummary(session.user.id, id) };
  }
}
