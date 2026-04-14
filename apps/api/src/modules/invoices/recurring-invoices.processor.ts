import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../database/prisma.service';

/**
 * Processes 'recurring-invoices' jobs. For each due recurring invoice,
 * clones it as a fresh draft and advances nextRecurringDate according
 * to recurringType / recurringEvery.
 */
@Processor('recurring-invoices')
export class RecurringInvoicesProcessor extends WorkerHost {
  private readonly logger = new Logger(RecurringInvoicesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {
    super();
  }

  async process(job: Job) {
    this.logger.log(`Running recurring invoice check (job ${job.id})`);
    const now = new Date();
    let created = 0;
    let failed = 0;

    let dueInvoices: any[] = [];
    try {
      dueInvoices = await (this.prisma as any).invoice.findMany({
        where: {
          isRecurring: true,
          nextRecurringDate: { lte: now },
          status: { not: 'cancelled' },
        },
        include: { items: true },
      });
    } catch (err) {
      this.logger.error(
        `Failed to query recurring invoices: ${(err as Error).message}`,
      );
      throw err;
    }

    this.logger.log(`Found ${dueInvoices.length} recurring invoice(s) due`);

    for (const source of dueInvoices) {
      try {
        await this.generateNextOccurrence(source);
        created++;
      } catch (err) {
        failed++;
        this.logger.error(
          `Failed to generate recurring invoice from ${source.id}: ${(err as Error).message}`,
        );
      }
    }

    return { checked: dueInvoices.length, created, failed };
  }

  private async generateNextOccurrence(source: any) {
    const orgId: string = source.organizationId;

    const duplicate = await this.prisma.withOrganization(
      orgId,
      async (tx: any) => {
        // Check totalCycles cap
        if (
          source.totalCycles != null &&
          source.totalCyclesCompleted >= source.totalCycles
        ) {
          // Disable further recurrence
          await tx.invoice.update({
            where: { id: source.id },
            data: { isRecurring: false },
          });
          return null;
        }

        const count = await tx.invoice.count({
          where: { organizationId: orgId },
        });
        const number = `INV-${String(count + 1).padStart(4, '0')}`;

        const newInvoice = await tx.invoice.create({
          data: {
            organizationId: orgId,
            clientId: source.clientId,
            currencyId: source.currencyId,
            number,
            date: new Date(),
            dueDate: source.dueDate
              ? new Date(
                  Date.now() +
                    (new Date(source.dueDate).getTime() -
                      new Date(source.date).getTime()),
                )
              : null,
            status: 'draft',
            subTotal: source.subTotal,
            discount: source.discount,
            discountType: source.discountType,
            adjustment: source.adjustment,
            total: source.total,
            totalTax: source.totalTax,
            clientNote: source.clientNote,
            adminNote: source.adminNote,
            terms: source.terms,
            allowedPaymentModes: source.allowedPaymentModes ?? [],
            isRecurring: false,
            recurringFromInvoiceId: source.id,
            items: {
              createMany: {
                data: (source.items ?? []).map((item: any) => ({
                  description: item.description,
                  longDesc: item.longDesc,
                  qty: item.qty,
                  rate: item.rate,
                  tax1: item.tax1,
                  tax2: item.tax2,
                  amount: item.amount,
                  order: item.order,
                })),
              },
            },
          },
        });

        // Advance source recurrence tracking
        const next = this.computeNextDate(
          new Date(),
          source.recurringType,
          source.recurringEvery ?? 1,
        );
        await tx.invoice.update({
          where: { id: source.id },
          data: {
            lastRecurringDate: new Date(),
            nextRecurringDate: next,
            totalCyclesCompleted: source.totalCyclesCompleted + 1,
          },
        });

        return newInvoice;
      },
    );

    if (duplicate) {
      this.events.emit('invoice.created', {
        invoice: duplicate,
        orgId,
        recurringFromInvoiceId: source.id,
      });
    }
  }

  private computeNextDate(
    from: Date,
    type: string | null | undefined,
    every: number,
  ): Date {
    const d = new Date(from);
    const step = Math.max(1, every || 1);
    switch ((type || 'month').toLowerCase()) {
      case 'day':
        d.setDate(d.getDate() + step);
        break;
      case 'week':
        d.setDate(d.getDate() + 7 * step);
        break;
      case 'quarterly':
        d.setMonth(d.getMonth() + 3 * step);
        break;
      case 'year':
      case 'yearly':
        d.setFullYear(d.getFullYear() + step);
        break;
      case 'month':
      case 'monthly':
      default:
        d.setMonth(d.getMonth() + step);
        break;
    }
    return d;
  }
}
