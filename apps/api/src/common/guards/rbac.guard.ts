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
