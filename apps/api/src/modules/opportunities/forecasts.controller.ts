import {
  Controller,
  Get,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';

import { ForecastsService } from './forecasts.service';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Forecasts')
@Controller({ version: '1', path: 'forecasts' })
@UseGuards(JwtOrApiKeyGuard, RbacGuard)
@ApiBearerAuth()
export class ForecastsController {
  constructor(private service: ForecastsService) {}

  @Get('weighted')
  @Permissions('opportunities.view')
  @ApiOperation({ summary: 'Weighted forecast grouped by month or quarter' })
  @ApiQuery({ name: 'period', enum: ['month', 'quarter'], required: false })
  @ApiQuery({ name: 'months', type: Number, required: false })
  weighted(
    @CurrentOrg() org: any,
    @Query('period') period: 'month' | 'quarter' = 'month',
    @Query('months') months?: string,
  ) {
    const m = months ? Number(months) : 6;
    return this.service.weighted(org.id, period, m);
  }

  @Get('by-owner')
  @Permissions('opportunities.view')
  @ApiOperation({ summary: 'Weighted forecast grouped by deal owner' })
  @ApiQuery({ name: 'months', type: Number, required: false })
  byOwner(
    @CurrentOrg() org: any,
    @Query('months') months?: string,
  ) {
    const m = months ? Number(months) : 6;
    return this.service.byOwner(org.id, m);
  }
}
