import { createDatabase } from '@tamkeen/database';
import { loadConfig } from '@tamkeen/config';

const config = loadConfig(process.env);
if (!['demo', 'test'].includes(config.environment) || !['local-outbox', 'resend'].includes(config.emailMode)) throw new Error('This tool is local-only');
const email = process.argv[2]?.trim().toLowerCase();
if (!email) throw new Error('Usage: pnpm mail:local name@example.test');
const db = createDatabase(config.databaseUrl);
try {
  const messages = await db.localAuthMail.findMany({ where: { recipient: email }, orderBy: { createdAt: 'desc' }, take: 5 });
  for (const mail of messages) console.log(`${mail.createdAt.toISOString()} | ${mail.purpose} | ${mail.state}\n${mail.url}\n`);
  if (!messages.length) console.log('No local messages found for that address.');
} finally { await db.$disconnect(); }
