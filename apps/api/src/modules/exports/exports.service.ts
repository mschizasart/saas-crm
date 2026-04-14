import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ExcelJS = require('exceljs');

export type ExportFormat = 'csv' | 'xlsx';

interface InvoiceFilter {
  status?: string;
  clientId?: string;
  from?: string;
  to?: string;
}

interface LeadFilter {
  status?: string;
}

interface SimpleFilter {
  from?: string;
  to?: string;
}

interface Column {
  header: string;
  key: string;
}

@Injectable()
export class ExportsService {
  constructor(private prisma: PrismaService) {}

  // ──────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────

  async exportClients(orgId: string, format: ExportFormat): Promise<Buffer> {
    const rows = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.client.findMany({
        where: { organizationId: orgId },
        orderBy: { createdAt: 'desc' },
      });
    });

    const columns: Column[] = [
      { header: 'Company', key: 'company' },
      { header: 'Country', key: 'country' },
      { header: 'City', key: 'city' },
      { header: 'Phone', key: 'phone' },
      { header: 'Website', key: 'website' },
      { header: 'VAT', key: 'vat' },
      { header: 'Active', key: 'active' },
      { header: 'Created At', key: 'createdAt' },
    ];

    const data = (rows as any[]).map((r) => ({
      company: r.company ?? '',
      country: r.country ?? '',
      city: r.city ?? '',
      phone: r.phone ?? '',
      website: r.website ?? '',
      vat: r.vat ?? '',
      active: r.active ? 'Yes' : 'No',
      createdAt: r.createdAt?.toISOString().slice(0, 10) ?? '',
    }));

    return this.buildBuffer('Clients', columns, data, format);
  }

  async exportInvoices(
    orgId: string,
    format: ExportFormat,
    filter: InvoiceFilter = {},
  ): Promise<Buffer> {
    const where: any = { organizationId: orgId };
    if (filter.status) where.status = filter.status;
    if (filter.clientId) where.clientId = filter.clientId;
    if (filter.from || filter.to) {
      where.date = {};
      if (filter.from) where.date.gte = new Date(filter.from);
      if (filter.to) where.date.lte = new Date(filter.to);
    }

    const rows = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.invoice.findMany({
        where,
        include: { client: { select: { company: true } } },
        orderBy: { date: 'desc' },
      });
    });

    const columns: Column[] = [
      { header: 'Number', key: 'number' },
      { header: 'Client', key: 'client' },
      { header: 'Status', key: 'status' },
      { header: 'Date', key: 'date' },
      { header: 'Due Date', key: 'dueDate' },
      { header: 'Subtotal', key: 'subTotal' },
      { header: 'Tax', key: 'totalTax' },
      { header: 'Discount', key: 'discount' },
      { header: 'Total', key: 'total' },
      { header: 'Currency', key: 'currency' },
    ];

    const data = (rows as any[]).map((r) => ({
      number: r.number,
      client: r.client?.company ?? '',
      status: r.status,
      date: r.date?.toISOString().slice(0, 10) ?? '',
      dueDate: r.dueDate?.toISOString().slice(0, 10) ?? '',
      subTotal: Number(r.subTotal ?? 0),
      totalTax: Number(r.totalTax ?? 0),
      discount: Number(r.discount ?? 0),
      total: Number(r.total ?? 0),
      currency: r.currency ?? '',
    }));

    return this.buildBuffer('Invoices', columns, data, format);
  }

  async exportLeads(
    orgId: string,
    format: ExportFormat,
    filter: LeadFilter = {},
  ): Promise<Buffer> {
    const where: any = { organizationId: orgId };
    if (filter.status) {
      where.status = { name: { equals: filter.status, mode: 'insensitive' } };
    }

    const rows = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.lead.findMany({
        where,
        include: {
          status: { select: { name: true } },
          source: { select: { name: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    });

    const columns: Column[] = [
      { header: 'Name', key: 'name' },
      { header: 'Company', key: 'company' },
      { header: 'Email', key: 'email' },
      { header: 'Phone', key: 'phone' },
      { header: 'Status', key: 'status' },
      { header: 'Source', key: 'source' },
      { header: 'Value', key: 'value' },
      { header: 'Country', key: 'country' },
      { header: 'Created At', key: 'createdAt' },
    ];

    const data = (rows as any[]).map((r) => ({
      name: r.name,
      company: r.company ?? '',
      email: r.email ?? '',
      phone: r.phone ?? '',
      status: r.status?.name ?? '',
      source: r.source?.name ?? '',
      value: Number(r.value ?? 0),
      country: r.country ?? '',
      createdAt: r.createdAt?.toISOString().slice(0, 10) ?? '',
    }));

    return this.buildBuffer('Leads', columns, data, format);
  }

  async exportPayments(
    orgId: string,
    format: ExportFormat,
    filter: SimpleFilter = {},
  ): Promise<Buffer> {
    const where: any = { organizationId: orgId };
    if (filter.from || filter.to) {
      where.paymentDate = {};
      if (filter.from) where.paymentDate.gte = new Date(filter.from);
      if (filter.to) where.paymentDate.lte = new Date(filter.to);
    }

    const rows = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.payment.findMany({
        where,
        include: {
          invoice: { select: { number: true } },
          client: { select: { company: true } },
        },
        orderBy: { paymentDate: 'desc' },
      });
    });

    const columns: Column[] = [
      { header: 'Date', key: 'date' },
      { header: 'Invoice', key: 'invoice' },
      { header: 'Client', key: 'client' },
      { header: 'Amount', key: 'amount' },
      { header: 'Currency', key: 'currency' },
      { header: 'Transaction ID', key: 'transactionId' },
      { header: 'Note', key: 'note' },
    ];

    const data = (rows as any[]).map((r) => ({
      date: r.paymentDate?.toISOString().slice(0, 10) ?? '',
      invoice: r.invoice?.number ?? '',
      client: r.client?.company ?? '',
      amount: Number(r.amount ?? 0),
      currency: r.currency ?? '',
      transactionId: r.transactionId ?? '',
      note: r.note ?? '',
    }));

    return this.buildBuffer('Payments', columns, data, format);
  }

  async exportExpenses(
    orgId: string,
    format: ExportFormat,
    filter: SimpleFilter = {},
  ): Promise<Buffer> {
    const where: any = { organizationId: orgId };
    if (filter.from || filter.to) {
      where.date = {};
      if (filter.from) where.date.gte = new Date(filter.from);
      if (filter.to) where.date.lte = new Date(filter.to);
    }

    const rows = await this.prisma.withOrganization(orgId, async (tx) => {
      return tx.expense.findMany({
        where,
        include: {
          category: { select: { name: true } },
          client: { select: { company: true } },
          project: { select: { name: true } },
        },
        orderBy: { date: 'desc' },
      });
    });

    const columns: Column[] = [
      { header: 'Date', key: 'date' },
      { header: 'Name', key: 'name' },
      { header: 'Category', key: 'category' },
      { header: 'Client', key: 'client' },
      { header: 'Project', key: 'project' },
      { header: 'Amount', key: 'amount' },
      { header: 'Billable', key: 'billable' },
      { header: 'Invoiced', key: 'invoiced' },
    ];

    const data = (rows as any[]).map((r) => ({
      date: r.date?.toISOString().slice(0, 10) ?? '',
      name: r.name,
      category: r.category?.name ?? '',
      client: r.client?.company ?? '',
      project: r.project?.name ?? '',
      amount: Number(r.amount ?? 0),
      billable: r.billable ? 'Yes' : 'No',
      invoiced: r.invoiced ? 'Yes' : 'No',
    }));

    return this.buildBuffer('Expenses', columns, data, format);
  }

  // ──────────────────────────────────────────────────────────────
  // Builders
  // ──────────────────────────────────────────────────────────────

  private async buildBuffer(
    sheetName: string,
    columns: Column[],
    data: Array<Record<string, any>>,
    format: ExportFormat,
  ): Promise<Buffer> {
    if (format === 'csv') {
      return Buffer.from(this.buildCsv(columns, data), 'utf-8');
    }
    return this.buildXlsx(sheetName, columns, data);
  }

  private buildCsv(
    columns: Column[],
    data: Array<Record<string, any>>,
  ): string {
    const escape = (val: any): string => {
      if (val === null || val === undefined) return '';
      const s = String(val);
      // Always quote strings, escape embedded quotes by doubling them
      return `"${s.replace(/"/g, '""')}"`;
    };

    const header = columns.map((c) => escape(c.header)).join(',');
    const lines = data.map((row) =>
      columns.map((c) => escape(row[c.key])).join(','),
    );
    return [header, ...lines].join('\n');
  }

  private async buildXlsx(
    sheetName: string,
    columns: Column[],
    data: Array<Record<string, any>>,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();
    const sheet = workbook.addWorksheet(sheetName);

    sheet.columns = columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: Math.max(12, c.header.length + 2),
    }));

    // Bold header row
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.alignment = { vertical: 'middle' };

    for (const row of data) {
      sheet.addRow(row);
    }

    // Auto-size columns based on content
    sheet.columns.forEach((col: any) => {
      let maxLen = col.header ? String(col.header).length : 10;
      col.eachCell?.({ includeEmpty: false }, (cell: any) => {
        const v = cell.value == null ? '' : String(cell.value);
        if (v.length > maxLen) maxLen = v.length;
      });
      col.width = Math.min(50, Math.max(12, maxLen + 2));
    });

    const buf = await workbook.xlsx.writeBuffer();
    return Buffer.from(buf);
  }
}
