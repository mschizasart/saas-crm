import { Module } from '@nestjs/common';
import { AddinController } from './addin.controller';
import { AddinService } from './addin.service';
import { ActivityCaptureModule } from '../activity-capture/activity-capture.module';
import { LeadsModule } from '../leads/leads.module';
import { ClientsModule } from '../clients/clients.module';

/**
 * Backend for the Outlook email add-in (Office.js taskpane).
 *
 * Pure reuse layer — no new persistence. It composes three existing,
 * org-scoped services:
 *  - ContactResolverService (activity-capture) → resolve sender email.
 *  - LeadsService            (leads)           → create lead / findOne.
 *  - ClientsService          (clients)         → createContact / findOne.
 *
 * PrismaService comes from the global DatabaseModule. The org is taken
 * from the JWT via the global TenantInterceptor (request.organization),
 * so there is no cross-tenant surface.
 */
@Module({
  imports: [ActivityCaptureModule, LeadsModule, ClientsModule],
  controllers: [AddinController],
  providers: [AddinService],
})
export class AddinModule {}
