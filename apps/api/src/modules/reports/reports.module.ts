import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportSchedulerService } from './report-scheduler.service';
// ─── Wave D2 (builder) — separate controllers, mounted under
// /report-defs and /dashboards so they don't collide with the existing
// canned reports surface above. ──────────────────────────────────────
import { ReportDefsController } from './report-defs.controller';
import { ReportDefsService } from './report-defs.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsService } from './dashboards.service';

@Module({
  controllers: [
    ReportsController,
    ReportDefsController,
    DashboardsController,
  ],
  providers: [
    ReportsService,
    ReportSchedulerService,
    ReportDefsService,
    DashboardsService,
  ],
  exports: [ReportsService, ReportDefsService],
})
export class ReportsModule {}
