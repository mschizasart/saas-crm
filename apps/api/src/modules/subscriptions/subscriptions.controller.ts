import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateSubscriptionDto,
  SubscriptionsService,
  UpdateSubscriptionDto,
} from './subscriptions.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';
import { buildCsv, csvFilename } from '../../common/csv/csv-writer';

@ApiTags('Subscriptions')
@Controller({ version: '1', path: 'subscriptions' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class SubscriptionsController {
  constructor(private service: SubscriptionsService) {}

  @Get()
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'List client subscriptions' })
  findAll(
    @CurrentOrg() org: any,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
  ) {
    return this.service.findAll(org.id, { status, clientId });
  }

  // ─── CSV Export ────────────────────────────────────────────
  @Get('export')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Export subscriptions as CSV (respects current filters)' })
  async exportCsv(
    @CurrentOrg() org: any,
    @Res() res: any,
    @Query('status') status?: string,
    @Query('clientId') clientId?: string,
  ) {
    const { rows, truncated } = await this.service.findAllForExport(org.id, {
      status,
      clientId,
    });

    const csv = buildCsv({
      columns: [
        { key: 'name', label: 'Name' },
        { key: 'client.company', label: 'Client' },
        { key: 'status', label: 'Status' },
        { key: 'unitPrice', label: 'Unit Price' },
        { key: 'quantity', label: 'Quantity' },
        { key: 'total', label: 'Total' },
        { key: 'currency', label: 'Currency' },
        { key: 'interval', label: 'Interval' },
        { key: 'intervalCount', label: 'Interval Count' },
        { key: 'nextInvoiceAt', label: 'Next Invoice At' },
        { key: 'createdAt', label: 'Created' },
        { key: 'cancelledAt', label: 'Cancelled' },
      ],
      rows,
    });

    const filename = csvFilename('subscriptions');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Export-Count', String(rows.length));
    if (truncated) res.setHeader('X-Export-Truncated', 'true');
    res.send(csv);
  }

  @Get(':id')
  @Permissions('invoices.view')
  @ApiOperation({ summary: 'Get one subscription' })
  findOne(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.findOne(org.id, id);
  }

  @Post()
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Create a client subscription' })
  create(@CurrentOrg() org: any, @Body() dto: CreateSubscriptionDto) {
    return this.service.create(org.id, dto);
  }

  @Patch(':id')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Update a subscription' })
  update(
    @CurrentOrg() org: any,
    @Param('id') id: string,
    @Body() dto: UpdateSubscriptionDto,
  ) {
    return this.service.update(org.id, id, dto);
  }

  @Post(':id/pause')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Pause a subscription' })
  pause(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.pause(org.id, id);
  }

  @Post(':id/resume')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Resume a subscription' })
  resume(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.resume(org.id, id);
  }

  @Post(':id/cancel')
  @Permissions('invoices.edit')
  @ApiOperation({ summary: 'Cancel a subscription' })
  cancel(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.cancel(org.id, id);
  }

  @Delete(':id')
  @Permissions('invoices.delete')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel + archive a subscription' })
  remove(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.service.cancel(org.id, id);
  }
}
