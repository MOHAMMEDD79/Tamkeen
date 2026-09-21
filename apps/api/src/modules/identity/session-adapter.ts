import { createHash } from 'node:crypto';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import type { DatabaseClient } from '@tamkeen/database';

type Adapter = ReturnType<ReturnType<typeof prismaAdapter>>;
type Query = { model: string; where?: Parameters<Adapter['findOne']>[0]['where'] | undefined };
const hash = (token: string) => createHash('sha256').update(token).digest('hex');
function tokenFrom(args: Query): string | undefined {
  const value = args.model === 'session' ? args.where?.find(w => w.field === 'token')?.value : undefined;
  return typeof value === 'string' ? value : undefined;
}
function query<T extends Query>(args: T): T {
  if (args.model !== 'session') return args;
  return { ...args, where: args.where?.map(w => w.field === 'token' && typeof w.value === 'string' ? { ...w, value: hash(w.value) } : w) };
}

// Better Auth owns session generation, signing, verification, expiration and revocation.
// This storage boundary hashes lookup tokens without returning the hash as a bearer token.
function wrap(adapter: Omit<Adapter, 'transaction'>): Omit<Adapter, 'transaction'> {
  return {
    ...adapter,
    create: (async (args: Parameters<Adapter['create']>[0]) => {
      const token = args.model === 'session' && typeof args.data.token === 'string' ? args.data.token : undefined;
      const result = await adapter.create(token ? { ...args, data: { ...args.data, token: hash(token) } } : args);
      return token ? Object.assign(result, { token }) : result;
    }) as Adapter['create'],
    findOne: (async (args: Parameters<Adapter['findOne']>[0]) => {
      const token = tokenFrom(args);
      const result = await adapter.findOne(query(args));
      return result && token ? Object.assign(result, { token }) : result;
    }) as Adapter['findOne'],
    async findMany(args) { return adapter.findMany(query(args)); },
    update: (async (args: Parameters<Adapter['update']>[0]) => {
      const token = tokenFrom(args);
      const result = await adapter.update(query(args));
      return result && token ? Object.assign(result, { token }) : result;
    }) as Adapter['update'],
    async updateMany(args) { return adapter.updateMany(query(args)); },
    async delete(args) { return adapter.delete(query(args)); },
    async deleteMany(args) { return adapter.deleteMany(query(args)); },
    async count(args) { return adapter.count(query(args)); }
  };
}

export function hashedSessionAdapter(db: DatabaseClient) {
  const factory = prismaAdapter(db, { provider: 'postgresql', transaction: true });
  return (options: Parameters<typeof factory>[0]): Adapter => {
    const adapter = factory(options);
    return { ...wrap(adapter), transaction: callback => adapter.transaction(tx => callback(wrap(tx))) };
  };
}
