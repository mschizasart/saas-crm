import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller({ version: '1', path: 'reports' })
@UseGuards(JwtAuthGuard, RbacGuard)
export class ReportsController {
  constructor(private service: ReportsService) {}

  @Get('sales')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Sales report (revenue, outstanding, by month, top clients)' })
  sales(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: 'day' | 'week' | 'month',
  ) {
    return this.service.getSalesReport(org.id, { from, to, groupBy });
  }

  @Get('leads')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Leads report (status funnel, sources, conversions)' })
  leads(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getLeadsReport(org.id, { from, to });
  }

  @Get('income-expense')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Income vs expenses report' })
  incomeExpense(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getIncomeExpenseReport(org.id, { from, to });
  }

  @Get('clients')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Clients report (totals, by country, top revenue)' })
  clients(@CurrentOrg() org: any) {
    return this.service.getClientsReport(org.id);
  }

  @Get('time-tracking')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Time tracking report' })
  timeTracking(
    @CurrentOrg() org: any,
    @Query('projectId') projectId?: string,
    @Query('userId') userId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getTimeTrackingReport(org.id, {
      projectId,
      userId,
      from,
      to,
    });
  }

  @Get('tickets')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Tickets report (status, priority, resolution time)' })
  tickets(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.service.getTicketsReport(org.id, { from, to });
  }

  @Get('profit-loss')
  @Permissions('reports.view')
  @ApiOperation({ summary: 'Profit & Loss report (revenue, expenses, net profit, tax estimate)' })
  profitLoss(
    @CurrentOrg() org: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('taxPercent') taxPercent?: string,
  ) {
    return this.service.getProfitLossReport(org.id, {
      from,
      to,
      taxPercent: taxPercent ? Number(taxPercent) : undefined,
    });
  }
}
