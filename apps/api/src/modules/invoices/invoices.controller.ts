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
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { InvoicesService, CreateInvoiceDto } from './invoices.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PdfService } from '../pdf/pdf.service';
import { renderInvoiceHtml } from '../pdf/templates/invoice.template';

@ApiTags('Invoices')
@Controller({ version: '1', path: 'invoices' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class InvoicesController {
  constructor(
    private service: InvoicesService,
    private pdfService: PdfService,
  ) {}

  // ─── Download PDF ──────────────────────────────────────────────────────────

  @Get(':id/pdf')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Download invoice as PDF' })
  async downloadPdf(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const invoice = await this.service.findOne(org.id, id);
    const html = renderInvoiceHtml(invoice, org);
    const pdf = await this.pdfService.generatePdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="invoice-${invoice.number}.pdf"`,
    );
    res.end(pdf);
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
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      status,
      clientId,
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
    @Param('id') id: string,
    @Body() dto: Partial<CreateInvoiceDto>,
  ) {
    return this.service.update(org.id, id, dto);
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
}
