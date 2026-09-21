import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export function createDatabase(connectionString: string) {
  const adapter = new PrismaPg({ connectionString, max: 5, connectionTimeoutMillis: 2000, idleTimeoutMillis: 1000, statement_timeout: 3000 });
  return new PrismaClient({ adapter, log: [] });
}
export type DatabaseClient = ReturnType<typeof createDatabase>;
export type { User, IndividualProfile, Organization, Membership, Placement, SiteMediaItem } from './generated/prisma/client.js';
// Exported as a value, not only a type: `Prisma.JsonNull` is how a nullable JSON column is cleared,
// and there is no way to express that with a plain `null`.
export { Prisma } from './generated/prisma/client.js';
export * from './generated/prisma/enums.js';
