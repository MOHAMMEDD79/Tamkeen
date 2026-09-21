import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { CURRENT_TERMS_VERSION, loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { OperationsService } from '../apps/api/dist/modules/operations/operations.service.js';
import { fanOutFollowEvent, processNotificationBatch } from '../apps/worker/dist/notifications.js';
import { processExportBatch } from '../apps/worker/dist/exports.js';

const config = loadConfig(process.env);

test('PART-13 support, notification, audit and freeze foundations on PostgreSQL', async () => {
  const db = createDatabase(config.databaseUrl);
  const service = new OperationsService(db);
  const prefix = randomUUID();
  const users: string[] = [];
  const createUser = async (name: string) => {
    const user = await db.user.create({ data: { email: `${prefix}-${name}@example.test`, name, emailVerified: true, termsVersion: CURRENT_TERMS_VERSION, termsAcceptedAt: new Date() } });
    users.push(user.id);
    return user;
  };

  try {
    const requester = await createUser('requester');
    const stranger = await createUser('stranger');
    const support = await createUser('support');
    const riskA = await createUser('risk-a');
    const riskB = await createUser('risk-b');
    const auditor = await createUser('auditor');
    const operator = await createUser('operator');
    await db.platformGrant.createMany({ data: [
      { userId: support.id, role: 'Support', grantedBy: support.id },
      { userId: riskA.id, role: 'RiskReviewer', grantedBy: riskA.id },
      { userId: riskB.id, role: 'RiskReviewer', grantedBy: riskB.id },
      { userId: auditor.id, role: 'Auditor', grantedBy: auditor.id },
      { userId: operator.id, role: 'Operations', grantedBy: operator.id }
    ] });

    const ticket = await service.createTicket(requester.id, { subjectType: 'project', subjectId: randomUUID(), category: 'content', title: 'A published statement needs review', body: 'The public statement and its source appear to disagree.' });
    assert.equal(ticket.private, true);
    assert.equal(ticket.financialRightsChanged, false);
    await assert.rejects(() => service.get(stranger.id, ticket.id));
    assert.equal((await service.mine(requester.id))[0]?.reference, ticket.reference);

    const claimed = await service.claim(support.id, ticket.id, ticket.version);
    assert.equal(claimed.assigneeId, support.id);
    await assert.rejects(() => service.claim(riskA.id, ticket.id, ticket.version));
    await service.reply(support.id, ticket.id, 'We are checking the referenced public snapshot.');
    const current = await db.supportTicket.findUniqueOrThrow({ where: { id: ticket.id } });
    const resolved = await service.resolve(support.id, ticket.id, { resolutionCode: 'corrected', resolution: 'The public snapshot was corrected and its source is now named.', version: current.version });
    assert.equal(resolved.state, 'resolved');
    const reopened = await service.reopen(requester.id, ticket.id, 'The corrected page still shows the old date.', resolved.version);
    assert.equal(reopened.state, 'open');

    const notification = await db.userNotification.create({ data: { recipientId: requester.id, eventType: 'ticket.reopened', title: 'Ticket reopened', body: 'Your ticket is open again.', safePath: `/app/tickets/${ticket.id}`, dedupKey: `${ticket.id}:requester:v1` } });
    await db.notificationOutbox.create({ data: { notificationId: notification.id, channel: 'in_app' } });
    await assert.rejects(() => service.readNotification(stranger.id, notification.id));
    assert.ok((await service.readNotification(requester.id, notification.id)).readAt);
    assert.equal((await service.readAll(requester.id, new Date())).read, 0);
    const preferences = await service.notificationPreferences(requester.id);
    assert.equal(preferences.emailFollowUpdates, false);
    const savedPreferences = await service.updateNotificationPreferences(requester.id, { emailReminders: false, emailFollowUpdates: true, version: preferences.version });
    assert.equal(savedPreferences.emailFollowUpdates, true);
    await assert.rejects(() => service.updateNotificationPreferences(requester.id, { emailReminders: true, emailFollowUpdates: false, version: preferences.version }), /conflict/, 'a stale tab cannot overwrite newer preferences');
    const archivedTerms = service.policyVersion('terms', CURRENT_TERMS_VERSION);
    assert.match(archivedTerms.content, new RegExp(CURRENT_TERMS_VERSION));
    assert.throws(() => service.policyVersion('terms', 'missing-version'), /not_found/);
    await db.user.update({ where: { id: requester.id }, data: { twoFactorEnabled: true } });
    const exportSession = await db.session.create({ data: { userId: requester.id, token: randomUUID().replaceAll('-', '').padEnd(64, '0').slice(0, 64), expiresAt: new Date(Date.now() + 3600_000) } });
    const dataChallenge = await service.createDataExportChallenge(requester.id, exportSession.id);
    await db.mfaChallenge.update({ where: { id: dataChallenge.id }, data: { state: 'verified', verifiedAt: new Date() } });
    const dataExport = await service.requestDataExport(requester.id, exportSession.id, dataChallenge.id);
    await assert.rejects(() => service.requestDataExport(requester.id, exportSession.id, dataChallenge.id), /mfa_unavailable/, 'one re-authentication creates one snapshot only');
    assert.equal(await processExportBatch(db), 1);
    const accountData = await service.downloadExport(requester.id, dataExport.id);
    assert.equal(accountData.mimeType, 'application/json');
    assert.match(accountData.content ?? '', new RegExp(requester.email));

    const followedProject = randomUUID();
    const follow = await service.follow(requester.id, { subjectType: 'project', subjectId: followedProject });
    assert.equal((await service.follow(requester.id, { subjectType: 'project', subjectId: followedProject })).id, follow.id);
    const eventId = randomUUID();
    const update = { id: eventId, subjectType: 'project' as const, subjectId: followedProject, eventType: 'project.updated', title: 'Project update', body: 'A verified public update is available.', safePath: `/projects/${followedProject}` };
    assert.equal(await fanOutFollowEvent(db, update), 1);
    assert.equal(await fanOutFollowEvent(db, update), 1);
    const followedNotification = await db.userNotification.findUniqueOrThrow({ where: { dedupKey: `${eventId}:${requester.id}:1` } });
    const followedOutbox = await db.notificationOutbox.findUniqueOrThrow({ where: { notificationId: followedNotification.id } });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await db.notificationOutbox.update({ where: { id: followedOutbox.id }, data: { nextAttemptAt: new Date(0) } });
      await processNotificationBatch(db, async () => { throw new TypeError('simulated delivery failure'); }, new Date());
    }
    assert.equal((await db.notificationOutbox.findUniqueOrThrow({ where: { id: followedOutbox.id } })).state, 'dead_letter');
    await assert.rejects(() => service.unfollow(stranger.id, follow.id));
    assert.equal((await service.unfollow(requester.id, follow.id)).removed, true);

    const resourceId = randomUUID();
    const auditEvent = await db.identityAuditEvent.create({ data: { actorId: support.id, action: 'support.ticket.claim', resourceId } });
    await assert.rejects(() => service.audit(stranger.id, { take: 20 }));
    const audit = await service.audit(auditor.id, { action: 'support.ticket.claim', take: 20 });
    assert.equal(audit.find(row => row.resourceId === resourceId)?.redacted, true);
    await assert.rejects(() => service.auditEvent(stranger.id, auditEvent.id));
    assert.deepEqual(await service.auditEvent(auditor.id, auditEvent.id), { id: auditEvent.id, actorId: support.id, organizationId: null, action: 'support.ticket.claim', resourceId, createdAt: auditEvent.createdAt, redacted: true });
    await db.identityAuditEvent.create({ data: { actorId: support.id, action: '=spreadsheet_formula', resourceId: randomUUID() } });
    const exportJob = await service.requestAuditExport(auditor.id, { reason: 'Required for the quarterly independent access review.' });
    assert.equal(await processExportBatch(db), 1);
    const readyExport = await service.exportJob(auditor.id, exportJob.id);
    assert.equal(readyExport.state, 'ready');
    assert.match((await service.downloadExport(auditor.id, exportJob.id)).content, /'=spreadsheet_formula/);
    await assert.rejects(() => service.downloadExport(stranger.id, exportJob.id));
    assert.equal((await service.revokeExport(auditor.id, exportJob.id, readyExport.version)).state, 'revoked');
    const contributionExport = await service.requestPersonalExport(requester.id, 'contributions_csv');
    const investmentExport = await service.requestPersonalExport(requester.id, 'investments_csv');
    assert.equal(await processExportBatch(db), 2);
    const contributionDownload = await service.downloadExport(requester.id, contributionExport.id);
    assert.match(contributionDownload.filename ?? '', /^contributions-/);
    assert.match(contributionDownload.content ?? '', /amount_minor/);
    const investmentDownload = await service.downloadExport(requester.id, investmentExport.id);
    assert.match(investmentDownload.filename ?? '', /^investments-/);
    assert.match(investmentDownload.content ?? '', /proof_reference/);
    await assert.rejects(() => service.downloadExport(stranger.id, contributionExport.id), /not_found/);
    const incident = await db.operationalIncident.create({ data: { reference: `INC-${prefix.slice(0, 8)}`, severity: 'medium', summary: 'Worker delivery lag exceeded the review threshold.', redactedLog: 'No personal data; queue age only.' } });
    assert.equal((await service.incident(operator.id, incident.id)).reference, incident.reference);
    assert.equal((await service.operationsOverview(operator.id)).incidentsOpen >= 1, true);
    await assert.rejects(() => service.requestFlagChange(operator.id, 'MONEY_ENABLED', true, 'Operations staff cannot authorize release controls.'));
    assert.equal((await service.recordRestoreDrill(operator.id, { environment: 'local-test', evidenceRef: 'qa/restore/drill-001', measuredRpoMins: 2, measuredRtoMins: 7, outcome: 'passed', notes: 'Verified row counts and checksums.', performedAt: new Date() })).outcome, 'passed');

    const subjectId = randomUUID();
    const freeze = await service.freeze(riskA.id, subjectId, { subjectType: 'project', scope: 'publish', reason: 'A reported public claim needs independent review.' });
    await assert.rejects(() => service.freeze(riskA.id, subjectId, { subjectType: 'project', scope: 'publish', reason: 'A second active freeze must not replace the first.' }));
    await assert.rejects(() => service.unfreeze(riskA.id, subjectId, { freezeId: freeze.id, reason: 'The same reviewer cannot clear their own freeze.', version: freeze.version }));
    assert.ok((await service.unfreeze(riskB.id, subjectId, { freezeId: freeze.id, reason: 'Independent review found the public evidence sufficient.', version: freeze.version })).unfrozenAt);
  } finally {
    await db.notificationOutbox.deleteMany({ where: { notificationId: { in: (await db.userNotification.findMany({ where: { recipientId: { in: users } }, select: { id: true } })).map(row => row.id) } } });
    await db.userNotification.deleteMany({ where: { recipientId: { in: users } } });
    await db.follow.deleteMany({ where: { followerId: { in: users } } });
    await db.exportJob.deleteMany({ where: { ownerId: { in: users } } });
    await db.operationalIncident.deleteMany({ where: { reference: { startsWith: `INC-${prefix.slice(0, 8)}` } } });
    await db.restoreDrill.deleteMany({ where: { performedBy: { in: users } } });
    await db.featureFlagChangeRequest.deleteMany({ where: { requestedBy: { in: users } } });
    const ticketIds = (await db.supportTicket.findMany({ where: { requesterId: { in: users } }, select: { id: true } })).map(row => row.id);
    // The trigger deliberately prevents product writes from erasing history. This suite owns these
    // fixture rows and runs serially, so it briefly disables only that named trigger for teardown.
    if (ticketIds.length) {
      await db.$executeRawUnsafe('ALTER TABLE support_ticket_replies DISABLE TRIGGER support_ticket_replies_append_only');
      try { await db.supportTicketReply.deleteMany({ where: { ticketId: { in: ticketIds } } }); }
      finally { await db.$executeRawUnsafe('ALTER TABLE support_ticket_replies ENABLE TRIGGER support_ticket_replies_append_only'); }
    }
    await db.supportTicket.deleteMany({ where: { id: { in: ticketIds } } });
    await db.subjectFreeze.deleteMany({ where: { frozenBy: { in: users } } });
    await db.$executeRawUnsafe('ALTER TABLE identity_audit_events DISABLE TRIGGER identity_audit_immutable');
    try { await db.identityAuditEvent.deleteMany({ where: { actorId: { in: users } } }); }
    finally { await db.$executeRawUnsafe('ALTER TABLE identity_audit_events ENABLE TRIGGER identity_audit_immutable'); }
    await db.platformGrant.deleteMany({ where: { userId: { in: users } } });
    await db.session.deleteMany({ where: { userId: { in: users } } });
    await db.party.deleteMany({ where: { userId: { in: users } } });
    await db.individualProfile.deleteMany({ where: { userId: { in: users } } });
    await db.user.deleteMany({ where: { id: { in: users } } });
    await db.$disconnect();
  }
});
