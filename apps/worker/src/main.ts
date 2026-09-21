import { loadConfig } from '@tamkeen/config';
import { createDatabase } from '@tamkeen/database';
import { processNotificationBatch } from './notifications.js';
import { processExportBatch } from './exports.js';

const config = loadConfig(process.env);
const db = createDatabase(config.databaseUrl);
let stopping = false;
let pending: Promise<void> | undefined;

async function heartbeat() {
  await db.workerHeartbeat.upsert({ where: { workerId: 'foundation-worker' }, create: { workerId: 'foundation-worker', lastSeen: new Date() }, update: { lastSeen: new Date() } });
  await processNotificationBatch(db);
  await processExportBatch(db);
}
function tick() {
  if (stopping || pending) return;
  pending = heartbeat().catch(() => console.error(JSON.stringify({ service: 'worker', event: 'database_unavailable' }))).finally(() => { pending = undefined; });
}
tick();
const timer = setInterval(tick, config.heartbeatMs);
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  await pending;
  await db.$disconnect();
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
console.log(JSON.stringify({ service: 'worker', event: 'started', mode: 'heartbeat-and-notification-delivery' }));
