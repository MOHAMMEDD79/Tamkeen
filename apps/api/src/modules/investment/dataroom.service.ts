import type { DatabaseClient, DataRoomCategory, DataRoomClassification } from '@tamkeen/database';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { IdentityError } from '../identity/policy.js';
import { IdentityService } from '../identity/identity.service.js';
import { LocalDataRoomStorage } from '../identity/verification-storage.js';

/**
 * The data room, its grants, NDA acceptances and investor questions (06, BUS-03, PUB-08).
 *
 * Two of PART-08's acceptance criteria live here.
 *
 * **Data rooms are isolated.** Access is granted per offering. A grant on one offering gives
 * nothing on another, not even to the same person, and not even when both belong to the same
 * organisation. Every read re-derives access from scratch for the offering being asked about;
 * nothing is cached on the session or inherited from a parent page.
 *
 * **The version accepted is preserved.** An acceptance copies the checksum of the disclosure it was
 * given. Publishing a revision does not change, invalidate or rewrite it — the old acceptance still
 * points at the exact text that was agreed, and the person is simply shown that a newer version now
 * exists and needs a fresh acknowledgement.
 */

const CATEGORIES: readonly DataRoomCategory[] = [
  'company_profile', 'historical_performance', 'use_of_funds', 'current_ownership', 'contracts', 'risks', 'due_diligence_report'
] as const;
const CLASSIFICATIONS: readonly DataRoomClassification[] = ['public', 'nda', 'granted'] as const;

const text = (value: unknown, min: number, max: number) => {
  if (typeof value !== 'string') throw new IdentityError('invalid_input', 422);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max) throw new IdentityError('invalid_input', 422);
  return trimmed;
};

/** What someone may see in one offering's data room, and why. */
export interface DataRoomAccess {
  /** Public documents are readable by anyone; this says whether the private ones are. */
  level: 'public' | 'nda' | 'granted';
  hasLiveGrant: boolean;
  /** True only when the acceptance is against the disclosure currently in force. */
  hasCurrentNda: boolean;
  /** Set when an older acceptance exists but the disclosure has been revised since. */
  ndaOutOfDate: boolean;
  grantExpiresAt: Date | null;
}

export class DataRoomService {
  private readonly identity: IdentityService;
  private readonly storage = new LocalDataRoomStorage();
  constructor(private readonly db: DatabaseClient) {
    this.identity = new IdentityService(db);
  }

  /**
   * Works out what this person may see in **this** offering. Called on every read, per offering.
   *
   * There is no shortcut from being a member of the organisation, from holding a grant somewhere
   * else, or from having been in this room yesterday: a revoked or expired grant returns nothing.
   */
  async accessFor(userId: string, offeringId: string): Promise<DataRoomAccess> {
    const now = new Date();
    const [grant, offering] = await Promise.all([
      this.db.dataRoomGrant.findFirst({
        where: { offeringId, userId, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { expiresAt: 'desc' }
      }),
      this.db.offering.findUnique({ where: { id: offeringId }, select: { currentDisclosureId: true } })
    ]);
    const acceptances = await this.db.ndaAcceptance.findMany({ where: { offeringId, userId }, select: { disclosureId: true } });
    const hasCurrentNda = Boolean(offering?.currentDisclosureId && acceptances.some(acceptance => acceptance.disclosureId === offering.currentDisclosureId));
    const ndaOutOfDate = acceptances.length > 0 && !hasCurrentNda;

    return {
      // A grant is the strongest level, but it does not substitute for the acceptance: the two are
      // different promises, and 06 asks for both where the offering requires an NDA.
      level: grant ? 'granted' : hasCurrentNda ? 'nda' : 'public',
      hasLiveGrant: Boolean(grant),
      hasCurrentNda,
      ndaOutOfDate,
      grantExpiresAt: grant?.expiresAt ?? null
    };
  }

  /** Whether a classification is visible at a given access level. */
  private visible(classification: DataRoomClassification, access: DataRoomAccess, isStaff: boolean) {
    if (isStaff) return true;
    if (classification === 'public') return true;
    if (classification === 'nda') return access.hasCurrentNda || access.hasLiveGrant;
    return access.hasLiveGrant;
  }

  /** True for someone who manages this offering from inside the issuing organisation. */
  private async isIssuerStaff(userId: string, organizationId: string) {
    try {
      await this.identity.access(userId, organizationId, 'offering.manage');
      return true;
    } catch { return false; }
  }

  // ---------------------------------------------------------------- reading the room

  /** The room as this person may see it. Documents they cannot open are counted, never listed. */
  async read(actorId: string, offeringId: string) {
    const user = await this.identity.activeUser(actorId);
    const offering = await this.db.offering.findUnique({ where: { id: offeringId } });
    if (!offering) throw new IdentityError('not_found', 404);

    const [access, isStaff] = await Promise.all([
      this.accessFor(user.id, offeringId),
      this.isIssuerStaff(user.id, offering.organizationId)
    ]);
    const documents = await this.db.dataRoomDocument.findMany({
      where: { offeringId, supersededById: null },
      orderBy: [{ category: 'asc' }, { createdAt: 'asc' }]
    });

    const visible = documents.filter(document => this.visible(document.classification, access, isStaff));
    return {
      offeringId,
      access: { ...access, isIssuerStaff: isStaff },
      requiresNda: offering.requiresNda,
      documents: visible.map(document => ({
        id: document.id, title: document.title, category: document.category,
        classification: document.classification, checksum: document.checksum,
        byteSize: document.byteSize, contentType: document.contentType,
        sequence: document.sequence, scanState: document.scanState,
        downloadAvailable: document.scanState === 'clean' && Boolean(document.storageKey),
        downloadUnavailableReason: document.scanState === 'clean' && document.storageKey ? null : document.scanState
      })),
      // Stated rather than hidden: the person can see that more exists and what would unlock it.
      withheld: documents.length - visible.length
    };
  }

  // ---------------------------------------------------------------- PUB-08: asking to come in

  /** PUB-08.A02. A request to enter, which the issuer decides on. */
  async requestAccess(actorId: string, offeringId: string, reason: string) {
    const user = await this.identity.activeUser(actorId);
    const offering = await this.db.offering.findFirst({ where: { id: offeringId, state: { in: ['open', 'suspended', 'closing'] } } });
    if (!offering) throw new IdentityError('not_found', 404);
    const stated = text(reason, 10, 1000);

    const existing = await this.db.dataRoomAccessRequest.findUnique({ where: { offeringId_userId: { offeringId, userId: user.id } } });
    if (existing && existing.state === 'requested') throw new IdentityError('conflict', 409);
    const record = await this.db.dataRoomAccessRequest.upsert({
      where: { offeringId_userId: { offeringId, userId: user.id } },
      create: { offeringId, userId: user.id, reason: stated },
      update: { state: 'requested', reason: stated, decidedBy: null, decidedAt: null, version: { increment: 1 } }
    });
    return { id: record.id, state: record.state, version: record.version };
  }

  /**
   * Accepting the NDA, which is the disclosure as it stands right now.
   *
   * The checksum is copied in, so the acceptance keeps pointing at the text that was agreed even
   * after the offering publishes a revision.
   */
  async acceptNda(actorId: string, offeringId: string, input: { disclosureId: string; checksum: string }) {
    const user = await this.identity.activeUser(actorId);
    const offering = await this.db.offering.findUnique({ where: { id: offeringId }, include: { currentDisclosure: true } });
    if (!offering?.currentDisclosure) throw new IdentityError('not_found', 404);
    // The person must be accepting the version they were actually shown. A stale id or a checksum
    // that no longer matches means the text changed while they were reading it.
    if (offering.currentDisclosure.id !== input.disclosureId) throw new IdentityError('conflict', 409);
    if (offering.currentDisclosure.checksum !== input.checksum) throw new IdentityError('conflict', 409);

    const acceptance = await this.db.ndaAcceptance.upsert({
      where: { offeringId_userId_disclosureId: { offeringId, userId: user.id, disclosureId: input.disclosureId } },
      create: { offeringId, userId: user.id, disclosureId: input.disclosureId, checksum: offering.currentDisclosure.checksum },
      update: {}
    });
    return {
      id: acceptance.id, disclosureId: acceptance.disclosureId,
      checksum: acceptance.checksum, acceptedAt: acceptance.acceptedAt
    };
  }

  /** Every version this person has ever accepted, kept whatever the offering publishes later. */
  async myAcceptances(actorId: string, offeringId: string) {
    const user = await this.identity.activeUser(actorId);
    const rows = await this.db.ndaAcceptance.findMany({
      where: { offeringId, userId: user.id },
      include: { disclosure: { select: { sequence: true, publishedAt: true } } },
      orderBy: { acceptedAt: 'desc' }
    });
    return rows.map(row => ({
      id: row.id, disclosureId: row.disclosureId, sequence: row.disclosure.sequence,
      checksum: row.checksum, acceptedAt: row.acceptedAt, disclosurePublishedAt: row.disclosure.publishedAt
    }));
  }

  // ---------------------------------------------------------------- BUS-03: running the room

  async createUploadIntent(actorId: string, organizationId: string, offeringId: string, input: {
    title: string; category: string; classification: string; fileName: string; contentType: string; size: number; supersedesId?: string | null | undefined;
  }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const title = text(input.title, 2, 200);
    const fileName = text(input.fileName.normalize('NFKC'), 1, 255);
    if (!CATEGORIES.includes(input.category as DataRoomCategory) || !CLASSIFICATIONS.includes(input.classification as DataRoomClassification)) throw new IdentityError('invalid_input', 422);
    const maximum = input.contentType === 'application/pdf' ? 20 * 1024 * 1024 : ['image/png', 'image/jpeg'].includes(input.contentType) ? 10 * 1024 * 1024 : 0;
    if (!maximum || !Number.isSafeInteger(input.size) || input.size < 5 || input.size > maximum || fileName.includes('/') || fileName.includes('\\')) throw new IdentityError('invalid_input', 422);
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const documentId = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60_000);
    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId } });
      if (!offering) throw new IdentityError('not_found', 404);
      const last = await tx.dataRoomDocument.findFirst({ where: { offeringId, title }, orderBy: { sequence: 'desc' } });
      if (input.supersedesId && !(await tx.dataRoomDocument.findFirst({ where: { id: input.supersedesId, offeringId, supersededById: null } }))) throw new IdentityError('invalid_input', 422);
      const document = await tx.dataRoomDocument.create({ data: {
        id: documentId, offeringId, title, sequence: (last?.sequence ?? 0) + 1,
        category: input.category as DataRoomCategory, classification: input.classification as DataRoomClassification,
        checksum: '0'.repeat(64), byteSize: input.size, contentType: input.contentType,
        storageKey: `dataroom/${offeringId}/${documentId}.bin`, uploadTokenHash: tokenHash,
        uploadExpiresAt: expiresAt, uploadedBy: actorId
      } });
      if (input.supersedesId) await tx.dataRoomDocument.update({ where: { id: input.supersedesId }, data: { supersededById: document.id } });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: document.id, action: 'dataroom.upload_intent' } });
      return { id: document.id, fileName, token, expiresAt, maximumSize: maximum };
    });
  }

  private async uploadTarget(actorId: string, organizationId: string, offeringId: string, documentId: string, token: string, phase: 'receive' | 'finalize') {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    if (token.length < 32 || token.length > 128) throw new IdentityError('upload_unavailable', 409);
    const uploadTokenHash = createHash('sha256').update(token).digest('hex');
    const document = await this.db.dataRoomDocument.findFirst({ where: { id: documentId, offeringId, offering: { organizationId }, uploadTokenHash, uploadExpiresAt: { gt: new Date() }, scanState: 'pending_scan' } });
    if (!document?.storageKey || (phase === 'receive' ? document.actualSize !== null : document.actualSize !== document.byteSize)) throw new IdentityError('upload_unavailable', 409);
    return document;
  }

  async receiveUpload(actorId: string, organizationId: string, offeringId: string, documentId: string, token: string, request: import('node:http').IncomingMessage) {
    const document = await this.uploadTarget(actorId, organizationId, offeringId, documentId, token, 'receive');
    const result = await this.storage.receive(document.storageKey!, request, document.byteSize);
    const updated = await this.db.dataRoomDocument.updateMany({ where: { id: document.id, actualSize: null }, data: { actualSize: result.received } });
    if (updated.count !== 1) throw new IdentityError('upload_unavailable', 409);
    return { received: result.received };
  }

  async finalizeUpload(actorId: string, organizationId: string, offeringId: string, documentId: string, token: string) {
    const document = await this.uploadTarget(actorId, organizationId, offeringId, documentId, token, 'finalize');
    const result = await this.storage.inspectAndPromote(document.storageKey!, document.contentType);
    const updated = await this.db.dataRoomDocument.update({ where: { id: document.id }, data: result.clean
      ? { scanState: 'clean', checksum: result.checksum, finalizedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null }
      : { scanState: 'rejected', scanReason: result.reason, finalizedAt: new Date(), uploadTokenHash: null, uploadExpiresAt: null } });
    await this.db.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: document.id, action: result.clean ? 'dataroom.document_clean' : 'dataroom.document_rejected' } });
    return { id: updated.id, scanState: updated.scanState, scanReason: updated.scanReason, checksum: result.clean ? result.checksum : null };
  }

  async download(actorId: string, documentId: string) {
    const user = await this.identity.activeUser(actorId);
    const document = await this.db.dataRoomDocument.findUnique({ where: { id: documentId }, include: { offering: true } });
    if (!document || document.scanState !== 'clean' || !document.storageKey) throw new IdentityError('not_found', 404);
    const [access, isStaff] = await Promise.all([this.accessFor(user.id, document.offeringId), this.isIssuerStaff(user.id, document.offering.organizationId)]);
    if (!this.visible(document.classification, access, isStaff)) throw new IdentityError('forbidden', 403);
    const bytes = await this.storage.read(document.storageKey);
    await this.db.dataRoomDownload.create({ data: { documentId: document.id, userId: user.id } });
    return { bytes, contentType: document.contentType, fileName: `${document.title}.${document.contentType === 'application/pdf' ? 'pdf' : document.contentType === 'image/png' ? 'png' : 'jpg'}` };
  }

  /** BUS-03.A01. Filing a document. A replacement supersedes rather than overwrites. */
  async addDocument(actorId: string, organizationId: string, offeringId: string, input: {
    title: string; category: string; classification: string; checksum: string; byteSize: number; contentType: string; supersedesId?: string | null | undefined;
  }) {
    await this.identity.access(actorId, organizationId, 'offering.manage');
    const title = text(input.title, 2, 200);
    if (!CATEGORIES.includes(input.category as DataRoomCategory)) throw new IdentityError('invalid_input', 422);
    if (!CLASSIFICATIONS.includes(input.classification as DataRoomClassification)) throw new IdentityError('invalid_input', 422);
    if (!/^[0-9a-f]{64}$/.test(input.checksum)) throw new IdentityError('invalid_input', 422);
    if (!Number.isInteger(input.byteSize) || input.byteSize <= 0 || input.byteSize > 50_000_000) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId } });
      if (!offering) throw new IdentityError('not_found', 404);

      const last = await tx.dataRoomDocument.findFirst({ where: { offeringId, title }, orderBy: { sequence: 'desc' } });
      const document = await tx.dataRoomDocument.create({
        data: {
          offeringId, title, sequence: (last?.sequence ?? 0) + 1,
          category: input.category as DataRoomCategory,
          classification: input.classification as DataRoomClassification,
          checksum: input.checksum, byteSize: input.byteSize,
          contentType: text(input.contentType, 3, 100),
          uploadedBy: actorId
        }
      });
      if (input.supersedesId) {
        const previous = await tx.dataRoomDocument.findFirst({ where: { id: input.supersedesId, offeringId } });
        if (!previous) throw new IdentityError('invalid_input', 422);
        // The old document stays: an investor who read it must still be able to see what they read.
        await tx.dataRoomDocument.update({ where: { id: previous.id }, data: { supersededById: document.id } });
      }
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: document.id, action: 'dataroom.document_added' } });
      return { id: document.id, title: document.title, category: document.category, classification: document.classification, sequence: document.sequence, checksum: document.checksum };
    });
  }

  /** BUS-03.A02. A time-boxed grant into this offering's room, and no other. */
  async grant(actorId: string, organizationId: string, offeringId: string, input: { userId: string; expiresAt: string }) {
    await this.identity.access(actorId, organizationId, 'dataroom.manage');
    const expiresAt = new Date(input.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) throw new IdentityError('invalid_input', 422);

    return this.db.$transaction(async tx => {
      const offering = await tx.offering.findFirst({ where: { id: offeringId, organizationId } });
      if (!offering) throw new IdentityError('not_found', 404);
      const target = await tx.user.findUnique({ where: { id: input.userId } });
      if (!target || target.status !== 'active') throw new IdentityError('invalid_input', 422);

      const record = await tx.dataRoomGrant.create({ data: { offeringId, userId: target.id, grantedBy: actorId, expiresAt } });
      // Granting access answers an outstanding request, if there was one.
      await tx.dataRoomAccessRequest.updateMany({
        where: { offeringId, userId: target.id, state: 'requested' },
        data: { state: 'approved', decidedBy: actorId, decidedAt: new Date(), version: { increment: 1 } }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId, resourceId: record.id, action: 'dataroom.granted' } });
      return { id: record.id, userId: record.userId, expiresAt: record.expiresAt };
    });
  }

  /** BUS-03.A03. Revoking records why and leaves the grant that existed on the record. */
  async revoke(actorId: string, grantId: string, reason: string) {
    const stated = text(reason, 10, 1000);
    return this.db.$transaction(async tx => {
      const grant = await tx.dataRoomGrant.findUnique({ where: { id: grantId }, include: { offering: true } });
      if (!grant) throw new IdentityError('not_found', 404);
      const scoped = new DataRoomService(tx as DatabaseClient);
      await scoped.identity.access(actorId, grant.offering.organizationId, 'dataroom.manage');
      if (grant.revokedAt) throw new IdentityError('conflict', 409);
      const updated = await tx.dataRoomGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), revokedBy: actorId, revokeReason: stated }
      });
      await tx.identityAuditEvent.create({ data: { actorId, organizationId: grant.offering.organizationId, resourceId: grant.id, action: 'dataroom.revoked' } });
      return { id: updated.id, revokedAt: updated.revokedAt, revokeReason: updated.revokeReason };
    });
  }

  /** BUS-03. Who is in the room, and who has asked to be. */
  async grants(actorId: string, organizationId: string, offeringId: string) {
    await this.identity.access(actorId, organizationId, 'dataroom.manage');
    const offering = await this.db.offering.findFirst({ where: { id: offeringId, organizationId } });
    if (!offering) throw new IdentityError('not_found', 404);
    const [grants, requests] = await Promise.all([
      this.db.dataRoomGrant.findMany({ where: { offeringId }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.dataRoomAccessRequest.findMany({ where: { offeringId }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 100 })
    ]);
    const now = new Date();
    return {
      grants: grants.map(grant => ({
        id: grant.id, userId: grant.user.id, name: grant.user.name,
        expiresAt: grant.expiresAt, revokedAt: grant.revokedAt, revokeReason: grant.revokeReason,
        // Expired and revoked are different facts about why someone is no longer in the room.
        live: !grant.revokedAt && grant.expiresAt > now
      })),
      requests: requests.map(request => ({ id: request.id, userId: request.user.id, name: request.user.name, state: request.state, reason: request.reason, version: request.version, createdAt: request.createdAt }))
    };
  }

  // ---------------------------------------------------------------- questions

  /** PUB-08.A05. A question needs data room access, and is private to its asker. */
  async ask(actorId: string, offeringId: string, body: string) {
    const user = await this.identity.activeUser(actorId);
    const offering = await this.db.offering.findFirst({ where: { id: offeringId, state: { in: ['open', 'suspended', 'closing'] } } });
    if (!offering) throw new IdentityError('not_found', 404);
    const access = await this.accessFor(user.id, offeringId);
    // dataroom.read in the catalogue: without access there is nothing to ask about privately.
    if (!access.hasLiveGrant && !access.hasCurrentNda) throw new IdentityError('forbidden', 403);
    const question = await this.db.investorQuestion.create({ data: { offeringId, userId: user.id, body: text(body, 10, 2000) } });
    return { id: question.id, body: question.body, createdAt: question.createdAt };
  }

  /**
   * The questions this person may see.
   *
   * An investor sees only their own. 06 forbids a reply revealing other investors, and the simplest
   * way to keep that true is never to show one investor another's question at all.
   */
  async questions(actorId: string, offeringId: string) {
    const user = await this.identity.activeUser(actorId);
    const offering = await this.db.offering.findUnique({ where: { id: offeringId } });
    if (!offering) throw new IdentityError('not_found', 404);
    const isStaff = await this.isIssuerStaff(user.id, offering.organizationId);

    const rows = await this.db.investorQuestion.findMany({
      where: { offeringId, ...(isStaff ? {} : { userId: user.id }) },
      include: {
        replies: { orderBy: { createdAt: 'asc' }, include: { author: { select: { name: true } } } },
        ...(isStaff ? { user: { select: { id: true, name: true } } } : {})
      },
      orderBy: { createdAt: 'desc' }, take: 100
    });
    return rows.map(row => ({
      id: row.id, body: row.body, createdAt: row.createdAt, answeredAt: row.answeredAt,
      // The asker's identity reaches the issuer, who must be able to answer them, and nobody else.
      ...(isStaff && 'user' in row ? { asker: (row as { user: { name: string } }).user.name } : {}),
      replies: row.replies.map(reply => ({ id: reply.id, body: reply.body, author: reply.author.name, at: reply.createdAt }))
    }));
  }

  /** BUS-03.A04. The issuer replies. The reply reaches one investor, never a broadcast. */
  async reply(actorId: string, questionId: string, body: string) {
    return this.db.$transaction(async tx => {
      const question = await tx.investorQuestion.findUnique({ where: { id: questionId }, include: { offering: true } });
      if (!question) throw new IdentityError('not_found', 404);
      const scoped = new DataRoomService(tx as DatabaseClient);
      await scoped.identity.access(actorId, question.offering.organizationId, 'offering.manage');
      const reply = await tx.investorQuestionReply.create({ data: { questionId, authorId: actorId, body: text(body, 10, 4000) } });
      await tx.investorQuestion.update({ where: { id: questionId }, data: { answeredAt: new Date() } });
      return { id: reply.id, body: reply.body, createdAt: reply.createdAt };
    });
  }
}
