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
import { MembershipsModule } from './modules/memberships/memberships.module';
import { RolesModule } from './modules/roles/roles.module';
import { ClientsModule } from './modules/clients/clients.module';
import { LeadsModule } from './modules/leads/leads.module';
import { LeadFormsModule } from './modules/lead-forms/lead-forms.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { EstimatesModule } from './modules/estimates/estimates.module';
import { EstimateRequestFormsModule } from './modules/estimate-request-forms/estimate-request-forms.module';
import { ProposalsModule } from './modules/proposals/proposals.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { CreditNotesModule } from './modules/credit-notes/credit-notes.module';
import { ExpensesModule } from './modules/expenses/expenses.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { TicketsModule } from './modules/tickets/tickets.module';
import { TicketSpamFiltersModule } from './modules/ticket-spam-filters/ticket-spam-filters.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { SignaturesModule } from './modules/signatures/signatures.module';
import { CustomFieldsModule } from './modules/custom-fields/custom-fields.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { EmailsModule } from './modules/emails/emails.module';
import { EmailSettingsModule } from './modules/email-settings/email-settings.module';
import { InboxModule } from './modules/inbox/inbox.module';
import { EmailTrackingModule } from './modules/email-tracking/email-tracking.module';
import { ReportsModule } from './modules/reports/reports.module';
import { ExportsModule } from './modules/exports/exports.module';
import { BillingModule } from './modules/billing/billing.module';
import { StorageModule } from './modules/storage/storage.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { AiModule } from './modules/ai/ai.module';
import { TaxModule } from './modules/tax/tax.module';
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
import { PushModule } from './modules/push/push.module';
import { DunningModule } from './modules/dunning/dunning.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { SequencesModule } from './modules/sequences/sequences.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { CustomObjectsModule } from './modules/custom-objects/custom-objects.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { CpqModule } from './modules/cpq/cpq.module';
import { AuditModule } from './modules/audit/audit.module';
import { AuditContextInterceptor } from './modules/audit/audit-context.interceptor';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { AccountHierarchyModule } from './modules/account-hierarchy/account-hierarchy.module';
import { FxModule } from './modules/fx/fx.module';
import { RecordSharingModule } from './modules/record-sharing/record-sharing.module';
import { TerritoriesModule } from './modules/territories/territories.module';
// Wave G3 — Chatter-style internal feed + @mentions
import { FeedModule } from './modules/feed/feed.module';
// Wave H1 — Field Service (work orders + dispatch)
import { FieldServiceModule } from './modules/field-service/field-service.module';
// Wave H2 — Einstein Activity Capture (auto-log emails/SMS into the
// Activity timeline). Observes the four messaging pipeline events
// and stamps a unified `activities` row pinned to the matched CRM
// record.
import { ActivityCaptureModule } from './modules/activity-capture/activity-capture.module';
// Wave H3 — Bulk API + CSV import (per-row partial-success
// semantics; opt-in JwtOrApiKeyGuard so customers can drive it
// from public-API keys).
import { BulkApiModule } from './modules/bulk-api/bulk-api.module';

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
    MembershipsModule,
    RolesModule,
    ClientsModule,
    LeadsModule,
    LeadFormsModule,
    InvoicesModule,
    EstimatesModule,
    EstimateRequestFormsModule,
    ProposalsModule,
    PaymentsModule,
    CreditNotesModule,
    ExpensesModule,
    SubscriptionsModule,
    ProjectsModule,
    TasksModule,
    TicketsModule,
    TicketSpamFiltersModule,
    KnowledgeBaseModule,
    ContractsModule,
    SignaturesModule,
    CustomFieldsModule,
    NotificationsModule,
    EmailsModule,
    EmailSettingsModule,
    InboxModule,
    EmailTrackingModule,
    ReportsModule,
    ExportsModule,
    BillingModule,
    StorageModule,
    DocumentsModule,
    AiModule,
    TaxModule,
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
    PushModule,
    DunningModule,
    CampaignsModule,
    SequencesModule,
    OpportunitiesModule,
    CustomObjectsModule,
    ApprovalsModule,
    AuditModule,
    // Wave E3 — Public REST API + Webhooks
    PublicApiModule,
    // Wave F1 — Account hierarchy
    AccountHierarchyModule,
    // Wave F2 — CPQ (product bundles + quotes)
    CpqModule,
    // Wave F3 — Multi-currency + daily FX rates
    FxModule,
    // Wave G1 — Role hierarchy + hierarchical record sharing
    RecordSharingModule,
    // Wave G2 — Territory management
    TerritoriesModule,
    // Wave G3 — Chatter-style internal feed + @mentions
    FeedModule,
    // Wave H1 — Field Service (work orders + dispatch)
    FieldServiceModule,
    // Wave H2 — Einstein Activity Capture
    ActivityCaptureModule,
    // Wave H3 — Bulk API + CSV import
    BulkApiModule,
  ],
  providers: [
    // TenantInterceptor must run before AuditContextInterceptor so
    // request.organization is populated when AuditContextInterceptor
    // reads it to seed the AsyncLocalStorage audit context.
    { provide: APP_INTERCEPTOR, useClass: TenantInterceptor },
    // Wave E2 — stashes { orgId, userId, ip } into AsyncLocalStorage so
    // the Prisma audit extension can attribute writes without each
    // service having to pass the actor down. See
    // apps/api/src/modules/audit/audit-context.interceptor.ts.
    { provide: APP_INTERCEPTOR, useClass: AuditContextInterceptor },
  ],
})
export class AppModule {}
