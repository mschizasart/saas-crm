import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import Stripe from 'stripe';
import { PrismaService } from '../../database/prisma.service';

// SaaS plans — update prices in Stripe dashboard, reference by ID here
export const PLANS = {
  starter: {
    name: 'Starter',
    maxStaff: 3,
    maxClients: 100,
    maxProjects: 10,
    features: ['invoices', 'estimates', 'tickets', 'clients'],
  },
  growth: {
    name: 'Growth',
    maxStaff: 10,
    maxClients: 500,
    maxProjects: 50,
    features: ['invoices', 'estimates', 'tickets', 'clients', 'projects', 'leads', 'proposals'],
  },
  professional: {
    name: 'Professional',
    maxStaff: 25,
    maxClients: -1,
    maxProjects: -1,
    features: 'all',
  },
  enterprise: {
    name: 'Enterprise',
    maxStaff: -1,
    maxClients: -1,
    maxProjects: -1,
    features: 'all',
  },
} as const;

@Injectable()
export class BillingService {
  private stripe: Stripe;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private events: EventEmitter2,
  ) {
    this.stripe = new Stripe(this.config.get('STRIPE_SECRET_KEY', 'sk_test_placeholder'));
  }

  async createCheckoutSession(organizationId: string, priceId: string, successUrl: string, cancelUrl: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw new NotFoundException();

    let customerId = org.stripeCustomerId;
    if (!customerId) {
      const customer = await this.stripe.customers.create({
        name: org.name,
        metadata: { organizationId },
      });
      customerId = customer.id;
      await this.prisma.organization.update({
        where: { id: organizationId },
        data: { stripeCustomerId: customerId },
      });
    }

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: { organizationId },
    });

    return { url: session.url };
  }

  async createPortalSession(organizationId: string, returnUrl: string) {
    const org = await this.prisma.organization.findUnique({ where: { id: organizationId } });
    if (!org?.stripeCustomerId) throw new BadRequestException('No billing account found');

    const session = await this.stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  }

  async handleWebhook(payload: Buffer, signature: string) {
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.get('STRIPE_WEBHOOK_SECRET', ''),
      );
    } catch {
      throw new BadRequestException('Invalid webhook signature');
    }

    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.organizationId;
        if (orgId) {
          await this.prisma.organization.update({
            where: { id: orgId },
            data: {
              stripeSubscriptionId: sub.id,
              planId: sub.items.data[0]?.price.id,
              subscriptionStatus: sub.status,
              trialEndsAt: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
            },
          });
          this.events.emit('billing.subscription_updated', { orgId, status: sub.status });
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const orgId = sub.metadata?.organizationId;
        if (orgId) {
          await this.prisma.organization.update({
            where: { id: orgId },
            data: { subscriptionStatus: 'canceled' },
          });
        }
        break;
      }
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice;
        const cid = inv.customer as string;
        const org = await this.prisma.organization.findFirst({ where: { stripeCustomerId: cid } });
        if (org) {
          await this.prisma.organization.update({
            where: { id: org.id },
            data: { subscriptionStatus: 'past_due' },
          });
        }
        break;
      }
    }

    return { received: true };
  }

  async checkPlanLimits(orgId: string, resource: 'staff' | 'clients' | 'projects') {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { planId: true },
    });
    if (!org) return;

    const priceToplan: Record<string, keyof typeof PLANS> = {
      [this.config.get('STRIPE_PRICE_STARTER', '')]: 'starter',
      [this.config.get('STRIPE_PRICE_GROWTH', '')]: 'growth',
      [this.config.get('STRIPE_PRICE_PROFESSIONAL', '')]: 'professional',
    };

    const planKey = org.planId ? priceToplan[org.planId] : null;
    const plan = planKey ? PLANS[planKey] : PLANS.starter;

    const limits = { staff: plan.maxStaff, clients: plan.maxClients, projects: plan.maxProjects };
    const limit = limits[resource];
    if (limit === -1) return;

    let count = 0;
    if (resource === 'staff') {
      count = await this.prisma.user.count({ where: { organizationId: orgId, type: 'staff', active: true } });
    } else if (resource === 'clients') {
      count = await this.prisma.client.count({ where: { organizationId: orgId, active: true } });
    } else if (resource === 'projects') {
      count = await this.prisma.project.count({ where: { organizationId: orgId } });
    }

    if (count >= limit) {
      throw new BadRequestException(
        `Plan limit reached. Upgrade to add more ${resource}. Current plan allows ${limit}.`,
      );
    }
  }
}
