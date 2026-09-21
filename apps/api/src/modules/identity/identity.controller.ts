import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Put, Req, Res, ForbiddenException } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import { z } from 'zod';
import type { DatabaseClient } from '@tamkeen/database';
import type { RuntimeConfig } from '@tamkeen/config';
import type { Auth } from './auth.js';
import { IdentityService } from './identity.service.js';
import { LocalVerificationStorage } from './verification-storage.js';
import { LocalLogoStorage } from './logo-storage.js';
import { sessionFrom } from './session.js';

export const IDENTITY_RUNTIME = Symbol('IDENTITY_RUNTIME');
export interface IdentityRuntime { db: DatabaseClient; auth: Auth; config: RuntimeConfig }
const uuid = z.string().uuid();
const role = z.enum(['OrgAdmin', 'ProjectManager', 'FinanceMaker', 'FinanceApprover', 'Recruiter', 'ProgramManager', 'Trainer', 'InvestmentManager', 'Analyst', 'Viewer']);
const platformRole = z.enum(['Support', 'VerificationReviewer', 'ContentReviewer', 'FinanceOperator', 'RiskReviewer', 'PlatformAdmin', 'Auditor']);

@Controller()
export class IdentityController {
  private readonly service: IdentityService;
  private readonly verificationStorage = new LocalVerificationStorage();
  private readonly logoStorage = new LocalLogoStorage();
  constructor(@Inject(IDENTITY_RUNTIME) private readonly runtime: IdentityRuntime) { this.service = new IdentityService(runtime.db); }

  private session(req: IncomingMessage) { return sessionFrom(this.runtime, req); }

  @Get('me') async me(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: { user: { id: session.user.id, name: session.user.name, email: session.user.email, twoFactorEnabled: Boolean(session.user.twoFactorEnabled) }, profile: await this.service.profile(session.user.id), contexts: await this.service.contexts(session.user.id), platformRoles: await this.service.platformRoles(session.user.id) } };
  }

  @Get('sessions') async sessions(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.accountSessions(session.user.id, session.session.id) };
  }

  @Post('sessions/:id/revoke') async revokeSession(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.revokeSession(session.user.id, session.session.id, uuid.parse(id)) };
  }

  @Get('admin/verifications') async verificationReviewQueue(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.verificationReviewQueue(session.user.id) };
  }

  @Get('admin/bank-change-requests') async bankChangeReviewQueue(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.bankChangeReviewQueue(session.user.id) };
  }

  @Post('admin/bank-change-requests/:requestId/challenge') async createBankChangeReviewChallenge(@Req() req: IncomingMessage, @Param('requestId') requestId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.createBankChangeReviewChallenge(session.user.id, session.session.id, uuid.parse(requestId), version) };
  }

  @Post('admin/bank-change-requests/:requestId/decision') async decideBankChange(@Req() req: IncomingMessage, @Param('requestId') requestId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ outcome: z.enum(['approved', 'rejected']), reason: z.string().trim().max(1000), version: z.number().int().positive(), mfaChallengeId: uuid }).strict().parse(body);
    return { data: await this.service.decideBankChange(session.user.id, session.session.id, uuid.parse(requestId), input) };
  }

  @Get('admin/team') async platformTeam(@Req() req: IncomingMessage) {
    const session = await this.session(req);
    return { data: await this.service.platformTeam(session.user.id) };
  }

  @Post('admin/team/invitations') async invitePlatformStaff(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    if (this.runtime.config.emailMode === 'mailpit') throw new ForbiddenException('Mail delivery is not configured');
    const input = z.object({ email: z.email(), roles: z.array(platformRole).min(1).max(7), grantExpiresAt: z.iso.datetime().transform(value => new Date(value)) }).strict().parse(body);
    return { data: await this.service.invitePlatformStaff(session.user.id, input, this.runtime.config.appBaseUrl) };
  }

  @Post('admin/team/:userId/grants') async replacePlatformGrants(@Req() req: IncomingMessage, @Param('userId') userId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ roles: z.array(platformRole).min(1).max(7), expiresAt: z.iso.datetime().transform(value => new Date(value)), version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.replacePlatformGrants(session.user.id, uuid.parse(userId), input) };
  }

  @Post('admin/team/:userId/revoke') async revokePlatformAccess(@Req() req: IncomingMessage, @Param('userId') userId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.revokePlatformAccess(session.user.id, uuid.parse(userId), version) };
  }

  @Get('platform-invitations/:token') async platformInvitationPreview(@Req() req: IncomingMessage, @Param('token') token: string) {
    const session = await this.session(req);
    return { data: await this.service.platformInvitationPreview(session.user.id, token) };
  }

  @Post('platform-invitations/:token/accept') async acceptPlatformInvitation(@Req() req: IncomingMessage, @Param('token') token: string) {
    const session = await this.session(req);
    return { data: await this.service.acceptPlatformInvitation(session.user.id, token) };
  }

  @Get('admin/verifications/:submissionId') async verificationReview(@Req() req: IncomingMessage, @Param('submissionId') submissionId: string) {
    const session = await this.session(req);
    return { data: await this.service.verificationReview(session.user.id, uuid.parse(submissionId)) };
  }

  @Post('admin/verifications/:submissionId/claim') async claimVerificationReview(@Req() req: IncomingMessage, @Param('submissionId') submissionId: string) {
    const session = await this.session(req);
    return { data: await this.service.claimVerificationReview(session.user.id, uuid.parse(submissionId)) };
  }

  @Post('auth/mfa/challenges') async createMfaChallenge(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ submissionId: uuid, version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.createMfaChallenge(session.user.id, session.session.id, input.submissionId, input.version) };
  }

  @Post('orgs/:id/ownership-transfers/challenge') async createOwnershipTransferChallenge(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.createOwnershipTransferChallenge(session.user.id, session.session.id, uuid.parse(id), version) };
  }

  @Get('orgs/:id/bank-settings') async bankSettings(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.bankSettings(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/bank-change-requests/challenge') async createBankChangeChallenge(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.createBankChangeChallenge(session.user.id, session.session.id, uuid.parse(id), version) };
  }

  @Post('orgs/:id/bank-change-requests') async createBankChangeRequest(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ bankName: z.string().trim().min(2).max(140), accountHolder: z.string().trim().min(2).max(200), iban: z.string().trim().min(15).max(42), country: z.string().trim().regex(/^[A-Za-z]{2}$/), currency: z.string().trim().regex(/^[A-Za-z]{3}$/), version: z.number().int().positive(), mfaChallengeId: uuid }).strict().parse(body);
    return { data: await this.service.createBankChangeRequest(session.user.id, session.session.id, uuid.parse(id), input, this.runtime.config.sessionSecret) };
  }

  @Post('auth/mfa/challenges/:challengeId/verify') async verifyMfaChallenge(@Req() req: IncomingMessage, @Param('challengeId') challengeId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).strict().parse(body);
    try {
      await this.runtime.auth.api.verifyTOTP({ headers: fromNodeHeaders(req.headers), body: { code, trustDevice: false } });
    } catch (error) {
      await this.service.failMfaChallenge(session.user.id, session.session.id, uuid.parse(challengeId));
      throw error;
    }
    return { data: await this.service.verifyMfaChallenge(session.user.id, session.session.id, uuid.parse(challengeId)) };
  }

  @Post('auth/mfa/challenges/:challengeId/recovery-verify') async verifyMfaRecoveryChallenge(@Req() req: IncomingMessage, @Param('challengeId') challengeId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { code } = z.object({ code: z.string().trim().min(6).max(64) }).strict().parse(body);
    try {
      await this.runtime.auth.api.verifyBackupCode({ headers: fromNodeHeaders(req.headers), body: { code, disableSession: false, trustDevice: false } });
    } catch (error) {
      await this.service.failMfaChallenge(session.user.id, session.session.id, uuid.parse(challengeId));
      throw error;
    }
    return { data: await this.service.verifyMfaChallenge(session.user.id, session.session.id, uuid.parse(challengeId)) };
  }

  @Post('auth/mfa/challenges/:challengeId/cancel') async cancelMfaChallenge(@Req() req: IncomingMessage, @Param('challengeId') challengeId: string) {
    const session = await this.session(req);
    return { data: await this.service.cancelMfaChallenge(session.user.id, session.session.id, uuid.parse(challengeId)) };
  }

  @Post('admin/verifications/:submissionId/decision') async decideVerificationReview(@Req() req: IncomingMessage, @Param('submissionId') submissionId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ outcome: z.enum(['changes_requested', 'verified', 'rejected']), publicReason: z.string().trim().max(1000), version: z.number().int().positive(), mfaChallengeId: uuid }).strict().parse(body);
    return { data: await this.service.decideVerificationReview(session.user.id, session.session.id, uuid.parse(submissionId), input) };
  }

  @Patch('me/profile') async profile(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ displayName: z.string().trim().min(2).max(100), city: z.string().trim().max(100), locale: z.enum(['ar', 'en']), capabilities: z.array(z.enum(['Donor', 'Beneficiary', 'JobSeeker', 'Investor', 'Volunteer'])).max(5), version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.updateProfile(session.user.id, input) };
  }

  @Post('me/context') async context(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const { organizationId } = z.object({ organizationId: uuid.nullable() }).strict().parse(body);
    if (organizationId) await this.service.access(session.user.id, organizationId, 'organization.read');
    await this.runtime.db.session.update({ where: { id: session.session.id }, data: { activeOrganizationId: organizationId } });
    return { data: { organizationId } };
  }

  @Post('orgs') async createOrganization(@Req() req: IncomingMessage, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ legalName: z.string().trim().min(2).max(200), displayName: z.string().trim().min(2).max(140), city: z.string().trim().min(2).max(100), country: z.string().regex(/^[A-Z]{2}$/), type: z.enum(['NGO', 'Company', 'Startup', 'Foundation', 'Institution']) }).strict().parse(body);
    return { data: await this.service.createOrganization(session.user.id, input) };
  }

  @Post('orgs/:id/ownership-transfers') async createOwnershipTransfer(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    if (this.runtime.config.emailMode === 'mailpit') throw new ForbiddenException('Mail delivery is not configured');
    const input = z.object({ targetUserId: uuid, version: z.number().int().positive(), mfaChallengeId: uuid }).strict().parse(body);
    return { data: await this.service.createOwnershipTransfer(session.user.id, session.session.id, uuid.parse(id), input, this.runtime.config.appBaseUrl) };
  }

  @Get('ownership-transfers/:token') async ownershipTransferPreview(@Req() req: IncomingMessage, @Param('token') token: string) {
    const session = await this.session(req);
    return { data: await this.service.ownershipTransferPreview(session.user.id, token) };
  }

  @Post('ownership-transfers/:token/accept') async acceptOwnershipTransfer(@Req() req: IncomingMessage, @Param('token') token: string) {
    const session = await this.session(req);
    return { data: await this.service.acceptOwnershipTransfer(session.user.id, token) };
  }

  @Get('orgs/:id') async organization(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.organization(session.user.id, uuid.parse(id)) };
  }

  @Patch('orgs/:id') async updateOrganization(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ displayName: z.string().trim().min(2).max(140), legalName: z.string().trim().min(2).max(200), slug: z.string().trim().min(2).max(90), publicDescription: z.string().trim().max(1200), sectors: z.array(z.string().trim().min(1).max(60)).max(10), contactEmail: z.union([z.email(), z.literal(''), z.null()]).transform(value => value || null), websiteUrl: z.union([z.url(), z.literal(''), z.null()]).transform(value => value || null), contactAddress: z.union([z.string().trim().max(300), z.null()]).transform(value => value || null), city: z.string().trim().min(2).max(100), country: z.string().regex(/^[A-Z]{2}$/), version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.updateOrganization(session.user.id, uuid.parse(id), input) };
  }

  @Get('orgs/:id/public-preview') async publicPreview(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.publicPreview(session.user.id, uuid.parse(id)) };
  }

  @Get('organizations/:slug/logo') async publicLogo(@Req() req: IncomingMessage, @Res() res: ServerResponse, @Param('slug') slug: string) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const logo = await this.service.publicLogo(slug);
    const etag = `"${logo.checksum}"`;
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag, 'Cache-Control': 'public, max-age=3600' }); res.end(); return; }
    const file = await this.logoStorage.readPublic(logo.storageKey);
    res.writeHead(200, { 'Content-Type': logo.contentType, 'Content-Length': file.size, 'Cache-Control': 'public, max-age=3600', ETag: etag, 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
    res.end(file.bytes);
  }

  @Post('orgs/:id/logo/upload-intents') async createLogoUploadIntent(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const session = await this.session(req);
    const input = z.object({ fileName: z.string().trim().min(1).max(255), contentType: z.enum(['image/png', 'image/jpeg']), size: z.number().int().min(24).max(10 * 1024 * 1024), version: z.number().int().positive() }).strict().parse(body);
    const intent = await this.service.createLogoUploadIntent(session.user.id, uuid.parse(id), input);
    return { data: { ...intent, uploadPath: `/orgs/${id}/logo/${intent.id}/content`, finalizePath: `/orgs/${id}/logo/${intent.id}/finalize` } };
  }

  @Put('orgs/:id/logo/:assetId/content') async uploadLogo(@Req() req: IncomingMessage, @Param('id') id: string, @Param('assetId') assetId: string, @Headers('x-upload-token') tokenHeader: string | undefined) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const session = await this.session(req);
    const token = z.string().min(32).max(128).parse(tokenHeader);
    const target = await this.service.logoUploadTarget(session.user.id, uuid.parse(id), uuid.parse(assetId), token);
    const contentLength = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(contentLength) || contentLength !== target.expectedSize || req.headers['content-type'] !== target.contentType) throw new ForbiddenException();
    await this.logoStorage.receive(target.storageKey, req, target.expectedSize);
    await this.service.recordLogoUpload(session.user.id, uuid.parse(id), uuid.parse(assetId), token, target.expectedSize);
    return { data: { id: assetId, received: target.expectedSize } };
  }

  @Post('orgs/:id/logo/:assetId/finalize') async finalizeLogo(@Req() req: IncomingMessage, @Param('id') id: string, @Param('assetId') assetId: string, @Headers('x-upload-token') tokenHeader: string | undefined) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const session = await this.session(req);
    const token = z.string().min(32).max(128).parse(tokenHeader);
    const target = await this.service.logoUploadTarget(session.user.id, uuid.parse(id), uuid.parse(assetId), token, 'finalize');
    const scan = await this.logoStorage.inspectAndPublish(target.storageKey, target.contentType);
    return { data: await this.service.finalizeLogo(session.user.id, uuid.parse(id), uuid.parse(assetId), token, scan) };
  }

  @Get('orgs/:id/verification') async verificationCase(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.verificationCase(session.user.id, uuid.parse(id)) };
  }

  @Patch('orgs/:id/verification') async saveVerificationCase(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ registrationNumber: z.string().trim().max(100), issuingAuthority: z.string().trim().max(200), registeredAddress: z.string().trim().max(300), documentExpiresAt: z.union([z.iso.date(), z.literal(''), z.null()]).transform(value => value ? new Date(`${value}T00:00:00.000Z`) : null), version: z.number().int().nonnegative() }).strict().parse(body);
    return { data: await this.service.saveVerificationCase(session.user.id, uuid.parse(id), input) };
  }

  @Post('orgs/:id/verification/submissions') async submitVerificationCase(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    const { version } = z.object({ version: z.number().int().positive() }).strict().parse(body);
    return { data: await this.service.submitVerificationCase(session.user.id, uuid.parse(id), version) };
  }

  @Post('orgs/:id/verification/documents/upload-intents') async createVerificationUploadIntent(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const session = await this.session(req);
    const input = z.object({ fileName: z.string().trim().min(1).max(255), contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']), size: z.number().int().positive().max(20 * 1024 * 1024), version: z.number().int().positive() }).strict().parse(body);
    const intent = await this.service.createVerificationUploadIntent(session.user.id, uuid.parse(id), input);
    return { data: { ...intent, uploadPath: `/orgs/${id}/verification/documents/${intent.id}/content`, finalizePath: `/orgs/${id}/verification/documents/${intent.id}/finalize` } };
  }

  @Put('orgs/:id/verification/documents/:documentId/content') async uploadVerificationDocument(@Req() req: IncomingMessage, @Param('id') id: string, @Param('documentId') documentId: string, @Headers('x-upload-token') tokenHeader: string | undefined) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const session = await this.session(req);
    const token = z.string().min(32).max(128).parse(tokenHeader);
    const target = await this.service.verificationUploadTarget(session.user.id, uuid.parse(id), uuid.parse(documentId), token);
    const contentLength = Number(req.headers['content-length']);
    if (!Number.isSafeInteger(contentLength) || contentLength !== target.expectedSize || req.headers['content-type'] !== target.contentType) throw new ForbiddenException();
    await this.verificationStorage.receive(target.storageKey, req, target.expectedSize);
    await this.service.recordVerificationUpload(session.user.id, uuid.parse(id), uuid.parse(documentId), token, target.expectedSize);
    return { data: { id: documentId, received: target.expectedSize } };
  }

  @Post('orgs/:id/verification/documents/:documentId/finalize') async finalizeVerificationDocument(@Req() req: IncomingMessage, @Param('id') id: string, @Param('documentId') documentId: string, @Headers('x-upload-token') tokenHeader: string | undefined) {
    if (!['demo', 'test'].includes(this.runtime.config.environment)) throw new ForbiddenException('Local storage is disabled');
    const session = await this.session(req);
    const token = z.string().min(32).max(128).parse(tokenHeader);
    const target = await this.service.verificationUploadTarget(session.user.id, uuid.parse(id), uuid.parse(documentId), token, 'finalize');
    const scan = await this.verificationStorage.inspectAndPromote(target.storageKey, target.contentType);
    return { data: await this.service.finalizeVerificationDocument(session.user.id, uuid.parse(id), uuid.parse(documentId), token, scan) };
  }

  @Get('orgs/:id/verification/decisions') async verificationDecisions(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.verificationDecisions(session.user.id, uuid.parse(id)) };
  }

  @Get('orgs/:id/members') async members(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.members(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/invitations') async invite(@Req() req: IncomingMessage, @Param('id') id: string, @Body() body: unknown) {
    const session = await this.session(req);
    if (this.runtime.config.emailMode === 'mailpit') throw new ForbiddenException('Mail delivery is not configured');
    const input = z.object({ email: z.email(), roles: z.array(role).min(1).max(10) }).strict().parse(body);
    const result = await this.service.invite(session.user.id, uuid.parse(id), input.email, input.roles, this.runtime.config.appBaseUrl);
    return { data: { id: result.id, expiresAt: result.expiresAt } };
  }

  @Get('orgs/:id/invitations') async invitations(@Req() req: IncomingMessage, @Param('id') id: string) {
    const session = await this.session(req);
    return { data: await this.service.invitations(session.user.id, uuid.parse(id)) };
  }

  @Post('orgs/:id/invitations/:invitationId/revoke') async revokeInvitation(@Req() req: IncomingMessage, @Param('id') id: string, @Param('invitationId') invitationId: string) {
    const session = await this.session(req);
    return { data: await this.service.revokeInvitation(session.user.id, uuid.parse(id), uuid.parse(invitationId)) };
  }

  @Post('invitations/:token/accept') async accept(@Req() req: IncomingMessage, @Param('token') token: string) {
    const session = await this.session(req);
    return { data: await this.service.acceptInvitation(session.user.id, token) };
  }

  @Get('invitations/:token') async invitationPreview(@Req() req: IncomingMessage, @Param('token') token: string) {
    const session = await this.session(req);
    return { data: await this.service.invitationPreview(session.user.id, token) };
  }

  @Post('invitations/:token/decline') async declineInvitation(@Req() req: IncomingMessage, @Param('token') token: string) {
    const session = await this.session(req);
    return { data: await this.service.declineInvitation(session.user.id, token) };
  }

  @Patch('orgs/:id/members/:userId') async changeMember(@Req() req: IncomingMessage, @Param('id') id: string, @Param('userId') userId: string, @Body() body: unknown) {
    const session = await this.session(req);
    const input = z.object({ roles: z.array(role).min(1).max(10), status: z.enum(['active', 'suspended']), version: z.number().int().positive() }).strict().parse(body);
    const result = await this.service.changeMembership(session.user.id, uuid.parse(id), uuid.parse(userId), input);
    return { data: result };
  }
}
