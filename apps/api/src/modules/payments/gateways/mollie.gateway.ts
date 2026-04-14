import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateCheckoutParams,
  PaymentGateway,
  WebhookResult,
} from './gateway.interface';

export class MollieGateway implements PaymentGateway {
  readonly name = 'mollie';
  private readonly logger = new Logger(MollieGateway.name);
  private mollie: any = null;

  constructor(private config: ConfigService) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { createMollieClient } = require('@mollie/api-client');
      const apiKey = this.config.get('MOLLIE_API_KEY');
      if (!apiKey) {
        this.logger.warn(
          'Mollie API key not configured — gateway disabled',
        );
        return;
      }
      this.mollie = createMollieClient({ apiKey });
    } catch (e: any) {
      this.logger.warn(
        `Mollie SDK init failed: ${e.message}. Install @mollie/api-client and set MOLLIE_API_KEY.`,
      );
    }
  }

  async createCheckout(params: CreateCheckoutParams) {
    if (!this.mollie) throw new Error('Mollie gateway not available');
    const appUrl = this.config.get('APP_URL', 'http://localhost:3001');
    const payment = await this.mollie.payments.create({
      amount: {
        currency: params.currency.toUpperCase(),
        value: params.amount.toFixed(2),
      },
      description: params.description,
      redirectUrl: params.successUrl,
      webhookUrl: `${appUrl}/api/v1/payments/webhook/mollie`,
      metadata: { invoiceId: params.invoiceId },
    });
    return {
      checkoutUrl: payment.getCheckoutUrl?.() ?? '',
      sessionId: payment.id,
    };
  }

  async handleWebhook(
    rawBody: Buffer | string,
    _signature: string,
  ): Promise<WebhookResult | null> {
    if (!this.mollie) return null;
    try {
      const body =
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const params = new URLSearchParams(body);
      const paymentId = params.get('id');
      if (!paymentId) return null;
      const payment = await this.mollie.payments.get(paymentId);
      if (payment.status === 'paid') {
        return {
          invoiceId: payment.metadata?.invoiceId,
          amount: parseFloat(payment.amount.value),
          transactionId: payment.id,
          status: 'success',
        };
      }
      if (payment.status === 'failed' || payment.status === 'canceled') {
        return {
          invoiceId: payment.metadata?.invoiceId,
          amount: parseFloat(payment.amount.value),
          transactionId: payment.id,
          status: 'failed',
        };
      }
      return {
        invoiceId: payment.metadata?.invoiceId,
        amount: parseFloat(payment.amount.value),
        transactionId: payment.id,
        status: 'pending',
      };
    } catch (e: any) {
      this.logger.warn(`Mollie webhook handling failed: ${e.message}`);
      return null;
    }
  }
}
