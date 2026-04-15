import {
  Controller,
  Get,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { Response } from 'express';
import { ExportsService, ExportFormat } from './exports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

const MIME: Record<ExportFormat, string> = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function resolveFormat(value?: string): ExportFormat {
  return value === 'csv' ? 'csv' : 'xlsx';
}

function sendBuffer(
  res: Response,
  filename: string,
  format: ExportFormat,
  buffer: Buffer,
) {
  res.setHeader('Content-Type', MIME[format]);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${filename}.${format}"`,
  );
  res.end(buffer);
}

@ApiTags('Exports')
@ApiBearerAuth()
@Controller({ version: '1', path: 'exports' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class ExportsController {
  constructor(private service: ExportsService) {}

  @Get('clients')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Export clients as CSV or XLSX' })
  async exportClients(
    @CurrentOrg() org: any,
    @Res() res: Response,
    @Query('format') format?: string,
  ) {
    const fmt = resolveFormat(format);
    const buffer = await this.service.exportClients(org.id, fmt);
    sendBuffer(res, 'clients', fmt, buffer);
  }

  @Get('invoices')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Export invoices as CSV or XLSX' })
  async exportInvoices(
    @CurrentOrg() org: any,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fmt = resolveFormat(format);
    const buffer = await this.service.exportInvoices(org.id, fmt, {
      status,
      clientId,
      from,
      to,
    });
    sendBuffer(res, 'invoices', fmt, buffer);
  }

  @Get('leads')
  @Permissions('leads.view')
  @ApiOperation({ summary: 'Export leads as CSV or XLSX' })
  async exportLeads(
    @CurrentOrg() org: any,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('status') status?: string,
  ) {
    const fmt = resolveFormat(format);
    const buffer = await this.service.exportLeads(org.id, fmt, { status });
    sendBuffer(res, 'leads', fmt, buffer);
  }

  @Get('payments')
  @Permissions('payments.view')
  @ApiOperation({ summary: 'Export payments as CSV or XLSX' })
  async exportPayments(
    @CurrentOrg() org: any,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fmt = resolveFormat(format);
    const buffer = await this.service.exportPayments(org.id, fmt, { from, to });
    sendBuffer(res, 'payments', fmt, buffer);
  }

  @Get('expenses')
  @Permissions('expenses.view')
  @ApiOperation({ summary: 'Export expenses as CSV or XLSX' })
  async exportExpenses(
    @CurrentOrg() org: any,
    @Res() res: Response,
    @Query('format') format?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fmt = resolveFormat(format);
    const buffer = await this.service.exportExpenses(org.id, fmt, { from, to });
    sendBuffer(res, 'expenses', fmt, buffer);
  }
}
