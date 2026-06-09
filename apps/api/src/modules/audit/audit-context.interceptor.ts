import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable, defer } from 'rxjs';
import {
  AuditContext,
  auditContext,
} from './audit-context';

/**
 * Stash `{ orgId, userId, ip }` into the per-request AsyncLocalStorage
 * so the Prisma `auditExtension` can attribute writes without each
 * service having to pass the actor down.
 *
 *  • Pulled from `request.user` (set by JwtAuthGuard) — we accept either
 *    `orgId` or `organizationId` since two auth paths exist (JWT and
 *    API-key).
 *  • IP comes from `request.ip` (Fastify exposes it on the adapter).
 *  • If we cannot resolve an `orgId` we still install the store but
 *    leave it null — the extension will skip writes in that case.
 *
 * AsyncLocalStorage propagation through RxJS is subtle: returning
 * `auditContext.run(ctx, () => next.handle())` works ONLY if the
 * subscription is set up SYNCHRONOUSLY inside the `run()` callback.
 * Wrapping with `defer(() => …)` makes the subscription itself happen
 * inside `run()` for every subscriber, which is the only correct
 * pattern. See:
 *   https://github.com/nestjs/nest/issues/9417
 */
@Injectable()
export class AuditContextInterceptor implements NestInterceptor {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<unknown> {
    // Only HTTP requests get an audit context. WebSocket / RPC writes
    // fall through to "no context" — extension will skip.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const user = request?.user ?? {};

    const ctx: AuditContext = {
      orgId:
        request?.organization?.id ??
        user.orgId ??
        user.organizationId ??
        null,
      userId: user.sub ?? user.id ?? null,
      ip: request?.ip ?? null,
    };

    // `defer` ensures the subscription (and therefore the entire
    // downstream pipeline) is created INSIDE the `run()` callback so
    // AsyncLocalStorage propagates through the request lifecycle.
    return defer(() => auditContext.run(ctx, () => next.handle()));
  }
}
