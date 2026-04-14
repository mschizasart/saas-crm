import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PaymentsService, CreatePaymentDto } from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Permissions,
  Public,
} from '../../common/decorators/permissions.decorator';

@ApiTags('Payments')
@Controller({ version: '1', path: 'payments' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class PaymentsController {
  constructor(private service: PaymentsService) {}

  // ─── Gateways ──────────────────────────────────────────────

  @Get('gateways')
  @Public()
  @ApiOperation({ summary: 'List available payment gateways' })
  listGateways() {
    return { gateways: this.service.listGateways() };
  }

  @Post('checkout/:invoiceId')
  @Public()
  @ApiOperation({ summary: 'Create a checkout session for an invoice' })
  async createCheckout(
    @Param('invoiceId') invoiceId: string,
    @Body()
    body: { gateway: string; successUrl: string; cancelUrl: string },
  ) {
    return this.service.createCheckoutForInvoice(
      invoiceId,
      body.gateway,
      body.successUrl,
      body.cancelUrl,
    );
  }

  @Post('webhook/stripe')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stripe payment webhook' })
  async stripeWebhook(
    @Req() req: RawBodyRequest<any>,
    @Headers('stripe-signature') signature: string,
  ) {
    return this.service.handleGatewayWebhook(
      'stripe',
      req.rawBody ?? JSON.stringify(req.body ?? {}),
      signature,
    );
  }

  @Post('webhook/paypal')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PayPal payment webhook' })
  async paypalWebhook(
    @Req() req: RawBodyRequest<any>,
    @Headers('paypal-transmission-sig') signature: string,
  ) {
    return this.service.handleGatewayWebhook(
      'paypal',
      req.rawBody ?? JSON.stringify(req.body ?? {}),
      signature ?? '',
    );
  }

  @Post('webhook/mollie')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mollie payment webhook' })
  async mollieWebhook(@Req() req: RawBodyRequest<any>) {
    const raw =
      req.rawBody ??
      (req.body && typeof req.body === 'object'
        ? new URLSearchParams(req.body as Record<string, string>).toString()
        : '');
    return this.service.handleGatewayWebhook('mollie', raw, '');
  }

  // ─── Stats ─────────────────────────────────────────────────

  @Get('stats')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get payment stats for current and last month' })
  getStats(@CurrentOrg() org: any, @Query('month') month?: string) {
    return this.service.getStats(org.id, month);
  }

  // ─── Payment Modes ─────────────────────────────────────────

  @Get('modes')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'List payment modes for the organisation' })
  getPaymentModes(@CurrentOrg() org: any) {
    return this.service.getPaymentModes(org.id);
  }

  @Post('modes')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create a payment mode' })
  createPaymentMode(@CurrentOrg() org: any, @Body() body: { name: string }) {
    return this.service.createPaymentMode(org.id, body.name);
  }

  // ─── Payments CRUD ─────────────────────────────────────────

  @Get()
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'List payments (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('invoiceId') invoiceId?: string,
    @Query('clientId') clientId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      invoiceId,
      clientId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get(':id')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get a single payment' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Record a payment against an invoice' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreatePaymentDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  @Delete(':id')
  @Permissions('invoices.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a payment' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
