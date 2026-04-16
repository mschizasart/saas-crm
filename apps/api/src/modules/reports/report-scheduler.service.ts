import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReportsService } from './reports.service';
import { EmailsService } from '../emails/emails.service';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ReportSchedulerService {
  private readonly logger = new Logger(ReportSchedulerService.name);

  constructor(
    private reports: ReportsService,
    private emails: EmailsService,
    private prisma: PrismaService,
  ) {}

  @Cron('0 8 * * 1') // Every Monday at 8 AM
  async sendWeeklyReports() {
    this.logger.log('Running weekly report email job...');
    try {
      const orgs = await this.prisma.organization.findMany({
        select: { id: true, name: true, settings: true },
      });

      for (const org of orgs) {
        const settings = (org.settings as any) ?? {};
        if (!settings.reports?.weeklyEmail) continue;

        const now = new Date();
        const from = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        try {
          const report = await this.reports.getSalesReport(org.id, {
            from: from.toISOString(),
            to: now.toISOString(),
          });

          const admins = await this.prisma.user.findMany({
            where: { organizationId: org.id, isAdmin: true, active: true, type: 'staff' },
            select: { email: true, firstName: true },
          });

          const html = this.buildWeeklySummaryHtml(org.name, report);

          for (const admin of admins) {
            await this.emails.queue({
              to: admin.email,
              subject: `Weekly Sales Summary — ${org.name}`,
              html,
            });
          }

          this.logger.log(`Sent weekly report for org ${org.name} to ${admins.length} admins`);
        } catch (err) {
          this.logger.error(`Failed weekly report for org ${org.id}`, (err as any)?.stack);
        }
      }
    } catch (err) {
      this.logger.error('Weekly report job failed', (err as any)?.stack);
    }
  }

  @Cron('0 8 1 * *') // 1st of every month at 8 AM
  async sendMonthlyReports() {
    this.logger.log('Running monthly report email job...');
    try {
      const orgs = await this.prisma.organization.findMany({
        select: { id: true, name: true, settings: true },
      });

      for (const org of orgs) {
        const settings = (org.settings as any) ?? {};
        if (!settings.reports?.monthlyEmail) continue;

        const now = new Date();
        const from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const to = new Date(now.getFullYear(), now.getMonth(), 0);

        try {
          const report = await this.reports.getSalesReport(org.id, {
            from: from.toISOString(),
            to: to.toISOString(),
          });

          const admins = await this.prisma.user.findMany({
            where: { organizationId: org.id, isAdmin: true, active: true, type: 'staff' },
            select: { email: true, firstName: true },
          });

          const monthName = from.toLocaleString('en', { month: 'long', year: 'numeric' });
          const html = this.buildMonthlySummaryHtml(org.name, monthName, report);

          for (const admin of admins) {
            await this.emails.queue({
              to: admin.email,
              subject: `Monthly Report (${monthName}) — ${org.name}`,
              html,
            });
          }

          this.logger.log(`Sent monthly report for org ${org.name} to ${admins.length} admins`);
        } catch (err) {
          this.logger.error(`Failed monthly report for org ${org.id}`, (err as any)?.stack);
        }
      }
    } catch (err) {
      this.logger.error('Monthly report job failed', (err as any)?.stack);
    }
  }

  private buildWeeklySummaryHtml(orgName: string, report: any): string {
    return `
      <h2>Weekly Sales Summary — ${orgName}</h2>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Total Revenue</strong></td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${Number(report.totalRevenue).toFixed(2)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Total Paid</strong></td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${Number(report.totalPaid).toFixed(2)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Outstanding</strong></td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${Number(report.totalOutstanding).toFixed(2)}</td></tr>
        <tr><td style="padding:8px;"><strong>Overdue</strong></td>
            <td style="padding:8px;text-align:right;color:#dc2626;">${Number(report.totalOverdue).toFixed(2)}</td></tr>
      </table>
      <p style="margin-top:16px;"><a href="${process.env.APP_URL}/reports">View full report</a></p>
    `;
  }

  private buildMonthlySummaryHtml(orgName: string, monthName: string, report: any): string {
    return `
      <h2>Monthly Report — ${monthName}</h2>
      <h3>${orgName}</h3>
      <table style="border-collapse:collapse;width:100%;max-width:500px;">
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Total Revenue</strong></td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${Number(report.totalRevenue).toFixed(2)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Total Paid</strong></td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${Number(report.totalPaid).toFixed(2)}</td></tr>
        <tr><td style="padding:8px;border-bottom:1px solid #eee;"><strong>Outstanding</strong></td>
            <td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">${Number(report.totalOutstanding).toFixed(2)}</td></tr>
        <tr><td style="padding:8px;"><strong>Overdue</strong></td>
            <td style="padding:8px;text-align:right;color:#dc2626;">${Number(report.totalOverdue).toFixed(2)}</td></tr>
      </table>
      ${report.topClients?.length ? `
        <h3 style="margin-top:20px;">Top Clients</h3>
        <table style="border-collapse:collapse;width:100%;max-width:500px;">
          ${report.topClients.slice(0, 5).map((c: any) => `
            <tr><td style="padding:6px;border-bottom:1px solid #eee;">${c.company}</td>
                <td style="padding:6px;border-bottom:1px solid #eee;text-align:right;">${Number(c.totalRevenue).toFixed(2)}</td></tr>
          `).join('')}
        </table>
      ` : ''}
      <p style="margin-top:16px;"><a href="${process.env.APP_URL}/reports">View full report</a></p>
    `;
  }
}
