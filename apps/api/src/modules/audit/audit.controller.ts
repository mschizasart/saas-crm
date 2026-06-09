import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RbacGuard } from '../../common/guards/rbac.guard';
import { CurrentOrg } from '../../common/decorators/current-org.decorator';
import { Permissions } from '../../common/decorators/permissions.decorator';

/**
 * Read-only endpoints over `AuditLog`. Writes happen automatically via
 * `auditExtension`; no write endpoints are exposed.
 *
 * All three routes are gated by the `audit.view` permission (granted to
 * Admin by default in seed-org.ts; can be granted to other roles via
 * per-user override or by editing the role).
 */
@ApiTags('Audit')
@Controller({ version: '1', path: 'audit' })
@UseGuards(JwtAuthGuard, RbacGuard)
@ApiBearerAuth()
export class AuditController {
  constructor(private service: AuditService) {}

  /**
   * Timeline of changes for a single record. The web `AuditTimeline`
   * component calls this from each entity detail page.
   */
  @Get('entity')
  @Permissions('audit.view')
  @ApiOperation({ summary: 'Field history timeline for a single entity' })
  entity(
    @CurrentOrg() org: any,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!entityType || !entityId) {
      throw new BadRequestException('entityType and entityId are required');
    }
    return this.service.listForEntity(org.id, entityType, entityId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Org-wide chronological feed. Powers the /audit page.
   */
  @Get('feed')
  @Permissions('audit.view')
  @ApiOperation({ summary: 'Org-wide recent activity feed' })
  feed(
    @CurrentOrg() org: any,
    @Query('entityType') entityType?: string,
    @Query('action') action?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.recentFeed(org.id, {
      entityType,
      action,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  /**
   * Changes attributed to a single user — compliance / admin view.
   */
  @Get('by-user')
  @Permissions('audit.view')
  @ApiOperation({ summary: 'List audit rows attributed to a specific user' })
  byUser(
    @CurrentOrg() org: any,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    if (!userId) {
      throw new BadRequestException('userId is required');
    }
    return this.service.listByUser(org.id, userId, {
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }
}
