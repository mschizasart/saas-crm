import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Req,
  Res,
  Headers,
  UseGuards,
  HttpCode,
  HttpStatus,
  RawBodyRequest,
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import {
  PaymentsService,
  CreatePaymentDto,
  BatchPaymentDto,
  RefundPaymentDto,
} from './payments.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  Permissions,
  Public,
} from '../../common/decorators/permissions.decorator';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

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

  // ─── CSV Export ────────────────────────────────────────────
  @Get('export')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Export payments as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('invoiceId') invoiceId?: string,
    @Query('clientId') clientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      invoiceId,
      clientId,
      from,
      to,
    });

    const csv = buildCsv({
      columns: [
        { key: 'paymentDate', label: 'Date' },
        { key: 'invoice.number', label: 'Invoice' },
        { key: 'client.company', label: 'Client' },
        { key: 'amount', label: 'Amount' },
        { key: 'currency', label: 'Currency' },
        { key: 'paymentMode.name', label: 'Method' },
        { key: 'transactionId', label: 'Transaction ID' },
        { key: 'refundedAmount', label: 'Refunded' },
        { key: 'refundedAt', label: 'Refunded At' },
        { key: 'note', label: 'Note' },
      ],
      rows,
    });

    const filename = csvFilename('payments');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
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
  createPaymentMode(@CurrentOrg() org: any, @Body() body: { name: string; description?: string }) {
    return this.service.createPaymentMode(org.id, body.name, body.description);
  }

  @Patch('modes/:id')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Update a payment mode' })
  updatePaymentMode(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { name?: string; description?: string; active?: boolean },
  ) {
    return this.service.updatePaymentMode(org.id, id, body);
  }

  @Delete('modes/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a payment mode' })
  deletePaymentMode(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deletePaymentMode(org.id, id);
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

  // Payment receipt PDF — dual audience: staff with invoices.view perm OR the
  // portal contact whose clientId matches the payment's clientId. RbacGuard
  // short-circuits for contacts (user.type === 'contact'), so we re-check
  // clientId here and 404 on mismatch instead of 403 (avoids leaking existence).
  @Get(':id/pdf')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Download a payment receipt as PDF' })
  async getReceiptPdf(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const { pdf, payment } = await this.service.getReceiptPdf(org.id, id);

    if (
      user?.type === 'contact' &&
      payment.clientId &&
      user.clientId !== payment.clientId
    ) {
      throw new NotFoundException('Payment not found');
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="receipt-${payment.id}.pdf"`,
    );
    res.end(pdf);
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

  @Post('batch')
  @Permissions('invoices.edit')
  @ApiOperation({
    summary:
      'Record multiple payments against multiple invoices in one transaction',
  })
  createBatch(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: BatchPaymentDto,
  ) {
    return this.service.createBatch(org.id, dto, user.id);
  }

  @Post(':id/refund')
  @Permissions('invoices.edit')
  @ApiOperation({
    summary: 'Refund all or part of a payment (creates a negative row)',
  })
  refund(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
  ) {
    return this.service.refund(org.id, id, dto, user.id);
  }

  @Delete(':id')
  @Permissions('invoices.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a payment' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }
}
