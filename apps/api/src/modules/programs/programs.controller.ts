import { Body, Controller, Get, Inject, Param, Patch, Post, Put, Query, Req, HttpCode } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import { IDENTITY_RUNTIME, type IdentityRuntime } from '../identity/identity.controller.js';
import { sessionFrom } from '../identity/session.js';
import { ProgramsService } from './programs.service.js';
import { ApplicationsService } from './applications.service.js';
import { TrainingService } from './training.service.js';

const uuid = z.string().uuid();
const version = z.number().int().positive();
const reason = z.string().trim().min(10).max(1000);
const minor = z.string().regex(/^[0-9]{1,16}$/);
const deliveryMode = z.enum(['in_person', 'remote', 'hybrid']);
const attendanceStatus = z.enum(['present', 'absent', 'excused', 'late']);

const programInput = z.object({
  title: z.string().trim().min(4).max(200),
  summary: z.string().trim().min(20).max(2000),
  skills: z.array(z.string().trim().min(1).max(60)).max(30).optional(),
  level: z.string().trim().max(60).optional(),
  deliveryMode: deliveryMode.optional(),
  city: z.string().trim().max(100).optional(),
  capacity: z.number().int().min(1).max(100000),
  applyOpensAt: z.string().min(4).nullable().optional(),
  applyClosesAt: z.string().min(4).nullable().optional(),
  durationWeeks: z.number().int().min(0).max(520).optional(),
  hoursPerWeek: z.number().int().min(0).max(80).optional(),
  schedule: z.string().trim().max(1000).optional(),
  attendancePolicy: z.string().trim().max(2000).optional(),
  assessmentPolicy: z.string().trim().max(2000).optional(),
  selectionMethod: z.string().trim().max(2000).optional(),
  withdrawalPolicy: z.string().trim().max(2000).optional(),
  accessibilityNote: z.string().trim().max(1000).optional(),
  privacyNote: z.string().trim().max(1000).optional(),
  complaintsContact: z.string().trim().max(200).optional(),
  stipendOffered: z.boolean().optional(),
  stipendAmountMinor: minor.nullable().optional(),
  stipendCurrency: z.string().regex(/^[A-Za-z]{3}$/).nullable().optional(),
  stipendConditions: z.string().trim().max(1000).optional(),
  jobCommitmentKind: z.enum(['none', 'expected', 'committed']).optional(),
  jobCount: z.number().int().min(0).max(100000).optional(),
  jobCommitmentTerms: z.string().trim().max(2000).optional(),
  minimumAge: z.number().int().min(14).max(100).nullable().optional(),
  maximumAge: z.number().int().min(14).max(100).nullable().optional(),
  educationRequirement: z.string().trim().max(500).optional()
}).strict();

/**
 * PART-10: programmes, cohorts, applications, enrolment, attendance and assessment.
 *
 * The route prefixes follow who decides, as they do everywhere else in this API. `/programs/...` is
 * what the public reaches, `/me/...` is the candidate's own record, `/orgs/...` is the operator
 * running its programme, `/cohorts/...` is the cohort a trainer was assigned, and `/admin/...` is
 * the independent reviewer. Nothing here creates a job or a payment: 07 keeps training and
 * employment apart, and so does this controller.
 */
@Controller()
export class ProgramsController {
  private readonly programs: ProgramsService;
  private readonly applications: ApplicationsService;
  private readonly training: TrainingService;

  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) {
    this.programs = new ProgramsService(runtime.db);
    this.applications = new ApplicationsService(runtime.db);
    this.training = new TrainingService(runtime.db);
  }

  private async session(req: IncomingMessage) {
    return sessionFrom(this.runtime, req);
  }

  // ---- PUB-09 / PUB-10: the public surface -------------------------------------------------------

  @Get('programs') async browse(@Query('skill') skill?: string, @Query('city') city?: string, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const parsed = z.object({
      skill: z.string().trim().min(1).max(60).optional(),
      city: z.string().trim().min(1).max(100).optional(),
      cursor: uuid.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional()
    }).parse({ skill, city, cursor, limit });
    return { data: await this.programs.browse(parsed) };
  }

  @Get('programs/:slug') async publicProgram(@Param('slug') slug: string) {
    return { data: await this.programs.publicProgram(slug) };
  }

  @Get('programs/:slug/curriculum') async curriculum(@Param('slug') slug: string) {
    return { data: await this.programs.curriculum(slug) };
  }

  // PUB-09.A04 / PUB-10.A04 are served by the existing `/bookmarks` routes, which PART-10 widened
  // to take a programme as well as a project. One saved list, not two competing ones — and two
  // handlers on the same path would have been a silent race over which one answered.

  // ---- PER-10: the candidate profile -------------------------------------------------------------

  @Get('me/candidate-profile') async myProfile(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.applications.myProfile(session.user.id) };
  }

  @Patch('me/candidate-profile') async saveProfile(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      headline: z.string().trim().max(200).optional(),
      summary: z.string().trim().max(2000).optional(),
      city: z.string().trim().max(100).optional(),
      availability: z.string().trim().max(200).optional(),
      education: z.string().trim().max(1000).optional(),
      experience: z.string().trim().max(2000).optional(),
      skills: z.array(z.string().trim().min(1).max(60)).max(40).optional(),
      cvReference: z.string().trim().max(200).optional(),
      shareWithOperators: z.boolean().optional(),
      shareContact: z.boolean().optional(),
      version: z.number().int().min(0).optional()
    }).strict().parse(body);
    return { data: await this.applications.saveProfile(session.user.id, input) };
  }

  @Get('me/candidate-profile/employer-preview') async employerPreview(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.applications.employerPreview(session.user.id) };
  }

  // ---- PER-11 / PER-12: applying and following an application ------------------------------------

  @Post('applications') async saveDraft(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      cohortId: uuid,
      answers: z.record(z.string().max(60), z.unknown()).optional(),
      motivation: z.string().trim().max(4000).optional(),
      sharingConsent: z.boolean().optional(),
      applicationId: uuid.optional(),
      version
    }).partial({ version: true }).strict().parse(body);
    return { data: await this.applications.saveDraft(session.user.id, input) };
  }

  @Post('applications/:id/submit') async submitApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ sharingConsent: z.boolean(), version }).strict().parse(body);
    return { data: await this.applications.submit(session.user.id, uuid.parse(id), input) };
  }

  @Post('applications/:id/discard') async discardApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.applications.discard(session.user.id, uuid.parse(id), input.version) };
  }

  @Post('applications/:id/withdraw') async withdrawApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, version }).strict().parse(body);
    return { data: await this.applications.withdraw(session.user.id, uuid.parse(id), input) };
  }

  @Get('me/applications') async myApplications(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.applications.mine(session.user.id) };
  }

  @Get('me/applications/:id') async myApplication(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.applications.one(session.user.id, uuid.parse(id)) };
  }

  @Post('interviews/:id/confirm') async confirmInterview(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.applications.confirmInterview(session.user.id, uuid.parse(id), input.version) };
  }

  @Post('interviews/:id/reschedule-requests') async requestReschedule(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, alternatives: z.string().trim().max(1000).optional() }).strict().parse(body);
    return { data: await this.applications.requestReschedule(session.user.id, uuid.parse(id), input) };
  }

  @Post('enrollments/:id/accept') async acceptSeat(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.applications.acceptSeat(session.user.id, uuid.parse(id), input.version) };
  }

  // ---- PER-13: the trainee's own training --------------------------------------------------------

  @Get('me/training/:id') async myTraining(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.training.myTraining(session.user.id, uuid.parse(id)) };
  }

  @Post('attendance/:id/objections') async objectToAttendance(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason }).strict().parse(body);
    return { data: await this.training.objectToAttendance(session.user.id, uuid.parse(id), input) };
  }

  @Post('enrollments/:id/withdrawal-requests') async requestWithdrawal(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason }).strict().parse(body);
    return { data: await this.training.requestWithdrawal(session.user.id, uuid.parse(id), input) };
  }

  // ---- PRG-01 / PRG-02: the operator's programmes -------------------------------------------------

  @Get('orgs/:id/programs') async listPrograms(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.programs.listForOrganization(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/programs') async createProgram(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    return { data: await this.programs.create(session.user.id, uuid.parse(id), programInput.parse(body)) };
  }

  @Get('orgs/:id/programs/:pid') async getProgram(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string) {
    const session = await this.session(req);
    return { data: await this.programs.getForOrganization(session.user.id, uuid.parse(id), uuid.parse(pid)) };
  }

  @Patch('orgs/:id/programs/:pid') async updateProgram(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = programInput.extend({ version }).parse(body);
    return { data: await this.programs.update(session.user.id, uuid.parse(id), uuid.parse(pid), input) };
  }

  @Post('orgs/:id/programs/:pid/validate')
  @HttpCode(200)
  async validateProgram(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string) {
    const session = await this.session(req);
    return { data: await this.programs.validate(session.user.id, uuid.parse(id), uuid.parse(pid)) };
  }

  @Post('orgs/:id/programs/:pid/submit') async submitProgram(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.programs.submit(session.user.id, uuid.parse(id), uuid.parse(pid), input.version) };
  }

  @Post('orgs/:id/programs/:pid/publish') async publishProgram(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.programs.publish(session.user.id, uuid.parse(id), uuid.parse(pid), input.version) };
  }

  @Post('orgs/:id/programs/:pid/close-applications') async closeApplications(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.programs.closeApplications(session.user.id, uuid.parse(id), uuid.parse(pid), input.version) };
  }

  @Post('orgs/:id/programs/:pid/cohorts') async addCohort(@Req() req: IncomingMessage, @Param('id') id: string, @Param('pid') pid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      name: z.string().trim().min(2).max(140),
      capacity: z.number().int().min(1).max(100000),
      startAt: z.string().min(4),
      endAt: z.string().min(4),
      acceptanceWindowHours: z.number().int().min(1).max(720).optional(),
      timezone: z.string().trim().max(60).optional()
    }).strict().parse(body);
    return { data: await this.programs.addCohort(session.user.id, uuid.parse(id), uuid.parse(pid), input) };
  }

  // ---- PRG-03: screening -------------------------------------------------------------------------

  @Get('orgs/:id/applications') async listApplications(@Req() req: IncomingMessage, @Param('id') id: string, @Query('program') program?: string, @Query('cohort') cohort?: string, @Query('state') state?: string, @Query('pending') pending?: string) {
    const session = await this.session(req);
    const filters = z.object({
      programId: uuid.optional(),
      cohortId: uuid.optional(),
      state: z.enum(['submitted', 'screening', 'shortlisted', 'interview', 'accepted', 'waitlisted', 'rejected', 'withdrawn']).optional(),
      pending: z.enum(['true', 'false']).optional()
    }).parse({ programId: program, cohortId: cohort, state, pending });
    return { data: await this.applications.listForOrganization(session.user.id, uuid.parse(id), { ...filters, pending: filters.pending === 'true' }) };
  }

  @Get('orgs/:id/applications/:aid') async getApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string) {
    const session = await this.session(req);
    return { data: await this.applications.getForOrganization(session.user.id, uuid.parse(id), uuid.parse(aid)) };
  }

  @Post('orgs/:id/applications/:aid/reviews') async reviewApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      scores: z.record(z.string().max(60), z.number().int().min(0).max(100)),
      note: z.string().trim().min(10).max(2000),
      scaleMax: z.number().int().min(1).max(100).optional()
    }).strict().parse(body);
    return { data: await this.applications.review(session.user.id, uuid.parse(id), uuid.parse(aid), input) };
  }

  @Post('orgs/:id/applications/:aid/interviews') async scheduleInterview(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      scheduledAt: z.string().min(4),
      durationMinutes: z.number().int().min(5).max(480).optional(),
      timezone: z.string().trim().max(60).optional(),
      mode: deliveryMode.optional(),
      location: z.string().trim().max(300).optional()
    }).strict().parse(body);
    return { data: await this.applications.scheduleInterview(session.user.id, uuid.parse(id), uuid.parse(aid), input) };
  }

  @Post('orgs/:id/applications/:aid/decision') async decideApplication(@Req() req: IncomingMessage, @Param('id') id: string, @Param('aid') aid: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      outcome: z.enum(['accepted', 'waitlisted', 'rejected']),
      reason: z.string().trim().max(1000),
      version
    }).strict().parse(body);
    return { data: await this.applications.decide(session.user.id, uuid.parse(id), uuid.parse(aid), input) };
  }

  @Get('orgs/:id/cohorts/:cid/capacity') async cohortCapacity(@Req() req: IncomingMessage, @Param('id') id: string, @Param('cid') cid: string) {
    const session = await this.session(req);
    return { data: await this.applications.cohortCapacity(session.user.id, uuid.parse(id), uuid.parse(cid)) };
  }

  @Get('orgs/:id/attendance-objections') async openObjections(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.training.openObjections(session.user.id, uuid.parse(id)) };
  }

  // ---- PRG-04 / PRG-05: running the cohort -------------------------------------------------------

  @Get('cohorts/:id') async cohortBoard(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.training.cohortBoard(session.user.id, uuid.parse(id)) };
  }

  @Post('cohorts/:id/trainers') async assignTrainer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ userId: uuid }).strict().parse(body);
    return { data: await this.training.assignTrainer(session.user.id, uuid.parse(id), input.userId) };
  }

  @Post('cohorts/:id/trainers/:tid/revoke') async revokeTrainer(@Req() req: IncomingMessage, @Param('id') id: string, @Param('tid') tid: string) {
    const session = await this.session(req);
    return { data: await this.training.revokeTrainer(session.user.id, uuid.parse(id), uuid.parse(tid)) };
  }

  @Post('cohorts/:id/sessions') async createSession(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      title: z.string().trim().min(3).max(200),
      startsAt: z.string().min(4),
      endsAt: z.string().min(4),
      mode: deliveryMode.optional(),
      location: z.string().trim().max(300).optional()
    }).strict().parse(body);
    return { data: await this.training.createSession(session.user.id, uuid.parse(id), input) };
  }

  @Post('cohorts/:id/waitlist/invite-next') async inviteNext(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.training.inviteNextFromWaitlist(session.user.id, uuid.parse(id)) };
  }

  @Post('enrollments/:id/withdraw') async recordWithdrawal(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ reason, version, terminated: z.boolean().optional() }).strict().parse(body);
    return { data: await this.training.recordWithdrawal(session.user.id, uuid.parse(id), input) };
  }

  @Get('sessions/:id/attendance') async sessionRegister(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.training.sessionRegister(session.user.id, uuid.parse(id)) };
  }

  @Put('sessions/:id/attendance') async saveAttendance(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      entries: z.array(z.object({
        enrollmentId: uuid,
        status: attendanceStatus,
        excuseNote: z.string().trim().max(1000).optional(),
        reason: z.string().trim().max(1000).optional(),
        version: z.number().int().positive().optional()
      }).strict()).min(1).max(500)
    }).strict().parse(body);
    return { data: await this.training.saveAttendance(session.user.id, uuid.parse(id), input) };
  }

  @Post('sessions/:id/close') async closeSession(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ version }).strict().parse(body);
    return { data: await this.training.closeSession(session.user.id, uuid.parse(id), input.version) };
  }

  @Post('attendance-objections/:id/decision') async decideObjection(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      outcome: z.enum(['upheld', 'rejected']),
      reason,
      correctedStatus: attendanceStatus.optional(),
      version
    }).strict().parse(body);
    return { data: await this.training.decideObjection(session.user.id, uuid.parse(id), input) };
  }

  @Post('cohorts/:id/assessments') async createAssessment(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      title: z.string().trim().min(3).max(200),
      rubric: z.record(z.string().max(60), z.number().int().min(1).max(100)),
      scaleMax: z.number().int().min(1).max(100).optional(),
      passMark: z.number().int().min(0).max(100).optional()
    }).strict().parse(body);
    return { data: await this.training.createAssessment(session.user.id, uuid.parse(id), input) };
  }

  @Post('assessments/:id/results') async recordResult(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      enrollmentId: uuid,
      scores: z.record(z.string().max(60), z.number().int().min(0).max(100)),
      note: z.string().trim().max(2000).optional()
    }).strict().parse(body);
    return { data: await this.training.recordResult(session.user.id, uuid.parse(id), input) };
  }

  // ---- ADM-04: the independent programme review ---------------------------------------------------

  @Get('admin/program-reviews') async reviewQueue(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.programs.reviewQueue(session.user.id) };
  }

  @Get('admin/program-reviews/:id') async reviewOne(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.programs.reviewOne(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/programs/:id/claim') async claimProgram(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.programs.claim(session.user.id, uuid.parse(id)) };
  }

  @Post('admin/programs/:id/decision') async decideProgram(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({
      outcome: z.enum(['approved', 'changes_requested', 'rejected']),
      publicReason: z.string().trim().max(1000),
      version
    }).strict().parse(body);
    return { data: await this.programs.decide(session.user.id, uuid.parse(id), input) };
  }
}
