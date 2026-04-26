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
import { ContractsService, CreateContractDto } from './contracts.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions, Public } from '../../common/decorators/permissions.decorator';
import { PdfService } from '../pdf/pdf.service';
import { renderContractHtml } from '../pdf/templates/contract.template';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

@ApiTags('Contracts')
@Controller({ version: '1', path: 'contracts' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class ContractsController {
  constructor(
    private service: ContractsService,
    private pdfService: PdfService,
  ) {}

  // ─── Download PDF ──────────────────────────────────────────────────────────

  @Get(':id/pdf')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Download contract as PDF' })
  async downloadPdf(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const contract = await this.service.findOne(org.id, id);
    const html = renderContractHtml(contract, org);
    const pdf = await this.pdfService.generatePdf(html);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="contract-${contract.id}.pdf"`,
    );
    res.end(pdf);
  }

  // ─── Merge Fields ──────────────────────────────────────────────────────────

  @Get('merge-fields')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get available merge fields for contract templates' })
  getMergeFields() {
    return ContractsService.getAvailableMergeFields();
  }

  // ─── Contract Types ────────────────────────────────────────────────────────

  @Get('types')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List contract types' })
  getContractTypes(@CurrentOrg() org: any) {
    return this.service.getContractTypes(org.id);
  }

  @Post('types')
  @Permissions('settings.edit')
  @ApiOperation({ summary: 'Create a contract type' })
  createContractType(@CurrentOrg() org: any, @Body() body: { name: string }) {
    return this.service.createContractType(org.id, body.name);
  }

  @Delete('types/:id')
  @Permissions('settings.edit')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a contract type' })
  deleteContractType(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.deleteContractType(org.id, id);
  }

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get contract status counts' })
  getStats(@CurrentOrg() org: any) {
    return this.service.getStats(org.id);
  }

  // ─── CSV Export ────────────────────────────────────────────────────────────
  @Get('export')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Export contracts as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      search,
      status,
      clientId,
    });

    const csv = buildCsv({
      columns: [
        { key: 'subject', label: 'Subject' },
        { key: 'client.company', label: 'Client' },
        { key: 'type', label: 'Type' },
        { key: 'status', label: 'Status' },
        { key: 'value', label: 'Value' },
        { key: 'startDate', label: 'Start Date' },
        { key: 'endDate', label: 'End Date' },
        { key: 'signedAt', label: 'Signed At' },
        { key: 'createdAt', label: 'Created' },
      ],
      rows,
    });

    const filename = csvFilename('contracts');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  // ─── Public signing page — must be above :id to avoid route shadowing ──────

  @Get('sign/:hash')
  @Public()
  @ApiOperation({ summary: 'Get contract by hash (public — for client signing page)' })
  getByHash(@Param('hash') hash: string) {
    return this.service.getByHash(hash);
  }

  @Post('sign/:hash')
  @Public()
  @ApiOperation({ summary: 'Sign a contract (public — no auth required)' })
  sign(
    @Param('hash') hash: string,
    @Body() body: { signatureData: string; signedByName: string; signedByEmail: string },
  ) {
    return this.service.sign(
      hash,
      body.signatureData,
      body.signedByName,
      body.signedByEmail,
    );
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @Permissions('clients.view')
  @ApiOperation({ summary: 'List all contracts (paginated, filterable)' })
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
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get a single contract with comments' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('clients.create')
  @ApiOperation({ summary: 'Create a new contract' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateContractDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Update a draft contract' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateContractDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('clients.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft contract' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Send for Signing ──────────────────────────────────────────────────────

  @Post(':id/send')
  @Permissions('clients.edit')
  @ApiOperation({ summary: 'Send contract for signing (triggers email listener)' })
  sendForSigning(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.sendForSigning(org.id, id);
  }

  // ─── Rendered Content (merge fields replaced) ─────────────────────────────

  @Get(':id/rendered')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Get contract with merge fields replaced' })
  renderContent(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.renderContent(org.id, id);
  }

  // ─── Renew ────────────────────────────────────────────────────────────────

  @Post(':id/renew')
  @Permissions('clients.create')
  @ApiOperation({ summary: 'Renew a contract (clone with new dates)' })
  renew(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.renew(org.id, id);
  }

  // ─── Add Comment ──────────────────────────────────────────────────────────

  @Post(':id/comments')
  @Permissions('clients.view')
  @ApiOperation({ summary: 'Add a comment to a contract' })
  addComment(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') contractId: string,
    @Body() body: { content: string },
  ) {
    return this.service.addComment(org.id, contractId, body.content, user.id);
  }
}
