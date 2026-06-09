import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { FxService } from './fx.service';
import { ConvertQueryDto, CreateRateDto, ListRatesQueryDto } from './fx.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions, Public } from '../../common/decorators/permissions.decorator';

@ApiTags('FX')
@Controller({ version: '1', path: 'fx' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class FxController {
  constructor(private readonly service: FxService) {}

  // ─── Currencies (global reference data) ──────────────────────

  /**
   * Public — the ISO 4217 currency list is the same for every
   * tenant and isn't sensitive. Skips JWT so unauthenticated UI
   * (login page currency picker, marketing pricing) can read it.
   */
  @Get('currencies')
  @Public()
  @ApiOperation({ summary: 'List all ISO 4217 currencies (global)' })
  listCurrencies() {
    return this.service.listCurrencies();
  }

  // ─── Conversion + rate lookup ────────────────────────────────

  @Get('convert')
  @Permissions('fx.view')
  @ApiOperation({
    summary: 'Convert an amount between two currencies at a given date',
  })
  convert(@CurrentOrg() org: any, @Query() query: ConvertQueryDto) {
    const amount = query.amount ?? 1;
    const asOfDate = query.asOfDate ? new Date(query.asOfDate) : undefined;
    return this.service.convert(org.id, amount, query.from, query.to, asOfDate);
  }

  // ─── Stored rates (per-org) ──────────────────────────────────

  @Get('rates')
  @Permissions('fx.view')
  @ApiOperation({ summary: 'List stored exchange rates for this org' })
  listRates(@CurrentOrg() org: any, @Query() query: ListRatesQueryDto) {
    // Query() coerces strings — re-coerce page/limit to numbers.
    return this.service.listRates(org.id, {
      from: query.from,
      to: query.to,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
  }

  @Post('rates')
  @Permissions('fx.configure')
  @ApiOperation({ summary: 'Create a manual rate override' })
  createRate(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateRateDto,
  ) {
    return this.service.createManualRate(org.id, user.id, dto);
  }

  @Delete('rates/:id')
  @Permissions('fx.configure')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a manual rate override' })
  async deleteRate(@CurrentOrg() org: any, @Param('id') id: string) {
    if (!id) throw new BadRequestException('id required');
    await this.service.deleteRate(org.id, id);
  }

  // ─── Manual ECB refresh ──────────────────────────────────────

  @Post('refresh-now')
  @Permissions('fx.configure')
  @ApiOperation({
    summary: 'Force a fetch from the ECB daily feed for this org',
  })
  refreshNow(@CurrentOrg() org: any) {
    return this.service.refreshFromEcb(org.id);
  }
}
