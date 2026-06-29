import { Module } from '@nestjs/common';
import { IntegrationController } from './integration.controller';
import { ScopesGuard } from './scopes.guard';

// PublicApiModule exports PublicWebhooksService + the JwtOrApiKeyGuard /
// ApiKeyStrategy / JwtAuthGuard providers the controller's @UseGuards needs.
import { PublicApiModule } from '../public-api/public-api.module';
// Feature modules — each already `exports:` its service, so importing the
// module makes the service injectable here without touching their providers.
import { LeadsModule } from '../leads/leads.module';
import { ClientsModule } from '../clients/clients.module';
import { InvoicesModule } from '../invoices/invoices.module';
import { OpportunitiesModule } from '../opportunities/opportunities.module';

/**
 * Public Integration API surface (Zapier / Make / generic REST clients).
 *
 * Composition-only module: it owns no business logic. It wires the
 * scope-gated `IntegrationController` to the existing, untouched, org-scoped
 * services (Leads/Clients/Invoices/Opportunities + PublicWebhooks).
 *
 * `ScopesGuard` is the only local provider; `JwtOrApiKeyGuard` and the
 * services come from the imported modules' exports.
 */
@Module({
  imports: [
    PublicApiModule,
    LeadsModule,
    ClientsModule,
    InvoicesModule,
    OpportunitiesModule,
  ],
  controllers: [IntegrationController],
  providers: [ScopesGuard],
})
export class IntegrationModule {}
