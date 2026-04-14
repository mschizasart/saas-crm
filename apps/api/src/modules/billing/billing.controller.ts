import {
  Controller,
  Post,
  Get,
  Body,
  Headers,
  RawBodyRequest,
  Req,
  UseGuards,
  Version,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { BillingService, PLANS } from './billing.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Public } from '../../common/decorators/permissions.decorator';

@ApiTags('Billing')
@Controller({ version: '1', path: 'billing' })
export class BillingController {
  constructor(private service: BillingService) {}

  @Get('plans')
  @Public()
  getPlans() {
    return PLANS;
  }

  @Post('checkout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async createCheckout(
    @CurrentOrg() org: any,
    @Body() body: { priceId: string; successUrl: string; cancelUrl: string },
  ) {
    return this.service.createCheckoutSession(
      org.id,
      body.priceId,
      body.successUrl,
      body.cancelUrl,
    );
  }

  @Post('portal')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  async createPortal(
    @CurrentOrg() org: any,
    @Body() body: { returnUrl: string },
  ) {
    return this.service.createPortalSession(org.id, body.returnUrl);
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(
    @Req() req: RawBodyRequest<any>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.service.handleWebhook(req.rawBody, signature);
  }
}
