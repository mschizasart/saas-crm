import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { EstimatesService, CreateEstimateDto } from './estimates.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Estimates')
@Controller({ version: '1', path: 'estimates' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class EstimatesController {
  constructor(private service: EstimatesService) {}

  // ─── Stats ─────────────────────────────────────────────────────────────────

  @Get('stats')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get estimate status counts' })
  getStats(@CurrentOrg() org: any) {
    return this.service.getStats(org.id);
  }

  // ─── List ──────────────────────────────────────────────────────────────────

  @Get()
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'List all estimates (paginated, filterable)' })
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
  @ApiOperation({ summary: 'Get a single estimate with items' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  // ─── Create ────────────────────────────────────────────────────────────────

  @Post()
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Create a new estimate' })
  create(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: CreateEstimateDto,
  ) {
    return this.service.create(org.id, dto, user.id);
  }

  // ─── Update ────────────────────────────────────────────────────────────────

  @Patch(':id')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Update a draft estimate' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: Partial<CreateEstimateDto>,
  ) {
    return this.service.update(org.id, id, dto);
  }

  // ─── Delete ────────────────────────────────────────────────────────────────

  @Delete(':id')
  @Permissions('invoices.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a draft estimate' })
  delete(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.delete(org.id, id);
  }

  // ─── Send ─────────────────────────────────────────────────────────────────

  @Post(':id/send')
  @Permissions('invoices.send')
  @ApiOperation({ summary: 'Send estimate to client' })
  send(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.send(org.id, id);
  }

  // ─── Accept ───────────────────────────────────────────────────────────────

  @Post(':id/accept')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Mark estimate as accepted' })
  accept(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.accept(org.id, id);
  }

  // ─── Decline ──────────────────────────────────────────────────────────────

  @Post(':id/decline')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Mark estimate as declined' })
  decline(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.decline(org.id, id);
  }

  // ─── Convert to Invoice ───────────────────────────────────────────────────

  @Post(':id/convert-to-invoice')
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Convert an estimate to an invoice' })
  convertToInvoice(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.convertToInvoice(org.id, id, user.id);
  }

  // ─── Duplicate ────────────────────────────────────────────────────────────

  @Post(':id/duplicate')
  @Permissions('invoices.create')
  @ApiOperation({ summary: 'Duplicate an estimate as a new draft' })
  duplicate(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
  ) {
    return this.service.duplicate(org.id, id, user.id);
  }
}
