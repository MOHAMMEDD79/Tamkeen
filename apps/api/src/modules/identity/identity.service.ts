import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { DatabaseClient, User, IndividualProfile, Organization, Membership } from '@tamkeen/database';
import { assertDelegation, assertPermission, IdentityError, permissionsFor, type Permission, type Role } from './policy.js';
import { BankIdentifierError, normalizedIban, protectBankIdentifier, sameBankIdentifier } from './bank-identifier.js';

const capabilities = ['Donor', 'Beneficiary', 'JobSeeker', 'Investor', 'Volunteer'] as const;
const organizationTypes = ['NGO', 'Company', 'Startup', 'Foundation', 'Institution'] as const;
const platformRoleValues = ['Support', 'VerificationReviewer', 'ContentReviewer', 'FinanceOperator', 'RiskReviewer', 'PlatformAdmin', 'Auditor', 'Operations'] as const;
type OrganizationType = typeof organizationTypes[number];
type Capability = typeof capabilities[number];
type PlatformRoleValue = typeof platformRoleValues[number];
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const invitationHash = (token: string) => {
  if (typeof token !== 'string' || token.length < 32 || token.length > 128) throw new IdentityError('invitation_unavailable', 409);
  return hashToken(token);
};
function platformRolesInput(roles: PlatformRoleValue[]) {
  if (!Array.isArray(roles) || !roles.length || roles.length > platformRoleValues.length || roles.some(role => !platformRoleValues.includes(role)) || new Set(roles).size !== roles.length) throw new IdentityError('invalid_input', 422);
  if ((roles.includes('Auditor') && roles.length > 1) || (roles.includes('FinanceOperator') && (roles.includes('RiskReviewer') || roles.includes('PlatformAdmin')))) throw new IdentityError('forbidden', 403);
  return roles;
}
function temporaryGrantExpiry(value: Date) {
  const minimum = Date.now() + 15 * 60_000;
  const maximum = Date.now() + 90 * 24 * 3600_000;
  if (!(value instanceof Date) || Number.isNaN(value.getTime()) || value.getTime() < minimum || value.getTime() > maximum) throw new IdentityError('invalid_input', 422);
  return value;
}
const bankIdentifier = (value: string, country: string, secret: string) => {
  try { return protectBankIdentifier(normalizedIban(value, country), secret); }
  catch (error) { if (error instanceof BankIdentifierError) throw new IdentityError('invalid_input', 422); throw error; }
};
const publicSlug = (displayName: string) => `${displayName.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'organization'}-${randomBytes(5).toString('hex')}`;
function text(value: string, max: number, min = 2) {
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) throw new IdentityError('invalid_input', 422);
  return value.trim();
}

/** Domain service. actorId comes from the verified session, never an HTTP body. */
export class IdentityService {
  constructor(private readonly db: DatabaseClient) {}

  async activeUser(actorId: string): Promise<User> {
    const user = await this.db.user.findUnique({ where: { id: actorId } });
    if (!user || user.status !== 'active') throw new IdentityError('unauthenticated', 401);
    return user;
  }

  async platformRoles(actorId: string) {
    await this.activeUser(actorId);
    const grants = await this.db.platformGrant.findMany({ where: { userId: actorId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { role: true }, orderBy: { createdAt: 'asc' } });
    return [...new Set(grants.map(grant => grant.role))];
  }

  private async platformAdministrator(actorId: string) {
    const user = await this.activeUser(actorId);
    const grant = await this.db.platformGrant.findFirst({ where: { userId: actorId, role: 'PlatformAdmin', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!grant || !user.twoFactorEnabled) throw new IdentityError('forbidden', 403);
    return user;
  }

  /**
   * PART-07. Platform finance operations (executing a payout, running reconciliation, inquiring of
   * the provider) are a platform grant with MFA, not an organisation role: the organisation asks
   * and approves, the platform moves the money, and neither side can do both.
   */
  async financeOperatorUser(actorId: string) {
    return this.financeOperator(actorId);
  }

  /**
   * PART-08. Investment and eligibility review is a platform RiskReviewer grant with MFA. It is
   * deliberately not an organisation role: an offering is judged by someone outside the company
   * raising the money, for the same reason a project is (05).
   */
  async riskReviewerUser(actorId: string) {
    const user = await this.activeUser(actorId);
    const grant = await this.db.platformGrant.findFirst({ where: { userId: actorId, role: 'RiskReviewer', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!grant || !user.twoFactorEnabled) throw new IdentityError('forbidden', 403);
    return user;
  }

  /**
   * PART-10. Programme review is a platform ContentReviewer grant with MFA, for the same reason a
   * project's is (05): a training plan that promises work to people is judged by somebody who does
   * not run it. The caller still has to check that the reviewer is not inside the operator.
   */
  async contentReviewerUser(actorId: string) {
    const user = await this.activeUser(actorId);
    const grant = await this.db.platformGrant.findFirst({ where: { userId: actorId, role: 'ContentReviewer', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!grant || !user.twoFactorEnabled) throw new IdentityError('forbidden', 403);
    return user;
  }

  private async financeOperator(actorId: string) {
    const user = await this.activeUser(actorId);
    const grant = await this.db.platformGrant.findFirst({ where: { userId: actorId, role: 'FinanceOperator', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!grant || !user.twoFactorEnabled) throw new IdentityError('forbidden', 403);
    return user;
  }

  async platformTeam(actorId: string) {
    await this.platformAdministrator(actorId);
    const now = new Date();
    const [grants, invitations] = await Promise.all([
      this.db.platformGrant.findMany({ where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], user: { status: 'active' } }, select: { id: true, role: true, expiresAt: true, createdAt: true, user: { select: { id: true, name: true, email: true, twoFactorEnabled: true, platformAccessVersion: true } } }, orderBy: { createdAt: 'asc' } }),
      this.db.platformAccessInvitation.findMany({ where: { consumedAt: null, revokedAt: null, expiresAt: { gt: now } }, select: { id: true, email: true, roles: true, grantExpiresAt: true, expiresAt: true, createdAt: true }, orderBy: { createdAt: 'desc' } })
    ]);
    const members = new Map<string, { user: typeof grants[number]['user']; grants: Array<{ id: string; role: PlatformRoleValue; expiresAt: Date | null }> }>();
    for (const grant of grants) {
      const member = members.get(grant.user.id) ?? { user: grant.user, grants: [] };
      member.grants.push({ id: grant.id, role: grant.role, expiresAt: grant.expiresAt });
      members.set(grant.user.id, member);
    }
    return { members: [...members.values()], invitations };
  }

  async invitePlatformStaff(actorId: string, input: { email: string; roles: PlatformRoleValue[]; grantExpiresAt: Date }, localDeliveryBaseUrl?: string) {
    const email = normalizeEmail(input.email);
    const roles = platformRolesInput(input.roles);
    const grantExpiresAt = temporaryGrantExpiry(input.grantExpiresAt);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !localDeliveryBaseUrl) throw new IdentityError('invalid_input', 422);
    const token = randomBytes(32).toString('base64url');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const actor = await scoped.platformAdministrator(actorId);
      if (actor.email === email) throw new IdentityError('forbidden', 403);
      const target = await tx.user.findUnique({ where: { email } });
      if (target?.status !== undefined && target.status !== 'active') throw new IdentityError('conflict', 409);
      if (target && await tx.platformGrant.count({ where: { userId: target.id, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })) throw new IdentityError('conflict', 409);
      if (await tx.platformAccessInvitation.count({ where: { email, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } })) throw new IdentityError('conflict', 409);
      const invitation = await tx.platformAccessInvitation.create({ data: { email, roles, tokenHash: hashToken(token), grantExpiresAt, expiresAt: new Date(Date.now() + 48 * 3600_000), createdBy: actorId } });
      await tx.localAuthMail.create({ data: { recipient: email, purpose: 'platform-invitation', url: `${localDeliveryBaseUrl}/platform-invitations/${token}` } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: invitation.id, action: 'platform_invitation.created' } });
      return { id: invitation.id, expiresAt: invitation.expiresAt };
    });
  }

  async platformInvitationPreview(actorId: string, token: string) {
    const user = await this.activeUser(actorId);
    const invitation = await this.db.platformAccessInvitation.findUnique({ where: { tokenHash: invitationHash(token) }, select: { email: true, roles: true, grantExpiresAt: true, expiresAt: true, consumedAt: true, revokedAt: true, creator: { select: { name: true } } } });
    if (!invitation) throw new IdentityError('invitation_unavailable', 409);
    if (!user.emailVerified || user.email !== invitation.email) throw new IdentityError('forbidden', 403);
    const status = invitation.consumedAt ? 'accepted' : invitation.revokedAt ? 'revoked' : invitation.expiresAt <= new Date() || invitation.grantExpiresAt <= new Date() ? 'expired' : 'pending';
    return { roles: invitation.roles, grantExpiresAt: invitation.grantExpiresAt, expiresAt: invitation.expiresAt, inviter: { name: invitation.creator.name }, requiresMfaSetup: !user.twoFactorEnabled, status };
  }

  async acceptPlatformInvitation(actorId: string, token: string) {
    return this.db.$transaction(async tx => {
      const invitation = await tx.platformAccessInvitation.findUnique({ where: { tokenHash: invitationHash(token) } });
      if (!invitation) throw new IdentityError('invitation_unavailable', 409);
      await tx.$queryRaw`SELECT id FROM platform_access_invitations WHERE id = ${invitation.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actorId } });
      if (!user || user.status !== 'active' || !user.emailVerified || !user.twoFactorEnabled || user.email !== invitation.email) throw new IdentityError('forbidden', 403);
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.platformAdministrator(invitation.createdBy);
      platformRolesInput(invitation.roles);
      if (invitation.grantExpiresAt <= new Date() || await tx.platformGrant.count({ where: { userId: actorId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } })) throw new IdentityError('conflict', 409);
      const consumed = await tx.platformAccessInvitation.updateMany({ where: { id: invitation.id, consumedAt: null, revokedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new IdentityError('invitation_unavailable', 409);
      await tx.platformGrant.createMany({ data: invitation.roles.map(role => ({ userId: actorId, role, grantedBy: invitation.createdBy, expiresAt: invitation.grantExpiresAt })) });
      await tx.user.update({ where: { id: actorId }, data: { platformAccessVersion: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: invitation.id, action: 'platform_invitation.accepted' } });
      return { status: 'accepted' as const, roles: invitation.roles };
    });
  }

  async replacePlatformGrants(actorId: string, targetUserId: string, input: { roles: PlatformRoleValue[]; expiresAt: Date; version: number }) {
    const roles = platformRolesInput(input.roles);
    const expiresAt = temporaryGrantExpiry(input.expiresAt);
    if (actorId === targetUserId) throw new IdentityError('forbidden', 403);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${targetUserId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.platformAdministrator(actorId);
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target || target.status !== 'active' || !target.twoFactorEnabled) throw new IdentityError('not_found', 404);
      if (target.platformAccessVersion !== input.version) throw new IdentityError('conflict', 409);
      await tx.platformGrant.updateMany({ where: { userId: targetUserId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.platformGrant.createMany({ data: roles.map(role => ({ userId: targetUserId, role, grantedBy: actorId, expiresAt })) });
      const updated = await tx.user.update({ where: { id: targetUserId }, data: { platformAccessVersion: { increment: 1 } }, select: { platformAccessVersion: true } });
      await tx.session.deleteMany({ where: { userId: targetUserId } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: targetUserId, action: 'platform_grants.replaced' } });
      return { userId: targetUserId, roles, expiresAt, version: updated.platformAccessVersion };
    });
  }

  async revokePlatformAccess(actorId: string, targetUserId: string, version: number) {
    if (actorId === targetUserId) throw new IdentityError('forbidden', 403);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${targetUserId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.platformAdministrator(actorId);
      const target = await tx.user.findUnique({ where: { id: targetUserId } });
      if (!target || target.platformAccessVersion !== version) throw new IdentityError('conflict', 409);
      const revoked = await tx.platformGrant.updateMany({ where: { userId: targetUserId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { revokedAt: new Date() } });
      if (!revoked.count) throw new IdentityError('not_found', 404);
      await tx.session.deleteMany({ where: { userId: targetUserId } });
      const updated = await tx.user.update({ where: { id: targetUserId }, data: { platformAccessVersion: { increment: 1 } }, select: { platformAccessVersion: true } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: targetUserId, action: 'platform_access.revoked' } });
      return { userId: targetUserId, status: 'revoked' as const, version: updated.platformAccessVersion };
    });
  }

  async accountSessions(actorId: string, currentSessionId: string) {
    await this.activeUser(actorId);
    const sessions = await this.db.session.findMany({
      where: { userId: actorId, expiresAt: { gt: new Date() } },
      select: { id: true, createdAt: true, updatedAt: true, expiresAt: true, ipAddress: true, userAgent: true, activeOrganizationId: true },
      orderBy: { updatedAt: 'desc' }
    });
    return sessions.map(session => ({ ...session, current: session.id === currentSessionId }));
  }

  async revokeSession(actorId: string, currentSessionId: string, targetSessionId: string) {
    await this.activeUser(actorId);
    return this.db.$transaction(async tx => {
      const revoked = await tx.session.deleteMany({ where: { id: targetSessionId, userId: actorId } });
      if (revoked.count !== 1) throw new IdentityError('not_found', 404);
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: targetSessionId, action: 'session.revoked' } });
      return { id: targetSessionId, current: targetSessionId === currentSessionId, status: 'revoked' as const };
    });
  }

  private async verificationReviewer(actorId: string) {
    const user = await this.activeUser(actorId);
    const grant = await this.db.platformGrant.findFirst({ where: { userId: actorId, role: 'VerificationReviewer', revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] } });
    if (!grant || !user.twoFactorEnabled) throw new IdentityError('forbidden', 403);
    return user;
  }

  async access(actorId: string, organizationId: string, permission: Permission, makerId?: string): Promise<Membership & { user: User; organization: Organization }> {
    const membership = await this.db.membership.findUnique({ where: { userId_organizationId: { userId: actorId, organizationId } }, include: { user: true, organization: true } });
    if (!membership) throw new IdentityError('forbidden', 403);
    assertPermission({ actorId, userStatus: membership.user.status, organizationStatus: membership.organization.status, membershipStatus: membership.status, roles: membership.roles, permission, ...(makerId ? { makerId } : {}) });
    return membership;
  }

  async profile(actorId: string): Promise<IndividualProfile> {
    await this.activeUser(actorId);
    return this.db.individualProfile.findUniqueOrThrow({ where: { userId: actorId } });
  }

  async updateProfile(actorId: string, input: { displayName: string; city: string; locale: string; capabilities: Capability[]; version: number }): Promise<IndividualProfile> {
    await this.activeUser(actorId);
    const displayName = text(input.displayName, 100);
    const city = text(input.city, 100, 0);
    if (!['ar', 'en'].includes(input.locale) || !Array.isArray(input.capabilities) || input.capabilities.some(c => !capabilities.includes(c)) || new Set(input.capabilities).size !== input.capabilities.length) throw new IdentityError('invalid_input', 422);
    const updated = await this.db.individualProfile.updateMany({ where: { userId: actorId, version: input.version }, data: { displayName, city, locale: input.locale, capabilities: input.capabilities, version: { increment: 1 } } });
    if (updated.count !== 1) throw new IdentityError('conflict', 409);
    return this.profile(actorId);
  }

  async contexts(actorId: string): Promise<Array<{ organization: Pick<Organization, 'id' | 'displayName' | 'type'>; roles: Role[]; permissions: Permission[] }>> {
    await this.activeUser(actorId);
    const memberships = await this.db.membership.findMany({ where: { userId: actorId, status: 'active', organization: { status: 'active' } }, include: { organization: { select: { id: true, displayName: true, type: true } } }, orderBy: { createdAt: 'asc' } });
    return memberships.map(m => ({ organization: m.organization, roles: m.roles, permissions: [...permissionsFor(m.roles)] }));
  }

  async createOrganization(actorId: string, input: { legalName: string; displayName: string; type: OrganizationType; country: string; city: string }): Promise<Organization> {
    const legalName = text(input.legalName, 200);
    const displayName = text(input.displayName, 140);
    const city = text(input.city, 100);
    if (!organizationTypes.includes(input.type) || !/^[A-Z]{2}$/.test(input.country)) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actorId } });
      if (!user || user.status !== 'active' || !user.emailVerified) throw new IdentityError('forbidden', 403);
      const org = await tx.organization.create({ data: { legalName, displayName, slug: publicSlug(displayName), city, type: input.type, country: input.country, createdBy: actorId } });
      await tx.party.create({ data: { organizationId: org.id } });
      await tx.membership.create({ data: { userId: actorId, organizationId: org.id, roles: ['Owner'] } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: org.id, resourceId: org.id, action: 'organization.created' } });
      return org;
    });
  }

  async organization(actorId: string, organizationId: string): Promise<Pick<Organization, 'id' | 'displayName' | 'legalName' | 'slug' | 'publicDescription' | 'sectors' | 'contactEmail' | 'websiteUrl' | 'contactAddress' | 'type' | 'country' | 'city' | 'verification' | 'version' | 'currentLogoId'> & { logoUrl: string | null }> {
    const membership = await this.access(actorId, organizationId, 'organization.read');
    const { id, displayName, legalName, slug, publicDescription, sectors, contactEmail, websiteUrl, contactAddress, type, country, city, verification, version, currentLogoId } = membership.organization;
    return { id, displayName, legalName, slug, publicDescription, sectors, contactEmail, websiteUrl, contactAddress, type, country, city, verification, version, currentLogoId, logoUrl: currentLogoId ? `/api/v1/organizations/${encodeURIComponent(slug)}/logo` : null };
  }

  async updateOrganization(actorId: string, organizationId: string, input: { displayName: string; legalName: string; slug: string; publicDescription: string; sectors: string[]; contactEmail: string | null; websiteUrl: string | null; contactAddress: string | null; country: string; city: string; version: number }) {
    const displayName = text(input.displayName, 140);
    const legalName = text(input.legalName, 200);
    const city = text(input.city, 100);
    const slug = input.slug.trim().toLowerCase();
    const publicDescription = input.publicDescription.trim();
    const sectors = input.sectors.map(value => value.trim()).filter(Boolean);
    const contactEmail = input.contactEmail ? normalizeEmail(input.contactEmail) : null;
    const websiteUrl = input.websiteUrl?.trim() || null;
    const contactAddress = input.contactAddress?.trim() || null;
    if (!/^[A-Z]{2}$/.test(input.country) || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || slug.length > 90 || publicDescription.length > 1200 || sectors.length > 10 || sectors.some(value => value.length > 60) || new Set(sectors).size !== sectors.length || (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) || (contactEmail?.length ?? 0) > 254 || (contactAddress?.length ?? 0) > 300) throw new IdentityError('invalid_input', 422);
    if (websiteUrl) {
      try { const parsed = new URL(websiteUrl); if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error(); } catch { throw new IdentityError('invalid_input', 422); }
    }
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const current = (await scoped.access(actorId, organizationId, 'organization.manage')).organization;
      if (current.version !== input.version) throw new IdentityError('conflict', 409);
      const legalNameChanged = current.legalName !== legalName;
      const updated = await tx.organization.update({ where: { id: organizationId }, data: { displayName, legalName, slug, publicDescription, sectors, contactEmail, websiteUrl, contactAddress, country: input.country, city, version: { increment: 1 }, ...(legalNameChanged && current.verification === 'verified' ? { verification: 'changes_requested' as const } : {}) } }).catch(error => { if ((error as { code?: string }).code === 'P2002') throw new IdentityError('conflict', 409); throw error; });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: organizationId, action: legalNameChanged ? 'organization.legal_name_changed' : 'organization.updated' } });
      return updated;
    });
  }

  async createOwnershipTransferChallenge(actorId: string, sessionId: string, organizationId: string, version: number) {
    const membership = await this.access(actorId, organizationId, 'ownership.transfer');
    if (!membership.user.twoFactorEnabled || membership.organization.version !== version) throw new IdentityError('conflict', 409);
    await this.db.mfaChallenge.updateMany({ where: { userId: actorId, sessionId, operation: 'ownership.transfer.request', resourceId: organizationId, state: { in: ['pending', 'verified'] } }, data: { state: 'cancelled' } });
    return this.db.mfaChallenge.create({ data: { userId: actorId, sessionId, operation: 'ownership.transfer.request', resourceId: organizationId, resourceVersion: version, expiresAt: new Date(Date.now() + 5 * 60_000) }, select: { id: true, operation: true, resourceId: true, resourceVersion: true, expiresAt: true, state: true } });
  }

  async createOwnershipTransfer(actorId: string, sessionId: string, organizationId: string, input: { targetUserId: string; version: number; mfaChallengeId: string }, localDeliveryBaseUrl?: string) {
    if (actorId === input.targetUserId || !localDeliveryBaseUrl) throw new IdentityError('invalid_input', 422);
    const token = randomBytes(32).toString('base64url');
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const owner = await scoped.access(actorId, organizationId, 'ownership.transfer');
      if (!owner.user.twoFactorEnabled || owner.organization.version !== input.version) throw new IdentityError('conflict', 409);
      const challenge = await tx.mfaChallenge.findFirst({ where: { id: input.mfaChallengeId, userId: actorId, sessionId, operation: 'ownership.transfer.request', resourceId: organizationId, resourceVersion: input.version, state: 'verified', expiresAt: { gt: new Date() } } });
      if (!challenge) throw new IdentityError('mfa_unavailable', 409);
      const target = await tx.membership.findUnique({ where: { userId_organizationId: { userId: input.targetUserId, organizationId } }, include: { user: true } });
      if (!target || target.status !== 'active' || target.user.status !== 'active' || !target.user.emailVerified || target.roles.includes('Owner')) throw new IdentityError('not_found', 404);
      await tx.organizationOwnershipTransfer.updateMany({ where: { organizationId, state: 'pending', expiresAt: { lte: new Date() } }, data: { state: 'expired' } });
      if (await tx.organizationOwnershipTransfer.count({ where: { organizationId, state: 'pending' } })) throw new IdentityError('conflict', 409);
      const consumed = await tx.mfaChallenge.updateMany({ where: { id: challenge.id, state: 'verified', consumedAt: null }, data: { state: 'consumed', consumedAt: new Date() } });
      if (consumed.count !== 1) throw new IdentityError('mfa_unavailable', 409);
      const transfer = await tx.organizationOwnershipTransfer.create({ data: { organizationId, organizationVersion: input.version, currentOwnerId: actorId, newOwnerId: input.targetUserId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 48 * 3600_000) } });
      await tx.localAuthMail.create({ data: { recipient: target.user.email, purpose: 'ownership-transfer', url: `${localDeliveryBaseUrl}/ownership-transfers/${token}` } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: transfer.id, action: 'ownership_transfer.requested' } });
      return { id: transfer.id, expiresAt: transfer.expiresAt, status: transfer.state };
    });
  }

  async ownershipTransferPreview(actorId: string, token: string) {
    const user = await this.activeUser(actorId);
    const transfer = await this.db.organizationOwnershipTransfer.findUnique({ where: { tokenHash: invitationHash(token) }, select: { newOwnerId: true, state: true, expiresAt: true, organization: { select: { id: true, displayName: true, type: true, city: true, country: true } }, currentOwner: { select: { name: true } } } });
    if (!transfer) throw new IdentityError('transfer_unavailable', 409);
    if (transfer.newOwnerId !== actorId || !user.emailVerified) throw new IdentityError('forbidden', 403);
    const status = transfer.state === 'accepted' ? 'accepted' : transfer.state === 'expired' || transfer.expiresAt <= new Date() ? 'expired' : 'pending';
    return { organization: transfer.organization, currentOwner: transfer.currentOwner, expiresAt: transfer.expiresAt, requiresMfaSetup: !user.twoFactorEnabled, status };
  }

  async acceptOwnershipTransfer(actorId: string, token: string) {
    return this.db.$transaction(async tx => {
      const transfer = await tx.organizationOwnershipTransfer.findUnique({ where: { tokenHash: invitationHash(token) } });
      if (!transfer) throw new IdentityError('transfer_unavailable', 409);
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${transfer.organizationId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actorId } });
      const organization = await tx.organization.findUnique({ where: { id: transfer.organizationId } });
      const currentOwner = await tx.membership.findUnique({ where: { userId_organizationId: { userId: transfer.currentOwnerId, organizationId: transfer.organizationId } } });
      const newOwner = await tx.membership.findUnique({ where: { userId_organizationId: { userId: actorId, organizationId: transfer.organizationId } } });
      if (!user || user.status !== 'active' || !user.emailVerified || !user.twoFactorEnabled || transfer.newOwnerId !== actorId) throw new IdentityError('forbidden', 403);
      if (!organization || organization.status !== 'active' || organization.version !== transfer.organizationVersion || !currentOwner || currentOwner.status !== 'active' || !currentOwner.roles.includes('Owner') || !newOwner || newOwner.status !== 'active' || newOwner.roles.includes('Owner')) throw new IdentityError('conflict', 409);
      const accepted = await tx.organizationOwnershipTransfer.updateMany({ where: { id: transfer.id, state: 'pending', acceptedAt: null, expiresAt: { gt: new Date() } }, data: { state: 'accepted', acceptedAt: new Date() } });
      if (accepted.count !== 1) throw new IdentityError('transfer_unavailable', 409);
      const newOwnerRoles = [...new Set([...newOwner.roles, 'Owner' as const])];
      const formerOwnerRoles = currentOwner.roles.filter(role => role !== 'Owner');
      await tx.membership.update({ where: { id: newOwner.id }, data: { roles: newOwnerRoles, version: { increment: 1 } } });
      await tx.membership.update({ where: { id: currentOwner.id }, data: { roles: formerOwnerRoles.length ? formerOwnerRoles : ['OrgAdmin'], version: { increment: 1 } } });
      await tx.organization.update({ where: { id: transfer.organizationId }, data: { version: { increment: 1 } } });
      await tx.session.deleteMany({ where: { userId: { in: [transfer.currentOwnerId, actorId] } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: transfer.organizationId, resourceId: transfer.id, action: 'ownership_transfer.accepted' } });
      return { organizationId: transfer.organizationId, status: 'accepted' as const, requiresReauthentication: true };
    });
  }

  async bankSettings(actorId: string, organizationId: string) {
    await this.access(actorId, organizationId, 'bank.manage');
    const [activeAccount, requests] = await Promise.all([
      this.db.organizationBankAccount.findUnique({ where: { organizationId }, select: { id: true, bankName: true, accountHolder: true, accountLast4: true, country: true, currency: true, updatedAt: true } }),
      this.db.organizationBankChangeRequest.findMany({ where: { organizationId }, select: { id: true, bankName: true, accountHolder: true, accountLast4: true, country: true, currency: true, state: true, version: true, reviewReason: true, createdAt: true, reviewedAt: true }, orderBy: { createdAt: 'desc' }, take: 20 })
    ]);
    return { activeAccount, requests };
  }

  async createBankChangeChallenge(actorId: string, sessionId: string, organizationId: string, version: number) {
    const membership = await this.access(actorId, organizationId, 'bank.manage');
    if (!membership.user.twoFactorEnabled || membership.organization.version !== version) throw new IdentityError('conflict', 409);
    await this.db.mfaChallenge.updateMany({ where: { userId: actorId, sessionId, operation: 'bank_change.request', resourceId: organizationId, state: { in: ['pending', 'verified'] } }, data: { state: 'cancelled' } });
    return this.db.mfaChallenge.create({ data: { userId: actorId, sessionId, operation: 'bank_change.request', resourceId: organizationId, resourceVersion: version, expiresAt: new Date(Date.now() + 5 * 60_000) }, select: { id: true, operation: true, resourceId: true, resourceVersion: true, expiresAt: true, state: true } });
  }

  async createBankChangeRequest(actorId: string, sessionId: string, organizationId: string, input: { bankName: string; accountHolder: string; iban: string; country: string; currency: string; version: number; mfaChallengeId: string }, encryptionSecret: string) {
    const bankName = text(input.bankName, 140);
    const accountHolder = text(input.accountHolder, 200);
    const country = input.country.toUpperCase();
    const currency = input.currency.toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new IdentityError('invalid_input', 422);
    const protectedIdentifier = bankIdentifier(input.iban, country, encryptionSecret);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const membership = await scoped.access(actorId, organizationId, 'bank.manage');
      if (!membership.user.twoFactorEnabled || membership.organization.version !== input.version) throw new IdentityError('conflict', 409);
      const challenge = await tx.mfaChallenge.findFirst({ where: { id: input.mfaChallengeId, userId: actorId, sessionId, operation: 'bank_change.request', resourceId: organizationId, resourceVersion: input.version, state: 'verified', expiresAt: { gt: new Date() } } });
      if (!challenge) throw new IdentityError('mfa_unavailable', 409);
      if (await tx.organizationBankChangeRequest.count({ where: { organizationId, state: 'pending' } })) throw new IdentityError('conflict', 409);
      const current = await tx.organizationBankAccount.findUnique({ where: { organizationId }, select: { accountIdentifierHash: true } });
      if (current && sameBankIdentifier(current.accountIdentifierHash, protectedIdentifier.hash)) throw new IdentityError('conflict', 409);
      const consumed = await tx.mfaChallenge.updateMany({ where: { id: challenge.id, state: 'verified', consumedAt: null }, data: { state: 'consumed', consumedAt: new Date() } });
      if (consumed.count !== 1) throw new IdentityError('mfa_unavailable', 409);
      const request = await tx.organizationBankChangeRequest.create({ data: { organizationId, organizationVersion: input.version, requestedBy: actorId, bankName, accountHolder, accountIdentifierCiphertext: protectedIdentifier.ciphertext, accountIdentifierHash: protectedIdentifier.hash, accountLast4: protectedIdentifier.last4, country, currency } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: request.id, action: 'bank_change.requested' } });
      return { id: request.id, state: request.state, version: request.version, accountLast4: request.accountLast4, createdAt: request.createdAt };
    });
  }

  async bankChangeReviewQueue(actorId: string) {
    await this.financeOperator(actorId);
    const requests = await this.db.organizationBankChangeRequest.findMany({ where: { state: 'pending' }, select: { id: true, bankName: true, accountHolder: true, accountLast4: true, country: true, currency: true, state: true, version: true, organizationVersion: true, createdAt: true, organization: { select: { id: true, displayName: true, verification: true, country: true, version: true } }, requester: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } });
    // A request reviewed against a since-edited organisation is shown but not decidable: the
    // reviewer judged an identity that no longer matches, so the organisation must resubmit.
    return requests.map(request => ({ ...request, stale: request.organizationVersion !== request.organization.version }));
  }

  async createBankChangeReviewChallenge(actorId: string, sessionId: string, requestId: string, version: number) {
    await this.financeOperator(actorId);
    const request = await this.db.organizationBankChangeRequest.findUnique({ where: { id: requestId }, select: { requestedBy: true, state: true, version: true } });
    if (!request || request.state !== 'pending' || request.version !== version || request.requestedBy === actorId) throw new IdentityError('conflict', 409);
    await this.db.mfaChallenge.updateMany({ where: { userId: actorId, sessionId, operation: 'bank_change.review', resourceId: requestId, state: { in: ['pending', 'verified'] } }, data: { state: 'cancelled' } });
    return this.db.mfaChallenge.create({ data: { userId: actorId, sessionId, operation: 'bank_change.review', resourceId: requestId, resourceVersion: version, expiresAt: new Date(Date.now() + 5 * 60_000) }, select: { id: true, operation: true, resourceId: true, resourceVersion: true, expiresAt: true, state: true } });
  }

  async decideBankChange(actorId: string, sessionId: string, requestId: string, input: { outcome: 'approved' | 'rejected'; reason: string; version: number; mfaChallengeId: string }) {
    await this.financeOperator(actorId);
    const reviewReason = text(input.reason, 1000, input.outcome === 'approved' ? 0 : 10);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organization_bank_change_requests WHERE id = ${requestId}::uuid FOR UPDATE`;
      const request = await tx.organizationBankChangeRequest.findUnique({ where: { id: requestId }, include: { organization: true } });
      if (!request) throw new IdentityError('not_found', 404);
      const challenge = await tx.mfaChallenge.findFirst({ where: { id: input.mfaChallengeId, userId: actorId, sessionId, operation: 'bank_change.review', resourceId: requestId, resourceVersion: input.version, state: 'verified', expiresAt: { gt: new Date() } } });
      if (request.state !== 'pending' || request.version !== input.version || request.requestedBy === actorId || request.organization.status !== 'active' || !challenge) throw new IdentityError('conflict', 409);
      if (request.organizationVersion !== request.organization.version) throw new IdentityError('conflict', 409);
      const consumed = await tx.mfaChallenge.updateMany({ where: { id: challenge.id, state: 'verified', consumedAt: null }, data: { state: 'consumed', consumedAt: new Date() } });
      if (consumed.count !== 1) throw new IdentityError('mfa_unavailable', 409);
      const reviewedAt = new Date();
      await tx.organizationBankChangeRequest.update({ where: { id: request.id }, data: { state: input.outcome, reviewedBy: actorId, reviewedAt, reviewReason, version: { increment: 1 } } });
      if (input.outcome === 'approved') await tx.organizationBankAccount.upsert({
        where: { organizationId: request.organizationId },
        create: { organizationId: request.organizationId, sourceRequestId: request.id, bankName: request.bankName, accountHolder: request.accountHolder, accountIdentifierCiphertext: request.accountIdentifierCiphertext, accountIdentifierHash: request.accountIdentifierHash, accountLast4: request.accountLast4, country: request.country, currency: request.currency },
        update: { sourceRequestId: request.id, bankName: request.bankName, accountHolder: request.accountHolder, accountIdentifierCiphertext: request.accountIdentifierCiphertext, accountIdentifierHash: request.accountIdentifierHash, accountLast4: request.accountLast4, country: request.country, currency: request.currency }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: request.organizationId, resourceId: request.id, action: `bank_change.${input.outcome}` } });
      return { id: request.id, state: input.outcome, reviewedAt, activeAccountChanged: input.outcome === 'approved' };
    });
  }

  async publicPreview(actorId: string, organizationId: string) {
    const organization = (await this.access(actorId, organizationId, 'organization.manage')).organization;
    return { id: organization.id, displayName: organization.displayName, slug: organization.slug, logoUrl: organization.currentLogoId ? `/api/v1/organizations/${encodeURIComponent(organization.slug)}/logo` : null, publicDescription: organization.publicDescription, sectors: organization.sectors, contactEmail: organization.contactEmail, websiteUrl: organization.websiteUrl, contactAddress: organization.contactAddress, type: organization.type, country: organization.country, city: organization.city, verification: organization.verification };
  }

  async createLogoUploadIntent(actorId: string, organizationId: string, input: { fileName: string; contentType: string; size: number; version: number }) {
    const fileName = text(input.fileName.normalize('NFKC'), 255, 1);
    if (!['image/png', 'image/jpeg'].includes(input.contentType) || !Number.isSafeInteger(input.size) || input.size < 24 || input.size > 10 * 1024 * 1024 || fileName.includes('/') || fileName.includes('\\') || [...fileName].some(character => character.charCodeAt(0) < 32)) throw new IdentityError('invalid_input', 422);
    const token = randomBytes(32).toString('base64url');
    const assetId = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const organization = (await scoped.access(actorId, organizationId, 'organization.manage')).organization;
      if (organization.version !== input.version) throw new IdentityError('conflict', 409);
      const pending = await tx.organizationLogoAsset.count({ where: { organizationId, scanState: 'pending_scan', uploadExpiresAt: { gt: new Date() } } });
      if (pending >= 3) throw new IdentityError('conflict', 409);
      const asset = await tx.organizationLogoAsset.create({ data: { id: assetId, organizationId, organizationVersion: organization.version, fileName, contentType: input.contentType, expectedSize: input.size, storageKey: `logos/${organizationId}/${assetId}.bin`, uploadTokenHash: hashToken(token), uploadExpiresAt: expiresAt } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: asset.id, action: 'organization.logo_intent' } });
      return { id: asset.id, token, expiresAt };
    });
  }

  async logoUploadTarget(actorId: string, organizationId: string, assetId: string, token: string, phase: 'receive' | 'finalize' = 'receive') {
    const membership = await this.access(actorId, organizationId, 'organization.manage');
    if (token.length < 32 || token.length > 128) throw new IdentityError('upload_unavailable', 409);
    const asset = await this.db.organizationLogoAsset.findFirst({ where: { id: assetId, organizationId, uploadTokenHash: hashToken(token), uploadExpiresAt: { gt: new Date() }, scanState: 'pending_scan', checksum: null } });
    if (!asset || membership.organization.version !== asset.organizationVersion || (phase === 'receive' ? asset.actualSize !== null : asset.actualSize !== asset.expectedSize)) throw new IdentityError('upload_unavailable', 409);
    return { storageKey: asset.storageKey, expectedSize: asset.expectedSize, contentType: asset.contentType };
  }

  async recordLogoUpload(actorId: string, organizationId: string, assetId: string, token: string, actualSize: number) {
    await this.access(actorId, organizationId, 'organization.manage');
    if (token.length < 32 || token.length > 128 || !Number.isSafeInteger(actualSize) || actualSize < 1) throw new IdentityError('upload_unavailable', 409);
    const updated = await this.db.organizationLogoAsset.updateMany({ where: { id: assetId, organizationId, uploadTokenHash: hashToken(token), uploadExpiresAt: { gt: new Date() }, scanState: 'pending_scan', checksum: null, actualSize: null, expectedSize: actualSize }, data: { actualSize } });
    if (updated.count !== 1) throw new IdentityError('upload_unavailable', 409);
  }

  async finalizeLogo(actorId: string, organizationId: string, assetId: string, token: string, result: { clean: true; checksum: string; actualSize: number } | { clean: false; reason: string; actualSize: number }) {
    if (!Number.isSafeInteger(result.actualSize) || result.actualSize < 0 || (result.clean ? !/^[0-9a-f]{64}$/.test(result.checksum) : !['magic_mismatch', 'active_content', 'invalid_dimensions'].includes(result.reason))) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const organization = (await scoped.access(actorId, organizationId, 'organization.manage')).organization;
      const asset = await tx.organizationLogoAsset.findFirst({ where: { id: assetId, organizationId, uploadTokenHash: hashToken(token), uploadExpiresAt: { gt: new Date() }, scanState: 'pending_scan', checksum: null } });
      if (!asset || asset.organizationVersion !== organization.version || asset.actualSize !== asset.expectedSize || result.actualSize !== asset.expectedSize) throw new IdentityError('upload_unavailable', 409);
      const updated = await tx.organizationLogoAsset.update({ where: { id: asset.id }, data: result.clean ? { scanState: 'clean', checksum: result.checksum, finalizedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null } : { scanState: 'rejected', scanReason: result.reason, finalizedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null } });
      if (result.clean) await tx.organization.update({ where: { id: organizationId }, data: { currentLogoId: asset.id, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: asset.id, action: result.clean ? 'organization.logo_published' : 'organization.logo_rejected' } });
      return { id: updated.id, scanState: updated.scanState, scanReason: updated.scanReason, logoUrl: result.clean ? `/api/v1/organizations/${encodeURIComponent(organization.slug)}/logo` : null };
    });
  }

  async publicLogo(slug: string) {
    if (!/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || slug.length > 90) throw new IdentityError('not_found', 404);
    const organization = await this.db.organization.findFirst({ where: { slug, status: 'active', currentLogo: { scanState: 'clean' } }, select: { currentLogo: { select: { storageKey: true, contentType: true, checksum: true } } } });
    if (!organization?.currentLogo?.checksum) throw new IdentityError('not_found', 404);
    return organization.currentLogo as { storageKey: string; contentType: string; checksum: string };
  }

  async verificationCase(actorId: string, organizationId: string) {
    await this.access(actorId, organizationId, 'organization.manage');
    const verificationCase = await this.db.organizationVerificationCase.findUnique({
      where: { organizationId },
      include: {
        documents: { select: { id: true, fileName: true, scanState: true, scanReason: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        submissions: { select: { id: true, sequence: true, submittedAt: true }, orderBy: { sequence: 'desc' } }
      }
    });
    if (!verificationCase) return { id: null, state: 'not_started' as const, version: 0, registrationNumber: '', issuingAuthority: '', registeredAddress: '', documentExpiresAt: null, documents: [], submissions: [] };
    const { id, state, version, registrationNumber, issuingAuthority, registeredAddress, documentExpiresAt, documents, submissions } = verificationCase;
    return { id, state, version, registrationNumber, issuingAuthority, registeredAddress, documentExpiresAt, documents, submissions };
  }

  async createVerificationUploadIntent(actorId: string, organizationId: string, input: { fileName: string; contentType: string; size: number; version: number }) {
    const fileName = text(input.fileName.normalize('NFKC'), 255, 1);
    const maximum = input.contentType === 'application/pdf' ? 20 * 1024 * 1024 : ['image/png', 'image/jpeg'].includes(input.contentType) ? 10 * 1024 * 1024 : 0;
    if (!maximum || !Number.isSafeInteger(input.size) || input.size < 5 || input.size > maximum || fileName.includes('/') || fileName.includes('\\') || [...fileName].some(character => character.charCodeAt(0) < 32)) throw new IdentityError('invalid_input', 422);
    const token = randomBytes(32).toString('base64url');
    const documentId = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.access(actorId, organizationId, 'organization.manage');
      const verificationCase = await tx.organizationVerificationCase.findUnique({ where: { organizationId }, include: { _count: { select: { documents: true } } } });
      if (!verificationCase || verificationCase.version !== input.version || !['not_started', 'changes_requested'].includes(verificationCase.state)) throw new IdentityError('conflict', 409);
      if (verificationCase._count.documents >= 10) throw new IdentityError('invalid_input', 422);
      const document = await tx.organizationVerificationDocument.create({ data: { id: documentId, caseId: verificationCase.id, fileName, contentType: input.contentType, expectedSize: input.size, storageKey: `verification/${verificationCase.id}/${documentId}.bin`, uploadTokenHash: hashToken(token), uploadExpiresAt: expiresAt } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: document.id, action: 'verification.upload_intent' } });
      return { id: document.id, token, expiresAt, maximumSize: maximum };
    });
  }

  async verificationUploadTarget(actorId: string, organizationId: string, documentId: string, token: string, phase: 'receive' | 'finalize' = 'receive') {
    await this.access(actorId, organizationId, 'organization.manage');
    if (token.length < 32 || token.length > 128) throw new IdentityError('upload_unavailable', 409);
    const document = await this.db.organizationVerificationDocument.findFirst({ where: { id: documentId, case: { organizationId }, uploadTokenHash: hashToken(token), uploadExpiresAt: { gt: new Date() }, scanState: 'pending_scan', checksum: null } });
    if (!document || (phase === 'receive' ? document.actualSize !== null : document.actualSize !== document.expectedSize)) throw new IdentityError('upload_unavailable', 409);
    return { storageKey: document.storageKey, expectedSize: document.expectedSize, contentType: document.contentType };
  }

  async recordVerificationUpload(actorId: string, organizationId: string, documentId: string, token: string, actualSize: number) {
    await this.access(actorId, organizationId, 'organization.manage');
    if (token.length < 32 || token.length > 128 || !Number.isSafeInteger(actualSize) || actualSize < 1) throw new IdentityError('upload_unavailable', 409);
    const updated = await this.db.organizationVerificationDocument.updateMany({ where: { id: documentId, case: { organizationId }, uploadTokenHash: hashToken(token), uploadExpiresAt: { gt: new Date() }, scanState: 'pending_scan', checksum: null, actualSize: null, expectedSize: actualSize }, data: { actualSize } });
    if (updated.count !== 1) throw new IdentityError('upload_unavailable', 409);
  }

  async finalizeVerificationDocument(actorId: string, organizationId: string, documentId: string, token: string, result: { clean: true; checksum: string; actualSize: number } | { clean: false; reason: string; actualSize: number }) {
    if (!Number.isSafeInteger(result.actualSize) || result.actualSize < 0 || (result.clean ? !/^[0-9a-f]{64}$/.test(result.checksum) : !['magic_mismatch', 'malware_signature', 'active_pdf_content', 'active_content'].includes(result.reason))) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.access(actorId, organizationId, 'organization.manage');
      if (token.length < 32 || token.length > 128) throw new IdentityError('upload_unavailable', 409);
      const document = await tx.organizationVerificationDocument.findFirst({ where: { id: documentId, case: { organizationId }, uploadTokenHash: hashToken(token), uploadExpiresAt: { gt: new Date() }, scanState: 'pending_scan', checksum: null } });
      if (!document || document.actualSize !== document.expectedSize || result.actualSize !== document.expectedSize) throw new IdentityError('upload_unavailable', 409);
      const updated = await tx.organizationVerificationDocument.update({ where: { id: document.id }, data: result.clean ? { scanState: 'clean', checksum: result.checksum, actualSize: result.actualSize, finalizedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null } : { scanState: 'rejected', scanReason: result.reason, actualSize: result.actualSize, finalizedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null } });
      await tx.organizationVerificationCase.update({ where: { id: document.caseId }, data: { version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: document.id, action: result.clean ? 'verification.document_clean' : 'verification.document_rejected' } });
      return { id: updated.id, fileName: updated.fileName, scanState: updated.scanState, scanReason: updated.scanReason };
    });
  }

  async saveVerificationCase(actorId: string, organizationId: string, input: { registrationNumber: string; issuingAuthority: string; registeredAddress: string; documentExpiresAt: Date | null; version: number }) {
    const registrationNumber = text(input.registrationNumber, 100, 0);
    const issuingAuthority = text(input.issuingAuthority, 200, 0);
    const registeredAddress = text(input.registeredAddress, 300, 0);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.access(actorId, organizationId, 'organization.manage');
      const current = await tx.organizationVerificationCase.findUnique({ where: { organizationId } });
      if (!current) {
        if (input.version !== 0) throw new IdentityError('conflict', 409);
        const created = await tx.organizationVerificationCase.create({ data: { organizationId, registrationNumber, issuingAuthority, registeredAddress, documentExpiresAt: input.documentExpiresAt } });
        await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: created.id, action: 'verification.draft_created' } });
        return created;
      }
      if (!['not_started', 'changes_requested'].includes(current.state) || current.version !== input.version) throw new IdentityError('conflict', 409);
      const updated = await tx.organizationVerificationCase.update({ where: { id: current.id }, data: { registrationNumber, issuingAuthority, registeredAddress, documentExpiresAt: input.documentExpiresAt, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: current.id, action: 'verification.draft_updated' } });
      return updated;
    });
  }

  async submitVerificationCase(actorId: string, organizationId: string, version: number) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.access(actorId, organizationId, 'organization.manage');
      const verificationCase = await tx.organizationVerificationCase.findUnique({ where: { organizationId }, include: { documents: true, submissions: { orderBy: { sequence: 'desc' }, take: 1 } } });
      if (!verificationCase || verificationCase.version !== version || !['not_started', 'changes_requested'].includes(verificationCase.state)) throw new IdentityError('conflict', 409);
      if (verificationCase.registrationNumber.length < 2 || verificationCase.issuingAuthority.length < 2 || verificationCase.registeredAddress.length < 2 || (verificationCase.documentExpiresAt && verificationCase.documentExpiresAt <= new Date()) || !verificationCase.documents.length || verificationCase.documents.some(document => document.scanState !== 'clean')) throw new IdentityError('invalid_input', 422);
      const previous = verificationCase.submissions[0];
      const sequence = (previous?.sequence ?? 0) + 1;
      const submission = await tx.organizationVerificationSubmission.create({ data: { caseId: verificationCase.id, sequence, previousSubmissionId: previous?.id ?? null, submittedBy: actorId, snapshot: { registrationNumber: verificationCase.registrationNumber, issuingAuthority: verificationCase.issuingAuthority, registeredAddress: verificationCase.registeredAddress, documentExpiresAt: verificationCase.documentExpiresAt?.toISOString() ?? null, documentIds: verificationCase.documents.map(document => document.id) } } });
      await tx.organizationVerificationCase.update({ where: { id: verificationCase.id }, data: { state: 'submitted', version: { increment: 1 } } });
      await tx.organization.update({ where: { id: organizationId }, data: { verification: 'submitted' } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: submission.id, action: 'verification.submitted' } });
      return { id: submission.id, sequence, state: 'submitted' as const, submittedAt: submission.submittedAt };
    });
  }

  async verificationDecisions(actorId: string, organizationId: string) {
    await this.access(actorId, organizationId, 'organization.manage');
    const verificationCase = await this.db.organizationVerificationCase.findUnique({ where: { organizationId } });
    if (!verificationCase) return [];
    return this.db.organizationVerificationDecision.findMany({ where: { submission: { caseId: verificationCase.id } }, select: { id: true, outcome: true, publicReason: true, decidedAt: true, submission: { select: { sequence: true } } }, orderBy: { decidedAt: 'desc' } });
  }

  async verificationReviewQueue(actorId: string) {
    await this.verificationReviewer(actorId);
    return this.db.organizationVerificationSubmission.findMany({
      where: { decision: null, case: { state: { in: ['submitted', 'in_review'] }, OR: [{ assignedReviewerId: null }, { assignedReviewerId: actorId }] } },
      select: { id: true, sequence: true, submittedAt: true, case: { select: { state: true, version: true, assignedReviewerId: true, organization: { select: { id: true, displayName: true, type: true, country: true, city: true } } } } },
      orderBy: { submittedAt: 'asc' }, take: 100
    });
  }

  async verificationReview(actorId: string, submissionId: string) {
    await this.verificationReviewer(actorId);
    const submission = await this.db.organizationVerificationSubmission.findUnique({
      where: { id: submissionId },
      select: { id: true, sequence: true, snapshot: true, submittedAt: true, decision: { select: { outcome: true, publicReason: true, decidedAt: true } }, case: { select: { state: true, version: true, assignedReviewerId: true, organization: { select: { id: true, displayName: true, legalName: true, type: true, country: true, city: true } }, documents: { select: { id: true, fileName: true, contentType: true, actualSize: true, checksum: true, scanState: true, finalizedAt: true }, orderBy: { createdAt: 'asc' } } } } }
    });
    if (!submission || (submission.case.assignedReviewerId && submission.case.assignedReviewerId !== actorId)) throw new IdentityError('not_found', 404);
    return submission;
  }

  async claimVerificationReview(actorId: string, submissionId: string) {
    await this.verificationReviewer(actorId);
    return this.db.$transaction(async tx => {
      const submission = await tx.organizationVerificationSubmission.findUnique({ where: { id: submissionId }, include: { case: true, decision: true } });
      if (!submission) throw new IdentityError('not_found', 404);
      await tx.$queryRaw`SELECT id FROM organization_verification_cases WHERE id = ${submission.caseId}::uuid FOR UPDATE`;
      const current = await tx.organizationVerificationCase.findUniqueOrThrow({ where: { id: submission.caseId } });
      if (submission.decision || !['submitted', 'in_review'].includes(current.state) || (current.assignedReviewerId && current.assignedReviewerId !== actorId)) throw new IdentityError('conflict', 409);
      if (current.assignedReviewerId === actorId) return { submissionId, state: current.state, version: current.version };
      const claimed = await tx.organizationVerificationCase.update({ where: { id: current.id }, data: { assignedReviewerId: actorId, claimedAt: new Date(), state: 'in_review', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: current.organizationId, resourceId: submissionId, action: 'verification.review_claimed' } });
      return { submissionId, state: claimed.state, version: claimed.version };
    });
  }

  async createMfaChallenge(actorId: string, sessionId: string, submissionId: string, version: number) {
    await this.verificationReviewer(actorId);
    const submission = await this.db.organizationVerificationSubmission.findUnique({ where: { id: submissionId }, include: { case: true, decision: true } });
    if (!submission || submission.decision || submission.case.assignedReviewerId !== actorId || submission.case.state !== 'in_review' || submission.case.version !== version) throw new IdentityError('conflict', 409);
    await this.db.mfaChallenge.updateMany({ where: { userId: actorId, sessionId, operation: 'verification.decision', resourceId: submissionId, state: { in: ['pending', 'verified'] } }, data: { state: 'cancelled' } });
    return this.db.mfaChallenge.create({ data: { userId: actorId, sessionId, operation: 'verification.decision', resourceId: submissionId, resourceVersion: version, expiresAt: new Date(Date.now() + 5 * 60_000) }, select: { id: true, operation: true, resourceId: true, resourceVersion: true, expiresAt: true, state: true } });
  }

  async verifyMfaChallenge(actorId: string, sessionId: string, challengeId: string) {
    const updated = await this.db.mfaChallenge.updateMany({ where: { id: challengeId, userId: actorId, sessionId, state: 'pending', attempts: { lt: 5 }, expiresAt: { gt: new Date() } }, data: { state: 'verified', verifiedAt: new Date() } });
    if (updated.count !== 1) throw new IdentityError('mfa_unavailable', 409);
    return { id: challengeId, state: 'verified' as const };
  }

  async failMfaChallenge(actorId: string, sessionId: string, challengeId: string) {
    await this.db.$transaction(async tx => {
      const challenge = await tx.mfaChallenge.findFirst({ where: { id: challengeId, userId: actorId, sessionId, state: 'pending' } });
      if (!challenge) return;
      await tx.mfaChallenge.update({ where: { id: challenge.id }, data: challenge.attempts >= 4 ? { attempts: 5, state: 'cancelled' } : { attempts: { increment: 1 } } });
    });
  }

  async cancelMfaChallenge(actorId: string, sessionId: string, challengeId: string) {
    const updated = await this.db.mfaChallenge.updateMany({ where: { id: challengeId, userId: actorId, sessionId, state: { in: ['pending', 'verified'] } }, data: { state: 'cancelled' } });
    if (updated.count !== 1) throw new IdentityError('mfa_unavailable', 409);
    return { id: challengeId, state: 'cancelled' as const };
  }

  async decideVerificationReview(actorId: string, sessionId: string, submissionId: string, input: { outcome: 'changes_requested' | 'verified' | 'rejected'; publicReason: string; version: number; mfaChallengeId: string }) {
    await this.verificationReviewer(actorId);
    const publicReason = text(input.publicReason, 1000, input.outcome === 'verified' ? 0 : 10);
    return this.db.$transaction(async tx => {
      const submission = await tx.organizationVerificationSubmission.findUnique({ where: { id: submissionId }, include: { case: { include: { documents: true } }, decision: true } });
      if (!submission) throw new IdentityError('not_found', 404);
      await tx.$queryRaw`SELECT id FROM organization_verification_cases WHERE id = ${submission.caseId}::uuid FOR UPDATE`;
      const verificationCase = await tx.organizationVerificationCase.findUniqueOrThrow({ where: { id: submission.caseId }, include: { documents: true } });
      const challenge = await tx.mfaChallenge.findFirst({ where: { id: input.mfaChallengeId, userId: actorId, sessionId, operation: 'verification.decision', resourceId: submissionId, resourceVersion: input.version, state: 'verified', expiresAt: { gt: new Date() } } });
      if (submission.decision || verificationCase.state !== 'in_review' || verificationCase.assignedReviewerId !== actorId || verificationCase.version !== input.version || !challenge) throw new IdentityError('conflict', 409);
      const snapshot = submission.snapshot as { documentIds?: unknown };
      const documentIds = Array.isArray(snapshot.documentIds) ? snapshot.documentIds.filter((id): id is string => typeof id === 'string') : [];
      const cleanDocumentIds = new Set(verificationCase.documents.filter(document => document.scanState === 'clean' && document.checksum).map(document => document.id));
      if (!documentIds.length || documentIds.some(id => !cleanDocumentIds.has(id))) throw new IdentityError('invalid_input', 422);
      const consumed = await tx.mfaChallenge.updateMany({ where: { id: challenge.id, state: 'verified', consumedAt: null }, data: { state: 'consumed', consumedAt: new Date() } });
      if (consumed.count !== 1) throw new IdentityError('conflict', 409);
      const decision = await tx.organizationVerificationDecision.create({ data: { submissionId, outcome: input.outcome, publicReason, reviewerId: actorId } });
      await tx.organizationVerificationCase.update({ where: { id: verificationCase.id }, data: { state: input.outcome, version: { increment: 1 } } });
      await tx.organization.update({ where: { id: verificationCase.organizationId }, data: { verification: input.outcome } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: verificationCase.organizationId, resourceId: decision.id, action: `verification.${input.outcome}` } });
      return { id: decision.id, outcome: decision.outcome, publicReason: decision.publicReason, decidedAt: decision.decidedAt };
    });
  }

  async members(actorId: string, organizationId: string): Promise<Array<Pick<Membership, 'id' | 'userId' | 'roles' | 'status' | 'version'> & { user: Pick<User, 'name' | 'email'> }>> {
    await this.access(actorId, organizationId, 'member.read');
    return this.db.membership.findMany({ where: { organizationId }, select: { id: true, userId: true, roles: true, status: true, version: true, user: { select: { name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
  }

  async invite(actorId: string, organizationId: string, email: string, roles: Role[], localDeliveryBaseUrl?: string) {
    const normalized = normalizeEmail(email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new IdentityError('invalid_input', 422);
    const token = randomBytes(32).toString('base64url');
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const membership = await scoped.access(actorId, organizationId, 'member.invite');
      assertDelegation(membership.roles, roles);
      const existingUser = await tx.user.findUnique({ where: { email: normalized } });
      if (existingUser) {
        const existingMembership = await tx.membership.findUnique({ where: { userId_organizationId: { userId: existingUser.id, organizationId } } });
        if (existingMembership || existingUser.status !== 'active') throw new IdentityError('conflict', 409);
      }
      const invitation = await tx.invitation.create({ data: { organizationId, email: normalized, roles, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 48 * 3600_000), createdBy: actorId } });
      if (localDeliveryBaseUrl) await tx.localAuthMail.create({ data: { recipient: normalized, purpose: 'invitation', url: `${localDeliveryBaseUrl}/invitations/${token}` } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: invitation.id, action: 'invitation.created' } });
      return invitation;
    });
    // Token is returned only to the trusted delivery adapter; HTTP must not return it to the inviter.
    return { id: result.id, token, expiresAt: result.expiresAt };
  }

  async invitations(actorId: string, organizationId: string) {
    await this.access(actorId, organizationId, 'member.invite');
    return this.db.invitation.findMany({
      where: { organizationId },
      select: { id: true, email: true, roles: true, expiresAt: true, consumedAt: true, revokedAt: true, declinedAt: true, createdAt: true },
      orderBy: { createdAt: 'desc' }
    });
  }

  async revokeInvitation(actorId: string, organizationId: string, invitationId: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      await scoped.access(actorId, organizationId, 'member.invite');
      const revoked = await tx.invitation.updateMany({ where: { id: invitationId, organizationId, consumedAt: null, revokedAt: null, declinedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date() } });
      if (revoked.count !== 1) throw new IdentityError('invitation_unavailable', 409);
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: invitationId, action: 'invitation.revoked' } });
      return { id: invitationId, status: 'revoked' as const };
    });
  }

  async acceptInvitation(actorId: string, token: string): Promise<Membership> {
    return this.db.$transaction(async tx => {
      const invitation = await tx.invitation.findUnique({ where: { tokenHash: invitationHash(token) } });
      if (!invitation) throw new IdentityError('invitation_unavailable', 409);
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${invitation.organizationId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actorId } });
      const org = await tx.organization.findUnique({ where: { id: invitation.organizationId } });
      if (!user || user.status !== 'active' || !user.emailVerified || user.email !== invitation.email || org?.status !== 'active') throw new IdentityError('forbidden', 403);
      const issuer = new IdentityService(tx as DatabaseClient);
      const issuerMembership = await issuer.access(invitation.createdBy, invitation.organizationId, 'member.invite');
      assertDelegation(issuerMembership.roles, invitation.roles);
      const existing = await tx.membership.findUnique({ where: { userId_organizationId: { userId: actorId, organizationId: invitation.organizationId } } });
      if (existing) throw new IdentityError('conflict', 409);
      const consumed = await tx.invitation.updateMany({ where: { id: invitation.id, consumedAt: null, revokedAt: null, declinedAt: null, expiresAt: { gt: new Date() } }, data: { consumedAt: new Date() } });
      if (consumed.count !== 1) throw new IdentityError('invitation_unavailable', 409);
      const membership = await tx.membership.create({ data: { userId: actorId, organizationId: invitation.organizationId, roles: invitation.roles } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: invitation.organizationId, resourceId: invitation.id, action: 'invitation.accepted' } });
      return membership;
    });
  }

  async invitationPreview(actorId: string, token: string) {
    const user = await this.activeUser(actorId);
    const invitation = await this.db.invitation.findUnique({
      where: { tokenHash: invitationHash(token) },
      select: {
        roles: true,
        expiresAt: true,
        consumedAt: true,
        revokedAt: true,
        declinedAt: true,
        email: true,
        organization: { select: { displayName: true, type: true, country: true, city: true } },
        creator: { select: { name: true } }
      }
    });
    if (!invitation) throw new IdentityError('invitation_unavailable', 409);
    if (!user.emailVerified || user.email !== invitation.email) throw new IdentityError('forbidden', 403);
    const status = invitation.consumedAt ? 'accepted' : invitation.revokedAt ? 'revoked' : invitation.declinedAt ? 'declined' : invitation.expiresAt <= new Date() ? 'expired' : 'pending';
    return { organization: invitation.organization, inviter: { name: invitation.creator.name }, roles: invitation.roles, expiresAt: invitation.expiresAt, status };
  }

  async declineInvitation(actorId: string, token: string) {
    return this.db.$transaction(async tx => {
      const invitation = await tx.invitation.findUnique({ where: { tokenHash: invitationHash(token) } });
      if (!invitation) throw new IdentityError('invitation_unavailable', 409);
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${invitation.organizationId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: actorId } });
      if (!user || user.status !== 'active' || !user.emailVerified || user.email !== invitation.email) throw new IdentityError('forbidden', 403);
      const declined = await tx.invitation.updateMany({
        where: { id: invitation.id, consumedAt: null, revokedAt: null, declinedAt: null, expiresAt: { gt: new Date() } },
        data: { declinedAt: new Date(), declinedBy: actorId }
      });
      if (declined.count !== 1) throw new IdentityError('invitation_unavailable', 409);
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: invitation.organizationId, resourceId: invitation.id, action: 'invitation.declined' } });
      return { status: 'declined' as const };
    });
  }

  async changeMembership(actorId: string, organizationId: string, targetUserId: string, input: { version: number; roles: Role[]; status: 'active' | 'suspended' }): Promise<Membership> {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new IdentityService(tx as DatabaseClient);
      const actor = await scoped.access(actorId, organizationId, 'member.role.update');
      const target = await tx.membership.findUnique({ where: { userId_organizationId: { userId: targetUserId, organizationId } } });
      if (!target || target.version !== input.version) throw new IdentityError('conflict', 409);
      // Ownership is changed only by the future reauthenticated transfer workflow.
      if (target.roles.includes('Owner') || input.roles.includes('Owner') || actorId === targetUserId) throw new IdentityError('forbidden', 403);
      assertDelegation(actor.roles, target.roles);
      assertDelegation(actor.roles, input.roles);
      if (!['active', 'suspended'].includes(input.status)) throw new IdentityError('invalid_input', 422);
      const updated = await tx.membership.update({ where: { id: target.id }, data: { roles: input.roles, status: input.status, version: { increment: 1 } } });
      if (input.status === 'suspended') await tx.session.deleteMany({ where: { userId: targetUserId } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: target.id, action: input.status === 'suspended' ? 'membership.suspended' : 'membership.updated' } });
      return updated;
    });
  }
}
