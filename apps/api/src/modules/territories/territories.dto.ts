import {
  IsString,
  IsOptional,
  IsUUID,
  IsIn,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// ─── Territory DTOs (Wave G2) ───────────────────────────────────

export class CreateTerritoryDto {
  @IsString()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // Parent territory. Optional — roots have no parent. Cross-tenant
  // existence + cycle/depth guard happens at the service layer.
  @IsOptional()
  @IsUUID()
  parentTerritoryId?: string;

  // Designated manager (User). Cross-tenant existence guard at the
  // service layer.
  @IsOptional()
  @IsUUID()
  managerId?: string;
}

export class UpdateTerritoryDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  // `null` here explicitly clears the parent (makes the territory a
  // root). Service layer treats `null` and missing differently.
  // `@IsOptional()` only skips for `undefined`; use `@ValidateIf` so
  // an explicit `null` bypasses the UUID check and is forwarded to
  // the service (which clears the parent via Prisma).
  @ValidateIf((o) => o.parentTerritoryId !== null)
  @IsOptional()
  @IsUUID()
  parentTerritoryId?: string | null;

  @ValidateIf((o) => o.managerId !== null)
  @IsOptional()
  @IsUUID()
  managerId?: string | null;
}

// ─── Territory member DTOs ──────────────────────────────────────

export class AddMemberDto {
  @IsUUID()
  userId!: string;

  @IsIn(['member', 'manager'])
  role!: 'member' | 'manager';
}

export class UpdateMemberDto {
  @IsIn(['member', 'manager'])
  role!: 'member' | 'manager';
}

// ─── Territory assignment DTOs ──────────────────────────────────

export class AssignEntityDto {
  @IsIn(['client', 'lead', 'opportunity'])
  entityType!: 'client' | 'lead' | 'opportunity';

  @IsUUID()
  entityId!: string;
}
