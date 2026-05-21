import { IsIn, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { MEMBERSHIP_ROLES, MembershipRole } from './invite-membership.dto';

/**
 * Body for PATCH /api/v1/memberships/:id — change a member's granular
 * per-org Role and/or coarse tier.
 *
 *  - `roleId`: a UUID (a Role in the membership's org) or explicitly `null`
 *    to clear it (fail-closed → no permissions). OMITTING the field is a
 *    no-op (the existing roleId is preserved); passing `null` clears it.
 *    These two cases are distinguished via `'roleId' in dto` in the
 *    controller — do NOT collapse them with `?? null`.
 *
 *  - `role`: the coarse tier ('admin' | 'staff' | 'owner'). The tier is set
 *    EXPLICITLY only — it is NEVER inferred from the assigned Role's name.
 *    Omitting it preserves the current tier. Granting 'admin'/'owner'
 *    requires the caller to be an owner (enforced in the service).
 */
export class UpdateMembershipRoleDto {
  @ApiPropertyOptional({
    nullable: true,
    description:
      "Id of a Role in the membership's organization, or null to clear the role (fail-closed). Omit the field to leave the role unchanged.",
  })
  // Allow an explicit null (clear the role); validate as UUID only when a
  // non-null value is actually present.
  @ValidateIf((_o, v) => v !== null && v !== undefined)
  @IsUUID('4')
  @IsOptional()
  roleId?: string | null;

  @ApiPropertyOptional({
    enum: MEMBERSHIP_ROLES,
    description:
      'Coarse role tier (admin|staff|owner). Set explicitly only; never inferred from the Role name. ' +
      'Omit to leave the tier unchanged. Granting admin/owner requires the caller to be an owner.',
  })
  @IsIn(MEMBERSHIP_ROLES)
  @IsOptional()
  role?: MembershipRole;
}
