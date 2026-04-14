import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declare required permissions on a route.
 * Format: 'resource.action'  e.g. 'invoices.view', 'clients.create'
 *
 * @example
 * @Permissions('invoices.view', 'invoices.create')
 */
export const Permissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/** Mark a route as accessible without RBAC check (still requires auth). */
export const Public = () => SetMetadata('isPublic', true);

/** Mark a route as accessible by clients in the portal. */
export const PortalRoute = () => SetMetadata('isPortal', true);
