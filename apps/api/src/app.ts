import 'reflect-metadata';
import { Controller, Get, HttpException, HttpStatus, Inject, Injectable, Module, type OnApplicationShutdown } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { RuntimeConfig } from '@tamkeen/config';
import { createDatabase, type DatabaseClient } from '@tamkeen/database';
import { toNodeHandler } from 'better-auth/node';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { ZodError } from 'zod';
import { createAuth } from './modules/identity/auth.js';
import { ALLOWED_AUTH_PATHS } from './modules/identity/auth-routes.js';
import { IDENTITY_RUNTIME, IdentityController } from './modules/identity/identity.controller.js';
import { ProjectsController } from './modules/projects/projects.controller.js';
import { CharityController } from './modules/projects/charity.controller.js';
import { MoneyController } from './modules/money/money.controller.js';
import { DisbursementsController } from './modules/money/disbursements.controller.js';
import { InvestmentController } from './modules/investment/investment.controller.js';
import { EnablementController } from './modules/enablement/enablement.controller.js';
import { EmploymentController } from './modules/employment/employment.controller.js';
import { ProgramsController } from './modules/programs/programs.controller.js';
import { OperationsController } from './modules/operations/operations.controller.js';
import { SiteContentController } from './modules/site-content/site-content.controller.js';
import { IdentityError } from './modules/identity/policy.js';

const DATABASE = Symbol('DATABASE');

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}
  async onApplicationShutdown() { await this.db.$disconnect(); }
}

@Controller('health')
class HealthController {
  constructor(@Inject(DATABASE) private readonly db: DatabaseClient) {}

  @Get('live')
  live() { return { status: 'ok', service: 'tamkeen-api' }; }

  @Get('ready')
  async ready() {
    try {
      const marker = await this.db.runtimeMetadata.findUnique({ where: { key: 'foundation_version' } });
      if (marker?.value !== '1') throw new Error('Schema not ready');
      return { status: 'ready', checks: { database: 'up', schema: 'up' } };
    } catch {
      throw new HttpException({ status: 'not_ready', checks: { database: 'unavailable' } }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}

export async function createApp(config: RuntimeConfig) {
  const db = createDatabase(config.databaseUrl);
  const auth = createAuth(config, db);
  @Module({ controllers: [HealthController, IdentityController, ProjectsController, CharityController, MoneyController, DisbursementsController, InvestmentController, ProgramsController, EmploymentController, EnablementController, OperationsController, SiteContentController], providers: [{ provide: DATABASE, useValue: db }, { provide: IDENTITY_RUNTIME, useValue: { db, auth, config } }, DatabaseLifecycle] })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'], bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.appBaseUrl, credentials: true });
  const authHandler = toNodeHandler(auth);
  app.getHttpAdapter().getInstance().all('/api/v1/auth/*splat', (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    req.headers['x-tamkeen-client-ip'] = req.socket.remoteAddress ?? '127.0.0.1';
    const path = new URL(req.url ?? '/', config.apiBaseUrl).pathname.replace('/api/v1/auth', '');
    if (path.startsWith('/mfa/')) { next(); return; }
    if (!ALLOWED_AUTH_PATHS.has(path)) { res.writeHead(404); res.end(); return; }
    return authHandler(req, res);
  });
  app.useBodyParser('json', { limit: '32kb' });
  app.useGlobalFilters({ catch(exception: unknown, host) {
    const res = host.switchToHttp().getResponse();
    const code = exception instanceof IdentityError ? exception.code : exception instanceof ZodError ? 'invalid_input' : exception instanceof HttpException ? 'request_rejected' : 'internal_error';
    const status = exception instanceof IdentityError ? exception.status : exception instanceof ZodError ? 422 : exception instanceof HttpException ? exception.getStatus() : 500;
    if (exception instanceof HttpException && status === 503) return res.status(status).json(exception.getResponse());
    return res.status(status).json({ error: { code } });
  } });
  app.enableShutdownHooks();
  return app;
}
