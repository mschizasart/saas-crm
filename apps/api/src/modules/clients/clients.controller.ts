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
  UseGuards,
  HttpCode,
  HttpStatus,
  BadRequestException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { ClientsService, CreateClientDto, CreateContactDto } from './clients.service';
import { HealthScoreService } from './health-score.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { PdfService } from '../pdf/pdf.service';
import { renderStatementHtml } from '../pdf/templates/statement.template';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

@ApiTags('Clients')
@Controller({ version: '1', path: 'clients' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ClientsController {
  constructor(
    private service: ClientsService,
    private pdfService: PdfService,
    private healthScoreService: HealthScoreService,
  ) {}

  // ─── Health Scores (must be before :id to avoid param conflict) ──

  @Get('health-scores')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get health scores for all active clients (sorted worst-first)' })
  getHealthScores(@CurrentOrg() org: any) {
    return this.healthScoreService.getScoresForAllClients(org.id);
  }

  // ─── Client CRUD ───────────────────────────────────────────

  @Get()
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List all clients (paginated, searchable)' })
  findAll(
    @CurrentOrg() org: any,
    @Query('search') search?: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('active') active?: string,
  ) {
    return this.service.findAll(org.id, {
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      active: active !== undefined ? active === 'true' : undefined,
    });
  }

  @Get(':id')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get single client with contacts and stats' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Get(':id/health-score')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get health score for a single client' })
  getHealthScore(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.healthScoreService.calculateScore(org.id, id);
  }

  @Post()
  @Permissions('clients.create')
  @ApiOperation({ summary: 'Create a new client' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateClientDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── CSV Import ────────────────────────────────────────────

  /**
   * Upload a CSV and bulk-create clients for the current organisation.
   *
   * The request is `multipart/form-data` with a single `file` field.
   * Fastify's `@fastify/multipart` is registered globally in main.ts, so
   * we consume the request parts directly (see storage.controller.ts for
   * the canonical pattern).
   */
  @Post('import')
  @Permissions('clients.create')
  @ApiOperation({ summary: 'Import clients from a CSV file (multipart/form-data)' })
  @ApiConsumes('multipart/form-data')
  async importCsv(@CurrentOrg() org: any, @Req() req: any) {
    if (typeof req.file !== 'function' && typeof req.parts !== 'function') {
      throw new BadRequestException(
        'Multipart not supported — @fastify/multipart not registered',
      );
    }

    const MAX_BYTES = 5 * 1024 * 1024; // 5MB
    let buffer: Buffer | null = null;
    let filename = '';

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type === 'file') {
        filename = part.filename || 'upload.csv';
        const buf = await part.toBuffer();
        if (buf.length > MAX_BYTES) {
          throw new PayloadTooLargeException(
            `CSV file exceeds 5MB limit (${buf.length} bytes)`,
          );
        }
        buffer = buf;
      }
      // ignore other fields
    }

    if (!buffer) {
      throw new BadRequestException('No CSV file uploaded (field name: "file")');
    }

    // Light sanity check on mimetype / extension — accept text/csv,
    // application/vnd.ms-excel, or any *.csv suffix.
    if (filename && !filename.toLowerCase().endsWith('.csv')) {
      // don't reject — tolerate odd extensions like .txt if the content parses
    }

    return this.service.importFromCsv(org.id, buffer);
  }

  // ─── CSV Export ────────────────────────────────────────────
  // Streams the current filter set as RFC-4180 CSV (with UTF-8 BOM). Uses the
  // same filter signature as GET /clients, but ignores pagination and caps
  // the result at EXPORT_ROW_CAP rows (X-Export-Truncated header indicates
  // when the cap was hit). Same permission as the list endpoint.
  @Get('export')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Export clients as CSV (respects search/active filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('search') search?: string,
    @Query('active') active?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      search,
      active: active !== undefined ? active === 'true' : undefined,
    });

    const csv = buildCsv({
      columns: [
        { key: 'company', label: 'Company' },
        { key: 'group.name', label: 'Group' },
        { key: 'phone', label: 'Phone' },
        { key: 'website', label: 'Website' },
        { key: 'address', label: 'Address' },
        { key: 'city', label: 'City' },
        { key: 'country', label: 'Country' },
        { key: 'vat', label: 'VAT' },
        { key: 'currency.code', label: 'Currency' },
        { key: 'active', label: 'Active' },
        { key: 'createdAt', label: 'Created At' },
      ],
      rows,
    });

    const filename = csvFilename('clients');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  /**
   * Download a CSV template with the header row only.
   * Marked as a logged-in-only but otherwise permission-lite route so
   * users can grab the template even if they haven't been granted
   * `clients.create` yet.
   */
  @Get('import/template')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Download a blank clients CSV import template' })
  getImportTemplate(@Res() res: any) {
    const header = ClientsService.CSV_COLUMNS.join(',');
    const csv = header + '\n';
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="clients-import-template.csv"',
    );
    res.end(csv);
  }

  @Patch(':id')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Update client details' })
  update(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateClientDto>,
  ) {
    return this.service.update(org.id, id, dto, user.id);
  }

  @Delete(':id')
  @Permissions('clients.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a client' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  @Patch(':id/toggle-active')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Toggle client active/inactive status' })
  toggleActive(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.toggleActive(org.id, id);
  }

  // ─── Contacts ──────────────────────────────────────────────

  @Get(':id/contacts')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List contacts for a client' })
  getContacts(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.getContacts(org.id, id);
  }

  @Post(':id/contacts')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Add a contact to a client' })
  createContact(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: CreateContactDto,
  ) {
    return this.service.createContact(org.id, id, dto);
  }

  // ─── Statement ─────────────────────────────────────────────

  @Get(':id/statement')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get client financial statement (invoices + payments)' })
  getStatement(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const opts = this.parseStatementRange(from, to);
    return this.service.getStatement(org.id, id, opts);
  }

  @Get(':id/statement/pdf')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Download client statement as PDF' })
  async getStatementPdf(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Res() res: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const opts = this.parseStatementRange(from, to);
    const client = await this.service.findOne(org.id, id);
    const { invoices, payments } = await this.service.getStatement(org.id, id, opts);
    const html = renderStatementHtml(client, invoices, payments, org);
    const pdf = await this.pdfService.generatePdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="statement-${(client as any).company?.replace(/\s+/g, '-') ?? id}.pdf"`,
    );
    res.end(pdf);
  }

  private parseStatementRange(from?: string, to?: string) {
    const opts: { from?: Date; to?: Date } = {};
    if (from) {
      const d = new Date(from);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('Invalid "from" date');
      }
      opts.from = d;
    }
    if (to) {
      const d = new Date(to);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException('Invalid "to" date');
      }
      opts.to = d;
    }
    return opts;
  }

  // ─── Groups ────────────────────────────────────────────────

  @Get('groups/list')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List all client groups' })
  getGroups(@CurrentOrg() org: any) {
    return this.service.getGroups(org.id);
  }

  @Post('groups')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Create a client group' })
  createGroup(@CurrentOrg() org: any, @Body() body: { name: string }) {
    return this.service.createGroup(org.id, body.name);
  }

  @Delete('groups/:id')
  @Permissions('clients.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a client group' })
  deleteGroup(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteGroup(org.id, id);
  }
}
