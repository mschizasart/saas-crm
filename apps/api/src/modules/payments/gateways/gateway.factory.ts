import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from './gateway.interface';
import { StripeGateway } from './stripe.gateway';
import { PaypalGateway } from './paypal.gateway';
import { MollieGateway } from './mollie.gateway';

@Injectable()
export class GatewayFactory {
  private readonly logger = new Logger(GatewayFactory.name);
  private gateways: Map<string, PaymentGateway> = new Map();

  constructor(private config: ConfigService) {
    this.tryRegister('stripe', () => new StripeGateway(config));
    this.tryRegister('paypal', () => new PaypalGateway(config));
    this.tryRegister('mollie', () => new MollieGateway(config));
  }

  private tryRegister(name: string, factory: () => PaymentGateway) {
    try {
      this.gateways.set(name, factory());
    } catch (e: any) {
      this.logger.warn(
        `Payment gateway '${name}' failed to initialize: ${e.message}`,
      );
    }
  }

  get(name: string): PaymentGateway {
    const gw = this.gateways.get(name);
    if (!gw) throw new Error(`Unknown or unavailable payment gateway: ${name}`);
    return gw;
  }

  has(name: string): boolean {
    return this.gateways.has(name);
  }

  list(): string[] {
    return Array.from(this.gateways.keys());
  }
}
