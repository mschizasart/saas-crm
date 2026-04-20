import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpenseCategoriesController } from './expense-categories.controller';
import { ExpensesService } from './expenses.service';
import { RecurringExpenseService } from './recurring-expense.service';

@Module({
  // ExpenseCategoriesController is registered first so that
  // `/api/v1/expenses/categories` is matched before
  // ExpensesController's `/api/v1/expenses/:id`.
  controllers: [ExpenseCategoriesController, ExpensesController],
  providers: [ExpensesService, RecurringExpenseService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
