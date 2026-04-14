import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

/**
 * Blocks write operations when an organization's trial has expired
 * or their subscription is past_due / canceled.
 *
 * Apply globally or per-controller with @UseGuards(BillingGuard).
 */
@Injectable()
export class BillingGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const org = request.organization;

    if (!org) return true; // no tenant resolved — let auth handle it

    const { subscriptionStatus, trialEndsAt } = org;
    const now = new Date();

    // Active or in trial
    if (subscriptionStatus === 'active') return true;
    if (
      subscriptionStatus === 'trialing' &&
      (!trialEndsAt || new Date(trialEndsAt) > now)
    )
      return true;

    // Read-only methods always allowed
    const method = request.method?.toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return true;

    throw new HttpException(
      'Your trial has expired. Please upgrade your plan to continue.',
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
