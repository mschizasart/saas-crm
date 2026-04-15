# Migrate from Perfex CRM → SaaS CRM

This script performs an ETL migration of a Perfex CRM MySQL database into
the SaaS CRM PostgreSQL database via Prisma.

## Prerequisites

```
pnpm --filter api add mysql2 php-serialize    # if not already installed
```

A running MySQL instance with the source Perfex schema, and a running
PostgreSQL instance with the SaaS CRM Prisma schema already migrated
(`pnpm --filter api db:migrate`).

## Environment variables

| Var | Description |
| --- | --- |
| `MYSQL_HOST` | MySQL host (default `localhost`) |
| `MYSQL_USER` | MySQL user |
| `MYSQL_PASSWORD` | MySQL password |
| `MYSQL_DATABASE` | Perfex database name |
| `ORG_SLUG` | Target org slug (created if missing) |
| `ORG_NAME` | Optional human-readable name for the new org |
| `DATABASE_URL` | Postgres URL for Prisma |

## Running

Dry run (reports counts, writes nothing):

```
MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD=secret MYSQL_DATABASE=perfex \
ORG_SLUG=acme \
DATABASE_URL="postgresql://crm:pass@localhost:5432/saascrm" \
pnpm --filter api migrate:perfex -- --dry-run
```

Full import:

```
MYSQL_HOST=localhost MYSQL_USER=root MYSQL_PASSWORD=secret MYSQL_DATABASE=perfex \
ORG_SLUG=acme \
DATABASE_URL="postgresql://crm:pass@localhost:5432/saascrm" \
pnpm --filter api migrate:perfex
```

## Migration order

The script walks the tables in foreign-key dependency order:

1. `tbloptions` → `organization.settings` (PHP-serialized values auto-parsed)
2. `tblroles` → `roles`
3. `tblstaff` → `users` (type=staff, `passwordFormat='phpass'`)
4. `tblcurrencies` → `currencies`
5. `tbltaxes` → `taxes`
6. `tblpayment_modes` → `payment_modes`
7. `tblclients` → `clients`
8. `tblcontacts` → `users` (type=contact, linked to client)
9. `tblleads_status` / `tblleads_source` / `tblleads`
10. `tblinvoices` + `tblitemable` → `invoices` + `invoice_items`
11. `tblinvoicepaymentrecords` → `payments`
12. `tblprojects` + `tbltasks`
13. `tbltickets` + `tblticket_replies`
14. `tblcontracts`
15. `tblestimates`
16. `tblproposals`
17. `tblexpenses_categories` + `tblexpenses`
18. `tblkb_groups` + `tblknowledge_base`

A UUID map is built during run so new UUIDs replace integer IDs, and
cross-entity foreign keys are remapped consistently.

## Post-migration

* **Passwords**: existing users keep their phpass hashes. On next login,
  `AuthService.validateUser` detects `passwordFormat='phpass'` and triggers
  the password reset flow (per existing TODO — see auth.service.ts).
* **Uploaded files**: `uploads/` are not migrated automatically. Sync them
  to MinIO manually or add a file-copy step to the script.
* **Custom fields**: existing custom field values need a separate pass if
  your tenants depend on them — not yet implemented.

## Re-running

The script is idempotent via `upsert` keyed on UUID (built from legacy ID).
You can safely re-run after fixing source data — existing rows will be
updated in place.

## Troubleshooting

- **`query failed: Table 'xxx' doesn't exist`** — your Perfex install may
  not have that module installed. The script logs and continues.
- **Slow import** — large orgs take time; each row is a round-trip. Consider
  adding `prisma.$transaction([])` batching if > 100k rows.
