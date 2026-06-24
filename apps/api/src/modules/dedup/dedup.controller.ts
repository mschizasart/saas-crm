import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsObject,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
// Match leads/clients controllers: BOTH in-app JWTs and public-API `crm_*`
// bearers are accepted (the guard delegates to JwtAuthGuard for non-`crm_`
// Authorization headers).
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { DedupService } from './dedup.service';

// ── DTOs ──────────────────────────────────────────────────────
class CandidatesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0.1)
  @Max(1)
  threshold?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(200)
  limit?: number;
}

class MergeDto {
  @IsString()
  @IsNotEmpty()
  winnerId!: string;

  @IsString()
  @IsNotEmpty()
  loserId!: string;

  // { fieldName: 'winner' | 'loser' } — see DedupService merge field logic.
  @IsOptional()
  @IsObject()
  fieldOverrides?: Record<string, 'winner' | 'loser'>;
}

@ApiTags('Dedup')
@Controller({ version: '1', path: 'dedup' })
@UseGuards(JwtOrApiKeyGuard, RbacGuard)
@ApiBearerAuth()
export class DedupController {
  constructor(private readonly service: DedupService) {}

  // ─── Lead candidates ─────────────────────────────────────────
  @Get('leads/candidates')
  @Permissions('leads.view')
  @ApiOperation({ summary: 'Detect duplicate lead pairs in the org' })
  leadCandidates(@CurrentOrg() org: any, @Query() q: CandidatesQueryDto) {
    return this.service.leadCandidates(org.id, q.threshold ?? 0.7, q.limit ?? 50);
  }

  @Get('leads/:id/candidates')
  @Permissions('leads.view')
  @ApiOperation({ summary: 'Detect duplicate candidates for one lead' })
  leadCandidatesFor(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query() q: CandidatesQueryDto,
  ) {
    return this.service.leadCandidates(org.id, q.threshold ?? 0.7, q.limit ?? 50, id);
  }

  // ─── Client candidates ───────────────────────────────────────
  @Get('clients/candidates')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Detect duplicate client pairs in the org' })
  clientCandidates(@CurrentOrg() org: any, @Query() q: CandidatesQueryDto) {
    return this.service.clientCandidates(org.id, q.threshold ?? 0.7, q.limit ?? 50);
  }

  @Get('clients/:id/candidates')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Detect duplicate candidates for one client' })
  clientCandidatesFor(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query() q: CandidatesQueryDto,
  ) {
    return this.service.clientCandidates(org.id, q.threshold ?? 0.7, q.limit ?? 50, id);
  }

  // ─── Merge ───────────────────────────────────────────────────
  @Post('leads/merge')
  @Permissions('leads.merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Merge a loser lead into a winner lead (atomic)' })
  mergeLeads(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: MergeDto,
  ) {
    return this.service.mergeLead(
      org.id,
      dto.winnerId,
      dto.loserId,
      user?.id,
      dto.fieldOverrides ?? {},
    );
  }

  @Post('clients/merge')
  @Permissions('clients.merge')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Merge a loser client into a winner client (atomic)' })
  mergeClients(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: MergeDto,
  ) {
    return this.service.mergeClient(
      org.id,
      dto.winnerId,
      dto.loserId,
      user?.id,
      dto.fieldOverrides ?? {},
    );
  }
}
