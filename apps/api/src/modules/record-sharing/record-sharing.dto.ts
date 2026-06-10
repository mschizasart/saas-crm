import { IsUUID } from 'class-validator';

// ─── Record sharing DTOs (Wave G1) ─────────────────────────────

/**
 * Body for POST /users/:id/set-manager.
 *
 * The `:id` (the report) comes from the URL; the new manager is in
 * the body. Service validates that both belong to the caller's org,
 * that managerId !== userId, and that no cycle is created.
 *
 * To detach a user from their manager, call /users/:id/unset-manager
 * instead — keeps the DTO strict (a non-UUID body would 400 here).
 */
export class SetManagerDto {
  @IsUUID()
  managerId!: string;
}
