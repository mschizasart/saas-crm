import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  Res,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';

import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InvoicesService, CreateInvoiceDto } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PdfService } from '../pdf/pdf.service';
import { renderInvoiceHtml as renderDefault } from '../pdf/templates/invoice.template';
import { renderInvoiceHtml as renderModern } from '../pdf/templates/invoice-modern.template';
import { renderInvoiceHtml as renderClassic } from '../pdf/templates/invoice-classic.template';
import { EinvoiceService } from '../einvoice/einvoice.service';
import { CreditNotesService } from '../credit-notes/credit-notes.service';
import * as archiver from 'archiver';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

@ApiTags('Invoices')
@Controller({ version: '1', path: 'invoices' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class InvoicesController {
  constructor(
    private service: InvoicesService,
    private pdfService: PdfService,
    private einvoiceService: EinvoiceService,
    private creditNotesService: CreditNotesService,
  ) {}

  // ─── Download UBL 2.1 E-Invoice XML ────────────────────────────────────────

  @Get(':id/xml')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Download invoice as UBL 2.1 e-invoice XML' })
  async downloadXml(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const invoice = await this.service.findOne(org.id, id);
    const xml = this.einvoiceService.generateUblXml(invoice, org);
    res.setHeader('Content-Type', 'application/xml');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.number}.xml"`,
    );
    res.send(xml);
  }

  // ─── Download PDF ──────────────────────────────────────────────────────────

  @Get(':id/pdf')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Download invoice as PDF' })
  async downloadPdf(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query('template') templateParam?: string,
    @Res() res?: any,
  ) {
    const invoice = await this.service.findOne(org.id, id);

    // Determine which template to use: query param > org setting > default
    const orgSettings = (org.settings ?? {}) as Record<string, any>;
    const templateKey = templateParam || orgSettings.invoiceTemplate || 'default';

    const templateMap: Record<string, (inv: any, org: any) => string> = {
      default: renderDefault,
      modern: renderModern,
      classic: renderClassic,
    };
    const renderFn = templateMap[templateKey] ?? renderDefault;

    const html = renderFn(invoice, org);
    const pdf = await this.pdfService.generatePdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.number}.pdf"`,
    );
    res.end(pdf);
  }

  // ─── CSV Export ────────────────────────────────────────────────────────────
  // Same filters as GET /invoices but without pagination. Capped at 10k rows.
  @Get('export')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Export invoices as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('recurring') recurring?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      search,
      status,
      clientId,
      recurring: recurring !== undefined ? recurring === 'true' : undefined,
      dateFrom,
      dateTo,
    });

    const csv = buildCsv({
      columns: [
        { key: 'number', label: 'Number' },
        { key: 'client.company', label: 'Client' },
        { key: 'status', label: 'Status' },
        { key: 'date', label: 'Issue Date' },
        { key: 'dueDate', label: 'Due Date' },
        { key: 'subTotal', label: 'Subtotal' },
        { key: 'totalTax', label: 'Tax' },
        { key: 'discount', label: 'Discount' },
        { key: 'total', label: 'Total' },
        { key: 'currency.code', label: 'Currency' },
      ],
      rows,
    });

    const filename = csvFilename('invoices');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get invoice dashboard stats' })
  getStats(@CurrentOrg() org: any) {
    return this.service.getStats(org.id);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'List all invoices (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('recurring') recurring?: string,
    @Query('sortBy') sortBy?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      status,
      clientId,
      recurring: recurring !== undefined ? recurring === 'true' : undefined,
      sortBy,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  // ─── Single ────────────────────────────────────────────────────────────────

  @Get(':id')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get a single invoice with items and payments' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Create a new invoice' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateInvoiceDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Update a draft invoice' })
  update(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateInvoiceDto>,
  ) {
    return this.service.update(org.id, id, dto, user.id);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('invoices.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft invoice' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Update Status ─────────────────────────────────────────────────────────

  @Patch(':id/status')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Update invoice status (validated transitions)' })
  updateStatus(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { status: string },
  ) {
    return this.service.updateStatus(org.id, id, body.status);
  }

  // ─── Bulk Status Change ───────────────────────────────────────────────────

  @Post('bulk/status')
  @Permissions('invoices.edit')
  @ApiOperation({
    summary:
      'Bulk-update invoice status. Validates each id against the transition map; ineligible rows are skipped. Does not accept "paid" — use /mark-paid for that.',
  })
  bulkStatus(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() body: { invoiceIds: string[]; status: string },
  ) {
    return this.service.bulkUpdateStatus(
      org.id,
      body?.invoiceIds ?? [],
      body?.status,
      user?.id,
    );
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  @Post(':id/send')
  @Permissions('invoices.send')
  @ApiOperation({ summary: 'Send invoice to client (triggers email listener)' })
  send(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.send(org.id, id);
  }

  // ─── Mark Paid ─────────────────────────────────────────────────────────────

  @Post(':id/mark-paid')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Mark an invoice as fully paid' })
  markPaid(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.markPaid(org.id, id);
  }

  // ─── Duplicate ─────────────────────────────────────────────────────────────

  @Post(':id/duplicate')
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Duplicate an invoice as a new draft' })
  duplicate(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.duplicate(org.id, id, user.id);
  }

  // ─── Credit Note from Invoice ─────────────────────────────────────────────

  @Post(':id/credit-note')
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Create a credit note pre-populated from invoice items' })
  async createCreditNote(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const invoice = await this.service.findOne(org.id, id);
    return this.creditNotesService.create(org.id, {
      clientId: invoice.clientId ?? undefined,
      invoiceId: invoice.id,
      date: new Date().toISOString(),
      currency: (invoice as any).currency ?? 'USD',
      items: (invoice.items as any[]).map((item) => ({
        description: item.description,
        quantity: Number(item.qty ?? item.quantity ?? 1),
        unitPrice: Number(item.rate ?? item.unitPrice ?? 0),
        taxRate: Number(item.taxRate ?? 0),
        order: item.order,
      })),
    }, user.id);
  }

  // ─── Clone to Estimate ────────────────────────────────────────────────────

  @Post(':id/clone-to-estimate')
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Clone an invoice to a new estimate' })
  cloneToEstimate(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.cloneToEstimate(org.id, id, user.id);
  }

  // ─── Bill Expenses to Invoice ─────────────────────────────────────────────

  @Post(':id/bill-expenses')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Attach billable expenses as line items to this invoice' })
  billExpenses(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() body: { expenseIds: string[] },
  ) {
    return this.service.billExpenses(org.id, id, body?.expenseIds ?? []);
  }

  // ─── Merge Invoices ───────────────────────────────────────────────────────

  @Post('merge')
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Merge multiple draft invoices into a new draft' })
  merge(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() body: { invoiceIds: string[] },
  ) {
    return this.service.merge(org.id, body?.invoiceIds ?? [], user.id);
  }

  // ─── Bulk PDF Export ──────────────────────────────────────────────────────
  // Streams a zip of invoice PDFs. Puppeteer can be slow, so this is sequential
  // rather than parallel — a real-world list of ~20 invoices takes a few
  // seconds but avoids thrashing the single browser instance.

  @Post('bulk-pdf')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Download a zip of PDFs for the given invoices' })
  async bulkPdf(
    @CurrentOrg() org: any,
    @Body() body: { invoiceIds: string[] },
    @Res() res: any,
  ) {
    const ids = body?.invoiceIds ?? [];
    const invoices = await this.service.findManyForBulkPdf(org.id, ids);

    const orgSettings = (org.settings ?? {}) as Record<string, any>;
    const templateKey = orgSettings.invoiceTemplate || 'default';
    const templateMap: Record<string, (inv: any, org: any) => string> = {
      default: renderDefault,
      modern: renderModern,
      classic: renderClassic,
    };
    const renderFn = templateMap[templateKey] ?? renderDefault;

    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `invoices-${ts}.zip`;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const archive = archiver('zip', { zlib: { level: 9 } });

    // Fastify: pipe the archiver stream to the raw response
    const raw = res.raw ?? res;
    archive.pipe(raw);
    archive.on('warning', () => {});
    archive.on('error', (err: any) => {
      try { raw.destroy(err); } catch { /* noop */ }
    });

    for (const inv of invoices as any[]) {
      try {
        const html = renderFn(inv, org);
        const pdf = await this.pdfService.generatePdf(html);
        archive.append(pdf, { name: `invoice-${inv.number}.pdf` });
      } catch {
        // Skip failed PDFs rather than aborting the whole archive
      }
    }

    await archive.finalize();
  }

  // ─── Stop Recurring ───────────────────────────────────────────────────────

  @Post(':id/recurring/stop')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Disable recurrence for an invoice' })
  stopRecurring(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.stopRecurring(org.id, id);
  }

  // ─── Generate Next Recurring Now ──────────────────────────────────────────

  @Post(':id/recurring/run')
  @Permissions('invoices.create')
  @ApiOperation({
    summary:
      'Immediately generate the next occurrence of a recurring invoice',
  })
  runRecurringNow(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.runRecurringNow(org.id, id);
  }
}
