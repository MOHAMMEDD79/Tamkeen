import type { DatabaseClient, OrganizationType, Prisma } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';

/**
 * The platform admin's directory: every organisation and every account on the platform.
 *
 * Organisations: the admin corrects public details, approves or withdraws approval, shows or hides
 * one from the public directory, and suspends one. Accounts: the admin reads who someone is and
 * what they belong to, and suspends or reactivates them — a suspended account cannot sign in, and
 * its existing sessions stop working at once (session.ts re-checks the status on every request).
 *
 * Every call re-checks the PlatformAdmin grant with MFA, and every change leaves an audit row.
 */

export interface OrganizationChanges {
  displayName?: string | undefined; publicDescription?: string | undefined; sectors?: string[] | undefined;
  type?: OrganizationType | undefined; city?: string | undefined; country?: string | undefined;
  websiteUrl?: string | null | undefined; contactEmail?: string | null | undefined; contactAddress?: string | null | undefined;
  publiclyListed?: boolean | undefined; status?: 'active' | 'suspended' | undefined;
  /** The admin's own decision: approve, or withdraw approval. The review workflow is unchanged. */
  approved?: boolean | undefined;
}

const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };
const logoUrl = (slug: string, currentLogoId: string | null) => currentLogoId ? `/api/v1/organizations/${encodeURIComponent(slug)}/logo` : null;

export class DirectoryService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) { this.identity = new IdentityService(db); }

  admin(actorId: string) { return this.identity.platformAdministratorUser(actorId); }

  // ---------------------------------------------------------------- organisations

  async organizations(actorId: string, query: string | undefined) {
    await this.admin(actorId);
    return this.organizationsWhere(this.db, query ? { OR: [{ displayName: { contains: query, mode: 'insensitive' } }, { legalName: { contains: query, mode: 'insensitive' } }, { slug: { contains: query, mode: 'insensitive' } }] } : {});
  }

  async updateOrganization(actorId: string, organizationId: string, input: OrganizationChanges & { version: number }) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const current = await tx.organization.findUnique({ where: { id: organizationId }, select: { id: true, version: true, verification: true } });
      if (!current) throw new IdentityError('not_found', 404);
      if (current.version !== input.version) throw new IdentityError('conflict', 409);
      const { version, approved, ...changes } = input;
      const verification = approved === undefined ? undefined : approved ? 'verified' as const : current.verification === 'verified' ? 'not_started' as const : undefined;
      const updated = await tx.organization.updateMany({
        where: { id: organizationId, version },
        data: { ...defined(changes), ...(verification ? { verification } : {}), version: { increment: 1 } }
      });
      if (updated.count !== 1) throw new IdentityError('conflict', 409);
      const action = approved === true ? 'organization.admin_approved' : approved === false ? 'organization.admin_approval_withdrawn'
        : changes.status ? `organization.admin_${changes.status}` : changes.publiclyListed !== undefined ? (changes.publiclyListed ? 'organization.admin_listed' : 'organization.admin_unlisted') : 'organization.admin_edited';
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: organizationId, action } });
      return (await this.organizationsWhere(tx as DatabaseClient, { id: organizationId }))[0]!;
    });
  }

  /** Records a logo the controller already inspected and published, and makes it current. */
  async adoptLogo(actorId: string, organizationId: string, asset: { id: string; storageKey: string; contentType: string; size: number; checksum: string }) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const organization = await tx.organization.findUnique({ where: { id: organizationId }, select: { version: true } });
      if (!organization) throw new IdentityError('not_found', 404);
      await tx.organizationLogoAsset.create({ data: {
        id: asset.id, organizationId, organizationVersion: organization.version, fileName: 'logo', storageKey: asset.storageKey, contentType: asset.contentType,
        expectedSize: asset.size, actualSize: asset.size, checksum: asset.checksum, scanState: 'clean', finalizedAt: new Date()
      } });
      await tx.organization.update({ where: { id: organizationId }, data: { currentLogoId: asset.id, version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: asset.id, action: 'organization.logo_published' } });
      return (await this.organizationsWhere(tx as DatabaseClient, { id: organizationId }))[0]!;
    });
  }

  async organizationExists(organizationId: string) {
    return Boolean(await this.db.organization.findUnique({ where: { id: organizationId }, select: { id: true } }));
  }

  private async organizationsWhere(db: DatabaseClient, where: Prisma.OrganizationWhereInput) {
    const rows = await db.organization.findMany({
      where,
      select: {
        id: true, slug: true, displayName: true, legalName: true, type: true, city: true, country: true, publicDescription: true, sectors: true,
        websiteUrl: true, contactEmail: true, contactAddress: true, verification: true, publiclyListed: true, status: true, version: true, currentLogoId: true, createdAt: true,
        _count: { select: { memberships: { where: { status: 'active' } }, projects: true, offerings: true, programs: true, jobs: true } }
      },
      orderBy: [{ publiclyListed: 'desc' }, { displayName: 'asc' }],
      take: 300
    });
    return rows.map(({ _count, currentLogoId, ...row }) => ({
      ...row, logoUrl: logoUrl(row.slug, currentLogoId),
      counts: { members: _count.memberships, projects: _count.projects, offerings: _count.offerings, programs: _count.programs, jobs: _count.jobs }
    }));
  }

  // ---------------------------------------------------------------- accounts

  async users(actorId: string, query: string | undefined, status: 'active' | 'suspended' | 'closed' | undefined) {
    await this.admin(actorId);
    const rows = await this.db.user.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(query ? { OR: [{ email: { contains: query, mode: 'insensitive' } }, { name: { contains: query, mode: 'insensitive' } }, { profile: { displayName: { contains: query, mode: 'insensitive' } } }] } : {})
      },
      select: {
        id: true, email: true, name: true, status: true, emailVerified: true, twoFactorEnabled: true, createdAt: true,
        profile: { select: { displayName: true, city: true } },
        platformGrants: { where: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { role: true } },
        _count: { select: { memberships: { where: { status: 'active' } } } }
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: 300
    });
    return rows.map(({ platformGrants, _count, profile, ...row }) => ({
      ...row, displayName: profile?.displayName ?? row.name, city: profile?.city ?? null,
      platformRoles: platformGrants.map(grant => grant.role), organizations: _count.memberships
    }));
  }

  async user(actorId: string, userId: string) {
    await this.admin(actorId);
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: {
        id: true, email: true, name: true, status: true, emailVerified: true, twoFactorEnabled: true, createdAt: true, termsVersion: true,
        profile: { select: { displayName: true, city: true, locale: true, capabilities: true } },
        platformGrants: { where: { revokedAt: null }, select: { role: true, expiresAt: true, createdAt: true } },
        memberships: { select: { roles: true, status: true, organization: { select: { id: true, slug: true, displayName: true } } } },
        sessions: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 }
      }
    });
    if (!user) throw new IdentityError('not_found', 404);
    const { sessions, ...rest } = user;
    return { ...rest, lastSignInAt: sessions[0]?.createdAt ?? null };
  }

  /**
   * Suspends or reactivates an account. An admin cannot suspend themselves, and the last active
   * platform admin cannot be suspended: either would lock the platform out of its own admin screens.
   */
  async setUserStatus(actorId: string, userId: string, status: 'active' | 'suspended') {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      if (status === 'suspended' && userId === actorId) throw new IdentityError('forbidden', 403);
      const current = await tx.user.findUnique({ where: { id: userId }, select: { status: true } });
      if (!current) throw new IdentityError('not_found', 404);
      if (current.status === 'closed') throw new IdentityError('conflict', 409);
      if (status === 'suspended') {
        const isAdmin = await tx.platformGrant.count({ where: { userId, role: 'PlatformAdmin', revokedAt: null } });
        const otherAdmins = await tx.platformGrant.count({ where: { role: 'PlatformAdmin', revokedAt: null, userId: { not: userId }, user: { status: 'active' } } });
        if (isAdmin && !otherAdmins) throw new IdentityError('conflict', 409);
      }
      await tx.user.update({ where: { id: userId }, data: { status, ...(status === 'suspended' ? { platformAccessVersion: { increment: 1 } } : {}) } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: userId, action: status === 'suspended' ? 'user.admin_suspended' : 'user.admin_reactivated' } });
      return { id: userId, status };
    });
  }
}
