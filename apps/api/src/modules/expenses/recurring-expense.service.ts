import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class RecurringExpenseService {
  private readonly logger = new Logger(RecurringExpenseService.name);

  constructor(private prisma: PrismaService) {}

  @Cron('0 6 * * *') // 6 AM daily
  async processRecurringExpenses() {
    const now = new Date();
    this.logger.log('Processing recurring expenses...');

    const expenses = await this.prisma.expense.findMany({
      where: {
        recurring: true,
        recurringNextDate: { lte: now },
        OR: [
          { recurringEndDate: null },
          { recurringEndDate: { gte: now } },
        ],
      },
    });

    this.logger.log(`Found ${expenses.length} recurring expenses to process`);

    for (const expense of expenses) {
      try {
        // Clone the expense with today's date
        await this.prisma.expense.create({
          data: {
            organizationId: expense.organizationId,
            name: expense.name,
            amount: expense.amount,
            date: now,
            categoryId: expense.categoryId,
            clientId: expense.clientId,
            projectId: expense.projectId,
            currencyId: expense.currencyId,
            note: expense.note,
            billable: expense.billable,
            tax: expense.tax,
            tax2: expense.tax2,
            paymentMode: expense.paymentMode,
            reference: expense.reference,
            recurring: false, // the cloned expense is NOT recurring
          },
        });

        // Advance next date based on frequency
        const next = new Date(expense.recurringNextDate!);
        const recType = expense.recurringType ?? 'monthly';
        if (recType === 'monthly') next.setMonth(next.getMonth() + 1);
        else if (recType === 'quarterly') next.setMonth(next.getMonth() + 3);
        else if (recType === 'yearly') next.setFullYear(next.getFullYear() + 1);

        await this.prisma.expense.update({
          where: { id: expense.id },
          data: {
            recurringNextDate: next,
            lastRecurringDate: now,
          },
        });

        this.logger.log(
          `Processed recurring expense "${expense.name}" (${expense.id}), next: ${next.toISOString()}`,
        );
      } catch (err) {
        this.logger.error(
          `Failed to process recurring expense ${expense.id}: ${err}`,
        );
      }
    }
  }
}
