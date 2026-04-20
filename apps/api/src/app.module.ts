import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { TenantInterceptor } from './common/interceptors/tenant.interceptor';
import { QueueModule } from './modules/queue/queue.module';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { PlatformModule } from './modules/platform/platform.module';
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
import { ExportsModule } from './modules/exports/exports.module';
import { BillingModule } from './modules/billing/billing.module';
import { StorageModule } from './modules/storage/storage.module';
import { AiModule } from './modules/ai/ai.module';
import { SurveysModule } from './modules/surveys/surveys.module';
import { GoalsModule } from './modules/goals/goals.module';
import { CronModule } from './modules/cron/cron.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { ActivityLogModule } from './modules/activity-log/activity-log.module';
import { CalendarModule } from './modules/calendar/calendar.module';
import { TodosModule } from './modules/todos/todos.module';
import { AnnouncementsModule } from './modules/announcements/announcements.module';
import { TagsModule } from './modules/tags/tags.module';
import { VaultModule } from './modules/vault/vault.module';
import { SmsModule } from './modules/sms/sms.module';
import { EinvoiceModule } from './modules/einvoice/einvoice.module';
import { GdprModule } from './modules/gdpr/gdpr.module';
import { BackupsModule } from './modules/backups/backups.module';
import { SavedItemsModule } from './modules/saved-items/saved-items.module';
import { PredefinedRepliesModule } from './modules/predefined-replies/predefined-replies.module';
import { ImportsModule } from './modules/imports/imports.module';
import { ClockModule } from './modules/clock/clock.module';
import { NewsfeedModule } from './modules/newsfeed/newsfeed.module';
import { SearchModule } from './modules/search/search.module';
import { CurrenciesModule } from './modules/currencies/currencies.module';
import { AutomationsModule } from './modules/automations/automations.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { ApiKeysModule } from './modules/api-keys/api-keys.module';
import { AppointmentsModule } from './modules/appointments/appointments.module';
import { ProductsModule } from './modules/products/products.module';
import { ChatModule } from './modules/chat/chat.module';
import { SuggestionsModule } from './modules/suggestions/suggestions.module';

@Module({
  imports: [
    // Config — loads .env
    ConfigModule.forRoot({ isGlobal: true }),

    // Event bus (plugin/hook system)
    EventEmitterModule.forRoot(),

    // Cron scheduler
    ScheduleModule.forRoot(),

    // BullMQ job queues (global)
    QueueModule,

    // Prisma database
    DatabaseModule,

    // ─── Feature modules ──────────────────────────────────────
    AuthModule,
    PlatformModule,
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
    ExportsModule,
    BillingModule,
    StorageModule,
    AiModule,
    SurveysModule,
    GoalsModule,
    CronModule,
    PdfModule,
    ActivityLogModule,
    CalendarModule,
    TodosModule,
    AnnouncementsModule,
    TagsModule,
    VaultModule,
    SmsModule,
    EinvoiceModule,
    GdprModule,
    BackupsModule,
    SavedItemsModule,
    PredefinedRepliesModule,
    ImportsModule,
    ClockModule,
    NewsfeedModule,
    SearchModule,
    CurrenciesModule,
    AutomationsModule,
    WebhooksModule,
    ApiKeysModule,
    AppointmentsModule,
    ProductsModule,
    ChatModule,
    SuggestionsModule,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
  ],
})
export class AppModule {}
