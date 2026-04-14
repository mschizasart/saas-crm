import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bull';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { UsersModule } from './modules/users/users.module';
import { RolesModule } from './modules/roles/roles.module';
import { ClientsModule } from './modules/clients/clients.module';
import { LeadsModule } from './modules/leads/leads.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { EstimatesModule } from './modules/estimates/estimates.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CreditNotesModule } from './modules/credit-notes/credit-notes.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EmailsModule } from './modules/emails/emails.module';
import { ReportsModule } from './modules/reports/reports.module';
import { BillingModule } from './modules/billing/billing.module';
import { StorageModule } from './modules/storage/storage.module';
import { AiModule } from './modules/ai/ai.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { GoalsModule } from './modules/goals/goals.module';
import { CronModule } from './modules/cron/cron.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';

@Module({
  imports: [
    // Config — loads .env
    ConfigModule.forRoot({ isGlobal: true }),

    // Event bus (plugin/hook system)
    EventEmitterModule.forRoot(),

    // Cron scheduler
    ScheduleModule.forRoot(),

    // BullMQ job queues
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        redis: config.get('REDIS_URL'),
      }),
      inject: [ConfigService],
    }),

    // Prisma database
    DatabaseModule,

    // ─── Feature modules ──────────────────────────────────────
    AuthModule,
    OrganizationsModule,
    UsersModule,
    RolesModule,
    ClientsModule,
    LeadsModule,
    InvoicesModule,
    EstimatesModule,
    ProposalsModule,
    PaymentsModule,
    CreditNotesModule,
    ExpensesModule,
    SubscriptionsModule,
    ProjectsModule,
    TasksModule,
    TicketsModule,
    KnowledgeBaseModule,
    ContractsModule,
    CustomFieldsModule,
    NotificationsModule,
    EmailsModule,
    ReportsModule,
    BillingModule,
    StorageModule,
    AiModule,
    SurveysModule,
    GoalsModule,
    CronModule,
    PdfModule,
    ActivityLogModule,
  ],
})
export class AppModule {}
