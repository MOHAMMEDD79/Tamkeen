import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { processNotificationBatch } from './notifications.js';
import { processExportBatch } from './exports.js';
import { configuredSender, processAuthMailBatch } from './auth-mail.js';

const config = loadConfig(process.env);
const db = createDatabase(config.databaseUrl);
let stopping = false;
let pending: Promise<void> | undefined;
let mailPending: Promise<void> | undefined;
const sendMail = configuredSender(config);

async function heartbeat() {
  await db.workerHeartbeat.upsert({ where: { workerId: 'foundation-worker' }, create: { workerId: 'foundation-worker', lastSeen: new Date() }, update: { lastSeen: new Date() } });
  await processNotificationBatch(db);
  await processExportBatch(db);
}
function tick() {
  if (stopping || pending) return;
  pending = heartbeat().catch(() => console.error(JSON.stringify({ service: 'worker', event: 'database_unavailable' }))).finally(() => { pending = undefined; });
}
// Auth mail runs on its own short loop: someone is waiting on the sign-up screen for it.
function mailTick() {
  if (stopping || mailPending) return;
  mailPending = processAuthMailBatch(db, sendMail).then(() => undefined).catch(() => console.error(JSON.stringify({ service: 'worker', event: 'auth_mail_unavailable' }))).finally(() => { mailPending = undefined; });
}
tick();
mailTick();
const timer = setInterval(tick, config.heartbeatMs);
const mailTimer = setInterval(mailTick, 3000);
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  clearInterval(mailTimer);
  await pending;
  await mailPending;
  await db.$disconnect();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
console.log(JSON.stringify({ service: 'worker', event: 'started', mode: 'heartbeat-and-notification-delivery', authMail: config.emailMode }));
