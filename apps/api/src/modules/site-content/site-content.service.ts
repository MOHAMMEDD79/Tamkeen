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
export const CONTACT_STATES = ['new', 'read', 'archived'] as const;
type ContactState = typeof CONTACT_STATES[number];

export interface ItemChanges {
  sortOrder?: number | undefined; titleAr?: string | undefined; titleEn?: string | undefined; bodyAr?: string | undefined; bodyEn?: string | undefined;
  ctaLabelAr?: string | undefined; ctaLabelEn?: string | undefined; ctaHref?: string | undefined; defaultImage?: string | undefined; active?: boolean | undefined;
}
/** Type and checksum are read back from the stored bytes by the caller, never taken from a body. */
export interface StoredImage { imageKey: string; contentType: string; checksum: string }

const imageUrl = (item: Pick<SiteMediaItem, 'imageKey' | 'defaultImage'>) => item.imageKey ? siteMediaUrl(item.imageKey) : item.defaultImage;

function publicItem(item: SiteMediaItem) {
  const hasCta = item.ctaHref !== '' && (item.ctaLabelAr !== '' || item.ctaLabelEn !== '');
  return {
    id: item.id, slot: item.slot, sortOrder: item.sortOrder,
    title: { ar: item.titleAr, en: item.titleEn },
    body: { ar: item.bodyAr, en: item.bodyEn },
    cta: hasCta ? { label: { ar: item.ctaLabelAr, en: item.ctaLabelEn }, href: item.ctaHref } : null,
    imageUrl: imageUrl(item)
  };
}

function adminItem(item: SiteMediaItem) {
  return {
    id: item.id, slot: item.slot, sortOrder: item.sortOrder,
    title: { ar: item.titleAr, en: item.titleEn },
    body: { ar: item.bodyAr, en: item.bodyEn },
    cta: { label: { ar: item.ctaLabelAr, en: item.ctaLabelEn }, href: item.ctaHref },
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
    return {
      hero: items.filter(item => item.slot === 'hero').map(publicItem),
      tracks: { charity: single('track.charity'), invest: single('track.invest'), work: single('track.work') },
      about: single('about'),
      contact: single('contact')
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
