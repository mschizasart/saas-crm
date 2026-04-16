import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ExchangeRateService } from './exchange-rate.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';

@ApiTags('Currencies')
@ApiBearerAuth()
@Controller({ version: '1', path: 'currencies' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class CurrenciesController {
  constructor(private exchangeRateService: ExchangeRateService) {}

  @Get('convert')
  async convert(
    @CurrentOrg() org: any,
    @Query('amount') amount: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    const numAmount = Number(amount) || 0;
    const converted = await this.exchangeRateService.convert(
      org.id,
      numAmount,
      from,
      to,
    );
    const rate = await this.exchangeRateService.getRate(org.id, from, to);
    return { amount: numAmount, from, to, converted, rate };
  }

  @Get('base')
  async getBaseCurrency(@CurrentOrg() org: any) {
    const code = await this.exchangeRateService.getBaseCurrency(org.id);
    return { code };
  }
}
