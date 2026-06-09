import { IsUUID } from 'class-validator';

// ─── Account hierarchy DTOs (Wave F1) ───────────────────────────

/**
 * Body for POST /clients/:id/set-parent.
 *
 * The `:id` (the child) comes from the URL; the new parent is in the
 * body. Service validates that both belong to the caller's org, that
 * the new parent isn't the child itself, that no cycle is created,
 * and that the resulting tree depth stays within MAX_DEPTH.
 */
export class SetParentDto {
  @IsUUID()
  parentClientId!: string;
}
