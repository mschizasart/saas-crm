import {
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
} from '@nestjs/swagger';
import { JwtOrApiKeyGuard } from '../auth/jwt-or-api-key.guard';
import { ScopesGuard } from './scopes.guard';
import { RequireScopes } from './require-scopes.decorator';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { INTEGRATION_SCOPES } from './scopes';
import { ALLOWED_EVENTS } from '../public-api/webhook-events';
import { getEventSample } from './event-samples';

import { LeadsService } from '../leads/leads.service';
import { ClientsService } from '../clients/clients.service';
import { InvoicesService } from '../invoices/invoices.service';
import { OpportunitiesService } from '../opportunities/opportunities.service';
import { PublicWebhooksService } from '../public-api/webhooks.service';

import {
  IntegrationListQueryDto,
  IntegrationCreateLeadDto,
  IntegrationUpdateLeadDto,
  IntegrationCreateClientDto,
  IntegrationUpdateClientDto,
  IntegrationCreateWebhookDto,
} from './integration.dto';

/**
 * Public Integration API (Zapier / Make / generic REST clients).
 *
 * One authenticated surface under `/api/v1/integration/*` that re-exposes the
 * org's leads / clients / invoices / opportunities and webhook subscriptions
 * to external automation tools, gated by per-key SCOPES rather than RBAC.
 *
 * Auth chain (order matters):
 *   1. `JwtOrApiKeyGuard`  — accepts a JWT bearer OR a `crm_*` public-API key
 *      and populates `request.user`. The global `TenantInterceptor` then
 *      resolves `request.organization` from `user.orgId` (works for both JWT
 *      and api-key principals — same plumbing the /settings/* api-key routes
 *      use).
 *   2. `ScopesGuard`       — reads `@RequireScopes(...)` and enforces that an
 *      api-key principal carries every required scope (`*` = all). JWT staff
 *      callers are not scope-constrained (see ScopesGuard class doc).
 *
 * ALL data operations delegate to the existing org-scoped business services
 * (each wraps its work in `prisma.withOrganization(orgId, ...)`), so there is
 * no cross-org IDOR risk: a row id from another org simply 404s.
 *
 * The `createdBy` actor for writes is `api-key:<id>` so the audit trail can
 * distinguish automation writes from human ones.
 */
@ApiTags('Integration')
@ApiBearerAuth()
@Controller({ version: '1', path: 'integration' })
@UseGuards(JwtOrApiKeyGuard, ScopesGuard)
export class IntegrationController {
  constructor(
    private readonly leads: LeadsService,
    private readonly clients: ClientsService,
    private readonly invoices: InvoicesService,
    private readonly opportunities: OpportunitiesService,
    private readonly webhooks: PublicWebhooksService,
  ) {}

  /** Stable actor string for audit attribution of api-key / JWT writes. */
  private actor(user: any): string {
    if (user?.type === 'api-key') {
      return `api-key:${user.apiKeyId ?? user.sub}`;
    }
    // JWT staff/admin — use their user id (sub) when present.
    return user?.sub ?? 'integration';
  }

  // ─── Discovery / metadata (no scope required) ───────────────────

  @Get('me')
  @ApiOperation({
    summary: 'Identity & scopes for the current credential',
    description:
      'Returns the resolved organization, the principal type, and the scopes the credential carries. No secrets are returned.',
  })
  me(@CurrentOrg() org: any, @CurrentUser() user: any) {
    const isApiKey = user?.type === 'api-key';
    return {
      organization: org ? { id: org.id, name: org.name } : null,
      principal: {
        type: isApiKey ? 'api-key' : 'user',
        // No secrets: only a non-sensitive display id for api-keys.
        name: isApiKey ? (user.apiKeyId ?? null) : (user?.sub ?? null),
      },
      scopes: isApiKey && Array.isArray(user.scopes) ? user.scopes : ['*'],
    };
  }

  @Get('scopes')
  @ApiOperation({ summary: 'List the available integration scopes catalog' })
  listScopes() {
    return { scopes: INTEGRATION_SCOPES };
  }

  @Get('events')
  @ApiOperation({ summary: 'List the webhook event types you can subscribe to' })
  listEvents() {
    return { events: ALLOWED_EVENTS };
  }

  @Get('events/:event/sample')
  @ApiOperation({
    summary: 'Get a sample payload for a webhook event',
    description:
      'Lets Zapier/Make build field mappings without waiting for a real event to fire. 404 if the event name is not recognised.',
  })
  @ApiParam({ name: 'event', example: 'lead.created' })
  eventSample(@Param('event') event: string) {
    const sample = getEventSample(event);
    if (!sample) throw new NotFoundException(`Unknown event: ${event}`);
    return { event, sample };
  }

  // ─── Leads ──────────────────────────────────────────────────────

  @Get('leads')
  @RequireScopes('leads.read')
  @ApiOperation({ summary: 'List leads' })
  listLeads(@CurrentOrg() org: any, @Query() query: IntegrationListQueryDto) {
    return this.leads.findAll(org.id, query);
  }

  @Get('leads/:id')
  @RequireScopes('leads.read')
  @ApiOperation({ summary: 'Get a lead by id' })
  getLead(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.leads.findOne(org.id, id);
  }

  @Post('leads')
  @RequireScopes('leads.write')
  @ApiOperation({ summary: 'Create a lead' })
  createLead(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: IntegrationCreateLeadDto,
  ) {
    return this.leads.create(org.id, dto, this.actor(user));
  }

  @Patch('leads/:id')
  @RequireScopes('leads.write')
  @ApiOperation({ summary: 'Update a lead' })
  updateLead(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: IntegrationUpdateLeadDto,
  ) {
    return this.leads.update(org.id, id, dto, this.actor(user));
  }

  // ─── Clients ────────────────────────────────────────────────────

  @Get('clients')
  @RequireScopes('clients.read')
  @ApiOperation({ summary: 'List clients' })
  listClients(@CurrentOrg() org: any, @Query() query: IntegrationListQueryDto) {
    return this.clients.findAll(org.id, query);
  }

  @Get('clients/:id')
  @RequireScopes('clients.read')
  @ApiOperation({ summary: 'Get a client by id' })
  getClient(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.clients.findOne(org.id, id);
  }

  @Post('clients')
  @RequireScopes('clients.write')
  @ApiOperation({ summary: 'Create a client' })
  createClient(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: IntegrationCreateClientDto,
  ) {
    return this.clients.create(org.id, dto, this.actor(user));
  }

  @Patch('clients/:id')
  @RequireScopes('clients.write')
  @ApiOperation({ summary: 'Update a client' })
  updateClient(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Body() dto: IntegrationUpdateClientDto,
  ) {
    return this.clients.update(org.id, id, dto, this.actor(user));
  }

  // ─── Invoices (read-only) ───────────────────────────────────────

  @Get('invoices')
  @RequireScopes('invoices.read')
  @ApiOperation({ summary: 'List invoices (read-only)' })
  listInvoices(@CurrentOrg() org: any, @Query() query: IntegrationListQueryDto) {
    return this.invoices.findAll(org.id, query);
  }

  @Get('invoices/:id')
  @RequireScopes('invoices.read')
  @ApiOperation({ summary: 'Get an invoice by id (read-only)' })
  getInvoice(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.invoices.findOne(org.id, id);
  }

  // ─── Opportunities (read-only) ──────────────────────────────────

  @Get('opportunities')
  @RequireScopes('opportunities.read')
  @ApiOperation({ summary: 'List opportunities (read-only)' })
  listOpportunities(
    @CurrentOrg() org: any,
    @Query() query: IntegrationListQueryDto,
  ) {
    // Intentionally org-wide: an integration API key is an org-level
    // principal (not a user in the team hierarchy), so it sees all of the
    // org's opportunities — gated by tenant isolation + the
    // 'opportunities.read' scope. We deliberately omit currentUser (no
    // RecordSharingService per-user scoping) for this org-level surface.
    return this.opportunities.list(org.id, query);
  }

  @Get('opportunities/:id')
  @RequireScopes('opportunities.read')
  @ApiOperation({ summary: 'Get an opportunity by id (read-only)' })
  getOpportunity(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.opportunities.findOne(org.id, id);
  }

  // ─── Webhooks (Zapier REST Hooks subscribe/unsubscribe) ─────────

  @Get('webhooks')
  @RequireScopes('webhooks.subscribe')
  @ApiOperation({ summary: 'List webhook subscriptions for the org' })
  listWebhooks(@CurrentOrg() org: any) {
    return this.webhooks.list(org.id);
  }

  @Post('webhooks')
  @RequireScopes('webhooks.subscribe')
  @ApiOperation({
    summary: 'Create a webhook subscription',
    description:
      'Generates an HMAC secret server-side. The plaintext secret is returned ONCE in this response — store it now.',
  })
  createWebhook(
    @CurrentOrg() org: any,
    @CurrentUser() user: any,
    @Body() dto: IntegrationCreateWebhookDto,
  ) {
    const userId = user?.type === 'api-key' ? null : (user?.sub ?? null);
    return this.webhooks.create(org.id, userId, dto);
  }

  @Delete('webhooks/:id')
  @RequireScopes('webhooks.subscribe')
  @ApiOperation({ summary: 'Delete a webhook subscription' })
  deleteWebhook(@CurrentOrg() org: any, @Param('id') id: string) {
    return this.webhooks.remove(org.id, id);
  }
}
