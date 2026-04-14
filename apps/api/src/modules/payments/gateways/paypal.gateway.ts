import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateCheckoutParams,
  PaymentGateway,
  WebhookResult,
} from './gateway.interface';

export class PaypalGateway implements PaymentGateway {
  readonly name = 'paypal';
  private readonly logger = new Logger(PaypalGateway.name);
  private client: any = null;
  private paypal: any = null;

  constructor(private config: ConfigService) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      this.paypal = require('@paypal/checkout-server-sdk');
      const clientId = this.config.get('PAYPAL_CLIENT_ID');
      const clientSecret = this.config.get('PAYPAL_CLIENT_SECRET');
      if (!clientId || !clientSecret) {
        this.logger.warn(
          'PayPal credentials not configured — gateway disabled',
        );
        return;
      }
      const env =
        this.config.get('PAYPAL_MODE') === 'live'
          ? new this.paypal.core.LiveEnvironment(clientId, clientSecret)
          : new this.paypal.core.SandboxEnvironment(clientId, clientSecret);
      this.client = new this.paypal.core.PayPalHttpClient(env);
    } catch (e: any) {
      this.logger.warn(
        `PayPal SDK not installed or init failed: ${e.message}. Install @paypal/checkout-server-sdk to enable.`,
      );
    }
  }

  async createCheckout(params: CreateCheckoutParams) {
    if (!this.client || !this.paypal) {
      throw new Error('PayPal gateway not available');
    }
    const request = new this.paypal.orders.OrdersCreateRequest();
    request.prefer('return=representation');
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [
        {
          amount: {
            currency_code: params.currency.toUpperCase(),
            value: params.amount.toFixed(2),
          },
          description: params.description,
          custom_id: params.invoiceId,
        },
      ],
      application_context: {
        return_url: params.successUrl,
        cancel_url: params.cancelUrl,
      },
    });
    const order = await this.client.execute(request);
    const approveLink = order.result.links.find(
      (l: any) => l.rel === 'approve',
    )?.href;
    return { checkoutUrl: approveLink ?? '', sessionId: order.result.id };
  }

  async handleWebhook(
    rawBody: Buffer | string,
    _signature: string,
  ): Promise<WebhookResult | null> {
    try {
      const body =
        typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
      const event = JSON.parse(body);
      if (
        event.event_type === 'CHECKOUT.ORDER.APPROVED' ||
        event.event_type === 'PAYMENT.CAPTURE.COMPLETED'
      ) {
        const resource = event.resource ?? {};
        const invoiceId =
          resource.custom_id ?? resource.purchase_units?.[0]?.custom_id;
        const amountStr =
          resource.amount?.value ??
          resource.purchase_units?.[0]?.amount?.value;
        return {
          invoiceId,
          amount: amountStr ? parseFloat(amountStr) : undefined,
          transactionId: resource.id,
          status: 'success',
        };
      }
    } catch (e: any) {
      this.logger.warn(`PayPal webhook parse failed: ${e.message}`);
    }
    return null;
  }
}
