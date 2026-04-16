import { Module } from '@nestjs/common';
import { CurrenciesController } from './currencies.controller';
import { ExchangeRateService } from './exchange-rate.service';

@Module({
  controllers: [CurrenciesController],
  providers: [ExchangeRateService],
  exports: [ExchangeRateService],
})
export class CurrenciesModule {}
