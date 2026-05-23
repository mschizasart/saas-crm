import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';

/**
 * Permission gate for POST /sms/send.
 *
 * Sending an SMS is "editing" the record it's attached to, so the required
 * permission is derived from the request body's `entityType`:
 *   - ticket  → tickets.edit
 *   - lead    → leads.edit
 *   - client  → clients.edit
 *   - (none)  → leads.edit  (a sensible default; SMS is most often lead-driven)
 *
 * We can't express "permission depends on the body" with the static
 * @Permissions() decorator + RbacGuard, so this guard reuses the same
 * role-permission lookup (user.role.permissions[resource][action]) and the
 * super-admin bypass from RbacGuard. It deliberately does NOT mirror
 * RbacGuard's portal-contact allow-bypass: /sms/send is staff-only (no
 * @PortalRoute), and a contact reaching it would bill the tenant's Twilio
 * account, so portal contacts are explicitly rejected. Per-user overrides are not
 * consulted here (RbacGuard's only extra is the override table); the entity
 * "edit" permissions covered here aren't typically overridden, and admins —
 * who do the bulk of SMS sending — bypass entirely.
 */
@Injectable()
export class SmsSendGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req.user;

    // Super-admins bypass (same as RbacGuard).
    if (user?.isAdmin) return true;

    // Portal contacts must NEVER reach /sms/send — this route has no
    // @PortalRoute() and sending bills the tenant's Twilio account. Unlike
    // RbacGuard (which allow-bypasses contacts so per-route @PortalRoute logic
    // can decide), here there is no portal path, so we explicitly reject
    // BEFORE the entity-type permission check.
    if (user?.type === 'contact') {
      throw new ForbiddenException('Not permitted');
    }

    const entityType = (req.body?.entityType ?? '').toString();
    const resource =
      entityType === 'ticket'
        ? 'tickets'
        : entityType === 'client'
          ? 'clients'
          : 'leads';
    const permission = `${resource}.edit`;

    const rolePermissions: Record<string, Record<string, boolean>> =
      user?.role?.permissions || {};
    const [res, action] = permission.split('.');
    const granted = rolePermissions?.[res]?.[action] === true;

    if (!granted) {
      throw new ForbiddenException(
        `Insufficient permissions (requires ${permission})`,
      );
    }
    return true;
  }
}
