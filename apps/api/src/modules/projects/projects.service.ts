import { randomBytes } from 'node:crypto';
import type { DatabaseClient, LocationPrecision, ProjectState, ProjectType } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { PUBLIC_PROGRAM_STATES } from '../programs/programs.service.js';
import { isPubliclyVisible, PUBLICLY_VISIBLE_STATES, publicProjectCard, publicProjectDetail, publicFunding, publicOrganizationSummary } from './projections.js';

/**
 * Projects across all three tracks (01-PRODUCT-SCOPE). PART-04 covers the record, its public
 * projection, browsing and the organisation-side draft editor. Money, campaigns and budgets arrive
 * with PART-05/06 and are deliberately not modelled here.
 *
 * Reads split in two: the public surface never takes an actor and never returns anything outside
 * the allowlisted projection, while the organisation surface goes through the identity policy layer
 * for every call, including lists.
 */

const PROJECT_TYPES: readonly ProjectType[] = ['charity', 'venture', 'enablement'];
const PRECISIONS: readonly LocationPrecision[] = ['city', 'approximate', 'exact'];
/** Draft-side states a project can be edited in (05-CHARITY-LIFECYCLE). */
const EDITABLE_STATES: readonly ProjectState[] = ['draft', 'changes_requested'];

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

const publicInclude = {
  city: { select: { nameAr: true, nameEn: true, country: true, latitude: true, longitude: true } },
  organization: { select: { slug: true, displayName: true, type: true, city: true, country: true, verification: true, currentLogoId: true } },
  cover: { select: { imageKey: true } }
} as const;

/** The detail read additionally needs the campaign, because the public funding block derives from it. */
const publicDetailInclude = { ...publicInclude, campaign: true } as const;

/**
 * Contributions that count towards the public raised figure: confirmed money only. A pending
 * checkout holds capacity but has not been paid, so it must never appear as money raised.
 */
const CONFIRMED_CONTRIBUTION_STATES = ['succeeded', 'partially_refunded'] as const;

function text(value: unknown, min: number, max: number): string {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
}

/** Slugs are public and permanent-ish, so they carry a random suffix rather than a guessable counter. */
function projectSlug(title: string): string {
  const base = title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80);
  return `${base || 'project'}-${randomBytes(4).toString('hex')}`;
}

export interface ProjectFilters {
  type?: ProjectType;
  cityId?: string;
  country?: string;
  organizationSlug?: string;
  verifiedOnly?: boolean;
  query?: string;
  cursor?: string;
  limit?: number;
}

export class ProjectsService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) { this.identity = new IdentityService(db); }

  // ---------------------------------------------------------------- public reads

  async cities() {
    return this.db.city.findMany({ select: { id: true, country: true, nameAr: true, nameEn: true }, orderBy: [{ country: 'asc' }, { nameEn: 'asc' }] });
  }

  /**
   * Browse published projects. Filters are an allowlist (11-API-CONTRACTS) and the cursor is the
   * project id with a stable ordering, so paging cannot silently skip or repeat a row.
   */
  async browse(filters: ProjectFilters) {
    const limit = Math.min(Math.max(filters.limit ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
    if (filters.type && !PROJECT_TYPES.includes(filters.type)) throw new IdentityError('invalid_input', 422);
    const where = {
      state: { in: [...PUBLICLY_VISIBLE_STATES] },
      organization: { status: 'active' as const, ...(filters.organizationSlug ? { slug: filters.organizationSlug } : {}), ...(filters.verifiedOnly ? { verification: 'verified' as const } : {}) },
      ...(filters.type ? { type: filters.type } : {}),
      ...(filters.cityId ? { cityId: filters.cityId } : {}),
      ...(filters.country ? { city: { country: filters.country } } : {}),
      // Arabic search starts in PostgreSQL with case-insensitive matching on the public fields only.
      ...(filters.query ? { OR: [{ title: { contains: filters.query, mode: 'insensitive' as const } }, { summary: { contains: filters.query, mode: 'insensitive' as const } }] } : {})
    };
    const rows = await this.db.project.findMany({
      where,
      include: publicInclude,
      orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
      take: limit + 1,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {})
    });
    const page = rows.slice(0, limit);
    return {
      items: page.map(publicProjectCard),
      nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
      hasMore: rows.length > limit
    };
  }

  async publicProject(slug: string) {
    if (typeof slug !== 'string' || !/^[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*$/u.test(slug) || slug.length > 120) throw new IdentityError('not_found', 404);
    const project = await this.db.project.findFirst({ where: { slug, state: { in: [...PUBLICLY_VISIBLE_STATES] }, organization: { status: 'active' } }, include: publicDetailInclude });
    // An unpublished or archived project is absent, not forbidden: 404 does not confirm it exists.
    if (!project) throw new IdentityError('not_found', 404);
    return publicProjectDetail(project, await this.fundingFor(project));
  }

  /** Map points for the current filters, plus the list fallback the same data drives (PUB-03). */
  async mapProjects(filters: ProjectFilters & { bbox?: [number, number, number, number] }) {
    const { bbox, ...rest } = filters;
    const page = await this.browse({ ...rest, limit: PAGE_SIZE_MAX });
    const items = bbox
      ? page.items.filter(item => {
          const point = item.location.point;
          if (!point) return false;
          const [minLat, minLon, maxLat, maxLon] = bbox;
          return point.latitude >= minLat && point.latitude <= maxLat && point.longitude >= minLon && point.longitude <= maxLon;
        })
      : page.items;
    return { items, total: items.length };
  }

  async publicOrganizations(filters: { country?: string; verifiedOnly?: boolean; query?: string; limit?: number }) {
    const limit = Math.min(Math.max(filters.limit ?? PAGE_SIZE_DEFAULT, 1), PAGE_SIZE_MAX);
    const rows = await this.db.organization.findMany({
      where: {
        status: 'active',
        ...(filters.country ? { country: filters.country } : {}),
        // PUB-04.A02: an expired verification is not a verified organisation.
        ...(filters.verifiedOnly ? { verification: 'verified' as const } : {}),
        ...(filters.query ? { displayName: { contains: filters.query, mode: 'insensitive' as const } } : {})
      },
      select: { slug: true, displayName: true, type: true, city: true, country: true, verification: true, currentLogoId: true },
      orderBy: [{ displayName: 'asc' }],
      take: limit
    });
    return rows.map(publicOrganizationSummary);
  }

  async publicOrganization(slug: string) {
    if (typeof slug !== 'string' || slug.length > 90) throw new IdentityError('not_found', 404);
    const organization = await this.db.organization.findFirst({
      where: { slug, status: 'active' },
      select: { id: true, slug: true, displayName: true, type: true, city: true, country: true, verification: true, currentLogoId: true, publicDescription: true, sectors: true, websiteUrl: true, contactEmail: true }
    });
    if (!organization) throw new IdentityError('not_found', 404);
    const projects = await this.db.project.findMany({
      where: { organizationId: organization.id, state: { in: [...PUBLICLY_VISIBLE_STATES] } },
      include: publicInclude,
      orderBy: [{ publishedAt: 'desc' }],
      take: PAGE_SIZE_DEFAULT
    });
    return {
      // legalName is intentionally not part of this shape (ADR-013).
      ...publicOrganizationSummary(organization),
      publicDescription: organization.publicDescription,
      sectors: organization.sectors,
      websiteUrl: organization.websiteUrl,
      contactEmail: organization.contactEmail,
      projects: projects.map(publicProjectCard)
    };
  }

  /**
   * Platform-wide impact figures (PUB-12). Every number carries its definition and its source, and
   * a figure with no source is listed as unavailable rather than reported as zero.
   *
   * Funding is counted across currencies only as a contribution count; the minor-unit totals are
   * reported per currency, because 05 forbids summing currencies into one number.
   */
  async impact() {
    const [publishedProjects, verifiedOrganizations, confirmed] = await Promise.all([
      this.db.project.count({ where: { state: { in: [...PUBLICLY_VISIBLE_STATES] }, organization: { status: 'active' } } }),
      this.db.organization.count({ where: { status: 'active', verification: 'verified' } }),
      this.db.contribution.findMany({
        where: { state: { in: [...CONFIRMED_CONTRIBUTION_STATES] } },
        select: { amountMinor: true, refundedMinor: true, currency: true }
      })
    ]);
    const byCurrency = new Map<string, { gross: bigint; refunded: bigint }>();
    for (const row of confirmed) {
      const bucket = byCurrency.get(row.currency) ?? { gross: 0n, refunded: 0n };
      byCurrency.set(row.currency, { gross: bucket.gross + row.amountMinor, refunded: bucket.refunded + row.refundedMinor });
    }
    return {
      asOf: new Date().toISOString(),
      counted: [
        { key: 'published_projects', value: publishedProjects, definition: 'Projects an independent reviewer published, in any track.' },
        { key: 'verified_organizations', value: verifiedOrganizations, definition: 'Organisations holding a current verification decision.' },
        { key: 'contributions_confirmed', value: confirmed.length, definition: 'Confirmed contributions across every project. Simulated payments in this build; no real money moved.' }
      ],
      // Kept apart from `counted` because each entry is a per-currency pair, not a single number.
      fundingByCurrency: [...byCurrency.entries()].map(([currency, totals]) => ({
        currency,
        grossMinor: totals.gross.toString(),
        netMinor: (totals.gross - totals.refunded).toString(),
        definition: 'Confirmed contributions, and confirmed contributions less confirmed refunds, in minor units.'
      })),
      unavailable: [
        { key: 'verified_beneficiaries', reason: 'not_implemented', part: 'PART-07' },
        { key: 'placements_started', reason: 'not_implemented', part: 'PART-11' }
      ]
    };
  }

  // ---------------------------------------------------------------- organisation reads and writes

  async listForOrganization(actorId: string, organizationId: string) {
    await this.identity.access(actorId, organizationId, 'project.read');
    const projects = await this.db.project.findMany({
      where: { organizationId },
      select: {
        id: true, slug: true, title: true, summary: true, type: true, state: true, version: true,
        publishedAt: true, updatedAt: true,
        city: { select: { nameAr: true, nameEn: true } },
        manager: { select: { id: true, name: true } }
      },
      orderBy: { updatedAt: 'desc' }
    });
    return projects;
  }

  async readForOrganization(actorId: string, organizationId: string, projectId: string) {
    await this.identity.access(actorId, organizationId, 'project.read');
    // Scoped by organisation as well as id: a project id from another tenant must not resolve.
    const project = await this.db.project.findFirst({
      where: { id: projectId, organizationId },
      include: { ...publicInclude, manager: { select: { id: true, name: true } }, versions: { select: { id: true, sequence: true, submittedAt: true }, orderBy: { sequence: 'desc' } } }
    });
    if (!project) throw new IdentityError('not_found', 404);
    return project;
  }

  async create(actorId: string, organizationId: string, input: { type: ProjectType; title: string; summary: string; story: string; cityId: string; managerId: string; publicLocationPrecision: LocationPrecision; latitude: number | null; longitude: number | null }) {
    const title = text(input.title, 5, 140);
    const summary = text(input.summary, 0, 300);
    const story = text(input.story, 0, 20000);
    if (!PROJECT_TYPES.includes(input.type) || !PRECISIONS.includes(input.publicLocationPrecision)) throw new IdentityError('invalid_input', 422);
    this.assertCoordinates(input.publicLocationPrecision, input.latitude, input.longitude);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new ProjectsService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'project.create');
      const city = await tx.city.findUnique({ where: { id: input.cityId } });
      if (!city) throw new IdentityError('invalid_input', 422);
      // The manager must be an active member; SQL enforces it too, this gives a clean 422.
      const manager = await tx.membership.findUnique({ where: { userId_organizationId: { userId: input.managerId, organizationId } } });
      if (!manager || manager.status !== 'active') throw new IdentityError('invalid_input', 422);
      const project = await tx.project.create({
        data: {
          organizationId, type: input.type, slug: projectSlug(title), title, summary, story,
          cityId: input.cityId, managerId: input.managerId,
          publicLocationPrecision: input.publicLocationPrecision,
          latitude: input.latitude, longitude: input.longitude,
          createdBy: actorId
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: project.id, action: 'project.created' } });
      return project;
    });
  }

  async update(actorId: string, organizationId: string, projectId: string, input: { title: string; summary: string; story: string; cityId: string; managerId: string; publicLocationPrecision: LocationPrecision; latitude: number | null; longitude: number | null; version: number }) {
    const title = text(input.title, 5, 140);
    const summary = text(input.summary, 0, 300);
    const story = text(input.story, 0, 20000);
    if (!PRECISIONS.includes(input.publicLocationPrecision)) throw new IdentityError('invalid_input', 422);
    this.assertCoordinates(input.publicLocationPrecision, input.latitude, input.longitude);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new ProjectsService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'project.update');
      const current = await tx.project.findFirst({ where: { id: projectId, organizationId } });
      if (!current) throw new IdentityError('not_found', 404);
      if (current.version !== input.version) throw new IdentityError('conflict', 409);
      // A project under review is frozen: the reviewer is looking at the snapshot it submitted.
      if (!EDITABLE_STATES.includes(current.state)) throw new IdentityError('conflict', 409);
      const city = await tx.city.findUnique({ where: { id: input.cityId } });
      if (!city) throw new IdentityError('invalid_input', 422);
      const manager = await tx.membership.findUnique({ where: { userId_organizationId: { userId: input.managerId, organizationId } } });
      if (!manager || manager.status !== 'active') throw new IdentityError('invalid_input', 422);
      const updated = await tx.project.update({
        where: { id: projectId },
        data: {
          title, summary, story, cityId: input.cityId, managerId: input.managerId,
          publicLocationPrecision: input.publicLocationPrecision,
          latitude: input.latitude, longitude: input.longitude,
          version: { increment: 1 }
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: projectId, action: 'project.updated' } });
      return updated;
    });
  }

  /** ORG-07.A03: the exact shape a visitor would get, without publishing anything. */
  async publicPreview(actorId: string, organizationId: string, projectId: string) {
    await this.identity.access(actorId, organizationId, 'project.read');
    const project = await this.db.project.findFirst({ where: { id: projectId, organizationId }, include: publicDetailInclude });
    if (!project) throw new IdentityError('not_found', 404);
    return { preview: publicProjectDetail(project, await this.fundingFor(project)), wouldBeVisible: isPubliclyVisible(project.state) };
  }

  /**
   * ORG-07.A04. Submitting locks an immutable snapshot of what the reviewer will judge, chained to
   * the previous one so a resubmission can be compared against it.
   */
  async submit(actorId: string, organizationId: string, projectId: string, version: number) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new ProjectsService(tx as DatabaseClient);
      const membership = await scoped.identity.access(actorId, organizationId, 'project.submit');
      const project = await tx.project.findFirst({ where: { id: projectId, organizationId }, include: { versions: { orderBy: { sequence: 'desc' }, take: 1 } } });
      if (!project) throw new IdentityError('not_found', 404);
      if (project.version !== version || !EDITABLE_STATES.includes(project.state)) throw new IdentityError('conflict', 409);
      // 05-CHARITY-LIFECYCLE: complete fields before review, and a verified organisation behind it.
      if (project.summary.trim().length < 30) throw new IdentityError('invalid_input', 422);
      if (membership.organization.verification !== 'verified') throw new IdentityError('invalid_input', 422);
      const previous = project.versions[0];
      const sequence = (previous?.sequence ?? 0) + 1;
      const created = await tx.projectVersion.create({
        data: {
          projectId, sequence, previousVersionId: previous?.id ?? null, submittedBy: actorId,
          snapshot: { title: project.title, summary: project.summary, story: project.story, type: project.type, cityId: project.cityId, managerId: project.managerId, publicLocationPrecision: project.publicLocationPrecision }
        }
      });
      await tx.project.update({ where: { id: projectId }, data: { state: 'submitted', version: { increment: 1 } } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: created.id, action: 'project.submitted' } });
      return { id: created.id, sequence, state: 'submitted' as const, submittedAt: created.submittedAt };
    });
  }

  /** ORG-06.A03. Copies the description only: never money, contributors or an approval. */
  async duplicate(actorId: string, organizationId: string, projectId: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
      const scoped = new ProjectsService(tx as DatabaseClient);
      await scoped.identity.access(actorId, organizationId, 'project.create');
      const source = await tx.project.findFirst({ where: { id: projectId, organizationId } });
      if (!source) throw new IdentityError('not_found', 404);
      const copy = await tx.project.create({
        data: {
          organizationId, type: source.type, slug: projectSlug(source.title), title: source.title,
          summary: source.summary, story: source.story, cityId: source.cityId, managerId: source.managerId,
          publicLocationPrecision: source.publicLocationPrecision, latitude: source.latitude, longitude: source.longitude,
          createdBy: actorId
          // state defaults to draft and publishedAt stays null: a copy is never born published.
        }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: copy.id, action: 'project.duplicated' } });
      return copy;
    });
  }

  private assertCoordinates(precision: LocationPrecision, latitude: number | null, longitude: number | null) {
    if (precision === 'city') {
      // A city-level project must not even store a point: what is not stored cannot leak.
      if (latitude !== null || longitude !== null) throw new IdentityError('invalid_input', 422);
      return;
    }
    if (latitude === null || longitude === null) throw new IdentityError('invalid_input', 422);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) throw new IdentityError('invalid_input', 422);
  }

  // ---------------------------------------------------------------- bookmarks (PUB-02)

  /**
   * One saved list, two kinds of target.
   *
   * PART-10 gave a bookmark a second thing it can point at, and this stayed one list rather than
   * becoming two competing ones. Each row names its kind, so a screen never has to guess which
   * field to read.
   */
  async bookmarks(actorId: string) {
    await this.identity.activeUser(actorId);
    const rows = await this.db.bookmark.findMany({
      where: {
        userId: actorId,
        OR: [
          { project: { state: { in: [...PUBLICLY_VISIBLE_STATES] } } },
          { program: { state: { in: [...PUBLIC_PROGRAM_STATES] } } }
        ]
      },
      select: {
        id: true, createdAt: true,
        project: { include: publicInclude },
        program: { select: { slug: true, title: true, state: true, city: true, skills: true, applyClosesAt: true, organization: { select: { displayName: true } } } }
      },
      orderBy: { createdAt: 'desc' }
    });
    type SavedProgram = { slug: string; title: string; state: string; city: string; skills: string[]; applyClosesAt: Date | null; operator: string };
    type SavedItem = { id: string; kind: 'project' | 'program'; createdAt: Date; project: ReturnType<typeof publicProjectCard> | null; program: SavedProgram | null };
    const saved: SavedItem[] = [];
    for (const row of rows) {
      if (row.project) {
        saved.push({ id: row.id, kind: 'project', createdAt: row.createdAt, project: publicProjectCard(row.project), program: null });
      } else if (row.program) {
        saved.push({
          id: row.id, kind: 'program', createdAt: row.createdAt, project: null,
          program: {
            slug: row.program.slug, title: row.program.title, state: row.program.state,
            city: row.program.city, skills: row.program.skills, applyClosesAt: row.program.applyClosesAt,
            operator: row.program.organization.displayName
          }
        });
      }
    }
    return saved;
  }

  /**
   * PUB-02.A?? / PUB-09.A04 / PUB-10.A04. Saving something visible.
   *
   * Exactly one target, and saving deliberately creates no application: 07 treats an expression of
   * interest and a candidacy as different things, and so does this.
   */
  async addBookmark(actorId: string, input: { projectSlug?: string | undefined; programSlug?: string | undefined }) {
    await this.identity.activeUser(actorId);
    if (Boolean(input.projectSlug) === Boolean(input.programSlug)) throw new IdentityError('invalid_input', 422);

    if (input.programSlug) {
      const program = await this.db.program.findFirst({ where: { slug: input.programSlug, state: { in: [...PUBLIC_PROGRAM_STATES] }, organization: { status: 'active' } }, select: { id: true } });
      // Only something the actor can already see may be saved; anything else stays absent.
      if (!program) throw new IdentityError('not_found', 404);
      const existing = await this.db.bookmark.findFirst({ where: { userId: actorId, programId: program.id } });
      if (existing) return { id: existing.id, kind: 'program' as const, status: 'saved' as const, createsApplication: false };
      const created = await this.db.bookmark.create({ data: { userId: actorId, programId: program.id } });
      return { id: created.id, kind: 'program' as const, status: 'saved' as const, createsApplication: false };
    }

    const projectSlugValue = input.projectSlug ?? '';
    const project = await this.db.project.findFirst({ where: { slug: projectSlugValue, state: { in: [...PUBLICLY_VISIBLE_STATES] }, organization: { status: 'active' } }, select: { id: true } });
    if (!project) throw new IdentityError('not_found', 404);
    // Saving twice is the same outcome as saving once, not a duplicate row or an error.
    const existing = await this.db.bookmark.findFirst({ where: { userId: actorId, projectId: project.id } });
    if (existing) return { id: existing.id, kind: 'project' as const, status: 'saved' as const, createsApplication: false };
    const created = await this.db.bookmark.create({ data: { userId: actorId, projectId: project.id } });
    return { id: created.id, kind: 'project' as const, status: 'saved' as const, createsApplication: false };
  }

  async removeBookmark(actorId: string, bookmarkId: string) {
    await this.identity.activeUser(actorId);
    const removed = await this.db.bookmark.deleteMany({ where: { id: bookmarkId, userId: actorId } });
    // Another person's bookmark is reported absent rather than forbidden.
    if (removed.count !== 1) throw new IdentityError('not_found', 404);
    return { id: bookmarkId, status: 'removed' as const };
  }

  /**
   * The public funding figures for one project, derived from its confirmed contributions on every
   * read. There is no stored total to go stale, and a refund reduces the figure the moment it is
   * confirmed rather than when someone remembers to recalculate.
   */
  private async fundingFor(project: { id: string; state: string; campaign: { goalMinor: bigint; currency: string; policy: string; endsAt: Date } | null }) {
    if (!project.campaign) return publicFunding({ campaign: null, state: project.state, confirmed: [] });
    const confirmed = await this.db.contribution.findMany({
      where: { projectId: project.id, state: { in: [...CONFIRMED_CONTRIBUTION_STATES] } },
      select: { amountMinor: true, refundedMinor: true }
    });
    return publicFunding({ campaign: project.campaign, state: project.state, confirmed });
  }
}
