import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { processAuthMailBatch, type AuthMailMessage } from '../apps/worker/dist/auth-mail.js';

test('auth mail outbox: local mode never sends, resend mode sends once, retries, and expires stale links', async () => {
  const db = createDatabase(loadConfig(process.env).databaseUrl);
  const recipient = `mail-${randomUUID()}@example.test`;
  try {
    await processAuthMailBatch(db, undefined); // settle anything already pending on this database
    const local = await db.localAuthMail.create({ data: { recipient, purpose: 'verify', url: 'http://127.0.0.1:4000/v?token=local' } });
    await processAuthMailBatch(db, undefined);
    assert.equal((await db.localAuthMail.findUniqueOrThrow({ where: { id: local.id } })).state, 'local_only');

    const sent: { message: AuthMailMessage; key: string }[] = [];
    const sender = async (message: AuthMailMessage, key: string) => { if (message.to === recipient) sent.push({ message, key }); };
    await processAuthMailBatch(db, sender);
    assert.equal(sent.length, 0, 'switching to resend must not mail out the local backlog');

    const live = await db.localAuthMail.create({ data: { recipient, purpose: 'reset', url: 'http://127.0.0.1:3000/reset?token=live' } });
    await processAuthMailBatch(db, sender);
    await processAuthMailBatch(db, sender);
    assert.equal(sent.length, 1, 'a delivered row is never sent again');
    assert.equal(sent[0]!.key, `tamkeen-auth-mail-${live.id}`);
    const delivered = await db.localAuthMail.findUniqueOrThrow({ where: { id: live.id } });
    assert.equal(delivered.state, 'delivered');
    assert.ok(delivered.deliveredAt);

    const flaky = await db.localAuthMail.create({ data: { recipient, purpose: 'invitation', url: 'http://127.0.0.1:3000/invitations/t' } });
    const now = new Date();
    await processAuthMailBatch(db, async message => { if (message.to === recipient) throw new TypeError('network down'); }, now);
    let row = await db.localAuthMail.findUniqueOrThrow({ where: { id: flaky.id } });
    assert.equal(row.state, 'failed');
    assert.equal(row.lastErrorCode, 'TypeError');
    assert.ok(row.nextAttemptAt > now, 'a failure backs off');
    await processAuthMailBatch(db, sender, new Date(row.nextAttemptAt.getTime() + 1));
    row = await db.localAuthMail.findUniqueOrThrow({ where: { id: flaky.id } });
    assert.equal(row.state, 'delivered');
    assert.equal(row.attempts, 2);

    const stale = await db.localAuthMail.create({ data: { recipient, purpose: 'verify', url: 'http://127.0.0.1:4000/v?token=old', createdAt: new Date(Date.now() - 2 * 3600_000) } });
    await processAuthMailBatch(db, sender);
    assert.equal((await db.localAuthMail.findUniqueOrThrow({ where: { id: stale.id } })).state, 'expired', 'an hour-old link is not worth sending');
    assert.equal(sent.length, 2);
  } finally {
    await db.localAuthMail.deleteMany({ where: { recipient } });
    await db.$disconnect();
  }
});
