import { IsIn, IsNotEmpty, IsOptional, IsUUID } from 'class-validator';

/**
 * Body for POST /tax/calculate.
 *
 * `entityType` MUST be one of the two known kinds — without this validation
 * any string routed to the estimate path (the non-invoice fallback). `entityId`
 * must be a real UUID so a malformed id can't reach the DB lookup.
 */
export class CalculateTaxDto {
  @IsOptional()
  @IsIn(['invoice', 'estimate'])
  entityType?: 'invoice' | 'estimate';

  @IsUUID('4')
  @IsNotEmpty()
  entityId!: string;
}
