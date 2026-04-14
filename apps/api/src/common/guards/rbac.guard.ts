import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
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

    const userPermissions: Record<string, Record<string, boolean>> =
      user?.role?.permissions || {};

    const hasAll = requiredPermissions.every((permission) => {
      const [resource, action] = permission.split('.');
      return userPermissions?.[resource]?.[action] === true;
    });

    if (!hasAll) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
