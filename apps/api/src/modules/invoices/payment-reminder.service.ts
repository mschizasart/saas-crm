import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';
import { EmailsService } from '../emails/emails.service';

@Injectable()
export class PaymentReminderService {
  private readonly logger = new Logger(PaymentReminderService.name);

  constructor(
    private prisma: PrismaService,
    private emails: EmailsService,
  ) {}

  @Cron('0 9 * * *') // Every day at 9 AM
  async sendOverdueReminders() {
    this.logger.log('Running daily overdue invoice reminder check…');

    const now = new Date();

    // Find all organizations that have overdue invoices
    const overdueInvoices = await this.prisma.invoice.findMany({
      where: {
        status: { in: ['sent', 'partial', 'overdue'] },
        dueDate: { lt: now },
      },
      include: {
        client: {
          include: {
            contacts: {
              where: { type: 'contact', active: true },
              select: { email: true, firstName: true },
              take: 3,
            },
          },
        },
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    if (overdueInvoices.length === 0) {
      this.logger.log('No overdue invoices found');
      return;
    }

    let sent = 0;
    let skipped = 0;

    for (const invoice of overdueInvoices) {
      // Find an email to send to
      const contactEmail = invoice.client?.contacts?.[0]?.email;
      if (!contactEmail) {
        skipped++;
        continue;
      }

      const daysOverdue = Math.floor(
        (now.getTime() - new Date(invoice.dueDate!).getTime()) / (1000 * 60 * 60 * 24),
      );

      const orgName = invoice.organization?.name ?? 'Our Company';
      const contactName = invoice.client?.contacts?.[0]?.firstName ?? invoice.client?.company ?? '';

      try {
        await this.emails.queue({
          to: contactEmail,
          subject: `Payment Reminder: Invoice ${invoice.number} is ${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue`,
          html: `<p>Hi ${contactName},</p>
<p>This is a friendly reminder that invoice <strong>${invoice.number}</strong> for <strong>${invoice.total}</strong> was due on <strong>${new Date(invoice.dueDate!).toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: 'numeric' })}</strong> and is now <strong>${daysOverdue} day${daysOverdue !== 1 ? 's' : ''} overdue</strong>.</p>
<p>Please arrange payment at your earliest convenience.</p>
<p><a href="${process.env.APP_URL}/portal/invoices/${invoice.id}">View Invoice</a></p>
<p>Thank you,<br/>${orgName}</p>`,
        });
        sent++;
      } catch (err) {
        this.logger.error(
          `Failed to send reminder for invoice ${invoice.number}: ${(err as Error).message}`,
        );
      }

      // Also mark as overdue if not already
      if (invoice.status !== 'overdue') {
        try {
          await this.prisma.invoice.update({
            where: { id: invoice.id },
            data: { status: 'overdue' },
          });
        } catch {
          // non-critical
        }
      }
    }

    this.logger.log(
      `Overdue reminders complete: ${sent} sent, ${skipped} skipped (no contact email)`,
    );
  }
}
