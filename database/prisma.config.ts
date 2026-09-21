import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'schema.prisma',
  migrations: { path: 'migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://invalid:invalid@127.0.0.1:1/not_configured' }
});
