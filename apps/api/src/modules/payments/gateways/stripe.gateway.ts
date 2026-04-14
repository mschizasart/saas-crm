import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import {
  CreateCheckoutParams,
  PaymentGateway,
  WebhookResult,
} from './gateway.interface';

export class StripeGateway implements PaymentGateway {
  readonly name = 'stripe';
  private readonly logger = new Logger(StripeGateway.name);
  private stripe: Stripe | null = null;

  constructor(private config: ConfigService) {
    try {
      this.stripe = new Stripe(
        this.config.get('STRIPE_SECRET_KEY', 'sk_test_placeholder'),
      );
    } catch (e: any) {
      this.logger.warn(`Stripe init failed: ${e.message}`);
    }
  }

  async createCheckout(params: CreateCheckoutParams) {
    if (!this.stripe) throw new Error('Stripe not configured');
    const session = await this.stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: params.currency.toLowerCase(),
            product_data: { name: params.description },
            unit_amount: Math.round(params.amount * 100),
          },
          quantity: 1,
        },
      ],
      success_url: params.successUrl,
      cancel_url: params.cancelUrl,
      customer_email: params.customerEmail,
      metadata: { invoiceId: params.invoiceId },
    });
    return { checkoutUrl: session.url ?? '', sessionId: session.id };
  }

  async handleWebhook(
    rawBody: Buffer | string,
    signature: string,
  ): Promise<WebhookResult | null> {
    if (!this.stripe) return null;
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.config.get('STRIPE_WEBHOOK_SECRET', ''),
      );
    } catch (e: any) {
      this.logger.warn(`Stripe webhook verify failed: ${e.message}`);
      return null;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      return {
        invoiceId: session.metadata?.invoiceId,
        amount: (session.amount_total ?? 0) / 100,
        transactionId: session.payment_intent as string,
        status: 'success',
      };
    }
    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      return {
        invoiceId: pi.metadata?.invoiceId,
        amount: (pi.amount ?? 0) / 100,
        transactionId: pi.id,
        status: 'failed',
      };
    }
    return null;
  }
}
