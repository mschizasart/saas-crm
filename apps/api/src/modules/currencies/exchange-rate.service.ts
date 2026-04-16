import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ExchangeRateService {
  constructor(private prisma: PrismaService) {}

  async convert(
    orgId: string,
    amount: number,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    if (fromCurrency === toCurrency) return amount;

    const from = await this.prisma.currency.findFirst({
      where: { organizationId: orgId, code: fromCurrency },
    });
    const to = await this.prisma.currency.findFirst({
      where: { organizationId: orgId, code: toCurrency },
    });

    if (!from?.exchangeRate || !to?.exchangeRate) return amount;

    return (amount / Number(from.exchangeRate)) * Number(to.exchangeRate);
  }

  async getRate(
    orgId: string,
    fromCurrency: string,
    toCurrency: string,
  ): Promise<number> {
    return this.convert(orgId, 1, fromCurrency, toCurrency);
  }

  async getBaseCurrency(orgId: string): Promise<string> {
    const defaultCurrency = await this.prisma.currency.findFirst({
      where: { organizationId: orgId, isDefault: true },
    });
    return defaultCurrency?.code || 'USD';
  }
}
