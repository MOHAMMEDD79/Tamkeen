import type { DatabaseClient } from '@tamkeen/database';

export type NotificationDelivery = (notification: { id: string; recipientId: string; title: string; body: string; safePath: string }, channel: string) => Promise<void>;
const backoffMs = (attempt: number) => Math.min(60 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));

export async function fanOutFollowEvent(db: DatabaseClient, event: { id: string; subjectType: 'organization' | 'project'; subjectId: string; eventType: string; title: string; body: string; safePath: string }) {
  if (!event.safePath.startsWith('/') || event.safePath.startsWith('//')) throw new Error('unsafe_notification_path');
  const followers = await db.follow.findMany({ where: { subjectType: event.subjectType, subjectId: event.subjectId }, select: { followerId: true } });
  for (const follower of followers) {
    const notification = await db.userNotification.upsert({
      where: { dedupKey: `${event.id}:${follower.followerId}:1` }, update: {},
      create: { recipientId: follower.followerId, eventType: event.eventType, title: event.title, body: event.body, safePath: event.safePath, dedupKey: `${event.id}:${follower.followerId}:1` }
    });
    await db.notificationOutbox.upsert({ where: { notificationId: notification.id }, update: {}, create: { notificationId: notification.id, channel: 'in_app' } });
  }
  return followers.length;
}

export async function processNotificationBatch(db: DatabaseClient, deliver: NotificationDelivery = async () => {}, now = new Date(), limit = 25) {
  let processed = 0;
  while (processed < limit) {
    const row = await db.notificationOutbox.findFirst({ where: { state: { in: ['pending', 'failed'] }, nextAttemptAt: { lte: now } }, orderBy: { nextAttemptAt: 'asc' } });
    if (!row) break;
    const claimed = await db.notificationOutbox.updateMany({ where: { id: row.id, state: row.state, attempts: row.attempts }, data: { state: 'processing', attempts: { increment: 1 } } });
    if (!claimed.count) continue;
    const notification = await db.userNotification.findUniqueOrThrow({ where: { id: row.notificationId } });
    try {
      await deliver(notification, row.channel);
      await db.notificationOutbox.update({ where: { id: row.id }, data: { state: 'delivered', deliveredAt: new Date(), lastErrorCode: '' } });
    } catch (error) {
      const attempts = row.attempts + 1;
      await db.notificationOutbox.update({ where: { id: row.id }, data: { state: attempts >= 5 ? 'dead_letter' : 'failed', lastErrorCode: error instanceof Error ? error.name.slice(0, 80) : 'delivery_error', nextAttemptAt: new Date(now.getTime() + backoffMs(attempts)) } });
    }
    processed += 1;
  }
  return processed;
}
