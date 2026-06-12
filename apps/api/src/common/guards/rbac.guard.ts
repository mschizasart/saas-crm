import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No permissions declared — allow
    if (!requiredPermissions || requiredPermissions.length === 0) return true;

    const { user } = context.switchToHttp().getRequest();

    // Super-admins bypass all RBAC
    if (user?.isAdmin) return true;

    // Portal users (contacts) have limited access defined per-route via @PortalRoute
    if (user?.type === 'contact') return true;

    // API-key callers (Wave E3) — gated by scopes, not role permissions.
    // The api-key.strategy returns `user.scopes: string[]` and `user.role`
    // is intentionally absent. Route permissions follow the
    // `<resource>.<action>` convention where `action` is one of
    // view/create/edit/delete/configure, while scopes (per
    // CreateApiKeyDto / settings UI) use `read`/`write`. We translate
    // route actions → scope actions: view → read, anything else → write.
    if (user?.type === 'api-key') {
      const scopes: string[] = Array.isArray(user?.scopes) ? user.scopes : [];

      // Admin-equivalent escape hatches for keys provisioned with global
      // access. Either `*` or `admin` bypass per-permission checks.
      if (scopes.includes('*') || scopes.includes('admin')) return true;

      const scopeAction = (action: string): 'read' | 'write' =>
        action === 'view' ? 'read' : 'write';

      const scopeHas = (permission: string): boolean => {
        // Allow either the exact route-style permission key (in case a
        // key was minted with that format) or the translated scope key.
        if (scopes.includes(permission)) return true;
        const [resource, action] = permission.split('.');
        if (!resource || !action) return false;
        // Wildcard-on-resource (e.g. `clients.*`).
        if (scopes.includes(`${resource}.*`)) return true;
        const mapped = `${resource}.${scopeAction(action)}`;
        return scopes.includes(mapped);
      };

      const hasAll = requiredPermissions.every((p) => scopeHas(p));
      if (!hasAll) {
        throw new ForbiddenException('Insufficient API key scopes');
      }
      return true;
    }

    const rolePermissions: Record<string, Record<string, boolean>> =
      user?.role?.permissions || {};

    // Helper: read `resource.action` from the nested role permissions object.
    const roleHas = (permission: string): boolean => {
      const [resource, action] = permission.split('.');
      return rolePermissions?.[resource]?.[action] === true;
    };

    // Fetch per-user overrides. Wrap in try/catch so a missing table/column
    // (pre-migration) silently falls back to role-only behavior.
    let overrides: Array<{ permission: string; grant: boolean }> = [];
    if (user?.id) {
      try {
        overrides = await (this.prisma as any).userPermissionOverride.findMany({
          where: { userId: user.id },
          select: { permission: true, grant: true },
        });
      } catch {
        overrides = [];
      }
    }

    const overrideMap = new Map<string, boolean>();
    for (const o of overrides) overrideMap.set(o.permission, o.grant);

    const effectiveHas = (permission: string): boolean => {
      if (overrideMap.has(permission)) return overrideMap.get(permission)!;
      return roleHas(permission);
    };

    const hasAll = requiredPermissions.every((p) => effectiveHas(p));

    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
