/**
 * Public Integration API — scopes catalog.
 *
 * Scopes are the per-resource capabilities granted to a public-API key
 * (PublicApiKey.scopes — an arbitrary string[]). The api-key strategy
 * surfaces them on `request.user.scopes`; `ScopesGuard` (see
 * scopes.guard.ts) enforces that an api-key principal carries EVERY scope
 * a route requires.
 *
 * The wildcard scope `*` means full access — a key minted with `['*']`
 * passes every `@RequireScopes(...)` check. (RbacGuard honours `*`/`admin`
 * the same way for the admin controllers; we deliberately only honour `*`
 * here to keep the integration surface's grant model simple and explicit.)
 *
 * This catalog is exposed read-only via `GET /integration/scopes` so the
 * frontend can render an api-key scope picker without hard-coding the list.
 */
export interface ScopeDef {
  /**
   * The scope string stored on the key and checked by ScopesGuard.
   * Named `value` to match the frontend scope picker / developers page.
   */
  value: string;
  /** Human-readable label for a settings UI picker. */
  label: string;
  /** Longer description of what the scope grants. */
  description: string;
}

export const INTEGRATION_SCOPES: ScopeDef[] = [
  {
    value: 'leads.read',
    label: 'Leads — Read',
    description: 'List and read leads.',
  },
  {
    value: 'leads.write',
    label: 'Leads — Write',
    description: 'Create and update leads.',
  },
  {
    value: 'clients.read',
    label: 'Clients — Read',
    description: 'List and read clients.',
  },
  {
    value: 'clients.write',
    label: 'Clients — Write',
    description: 'Create and update clients.',
  },
  {
    value: 'invoices.read',
    label: 'Invoices — Read',
    description: 'List and read invoices (read-only).',
  },
  {
    value: 'opportunities.read',
    label: 'Opportunities — Read',
    description: 'List and read opportunities (read-only).',
  },
  {
    value: 'webhooks.subscribe',
    label: 'Webhooks — Subscribe',
    description:
      'Create, list and delete webhook subscriptions (Zapier REST Hooks).',
  },
  {
    value: '*',
    label: 'Full access',
    description: 'All scopes — unrestricted access to the integration API.',
  },
];

/** Convenience set of valid scope strings for cheap membership checks. */
export const INTEGRATION_SCOPE_VALUES: string[] = INTEGRATION_SCOPES.map(
  (s) => s.value,
);
