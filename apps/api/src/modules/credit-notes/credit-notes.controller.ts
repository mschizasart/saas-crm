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
  NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CreditNotesService, CreateCreditNoteDto } from './credit-notes.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Credit Notes')
@Controller({ version: '1', path: 'credit-notes' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class CreditNotesController {
  constructor(private service: CreditNotesService) {}

  // ─── List ──────────────────────────────────────────────────────────────────

  // Dual-audience pattern:
  //   - Staff: @Permissions('invoices.view') gates access.
  //   - Portal contacts: RbacGuard auto-allows `user.type === 'contact'`, and
  //     we scope the query to the contact's own clientId so they only see
  //     their own credit notes (no permission leak).
  @Get()
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'List all credit notes (paginated, filterable)' })
  findAll(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const contactClientId =
      user?.type === 'contact' ? (user.clientId ?? null) : undefined;
    return this.service.findAll(org.id, {
      search,
      status,
      clientId,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      contactClientId,
    });
  }

  // ─── PDF ───────────────────────────────────────────────────────────────────

  // Dual-audience (see List note). For contacts we 404 on mismatched clientId
  // rather than 403 — avoids leaking credit-note existence to portal users.
  @Get(':id/pdf')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Download a credit note as PDF' })
  async downloadPdf(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Res() res: any,
  ) {
    const { pdf, creditNote } = await this.service.getPdf(org.id, id);
    if (
      user?.type === 'contact' &&
      creditNote.clientId &&
      user.clientId !== creditNote.clientId
    ) {
      throw new NotFoundException('Credit note not found');
    }
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="credit-note-${creditNote.number ?? creditNote.id}.pdf"`,
    );
    res.end(pdf);
  }

  // ─── Single ────────────────────────────────────────────────────────────────

  // Dual-audience: staff use the permission; contacts are allow-listed by the
  // RbacGuard but we 404 if the credit note belongs to a different client to
  // avoid 403-leaking the existence of records for other tenants.
  @Get(':id')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get a single credit note with items' })
  async findOne(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    const creditNote = await this.service.findOne(org.id, id);
    if (
      user?.type === 'contact' &&
      creditNote.clientId &&
      user.clientId !== creditNote.clientId
    ) {
      throw new NotFoundException('Credit note not found');
    }
    return creditNote;
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Create a new credit note' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateCreditNoteDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Update a draft credit note' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateCreditNoteDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('invoices.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft credit note' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Void ──────────────────────────────────────────────────────────────────

  @Post(':id/void')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Void a credit note' })
  void(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.void(org.id, id);
  }

  // ─── Apply ─────────────────────────────────────────────────────────────────

  @Post(':id/apply')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Apply a credit note (reduces linked invoice balance)' })
  apply(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.apply(org.id, id);
  }

  // ─── Apply to specific invoice ─────────────────────────────────────────────
  // Apply this credit note's remaining balance to an arbitrary invoice (not
  // just the one it was originally linked to).

  @Post(':id/apply-to/:invoiceId')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: "Apply a credit note's balance to a specific invoice" })
  applyToInvoice(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Param('invoiceId') invoiceId: string,
  ) {
    return this.service.applyToInvoice(org.id, id, invoiceId);
  }
}
