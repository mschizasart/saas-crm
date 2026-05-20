import { IsEmail, IsIn, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/** Membership roles. Mirrors the values stored in
 * `user_organization_memberships.role`. */
export const MEMBERSHIP_ROLES = ['admin', 'staff', 'owner'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

export class InviteMembershipDto {
  @ApiProperty({ example: 'user@acme.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ description: 'Target organization id' })
  @IsUUID('4')
  organizationId!: string;

  @ApiProperty({ enum: MEMBERSHIP_ROLES, example: 'staff' })
  @IsIn(MEMBERSHIP_ROLES)
  role!: MembershipRole;
}
