import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { IncomingMessage } from 'node:http';
import { fromNodeHeaders } from 'better-auth/node';
import type { DatabaseClient } from '@tamkeen/database';
import type { RuntimeConfig } from '@tamkeen/config';
import type { Auth } from './auth.js';
import { IdentityService } from './identity.service.js';

export interface SessionRuntime { db: DatabaseClient; auth: Auth; config: RuntimeConfig }

/**
 * Resolves the caller's session for any authenticated route.
 *
 * Extracted so every controller enforces exactly the same rules: a same-origin check on every
 * mutation (12-SECURITY), a session that actually exists, and an account that is still active — a
 * suspended user's cookie stops working immediately rather than at expiry. Duplicating this per
 * module is how one route ends up quietly weaker than the rest.
 */
export async function sessionFrom(runtime: SessionRuntime, req: IncomingMessage) {
  if (!['GET', 'HEAD'].includes(req.method ?? '') && req.headers.origin !== runtime.config.appBaseUrl) throw new ForbiddenException();
  const session = await runtime.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new UnauthorizedException();
  await new IdentityService(runtime.db).activeUser(session.user.id);
  // Sliding expiry for business routes, refreshed at most hourly; the stored value stays a digest.
  const refreshBefore = new Date(Date.now() - 3600_000);
  await runtime.db.session.updateMany({
    where: { id: session.session.id, updatedAt: { lt: refreshBefore } },
    data: { updatedAt: new Date(), expiresAt: new Date(Date.now() + 24 * 3600_000) }
  });
  return session;
}
