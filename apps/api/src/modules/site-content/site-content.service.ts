import type { DatabaseClient, SiteMediaItem } from '@tamkeen/database';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { siteMediaUrl } from './site-media-storage.js';

/**
 * Admin-controlled site content: hero slides, the three track cards, about and contact, project
 * cover photos and the public contact inbox.
 *
 * Every admin call re-checks the PlatformAdmin grant and enrolled MFA, the same gate as the team
 * screen, and every change leaves an append-only identity audit row. The public read returns
 * active items only and never an uploader, a version or an inactive draft.
 */

export const SITE_SLOTS = ['hero', 'track.charity', 'track.invest', 'track.work', 'about', 'contact'] as const;
export type SiteSlot = typeof SITE_SLOTS[number];
/**
 * A page section: `<page>.<section>`, or `<page>.<section>.<n>` for one entry of a list on it. The
 * web app owns each section's default copy; a row here holds only what the admin changed.
 */
export const SECTION_SLOT = /^(home|about|contact|invest|explore|opportunities|organizations)\.[a-z0-9-]+(\.[0-9]{1,2})?$/;
export const isSectionSlot = (slot: string) => slot.length <= 32 && SECTION_SLOT.test(slot);

/** The contact details and social links an admin can set; nothing outside this list is stored. */
export const SETTING_KEYS = [
  'contact.email', 'contact.phone', 'contact.whatsapp', 'contact.address.ar', 'contact.address.en', 'contact.hours.ar', 'contact.hours.en',
  'social.facebook', 'social.instagram', 'social.x', 'social.linkedin', 'social.youtube'
] as const;
export type SettingKey = typeof SETTING_KEYS[number];
export const CONTACT_STATES = ['new', 'read', 'archived'] as const;
/** Listings other than projects that can carry an admin cover photo. */
export const LISTING_KINDS = ['offering', 'program', 'job'] as const;
export type ListingKind = typeof LISTING_KINDS[number];
type ContactState = typeof CONTACT_STATES[number];

export interface ItemChanges {
  sortOrder?: number | undefined; titleAr?: string | undefined; titleEn?: string | undefined; bodyAr?: string | undefined; bodyEn?: string | undefined;
  kickerAr?: string | undefined; kickerEn?: string | undefined;
  ctaLabelAr?: string | undefined; ctaLabelEn?: string | undefined; ctaHref?: string | undefined;
  cta2LabelAr?: string | undefined; cta2LabelEn?: string | undefined; cta2Href?: string | undefined;
  defaultImage?: string | undefined; active?: boolean | undefined;
}
/** Type and checksum are read back from the stored bytes by the caller, never taken from a body. */
export interface StoredImage { imageKey: string; contentType: string; checksum: string }

const imageUrl = (item: Pick<SiteMediaItem, 'imageKey' | 'defaultImage'>) => item.imageKey ? siteMediaUrl(item.imageKey) : item.defaultImage;

function publicItem(item: SiteMediaItem) {
  const hasCta = item.ctaHref !== '' && (item.ctaLabelAr !== '' || item.ctaLabelEn !== '');
  const hasCta2 = item.cta2Href !== '' && (item.cta2LabelAr !== '' || item.cta2LabelEn !== '');
  return {
    id: item.id, slot: item.slot, sortOrder: item.sortOrder,
    kicker: { ar: item.kickerAr, en: item.kickerEn },
    title: { ar: item.titleAr, en: item.titleEn },
    body: { ar: item.bodyAr, en: item.bodyEn },
    cta: hasCta ? { label: { ar: item.ctaLabelAr, en: item.ctaLabelEn }, href: item.ctaHref } : null,
    cta2: hasCta2 ? { label: { ar: item.cta2LabelAr, en: item.cta2LabelEn }, href: item.cta2Href } : null,
    // A section with no uploaded photo has no image of its own: the page's default photo applies.
    imageUrl: item.imageKey ? siteMediaUrl(item.imageKey) : item.defaultImage || null
  };
}

function adminItem(item: SiteMediaItem) {
  return {
    id: item.id, slot: item.slot, sortOrder: item.sortOrder,
    kicker: { ar: item.kickerAr, en: item.kickerEn },
    title: { ar: item.titleAr, en: item.titleEn },
    body: { ar: item.bodyAr, en: item.bodyEn },
    cta: { label: { ar: item.ctaLabelAr, en: item.ctaLabelEn }, href: item.ctaHref },
    cta2: { label: { ar: item.cta2LabelAr, en: item.cta2LabelEn }, href: item.cta2Href },
    imageKey: item.imageKey, imageUrl: imageUrl(item), defaultImage: item.defaultImage,
    active: item.active, version: item.version, updatedAt: item.updatedAt
  };
}

/** Drops absent fields, so an omitted field in a PATCH means "unchanged" rather than "cleared". */
const defined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as { [K in keyof T]?: Exclude<T[K], undefined> };

const order = [{ slot: 'asc' as const }, { sortOrder: 'asc' as const }, { createdAt: 'asc' as const }];

export class SiteContentService {
  private readonly identity: IdentityService;
  constructor(private readonly db: DatabaseClient) { this.identity = new IdentityService(db); }

  admin(actorId: string) { return this.identity.platformAdministratorUser(actorId); }

  // ---------------------------------------------------------------- public

  async publicContent() {
    const items = await this.db.siteMediaItem.findMany({ where: { active: true }, orderBy: order });
    const single = (slot: SiteSlot) => { const item = items.find(entry => entry.slot === slot); return item ? publicItem(item) : null; };
    const settings = await this.db.siteSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
    return {
      hero: items.filter(item => item.slot === 'hero').map(publicItem),
      tracks: { charity: single('track.charity'), invest: single('track.invest'), work: single('track.work') },
      about: single('about'),
      contact: single('contact'),
      sections: Object.fromEntries(items.filter(item => isSectionSlot(item.slot)).map(item => [item.slot, publicItem(item)])),
      settings: Object.fromEntries(settings.filter(setting => setting.value !== '').map(setting => [setting.key, setting.value]))
    };
  }

  async createContactMessage(input: { name: string; email: string; subject: string; body: string; locale: 'ar' | 'en' }) {
    const message = await this.db.contactMessage.create({ data: { ...input, email: input.email.toLowerCase() }, select: { id: true } });
    return { id: message.id };
  }

  // ---------------------------------------------------------------- admin: items

  async adminContent(actorId: string) {
    await this.admin(actorId);
    const items = await this.db.siteMediaItem.findMany({ orderBy: order });
    return { items: items.map(adminItem), slots: SITE_SLOTS };
  }

  /** Only hero slides are created; every other slot is a seeded singleton that is edited in place. */
  async createHeroSlide(actorId: string, input: ItemChanges & { titleAr: string; titleEn: string }, image: StoredImage | null) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const last = await tx.siteMediaItem.findFirst({ where: { slot: 'hero' }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } });
      const item = await tx.siteMediaItem.create({ data: {
        slot: 'hero', ...defined(input), sortOrder: input.sortOrder ?? (last ? last.sortOrder + 1 : 0),
        defaultImage: input.defaultImage ?? '/media/defaults/hero-charity.jpg',
        ...(image ? { imageKey: image.imageKey, imageContentType: image.contentType, imageChecksum: image.checksum } : {}),
        updatedById: actorId
      } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: item.id, action: 'site_content.item.created' } });
      return adminItem(item);
    });
  }

  /** `image` undefined leaves the photo alone; null reverts to the default photo. */
  async updateItem(actorId: string, itemId: string, input: ItemChanges & { version: number }, image: StoredImage | null | undefined) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      // The same lock as a delete, so hiding one slide and deleting another cannot both pass the check.
      await tx.$queryRaw`SELECT id FROM site_media_items WHERE slot = 'hero' ORDER BY id FOR UPDATE`;
      const current = await tx.siteMediaItem.findUnique({ where: { id: itemId } });
      if (!current) throw new IdentityError('not_found', 404);
      const { version, ...changes } = input;
      if (current.version !== version) throw new IdentityError('conflict', 409);
      if (current.slot === 'hero' && current.active && changes.active === false) await this.assertAnotherActiveHero(tx as DatabaseClient, current.id);
      const updated = await tx.siteMediaItem.updateMany({
        where: { id: itemId, version },
        data: {
          ...defined(changes),
          ...(image === undefined ? {} : image ? { imageKey: image.imageKey, imageContentType: image.contentType, imageChecksum: image.checksum } : { imageKey: null, imageContentType: null, imageChecksum: null }),
          updatedById: actorId, version: { increment: 1 }
        }
      });
      if (updated.count !== 1) throw new IdentityError('conflict', 409);
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: itemId, action: 'site_content.item.updated' } });
      return adminItem(await tx.siteMediaItem.findUniqueOrThrow({ where: { id: itemId } }));
    });
  }

  async deleteHeroSlide(actorId: string, itemId: string) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      // Locks every slide so two admins deleting the last two at once cannot both succeed.
      await tx.$queryRaw`SELECT id FROM site_media_items WHERE slot = 'hero' ORDER BY id FOR UPDATE`;
      const current = await tx.siteMediaItem.findUnique({ where: { id: itemId } });
      if (!current) throw new IdentityError('not_found', 404);
      if (current.slot !== 'hero') throw new IdentityError('forbidden', 403);
      if (current.active) await this.assertAnotherActiveHero(tx as DatabaseClient, current.id);
      await tx.siteMediaItem.delete({ where: { id: itemId } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: itemId, action: 'site_content.item.deleted' } });
      return { id: itemId, deleted: true as const };
    });
  }

  /** The home page is built around the carousel; it must never be left with nothing to show. */
  private async assertAnotherActiveHero(tx: DatabaseClient, exceptId: string) {
    if (!await tx.siteMediaItem.count({ where: { slot: 'hero', active: true, id: { not: exceptId } } })) throw new IdentityError('conflict', 409);
  }

  // ---------------------------------------------------------------- admin: page sections

  /**
   * Saves a page section. The first save creates the row; later saves carry its version. `image`
   * undefined leaves the photo alone, null returns the section to its default photo.
   */
  async saveSection(actorId: string, slot: string, input: ItemChanges & { version?: number | undefined }, image: StoredImage | null | undefined) {
    if (!isSectionSlot(slot)) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const { version, ...changes } = input;
      const photo = image === undefined ? {} : image ? { imageKey: image.imageKey, imageContentType: image.contentType, imageChecksum: image.checksum } : { imageKey: null, imageContentType: null, imageChecksum: null };
      const current = await tx.siteMediaItem.findFirst({ where: { slot } });
      if (!current) {
        if (version !== undefined) throw new IdentityError('conflict', 409);
        const created = await tx.siteMediaItem.create({ data: { slot, ...defined(changes), ...photo, updatedById: actorId } });
        await tx.identityAuditEvent.create({ data: { actorId, resourceId: created.id, action: 'site_content.section.saved' } });
        return adminItem(created);
      }
      if (current.version !== version) throw new IdentityError('conflict', 409);
      const updated = await tx.siteMediaItem.updateMany({ where: { id: current.id, version }, data: { ...defined(changes), ...photo, updatedById: actorId, version: { increment: 1 } } });
      if (updated.count !== 1) throw new IdentityError('conflict', 409);
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: current.id, action: 'site_content.section.saved' } });
      return adminItem(await tx.siteMediaItem.findUniqueOrThrow({ where: { id: current.id } }));
    });
  }

  /** Back to the default copy and photo: the section's row is removed. */
  async resetSection(actorId: string, slot: string) {
    if (!isSectionSlot(slot)) throw new IdentityError('invalid_input', 422);
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const current = await tx.siteMediaItem.findFirst({ where: { slot }, select: { id: true } });
      if (!current) throw new IdentityError('not_found', 404);
      await tx.siteMediaItem.delete({ where: { id: current.id } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: current.id, action: 'site_content.section.reset' } });
      return { slot, reset: true as const };
    });
  }

  // ---------------------------------------------------------------- admin: contact details

  async settings(actorId: string) {
    await this.admin(actorId);
    const rows = await this.db.siteSetting.findMany({ where: { key: { in: [...SETTING_KEYS] } } });
    return { keys: SETTING_KEYS, values: Object.fromEntries(SETTING_KEYS.map(key => [key, rows.find(row => row.key === key)?.value ?? ''])) as Record<SettingKey, string> };
  }

  /** Every key in the body is written; an empty string clears it from the public site. */
  async saveSettings(actorId: string, values: Partial<Record<SettingKey, string | undefined>>) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      for (const [key, value] of Object.entries(values)) {
        await tx.siteSetting.upsert({ where: { key }, create: { key, value: value ?? '', updatedById: actorId }, update: { value: value ?? '', updatedById: actorId } });
      }
      // The settings are one site-wide record with no id of their own; the row is filed under the admin.
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: actorId, action: 'site_settings.saved' } });
    }).then(() => this.settings(actorId));
  }

  /** The upload itself changes nothing public; the audit row records who put the bytes there. */
  async recordUpload(actorId: string, imageId: string) {
    await this.db.identityAuditEvent.create({ data: { actorId, resourceId: imageId, action: 'site_media.uploaded' } });
  }

  // ---------------------------------------------------------------- admin: project covers

  async projectCovers(actorId: string) {
    await this.admin(actorId);
    const rows = await this.db.project.findMany({
      select: { id: true, slug: true, title: true, type: true, state: true, organization: { select: { displayName: true } }, cover: { select: { imageKey: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 200
    });
    return rows.map(({ cover, ...row }) => ({ ...row, coverUrl: cover ? siteMediaUrl(cover.imageKey) : null }));
  }

  async setProjectCover(actorId: string, projectId: string, image: StoredImage) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      if (!await tx.project.findUnique({ where: { id: projectId }, select: { id: true } })) throw new IdentityError('not_found', 404);
      const data = { imageKey: image.imageKey, contentType: image.contentType, checksum: image.checksum, updatedById: actorId };
      await tx.projectCover.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: projectId, action: 'project_cover.set' } });
      return { projectId, coverUrl: siteMediaUrl(image.imageKey) };
    });
  }

  async removeProjectCover(actorId: string, projectId: string) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const removed = await tx.projectCover.deleteMany({ where: { projectId } });
      if (!removed.count) throw new IdentityError('not_found', 404);
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: projectId, action: 'project_cover.removed' } });
      return { projectId, coverUrl: null };
    });
  }

  // ---------------------------------------------------------------- listings of every kind

  /** Every listing on the platform, of all four kinds, with its current cover (or null). */
  async listings(actorId: string) {
    await this.admin(actorId);
    const organization = { select: { displayName: true, status: true } };
    const [projects, offerings, programs, jobs, covers] = await Promise.all([
      this.db.project.findMany({ select: { id: true, slug: true, title: true, type: true, state: true, organization, cover: { select: { imageKey: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 300 }),
      this.db.offering.findMany({ select: { id: true, slug: true, title: true, state: true, organization }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 300 }),
      this.db.program.findMany({ select: { id: true, slug: true, title: true, state: true, skills: true, organization }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 300 }),
      this.db.job.findMany({ select: { id: true, slug: true, title: true, state: true, skills: true, organization }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 300 }),
      this.db.listingCover.findMany()
    ]);
    const cover = (kind: ListingKind, id: string) => { const row = covers.find(entry => entry.kind === kind && entry.subjectId === id); return row ? siteMediaUrl(row.imageKey) : null; };
    return {
      projects: projects.map(({ cover: projectCover, ...row }) => ({ ...row, coverUrl: projectCover ? siteMediaUrl(projectCover.imageKey) : null })),
      offerings: offerings.map(row => ({ ...row, coverUrl: cover('offering', row.id) })),
      programs: programs.map(row => ({ ...row, coverUrl: cover('program', row.id) })),
      jobs: jobs.map(row => ({ ...row, coverUrl: cover('job', row.id) }))
    };
  }

  private async listingExists(tx: DatabaseClient, kind: ListingKind, id: string) {
    const select = { select: { id: true }, where: { id } };
    const row = kind === 'offering' ? await tx.offering.findUnique(select) : kind === 'program' ? await tx.program.findUnique(select) : await tx.job.findUnique(select);
    if (!row) throw new IdentityError('not_found', 404);
  }

  async setListingCover(actorId: string, kind: ListingKind, subjectId: string, image: StoredImage) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      await this.listingExists(tx as DatabaseClient, kind, subjectId);
      const data = { imageKey: image.imageKey, contentType: image.contentType, checksum: image.checksum, updatedById: actorId };
      await tx.listingCover.upsert({ where: { kind_subjectId: { kind, subjectId } }, create: { kind, subjectId, ...data }, update: data });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: subjectId, action: `${kind}_cover.set` } });
      return { kind, subjectId, coverUrl: siteMediaUrl(image.imageKey) };
    });
  }

  async removeListingCover(actorId: string, kind: ListingKind, subjectId: string) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const removed = await tx.listingCover.deleteMany({ where: { kind, subjectId } });
      if (!removed.count) throw new IdentityError('not_found', 404);
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: subjectId, action: `${kind}_cover.removed` } });
      return { kind, subjectId, coverUrl: null };
    });
  }

  /** Public: the cover photo of each offering, programme and job that has one, keyed by slug. */
  async publicListingCovers() {
    const covers = await this.db.listingCover.findMany();
    const ids = (kind: ListingKind) => covers.filter(row => row.kind === kind).map(row => row.subjectId);
    const [offerings, programs, jobs] = await Promise.all([
      this.db.offering.findMany({ where: { id: { in: ids('offering') } }, select: { id: true, slug: true } }),
      this.db.program.findMany({ where: { id: { in: ids('program') } }, select: { id: true, slug: true } }),
      this.db.job.findMany({ where: { id: { in: ids('job') } }, select: { id: true, slug: true } })
    ]);
    const bySlug = (kind: ListingKind, rows: Array<{ id: string; slug: string }>) => Object.fromEntries(rows.map(row => {
      const cover = covers.find(entry => entry.kind === kind && entry.subjectId === row.id)!;
      return [row.slug, siteMediaUrl(cover.imageKey)];
    }));
    return { offering: bySlug('offering', offerings), program: bySlug('program', programs), job: bySlug('job', jobs) };
  }

  // ---------------------------------------------------------------- admin: contact inbox

  async contactMessages(actorId: string, state: ContactState | undefined) {
    await this.admin(actorId);
    return this.db.contactMessage.findMany({ where: state ? { state } : {}, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], take: 200 });
  }

  async setContactMessageState(actorId: string, messageId: string, state: Exclude<ContactState, 'new'>) {
    return this.db.$transaction(async tx => {
      await new IdentityService(tx as DatabaseClient).platformAdministratorUser(actorId);
      const current = await tx.contactMessage.findUnique({ where: { id: messageId } });
      if (!current) throw new IdentityError('not_found', 404);
      const updated = await tx.contactMessage.update({ where: { id: messageId }, data: { state, readAt: current.readAt ?? new Date(), handledById: actorId } });
      await tx.identityAuditEvent.create({ data: { actorId, resourceId: messageId, action: `contact_message.${state}` } });
      return updated;
    });
  }
}
