import { IsEmail, IsIn, IsOptional, IsUUID } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Membership role TIERS. Mirrors the coarse values stored in
 * `user_organization_memberships.role`. Drives the `isAdmin` bypass. The
 * granular permission set is carried by the `roleId` FK (see below). */
export const MEMBERSHIP_ROLES = ['admin', 'staff', 'owner'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export class InviteMembershipDto {
  @ApiProperty({ example: 'user@acme.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Target organization id' })
  @IsUUID('4')
  organizationId!: string;

  @ApiPropertyOptional({
    enum: MEMBERSHIP_ROLES,
    example: 'staff',
    description:
      'Coarse role tier — drives the isAdmin bypass (admin/owner). MUST be one of admin|staff|owner. ' +
      'Granting admin/owner requires the CALLER to be an owner of the target org (see service). ' +
      'Omitted → defaults to staff. The tier is NEVER inferred from the assigned Role name. ' +
      'Granular permissions come from `roleId`.',
  })
  @IsIn(MEMBERSHIP_ROLES)
  @IsOptional()
  role?: MembershipRole;

  @ApiPropertyOptional({
    description:
      'Id of a Role that belongs to the TARGET organization. Carries the granular permission set for this membership. When omitted, the org default Staff/Member role is used (or null → fail-closed if none exists).',
  })
  @IsUUID('4')
  @IsOptional()
  roleId?: string;
}
